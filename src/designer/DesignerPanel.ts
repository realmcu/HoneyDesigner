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

/**
 * 设计器Webview面板管理类
 */
export class DesignerPanel {
    /** @deprecated Use panelRegistry instead for multi-file support */
    public static currentPanel: DesignerPanel | undefined;
    /** Registry of all active panels by file path */
    private static panelRegistry: Map<string, DesignerPanel> = new Map();
    public static readonly viewType = 'honeyguiDesigner';

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
     * 获取指定文件路径的面板
     */
    public static getPanel(filePath: string): DesignerPanel | undefined {
        return DesignerPanel.panelRegistry.get(filePath);
    }

    /**
     * 注册面板到 registry
     */
    public static registerPanel(filePath: string, panel: DesignerPanel): void {
        DesignerPanel.panelRegistry.set(filePath, panel);
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
            this._collaborationController.stop();
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
        // 从 registry 中移除
        const filePath = this._fileManager.currentFilePath;
        if (filePath) {
            DesignerPanel.panelRegistry.delete(filePath);
        }
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
