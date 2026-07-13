import * as vscode from 'vscode';
import * as path from 'path';
import { DesignerPanel } from '../designer/DesignerPanel';
import { ProjectUtils } from '../utils/ProjectUtils';
import { logger } from '../utils/Logger';

/**
 * HML 文件自定义编辑器提供器
 * 实现 CustomTextEditorProvider 接口，提供设计器视图
 */
export class HmlEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'honeygui.hmlEditor';
    private static activePanels: Set<DesignerPanel> = new Set();

    constructor(private readonly context: vscode.ExtensionContext) {
        // 注册广播命令
        context.subscriptions.push(
            vscode.commands.registerCommand('_honeygui.broadcastToWebviews', (message: any) => {
                HmlEditorProvider.broadcastMessage(message);
            })
        );
    }

    /**
     * 广播消息到所有活动的 Webview
     */
    private static broadcastMessage(message: any): void {
        this.activePanels.forEach(panel => {
            panel.sendMessage(message.command, message);
        });
    }

    /**
     * 当用户打开 HML 文件时调用此方法
     */
    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        logger.info(`[HmlEditorProvider] resolveCustomTextEditor被调用: ${document.fileName}`);
        
        // 计算 localResourceRoots
        const localRoots: vscode.Uri[] = [
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'designer', 'webview'),
            vscode.Uri.joinPath(this.context.extensionUri, 'out', 'designer', 'webview')
        ];
        
        // 从文件路径查找项目根目录
        const projectRoot = ProjectUtils.findProjectRoot(document.uri.fsPath);
        if (projectRoot) {
            localRoots.push(vscode.Uri.file(projectRoot));
            logger.info(`[HmlEditorProvider] 项目根目录: ${projectRoot}`);
        } else {
            // 如果没找到 project.json，使用 HML 文件所在目录的父目录作为项目根目录
            // 假设 HML 文件在 ui/ 目录下，父目录就是项目根目录
            const hmlDir = path.dirname(document.uri.fsPath);
            const parentDir = path.dirname(hmlDir);
            localRoots.push(vscode.Uri.file(parentDir));
            logger.info(`[HmlEditorProvider] 未找到project.json，使用父目录: ${parentDir}`);
        }
        
        logger.info(`[HmlEditorProvider] localResourceRoots: ${localRoots.map(r => r.fsPath).join(', ')}`);
        
        // 设置 Webview 选项
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: localRoots
        };

        // 获取文件名作为标题
        const fileName = path.basename(document.fileName);
        webviewPanel.title = `HML Designer: ${fileName}`;
        logger.debug(`[HmlEditorProvider] 设置面板标题: ${webviewPanel.title}`);

        // 创建设计器面板实例
        const designerPanel = new DesignerPanel(webviewPanel, this.context);
        logger.debug(`[HmlEditorProvider] 创建DesignerPanel实例`);

        // 注册到活动面板集合
        HmlEditorProvider.activePanels.add(designerPanel);

        // 监听面板关闭，从集合中移除
        webviewPanel.onDidDispose(() => {
            HmlEditorProvider.activePanels.delete(designerPanel);
        });

        // 加载文档内容到设计器
        logger.info(`[HmlEditorProvider] 开始加载文档内容到设计器: ${document.uri.fsPath}`);

        await designerPanel.loadFromDocument(document);

        logger.info(`[HmlEditorProvider] 文档内容加载完成`);

        // 监听保存事件（排除我们自己的保存操作）
        const changeDocumentSubscription = vscode.workspace.onDidSaveTextDocument(doc => {
            // 使用 fsPath 进行可靠的文件路径对比
            // 避免使用 toString() 可能导致的格式和编码问题
            const isSameUri = doc.uri.fsPath === document.uri.fsPath;
            const isInDesignSavingTransaction = designerPanel.getSaveTransactionId() > 0;

            if (isSameUri && !isInDesignSavingTransaction) {
                logger.debug('[HmlEditorProvider] 检测到保存事件，更新设计器...');
                designerPanel.updateFromDocument();
            }
        });

        // 监听文档内容变更事件（处理 AI agent 通过 WorkspaceEdit 编辑的情况）
        // 使用防抖机制避免频繁刷新
        let changeDebounceTimer: ReturnType<typeof setTimeout> | undefined;
        const textChangeSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.fsPath !== document.uri.fsPath) {
                return;
            }
            // 跳过设计器自身触发的修改
            if (designerPanel.getSaveTransactionId() > 0) {
                return;
            }
            // 忽略无实际内容变更的事件
            if (e.contentChanges.length === 0) {
                return;
            }
            // 防抖：1000ms 内只触发一次（AI agent 可能连续多次编辑）
            if (changeDebounceTimer) {
                clearTimeout(changeDebounceTimer);
            }
            changeDebounceTimer = setTimeout(() => {
                logger.debug('[HmlEditorProvider] 检测到文档内容变更（外部编辑），更新设计器...');
                designerPanel.updateFromDocument();
            }, 1000);
        });

        // 监听磁盘文件变更（处理 AI agent 直接写磁盘 或 git checkout 等外部程序修改的情况）
        const fileWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(path.dirname(document.uri.fsPath), path.basename(document.uri.fsPath))
        );
        let fsDebounceTimer: ReturnType<typeof setTimeout> | undefined;
        const onDiskChange = () => {
            if (designerPanel.getSaveTransactionId() > 0) {
                return;
            }
            if (fsDebounceTimer) {
                clearTimeout(fsDebounceTimer);
            }
            fsDebounceTimer = setTimeout(() => {
                logger.debug('[HmlEditorProvider] 检测到磁盘文件变更，更新设计器...');
                designerPanel.updateFromDocument();
            }, 1000);
        };
        fileWatcher.onDidChange(onDiskChange);
        // 原子写入（写临时文件再 rename 覆盖）/ 先删后建 在文件系统层面是 create 事件而非
        // change，AI agent、格式化器、git checkout 普遍如此。与项目其它 watcher
        // （project.json/i18n/assets）保持一致，补 onDidCreate 避免外部编辑漏刷新。
        fileWatcher.onDidCreate(onDiskChange);

        // 面板关闭时清理监听器
        webviewPanel.onDidDispose(() => {
            logger.debug('[HmlEditorProvider] 面板关闭，清理监听器');
            changeDocumentSubscription.dispose();
            textChangeSubscription.dispose();
            fileWatcher.dispose();
            if (changeDebounceTimer) {
                clearTimeout(changeDebounceTimer);
            }
            if (fsDebounceTimer) {
                clearTimeout(fsDebounceTimer);
            }
        });
        
        logger.info('[HmlEditorProvider] resolveCustomTextEditor完成');
    }

    /**
     * 在文本编辑器中打开 HML 文件（右键菜单命令）
     */
    public static async openInTextEditor(uri: vscode.Uri): Promise<void> {
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document, {
            preview: false,
            viewColumn: vscode.ViewColumn.Active
        });
    }

    /**
     * 在设计器中打开 HML 文件（右键菜单命令）
     */
    public static async openInDesigner(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
        // 使用 VS Code 的 custom 打开方式
        await vscode.commands.executeCommand(
            'vscode.openWith',
            uri,
            HmlEditorProvider.viewType
        );
    }
}
