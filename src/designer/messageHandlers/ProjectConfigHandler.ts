import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../../utils/Logger';
import { ProjectUtils } from '../../utils/ProjectUtils';
import { ConversionConfigService, ConversionConfig } from '../../services/ConversionConfigService';
import { ProjectConfigLoader } from '../../utils/ProjectConfigLoader';
import { ProjectConfigManager } from '../../utils/ProjectConfigManager';
import { HandlerContext } from './HandlerContext';

/**
 * 工程配置相关消息：资源转换配置（conversion.json）、config/ 下的多套工程配置、
 * 强制转换与灵活打包开关。
 */
export class ProjectConfigHandler {
    constructor(
        private readonly _ctx: HandlerContext,
        /** 配置变化需要重新生成代码时调用（与手动生成共用合并逻辑） */
        private readonly _generateCode: () => Promise<void>
    ) {}

    /**
     * 处理加载转换配置
     * 从配置文件加载转换配置并发送到 webview
     */
    public handleLoadConversionConfig(): void {
        try {
            const projectRoot = this._ctx.getProjectRoot();

            if (!projectRoot) {
                logger.warn('[MessageHandler] 无法加载转换配置：未找到项目根目录');
                return;
            }

            const configService = ConversionConfigService.getInstance();
            const config = configService.loadConfig(projectRoot);

            // 发送配置到 webview
            this._ctx.panel.webview.postMessage({
                command: 'conversionConfigLoaded',
                config
            });

            logger.debug('[MessageHandler] 转换配置已加载并发送到 webview');
        } catch (error) {
            logger.error(`[MessageHandler] 加载转换配置失败: ${error}`);
            // 发送空配置，让前端使用默认值
            this._ctx.panel.webview.postMessage({
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
    public handleSaveConversionConfig(config: ConversionConfig, changedPath?: string, changedField?: string): void {
        try {
            const projectRoot = this._ctx.getProjectRoot();

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
                this._generateCode().catch(err => {
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
        this._ctx.panel.webview.postMessage({
            command: 'projectConfigsLoaded',
            configs,
            active
        });
    }

    /**
     * 处理加载工程配置列表（webview 挂载时请求）
     */
    public handleLoadProjectConfigs(): void {
        try {
            const projectRoot = this._ctx.getProjectRoot();

            if (!projectRoot) {
                logger.warn('[MessageHandler] 无法加载工程配置列表：未找到项目根目录');
                this._ctx.panel.webview.postMessage({ command: 'projectConfigsLoaded', configs: [], active: null });
                return;
            }

            this._postProjectConfigsList(projectRoot);
            logger.debug('[MessageHandler] 工程配置列表已发送到 webview');
        } catch (error) {
            logger.error(`[MessageHandler] 加载工程配置列表失败: ${error}`);
            this._ctx.panel.webview.postMessage({ command: 'projectConfigsLoaded', configs: [], active: null });
        }
    }

    /**
     * 处理切换工程配置
     * 将 config/<name>.json 覆盖根目录 project.json，清缓存，重发配置并重新生成代码（含 entry 文件）
     */
    public async handleSwitchProjectConfig(name: string): Promise<void> {
        let projectRoot: string | undefined;
        try {
            projectRoot = this._ctx.fileManager.currentFilePath
                ? ProjectUtils.findProjectRoot(this._ctx.fileManager.currentFilePath)
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
            const freshConfig = ProjectConfigLoader.loadConfig(this._ctx.fileManager.currentFilePath);
            if (freshConfig) {
                this._ctx.panel.webview.postMessage({
                    command: 'updateProjectConfig',
                    projectConfig: freshConfig
                });
            }

            // 重新生成代码（含 entry 文件）
            await this._generateCode();

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
            this._ctx.panel.webview.postMessage({ command: 'operationComplete', operation: 'codegen' });
        }
    }

    /**
     * 处理新建工程配置
     * 以当前根目录 project.json 为模板拷贝到 config/<name>.json，并在编辑器中打开供用户修改
     */
    public async handleCreateProjectConfig(): Promise<void> {
        try {
            const projectRoot = this._ctx.getProjectRoot();

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
    public async handleDeleteProjectConfig(name: string): Promise<void> {
        try {
            const projectRoot = this._ctx.getProjectRoot();

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
     * 在文本编辑器中打开根目录 project.json
     */
    public async handleOpenProjectJson(): Promise<void> {
        const projectRoot = this._ctx.requireProjectRoot();
        if (!projectRoot) {
            return;
        }
        try {
            const doc = await vscode.workspace.openTextDocument(path.join(projectRoot, 'project.json'));
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            logger.error(`[MessageHandler] 打开 project.json 失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to open project.json: {0}', error instanceof Error ? error.message : String(error)));
        }
    }

    /**
     * 处理切换资源的强制转换状态
     * @param assetPath 资源相对路径（相对于 assets 目录）
     */
    public handleToggleAlwaysConvert(assetPath: string): void {
        try {
            const projectRoot = this._ctx.getProjectRoot();

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
            this._ctx.panel.webview.postMessage({
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
    public handleToggleSmartPacking(): void {
        try {
            const projectRoot = this._ctx.getProjectRoot();

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
            this._ctx.panel.webview.postMessage({
                command: 'smartPackingUpdated',
                smartPacking: conversionConfig.smartPacking
            });

            logger.debug(`[MessageHandler] 灵活打包模式: ${conversionConfig.smartPacking ? '开启' : '关闭'}`);
        } catch (error) {
            logger.error(`[MessageHandler] 切换灵活打包模式失败: ${error}`);
        }
    }
}
