import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../utils/Logger';
import type { Component } from '../hml/types';
import { getSupportedEvents } from '../hml/eventTypes';
import type { EventType } from '../hml/eventTypes';
import { ProjectUtils } from '../utils/ProjectUtils';
import { HmlController } from '../hml/HmlController';
import { ProjectConfigLoader } from '../utils/ProjectConfigLoader';
import { SaveManager } from './SaveManager';
import { HmlContentComparator } from '../utils/HmlContentComparator';
import { GuiVersionReader } from '../utils/GuiVersionReader';
import { createEmptyCatalog } from '../project-i18n/catalog';
import { loadProjectI18nCatalog, PROJECT_I18N_RELATIVE_PATH } from '../project-i18n/files';
import { PendingWriteRegistry } from './PendingWriteRegistry';
import { scanAllViews, scanAllHmlFiles, scanProjectHml, normalizeHmlFilePath, buildComponentIndex } from './navGraphScanner';
import type { ProjectConfig } from '../common/ProjectConfig';
import type { HmlLoadPerformanceContext } from './HmlLoadPerformance';
import { measurePerformance } from './HmlLoadPerformance';
import { performance } from 'perf_hooks';

// 视图跳转边（导航图数据模型）迁至 src/shared/navContract.ts 并改判别联合
// （评审 I6：control 可编辑 / timer 只读）。此处 re-export 保持既有 import 路径不变。
export type { ViewNavEdge } from '../shared/navContract';

// 导航图扫描（边采集 / 跨文件 target 解析）纯逻辑抽至 ./navGraphScanner（评审 I8：
// vscode-free，可 jest fixtures 直测）。ViewNavNode 定义随之迁移，此处 re-export 保持既有引用。
export type { ViewNavNode } from './navGraphScanner';

/**
 * 单个 view 下可交互控件的枚举描述（T9 getViewControls）
 * 与 src/webview/types.ts 的 ViewControlInfo 保持同步。
 */
export interface ViewControlInfo {
    id: string;
    name: string;
    type: string;
    /** 该组件类型支持的事件（COMPONENT_SUPPORTED_EVENTS/DEFAULT_SUPPORTED_EVENTS） */
    supportedEvents: EventType[];
    /** 已配置 switchView action 的事件类型（新建跳转时据此禁用已占用事件） */
    occupiedSwitchViewEvents: EventType[];
    /** true = 该项是 view 自身（屏手势跳转），非后代控件 */
    sourceIsView: boolean;
}

/**
 * 文件管理器 - 处理文件的加载、保存和更新
 */
export class FileManager {
    private readonly _panel: vscode.WebviewPanel;
    private readonly _hmlController: HmlController;
    private readonly _saveManager: SaveManager;
    private readonly _performanceContext: HmlLoadPerformanceContext | undefined;
    private _filePath: string | undefined;
    private _lastSerializedSnapshot: string | null = null;
    private _preparedFrontendComponents: {
        filePath: string;
        document: unknown;
        components: Component[];
    } | undefined;
    
    // 撤销/重做历史栈
    private _undoStack: string[] = [];
    private _redoStack: string[] = [];
    private readonly _maxHistorySize = 50;
    private _isInUndoRedo = false;
    private _lastUndoPushTime = 0;
    private readonly _undoDebounceMs = 500; // 连续操作合并窗口
    
    // 事件发射器
    private readonly _onDidUpdateTitle = new vscode.EventEmitter<string>();
    private readonly _onDidChangeFilePath = new vscode.EventEmitter<string | undefined>();

    // 事件
    public readonly onDidUpdateTitle = this._onDidUpdateTitle.event;
    /** 当前文件路径变化（面板创建加载 / 另存为 / 新建空白文档），DesignerPanel 据此维护路径→面板索引 */
    public readonly onDidChangeFilePath = this._onDidChangeFilePath.event;

    // webview（Zustand store）侧的未保存改动状态。
    // 设计器编辑只存在于 webview store 中、显式保存才落盘，对 TextDocument
    // dirty 检测不可见（设计文档约束 5），因此由 webview 在脏状态变化时发
    // dirtyStateChanged 消息、宿主在此缓存，供写事务前置校验查询。
    private _webviewDirty = false;
    // 单调递增序号：防止「保存进行中又产生新改动」时，保存成功回调把新改动的
    // dirty 标记误清掉（保存开始时记录序号，成功后仅在序号未变时清除）。
    private _webviewDirtySeq = 0;

    // project.json 文件监听器
    private _projectConfigWatcher: vscode.FileSystemWatcher | undefined;

    // i18n/strings.json 文件监听器
    private _i18nCatalogWatcher: vscode.FileSystemWatcher | undefined;

    constructor(
        panel: vscode.WebviewPanel,
        hmlController: HmlController,
        saveManager: SaveManager,
        performanceContext?: HmlLoadPerformanceContext
    ) {
        this._panel = panel;
        this._hmlController = hmlController;
        this._saveManager = saveManager;
        this._performanceContext = performanceContext;
    }

    public recordWebviewReady(webviewMetrics?: Record<string, unknown>): void {
        if (this._performanceContext?.htmlCompletedAt === undefined) {
            return;
        }

        this._performanceContext.metrics.webviewBootMs =
            performance.now() - this._performanceContext.htmlCompletedAt;

        const metricNames = [
            'webviewResourceLoadMs',
            'webviewScriptLoadMs',
            'webviewScriptEvaluateMs',
            'webviewReactMountMs',
            'webviewReadyDispatchMs',
        ] as const;
        for (const name of metricNames) {
            const value = webviewMetrics?.[name];
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
                this._performanceContext.metrics[name] = value;
            }
        }
    }

    public recordProjectConfigDuration(durationMs: number): void {
        if (this._performanceContext) {
            this._performanceContext.metrics.projectConfigMs = durationMs;
        }
    }

    /**
     * 启动对 project.json 的监听，文件变化时自动推送新配置给前端
     */
    private _setupProjectConfigWatcher(filePath: string): void {
        // 清理旧的 watcher
        this._projectConfigWatcher?.dispose();

        const projectRoot = ProjectUtils.findProjectRoot(filePath);
        if (!projectRoot) { return; }

        const projectJsonPath = path.join(projectRoot, 'project.json');
        const pattern = new vscode.RelativePattern(projectRoot, 'project.json');
        this._projectConfigWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        // 记录上一次的 resolution，用于判断是否变化
        let lastResolution: string | undefined;
        try {
            const initial = ProjectConfigLoader.loadConfig(filePath);
            lastResolution = initial?.resolution;
        } catch { /* ignore */ }

        const onChanged = () => {
            // 清除缓存，确保下次读取最新内容
            ProjectConfigLoader.clearCache();
            const newConfig = ProjectConfigLoader.loadConfig(filePath);
            if (newConfig) {
                logger.info(`[FileManager] project.json 变化，推送新配置给前端: ${projectJsonPath}`);
                this._panel.webview.postMessage({
                    command: 'updateProjectConfig',
                    projectConfig: newConfig
                });

                // 如果 resolution 发生变化，批量更新所有 HML 文件中的 hg_view 尺寸
                // （含当前文件，统一由后端落盘，不再依赖前端 save）
                if (newConfig.resolution && newConfig.resolution !== lastResolution) {
                    lastResolution = newConfig.resolution;
                    void this._syncAllViewSizes(filePath, newConfig.resolution).catch(err =>
                        logger.warn(`[FileManager] 同步 hg_view 尺寸失败: ${err}`));
                }
            }
        };

        this._projectConfigWatcher.onDidChange(onChanged);
        this._projectConfigWatcher.onDidCreate(onChanged);
    }

    /**
     * 启动对 i18n/strings.json 的监听，文件在 webview 之外被改动时（例如 Agent 直接写盘、
     * git 操作、手工编辑）自动推送最新 catalog 给前端，避免前端内存里的旧 catalog 在下一次
     * 保存时把外部改动整份覆盖掉。
     */
    private _setupI18nCatalogWatcher(filePath: string): void {
        // 清理旧的 watcher
        this._i18nCatalogWatcher?.dispose();

        const projectRoot = ProjectUtils.findProjectRoot(filePath);
        if (!projectRoot) { return; }

        const catalogPath = path.join(projectRoot, PROJECT_I18N_RELATIVE_PATH);
        const pattern = new vscode.RelativePattern(projectRoot, 'i18n/strings.json');
        this._i18nCatalogWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        const onChanged = () => {
            // 命中「预期写入登记」：本次磁盘变化是 MessageHandler 保存 catalog 时自己写入的，
            // 跳过重推（webview 已经在保存发起时就有最新数据了）。若登记之后磁盘又被外部方
            // 改写（hash 不一致），consumeIfPending 会照常放行，不会吞掉外部改动。
            if (PendingWriteRegistry.getInstance().consumeIfPending(catalogPath)) {
                logger.debug(`[FileManager] i18n/strings.json: 命中预期写入登记，跳过本次重推: ${catalogPath}`);
                return;
            }

            const catalog = loadProjectI18nCatalog(projectRoot);
            logger.info(`[FileManager] i18n/strings.json 外部变化，推送新 catalog 给前端: ${catalogPath}`);
            // 复用 saveProjectI18nCatalog 保存成功后的回显消息：前端只会 setProjectI18nCatalog（纯本地
            // 状态更新），不会触发二次保存，不会和这次外部改动形成回环。
            this._panel.webview.postMessage({
                command: 'projectI18nCatalogSaved',
                projectI18nCatalog: catalog
            });
        };

        this._i18nCatalogWatcher.onDidChange(onChanged);
        this._i18nCatalogWatcher.onDidCreate(onChanged);
    }

    /**
     * 批量更新项目所有 HML 文件中 hg_view 的尺寸
     */
    private async _syncAllViewSizes(currentFilePath: string, resolution: string): Promise<void> {
        const { width, height } = ProjectUtils.parseResolution(resolution);
        if (!width || !height) { return; }

        const hmlFiles = scanAllHmlFiles(currentFilePath);
        logger.info(`[FileManager] 同步 hg_view 尺寸 ${width}x${height}，共 ${hmlFiles.length} 个 HML 文件`);

        for (const hmlFile of hmlFiles) {
            try {
                const content = fs.readFileSync(hmlFile.path, 'utf-8');
                const controller = new HmlController();
                const doc = controller.parseContent(content, hmlFile.path);

                // 找到所有 hg_view 并更新尺寸
                const views = doc.view?.components?.filter((c: any) => c.type === 'hg_view') || [];
                if (views.length === 0) { continue; }

                let changed = false;
                for (const view of views) {
                    if (view.position.width !== width || view.position.height !== height) {
                        view.position.width = width;
                        view.position.height = height;
                        changed = true;
                    }
                }

                if (!changed) { continue; }

                const newContent = controller.serializeDocument();

                // 当前文件在 VSCode 中有活跃的 TextDocument，必须通过 TextDocument API 写入，
                // 否则磁盘与文档版本不同步会触发 "content is newer" 冲突（参见 _writeViaTextDocument）。
                // 其余文件无活跃文档，直接写盘即可。
                if (path.resolve(hmlFile.path) === path.resolve(currentFilePath)) {
                    await this._writeViaTextDocument(hmlFile.path, newContent);
                } else {
                    fs.writeFileSync(hmlFile.path, newContent, 'utf-8');
                }
                logger.info(`[FileManager] 已更新 hg_view 尺寸: ${hmlFile.path}`);
            } catch (err) {
                logger.warn(`[FileManager] 更新 hg_view 尺寸失败 ${hmlFile.path}: ${err}`);
            }
        }
    }

    /**
     * 释放 project.json watcher
     */
    public disposeProjectConfigWatcher(): void {
        this._projectConfigWatcher?.dispose();
        this._projectConfigWatcher = undefined;
    }

    /**
     * 释放 i18n/strings.json watcher
     */
    public disposeI18nCatalogWatcher(): void {
        this._i18nCatalogWatcher?.dispose();
        this._i18nCatalogWatcher = undefined;
    }

    public get currentFilePath(): string | undefined {
        return this._filePath;
    }

    public set currentFilePath(path: string | undefined) {
        this._setFilePath(path);
    }

    /**
     * 统一的文件路径赋值入口：路径变化时触发 onDidChangeFilePath
     * （所有 _filePath 赋值必须经此，保证面板路径索引不漏更新）
     */
    private _setFilePath(filePath: string | undefined): void {
        if (this._filePath === filePath) {
            return;
        }
        this._preparedFrontendComponents = undefined;
        this._filePath = filePath;
        this._onDidChangeFilePath.fire(filePath);
    }

    private _prepareFrontendComponents(hmlDocument: unknown): Component[] {
        const filePath = this._filePath;
        const cached = this._preparedFrontendComponents;
        if (filePath && cached && cached.filePath === filePath && cached.document === hmlDocument) {
            return cached.components;
        }

        const components = this._hmlController.prepareComponentsForFrontend(hmlDocument as Parameters<HmlController['prepareComponentsForFrontend']>[0]);
        if (this._performanceContext) {
            this._performanceContext.metrics.prepareFrontendCalls =
                (this._performanceContext.metrics.prepareFrontendCalls || 0) + 1;
        }
        if (filePath) {
            this._preparedFrontendComponents = { filePath, document: hmlDocument, components };
        }
        return components;
    }

    /** webview 是否有未保存改动（缓存自 dirtyStateChanged 消息） */
    public get hasUnsavedWebviewChanges(): boolean {
        return this._webviewDirty;
    }

    /** 由 MessageHandler 在收到 dirtyStateChanged 消息时调用 */
    public setWebviewDirty(dirty: boolean): void {
        if (dirty) {
            this._webviewDirty = true;
            this._webviewDirtySeq++;
        } else {
            this._webviewDirty = false;
        }
        logger.debug(`[FileManager] webview dirty 状态: ${this._webviewDirty} (seq=${this._webviewDirtySeq})`);
    }

    /** 当前 dirty 序号（保存开始前记录，配合 clearWebviewDirtyIfUnchanged 使用） */
    public get webviewDirtySeq(): number {
        return this._webviewDirtySeq;
    }

    /**
     * 保存成功后清除 webview dirty 缓存——仅在保存期间没有新改动到达
     * （dirty 序号未变）时清除，防止把保存内容之外的新改动标记误清
     */
    public clearWebviewDirtyIfUnchanged(seqAtSaveStart: number): void {
        if (this._webviewDirtySeq === seqAtSaveStart) {
            this._webviewDirty = false;
        }
    }

    /**
     * 刷新其他 HML 文件的组件 ID 列表并发送给前端
     * 当面板重新获得焦点时调用，确保跨文件命名去重数据是最新的
     */
    public async refreshOtherFileComponentIds(): Promise<void> {
        if (!this._filePath) return;
        try {
            const scanResult = await scanProjectHml(this._filePath);
            const currentNorm = normalizeHmlFilePath(this._filePath);
            const otherFileComponentIds = [...scanResult.componentIdsByFile.entries()]
                .filter(([filePath]) => filePath !== currentNorm)
                .flatMap(([, componentIds]) => componentIds);
            logger.debug(`[FileManager] 刷新跨文件组件 ID: ${otherFileComponentIds.length} 个`);
            this._panel.webview.postMessage({
                command: 'updateOtherFileComponentIds',
                otherFileComponentIds
            });
        } catch (error) {
            logger.warn(`[FileManager] 刷新跨文件组件 ID 失败: ${error}`);
        }
    }
    
    /**
     * 重新扫描所有视图并更新前端
     * 在保存文件后调用，确保跳转界面的视图列表是最新的
     */
    public async updateAllViewsToFrontend(): Promise<void> {
        if (!this._filePath) return;
        try {
            const allViews = await scanAllViews(this._filePath);
            const allHmlFiles = scanAllHmlFiles(this._filePath);
            logger.debug(`[FileManager] 更新视图列表: ${allViews.length} 个视图, ${allHmlFiles.length} 个文件`);
            this._panel.webview.postMessage({
                command: 'updateAllViews',
                allViews,
                allHmlFiles
            });
        } catch (error) {
            logger.warn(`[FileManager] 更新视图列表失败: ${error}`);
        }
    }
    
    /**
     * 记录当前状态到撤销栈（在保存前调用）
     * 使用滑动窗口防抖：连续快速操作期间只记录首次状态，
     * 只有在操作间隔超过 500ms 后才创建新的撤销点
     */
    public pushUndoState(hmlContent: string): void {
        // 避免重复记录相同内容
        if (this._undoStack.length > 0 && this._undoStack[this._undoStack.length - 1] === hmlContent) {
            this._lastUndoPushTime = Date.now(); // 即使跳过也更新活动时间
            return;
        }
        
        const now = Date.now();
        const timeSinceLastActivity = now - this._lastUndoPushTime;
        this._lastUndoPushTime = now; // 每次活动都重置计时器（滑动窗口）
        
        // 连续操作合并：只有间隔超过 500ms 才创建新的撤销点
        if (timeSinceLastActivity < this._undoDebounceMs) {
            logger.debug('[FileManager] 跳过撤销记录（连续操作合并）');
            return;
        }
        
        this._undoStack.push(hmlContent);
        
        // 限制栈大小
        if (this._undoStack.length > this._maxHistorySize) {
            this._undoStack.shift();
        }
        
        // 新操作清空重做栈
        this._redoStack = [];
        
        logger.debug(`[FileManager] 记录撤销状态，当前栈深度: ${this._undoStack.length}`);
    }
    
    /**
     * 无防抖地记录一次撤销快照（导航写事务 T10 专用）。
     * pushUndoState 的 500ms 滑动窗口会把紧邻普通编辑的快照合并掉，
     * 而导航写事务要求"Ctrl+Z 恰好整步回退本次边编辑"，必须强制入栈。
     */
    public pushUndoSnapshotImmediate(hmlContent: string): void {
        if (this._undoStack.length > 0 && this._undoStack[this._undoStack.length - 1] === hmlContent) {
            return;
        }
        this._undoStack.push(hmlContent);
        if (this._undoStack.length > this._maxHistorySize) {
            this._undoStack.shift();
        }
        this._redoStack = [];
        this._lastUndoPushTime = Date.now();
        logger.debug(`[FileManager] 记录撤销快照（导航写事务），当前栈深度: ${this._undoStack.length}`);
    }

    /**
     * 用磁盘上的新内容同步本面板（导航写事务 T10 写盘后调用）。
     * 面板 watcher 回灌已被 PendingWriteRegistry 抑制，由写事务显式同步：
     * 解析新内容 → 推 loadHml；同时更新快照并复位 dirty 缓存
     * （写事务前置校验已保证本面板无未保存改动，覆盖是安全的）。
     */
    public async reloadFromContent(content: string): Promise<void> {
        if (!this._filePath) {
            return;
        }
        this.setWebviewDirty(false);
        this._hmlController.parseContent(content, this._filePath);
        this._lastSerializedSnapshot = content;
        await this.reloadCurrentDocument();
    }

    /**
     * 撤销
     */
    public async undo(): Promise<boolean> {
        if (this._undoStack.length === 0 || !this._filePath) {
            logger.debug('[FileManager] 无法撤销：栈为空或无文件');
            return false;
        }
        
        this._isInUndoRedo = true;
        try {
            // 读取当前文件内容作为重做状态
            const currentContent = fs.readFileSync(this._filePath, 'utf8');
            this._redoStack.push(currentContent);
            
            // 弹出上一个状态
            const previousContent = this._undoStack.pop()!;
            
            // 解析并更新 hmlController（与正常加载一致；传路径保证 fallback id 带种子）
            this._hmlController.parseContent(previousContent, this._filePath);
            
            // 通过 VSCode TextDocument API 写入，保持版本同步，防止 "content is newer" 冲突
            await this._writeViaTextDocument(this._filePath, previousContent);
            
            // 更新快照
            this._lastSerializedSnapshot = previousContent;
            
            // 重新加载到前端（此时 hmlController 已更新，reloadCurrentDocument 会发送正确数据）
            await this.reloadCurrentDocument();
            
            logger.info(`[FileManager] 撤销成功，剩余撤销栈: ${this._undoStack.length}`);
            return true;
        } catch (error) {
            logger.error(`[FileManager] 撤销失败: ${error}`);
            return false;
        } finally {
            this._isInUndoRedo = false;
        }
    }
    
    /**
     * 重做
     */
    public async redo(): Promise<boolean> {
        if (this._redoStack.length === 0 || !this._filePath) {
            logger.debug('[FileManager] 无法重做：栈为空或无文件');
            return false;
        }
        
        this._isInUndoRedo = true;
        try {
            // 读取当前文件内容作为撤销状态
            const currentContent = fs.readFileSync(this._filePath, 'utf8');
            this._undoStack.push(currentContent);
            
            // 弹出重做状态
            const nextContent = this._redoStack.pop()!;
            
            // 解析并更新 hmlController（传路径保证 fallback id 带种子）
            this._hmlController.parseContent(nextContent, this._filePath);
            
            // 通过 VSCode TextDocument API 写入，保持版本同步
            await this._writeViaTextDocument(this._filePath, nextContent);
            
            // 更新快照
            this._lastSerializedSnapshot = nextContent;
            
            // 重新加载到前端
            await this.reloadCurrentDocument();
            
            logger.info(`[FileManager] 重做成功，剩余重做栈: ${this._redoStack.length}`);
            return true;
        } catch (error) {
            logger.error(`[FileManager] 重做失败: ${error}`);
            return false;
        } finally {
            this._isInUndoRedo = false;
        }
    }
    
    /**
     * 通过 VSCode TextDocument API 写入文件
     * 使用 WorkspaceEdit + document.save() 替代直接 fs.writeFileSync()
     * 防止 TextDocument 版本与磁盘文件不同步导致的 "content is newer" 冲突
     */
    private async _writeViaTextDocument(filePath: string, content: string): Promise<void> {
        const transactionId = this._saveManager.beginTransaction(filePath, content);
        try {
            const uri = vscode.Uri.file(filePath);
            const doc = await vscode.workspace.openTextDocument(uri);
            const wsEdit = new vscode.WorkspaceEdit();
            wsEdit.replace(uri, new vscode.Range(
                doc.positionAt(0),
                doc.positionAt(doc.getText().length)
            ), content);
            await vscode.workspace.applyEdit(wsEdit);
            await doc.save();
        } finally {
            this._saveManager.endTransaction();
        }
    }
    
    /**
     * 检查是否可以撤销
     */
    public canUndo(): boolean {
        return this._undoStack.length > 0;
    }
    
    /**
     * 检查是否可以重做
     */
    public canRedo(): boolean {
        return this._redoStack.length > 0;
    }
    
    /**
     * 清空历史（切换文件时调用）
     */
    public clearHistory(): void {
        this._undoStack = [];
        this._redoStack = [];
        logger.debug('[FileManager] 清空撤销/重做历史');
    }
    
    /**
     * 发送撤销/重做状态到前端
     */
    public sendUndoRedoState(): void {
        this._panel.webview.postMessage({
            command: 'undoRedoState',
            canUndo: this.canUndo(),
            canRedo: this.canRedo()
        });
    }

    /**
     * 加载文件
     */

    // scanHmlFilesRecursive / scanAllHmlFiles / scanAllViews / buildComponentIndex 已抽至
    // ./navGraphScanner（评审 I8，vscode-free 可直测），本类改为直接调用导入的纯函数。

    /**
     * 给定 viewKey（relPath#viewId），返回该 view 下（剪枝到嵌套子屏前）
     * 可交互控件列表（含 view 自身，sourceIsView 语义 = 屏手势跳转）。
     * 复用 T2 scanAllViews 的 id→component / parent→children[] 索引遍历逻辑。
     * 找不到项目根目录 / 文件 / view 时返回 null。
     */
    public async getViewControls(viewKey: string): Promise<ViewControlInfo[] | null> {
        if (!this._filePath) {
            return null;
        }
        const projectRoot = ProjectUtils.findProjectRoot(this._filePath);
        if (!projectRoot) {
            return null;
        }

        const hashIndex = viewKey.indexOf('#');
        if (hashIndex < 0) {
            logger.warn(`[FileManager] getViewControls: 非法 viewKey（缺少 #）: ${viewKey}`);
            return null;
        }
        const fileRelative = viewKey.slice(0, hashIndex);
        const viewId = viewKey.slice(hashIndex + 1);
        if (!fileRelative || !viewId) {
            return null;
        }

        const absPath = path.join(projectRoot, ...fileRelative.split('/'));

        let components: Component[];
        try {
            const content = fs.readFileSync(absPath, 'utf-8');
            const tempController = new HmlController();
            const doc = tempController.parseContent(content, absPath);
            components = doc.view?.components || [];
        } catch (err) {
            logger.warn(`[FileManager] getViewControls: 读取/解析 ${absPath} 失败: ${err}`);
            return null;
        }

        const { byId, childrenOf } = buildComponentIndex(components);
        const viewComp = byId.get(viewId);
        if (!viewComp || viewComp.type !== 'hg_view') {
            logger.warn(`[FileManager] getViewControls: 未找到 view ${viewKey}`);
            return null;
        }

        const result: ViewControlInfo[] = [this._describeControl(viewComp, true)];

        // 后代控件，遇嵌套 hg_view 剪枝（子屏控件不属于本屏）
        const queue: Component[] = [...(childrenOf.get(viewComp.id) || [])];
        while (queue.length > 0) {
            const child = queue.shift()!;
            if (child.type === 'hg_view') {
                continue;
            }
            result.push(this._describeControl(child, false));
            queue.push(...(childrenOf.get(child.id) || []));
        }

        return result;
    }

    /**
     * 构造单个控件的枚举描述：支持事件（COMPONENT_SUPPORTED_EVENTS/DEFAULT_SUPPORTED_EVENTS）
     * + 已配置 switchView action 的事件类型列表（occupiedSwitchViewEvents）
     */
    private _describeControl(comp: Component, sourceIsView: boolean): ViewControlInfo {
        const supportedEvents = getSupportedEvents(comp.type);
        const occupiedSet = new Set<EventType>();
        for (const eventConfig of comp.eventConfigs || []) {
            const hasSwitchView = (eventConfig.actions || []).some(action => action.type === 'switchView');
            if (hasSwitchView) {
                occupiedSet.add(eventConfig.type);
            }
        }
        return {
            id: comp.id,
            name: comp.name || comp.id,
            type: comp.type,
            supportedEvents,
            occupiedSwitchViewEvents: [...occupiedSet],
            sourceIsView,
        };
    }

    // _collectComponentSwitchViewEdges / _buildNavEdge 已抽至 ./navGraphScanner（评审 I8）。

    /**
     * 创建新的空白文档
     */
    public createNewDocument(): void {
        try {
            // 创建新的HML文档
            const document = this._hmlController.createNewDocument();

            // 序列化文档为字符串
            const hmlContent = this._hmlController.serializeDocument();
            
            // 为前端准备组件数据
            const frontendComponents = this._hmlController.prepareComponentsForFrontend(document);

            // 使用统一的配置加载器
            const projectConfig = ProjectConfigLoader.loadConfig();
            const designerConfig = ProjectConfigLoader.getDesignerConfig(projectConfig);
            const projectI18nCatalog = createEmptyCatalog('en-US');
            
            // 发送HML内容和配置到Webview
            this._panel.webview.postMessage({
                command: 'loadHml',
                content: hmlContent,
                document: {
                    ...document,
                    view: {
                        ...document.view,
                        components: frontendComponents
                    }
                },
                components: frontendComponents,
                projectConfig: projectConfig,
                projectI18nCatalog: projectI18nCatalog,
                previewLocale: projectI18nCatalog.activeLocale || projectI18nCatalog.defaultLocale,
                designerConfig: designerConfig
            });

            // 更新面板标题
            this._onDidUpdateTitle.fire('HoneyGUI 设计器 - 未命名');
            this._setFilePath(undefined);

        } catch (error) {
            logger.error(`创建新文档失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to create new document: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
        }
    }

    /**
     * 从 TextDocument 加载内容（CustomTextEditorProvider 入口）
     * 不立即发送，等待前端 ready 消息后由 reloadCurrentDocument() 发送
     */
    public async loadFromDocument(document: vscode.TextDocument): Promise<void> {
        this._setFilePath(document.uri.fsPath);

        // 即将把磁盘内容推给 webview（loadHml），store 将与磁盘同步；
        // webview 应用后也会回发 dirtyStateChanged(false)，此处先行清除避免陈旧 true
        this.setWebviewDirty(false);

        logger.info(`[FileManager] loadFromDocument: 开始加载文件 ${this._filePath}`);

        try {
            const currentParseStartedAt = performance.now();
            let content = document.getText();

            // 防御性检查：如果内容为空或缺少 <hml> 根元素，尝试从磁盘重新读取
            if (!content || !content.includes('<hml')) {
                logger.warn(`[FileManager] TextDocument 内容异常（长度=${content.length}），尝试从磁盘重新读取`);
                const fs = require('fs');
                for (let retry = 0; retry < 3; retry++) {
                    const waitMs = 300 * (retry + 1);
                    await new Promise(resolve => setTimeout(resolve, waitMs));
                    if (this._performanceContext) {
                        this._performanceContext.metrics.retryWaitMs =
                            (this._performanceContext.metrics.retryWaitMs || 0) + waitMs;
                    }
                    try {
                        const diskContent = fs.readFileSync(this._filePath, 'utf-8');
                        if (this._performanceContext) {
                            this._performanceContext.metrics.hmlReads =
                                (this._performanceContext.metrics.hmlReads || 0) + 1;
                        }
                        if (diskContent && diskContent.includes('<hml')) {
                            logger.info(`[FileManager] 磁盘读取成功（重试 ${retry + 1} 次），内容长度=${diskContent.length}`);
                            content = diskContent;
                            break;
                        }
                        logger.warn(`[FileManager] 磁盘内容仍然异常（重试 ${retry + 1}），长度=${diskContent?.length || 0}`);
                    } catch (readErr) {
                        logger.warn(`[FileManager] 磁盘读取失败（重试 ${retry + 1}）: ${readErr}`);
                    }
                }
            }

            // 解析文档内容（必须传文件路径：无 id 组件的 fallback id 以 basename 为种子，
            // 不传则设计器画布拿到无种子 id（hg_view_auto_0），保存即永久落盘且跨文件撞车，
            // 与 scanAllViews/codegen 对同一文件解析出的带种子 id 不一致）
            const parseResult = measurePerformance(() =>
                this._hmlController.parseContent(content, this._filePath)
            );
            const hmlDocument = parseResult.value;
            if (this._performanceContext) {
                this._performanceContext.metrics.hmlParses =
                    (this._performanceContext.metrics.hmlParses || 0) + 1;
            }
            logger.info(`[FileManager] 解析完成，获得 ${hmlDocument.view?.components?.length || 0} 个组件`);

            // 为前端准备组件数据（预处理，等待 ready 消息后发送）
            const frontendComponents = this._prepareFrontendComponents(hmlDocument);
            if (this._performanceContext) {
                this._performanceContext.metrics.currentParseMs = performance.now() - currentParseStartedAt;
            }
            logger.info(`[FileManager] 前端组件数据准备完成，共 ${frontendComponents.length} 个组件`);

            // 不立即发送，等待前端 ready 消息后由 reloadCurrentDocument 发送
            logger.info(`[FileManager] 初始loadHml准备完成，等待前端ready消息`);

            // 更新面板标题
            const fileName = path.basename(document.fileName);
            this._onDidUpdateTitle.fire(`HoneyGUI Designer: ${fileName}`);
            logger.info(`[FileManager] 文件加载完成并发送到前端: ${fileName}`);

            // 启动 project.json 监听，文件变化时自动推送新配置给前端
            this._setupProjectConfigWatcher(this._filePath!);
            // 启动 i18n/strings.json 监听，文件变化时自动推送新 catalog 给前端
            this._setupI18nCatalogWatcher(this._filePath!);

        } catch (error) {
            logger.error(`从文档加载HML失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to load HML file: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
            this.createNewDocument();
        }
    }

    /**
     * 从文档更新内容（当文档在外部被修改时）
     */
    public async updateFromDocument(): Promise<void> {
        // 如果正在撤销/重做操作中，跳过更新（避免与 undo/redo 的 save 冲突）
        if (this._isInUndoRedo) {
            logger.debug('[FileManager] 正在撤销/重做操作中，跳过updateFromDocument');
            return;
        }
        
        // 如果正在保存事务中，不执行更新（避免我们自己的保存操作触发重新加载）
        if (this._saveManager.getCurrentTransactionId() > 0) {
            logger.debug('[FileManager] 正在保存事务中，跳过updateFromDocument');
            return;
        }

        if (this._filePath) {
            // 命中跨面板「预期写入登记表」：本次磁盘变化是宿主写事务（如导航图
            // 边编辑）自己写入的，跳过重载回灌并消费该登记（时间窗/宽限期语义
            // 见 PendingWriteRegistry；带内容 hash 的登记会读磁盘现值比对，磁盘
            // 已被外部方再次改写时不吞、正常放行重载）。写事务完成后由其回执
            // 负责刷新各面板。
            if (PendingWriteRegistry.getInstance().consumeIfPending(this._filePath)) {
                logger.info(`[FileManager] updateFromDocument: 命中预期写入登记，跳过本次重载: ${this._filePath}`);
                return;
            }
            try {
                logger.debug(`[FileManager] updateFromDocument: 重新加载文件 ${this._filePath}`);
                const document = await vscode.workspace.openTextDocument(this._filePath);
                const diskContent = document.getText();

                // 防御性检查：如果内容为空或无效，跳过更新
                if (!diskContent || !diskContent.includes('<hml')) {
                    logger.warn(`[FileManager] updateFromDocument: 内容异常（长度=${diskContent?.length || 0}），跳过更新`);
                    return;
                }
                
                // 使用智能内容对比机制
                if (this._lastSerializedSnapshot) {
                    const comparison = HmlContentComparator.smartCompare(
                        diskContent,
                        this._lastSerializedSnapshot
                    );
                    
                    if (comparison.isEqual) {
                        logger.debug('[FileManager] 智能对比：保存后的内容与内存一致，跳过重载');
                        logger.debug(`[FileManager] 对比详情: ${comparison.reason}`);
                        // 清空快照，避免后续误匹配
                        this._lastSerializedSnapshot = null;
                        return;
                    } else {
                        logger.debug('[FileManager] 智能对比：文件内容发生变化');
                        logger.debug(`[FileManager] 差异原因: ${comparison.reason}`);
                    }
                } else {
                    logger.debug('[FileManager] 无快照，直接加载文件内容');
                }
                
                logger.debug('[FileManager] 重新加载到设计器');
                await this.loadFromDocument(document);
                // loadFromDocument 只解析数据但不发送到前端（设计为等待 ready 消息）
                // 此时前端已经 ready，需要主动调用 reloadCurrentDocument 推送数据
                await this.reloadCurrentDocument();
            } catch (error) {
                logger.error(`更新文档失败: ${error}`);
            }
        }
    }

    /**
     * 保存HML内容
     */
    public async saveHml(content: string): Promise<boolean> {
        try {
            logger.info('[FileManager] 开始保存HML文件');

            // 保存当前序列化快照（用于后续对比）
            this._lastSerializedSnapshot = content;

            if (!this._filePath) {
                logger.info('[FileManager] 没有文件路径，提示用户选择保存位置');

                // 提示用户选择保存位置
                const selectedPath = await this._saveManager.promptSaveLocation(content);
                if (selectedPath) {
                    this._setFilePath(selectedPath);

                    // 更新面板标题
                    const fileName = path.basename(selectedPath);
                    this._onDidUpdateTitle.fire(`HoneyGUI 设计器 - ${fileName}`);
                } else {
                    logger.info('[FileManager] 用户取消保存');
                    return false;
                }
            }

            // 执行保存
            const filePath = this._filePath;
            if (!filePath) {
                throw new Error('文件路径无效');
            }

            const transactionId = this._saveManager.beginTransaction(filePath, content);
            logger.debug(`[FileManager] 保存事务ID: ${transactionId}`);

            await this._saveManager.executeSave(filePath, content, transactionId);

            logger.info(`[FileManager] 保存成功: ${path.basename(filePath)}`);
            return true;

        } catch (error) {
            logger.error(`[FileManager] 保存失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to save file: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
            return false;
        }
    }

    /**
     * 重新加载当前文档
     */
    public async reloadCurrentDocument(projectConfig?: ProjectConfig | null): Promise<void> {
        try {
            if (!this._filePath) {
                logger.warn('[FileManager] reloadCurrentDocument: 没有文件路径');
                return;
            }
            
            const hmlDocument = this._hmlController.currentDocument;
            if (!hmlDocument) {
                logger.warn('[FileManager] reloadCurrentDocument: 没有当前文档');
                return;
            }
            
            const hmlContent = this._hmlController.serializeDocument();
            
            logger.info(`[FileManager] 重新发送loadHml，组件数: ${hmlDocument.view?.components?.length || 0}`);
            
            // 使用统一的发送方法（内部会自动获取 allViews）
            await this.sendLoadHmlMessage(hmlDocument, hmlContent, projectConfig);
        } catch (error) {
            logger.error(`[FileManager] reloadCurrentDocument失败: ${error}`);
        }
    }

    /**
     * 统一的发送 loadHml 消息方法
     * 负责发送组件数据和项目配置到前端
     * 自动扫描并包含所有 view 列表和所有 HML 文件列表
     */
    private async sendLoadHmlMessage(
        hmlDocument: any,
        hmlContent: string,
        providedProjectConfig?: ProjectConfig | null
    ): Promise<void> {
        const loadPrepareStartedAt = performance.now();
        const frontendComponents = this._prepareFrontendComponents(hmlDocument);

        let projectConfig = providedProjectConfig;
        if (projectConfig === undefined) {
            const projectConfigResult = measurePerformance(() =>
                ProjectConfigLoader.loadConfig(this._filePath!)
            );
            projectConfig = projectConfigResult.value;
            if (this._performanceContext) {
                this._performanceContext.metrics.projectConfigMs =
                    (this._performanceContext.metrics.projectConfigMs || 0) + projectConfigResult.durationMs;
            }
        }
        const designerConfig = ProjectConfigLoader.getDesignerConfig(projectConfig);

        // 加载时统一将所有 hg_view 尺寸对齐到当前项目分辨率。
        // 这是唯一可靠的自愈点：无论首次打开、切换 tab 重载还是 undo/redo，
        // 前端拿到的 hg_view 尺寸始终与 project.json 分辨率一致，且不依赖 webview 是否存活。
        // hg_view 尺寸不参与 C 代码生成（GUI_VIEW_INSTANCE 不吃宽高），此处仅保证画布显示正确。
        if (projectConfig?.resolution) {
            const { width, height } = ProjectUtils.parseResolution(projectConfig.resolution);
            if (width > 0 && height > 0) {
                for (const comp of frontendComponents) {
                    if (comp.type === 'hg_view' && comp.position &&
                        (comp.position.width !== width || comp.position.height !== height)) {
                        comp.position = { ...comp.position, width, height };
                    }
                }
            }
        }

        // 获取项目根目录
        const projectRoot = ProjectUtils.findProjectRoot(this._filePath!);
        const projectI18nCatalog = projectRoot
            ? loadProjectI18nCatalog(projectRoot)
            : createEmptyCatalog('en-US');
        
        const projectScanStartedAt = performance.now();
        const scanMetrics = this._performanceContext?.metrics;
        const scanResult = await scanProjectHml(this._filePath!, scanMetrics);
        const allViews = scanResult.views;
        const allHmlFiles = scanResult.hmlFiles;
        const currentNorm = normalizeHmlFilePath(this._filePath!);
        const otherFileComponentIds = [...scanResult.componentIdsByFile.entries()]
            .filter(([filePath]) => filePath !== currentNorm)
            .flatMap(([, componentIds]) => componentIds);
        if (this._performanceContext) {
            this._performanceContext.metrics.projectScanMs = performance.now() - projectScanStartedAt;
        }
        logger.info(`[FileManager] 跨文件组件 ID 数量: ${otherFileComponentIds.length}, IDs: ${otherFileComponentIds.join(', ')}`);
        
        // 获取当前 VSCode 语言设置
        const locale = vscode.env.language;
        
        // 获取仿真运行状态
        const SimulationService = require('../simulation/SimulationService').SimulationService;
        const isSimulationRunning = SimulationService.isSimulationRunning();
        
        // 获取 GUI 库版本信息
        const targetEngine = projectConfig?.targetEngine || 'honeygui';
        const guiVersion = GuiVersionReader.getVersion(targetEngine);
        
        if (this._performanceContext) {
            this._performanceContext.metrics.loadPrepareMs = performance.now() - loadPrepareStartedAt;
        }

        this._panel.webview.postMessage({
            command: 'loadHml',
            loadId: this._performanceContext?.loadId,
            hostStartedAt: this._performanceContext?.startedAt,
            hostMetrics: this._performanceContext?.metrics,
            content: hmlContent,
            document: {
                ...hmlDocument,
                view: {
                    ...hmlDocument.view,
                    components: frontendComponents
                }
            },
            components: frontendComponents,
            projectConfig: projectConfig,
            projectI18nCatalog: projectI18nCatalog,
            previewLocale: projectI18nCatalog.activeLocale || projectI18nCatalog.defaultLocale,
            designerConfig: designerConfig || { canvasBackgroundColor: '#3c3c3c' },
            projectRoot: projectRoot,
            allViews: allViews,
            allHmlFiles: allHmlFiles,
            otherFileComponentIds: otherFileComponentIds,
            currentFilePath: this._filePath,
            locale: locale,
            isSimulationRunning: isSimulationRunning,
            guiVersion: guiVersion
        });
    }


}
