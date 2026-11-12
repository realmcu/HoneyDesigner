import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../utils/Logger';
import { AssetManager } from './AssetManager';
import { CodeGenerator } from '../services/CodeGenerator';
import { ComponentManager } from './ComponentManager';
import { FileManager } from './FileManager';
import { HmlController } from '../hml/HmlController';
import { ProjectUtils } from '../utils/ProjectUtils';
import { ProjectConfigLoader } from '../utils/ProjectConfigLoader';
import { loadProjectI18nCatalog } from '../project-i18n/files';
import { composeAiBundle } from './aiContextBundle';
import { NavEditService } from './NavEditService';
import { measurePerformance } from './HmlLoadPerformance';
import { createHandlerContext } from './messageHandlers/HandlerContext';
import { CodeGenHandler } from './messageHandlers/CodeGenHandler';
import { ProjectConfigHandler } from './messageHandlers/ProjectConfigHandler';
import { ProjectI18nHandler } from './messageHandlers/ProjectI18nHandler';
import { SharedStylesHandler } from './messageHandlers/SharedStylesHandler';
import { NavigationHandler } from './messageHandlers/NavigationHandler';
import { AssetBrowseHandler } from './messageHandlers/AssetBrowseHandler';

/**
 * 消息处理器 - 负责分发来自Webview的消息。
 * 本类只保留分发、保存、ready 握手等面板级逻辑；按功能分组的处理逻辑在
 * messageHandlers/ 下（代码生成、工程配置、项目多语言、导航、文件浏览）。
 */
export class MessageHandler {
    /** webview 可通过 executeCommand 消息触发的命令（与 Toolbar 保持一致），其他命令一律拒绝 */
    private static readonly WEBVIEW_COMMANDS = new Set([
        'honeygui.convertResource',
        'honeygui.uartDownload',
        'honeygui.simulation.clean',
        'honeygui.simulation.stop',
        'honeygui.simulation',
    ]);

    private readonly _panel: vscode.WebviewPanel;
    private readonly _assetManager: AssetManager;
    private readonly _componentManager: ComponentManager;
    private readonly _fileManager: FileManager;
    private readonly _hmlController: HmlController;
    private readonly _codeGen: CodeGenHandler;
    private readonly _projectConfig: ProjectConfigHandler;
    private readonly _projectI18n: ProjectI18nHandler;
    private readonly _sharedStyles: SharedStylesHandler;
    private readonly _navigation: NavigationHandler;
    private readonly _assetBrowse: AssetBrowseHandler;

    constructor(
        panel: vscode.WebviewPanel,
        assetManager: AssetManager,
        codeGenerator: CodeGenerator,
        componentManager: ComponentManager,
        fileManager: FileManager,
        hmlController: HmlController
    ) {
        this._panel = panel;
        this._assetManager = assetManager;
        this._componentManager = componentManager;
        this._fileManager = fileManager;
        this._hmlController = hmlController;

        const ctx = createHandlerContext(panel, fileManager);
        this._codeGen = new CodeGenHandler(ctx, codeGenerator);
        this._projectConfig = new ProjectConfigHandler(ctx, () => this._codeGen.handleGenerateCode());
        this._projectI18n = new ProjectI18nHandler(ctx);
        this._sharedStyles = new SharedStylesHandler(ctx);
        this._navigation = new NavigationHandler(ctx);
        this._assetBrowse = new AssetBrowseHandler(ctx, assetManager, componentManager, hmlController);

        this._fileManager.onDidSaveDesign(result => this._onDesignSaved(result));
    }

    /** 这些消息会读盘或依赖磁盘上的 HML，处理前先写出排队中的自动保存 */
    private static readonly FLUSH_BEFORE = new Set([
        'preview',
        'copyForAI',
        'executeCommand',
        'generateCode',
        'gotoSlot',
        'findUnusedAssets',
        'deleteUnusedAssets',
        'switchFile',
        'setEntryView',
        'switchProjectConfig',
        'createProjectConfig',
        'deleteProjectConfig',
        'saveSharedStyles',
        'getProjectI18nIndex',
        'deleteProjectI18nKey',
        'renameProjectI18nKey',
        'refreshNavGraph',
        'getViewControls',
        'applyNavEdit',
        'navEditUndo',
    ]);

    public async handleMessage(message: any): Promise<void> {
        if (MessageHandler.FLUSH_BEFORE.has(message?.command)) {
            await this._fileManager.flushPendingSave();
        }
        switch (message.command) {
            case 'ready':
                logger.info('[MessageHandler] 收到前端ready消息');
                this._fileManager.recordWebviewReady(message.webviewMetrics);
                try {
                    // 立即发送项目配置，避免前端在 loadHml 之前创建组件时 projectConfig 为 null
                    const projectConfigResult = measurePerformance(() =>
                        ProjectConfigLoader.loadConfig(this._fileManager.currentFilePath)
                    );
                    const projectConfig = projectConfigResult.value;
                    this._fileManager.recordProjectConfigDuration(projectConfigResult.durationMs);
                    if (projectConfig) {
                        this._panel.webview.postMessage({
                            command: 'updateProjectConfig',
                            projectConfig: projectConfig
                        });
                        logger.info('[MessageHandler] 已发送项目配置到前端');
                    }

                    // 打开工程时主动扫描 config/ 目录，更新下拉列表并按内容对比标记当前激活配置。
                    // 由宿主在 ready 时推送，避免前端挂载时 vscodeAPI 尚未就绪导致请求被丢弃。
                    this._projectConfig.handleLoadProjectConfigs();

                    await this._fileManager.reloadCurrentDocument(projectConfig);
                    this._fileManager.warnDuplicateDesignName(true);
                } catch (error) {
                    logger.error(`[MessageHandler] reloadCurrentDocument失败: ${error}`);
                }
                break;

            case 'save':
                await this.handleSave(message);
                break;

            case 'dirtyStateChanged':
                // webview store 脏状态变化（编辑产生 → true；loadHml 应用完成 → false）。
                // 宿主按面板缓存，供 DesignerPanel.isFileOpenWithUnsavedChanges 静态查询
                this._fileManager.setWebviewDirty(message.dirty === true);
                break;

            case 'canvasReady':
                if (message.loadId) {
                    void vscode.commands.executeCommand('_honeygui.perf.canvasReady', {
                        ...message,
                        filePath: this._fileManager.currentFilePath,
                    });
                }
                break;

            case 'selectImagePath':
                this._assetManager.handleSelectImagePath(message.componentId, message.propertyName, message.callbackId, this._fileManager.currentFilePath);
                break;

            case 'selectVideoPath':
                this._assetManager.handleSelectVideoPath(message.componentId, this._fileManager.currentFilePath);
                break;

            case 'selectFolderPath':
                this._assetManager.handleSelectFolderPath(message.componentId, this._fileManager.currentFilePath);
                break;

            case 'selectFolderImages':
                this._assetManager.handleSelectFolderImages(message.callbackId, this._fileManager.currentFilePath);
                break;

            case 'selectGlassPath':
                this._assetManager.handleSelectGlassPath(message.componentId, this._fileManager.currentFilePath);
                break;

            case 'selectFontPath':
                this._assetManager.handleSelectFontPath(message.componentId, this._fileManager.currentFilePath);
                break;

            case 'preview':
                this._handlePreview(message.content);
                break;

            case 'copyForAI':
                await this.handleCopyForAI(message);
                break;

            case 'executeCommand':
                if (message.commandId) {
                    const commandId = message.commandId;
                    if (!MessageHandler.WEBVIEW_COMMANDS.has(commandId)) {
                        logger.warn(`[MessageHandler] 拒绝执行未登记的命令: ${commandId}`);
                        break;
                    }
                    // 对于需要等待完成的命令，执行后通知前端
                    const needsCompletion = [
                        'honeygui.simulation.clean',
                        'honeygui.uartDownload'
                    ];
                    if (needsCompletion.includes(commandId)) {
                        vscode.commands.executeCommand(commandId, message.args).then(
                            () => {
                                this._panel.webview.postMessage({ command: 'operationComplete', operation: commandId });
                            },
                            () => {
                                this._panel.webview.postMessage({ command: 'operationComplete', operation: commandId });
                            }
                        );
                    } else {
                        vscode.commands.executeCommand(commandId, message.args);
                    }
                }
                break;

            case 'generateCode':
                this._codeGen.handleGenerateCode();
                break;

            case 'gotoSlot':
                this._codeGen.handleGotoSlot(message.componentId, message.componentName);
                break;

            case 'loadAssets':
                this._assetManager.handleLoadAssets(this._fileManager.currentFilePath);
                break;

            case 'getFontFiles':
                this._assetManager.handleGetFontFiles(this._fileManager.currentFilePath);
                break;

            case 'checkFontGlyphs':
                this._assetManager.handleCheckFontGlyphs(
                    message.fontPath,
                    message.text,
                    message.requestId,
                    this._fileManager.currentFilePath
                );
                break;

            case 'getGlyphStats':
                this._assetManager.handleGetGlyphStats(
                    message.fontPath,
                    message.text,
                    message.characterSets,
                    message.fontSize,
                    message.bpp,
                    message.requestId,
                    this._fileManager.currentFilePath
                );
                break;

            case 'confirmDeleteAsset':
                {
                    const isFolder = message.isFolder;
                    const assetName = message.assetName;
                    const confirmMsg = isFolder
                        ? vscode.l10n.t('Confirm delete folder "{0}" and all its contents?', assetName)
                        : vscode.l10n.t('Confirm delete "{0}"?', assetName);
                    const deleteBtn = vscode.l10n.t('Delete');
                    const cancelBtn = vscode.l10n.t('Cancel');

                    const result = await vscode.window.showWarningMessage(
                        confirmMsg,
                        { modal: true },
                        deleteBtn
                    );

                    if (result === deleteBtn) {
                        this._assetManager.handleDeleteAsset(message.fileName, this._fileManager.currentFilePath);
                    }
                }
                break;

            case 'deleteAsset':
                this._assetManager.handleDeleteAsset(message.fileName, this._fileManager.currentFilePath);
                break;

            case 'findUnusedAssets':
                this._assetManager.handleFindUnusedAssets(this._fileManager.currentFilePath);
                break;

            case 'deleteUnusedAssets':
                await this._assetManager.handleDeleteUnusedAssets(this._fileManager.currentFilePath);
                break;

            case 'renameAsset':
                this._assetManager.handleRenameAsset(message.oldPath, message.newName, this._fileManager.currentFilePath);
                break;

            case 'createAssetFolder':
                this._assetManager.handleCreateAssetFolder(message.parentPath, this._fileManager.currentFilePath);
                break;

            case 'openAssetsFolder':
                this._assetManager.handleOpenAssetsFolder(this._fileManager.currentFilePath);
                break;

            case 'saveImageToAssets':
                this._assetManager.handleSaveImageToAssets(
                    message.fileName,
                    message.fileData,
                    this._fileManager.currentFilePath,
                    message.dropPosition,
                    message.targetContainerId,
                    message.relativePath,
                    message.componentId,
                    message.callbackId
                );
                break;

            case 'convertPathToWebviewUri':
                this._assetManager.handleConvertPathToWebviewUri(message.path, message.requestId, this._fileManager.currentFilePath);
                break;

            case 'switchFile':
                await this._navigation.handleSwitchFile(message.filePath);
                break;
                break;

            case 'getAssetMetadata':
                this._assetManager.handleGetAssetMetadata(
                    message.relativePath,
                    this._fileManager.currentFilePath
                );
                break;

            case 'getImageSize':
                this._assetManager.handleGetImageSize(
                    message.imagePath,
                    message.dropPosition,
                    message.targetContainerId,
                    this._fileManager.currentFilePath
                );
                break;

            case 'getGifSize':
                this._assetManager.handleGetGifSize(
                    message.gifPath,
                    message.dropPosition,
                    message.targetContainerId,
                    this._fileManager.currentFilePath
                );
                break;

            case 'getImageSizeForComponent':
                this._assetManager.handleGetImageSizeForComponent(
                    message.componentId,
                    message.imagePath,
                    this._fileManager.currentFilePath
                );
                break;

            case 'create3DComponent':
                this._assetManager.handleCreate3DComponent(
                    message.modelPath,
                    message.dropPosition,
                    message.targetContainerId,
                    this._fileManager.currentFilePath
                );
                break;

            case 'getVideoSize':
                this._assetManager.handleGetVideoSize(
                    message.videoPath,
                    message.dropPosition,
                    message.targetContainerId,
                    this._fileManager.currentFilePath
                );
                break;

            case 'getVideoSizeForProperty':
                this._assetManager.handleGetVideoSizeForProperty(
                    message.videoPath,
                    message.componentId,
                    this._fileManager.currentFilePath
                );
                break;

            case 'getVideoNaturalSize':
                this._assetManager.handleGetVideoNaturalSize(
                    message.videoPath,
                    this._fileManager.currentFilePath
                );
                break;

            case 'createVideoComponent':
                this._assetManager.handleCreateVideoComponent(
                    message.videoPath,
                    message.dropPosition,
                    message.targetContainerId,
                    this._fileManager.currentFilePath
                );
                break;

            case 'createSvgComponent':
                this._assetManager.handleCreateSvgComponent(
                    message.svgPath,
                    message.dropPosition,
                    message.targetContainerId,
                    this._fileManager.currentFilePath
                );
                break;

            case 'createGlassComponent':
                this._assetManager.handleCreateGlassComponent(
                    message.glassPath,
                    message.dropPosition,
                    message.targetContainerId,
                    this._fileManager.currentFilePath
                );
                break;

            case 'createLottieComponent':
                this._assetManager.handleCreateLottieComponent(
                    message.lottiePath,
                    message.dropPosition,
                    message.targetContainerId,
                    this._fileManager.currentFilePath
                );
                break;

            case 'notify':
                vscode.window.showInformationMessage(message.text);
                break;

            case 'showInfo':
                vscode.window.showInformationMessage(message.text);
                break;

            case 'error':
                vscode.window.showErrorMessage(message.text);
                break;

            case 'addComponent':
                this._componentManager.handleAddComponent(message.parentId, message.component);
                break;

            case 'updateComponent':
                this._componentManager.handleUpdateComponent(message.componentId, message.updates);
                break;

            case 'setEntryView':
                this._navigation.handleSetEntryView(message.viewId);
                break;

            case 'deleteComponent':
                this._componentManager.handleDeleteComponent(message.componentId);
                break;

            case 'browseFile':
                this._assetBrowse.handleBrowseFile(message.componentId, message.propertyName, message.filters);
                break;

            case 'browseCharsetFile':
                this._assetBrowse.handleBrowseCharsetFile(message.componentId, message.charsetIndex, message.fileType, message.filters);
                break;

            case 'loadConversionConfig':
                this._projectConfig.handleLoadConversionConfig();
                break;

            case 'saveConversionConfig':
                this._projectConfig.handleSaveConversionConfig(message.config, message.changedPath, message.changedField);
                break;

            case 'loadProjectConfigs':
                this._projectConfig.handleLoadProjectConfigs();
                break;

            case 'switchProjectConfig':
                await this._projectConfig.handleSwitchProjectConfig(message.name);
                break;

            case 'createProjectConfig':
                await this._projectConfig.handleCreateProjectConfig();
                break;

            case 'deleteProjectConfig':
                await this._projectConfig.handleDeleteProjectConfig(message.name);
                break;

            case 'openProjectJson':
                await this._projectConfig.handleOpenProjectJson();
                break;

            case 'saveProjectI18nCatalog':
                this._projectI18n.handleSaveProjectI18nCatalog(message.catalog);
                break;

            case 'saveSharedStyles':
                this._sharedStyles.handleSaveSharedStyles(message.styles);
                break;

            case 'getProjectI18nIndex':
                await this._projectI18n.handleGetProjectI18nIndex();
                break;

            case 'deleteProjectI18nKey':
                await this._projectI18n.handleDeleteProjectI18nKey(message.key);
                break;

            case 'renameProjectI18nKey':
                await this._projectI18n.handleRenameProjectI18nKey(message.oldKey, message.newKey);
                break;

            case 'toggleAlwaysConvert':
                this._projectConfig.handleToggleAlwaysConvert(message.assetPath);
                break;

            case 'toggleSmartPacking':
                this._projectConfig.handleToggleSmartPacking();
                break;

            case 'getUserFunctions':
                this._codeGen.handleGetUserFunctions();
                break;

            case 'refreshNavGraph':
                // webview 主动请求重扫导航图（打开视图关系弹窗时触发，解决 allViews 陈旧）
                await this._fileManager.updateAllViewsToFrontend();
                break;

            case 'getNavLayout':
                // 导航图弹窗打开时请求持久化布局（T7）
                await this._navigation.handleGetNavLayout();
                break;

            case 'saveNavLayout':
                // 拖动节点结束后防抖上报，只携带本次被拖动过的 key（T7）
                await this._navigation.handleSaveNavLayout(message.layout);
                break;

            case 'getViewControls':
                // 给定 viewKey 枚举该 view 下可交互控件（T9，新建跳转前置）
                await this._navigation.handleGetViewControls(message.viewKey);
                break;

            case 'applyNavEdit':
                // 导航图边编辑写事务（T10：改目标/删除/新建，当前文件与跨文件统一走此路）
                await this._navigation.handleApplyNavEdit(message);
                break;

            case 'navEditUndo':
                // 撤销最近一次导航编辑（图内撤销按钮）
                await this._navigation.handleNavEditUndo(message);
                break;

            case 'getNavUndoState':
                // 弹窗打开时查询可撤销条数
                this._panel.webview.postMessage({ command: 'navUndoState', count: NavEditService.undoCount });
                break;

            case 'webviewLog':
                // webview 前端日志/错误转发到宿主输出通道（Output → HoneyGUI）
                this._handleWebviewLog(message);
                break;

            case 'showHostLog':
                // 打开输出面板的 HoneyGUI 通道（webview 内"打开日志"按钮）
                logger.show();
                break;

            default:
                logger.warn(`[MessageHandler] 未知消息命令: ${message.command}`);
        }
    }

    /**
     * 设计器保存：带组件的是编辑后的自动保存，合并后由 FileManager 写盘；
     * 不带组件的是 Ctrl+S / 工具栏保存，立即写盘。
     * 写盘结果经 onDidSaveDesign 回到 _onDesignSaved。
     */
    private async handleSave(message: any): Promise<void> {
        const components = message?.content?.components;
        if (Array.isArray(components)) {
            logger.debug(`[MessageHandler] 收到自动保存，组件数量: ${components.length}`);
            this._fileManager.queueDesignSave(components);
            return;
        }
        logger.debug('[MessageHandler] 收到显式保存请求');
        await this._fileManager.saveNow();
    }

    /** 写盘后：视图列表变化才重扫，确实写了盘才调度代码生成 */
    private _onDesignSaved(result: { written: boolean; viewsChanged: boolean }): void {
        if (result.viewsChanged) {
            void this._fileManager.updateAllViewsToFrontend();
        }
        if (result.written) {
            this._codeGen.scheduleAutoCodeGeneration();
        }
    }

    /** 处理「复制给 AI」：保存 HML → 写高亮截图 → 组装英文文本包 → 写系统剪贴板。 */
    private async handleCopyForAI(message: any): Promise<void> {
        try {
            const imageDataUrl: string = message?.imageDataUrl || '';
            const selectedIds: string[] = Array.isArray(message?.selectedIds) ? message.selectedIds : [];

            const filePath = this._fileManager.currentFilePath;
            if (!filePath) {
                vscode.window.showErrorMessage(vscode.l10n.t('Copy for AI failed: no open HML file.'));
                return;
            }
            const projectRoot = ProjectUtils.findProjectRoot(filePath);
            if (!projectRoot) {
                vscode.window.showErrorMessage(vscode.l10n.t('Copy for AI failed: project root not found.'));
                return;
            }

            // 1. 仅在有未保存改动时，把当前 HML 写入磁盘（单文件、轻量），使 AI 读到的与设计器一致。
            //    不复用完整 handleSave —— 避免触发自动代码生成与全量视图重扫，让"复制"动作保持轻快。
            try {
                const serialized = this._hmlController.serializeDocument();
                let onDisk = '';
                try {
                    onDisk = fs.readFileSync(filePath, 'utf8');
                } catch {
                    // 文件可能尚不存在，下面按需写入
                }
                if (serialized !== onDisk) {
                    await this._fileManager.saveHml(serialized);
                }
            } catch (saveErr) {
                logger.warn(`[MessageHandler] copyForAI 同步磁盘失败（继续用当前内存内容）: ${saveErr}`);
            }

            // 2. 写 PNG 到 .honeygui/ai-context/
            const outDir = path.join(projectRoot, '.honeygui', 'ai-context');
            const now = new Date();
            const pad = (n: number) => String(n).padStart(2, '0');
            const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
                `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
            const screenshotAbsPath = path.join(outDir, `selection-${ts}.png`);
            let screenshotOk = false;
            if (imageDataUrl.startsWith('data:image/png;base64,')) {
                try {
                    fs.mkdirSync(outDir, { recursive: true });
                    const base64 = imageDataUrl.replace(/^data:image\/png;base64,/, '');
                    fs.writeFileSync(screenshotAbsPath, Buffer.from(base64, 'base64'));
                    screenshotOk = true;
                } catch (writeErr) {
                    logger.warn(`[MessageHandler] 截图写入失败，降级为纯文本: ${writeErr}`);
                }
            }

            // 3. 组装英文文本包
            const hmlRelPath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
            const catalog = loadProjectI18nCatalog(projectRoot);
            const components = this._hmlController.currentDocument?.view?.components || [];
            const bundle = composeAiBundle({
                components,
                selectedIds,
                hmlRelPath,
                screenshotAbsPath: screenshotOk ? screenshotAbsPath : '(screenshot unavailable)',
                catalog,
            });

            // 4. 写剪贴板 + 提示
            await vscode.env.clipboard.writeText(bundle);
            vscode.window.showInformationMessage(
                vscode.l10n.t('Copied for AI. Paste into Codex / Claude Code.'),
            );
        } catch (error) {
            logger.error(`[MessageHandler] copyForAI 失败: ${error}`);
            vscode.window.showErrorMessage(
                vscode.l10n.t('Copy for AI failed: {0}', error instanceof Error ? error.message : String(error)),
            );
        }
    }

    /**
     * 预览UI (暂时保留在这里，后续可能也需要移出)
     */
    private async _handlePreview(content: string): Promise<void> {
        try {
            // 解析HML内容（传当前文件路径，保证 fallback id 带 basename 种子）
            this._hmlController.parseContent(content, this._fileManager.currentFilePath);

            // TODO: 实现预览逻辑
            vscode.window.showInformationMessage(vscode.l10n.t('Preview feature is under development...'));
        } catch (error) {
            logger.error(`预览失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Preview failed: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
        }
    }

    /**
     * 触发自动代码生成（供外部调用）
     */
    public triggerAutoCodeGeneration(): void {
        this._codeGen.scheduleAutoCodeGeneration();
    }

    /**
     * webview 前端日志转发：统一进宿主 logger（Output 面板的 HoneyGUI 通道），
     * 用户遇到前端问题时无需截图，直接复制输出即可。
     */
    private _handleWebviewLog(message: any): void {
        const text = `[webview] ${String(message?.message ?? '')}`;
        switch (message?.level) {
            case 'error': logger.error(text); break;
            case 'warn': logger.warn(text); break;
            default: logger.info(text); break;
        }
    }

    dispose(): void {
        this._codeGen.dispose();
    }
}
