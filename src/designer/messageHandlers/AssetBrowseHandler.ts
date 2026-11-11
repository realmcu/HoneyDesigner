import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../../utils/Logger';
import { ProjectUtils } from '../../utils/ProjectUtils';
import { AssetManager } from '../AssetManager';
import { ComponentManager } from '../ComponentManager';
import { HmlController } from '../../hml/HmlController';
import { HandlerContext } from './HandlerContext';

/**
 * 属性面板的文件浏览：通用文件路径（3D 模型会先复制进 assets）与字体字符集文件。
 */
export class AssetBrowseHandler {
    constructor(
        private readonly _ctx: HandlerContext,
        private readonly _assetManager: AssetManager,
        private readonly _componentManager: ComponentManager,
        private readonly _hmlController: HmlController
    ) {}

    /**
     * 处理文件浏览
     */
    public async handleBrowseFile(componentId: string, propertyName: string, filters: any): Promise<void> {
        try {
            const projectRoot = this._ctx.requireProjectRoot();
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
                    await this._assetManager.handleLoadAssets(this._ctx.fileManager.currentFilePath);
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
    public async handleBrowseCharsetFile(componentId: string, charsetIndex: number, fileType: string, filters: any): Promise<void> {
        try {
            const projectRoot = this._ctx.getProjectRoot();

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
}
