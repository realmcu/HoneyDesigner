/**
 * 共享样式（styles.json）消息处理。
 *
 * 样式是工程级文件，写盘后必须让所有面板重新解析 HML，否则其他面板画布上
 * 引用了这条样式的组件仍显示旧属性。
 */
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { logger } from '../../utils/Logger';
import { normalizeStyleLibrary, SHARED_STYLES_RELATIVE_PATH } from '../../shared/sharedStyles';
import { saveSharedStyleLibrary } from '../../shared/sharedStylesFile';
import { PendingWriteRegistry } from '../PendingWriteRegistry';
import type { HandlerContext } from './HandlerContext';

export class SharedStylesHandler {
    constructor(private readonly _ctx: HandlerContext) {}

    /** 保存 styles.json 并通知工程内所有面板重新解析 */
    public handleSaveSharedStyles(rawLibrary: unknown): void {
        try {
            const projectRoot = this._ctx.getProjectRoot();
            if (!projectRoot) {
                vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
                return;
            }

            const { library, errors } = normalizeStyleLibrary(rawLibrary);
            if (errors.length > 0) {
                logger.warn(`[SharedStyles] 保存前规范化发现 ${errors.length} 处问题: ${errors.join('; ')}`);
            }

            // 与 i18n catalog 一致：写盘前登记，样式文件 watcher 消费该登记后跳过自触发的重载
            const filePath = path.join(projectRoot, SHARED_STYLES_RELATIVE_PATH);
            const registry = PendingWriteRegistry.getInstance();
            registry.register(filePath);
            try {
                saveSharedStyleLibrary(projectRoot, library);
            } catch (writeErr) {
                registry.unregister(filePath);
                throw writeErr;
            }
            try {
                registry.register(filePath, PendingWriteRegistry.hashContent(fs.readFileSync(filePath, 'utf-8')));
            } catch (readErr) {
                logger.warn(`[SharedStyles] 写后读回失败，登记退化为纯时间窗: ${readErr}`);
            }

            const message = {
                command: 'sharedStylesSaved',
                styles: library,
                errors,
            };
            this._ctx.panel.webview.postMessage(message);

            // 样式改动会影响所有面板里引用它的组件，主动广播（登记表是全局的，其他面板的
            // watcher 回灌会被吞掉）
            const { DesignerPanel } = require('../DesignerPanel') as typeof import('../DesignerPanel');
            DesignerPanel.broadcastToProject(projectRoot, message, this._ctx.fileManager.currentFilePath);

            // 属性是解析时从样式展开的，写盘后必须重新解析当前文件，画布才会变
            void this._ctx.fileManager.reparseAndReload();
        } catch (error) {
            logger.error(`[SharedStyles] 保存失败: ${error}`);
            vscode.window.showErrorMessage(
                vscode.l10n.t('Failed to save shared styles: {0}', error instanceof Error ? error.message : String(error)));
        }
    }
}
