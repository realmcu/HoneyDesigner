import * as vscode from 'vscode';
import { logger } from '../utils/Logger';
import { HmlController } from '../hml/HmlController';
import { SaveManager } from './SaveManager';
import { AssetManager } from './AssetManager';
import { CodeGenerator } from '../services/CodeGenerator';
import { ComponentManager } from './ComponentManager';
import { FileManager } from './FileManager';
import { MessageHandler } from './MessageHandler';
import { CodeGenOptions } from '../codegen/ICodeGenerator';
import { WebviewContentProvider } from './WebviewContentProvider';
import { DesignerService } from './DesignerService';
import { ProjectUtils } from '../utils/ProjectUtils';
import { CodeGenerationService } from '../services/CodeGenerationService';
import { PendingWriteRegistry } from './PendingWriteRegistry';

/**
 * 设计器Webview面板管理类
 */
export class DesignerPanel {
    /** @deprecated Use panelRegistry instead for multi-file support */
    public static currentPanel: DesignerPanel | undefined;
    /**
     * 「规范化文件路径 → 面板」索引。
     * 键统一用 PendingWriteRegistry.normalizePathKey 规范化；由面板在
     * 创建/切换文件/dispose 时经 _syncPanelRegistry 自动维护。
     * 注：同一文件被分屏打开成多个自定义编辑器时后注册者覆盖前者（记录最近一个）。
     */
    private static panelRegistry: Map<string, DesignerPanel> = new Map();
    public static readonly viewType = 'honeyguiDesigner';

    /** 本面板当前在 panelRegistry 中占用的键（规范化路径），无文件时为 undefined */
    private _registeredPathKey: string | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _context: vscode.ExtensionContext;
    private _disposables: vscode.Disposable[] = [];
    
    // Managers
    private readonly _hmlController: HmlController;
    private readonly _saveManager: SaveManager;
    private readonly _assetManager: AssetManager;
    private readonly _codeGenerator: CodeGenerator;
    private readonly _componentManager: ComponentManager;
    private readonly _fileManager: FileManager;
    private readonly _messageHandler: MessageHandler;
    private readonly _webviewContentProvider: WebviewContentProvider;
    /**
     * 获取当前的保存事务ID
     * @returns 当前事务ID（0表示没有正在进行的保存操作）
     */
    public getSaveTransactionId(): number {
        return this._saveManager.getCurrentTransactionId();
    }


    /**
     * 判断是否正在保存
     */
    public get isSaving(): boolean {
        return this._saveManager.isInTransaction();
    }

    /**
     * 获取当前打开指定文件的面板（路径经规范化比较）
     */
    public static getPanel(filePath: string): DesignerPanel | undefined {
        return DesignerPanel.panelRegistry.get(PendingWriteRegistry.normalizePathKey(filePath));
    }

    /**
     * 静态查询：此文件是否被某个设计器面板打开且有未保存改动（webview store 内存态）。
     * 供写事务（T10）前置校验使用——设计器编辑对 TextDocument dirty 检测不可见。
     */
    public static isFileOpenWithUnsavedChanges(filePath: string): boolean {
        const panel = DesignerPanel.getPanel(filePath);
        return !!panel && panel.hasUnsavedWebviewChanges;
    }

    /** 本面板 webview 是否有未保存改动（缓存自 dirtyStateChanged 消息） */
    public get hasUnsavedWebviewChanges(): boolean {
        return this._fileManager.hasUnsavedWebviewChanges;
    }

    /**
     * 维护「规范化文件路径 → 面板」索引：面板创建（带文件）/切换文件/dispose 时调用。
     * 传 undefined 表示本面板不再关联任何文件（新建空白文档或 dispose）。
     */
    private _syncPanelRegistry(filePath: string | undefined): void {
        const newKey = filePath ? PendingWriteRegistry.normalizePathKey(filePath) : undefined;
        if (this._registeredPathKey === newKey) {
            return;
        }
        // 只删除仍指向自己的旧条目（避免误删后来居上的其他面板）
        if (this._registeredPathKey && DesignerPanel.panelRegistry.get(this._registeredPathKey) === this) {
            DesignerPanel.panelRegistry.delete(this._registeredPathKey);
        }
        if (newKey) {
            DesignerPanel.panelRegistry.set(newKey, this);
        }
        this._registeredPathKey = newKey;
    }

    /**
     * 显示面板
     */
    public reveal(column?: vscode.ViewColumn): void {
        this._panel.reveal(column);
    }

    /**
     * 从 TextDocument 构造（用于 CustomTextEditorProvider）
     */
    public constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, document?: vscode.TextDocument) {
        this._panel = panel;
        this._extensionUri = context.extensionUri;
        this._context = context;
        
        // Initialize Core Controllers - each panel gets its own HmlController
        // to support multiple files being edited simultaneously
        this._hmlController = DesignerService.getInstance().createHmlController();
        this._saveManager = new SaveManager(this._hmlController);
        
        // Initialize Managers
        this._assetManager = new AssetManager(panel);
        this._codeGenerator = new CodeGenerator();
        this._componentManager = new ComponentManager(panel, this._hmlController);
        this._fileManager = new FileManager(panel, this._hmlController, this._saveManager);
        
        // Initialize Message Handler
        this._messageHandler = new MessageHandler(
            panel,
            this._assetManager,
            this._codeGenerator,
            this._componentManager,
            this._fileManager,
            this._hmlController
        );

        // Initialize WebviewContentProvider
        this._webviewContentProvider = new WebviewContentProvider(context.extensionUri);
        
        // 文件路径变化（创建加载/另存为/新建空白）时维护「路径 → 面板」索引
        this._disposables.push(
            this._fileManager.onDidChangeFilePath(filePath => this._syncPanelRegistry(filePath))
        );

        // 如果有文档，设置文件路径
        if (document) {
            this._fileManager.currentFilePath = document.uri.fsPath;
        }

        // 监听文件管理器的标题更新事件
        this._fileManager.onDidUpdateTitle(title => {
            this._panel.title = title;
        });

        // 设置Webview内容
        this._update();

        // 处理面板关闭事件
        this._panel.onDidDispose(() => {
            this.dispose();
        }, null, this._disposables);

        // 处理面板可见性变化
        // 注意：不再调用 _update()，避免每次切换标签页时重新设置 HTML 导致闪烁
        this._panel.onDidChangeViewState(
            () => {
                if (this._panel.visible) {
                    DesignerPanel.currentPanel = this;
                    // 面板重新获得焦点时，刷新其他文件的组件 ID 列表（跨文件命名去重）
                    this._fileManager.refreshOtherFileComponentIds();
                }
            },
            null,
            this._disposables
        );

        // 处理来自Webview的消息
        this._panel.webview.onDidReceiveMessage(
            message => this._messageHandler.handleMessage(message),
            null,
            this._disposables
        );
    }

    /**
     * 更新Webview内容
     */
    private _update(): void {
        const webview = this._panel.webview;
        this._panel.webview.html = this._webviewContentProvider.getHtmlForWebview(webview);
    }
    
    /**
     * 创建新的空白文档
     */
    public createNewDocument(): void {
        this._fileManager.createNewDocument();
    }

    /**
     * 从 TextDocument 加载内容（用于 CustomTextEditorProvider）
     */
    public async loadFromDocument(document: vscode.TextDocument): Promise<void> {
        await this._fileManager.loadFromDocument(document);
    }

    /**
     * 从文档更新内容（当文档在外部被修改时）
     */
    public async updateFromDocument(): Promise<void> {
        await this._fileManager.updateFromDocument();
    }

    /**
     * 生成代码
     */
    public async generateCode(): Promise<void> {
        await CodeGenerationService.generateFromFile(this._fileManager.currentFilePath, this._codeGenerator);
    }

    /**
     * 获取当前的HML文档
     */
    public get currentDocument() {
        return this._hmlController.currentDocument;
    }
    
    /**
     * 获取当前的文件路径
     */
    public get currentFilePath() {
        return this._fileManager.currentFilePath;
    }
    
    /**
     * 向Webview发送消息
     */
    public sendMessage(command: string, data?: any): void {
        this._panel.webview.postMessage({ command, ...data });
    }
    
    /**
     * 重新加载当前文档
     */
    public reloadCurrentDocument(): void {
        this._fileManager.reloadCurrentDocument();
    }
    
    public dispose(): void {
        // 从「路径 → 面板」索引中移除自己
        this._syncPanelRegistry(undefined);
        DesignerPanel.currentPanel = undefined;

        // 清理 project.json watcher
        this._fileManager.disposeProjectConfigWatcher();

        // 清理所有监听器
        this._disposables.forEach(d => d.dispose());

        // 清理保存管理器
        this._saveManager.dispose();

        // 清理消息处理器
        this._messageHandler.dispose();

        // 清理资源管理器
        this._assetManager.dispose();

        // 销毁面板
        this._panel.dispose();

        logger.info('[DesignerPanel] DesignerPanel 已销毁');
    }
}
