import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../../utils/Logger';
import { ProjectUtils } from '../../utils/ProjectUtils';
import { normalizeCatalog, removeI18nKey, renameI18nKey } from '../../project-i18n/catalog';
import { loadProjectI18nCatalog, saveProjectI18nCatalog, PROJECT_I18N_RELATIVE_PATH } from '../../project-i18n/files';
import { buildProjectI18nIndex, ProjectI18nComponentInput } from '../../project-i18n/projectIndex';
import { HmlParser } from '../../hml/HmlParser';
import { HmlSerializer } from '../../hml/HmlSerializer';
import { PendingWriteRegistry } from '../PendingWriteRegistry';
import { HandlerContext } from './HandlerContext';

/**
 * 项目多语言消息：保存文本目录、构建全项目引用索引、删除 / 重命名词条
 * （后两者会改写未打开的 HML）。
 */
export class ProjectI18nHandler {
    constructor(private readonly _ctx: HandlerContext) {}

    /**
     * 处理保存项目多语言文本目录
     */
    public handleSaveProjectI18nCatalog(catalog: unknown): void {
        try {
            const projectRoot = this._ctx.getProjectRoot();

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

            const savedMessage = {
                command: 'projectI18nCatalogSaved',
                projectI18nCatalog: normalizedCatalog
            };
            this._ctx.panel.webview.postMessage(savedMessage);

            // 登记表是全局的：发起面板的 watcher 消费后，同项目其他面板的 watcher 回灌会被吞，
            // 必须在此主动广播，否则其他画布的预览语言停留在旧值。
            const { DesignerPanel } = require('../DesignerPanel') as typeof import('../DesignerPanel');
            DesignerPanel.broadcastToProject(projectRoot, savedMessage, this._ctx.fileManager.currentFilePath);

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

    public async handleGetProjectI18nIndex(): Promise<void> {
        const projectRoot = this._ctx.getProjectRoot();
        if (!projectRoot) {
            this._ctx.panel.webview.postMessage({
                command: 'projectI18nIndexLoaded',
                error: 'Cannot find project root',
            });
            return;
        }

        const uiDir = ProjectUtils.getUiDir(projectRoot);
        if (!fs.existsSync(uiDir)) {
            this._ctx.panel.webview.postMessage({
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

        this._ctx.panel.webview.postMessage({
            command: 'projectI18nIndexLoaded',
            index: buildProjectI18nIndex(catalog, components),
            errors,
        });
    }

    /**
     * 删除多语言 key：从 catalog 移除该 key 的翻译，并扫描全项目 HML，
     * 解绑所有引用该 key 的组件（清除其 i18nKey，含未打开的文件）。
     */
    public async handleDeleteProjectI18nKey(rawKey: unknown): Promise<void> {
        const key = typeof rawKey === 'string' ? rawKey.trim() : '';
        if (!key) {
            return;
        }

        const projectRoot = this._ctx.getProjectRoot();
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
            this._ctx.panel.webview.postMessage({
                command: 'projectI18nCatalogSaved',
                projectI18nCatalog: catalog,
            });
            await this.handleGetProjectI18nIndex();
        } catch (error) {
            logger.error(`[MessageHandler] 删除多语言 key 失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to delete i18n key: {0}', error instanceof Error ? error.message : String(error)));
        }
    }

    /**
     * 词条改名：在 catalog 里把 oldKey 的翻译搬到 newKey，并扫描全项目 HML，
     * 把所有引用 oldKey 的组件 i18nKey 改写为 newKey（含未打开的文件）。
     */
    public async handleRenameProjectI18nKey(rawOldKey: unknown, rawNewKey: unknown): Promise<void> {
        const oldKey = typeof rawOldKey === 'string' ? rawOldKey.trim() : '';
        const newKey = typeof rawNewKey === 'string' ? rawNewKey.trim() : '';
        if (!oldKey || !newKey || oldKey === newKey) {
            return;
        }

        const projectRoot = this._ctx.getProjectRoot();
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
                await this.handleGetProjectI18nIndex();
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
            this._ctx.panel.webview.postMessage({
                command: 'projectI18nCatalogSaved',
                projectI18nCatalog: catalog,
            });
            await this.handleGetProjectI18nIndex();
        } catch (error) {
            logger.error(`[MessageHandler] 重命名多语言 key 失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to rename i18n key: {0}', error instanceof Error ? error.message : String(error)));
        }
    }
}
