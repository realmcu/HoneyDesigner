import * as vscode from 'vscode';
import { logger } from '../utils/Logger';
import { DesignerPanel } from '../designer/DesignerPanel';
import { CreateProjectPanel } from '../designer/CreateProjectPanel';
import { ToolsPanel } from '../tools/ToolsPanel';
import * as path from 'path';
import * as fs from 'fs';
import { StatusBarManager } from '../ui/StatusBarManager';
import { ProjectUtils } from '../utils/ProjectUtils';
import { HmlTemplateManager } from '../hml/HmlTemplateManager';

/**
 * HoneyGUI命令管理器
 * 统一管理所有VS Code命令
 */
export class CommandManager {
    private disposables: vscode.Disposable[] = [];
    private statusBarManager: StatusBarManager;

    constructor(private context: vscode.ExtensionContext) {
        this.statusBarManager = StatusBarManager.getInstance(context);
    }

    /**
     * 注册所有命令
     */
    registerCommands(): void {
        // 新建项目
        this.registerCommand('honeygui.newProject', async () => {
            try {
                logger.info('执行命令: honeygui.newProject');
                await CreateProjectPanel.createOrShow(this.context);
            } catch (error) {
                logger.error(`新建项目失败: ${error instanceof Error ? error.message : String(error)}`);
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to create project: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
            }
        });

        // 资源转换工具
        this.registerCommand('honeygui.tools', async () => {
            try {
                logger.info('执行命令: honeygui.tools');
                ToolsPanel.createOrShow(this.context.extensionUri);
            } catch (error) {
                logger.error(`打开资源转换工具失败: ${error instanceof Error ? error.message : String(error)}`);
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to open resource conversion tools: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
            }
        });

        // 打开欢迎页面
        this.registerCommand('honeygui.welcome', async () => {
            try {
                logger.info('执行命令: honeygui.welcome');
                const panel = vscode.window.createWebviewPanel(
                    'honeyguiWelcome',
                    vscode.l10n.t('HoneyGUI Welcome'),
                    vscode.ViewColumn.One,
                    {
                        enableScripts: true,
                        retainContextWhenHidden: true
                    }
                );

                panel.webview.html = this.getWelcomeHtml();
            } catch (error) {
                logger.error(`打开欢迎页面失败: ${error instanceof Error ? error.message : String(error)}`);
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to open welcome page: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
            }
        });

        // 显示日志
        this.registerCommand('honeygui.showLogs', () => {
            logger.show();
        });

        // 清理缓存
        this.registerCommand('honeygui.clearCache', async () => {
            try {
                logger.info('执行命令: honeygui.clearCache');
                
                // 清理项目缓存
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders && workspaceFolders.length > 0) {
                    const workspaceRoot = workspaceFolders[0].uri.fsPath;
                    const cacheDir = path.join(workspaceRoot, '.honeygui', 'cache');
                    
                    if (fs.existsSync(cacheDir)) {
                        fs.rmSync(cacheDir, { recursive: true, force: true });
                        logger.info(`清理缓存目录: ${cacheDir}`);
                    }
                }

                logger.clearCache();
                vscode.window.showInformationMessage(vscode.l10n.t('Cache cleared'));
            } catch (error) {
                logger.error(`清理缓存失败: ${error instanceof Error ? error.message : String(error)}`);
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to clear cache: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
            }
        });

        // 在文本编辑器中打开HML文件
        this.registerCommand('honeygui.openInTextEditor', async (uri: vscode.Uri) => {
            try {
                logger.info(`执行命令: honeygui.openInTextEditor, URI: ${uri.fsPath}`);
                const document = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(document, {
                    preview: false,
                    viewColumn: vscode.ViewColumn.Active
                });
            } catch (error) {
                logger.error(`文本编辑器打开失败: ${error instanceof Error ? error.message : String(error)}`);
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to open in text editor: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
            }
        });

        // 在设计器中打开HML文件
        this.registerCommand('honeygui.openInDesigner', async (uri: vscode.Uri) => {
            try {
                logger.info(`执行命令: honeygui.openInDesigner, URI: ${uri?.fsPath}`);
                
                // 验证URI参数
                if (!uri) {
                    logger.error('设计器打开失败: URI参数为空');
                    vscode.window.showErrorMessage(vscode.l10n.t('Failed to open designer: file path not provided'));
                    return;
                }
                
                // 验证文件存在且为HML文件
                if (!fs.existsSync(uri.fsPath)) {
                    logger.error(`设计器打开失败: 文件不存在 - ${uri.fsPath}`);
                    vscode.window.showErrorMessage(vscode.l10n.t('Failed to open designer: file does not exist - {0}', path.basename(uri.fsPath)));
                    return;
                }
                
                if (!uri.fsPath.endsWith('.hml')) {
                    logger.error(`设计器打开失败: 不是HML文件 - ${uri.fsPath}`);
                    vscode.window.showErrorMessage(vscode.l10n.t('Failed to open designer: please select an HML file'));
                    return;
                }
                
                logger.info(`正在使用vscode.openWith打开文件: ${uri.fsPath}`);
                logger.info(`自定义编辑器类型: honeygui.hmlEditor`);
                
                // 先关闭当前活动的编辑器
                const activeEditor = vscode.window.activeTextEditor;
                if (activeEditor && activeEditor.document.uri.fsPath === uri.fsPath) {
                    logger.info('关闭当前活动的文本编辑器');
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                }
                
                // 使用 VS Code 的 custom 打开方式
                await vscode.commands.executeCommand(
                    'vscode.openWith',
                    uri,
                    'honeygui.hmlEditor'
                );
                
                logger.info(`设计器打开成功: ${uri.fsPath}`);
            } catch (error) {
                logger.error(`设计器打开失败: ${error instanceof Error ? error.message : String(error)}`);
                logger.error(`错误堆栈: ${error instanceof Error ? error.stack : '无堆栈信息'}`);
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to open designer: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
            }
        });

        // 在资源管理器中用上下键浏览 HML 时，同步打开当前焦点项，触发设计器预览刷新
        this.registerCommand('honeygui.explorerPreviewFocusDown', async () => {
            await this.focusExplorerItemAndOpen('down');
        });

        this.registerCommand('honeygui.explorerPreviewFocusUp', async () => {
            await this.focusExplorerItemAndOpen('up');
        });

        // 兼容 package.json 的命令: honeygui.openDesigner（无参时打开当前活动HML）
        this.registerCommand('honeygui.openDesigner', async () => {
            try {
                logger.info('执行命令: honeygui.openDesigner');
                const active = vscode.window.activeTextEditor;
                if (!active || !active.document.fileName.endsWith('.hml')) {
                    vscode.window.showWarningMessage(vscode.l10n.t('Please open an HML file in text editor first'));
                    return;
                }
                await vscode.commands.executeCommand(
                    'vscode.openWith',
                    active.document.uri,
                    'honeygui.hmlEditor'
                );
            } catch (error) {
                logger.error(`打开设计器失败: ${error instanceof Error ? error.message : String(error)}`);
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to open designer: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
            }
        });

        // 代码生成命令（从当前设计器面板触发）
        this.registerCommand('honeygui.codegen', async () => {
            try {
                logger.info('执行命令: honeygui.codegen');
                const panel = DesignerPanel.currentPanel;
                if (!panel) {
                    vscode.window.showWarningMessage(vscode.l10n.t('Please open HoneyGUI designer first'));
                    return;
                }
                await panel.generateCode();
            } catch (error) {
                logger.error(`代码生成失败: ${error instanceof Error ? error.message : String(error)}`);
                vscode.window.showErrorMessage(vscode.l10n.t('Code generation failed: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
            }
        });

        // 切换视图
        this.registerCommand('honeygui.switchView', async () => {
            try {
                logger.info('执行命令: honeygui.switchView');
                vscode.window.showInformationMessage(vscode.l10n.t('View switch feature is under development...'));
            } catch (error) {
                logger.error(`视图切换失败: ${error instanceof Error ? error.message : String(error)}`);
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to switch view: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
            }
        });

        // 创建新的设计稿
        this.registerCommand('honeygui.createNewHmlInWorkspace', async () => {
            try {
                logger.info('执行命令: honeygui.createNewHmlInWorkspace');
                
                // 获取工作区文件夹
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders || workspaceFolders.length === 0) {
                    vscode.window.showErrorMessage(vscode.l10n.t('Please open a workspace first'));
                    return;
                }
                
                const workspaceRoot = workspaceFolders[0].uri.fsPath;
                
                // 检查是否为 HoneyGUI 项目
                const projectJsonPath = path.join(workspaceRoot, 'project.json');
                if (!fs.existsSync(projectJsonPath)) {
                    const action = await vscode.window.showWarningMessage(
                        vscode.l10n.t('Not a HoneyGUI project. Please create a project first.'),
                        vscode.l10n.t('Create Project')
                    );
                    if (action === vscode.l10n.t('Create Project')) {
                        await vscode.commands.executeCommand('honeygui.newProject');
                    }
                    return;
                }
                
                // 验证项目类型
                try {
                    const projectConfigContent = fs.readFileSync(projectJsonPath, 'utf8');
                    const projectConfig = JSON.parse(projectConfigContent);
                    
                    if (projectConfig.type !== 'Designer' && projectConfig.$schema !== 'HoneyGUI') {
                        const action = await vscode.window.showWarningMessage(
                            vscode.l10n.t('Not a HoneyGUI project. Please create a project first.'),
                            vscode.l10n.t('Create Project')
                        );
                        if (action === vscode.l10n.t('Create Project')) {
                            await vscode.commands.executeCommand('honeygui.newProject');
                        }
                        return;
                    }
                } catch (error) {
                    logger.warn(`无法验证项目类型: ${error}`);
                    // 如果解析失败，继续执行（向后兼容旧项目）
                }
                
                // 使用第一个工作区的ui目录
                const uiDir = path.join(workspaceRoot, 'ui');
                
                // 确保ui目录存在
                if (!fs.existsSync(uiDir)) {
                    fs.mkdirSync(uiDir, { recursive: true });
                }
                
                // 输入设计稿名称
                const designName = await vscode.window.showInputBox({
                    prompt: vscode.l10n.t('Enter design name'),
                    placeHolder: 'untitled',
                    value: 'untitled',
                    validateInput: (value) => {
                        if (!value.trim()) return vscode.l10n.t('Design name cannot be empty');
                        // 必须是合法的 C 变量名（字母或下划线开头）
                        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
                            return vscode.l10n.t('Name can only contain letters, numbers, underscores, and must start with a letter or underscore');
                        }
                        const targetFile = path.join(uiDir, `${value}.hml`);
                        if (fs.existsSync(targetFile)) return vscode.l10n.t('Design file already exists');
                        return null;
                    }
                });
                
                if (designName) {
                    // 读取项目配置
                    const projectConfig = ProjectUtils.loadProjectConfig(workspaceRoot);
                    const resolution = projectConfig.resolution || '480X272';
                    
                    // 创建HML文件（直接放在 ui/ 目录下）
                    const hmlFilePath = path.join(uiDir, `${designName}.hml`);
                    
                    // 检查文件是否已存在
                    if (fs.existsSync(hmlFilePath)) {
                        vscode.window.showErrorMessage(vscode.l10n.t('File already exists: {0}', `${designName}.hml`));
                        return;
                    }
                    
                    // 使用 HmlTemplateManager 生成内容
                    const defaultContent = HmlTemplateManager.generateMainHml(
                        designName,
                        resolution,
                        projectConfig.appId,
                        projectConfig.minSdk,
                        projectConfig.pixelMode
                    );
                    
                    fs.writeFileSync(hmlFilePath, defaultContent, 'utf8');
                    
                    // 在设计器中打开新创建的文件
                    await vscode.commands.executeCommand('honeygui.openInDesigner', vscode.Uri.file(hmlFilePath));
                    
                    vscode.window.showInformationMessage(vscode.l10n.t('Design created: {0}', designName));
                }
            } catch (error) {
                logger.error(`创建设计稿失败: ${error instanceof Error ? error.message : String(error)}`);
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to create design: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
            }
        });

        // 打开项目
        this.registerCommand('honeygui.openProject', async () => {
            try {
                logger.info('执行命令: honeygui.openProject');
                const options: vscode.OpenDialogOptions = {
                    canSelectFolders: true,
                    canSelectFiles: false,
                    canSelectMany: false,
                    openLabel: vscode.l10n.t('Select project folder')
                };
                
                const folderUri = await vscode.window.showOpenDialog(options);
                if (folderUri && folderUri.length > 0) {
                    const projectPath = folderUri[0].fsPath;
                    logger.info(`打开项目文件夹: ${projectPath}`);
                    
                    // 设置待激活标记，以便重新加载后打开主 HML 文件
                    await this.context.globalState.update('pendingProjectActivation', {
                        projectPath: projectPath,
                        projectName: path.basename(projectPath),
                        timestamp: Date.now()
                    });
                    
                    // Force open in current window using boolean flag (false = reuse window)
                    await vscode.commands.executeCommand('vscode.openFolder', folderUri[0], false);
                }
            } catch (error) {
                logger.error(`打开项目失败: ${error instanceof Error ? error.message : String(error)}`);
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to open project: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
            }
        });

        // 启动项目
        this.registerCommand('honeygui.startProject', async () => {
            try {
                logger.info('执行命令: honeygui.startProject');
                vscode.window.showInformationMessage(vscode.l10n.t('Project start feature is under development...'));
            } catch (error) {
                logger.error(`启动项目失败: ${error instanceof Error ? error.message : String(error)}`);
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to start project: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
            }
        });

        // 停止项目
        this.registerCommand('honeygui.stopProject', async () => {
            try {
                logger.info('执行命令: honeygui.stopProject');
                vscode.window.showInformationMessage(vscode.l10n.t('Project stop feature is under development...'));
            } catch (error) {
                logger.error(`停止项目失败: ${error instanceof Error ? error.message : String(error)}`);
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to stop project: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
            }
        });

        // 重启项目
        this.registerCommand('honeygui.restartProject', async () => {
            try {
                logger.info('执行命令: honeygui.restartProject');
                vscode.window.showInformationMessage(vscode.l10n.t('Project restart feature is under development...'));
            } catch (error) {
                logger.error(`重启项目失败: ${error instanceof Error ? error.message : String(error)}`);
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to restart project: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
            }
        });

        // 切换编辑器模式（备用方案）
        this.registerCommand('honeygui.toggleEditor', async () => {
            try {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    vscode.window.showWarningMessage(vscode.l10n.t('Please open a file first'));
                    return;
                }
                
                const currentUri = activeEditor.document.uri;
                if (!currentUri.fsPath.endsWith('.hml')) {
                    vscode.window.showWarningMessage(vscode.l10n.t('Can only switch editor mode on HML files'));
                    return;
                }
                
                logger.info(`执行命令: honeygui.toggleEditor, URI: ${currentUri.fsPath}`);
                
                // 关闭当前编辑器
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                
                // 延迟一下确保编辑器已关闭
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // 使用自定义编辑器打开
                await vscode.commands.executeCommand(
                    'vscode.openWith',
                    currentUri,
                    'honeygui.hmlEditor'
                );
                
                logger.info(`编辑器切换成功: ${currentUri.fsPath}`);
            } catch (error) {
                logger.error(`编辑器切换失败: ${error instanceof Error ? error.message : String(error)}`);
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to switch editor: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
            }
        });

        logger.info('命令注册完成');
    }

    /**
     * 注册单个命令的辅助方法
     */
    private registerCommand(commandId: string, callback: (...args: any[]) => any): void {
        const disposable = vscode.commands.registerCommand(commandId, callback);
        this.disposables.push(disposable);
        this.context.subscriptions.push(disposable);
    }

    /**
     * 保留 VS Code 资源管理器上下键移动焦点的行为，并在移动后立即打开焦点项。
     */
    private async focusExplorerItemAndOpen(direction: 'up' | 'down'): Promise<void> {
        const focusCommand = direction === 'down' ? 'list.focusDown' : 'list.focusUp';

        try {
            await vscode.commands.executeCommand(focusCommand);
            await new Promise(resolve => setTimeout(resolve, 30));
            await vscode.commands.executeCommand('list.select');
            await new Promise(resolve => setTimeout(resolve, 80));
            await vscode.commands.executeCommand('workbench.files.action.focusFilesExplorer');
        } catch (error) {
            logger.warn(`资源管理器键盘预览失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 获取欢迎页面HTML
     */
    private getWelcomeHtml(): string {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>HoneyGUI 欢迎</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.6;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        h1 {
            color: var(--vscode-textLink-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 10px;
        }
        .feature {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            padding: 15px;
            margin: 15px 0;
            border-radius: 5px;
            border-left: 4px solid var(--vscode-textLink-foreground);
        }
        .feature h3 {
            margin-top: 0;
            color: var(--vscode-textLink-foreground);
        }
        .button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 3px;
            cursor: pointer;
            margin: 5px;
        }
        .button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .code {
            background-color: var(--vscode-textPreformat-background);
            padding: 2px 4px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🍯 HoneyGUI 设计器</h1>
        <p>欢迎使用 HoneyGUI - 专为嵌入式GUI开发设计的可视化设计工具</p>
        
        <div class="feature">
            <h3>🎨 可视化设计</h3>
            <p>拖拽式界面设计，实时预览，让GUI开发变得简单直观</p>
        </div>
        
        <div class="feature">
            <h3>📱 专为嵌入式优化</h3>
            <p>针对HoneyGUI框架优化，生成高效的C++代码</p>
        </div>
        
        <div class="feature">
            <h3>⚡ 快速开始</h3>
            <p>使用命令面板 <span class="code">Ctrl+Shift+P</span> 搜索 <span class="code">HoneyGUI</span> 开始创建项目</p>
        </div>
        
        <div class="feature">
            <h3>📖 文档与支持</h3>
            <p>查看文档了解更多功能和使用技巧</p>
        </div>
        
        <button class="button" onclick="vscode.postMessage({command: 'createProject'})">创建新项目</button>
        <button class="button" onclick="vscode.postMessage({command: 'openDocumentation'})">查看文档</button>
    </div>
</body>
</html>`;
    }

    /**
     * 清理资源
     */
    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
        this.disposables = [];
    }
}
