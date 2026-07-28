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
import { CodeGenerationService } from '../services/CodeGenerationService';
import { ConversionConfigService, ConversionConfig } from '../services/ConversionConfigService';
import { ProjectConfigLoader } from '../utils/ProjectConfigLoader';
import { ProjectConfigManager } from '../utils/ProjectConfigManager';
import { normalizeCatalog, removeI18nKey, renameI18nKey } from '../project-i18n/catalog';
import { loadProjectI18nCatalog, saveProjectI18nCatalog, PROJECT_I18N_RELATIVE_PATH } from '../project-i18n/files';
import { buildProjectI18nIndex, ProjectI18nComponentInput } from '../project-i18n/projectIndex';
import { HmlParser } from '../hml/HmlParser';
import { HmlSerializer } from '../hml/HmlSerializer';
import { composeAiBundle } from './aiContextBundle';
import { NavLayoutService, NavLayoutMap } from '../services/NavLayoutService';
import { NavEditService, NavEditHostHooks, NavEditRequest, NavEditResult } from './NavEditService';
import { PendingWriteRegistry } from './PendingWriteRegistry';
import { measurePerformance } from './HmlLoadPerformance';

/**
 * 消息处理器 - 负责分发来自Webview的消息
 */
export class MessageHandler {
    private readonly _panel: vscode.WebviewPanel;
    private readonly _assetManager: AssetManager;
    private readonly _codeGenerator: CodeGenerator;
    private readonly _componentManager: ComponentManager;
    private readonly _fileManager: FileManager;
    private readonly _hmlController: HmlController;
    private _autoCodeGenTimer: NodeJS.Timeout | null = null;
    private _isCodeGenerating: boolean = false;
    private _hasPendingCodeGeneration: boolean = false;
    private _userFuncWatcher: vscode.FileSystemWatcher | undefined;

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
        this._codeGenerator = codeGenerator;
        this._componentManager = componentManager;
        this._fileManager = fileManager;
        this._hmlController = hmlController;
    }

    /**
     * 获取项目根目录，找不到时返回 undefined
     */
    private _getProjectRoot(): string | undefined {
        return this._fileManager.currentFilePath
            ? ProjectUtils.findProjectRoot(this._fileManager.currentFilePath)
            : undefined;
    }

    /**
     * 获取项目根目录，找不到时显示错误消息并返回 null
     */
    private _requireProjectRoot(): string | null {
        const root = this._getProjectRoot();
        if (!root) {
            vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
            return null;
        }
        return root;
    }

    public async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'ready':
                logger.info('[MessageHandler] 收到前端ready消息');
                this._fileManager.recordWebviewReady();
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
                    this._handleLoadProjectConfigs();

                    await this._fileManager.reloadCurrentDocument();
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

            case 'undo':
                logger.debug('[MessageHandler] 收到撤销请求');
                const undoSuccess = await this._fileManager.undo();
                this._fileManager.sendUndoRedoState();
                if (!undoSuccess) {
                    vscode.window.showInformationMessage(vscode.l10n.t('No undo action available'));
                }
                break;

            case 'redo':
                logger.debug('[MessageHandler] 收到重做请求');
                const redoSuccess = await this._fileManager.redo();
                this._fileManager.sendUndoRedoState();
                if (!redoSuccess) {
                    vscode.window.showInformationMessage(vscode.l10n.t('No redo action available'));
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
                this.handleGenerateCode();
                break;

            case 'gotoSlot':
                this._handleGotoSlot(message.componentId, message.componentName);
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

            case 'renameAsset':
                this._assetManager.handleRenameAsset(message.oldPath, message.newName, this._fileManager.currentFilePath);
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
                await this._handleSwitchFile(message.filePath);
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
                this._handleSetEntryView(message.viewId);
                break;

            case 'deleteComponent':
                this._componentManager.handleDeleteComponent(message.componentId);
                break;

            case 'browseFile':
                this._handleBrowseFile(message.componentId, message.propertyName, message.filters);
                break;

            case 'browseCharsetFile':
                this._handleBrowseCharsetFile(message.componentId, message.charsetIndex, message.fileType, message.filters);
                break;

            case 'loadConversionConfig':
                this._handleLoadConversionConfig();
                break;

            case 'saveConversionConfig':
                this._handleSaveConversionConfig(message.config, message.changedPath, message.changedField);
                break;

            case 'loadProjectConfigs':
                this._handleLoadProjectConfigs();
                break;

            case 'switchProjectConfig':
                await this._handleSwitchProjectConfig(message.name);
                break;

            case 'createProjectConfig':
                await this._handleCreateProjectConfig();
                break;

            case 'deleteProjectConfig':
                await this._handleDeleteProjectConfig(message.name);
                break;

            case 'saveProjectI18nCatalog':
                this._handleSaveProjectI18nCatalog(message.catalog);
                break;

            case 'getProjectI18nIndex':
                await this._handleGetProjectI18nIndex();
                break;

            case 'deleteProjectI18nKey':
                await this._handleDeleteProjectI18nKey(message.key);
                break;

            case 'renameProjectI18nKey':
                await this._handleRenameProjectI18nKey(message.oldKey, message.newKey);
                break;

            case 'toggleAlwaysConvert':
                this._handleToggleAlwaysConvert(message.assetPath);
                break;

            case 'toggleSmartPacking':
                this._handleToggleSmartPacking();
                break;

            case 'getUserFunctions':
                this._handleGetUserFunctions();
                break;

            case 'refreshNavGraph':
                // webview 主动请求重扫导航图（打开视图关系弹窗时触发，解决 allViews 陈旧）
                await this._fileManager.updateAllViewsToFrontend();
                break;

            case 'getNavLayout':
                // 导航图弹窗打开时请求持久化布局（T7）
                await this._handleGetNavLayout();
                break;

            case 'saveNavLayout':
                // 拖动节点结束后防抖上报，只携带本次被拖动过的 key（T7）
                await this._handleSaveNavLayout(message.layout);
                break;

            case 'getViewControls':
                // 给定 viewKey 枚举该 view 下可交互控件（T9，新建跳转前置）
                await this._handleGetViewControls(message.viewKey);
                break;

            case 'applyNavEdit':
                // 导航图边编辑写事务（T10：改目标/删除/新建，当前文件与跨文件统一走此路）
                await this._handleApplyNavEdit(message);
                break;

            case 'navEditUndo':
                // 撤销最近一次导航编辑（图内撤销按钮）
                await this._handleNavEditUndo(message);
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
     * 处理文件浏览
     */
    private async _handleBrowseFile(componentId: string, propertyName: string, filters: any): Promise<void> {
        try {
            const projectRoot = this._requireProjectRoot();
            if (!projectRoot) return;

            // 构建文件过滤器
            const fileFilters: { [name: string]: string[] } = {};
            if (filters) {
                Object.keys(filters).forEach(key => {
                    fileFilters[key] = filters[key];
                });
            }

            // 打开文件选择对话框
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                openLabel: 'Select File',
                filters: fileFilters,
                defaultUri: vscode.Uri.file(projectRoot)
            });

            if (uris && uris.length > 0) {
                const selectedPath = uris[0].fsPath;
                // modelPath 必须指向项目 assets 内资源，避免 webview 访问项目外文件导致 401
                const isModelPath = propertyName === 'modelPath';
                let relativePath: string;

                if (isModelPath) {
                    relativePath = await this._ensureModelPathInAssets(selectedPath, projectRoot);
                    // 同步刷新资源面板
                    await this._assetManager.handleLoadAssets(this._fileManager.currentFilePath);
                } else {
                    // 转换为相对于项目根目录的路径
                    relativePath = path.relative(projectRoot, selectedPath);
                    // 统一使用正斜杠
                    relativePath = relativePath.replace(/\\/g, '/');
                }

                // 发送更新消息给 webview
                this._componentManager.updateComponentProperty(componentId, propertyName, relativePath);
            }
        } catch (error) {
            logger.error(`[MessageHandler] 文件浏览失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('File browse failed: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
        }
    }

    private async _ensureModelPathInAssets(selectedPath: string, projectRoot: string): Promise<string> {
        const assetsDir = ProjectUtils.getAssetsDir(projectRoot);
        await fs.promises.mkdir(assetsDir, { recursive: true });

        const normalizedSelectedPath = path.resolve(selectedPath);
        const normalizedAssetsDir = path.resolve(assetsDir);
        const selectedPathLower = normalizedSelectedPath.toLowerCase();
        const assetsDirLower = normalizedAssetsDir.toLowerCase();

        const isUnderAssets = selectedPathLower === assetsDirLower || selectedPathLower.startsWith(`${assetsDirLower}${path.sep.toLowerCase()}`);

        if (isUnderAssets) {
            const relativeToAssets = path.relative(assetsDir, normalizedSelectedPath).replace(/\\/g, '/');
            return `assets/${relativeToAssets}`;
        }

        const parsed = path.parse(selectedPath);
        let targetPath = path.join(assetsDir, `${parsed.name}${parsed.ext}`);
        let suffix = 1;

        while (fs.existsSync(targetPath)) {
            targetPath = path.join(assetsDir, `${parsed.name}_${suffix}${parsed.ext}`);
            suffix++;
        }

        await fs.promises.copyFile(selectedPath, targetPath);

        const relativeToAssets = path.relative(assetsDir, targetPath).replace(/\\/g, '/');
        return `assets/${relativeToAssets}`;
    }

    /**
     * 处理字符集文件浏览
     */
    private async _handleBrowseCharsetFile(componentId: string, charsetIndex: number, fileType: string, filters: any): Promise<void> {
        try {
            const projectRoot = this._getProjectRoot();

            if (!projectRoot) {
                vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
                return;
            }

            // 浏览按钮仅用于「自定义字符集文件」：插件内置的预置 charset/CodePage 已
            // 改为下拉选择（存稳定标识符，见 charsetPresets）。自定义文件通常位于用户
            // 项目内，故默认目录用项目根。
            //
            // 修复历史 bug：旧逻辑尝试 projectRoot/tools/font-converter/{charset,CodePage}，
            // 但这些预置目录实际打包在插件安装目录、用户项目里并不存在，existsSync 永远为
            // false，默认目录形同虚设。预置文件改由前端下拉直接选取。
            const defaultPath = projectRoot;

            // 构建文件过滤器
            const fileFilters: { [name: string]: string[] } = {};
            if (filters && Object.keys(filters).length > 0) {
                Object.keys(filters).forEach(key => {
                    fileFilters[key] = filters[key];
                });
            } else {
                // CodePage 文件没有后缀，显示所有文件
                fileFilters[vscode.l10n.t('All Files')] = ['*'];
            }

            // 打开文件选择对话框
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                openLabel: vscode.l10n.t('Select File'),
                filters: Object.keys(fileFilters).length > 0 ? fileFilters : undefined,
                defaultUri: vscode.Uri.file(defaultPath)
            });

            if (uris && uris.length > 0) {
                const selectedPath = uris[0].fsPath;
                // 转换为相对于项目根目录的路径
                let relativePath = path.relative(projectRoot, selectedPath);
                // 统一使用正斜杠
                relativePath = relativePath.replace(/\\/g, '/');

                // 获取组件
                const component = this._hmlController.findComponent(componentId);
                if (component && component.data) {
                    const charsets = (component.data as any).characterSets || [];
                    if (charsetIndex >= 0 && charsetIndex < charsets.length) {
                        // 更新指定索引的字符集值
                        charsets[charsetIndex].value = relativePath;
                        this._componentManager.updateComponentProperty(componentId, 'characterSets', charsets);
                    }
                }
            }
        } catch (error) {
            logger.error(`[MessageHandler] 字符集文件浏览失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('File browse failed: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
        }
    }

    private async handleSave(message: any): Promise<void> {
        logger.debug(`[MessageHandler] 收到保存请求，组件数量: ${message?.content?.components?.length || 0}`);

        // 记录保存开始时的 dirty 序号：保存期间若 webview 又报新改动（seq 变化），
        // 保存成功后不清除 dirty 缓存（新改动不在本次落盘内容中）
        const dirtySeqAtStart = this._fileManager.webviewDirtySeq;

        try {
            // 保存前记录当前状态到撤销栈（直接读文件，避免 VSCode buffer 不同步）
            const currentFilePath = this._fileManager.currentFilePath;
            if (currentFilePath) {
                try {
                    const currentContent = fs.readFileSync(currentFilePath, 'utf8');
                    this._fileManager.pushUndoState(currentContent);
                } catch (e) {
                    logger.warn(`[MessageHandler] 记录撤销状态失败: ${e}`);
                }
            }

            if (message?.content?.components && Array.isArray(message.content.components)) {
                logger.debug('[MessageHandler] 更新组件到HmlController...');
                this._hmlController.updateFromFrontendComponents(message.content.components);
                logger.debug(`[MessageHandler] 组件更新完成，当前文档组件数: ${this._hmlController.currentDocument?.view?.components?.length || 0}`);
            }
        } catch (syncErr) {
            logger.warn(`[MessageHandler] 前端组件同步失败: ${syncErr}`);
        }
        const serializedContent = this._hmlController.serializeDocument();
        logger.debug(`[MessageHandler] 序列化完成，内容长度: ${serializedContent.length}`);
        const saved = await this._fileManager.saveHml(message.content?.raw ?? serializedContent);

        if (saved) {
            // 保存成功：清宿主侧 dirty 缓存（仅当保存期间无新改动、seq 未变时——
            // webview 在发 save 时已乐观复位本地 isDirty，保存窗口内的新编辑会
            // 重新上报 dirty(true) 使 seq 递增，这里就不会误清）并回执 webview
            this._fileManager.clearWebviewDirtyIfUnchanged(dirtySeqAtStart);
            this._panel.webview.postMessage({ command: 'hmlSaved' });
        } else {
            // 保存失败：磁盘没有落下 webview 要保存的内容。webview 发 save 时
            // 已乐观复位本地 isDirty，必须回执让它置回，否则后续无新编辑时
            // 本地永远漏报 dirty（宿主缓存未清，仍为 dirty，方向安全）
            this._panel.webview.postMessage({ command: 'hmlSaveFailed' });
        }

        // 保存后通知前端更新撤销/重做状态
        this._fileManager.sendUndoRedoState();

        // 保存后重新扫描所有视图并更新前端
        await this._fileManager.updateAllViewsToFrontend();

        // 触发自动代码生成（带防抖）
        this._scheduleAutoCodeGeneration();
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
     * 生成代码
     */
    private async handleGenerateCode(): Promise<void> {
        if (this._isCodeGenerating) {
            this._hasPendingCodeGeneration = true;
            logger.info('[MessageHandler] 代码生成正在进行，已合并为待处理任务');
            return;
        }

        this._isCodeGenerating = true;
        try {
            do {
                this._hasPendingCodeGeneration = false;
                await CodeGenerationService.generateFromFile(this._fileManager.currentFilePath, this._codeGenerator);
            } while (this._hasPendingCodeGeneration);
        } finally {
            this._isCodeGenerating = false;
            // 通知前端操作完成
            this._panel.webview.postMessage({ command: 'operationComplete', operation: 'codegen' });
        }
    }

    /**
     * 处理设置入口视图（跨文件互斥）
     * 清除其他 HML 文件中所有 hg_view 的 entry="true"
     */
    private _handleSetEntryView(viewId: string): void {
        const currentFilePath = this._fileManager.currentFilePath;
        if (!currentFilePath) {
            return;
        }

        const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
        if (!projectRoot) {
            return;
        }

        const uiDir = ProjectUtils.getUiDir(projectRoot);
        if (!fs.existsSync(uiDir)) {
            return;
        }

        // 递归扫描所有 HML 文件
        const scanDir = (dir: string): string[] => {
            const results: string[] = [];
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    results.push(...scanDir(fullPath));
                } else if (entry.isFile() && entry.name.endsWith('.hml')) {
                    results.push(fullPath);
                }
            }
            return results;
        };

        const hmlFiles = scanDir(uiDir);
        let modifiedCount = 0;

        for (const hmlFile of hmlFiles) {
            // 跳过当前正在编辑的文件（已由前端处理）
            if (path.normalize(hmlFile) === path.normalize(currentFilePath)) {
                continue;
            }

            try {
                const content = fs.readFileSync(hmlFile, 'utf-8');
                // 将所有 entry="true" 替换为 entry="false"
                const updated = content.replace(/\bentry\s*=\s*"true"/g, 'entry="false"');
                if (updated !== content) {
                    fs.writeFileSync(hmlFile, updated, 'utf-8');
                    modifiedCount++;
                    logger.info(`[MessageHandler] Cleared entry in: ${path.basename(hmlFile)}`);
                }
            } catch (err) {
                logger.error(`[MessageHandler] Failed to update entry in ${hmlFile}: ${err}`);
            }
        }

        if (modifiedCount > 0) {
            logger.info(`[MessageHandler] Cleared entry in ${modifiedCount} other HML file(s)`);
        }
    }

    /**
     * 触发自动代码生成（供外部调用）
     */
    public triggerAutoCodeGeneration(): void {
        this._scheduleAutoCodeGeneration();
    }

    /**
     * 调度自动代码生成（带防抖）
     * 保存HML后2秒自动生成代码，如果2秒内再次保存则重置计时器
     */
    private _scheduleAutoCodeGeneration(): void {
        // 清除之前的计时器
        if (this._autoCodeGenTimer) {
            clearTimeout(this._autoCodeGenTimer);
        }

        // 设置新的计时器
        this._autoCodeGenTimer = setTimeout(() => {
            logger.info('[MessageHandler] 自动触发代码生成');
            this.handleGenerateCode().catch(err => {
                logger.error(`[MessageHandler] 自动代码生成失败: ${err}`);
            });
        }, 2000); // 2秒延迟
    }

    /**
     * 切换到其他 HML 文件
     */
    private async _handleSwitchFile(filePath: string): Promise<void> {
        try {
            logger.info(`[MessageHandler] 切换文件: ${filePath}`);

            // 打开文档
            const document = await vscode.workspace.openTextDocument(filePath);

            // 更新 FileManager 的当前文件路径
            this._fileManager.currentFilePath = filePath;

            // 加载文档内容
            await this._fileManager.loadFromDocument(document);

            // 重新加载并发送到前端
            await this._fileManager.reloadCurrentDocument();

            logger.info(`[MessageHandler] 文件切换完成: ${path.basename(filePath)}`);
        } catch (error) {
            logger.error(`[MessageHandler] 切换文件失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to switch file: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
        }
    }

    /**
     * 处理跳转到槽函数
     */
    private async _handleGotoSlot(componentId: string, componentName: string): Promise<void> {
        try {
            const currentFile = this._fileManager.currentFilePath;
            if (!currentFile) {
                vscode.window.showErrorMessage(vscode.l10n.t('Current HML file not found'));
                return;
            }

            // 获取项目根目录
            const projectRoot = ProjectUtils.findProjectRoot(currentFile);
            if (!projectRoot) {
                vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
                return;
            }

            // 获取设计稿名称（从HML文件名提取，不含扩展名）
            const designName = path.basename(currentFile, '.hml');

            // 构建回调文件路径
            const callbackFile = path.join(projectRoot, 'src', 'callbacks', `${designName}_callbacks.c`);

            // 检查文件是否存在，如果不存在则先生成代码
            if (!fs.existsSync(callbackFile)) {
                const result = await vscode.window.showInformationMessage(
                    vscode.l10n.t('The callback file already exists. Do you want to overwrite it?'),
                    vscode.l10n.t('Overwrite'), vscode.l10n.t('Cancel')
                );

                if (result === vscode.l10n.t('Overwrite')) {
                    await this.handleGenerateCode();
                    // 等待一下确保文件生成完成
                    await new Promise(resolve => setTimeout(resolve, 500));
                } else {
                    return;
                }
            }

            // 打开文件
            const document = await vscode.workspace.openTextDocument(callbackFile);
            const editor = await vscode.window.showTextDocument(document);

            // 查找槽函数位置
            const text = document.getText();
            const functionName = `on_${componentName}_click`;
            const regex = new RegExp(`void\\s+${functionName}\\s*\\(`, 'i');
            const match = regex.exec(text);

            if (match) {
                const position = document.positionAt(match.index);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            } else {
                vscode.window.showWarningMessage(vscode.l10n.t('Function {0} not found, please check if code generation is correct', functionName));
            }

        } catch (error) {
            logger.error(`[MessageHandler] 跳转到槽函数失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Jump failed: {0}', String(error)));
        }
    }

    /**
     * 处理加载转换配置
     * 从配置文件加载转换配置并发送到 webview
     */
    private _handleLoadConversionConfig(): void {
        try {
            const projectRoot = this._getProjectRoot();

            if (!projectRoot) {
                logger.warn('[MessageHandler] 无法加载转换配置：未找到项目根目录');
                return;
            }

            const configService = ConversionConfigService.getInstance();
            const config = configService.loadConfig(projectRoot);

            // 发送配置到 webview
            this._panel.webview.postMessage({
                command: 'conversionConfigLoaded',
                config
            });

            logger.debug('[MessageHandler] 转换配置已加载并发送到 webview');
        } catch (error) {
            logger.error(`[MessageHandler] 加载转换配置失败: ${error}`);
            // 发送空配置，让前端使用默认值
            this._panel.webview.postMessage({
                command: 'conversionConfigLoaded',
                config: null,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * 处理保存转换配置
     * 将配置保存到配置文件
     * @param config 转换配置对象
     * @param changedPath 变更的资源路径（可选）
     * @param changedField 变更的字段名（可选）
     */
    private _handleSaveConversionConfig(config: ConversionConfig, changedPath?: string, changedField?: string): void {
        try {
            const projectRoot = this._getProjectRoot();

            if (!projectRoot) {
                logger.warn('[MessageHandler] 无法保存转换配置：未找到项目根目录');
                vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
                return;
            }

            if (!config) {
                logger.warn('[MessageHandler] 无法保存转换配置：配置为空');
                return;
            }

            const configService = ConversionConfigService.getInstance();
            configService.saveConfig(projectRoot, config);

            logger.debug('[MessageHandler] 转换配置已保存');

            // 如果是视频格式变更或部署方式变更，自动触发代码生成
            // - videoFormat: 不同格式生成不同的播放器代码
            // - deployment: c-array / external-bin 切换会改变 lv_img_dsc_list 与 entry 文件
            if (changedField === 'videoFormat' || changedField === 'deployment') {
                logger.info(`[MessageHandler] ${changedField} 变更，自动触发代码生成`);
                this.handleGenerateCode().catch(err => {
                    logger.error(`[MessageHandler] 自动代码生成失败: ${err}`);
                });
            }
        } catch (error) {
            logger.error(`[MessageHandler] 保存转换配置失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to save conversion config: {0}', error instanceof Error ? error.message : String(error)));
        }
    }

    /**
     * 扫描并向 webview 发送可选工程配置列表及当前激活配置名
     */
    private _postProjectConfigsList(projectRoot: string): void {
        const configs = ProjectConfigManager.listConfigs(projectRoot);
        const active = ProjectConfigManager.getActiveConfigName(projectRoot);
        this._panel.webview.postMessage({
            command: 'projectConfigsLoaded',
            configs,
            active
        });
    }

    /**
     * 处理加载工程配置列表（webview 挂载时请求）
     */
    private _handleLoadProjectConfigs(): void {
        try {
            const projectRoot = this._getProjectRoot();

            if (!projectRoot) {
                logger.warn('[MessageHandler] 无法加载工程配置列表：未找到项目根目录');
                this._panel.webview.postMessage({ command: 'projectConfigsLoaded', configs: [], active: null });
                return;
            }

            this._postProjectConfigsList(projectRoot);
            logger.debug('[MessageHandler] 工程配置列表已发送到 webview');
        } catch (error) {
            logger.error(`[MessageHandler] 加载工程配置列表失败: ${error}`);
            this._panel.webview.postMessage({ command: 'projectConfigsLoaded', configs: [], active: null });
        }
    }

    /**
     * 处理切换工程配置
     * 将 config/<name>.json 覆盖根目录 project.json，清缓存，重发配置并重新生成代码（含 entry 文件）
     */
    private async _handleSwitchProjectConfig(name: string): Promise<void> {
        let projectRoot: string | undefined;
        try {
            projectRoot = this._fileManager.currentFilePath
                ? ProjectUtils.findProjectRoot(this._fileManager.currentFilePath)
                : undefined;

            if (!projectRoot) {
                vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
                return;
            }

            // 已是当前激活配置则无需切换
            const currentActive = ProjectConfigManager.getActiveConfigName(projectRoot);
            if (currentActive === name) {
                return;
            }

            // 宿主侧模态确认（覆盖 project.json + 重新生成代码）
            const confirm = await vscode.window.showWarningMessage(
                vscode.l10n.t('Switch to config "{0}"? This overwrites project.json and regenerates code.', name),
                { modal: true },
                vscode.l10n.t('Switch')
            );
            if (confirm !== vscode.l10n.t('Switch')) {
                // 取消：finally 会重发列表以复位下拉框选中项
                return;
            }

            // 应用配置，覆盖根目录 project.json
            ProjectConfigManager.applyConfig(projectRoot, name);
            // 清除配置缓存，避免后续服务读到陈旧配置
            ProjectConfigLoader.clearCache();

            // 重新加载并发送最新项目配置到前端（更新画布分辨率等）
            const freshConfig = ProjectConfigLoader.loadConfig(this._fileManager.currentFilePath);
            if (freshConfig) {
                this._panel.webview.postMessage({
                    command: 'updateProjectConfig',
                    projectConfig: freshConfig
                });
            }

            // 重新生成代码（含 entry 文件）
            await this.handleGenerateCode();

            logger.info(`[MessageHandler] 已切换工程配置: ${name}`);
        } catch (error) {
            logger.error(`[MessageHandler] 切换工程配置失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to switch config: {0}', error instanceof Error ? error.message : String(error)));
        } finally {
            // 复位下拉框选中项（切换成功→新激活项，取消/失败→原激活项）
            if (projectRoot) {
                this._postProjectConfigsList(projectRoot);
            }
            // 复位 webview 忙碌态（handleGenerateCode 成功路径也会发送，幂等）
            this._panel.webview.postMessage({ command: 'operationComplete', operation: 'codegen' });
        }
    }

    /**
     * 处理新建工程配置
     * 以当前根目录 project.json 为模板拷贝到 config/<name>.json，并在编辑器中打开供用户修改
     */
    private async _handleCreateProjectConfig(): Promise<void> {
        try {
            const projectRoot = this._getProjectRoot();

            if (!projectRoot) {
                vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
                return;
            }

            const existing = ProjectConfigManager.listConfigs(projectRoot);
            const name = await vscode.window.showInputBox({
                prompt: vscode.l10n.t('Enter new config name (uses current config as template)'),
                validateInput: (value) => {
                    const trimmed = (value || '').trim();
                    if (!ProjectConfigManager.isValidConfigName(trimmed)) {
                        return vscode.l10n.t('Invalid config name');
                    }
                    if (existing.includes(trimmed)) {
                        return vscode.l10n.t('Config already exists: {0}', trimmed);
                    }
                    return null;
                }
            });

            if (!name) {
                return; // 用户取消
            }

            const filePath = ProjectConfigManager.createConfigFromCurrent(projectRoot, name.trim());

            // 重发列表（新配置内容与根一致，会自动成为激活项）
            this._postProjectConfigsList(projectRoot);

            // 在编辑器中打开新配置文件供用户修改
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc);

            logger.info(`[MessageHandler] 已新建工程配置: ${name.trim()}`);
        } catch (error) {
            logger.error(`[MessageHandler] 新建工程配置失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to create config: {0}', error instanceof Error ? error.message : String(error)));
        }
    }

    /**
     * 处理删除工程配置
     * 删除 config/<name>.json；不影响根目录 project.json
     */
    private async _handleDeleteProjectConfig(name: string): Promise<void> {
        try {
            const projectRoot = this._getProjectRoot();

            if (!projectRoot) {
                vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
                return;
            }

            if (!name) {
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                vscode.l10n.t('Delete config "{0}"? This only removes the file under config/, project.json is unaffected.', name),
                { modal: true },
                vscode.l10n.t('Delete')
            );
            if (confirm !== vscode.l10n.t('Delete')) {
                return;
            }

            ProjectConfigManager.deleteConfig(projectRoot, name);
            this._postProjectConfigsList(projectRoot);
            logger.info(`[MessageHandler] 已删除工程配置: ${name}`);
        } catch (error) {
            logger.error(`[MessageHandler] 删除工程配置失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to delete config: {0}', error instanceof Error ? error.message : String(error)));
        }
    }

    /**
     * 处理保存项目多语言文本目录
     */
    private _handleSaveProjectI18nCatalog(catalog: unknown): void {
        try {
            const projectRoot = this._getProjectRoot();

            if (!projectRoot) {
                logger.warn('[MessageHandler] 无法保存多语言目录：未找到项目根目录');
                vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
                return;
            }

            // normalizeCatalog 已经会校验并回退 activeLocale（不在 locales 里则回退 defaultLocale），
            // 不再需要单独接收/校验一个 previewLocale 参数。
            const normalizedCatalog = normalizeCatalog(catalog, 'en-US');

            // 写盘前登记「即将由宿主自写该文件」：i18n/strings.json watcher 消费该登记后会
            // 跳过本次自触发的重载回灌，避免刚保存成功又被自己的 watcher 无意义地重推一次；
            // 若外部方（Agent/git）在这之后又改了文件，watcher 读盘 hash 比对不一致会照常放行。
            const catalogFilePath = path.join(projectRoot, PROJECT_I18N_RELATIVE_PATH);
            const registry = PendingWriteRegistry.getInstance();
            registry.register(catalogFilePath);

            try {
                saveProjectI18nCatalog(projectRoot, normalizedCatalog);
            } catch (writeErr) {
                // 写失败必须注销登记：否则时间窗内真实的外部改动会被 watcher 误吞。
                registry.unregister(catalogFilePath);
                throw writeErr;
            }

            try {
                const written = fs.readFileSync(catalogFilePath, 'utf-8');
                registry.register(catalogFilePath, PendingWriteRegistry.hashContent(written));
            } catch (readErr) {
                logger.warn(`[MessageHandler] i18n catalog 写后读回失败，登记退化为纯时间窗: ${readErr}`);
            }

            this._panel.webview.postMessage({
                command: 'projectI18nCatalogSaved',
                projectI18nCatalog: normalizedCatalog
            });

            logger.debug('[MessageHandler] 项目多语言目录已保存');
        } catch (error) {
            logger.error(`[MessageHandler] 保存项目多语言目录失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to save project i18n catalog: {0}', error instanceof Error ? error.message : String(error)));
        }
    }

    private _collectI18nComponentInputs(
        filePath: string,
        components: any[],
        visited: Set<string> = new Set()
    ): ProjectI18nComponentInput[] {
        const result: ProjectI18nComponentInput[] = [];
        for (const component of components || []) {
            if (!component?.id || visited.has(component.id)) {
                continue;
            }

            visited.add(component.id);
            result.push({
                filePath,
                id: component.id,
                name: component.name,
                type: component.type,
                text: component.data?.text,
                i18nKey: component.data?.i18nKey,
            });

            if (component.children && Array.isArray(component.children)) {
                const childComponents = components.filter((item: any) => component.children.includes(item.id));
                result.push(...this._collectI18nComponentInputs(filePath, childComponents, visited));
            }
        }
        return result;
    }

    private async _handleGetProjectI18nIndex(): Promise<void> {
        const projectRoot = this._getProjectRoot();
        if (!projectRoot) {
            this._panel.webview.postMessage({
                command: 'projectI18nIndexLoaded',
                error: 'Cannot find project root',
            });
            return;
        }

        const uiDir = ProjectUtils.getUiDir(projectRoot);
        if (!fs.existsSync(uiDir)) {
            this._panel.webview.postMessage({
                command: 'projectI18nIndexLoaded',
                error: `Cannot find UI directory: ${uiDir}`,
            });
            return;
        }

        const catalog = loadProjectI18nCatalog(projectRoot);
        const parser = new HmlParser();
        const hmlFiles: string[] = [];
        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.hml')) {
                    hmlFiles.push(fullPath);
                }
            }
        };
        walk(uiDir);

        const components: ProjectI18nComponentInput[] = [];
        const errors: Array<{ filePath: string; message: string }> = [];
        for (const file of hmlFiles) {
            try {
                const content = fs.readFileSync(file, 'utf-8');
                const document = parser.parse(content, file);
                const relativePath = path.relative(projectRoot, file).replace(/\\/g, '/');
                components.push(...this._collectI18nComponentInputs(relativePath, document.view?.components || []));
            } catch (error: any) {
                errors.push({
                    filePath: path.relative(projectRoot, file).replace(/\\/g, '/'),
                    message: error?.message || String(error),
                });
            }
        }

        this._panel.webview.postMessage({
            command: 'projectI18nIndexLoaded',
            index: buildProjectI18nIndex(catalog, components),
            errors,
        });
    }

    /**
     * 删除多语言 key：从 catalog 移除该 key 的翻译，并扫描全项目 HML，
     * 解绑所有引用该 key 的组件（清除其 i18nKey，含未打开的文件）。
     */
    private async _handleDeleteProjectI18nKey(rawKey: unknown): Promise<void> {
        const key = typeof rawKey === 'string' ? rawKey.trim() : '';
        if (!key) {
            return;
        }

        const projectRoot = this._getProjectRoot();
        if (!projectRoot) {
            logger.warn('[MessageHandler] 无法删除多语言 key：未找到项目根目录');
            vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
            return;
        }

        try {
            // 1) 从 catalog 移除 key 并写盘（移除前先取默认语言文本，用于解绑时回写）
            const catalog = loadProjectI18nCatalog(projectRoot);
            const fallbackText = String(catalog.strings[key]?.[catalog.defaultLocale] ?? '');
            removeI18nKey(catalog, key);
            saveProjectI18nCatalog(projectRoot, catalog);

            // 2) 扫描全项目 HML，解绑引用该 key 的组件
            const uiDir = ProjectUtils.getUiDir(projectRoot);
            if (fs.existsSync(uiDir)) {
                const parser = new HmlParser();
                const serializer = new HmlSerializer();
                const hmlFiles: string[] = [];
                const walk = (dir: string) => {
                    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            walk(fullPath);
                        } else if (entry.isFile() && entry.name.endsWith('.hml')) {
                            hmlFiles.push(fullPath);
                        }
                    }
                };
                walk(uiDir);

                let unboundComponentCount = 0;
                for (const file of hmlFiles) {
                    try {
                        const content = fs.readFileSync(file, 'utf-8');
                        const document = parser.parse(content, file);
                        const components = document.view?.components || [];
                        let changed = false;
                        for (const component of components) {
                            if (String((component.data as any)?.i18nKey || '').trim() === key) {
                                delete (component.data as any).i18nKey;
                                // 回写默认语言文本，使组件删 key 后仍显示有意义的内容
                                if (fallbackText) {
                                    (component.data as any).text = fallbackText;
                                }
                                changed = true;
                                unboundComponentCount++;
                            }
                        }
                        if (changed) {
                            await serializer.serializeToFile(document, file);
                        }
                    } catch (error: any) {
                        logger.warn(`[MessageHandler] 解绑多语言 key 时跳过文件 ${file}: ${error?.message || error}`);
                    }
                }

                if (unboundComponentCount > 0) {
                    logger.debug(`[MessageHandler] 已解绑 ${unboundComponentCount} 个引用 '${key}' 的组件`);
                }
            }

            // 3) 回发权威 catalog，并刷新项目索引
            this._panel.webview.postMessage({
                command: 'projectI18nCatalogSaved',
                projectI18nCatalog: catalog,
            });
            await this._handleGetProjectI18nIndex();
        } catch (error) {
            logger.error(`[MessageHandler] 删除多语言 key 失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to delete i18n key: {0}', error instanceof Error ? error.message : String(error)));
        }
    }

    /**
     * 词条改名：在 catalog 里把 oldKey 的翻译搬到 newKey，并扫描全项目 HML，
     * 把所有引用 oldKey 的组件 i18nKey 改写为 newKey（含未打开的文件）。
     */
    private async _handleRenameProjectI18nKey(rawOldKey: unknown, rawNewKey: unknown): Promise<void> {
        const oldKey = typeof rawOldKey === 'string' ? rawOldKey.trim() : '';
        const newKey = typeof rawNewKey === 'string' ? rawNewKey.trim() : '';
        if (!oldKey || !newKey || oldKey === newKey) {
            return;
        }

        const projectRoot = this._getProjectRoot();
        if (!projectRoot) {
            logger.warn('[MessageHandler] 无法重命名多语言 key：未找到项目根目录');
            vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
            return;
        }

        try {
            // 1) catalog 改名并写盘（目标名已存在则拒绝，避免覆盖已有翻译）
            const catalog = loadProjectI18nCatalog(projectRoot);
            if (!catalog.strings[oldKey]) {
                logger.warn(`[MessageHandler] 重命名多语言 key 跳过：源 key '${oldKey}' 不存在`);
                await this._handleGetProjectI18nIndex();
                return;
            }
            if (catalog.strings[newKey]) {
                vscode.window.showErrorMessage(vscode.l10n.t('I18n key "{0}" already exists', newKey));
                return;
            }
            renameI18nKey(catalog, oldKey, newKey);
            saveProjectI18nCatalog(projectRoot, catalog);

            // 2) 扫描全项目 HML，把引用 oldKey 的组件 i18nKey 改写为 newKey
            const uiDir = ProjectUtils.getUiDir(projectRoot);
            if (fs.existsSync(uiDir)) {
                const parser = new HmlParser();
                const serializer = new HmlSerializer();
                const hmlFiles: string[] = [];
                const walk = (dir: string) => {
                    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            walk(fullPath);
                        } else if (entry.isFile() && entry.name.endsWith('.hml')) {
                            hmlFiles.push(fullPath);
                        }
                    }
                };
                walk(uiDir);

                let rewrittenComponentCount = 0;
                for (const file of hmlFiles) {
                    try {
                        const content = fs.readFileSync(file, 'utf-8');
                        const document = parser.parse(content, file);
                        const components = document.view?.components || [];
                        let changed = false;
                        for (const component of components) {
                            if (String((component.data as any)?.i18nKey || '').trim() === oldKey) {
                                (component.data as any).i18nKey = newKey;
                                changed = true;
                                rewrittenComponentCount++;
                            }
                        }
                        if (changed) {
                            await serializer.serializeToFile(document, file);
                        }
                    } catch (error: any) {
                        logger.warn(`[MessageHandler] 重命名多语言 key 时跳过文件 ${file}: ${error?.message || error}`);
                    }
                }

                if (rewrittenComponentCount > 0) {
                    logger.debug(`[MessageHandler] 已将 ${rewrittenComponentCount} 个组件的 i18nKey 从 '${oldKey}' 改为 '${newKey}'`);
                }
            }

            // 3) 回发权威 catalog，并刷新项目索引
            this._panel.webview.postMessage({
                command: 'projectI18nCatalogSaved',
                projectI18nCatalog: catalog,
            });
            await this._handleGetProjectI18nIndex();
        } catch (error) {
            logger.error(`[MessageHandler] 重命名多语言 key 失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to rename i18n key: {0}', error instanceof Error ? error.message : String(error)));
        }
    }

    /**
     * 处理切换资源的强制转换状态
     * @param assetPath 资源相对路径（相对于 assets 目录）
     */
    private _handleToggleAlwaysConvert(assetPath: string): void {
        try {
            const projectRoot = this._getProjectRoot();

            if (!projectRoot) {
                logger.warn('[MessageHandler] 无法切换强制转换：未找到项目根目录');
                vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
                return;
            }

            // 读取 conversion.json
            const configService = ConversionConfigService.getInstance();
            const conversionConfig = configService.loadConfig(projectRoot);

            // 确保 alwaysConvert 配置存在
            if (!conversionConfig.alwaysConvert) {
                conversionConfig.alwaysConvert = {
                    images: [],
                    videos: [],
                    models: [],
                    fonts: []
                };
            }

            // 判断是否是文件夹（无扩展名且路径不含点，或者由前端明确标记）
            const ext = path.extname(assetPath).toLowerCase();
            const isFolder = ext === '';

            if (isFolder) {
                // 文件夹：对所有分类添加/移除 glob 模式 "folder/**"
                const globPattern = `${assetPath}/**`;
                const categories = ['images', 'videos', 'models', 'fonts'] as const;
                let isRemoving = false;

                // 检查是否已存在（任意分类中存在即视为已标记）
                for (const cat of categories) {
                    if (!conversionConfig.alwaysConvert[cat]) {
                        conversionConfig.alwaysConvert[cat] = [];
                    }
                    if (conversionConfig.alwaysConvert[cat]!.includes(globPattern)) {
                        isRemoving = true;
                        break;
                    }
                }

                for (const cat of categories) {
                    const list: string[] = conversionConfig.alwaysConvert[cat]!;
                    const idx = list.indexOf(globPattern);
                    if (isRemoving) {
                        if (idx >= 0) { list.splice(idx, 1); }
                    } else {
                        if (idx < 0) { list.push(globPattern); }
                    }
                }

                logger.info(`[MessageHandler] 文件夹强制转换 ${isRemoving ? '已移除' : '已添加'}: ${globPattern}`);
            } else {
                // 单文件：按扩展名判断分类
                const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'];
                const videoExts = ['.mp4', '.avi', '.mov', '.mkv', '.webm'];
                const modelExts = ['.gltf', '.glb', '.obj'];
                const fontExts = ['.ttf', '.otf', '.woff', '.woff2'];

                let category: 'images' | 'videos' | 'models' | 'fonts' | null = null;
                if (imageExts.includes(ext)) {
                    category = 'images';
                } else if (videoExts.includes(ext)) {
                    category = 'videos';
                } else if (modelExts.includes(ext)) {
                    category = 'models';
                } else if (fontExts.includes(ext)) {
                    category = 'fonts';
                }

                if (!category) {
                    logger.warn(`[MessageHandler] 不支持的资源类型: ${ext}`);
                    return;
                }

                // 确保分类数组存在
                if (!conversionConfig.alwaysConvert[category]) {
                    conversionConfig.alwaysConvert[category] = [];
                }

                // 切换状态
                const index = conversionConfig.alwaysConvert[category]!.indexOf(assetPath);
                if (index >= 0) {
                    // 已存在，移除
                    conversionConfig.alwaysConvert[category]!.splice(index, 1);
                    logger.info(`[MessageHandler] 已从强制转换列表移除: ${assetPath}`);
                } else {
                    // 不存在，添加
                    conversionConfig.alwaysConvert[category]!.push(assetPath);
                    logger.info(`[MessageHandler] 已添加到强制转换列表: ${assetPath}`);
                }
            }

            // 保存 conversion.json
            configService.saveConfig(projectRoot, conversionConfig);

            // 通知前端更新状态
            this._panel.webview.postMessage({
                command: 'alwaysConvertUpdated',
                alwaysConvert: conversionConfig.alwaysConvert
            });

            logger.debug('[MessageHandler] 强制转换配置已更新');
        } catch (error) {
            logger.error(`[MessageHandler] 切换强制转换失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to toggle always convert: {0}', error instanceof Error ? error.message : String(error)));
        }
    }

    /**
     * 处理切换灵活打包模式
     */
    private _handleToggleSmartPacking(): void {
        try {
            const projectRoot = this._getProjectRoot();

            if (!projectRoot) {
                logger.warn('[MessageHandler] 无法确定项目根目录');
                return;
            }

            const configService = ConversionConfigService.getInstance();
            const conversionConfig = configService.loadConfig(projectRoot);

            // 切换 smartPacking 状态
            conversionConfig.smartPacking = !conversionConfig.smartPacking;

            configService.saveConfig(projectRoot, conversionConfig);

            // 通知前端更新状态
            this._panel.webview.postMessage({
                command: 'smartPackingUpdated',
                smartPacking: conversionConfig.smartPacking
            });

            logger.debug(`[MessageHandler] 灵活打包模式: ${conversionConfig.smartPacking ? '开启' : '关闭'}`);
        } catch (error) {
            logger.error(`[MessageHandler] 切换灵活打包模式失败: ${error}`);
        }
    }

    /**
     * 处理获取用户自定义函数列表
     * 解析 src/user/**_user.h 文件，提取函数声明
     */
    private _handleGetUserFunctions(): void {
        try {
            const currentFile = this._fileManager.currentFilePath;
            if (!currentFile) {
                logger.warn('[MessageHandler] 无法获取用户函数：当前文件路径为空');
                this._panel.webview.postMessage({
                    command: 'userFunctionsLoaded',
                    functions: []
                });
                return;
            }

            const projectRoot = ProjectUtils.findProjectRoot(currentFile);
            if (!projectRoot) {
                logger.warn('[MessageHandler] 无法获取用户函数：未找到项目根目录');
                this._panel.webview.postMessage({
                    command: 'userFunctionsLoaded',
                    functions: []
                });
                return;
            }

            // 获取设计稿名称（从HML文件名提取，不含扩展名）
            const designName = path.basename(currentFile, '.hml');

            // 构建 user.h 文件路径
            const userHeaderPath = path.join(projectRoot, 'src', 'user', `${designName}_user.h`);

            if (!fs.existsSync(userHeaderPath)) {
                logger.info(`[MessageHandler] user.h 文件不存在: ${userHeaderPath}`);
                this._panel.webview.postMessage({
                    command: 'userFunctionsLoaded',
                    functions: []
                });
                return;
            }

            // 读取文件内容
            const rawContent = fs.readFileSync(userHeaderPath, 'utf-8');

            // Strip C/C++ comments before parsing to avoid matching commented-out declarations
            const content = rawContent
                .replace(/\/\/.*$/gm, '')       // remove single-line comments
                .replace(/\/\*[\s\S]*?\*\//g, ''); // remove multi-line comments

            // 解析函数声明
            // 匹配模式：void function_name(void *obj, gui_event_t *e)
            //           void function_name(gui_obj_t *obj, const char *topic, void *data, uint16_t len)
            //           void function_name(gui_obj_t *obj, void *param)  <- note_design
            const eventFuncPattern = /void\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*void\s*\*\s*obj\s*,\s*gui_event_t\s*\*\s*e\s*\)/g;
            const msgFuncPattern = /void\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*gui_obj_t\s*\*\s*obj\s*,\s*const\s+char\s*\*\s*topic\s*,\s*void\s*\*\s*data\s*,\s*uint16_t\s+len\s*\)/g;
            const noteDesignFuncPattern = /void\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*gui_obj_t\s*\*\s*obj\s*,\s*void\s*\*\s*param\s*\)/g;
            const viewFuncPattern = /void\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*gui_view_t\s*\*\s*\w+\s*\)/g;

            const functions: Array<{ name: string; type: 'event' | 'message' | 'noteDesign' | 'view' }> = [];

            // 提取事件函数
            let match;
            while ((match = eventFuncPattern.exec(content)) !== null) {
                functions.push({ name: match[1], type: 'event' });
            }

            // 提取消息函数
            while ((match = msgFuncPattern.exec(content)) !== null) {
                functions.push({ name: match[1], type: 'message' });
            }

            // 提取 note_design 函数
            while ((match = noteDesignFuncPattern.exec(content)) !== null) {
                // 避免与 event/message 函数重复
                if (!functions.some(f => f.name === match![1])) {
                    functions.push({ name: match[1], type: 'noteDesign' });
                }
            }

            // 提取 view 生命周期函数 void func(gui_view_t *view)
            while ((match = viewFuncPattern.exec(content)) !== null) {
                if (!functions.some(f => f.name === match![1])) {
                    functions.push({ name: match[1], type: 'view' });
                }
            }

            logger.info(`[MessageHandler] 找到 ${functions.length} 个用户自定义函数`);

            // 发送到前端
            this._panel.webview.postMessage({
                command: 'userFunctionsLoaded',
                functions
            });

            // Watch _user.h for changes and auto-refresh function list
            if (this._userFuncWatcher) {
                this._userFuncWatcher.dispose();
            }
            const watchPattern = new vscode.RelativePattern(
                vscode.Uri.file(path.dirname(userHeaderPath)),
                path.basename(userHeaderPath)
            );
            this._userFuncWatcher = vscode.workspace.createFileSystemWatcher(watchPattern);
            const refreshFunctions = () => this._handleGetUserFunctions();
            this._userFuncWatcher.onDidChange(refreshFunctions);
            this._userFuncWatcher.onDidCreate(refreshFunctions);
            this._userFuncWatcher.onDidDelete(() => {
                this._panel.webview.postMessage({
                    command: 'userFunctionsLoaded',
                    functions: []
                });
            });

        } catch (error) {
            logger.error(`[MessageHandler] 获取用户函数失败: ${error}`);
            this._panel.webview.postMessage({
                command: 'userFunctionsLoaded',
                functions: [],
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * 读取导航图持久化布局（T7），回推 navLayoutLoaded。
     * 找不到项目根目录或读取失败一律回退空对象（不阻塞弹窗打开）。
     */
    private async _handleGetNavLayout(): Promise<void> {
        try {
            const projectRoot = this._getProjectRoot();

            if (!projectRoot) {
                logger.warn('[MessageHandler] 无法读取导航布局：未找到项目根目录');
                this._panel.webview.postMessage({ command: 'navLayoutLoaded', layout: {} });
                return;
            }

            const layout = NavLayoutService.getInstance().loadLayout(projectRoot);
            this._panel.webview.postMessage({ command: 'navLayoutLoaded', layout });
        } catch (error) {
            logger.error(`[MessageHandler] 读取导航布局失败: ${error}`);
            this._panel.webview.postMessage({ command: 'navLayoutLoaded', layout: {} });
        }
    }

    /**
     * 写入导航图持久化布局（T7）：按 projectRoot 串行化，read-modify-write 只合并本次
     * 传来的 key（防多面板互相覆盖）。写失败不阻塞交互，postMessage 提示前端展示。
     */
    private async _handleSaveNavLayout(layout: NavLayoutMap | undefined): Promise<void> {
        if (!layout || Object.keys(layout).length === 0) {
            return;
        }
        try {
            const projectRoot = this._getProjectRoot();

            if (!projectRoot) {
                logger.warn('[MessageHandler] 无法保存导航布局：未找到项目根目录');
                this._panel.webview.postMessage({
                    command: 'navLayoutSaveFailed',
                    error: vscode.l10n.t('Cannot find project root (project.json)')
                });
                return;
            }

            await NavLayoutService.getInstance().saveLayoutPatch(projectRoot, layout);
            // 成功回执：前端据此清除之前的"保存失败"横幅（失败横幅不会自己消失）
            this._panel.webview.postMessage({ command: 'navLayoutSaved' });
        } catch (error) {
            logger.error(`[MessageHandler] 保存导航布局失败: ${error}`);
            this._panel.webview.postMessage({
                command: 'navLayoutSaveFailed',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * 给定 viewKey（relPath#viewId），枚举该 view 下（剪枝到嵌套子屏前）可交互
     * 控件列表，回推 viewControlsLoaded（T9，新建跳转前置，UI 用在 T11）。
     * 找不到 view / 解析失败一律回推空数组（不阻塞交互），并带 error 供前端提示。
     */
    private async _handleGetViewControls(viewKey: string | undefined): Promise<void> {
        if (!viewKey) {
            this._panel.webview.postMessage({
                command: 'viewControlsLoaded',
                viewKey,
                controls: [],
                error: 'Missing viewKey'
            });
            return;
        }
        try {
            const controls = await this._fileManager.getViewControls(viewKey);
            if (!controls) {
                this._panel.webview.postMessage({
                    command: 'viewControlsLoaded',
                    viewKey,
                    controls: [],
                    error: `View not found: ${viewKey}`
                });
                return;
            }
            this._panel.webview.postMessage({ command: 'viewControlsLoaded', viewKey, controls });
        } catch (error) {
            logger.error(`[MessageHandler] getViewControls 失败: ${error}`);
            this._panel.webview.postMessage({
                command: 'viewControlsLoaded',
                viewKey,
                controls: [],
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * 导航图写事务（T10）：宿主端统一写路径。
     * 协议十步在 NavEditService 内实现；本方法负责：解析项目根目录、注入宿主
     * 钩子（面板 dirty 查询 / TextDocument dirty / 面板适配器）、成功后重扫
     * allViews 回推刷新图（第 10 步）、回执 navEditResult。
     * **绝不触发 codegen**（设计文档约束 11）——本路径不调用
     * _scheduleAutoCodeGeneration，回执用 hintKey 提示"代码将在下次代码生成
     * 时更新"。
     */
    private async _handleApplyNavEdit(message: any): Promise<void> {
        const requestId = message?.requestId;
        const op = message?.op;
        const respond = (result: NavEditResult): void => {
            this._panel.webview.postMessage({ command: 'navEditResult', requestId, ...result });
        };

        try {
            const projectRoot = this._getProjectRoot();
            if (!projectRoot) {
                respond({ success: false, op, errorCode: 'noProjectRoot' });
                return;
            }

            const request: NavEditRequest = {
                op,
                edge: message?.edge,
                newTarget: message?.newTarget,
                create: message?.create,
                confirmed: message?.confirmed === true,
            };
            const service = new NavEditService(this._buildNavEditHooks());
            const result = await service.applyNavEdit(request, projectRoot);

            if (result.success) {
                // 第 10 步：重扫 allViews 回推刷新图（目标文件面板已由服务内部同步）
                await this._fileManager.updateAllViewsToFrontend();
            }
            respond(result);
        } catch (error) {
            logger.error(`[MessageHandler] applyNavEdit 失败: ${error}`);
            respond({
                success: false,
                op,
                errorCode: 'writeFailed',
                errorDetail: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * 撤销最近一次导航编辑：与写事务同样的安全前提（磁盘一致性 + dirty 校验 +
     * 登记表抑制回灌），成功后重扫 allViews 回推刷新图。回执复用 navEditResult
     * 通道（op='undo'）。**绝不触发 codegen**。
     */
    private async _handleNavEditUndo(message: any): Promise<void> {
        const requestId = message?.requestId;
        try {
            const service = new NavEditService(this._buildNavEditHooks());
            const result = await service.undoLast();
            if (result.success) {
                await this._fileManager.updateAllViewsToFrontend();
            }
            this._panel.webview.postMessage({ command: 'navEditResult', requestId, ...result });
        } catch (error) {
            logger.error(`[MessageHandler] navEditUndo 失败: ${error}`);
            this._panel.webview.postMessage({
                command: 'navEditResult', requestId, success: false, op: 'undo',
                errorCode: 'writeFailed',
                errorDetail: error instanceof Error ? error.message : String(error),
                undoCount: NavEditService.undoCount,
            });
        }
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

    /**
     * 构造导航写事务的宿主钩子。DesignerPanel 用延迟 require 获取，
     * 避免 DesignerPanel → MessageHandler → DesignerPanel 的模块初始化环。
     */
    private _buildNavEditHooks(): NavEditHostHooks {
        const { DesignerPanel } = require('./DesignerPanel') as typeof import('./DesignerPanel');
        return {
            isFileOpenWithUnsavedChanges: (filePath: string) =>
                DesignerPanel.isFileOpenWithUnsavedChanges(filePath),
            isTextDocumentDirty: (filePath: string) => {
                const key = PendingWriteRegistry.normalizePathKey(filePath);
                return vscode.workspace.textDocuments.some(doc =>
                    doc.uri.scheme === 'file'
                    && PendingWriteRegistry.normalizePathKey(doc.uri.fsPath) === key
                    && doc.isDirty);
            },
            getPanelAdapter: (filePath: string) => {
                const panel = DesignerPanel.getPanel(filePath);
                if (!panel) {
                    return undefined;
                }
                return {
                    pushUndoSnapshot: (content: string) => panel.pushNavUndoSnapshot(content),
                    reloadFromContent: (content: string) => panel.reloadAfterNavEdit(content),
                };
            },
        };
    }

    dispose(): void {
        if (this._userFuncWatcher) {
            this._userFuncWatcher.dispose();
            this._userFuncWatcher = undefined;
        }
    }
}
