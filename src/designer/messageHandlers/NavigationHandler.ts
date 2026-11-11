import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../../utils/Logger';
import { ProjectUtils } from '../../utils/ProjectUtils';
import { NavLayoutService, NavLayoutMap } from '../../services/NavLayoutService';
import { NavEditService, NavEditHostHooks, NavEditRequest, NavEditResult } from '../NavEditService';
import { PendingWriteRegistry } from '../PendingWriteRegistry';
import { HandlerContext } from './HandlerContext';

/**
 * 视图与导航相关消息：设置入口视图（跨文件互斥）、切换 HML 文件、
 * 导航图布局与边编辑写事务。
 */
export class NavigationHandler {
    constructor(private readonly _ctx: HandlerContext) {}

    /**
     * 处理设置入口视图（跨文件互斥）
     * 清除其他 HML 文件中所有 hg_view 的 entry="true"
     */
    public handleSetEntryView(viewId: string): void {
        const currentFilePath = this._ctx.fileManager.currentFilePath;
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
        /** 本次清掉 entry 的文件；写完后要主动刷新打开这些文件的其他面板 */
        const writtenFiles: string[] = [];

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
                    // 走统一写盘通道：登记预期写入，其他面板的 watcher 才不会被
                    // 这次自写触发回灌（回灌会把它们未保存的编辑冲掉）
                    this._ctx.fileManager.writeOtherPanelHml(hmlFile, updated);
                    writtenFiles.push(hmlFile);
                    modifiedCount++;
                    logger.info(`[MessageHandler] Cleared entry in: ${path.basename(hmlFile)}`);
                }
            } catch (err) {
                logger.error(`[MessageHandler] Failed to update entry in ${hmlFile}: ${err}`);
            }
        }

        if (modifiedCount > 0) {
            logger.info(`[MessageHandler] Cleared entry in ${modifiedCount} other HML file(s)`);
            this._ctx.fileManager.notifyOtherPanelsWritten(writtenFiles);
        }
    }

    /**
     * 切换到其他 HML 文件
     */
    public async handleSwitchFile(filePath: string): Promise<void> {
        try {
            logger.info(`[MessageHandler] 切换文件: ${filePath}`);

            // 打开文档
            const document = await vscode.workspace.openTextDocument(filePath);

            // 更新 FileManager 的当前文件路径
            this._ctx.fileManager.currentFilePath = filePath;

            // 加载文档内容
            await this._ctx.fileManager.loadFromDocument(document);

            // 重新加载并发送到前端
            await this._ctx.fileManager.reloadCurrentDocument();

            logger.info(`[MessageHandler] 文件切换完成: ${path.basename(filePath)}`);
        } catch (error) {
            logger.error(`[MessageHandler] 切换文件失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to switch file: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error')));
        }
    }

    /**
     * 读取导航图持久化布局（T7），回推 navLayoutLoaded。
     * 找不到项目根目录或读取失败一律回退空对象（不阻塞弹窗打开）。
     */
    public async handleGetNavLayout(): Promise<void> {
        try {
            const projectRoot = this._ctx.getProjectRoot();

            if (!projectRoot) {
                logger.warn('[MessageHandler] 无法读取导航布局：未找到项目根目录');
                this._ctx.panel.webview.postMessage({ command: 'navLayoutLoaded', layout: {} });
                return;
            }

            const layout = NavLayoutService.getInstance().loadLayout(projectRoot);
            this._ctx.panel.webview.postMessage({ command: 'navLayoutLoaded', layout });
        } catch (error) {
            logger.error(`[MessageHandler] 读取导航布局失败: ${error}`);
            this._ctx.panel.webview.postMessage({ command: 'navLayoutLoaded', layout: {} });
        }
    }

    /**
     * 写入导航图持久化布局（T7）：按 projectRoot 串行化，read-modify-write 只合并本次
     * 传来的 key（防多面板互相覆盖）。写失败不阻塞交互，postMessage 提示前端展示。
     */
    public async handleSaveNavLayout(layout: NavLayoutMap | undefined): Promise<void> {
        if (!layout || Object.keys(layout).length === 0) {
            return;
        }
        try {
            const projectRoot = this._ctx.getProjectRoot();

            if (!projectRoot) {
                logger.warn('[MessageHandler] 无法保存导航布局：未找到项目根目录');
                this._ctx.panel.webview.postMessage({
                    command: 'navLayoutSaveFailed',
                    error: vscode.l10n.t('Cannot find project root (project.json)')
                });
                return;
            }

            await NavLayoutService.getInstance().saveLayoutPatch(projectRoot, layout);
            // 成功回执：前端据此清除之前的"保存失败"横幅（失败横幅不会自己消失）
            this._ctx.panel.webview.postMessage({ command: 'navLayoutSaved' });
        } catch (error) {
            logger.error(`[MessageHandler] 保存导航布局失败: ${error}`);
            this._ctx.panel.webview.postMessage({
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
    public async handleGetViewControls(viewKey: string | undefined): Promise<void> {
        if (!viewKey) {
            this._ctx.panel.webview.postMessage({
                command: 'viewControlsLoaded',
                viewKey,
                controls: [],
                error: 'Missing viewKey'
            });
            return;
        }
        try {
            const controls = await this._ctx.fileManager.getViewControls(viewKey);
            if (!controls) {
                this._ctx.panel.webview.postMessage({
                    command: 'viewControlsLoaded',
                    viewKey,
                    controls: [],
                    error: `View not found: ${viewKey}`
                });
                return;
            }
            this._ctx.panel.webview.postMessage({ command: 'viewControlsLoaded', viewKey, controls });
        } catch (error) {
            logger.error(`[MessageHandler] getViewControls 失败: ${error}`);
            this._ctx.panel.webview.postMessage({
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
    public async handleApplyNavEdit(message: any): Promise<void> {
        const requestId = message?.requestId;
        const op = message?.op;
        const respond = (result: NavEditResult): void => {
            this._ctx.panel.webview.postMessage({ command: 'navEditResult', requestId, ...result });
        };

        try {
            const projectRoot = this._ctx.getProjectRoot();
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
                await this._ctx.fileManager.updateAllViewsToFrontend();
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
    public async handleNavEditUndo(message: any): Promise<void> {
        const requestId = message?.requestId;
        try {
            const service = new NavEditService(this._buildNavEditHooks());
            const result = await service.undoLast();
            if (result.success) {
                await this._ctx.fileManager.updateAllViewsToFrontend();
            }
            this._ctx.panel.webview.postMessage({ command: 'navEditResult', requestId, ...result });
        } catch (error) {
            logger.error(`[MessageHandler] navEditUndo 失败: ${error}`);
            this._ctx.panel.webview.postMessage({
                command: 'navEditResult', requestId, success: false, op: 'undo',
                errorCode: 'writeFailed',
                errorDetail: error instanceof Error ? error.message : String(error),
                undoCount: NavEditService.undoCount,
            });
        }
    }

    /**
     * 构造导航写事务的宿主钩子。DesignerPanel 用延迟 require 获取，
     * 避免 DesignerPanel → MessageHandler → DesignerPanel 的模块初始化环。
     */
    private _buildNavEditHooks(): NavEditHostHooks {
        const { DesignerPanel } = require('../DesignerPanel') as typeof import('../DesignerPanel');
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
}
