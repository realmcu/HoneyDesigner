import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
// @ts-ignore - mp4box@0.5.2 没有类型定义
import * as MP4Box from 'mp4box';
import { EventEmitter } from 'events';
import { logger } from '../utils/Logger';
import { ProjectUtils } from '../utils/ProjectUtils';
import { ConversionConfigService } from '../services/ConversionConfigService';

/**
 * 资源管理器 - 处理资源文件的扫描、添加、删除等操作
 */
export class AssetManager extends EventEmitter {
    private readonly _panel: vscode.WebviewPanel;
    private _assetsWatcher: vscode.FileSystemWatcher | undefined;
    private _watchedAssetsDir: string | undefined;
    private _refreshDebounceTimer: NodeJS.Timeout | undefined;
    private _currentFilePath: string | undefined;

    // Remember last used directory for file open dialogs
    private static _lastImagePickerDir: string | undefined;

    constructor(panel: vscode.WebviewPanel) {
        super();
        this._panel = panel;
    }

    /**
     * Dispose file watcher resources
     */
    public dispose(): void {
        this._assetsWatcher?.dispose();
        this._assetsWatcher = undefined;
        if (this._refreshDebounceTimer) {
            clearTimeout(this._refreshDebounceTimer);
            this._refreshDebounceTimer = undefined;
        }
    }

    /**
     * Get default URI for file open dialog (last used dir > assets dir > undefined)
     */
    private getDefaultDialogUri(currentFilePath: string | undefined): vscode.Uri | undefined {
        if (AssetManager._lastImagePickerDir && fs.existsSync(AssetManager._lastImagePickerDir)) {
            return vscode.Uri.file(AssetManager._lastImagePickerDir);
        }
        if (currentFilePath) {
            const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
            if (projectRoot) {
                const assetsDir = path.join(projectRoot, 'assets');
                if (fs.existsSync(assetsDir)) {
                    return vscode.Uri.file(assetsDir);
                }
            }
        }
        return undefined;
    }

    /**
     * Remember selected file/folder path for next dialog
     */
    private static rememberPath(selectedPath: string, isFolder: boolean): void {
        AssetManager._lastImagePickerDir = isFolder ? selectedPath : path.dirname(selectedPath);
    }

    /**
     * Setup FileSystemWatcher on assets directory
     */
    private setupAssetsWatcher(assetsDir: string): void {
        // Already watching the same directory
        if (this._watchedAssetsDir === assetsDir && this._assetsWatcher) {
            return;
        }

        // Dispose old watcher
        this._assetsWatcher?.dispose();

        const pattern = new vscode.RelativePattern(assetsDir, '**/*');
        this._assetsWatcher = vscode.workspace.createFileSystemWatcher(pattern);
        this._watchedAssetsDir = assetsDir;

        const debouncedRefresh = () => {
            if (this._refreshDebounceTimer) {
                clearTimeout(this._refreshDebounceTimer);
            }
            this._refreshDebounceTimer = setTimeout(() => {
                this.handleLoadAssets(this._currentFilePath);
            }, 500);
        };

        this._assetsWatcher.onDidCreate(debouncedRefresh);
        this._assetsWatcher.onDidDelete(debouncedRefresh);
        this._assetsWatcher.onDidChange(debouncedRefresh);
    }

    /**
     * 加载资源文件列表
     */
    public async handleLoadAssets(currentFilePath: string | undefined): Promise<void> {
        try {
            if (!currentFilePath) {
                return;
            }

            this._currentFilePath = currentFilePath;

            const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
            if (!projectRoot) {
                logger.warn('[Assets] 未找到项目根目录');
                return;
            }

            const assetsDir = ProjectUtils.getAssetsDir(projectRoot);
            
            // 确保assets目录存在
            if (!fs.existsSync(assetsDir)) {
                fs.mkdirSync(assetsDir, { recursive: true });
            }

            // 确保 user/ 子目录存在
            const userSubDir = path.join(assetsDir, 'user');
            if (!fs.existsSync(userSubDir)) {
                fs.mkdirSync(userSubDir, { recursive: true });
            }

            // Setup file watcher on assets directory
            this.setupAssetsWatcher(assetsDir);

            // 递归扫描assets目录
            const assets = this.scanAssetsDirectory(assetsDir, assetsDir);

            // 加载转换配置
            const configService = ConversionConfigService.getInstance();
            const conversionConfig = configService.loadConfig(projectRoot);

            // 发送资源列表到webview
            this._panel.webview.postMessage({
                command: 'assetsLoaded',
                assets
            });

            // 发送转换配置到webview
            this._panel.webview.postMessage({
                command: 'conversionConfigLoaded',
                config: conversionConfig
            });

            // 从 conversion.json 读取 alwaysConvert 配置并发送到webview
            this._panel.webview.postMessage({
                command: 'alwaysConvertUpdated',
                alwaysConvert: conversionConfig.alwaysConvert || { images: [], videos: [], models: [], fonts: [] }
            });

            // 发送灵活打包模式状态到webview
            this._panel.webview.postMessage({
                command: 'smartPackingUpdated',
                smartPacking: conversionConfig.smartPacking === true
            });
        } catch (error) {
            logger.error(`加载资源列表失败: ${error}`);
        }
    }

    /**
     * 递归扫描资源目录
     * @param isUserSubtree 是否在 user/ 子目录内（user 目录下的资源不需要转换）
     */
    private scanAssetsDirectory(dirPath: string, rootPath: string, isUserSubtree: boolean = false): any[] {
        const assets: any[] = [];
        const files = fs.readdirSync(dirPath);
        
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            const stats = fs.statSync(filePath);
            const relativePath = path.relative(rootPath, filePath).replace(/\\/g, '/');

            // 判断是否在 user/ 子树中
            const isUser = isUserSubtree || relativePath === 'user' || relativePath.startsWith('user/');
            
            if (stats.isDirectory()) {
                // 递归扫描子目录
                const children = this.scanAssetsDirectory(filePath, rootPath, isUser);
                // user/ 目录即使为空也显示
                if (children.length > 0 || relativePath === 'user') {
                    const webviewUri = this._panel.webview.asWebviewUri(vscode.Uri.file(filePath));
                    assets.push({
                        name: file,
                        path: webviewUri.toString(),
                        relativePath: relativePath,
                        type: 'folder',
                        size: 0,
                        children,
                        ...(isUser && { isUserAsset: true })
                    });
                }
            } else if (stats.isFile()) {
                const ext = path.extname(file).toLowerCase();
                const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
                const svgExts = ['.svg'];
                const videoExts = ['.mp4', '.avi', '.mov', '.mkv', '.webm'];
                const modelExts = ['.gltf', '.glb', '.obj'];
                const modelDepExts = ['.mtl', '.bin'];  // 3D 模型依赖文件（不显示在资源栏）
                const fontExts = ['.ttf', '.otf', '.woff', '.woff2'];
                const glassExts = ['.glass'];  // 玻璃效果文件
                const lottieExts = ['.json', '.lottie']; // Lottie 动画文件
                const trmapExts = ['.trmap']; // 纹理映射文件
                
                // 跳过 3D 模型依赖文件，不显示在资源栏（user 目录除外）
                if (!isUser && modelDepExts.includes(ext)) {
                    continue;
                }
                
                let assetType: string | null = null;
                if (imageExts.includes(ext)) {
                    assetType = 'image';
                } else if (svgExts.includes(ext)) {
                    assetType = 'svg';
                } else if (videoExts.includes(ext)) {
                    assetType = 'video';
                } else if (modelExts.includes(ext)) {
                    assetType = 'model3d';
                } else if (fontExts.includes(ext)) {
                    assetType = 'font';
                } else if (glassExts.includes(ext)) {
                    assetType = 'glass';
                } else if (lottieExts.includes(ext)) {
                    // 简单的区分：如果是 .json，我们假设它是 lottie 动画
                    // 但要排除 project.json 等非资源文件
                    // 如果扩展名已经是 .lottie，直接通过
                    if (ext === '.lottie') {
                        assetType = 'lottie';
                    } else if (file !== 'project.json' && file !== 'package.json' && file !== 'tsconfig.json' && file !== 'conversion.json') {
                        // 对于 .json 文件，虽然前端做了重命名，但如果是手动复制进来的，仍然需要支持
                        // 但为了避免混淆，建议前端上传时已经改名为 .lottie
                        assetType = 'lottie';
                    }
                } else if (trmapExts.includes(ext)) {
                    assetType = 'trmap';
                }
                
                if (assetType) {
                    const webviewUri = this._panel.webview.asWebviewUri(vscode.Uri.file(filePath));
                    assets.push({
                        name: file,
                        path: webviewUri.toString(),
                        relativePath: relativePath,
                        type: assetType,
                        size: stats.size,
                        ...(isUser && { isUserAsset: true })
                    });
                } else if (isUser) {
                    // user 目录下，未识别类型的文件也一并显示（raw 类型）
                    const webviewUri = this._panel.webview.asWebviewUri(vscode.Uri.file(filePath));
                    assets.push({
                        name: file,
                        path: webviewUri.toString(),
                        relativePath: relativePath,
                        type: 'raw',
                        size: stats.size,
                        isUserAsset: true
                    });
                }
            }
        }
        
        return assets;
    }

    /**
     * 获取所有字体文件列表
     */
    public async handleGetFontFiles(currentFilePath: string | undefined): Promise<void> {
        try {
            if (!currentFilePath) {
                return;
            }

            const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
            if (!projectRoot) {
                return;
            }

            const assetsDir = ProjectUtils.getAssetsDir(projectRoot);
            const fontExts = ['.ttf', '.otf', '.woff', '.woff2'];
            const fonts: string[] = [];

            // 递归扫描字体文件
            const scanFonts = (dirPath: string, relativePath: string) => {
                if (!fs.existsSync(dirPath)) return;
                const files = fs.readdirSync(dirPath);
                for (const file of files) {
                    const filePath = path.join(dirPath, file);
                    const stats = fs.statSync(filePath);
                    if (stats.isDirectory()) {
                        scanFonts(filePath, relativePath ? `${relativePath}/${file}` : file);
                    } else {
                        const ext = path.extname(file).toLowerCase();
                        if (fontExts.includes(ext)) {
                            // 返回VFS路径格式
                            const vfsPath = relativePath ? `/${relativePath}/${file}` : `/${file}`;
                            fonts.push(vfsPath);
                        }
                    }
                }
            };

            scanFonts(assetsDir, '');

            this._panel.webview.postMessage({
                command: 'fontFilesLoaded',
                fonts
            });
        } catch (error) {
            logger.error(`获取字体文件列表失败: ${error}`);
        }
    }

    public async handleGetMapFiles(currentFilePath: string | undefined): Promise<void> {
        try {
            if (!currentFilePath) {
                return;
            }

            const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
            if (!projectRoot) {
                return;
            }

            const assetsDir = ProjectUtils.getAssetsDir(projectRoot);
            const maps: string[] = [];

            // 递归扫描 .trmap 文件
            const scanMaps = (dirPath: string, relativePath: string) => {
                if (!fs.existsSync(dirPath)) return;
                const files = fs.readdirSync(dirPath);
                for (const file of files) {
                    const filePath = path.join(dirPath, file);
                    const stats = fs.statSync(filePath);
                    if (stats.isDirectory()) {
                        scanMaps(filePath, relativePath ? `${relativePath}/${file}` : file);
                    } else {
                        const ext = path.extname(file).toLowerCase();
                        if (ext === '.trmap') {
                            // 返回VFS路径格式
                            const vfsPath = relativePath ? `/${relativePath}/${file}` : `/${file}`;
                            maps.push(vfsPath);
                        }
                    }
                }
            };

            scanMaps(assetsDir, '');

            this._panel.webview.postMessage({
                command: 'mapFilesLoaded',
                maps
            });
        } catch (error) {
            logger.error(`获取地图文件列表失败: ${error}`);
        }
    }

    /**
     * 删除资源文件或文件夹
     */
    public async handleDeleteAsset(assetPath: string, currentFilePath: string | undefined): Promise<void> {
        try {
            logger.info(`[删除资源] 收到删除请求: ${assetPath}`);
            
            if (!currentFilePath) {
                logger.error('[删除资源] 文件路径未初始化');
                return;
            }
            
            // 构建完整的文件路径
            const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
            if (!projectRoot) {
                logger.error('[删除资源] 无法找到项目根目录');
                return;
            }
            
            const assetsDir = path.join(projectRoot, 'assets');
            const filePath = path.join(assetsDir, assetPath);
            
            logger.info(`[删除资源] 完整路径: ${filePath}`);
            
            if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                
                if (stats.isDirectory()) {
                    // 删除文件夹
                    logger.info(`[删除资源] 删除文件夹: ${filePath}`);
                    fs.rmSync(filePath, { recursive: true, force: true });
                    
                    // 清理 conversion.json 中该文件夹及其子项的配置
                    this.removeConversionConfig(projectRoot, assetPath, true);
                    
                    vscode.window.showInformationMessage(vscode.l10n.t('Folder deleted'));
                } else {
                    const relativePath = `assets/${assetPath}`;
                    const ext = path.extname(filePath).toLowerCase();
                    
                    // 检查是否是 3D 模型文件
                    const is3DModel = ['.obj', '.gltf', '.glb'].includes(ext);
                    
                    if (is3DModel) {
                        // 删除 3D 模型及其配套文件
                        await this.delete3DModelWithDependencies(filePath, path.basename(filePath), assetsDir);
                    } else {
                        // 普通文件直接删除
                        logger.info(`[删除资源] 删除文件: ${filePath}, 相对路径: ${relativePath}`);
                        fs.unlinkSync(filePath);

                        // 通知前端清除该资源的 URI 缓存，使引用该资源的组件显示占位符
                        this._panel.webview.postMessage({
                            command: 'assetDeleted',
                            assetPath: relativePath
                        });
                    }
                    
                    // 清理 conversion.json 中该文件的配置
                    this.removeConversionConfig(projectRoot, assetPath, false);
                    
                    vscode.window.showInformationMessage(vscode.l10n.t('Asset file deleted'));
                }
                
                // 重新加载资源列表
                this.handleLoadAssets(currentFilePath);
            } else {
                logger.warn(`[删除资源] 文件不存在: ${filePath}`);
                vscode.window.showErrorMessage(vscode.l10n.t('Asset file does not exist'));
            }
        } catch (error) {
            logger.error(`删除资源文件失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to delete asset file'));
        }
    }

    /**
     * 删除 3D 模型及其依赖文件（MTL、贴图等）
     */
    private async delete3DModelWithDependencies(
        modelPath: string,
        fileName: string,
        assetsDir: string
    ): Promise<void> {
        const ext = path.extname(fileName).toLowerCase();
        const baseName = path.basename(fileName, ext);
        const modelDir = path.dirname(modelPath);
        const deletedFiles: string[] = [];

        try {
            // 1. 先收集所有需要删除的文件（在删除之前）
            const filesToDelete: string[] = [modelPath];
            
            // 2. 如果是 OBJ 文件，收集 MTL 和贴图
            if (ext === '.obj') {
                const mtlPath = path.join(modelDir, `${baseName}.mtl`);
                if (fs.existsSync(mtlPath)) {
                    // 先解析 MTL 文件获取贴图列表
                    const textures = this.extractTexturesFromMtlFile(mtlPath);
                    
                    // 添加 MTL 文件到删除列表
                    filesToDelete.push(mtlPath);
                    
                    // 添加贴图文件到删除列表
                    for (const textureName of textures) {
                        const texturePath = path.join(modelDir, textureName);
                        if (fs.existsSync(texturePath)) {
                            filesToDelete.push(texturePath);
                        }
                    }
                }
            }
            
            // 3. 如果是 GLTF，收集关联的 .bin 文件和贴图
            else if (ext === '.gltf') {
                if (fs.existsSync(modelPath)) {
                    const gltfContent = fs.readFileSync(modelPath, 'utf-8');
                    const relatedFiles = this.extractGltfDependencies(gltfContent, modelDir);
                    
                    for (const relatedFile of relatedFiles) {
                        if (fs.existsSync(relatedFile)) {
                            filesToDelete.push(relatedFile);
                        }
                    }
                }
            }

            // 4. 执行删除操作
            for (const fileToDelete of filesToDelete) {
                if (fs.existsSync(fileToDelete)) {
                    logger.info(`[删除3D模型] 删除文件: ${fileToDelete}`);
                    fs.unlinkSync(fileToDelete);
                    
                    const relativeFilePath = path.relative(assetsDir, fileToDelete).replace(/\\/g, '/');
                    deletedFiles.push(relativeFilePath);
                }
            }

            // 5. 通知前端删除引用这些资源的组件
            for (const deletedFile of deletedFiles) {
                const relativePath = `assets/${deletedFile}`;
                this._panel.webview.postMessage({
                    command: 'deleteComponentsByImagePath',
                    imagePath: relativePath
                });
            }

            logger.info(`[删除3D模型] 共删除 ${deletedFiles.length} 个文件: ${deletedFiles.join(', ')}`);
            
        } catch (error) {
            logger.error(`[删除3D模型] 删除过程出错: ${error}`);
            throw error;
        }
    }

    /**
     * 从 MTL 文件中提取贴图文件名
     */
    private extractTexturesFromMtlFile(mtlPath: string): string[] {
        try {
            const mtlContent = fs.readFileSync(mtlPath, 'utf-8');
            const textures = new Set<string>();
            const lines = mtlContent.split('\n');
            
            // 支持常见的贴图类型
            const mapTypes = ['map_Kd', 'map_Ka', 'map_Ks', 'map_Ns', 'map_d', 'map_bump', 'bump'];
            
            for (const line of lines) {
                const trimmed = line.trim();
                for (const mapType of mapTypes) {
                    if (trimmed.startsWith(mapType + ' ')) {
                        const texturePath = trimmed.substring(mapType.length + 1).trim();
                        // 移除可能的选项参数（如 -blendu on）
                        const parts = texturePath.split(/\s+/);
                        const filename = parts[parts.length - 1];
                        if (filename && !filename.startsWith('-')) {
                            textures.add(filename);
                        }
                    }
                }
            }
            
            return Array.from(textures);
        } catch (error) {
            logger.error(`[删除3D模型] 解析 MTL 文件失败: ${error}`);
            return [];
        }
    }

    /**
     * 从 GLTF 文件中提取依赖文件路径
     */
    private extractGltfDependencies(gltfContent: string, modelDir: string): string[] {
        try {
            const gltf = JSON.parse(gltfContent);
            const dependencies: string[] = [];
            
            // 提取 .bin 文件
            if (gltf.buffers) {
                for (const buffer of gltf.buffers) {
                    if (buffer.uri && !buffer.uri.startsWith('data:')) {
                        dependencies.push(path.join(modelDir, buffer.uri));
                    }
                }
            }
            
            // 提取贴图文件
            if (gltf.images) {
                for (const image of gltf.images) {
                    if (image.uri && !image.uri.startsWith('data:')) {
                        dependencies.push(path.join(modelDir, image.uri));
                    }
                }
            }
            
            return dependencies;
        } catch (error) {
            logger.error(`[删除3D模型] 解析 GLTF 文件失败: ${error}`);
            return [];
        }
    }

    /**
     * 重命名资源文件或文件夹
     */
    public async handleRenameAsset(oldPath: string, newName: string, currentFilePath: string | undefined): Promise<void> {
        try {
            if (!currentFilePath) {
                return;
            }

            const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
            if (!projectRoot) {
                return;
            }

            const assetsDir = path.join(projectRoot, 'assets');
            const fullOldPath = path.join(assetsDir, oldPath);
            const dir = path.dirname(fullOldPath);
            const fullNewPath = path.join(dir, newName);
            
            if (fs.existsSync(fullNewPath)) {
                vscode.window.showErrorMessage(vscode.l10n.t('File name already exists'));
                return;
            }
            
            // 计算新的相对路径
            const oldDir = path.dirname(oldPath);
            const newPath = oldDir === '.' ? newName : `${oldDir}/${newName}`;
            
            // 更新所有 HML 文件中的引用
            const updatedCount = await this.updateAssetReferencesInHml(projectRoot, oldPath, newPath);
            
            // 重命名物理文件
            fs.renameSync(fullOldPath, fullNewPath);
            
            // Update alwaysConvert paths in project.json
            this.updateAlwaysConvertPath(projectRoot, oldPath, newPath);

            // Update conversion.json item paths
            this.updateConversionConfigPath(projectRoot, oldPath, newPath);

            if (updatedCount > 0) {
                vscode.window.showInformationMessage(
                    vscode.l10n.t('Renamed successfully, updated {0} references', updatedCount)
                );
            } else {
                vscode.window.showInformationMessage(vscode.l10n.t('Renamed successfully'));
            }
            
            // 重新加载资源列表
            this.handleLoadAssets(currentFilePath);
        } catch (error) {
            logger.error(`重命名资源文件失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to rename asset file'));
        }
    }

    /**
     * Update alwaysConvert paths in conversion.json after rename
     */
    private updateAlwaysConvertPath(projectRoot: string, oldPath: string, newPath: string): void {
        try {
            const configService = ConversionConfigService.getInstance();
            const config = configService.loadConfig(projectRoot);
            if (!config.alwaysConvert) {
                return;
            }

            let updated = false;
            for (const category of ['images', 'videos', 'models', 'fonts'] as const) {
                const list: string[] | undefined = config.alwaysConvert[category];
                if (!list) continue;
                const idx = list.indexOf(oldPath);
                if (idx >= 0) {
                    list[idx] = newPath;
                    updated = true;
                }
            }

            if (updated) {
                configService.saveConfig(projectRoot, config);
                this._panel.webview.postMessage({
                    command: 'alwaysConvertUpdated',
                    alwaysConvert: config.alwaysConvert
                });
            }
        } catch (error) {
            logger.error(`[AssetManager] Failed to update alwaysConvert after rename: ${error}`);
        }
    }

    /**
     * Update conversion.json item paths after rename
     */
    private updateConversionConfigPath(projectRoot: string, oldPath: string, newPath: string): void {
        try {
            const configPath = path.join(projectRoot, 'conversion.json');
            if (!fs.existsSync(configPath)) {
                return;
            }

            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (!config.items) {
                return;
            }

            // Normalize paths for matching
            const normalizedOld = oldPath.replace(/\\/g, '/');
            const normalizedNew = newPath.replace(/\\/g, '/');

            if (config.items[normalizedOld] !== undefined) {
                config.items[normalizedNew] = config.items[normalizedOld];
                delete config.items[normalizedOld];
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

                // Notify frontend to reload config
                this._panel.webview.postMessage({
                    command: 'conversionConfigLoaded',
                    config
                });
            }
        } catch (error) {
            logger.error(`[AssetManager] Failed to update conversion config after rename: ${error}`);
        }
    }

    /**
     * 删除 conversion.json 中已删除资源的配置
     * @param projectRoot 项目根目录
     * @param assetPath 资源相对路径（相对于 assets 目录）
     * @param isFolder 是否为文件夹
     */
    private removeConversionConfig(projectRoot: string, assetPath: string, isFolder: boolean): void {
        try {
            const configService = ConversionConfigService.getInstance();
            const config = configService.loadConfig(projectRoot);
            const normalizedPath = assetPath.replace(/\\/g, '/');
            let changed = false;

            if (isFolder) {
                // 文件夹：删除该路径及所有子路径的配置
                for (const key of Object.keys(config.items)) {
                    if (key === normalizedPath || key.startsWith(normalizedPath + '/')) {
                        delete config.items[key];
                        changed = true;
                    }
                }
            } else {
                // 单个文件
                if (config.items[normalizedPath] !== undefined) {
                    delete config.items[normalizedPath];
                    changed = true;
                }
            }

            if (changed) {
                configService.saveConfig(projectRoot, config);
                logger.info(`[删除资源] 已清理 conversion.json 中的配置: ${normalizedPath}`);

                // 通知前端重新加载配置
                this._panel.webview.postMessage({
                    command: 'conversionConfigLoaded',
                    config
                });
            }
        } catch (error) {
            logger.error(`[AssetManager] Failed to remove conversion config: ${error}`);
        }
    }

    /**
     * 更新 HML 文件中的资源引用
     * @param projectRoot 项目根目录
     * @param oldPath 旧的资源相对路径（相对于 assets 目录）
     * @param newPath 新的资源相对路径（相对于 assets 目录）
     * @returns 更新的引用数量
     */
    private async updateAssetReferencesInHml(projectRoot: string, oldPath: string, newPath: string): Promise<number> {
        const uiDir = path.join(projectRoot, 'ui');
        if (!fs.existsSync(uiDir)) {
            return 0;
        }

        let totalUpdated = 0;
        const oldRef = `assets/${oldPath}`;
        const newRef = `assets/${newPath}`;

        // 递归扫描 HML 文件
        const scanAndUpdate = (dir: string) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    scanAndUpdate(fullPath);
                } else if (entry.name.endsWith('.hml')) {
                    try {
                        let content = fs.readFileSync(fullPath, 'utf-8');
                        // 统计替换次数
                        const matches = content.split(oldRef).length - 1;
                        if (matches > 0) {
                            content = content.split(oldRef).join(newRef);
                            fs.writeFileSync(fullPath, content, 'utf-8');
                            totalUpdated += matches;
                            logger.info(`更新 HML 文件引用: ${fullPath}, 替换 ${matches} 处`);
                        }
                    } catch (error) {
                        logger.error(`更新 HML 文件失败: ${fullPath} - ${error}`);
                    }
                }
            }
        };

        scanAndUpdate(uiDir);
        return totalUpdated;
    }

    /**
     * 打开assets文件夹
     */
    public async handleOpenAssetsFolder(currentFilePath: string | undefined): Promise<void> {
        try {
            if (!currentFilePath) {
                vscode.window.showErrorMessage(vscode.l10n.t('Please save the design first'));
                return;
            }

            const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
            if (!projectRoot) {
                vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
                return;
            }

            const assetsDir = ProjectUtils.getAssetsDir(projectRoot);
            
            // 确保assets目录存在
            if (!fs.existsSync(assetsDir)) {
                fs.mkdirSync(assetsDir, { recursive: true });
            }

            // 在系统文件管理器中打开
            const uri = vscode.Uri.file(assetsDir);
            await vscode.commands.executeCommand('revealFileInOS', uri);
        } catch (error) {
            logger.error(`打开assets文件夹失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to open assets folder'));
        }
    }

    /**
     * 保存图片到assets目录并可选创建图片控件
     */
    public async handleSaveImageToAssets(
        fileName: string,
        fileData: number[],
        currentFilePath: string | undefined,
        dropPosition?: { x: number; y: number },
        targetContainerId?: string,
        relativePath?: string,
        componentId?: string,
        callbackId?: string
    ): Promise<void> {
        try {
            if (!currentFilePath) {
                vscode.window.showErrorMessage(vscode.l10n.t('Please save the design first'));
                return;
            }

            const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
            if (!projectRoot) {
                vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
                return;
            }

            const assetsDir = ProjectUtils.getAssetsDir(projectRoot);
            
            // 确保assets目录存在
            if (!fs.existsSync(assetsDir)) {
                fs.mkdirSync(assetsDir, { recursive: true });
            }

            // 构建完整路径（支持子文件夹）
            let targetDir = assetsDir;
            let assetRelativePath = fileName;
            
            if (relativePath) {
                targetDir = path.join(assetsDir, relativePath);
                // 确保子目录存在
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }
                assetRelativePath = `${relativePath}/${fileName}`;
            }

            // 保存文件
            const filePath = path.join(targetDir, fileName);
            const buffer = Buffer.from(fileData);
            fs.writeFileSync(filePath, buffer);

            // 触发资源添加事件
            this.emit('assetAdded', assetRelativePath, buffer);

            // 计算相对路径（保存到 HML 文件）
            const hmlRelativePath = `assets/${assetRelativePath}`;

            // 如果提供了位置和容器ID，则创建图片控件
            if (dropPosition && targetContainerId) {
                const imageSize = this.getImageSize(filePath);
                
                this._panel.webview.postMessage({
                    command: 'createImageComponent',
                    imagePath: hmlRelativePath,
                    dropPosition,
                    targetContainerId,
                    imageSize
                });
            } else if (componentId) {
                // 如果提供了 componentId，则更新现有组件的图片路径和尺寸
                const imageSize = this.getImageSize(filePath);
                this._panel.webview.postMessage({
                    command: 'updateImagePath',
                    componentId: componentId,
                    path: hmlRelativePath,
                    imageSize
                });
            } else if (callbackId) {
                // 如果提供了 callbackId，则返回保存的路径（用于定时器动作等场景）
                this._panel.webview.postMessage({
                    command: 'imageSaved',
                    callbackId: callbackId,
                    path: hmlRelativePath
                });
            }

            // 重新加载资源列表
            this.handleLoadAssets(currentFilePath);

            vscode.window.showInformationMessage(vscode.l10n.t('Image saved to {0}', hmlRelativePath));
        } catch (error) {
            logger.error(`保存图片到assets失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to save image'));
        }
    }
    
    /**
     * 处理选择图片路径
     */
    public async handleSelectImagePath(componentId: string | undefined, propertyName: string | undefined, callbackId: string | undefined, currentFilePath: string | undefined): Promise<void> {
        try {
            const options: vscode.OpenDialogOptions = {
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                defaultUri: this.getDefaultDialogUri(currentFilePath),
                filters: {
                    'Images': ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'bin']
                },
                openLabel: vscode.l10n.t('Select Image')
            };

            const fileUri = await vscode.window.showOpenDialog(options);
            if (fileUri && fileUri.length > 0) {
                const filePath = fileUri[0].fsPath;
                const fileName = path.basename(filePath);

                AssetManager.rememberPath(filePath, false);
                
                if (!currentFilePath) {
                    vscode.window.showErrorMessage(vscode.l10n.t('Cannot determine project path'));
                    return;
                }

                const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
                if (!projectRoot) {
                    vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
                    return;
                }

                const assetsDir = path.join(projectRoot, 'assets');
                
                // 检查文件是否已经在 assets 目录中
                const normalizedFilePath = path.normalize(filePath);
                const normalizedAssetsDir = path.normalize(assetsDir);
                
                let relativePath: string;
                let targetPath: string;
                
                if (normalizedFilePath.startsWith(normalizedAssetsDir)) {
                    // 文件已经在 assets 目录中，保持原有路径结构
                    const relativeToAssets = path.relative(assetsDir, filePath).replace(/\\/g, '/');
                    relativePath = `assets/${relativeToAssets}`;
                    targetPath = filePath; // 不需要复制
                    logger.info(`[AssetManager] 文件已在 assets 目录中: ${relativePath}`);
                } else {
                    // 文件在外部，复制到 assets 根目录
                    targetPath = path.join(assetsDir, fileName);
                    
                    // 如果目标文件已存在，询问是否覆盖
                    if (fs.existsSync(targetPath)) {
                        const result = await vscode.window.showWarningMessage(
                            vscode.l10n.t('File {0} already exists. Overwrite?', fileName),
                            vscode.l10n.t('Overwrite'),
                            vscode.l10n.t('Cancel')
                        );
                        
                        if (result !== vscode.l10n.t('Overwrite')) {
                            return;
                        }
                    }
                    
                    // 复制文件到 assets 目录
                    await fs.promises.copyFile(filePath, targetPath);
                    relativePath = `assets/${fileName}`;
                    logger.info(`[AssetManager] 图片已复制到: ${relativePath}`);

                    // 触发资源添加事件
                    try {
                        const content = await fs.promises.readFile(targetPath);
                        this.emit('assetAdded', fileName, content);
                    } catch (e) {
                        logger.error(`[AssetManager] 读取复制文件失败: ${e}`);
                    }
                }
                
                // 获取图片尺寸
                const imageSize = this.getImageSize(targetPath);
                
                // 根据不同的调用场景发送不同的消息
                if (callbackId) {
                    // 用于定时器动作等需要回调的场景
                    this._panel.webview.postMessage({
                        command: 'imageSaved',
                        callbackId: callbackId,
                        path: relativePath
                    });
                } else if (componentId) {
                    // 用于更新组件属性的场景
                    this._panel.webview.postMessage({
                        command: 'updateImagePath',
                        componentId: componentId,
                        propertyName: propertyName || 'src',
                        path: relativePath,
                        imageSize
                    });
                }
                
                // 重新加载资源列表
                this.handleLoadAssets(currentFilePath);
            }
        } catch (error) {
            logger.error(`[AssetManager] 选择图片失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to select image'));
        }
    }

    /**
     * 处理选择视频文件路径
     */
    public async handleSelectVideoPath(componentId: string | undefined, currentFilePath: string | undefined): Promise<void> {
        try {
            const options: vscode.OpenDialogOptions = {
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                defaultUri: this.getDefaultDialogUri(currentFilePath),
                filters: {
                    'Video': ['mp4', 'avi', 'mov', 'mkv', 'webm', 'gif']
                },
                openLabel: vscode.l10n.t('Select Video')
            };

            const fileUri = await vscode.window.showOpenDialog(options);
            if (fileUri && fileUri.length > 0) {
                const filePath = fileUri[0].fsPath;
                const fileName = path.basename(filePath);

                AssetManager.rememberPath(filePath, false);

                if (!currentFilePath) {
                    vscode.window.showErrorMessage(vscode.l10n.t('Cannot determine project path'));
                    return;
                }

                const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
                if (!projectRoot) {
                    vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
                    return;
                }

                const assetsDir = path.join(projectRoot, 'assets');
                const normalizedFilePath = path.normalize(filePath);
                const normalizedAssetsDir = path.normalize(assetsDir);

                let relativePath: string;

                if (normalizedFilePath.startsWith(normalizedAssetsDir)) {
                    const relativeToAssets = path.relative(assetsDir, filePath).replace(/\\/g, '/');
                    relativePath = `assets/${relativeToAssets}`;
                } else {
                    const targetPath = path.join(assetsDir, fileName);

                    if (fs.existsSync(targetPath)) {
                        const result = await vscode.window.showWarningMessage(
                            vscode.l10n.t('File {0} already exists. Overwrite?', fileName),
                            vscode.l10n.t('Overwrite'),
                            vscode.l10n.t('Cancel')
                        );
                        if (result !== vscode.l10n.t('Overwrite')) {
                            return;
                        }
                    }

                    await fs.promises.copyFile(filePath, targetPath);
                    relativePath = `assets/${fileName}`;
                    logger.info(`[AssetManager] 视频已复制到: ${relativePath}`);

                    try {
                        const content = await fs.promises.readFile(targetPath);
                        this.emit('assetAdded', fileName, content);
                    } catch (e) {
                        logger.error(`[AssetManager] 读取复制文件失败: ${e}`);
                    }
                }

                if (componentId) {
                    this._panel.webview.postMessage({
                        command: 'updateImagePath',
                        componentId: componentId,
                        propertyName: 'src',
                        path: relativePath
                    });
                }

                this.handleLoadAssets(currentFilePath);
            }
        } catch (error) {
            logger.error(`[AssetManager] 选择视频失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to select video'));
        }
    }

    /**
     * 处理选择文件夹中的图片序列
     */
    public async handleSelectFolderImages(callbackId: string | undefined, currentFilePath: string | undefined): Promise<void> {
        try {
            const options: vscode.OpenDialogOptions = {
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                defaultUri: this.getDefaultDialogUri(currentFilePath),
                openLabel: vscode.l10n.t('Select Folder')
            };

            const folderUri = await vscode.window.showOpenDialog(options);
            if (folderUri && folderUri.length > 0) {
                const folderPath = folderUri[0].fsPath;

                AssetManager.rememberPath(folderPath, true);

                if (!currentFilePath) {
                    vscode.window.showErrorMessage(vscode.l10n.t('Cannot determine project path'));
                    return;
                }

                const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
                if (!projectRoot) {
                    vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
                    return;
                }

                const assetsDir = path.join(projectRoot, 'assets');
                
                // 读取文件夹中的所有图片文件
                const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp', '.bin'];
                const files = await fs.promises.readdir(folderPath);
                const imageFiles = files
                    .filter(file => {
                        const ext = path.extname(file).toLowerCase();
                        return imageExtensions.includes(ext);
                    })
                    .sort(); // 按文件名排序
                
                if (imageFiles.length === 0) {
                    vscode.window.showWarningMessage(vscode.l10n.t('No image files found in selected folder'));
                    return;
                }
                
                // 检查文件夹是否已经在 assets 目录中
                const normalizedFolderPath = path.normalize(folderPath);
                const normalizedAssetsDir = path.normalize(assetsDir);
                
                const imagePaths: string[] = [];
                
                if (normalizedFolderPath.startsWith(normalizedAssetsDir)) {
                    // 文件夹已经在 assets 目录中
                    for (const file of imageFiles) {
                        const filePath = path.join(folderPath, file);
                        const relativeToAssets = path.relative(assetsDir, filePath).replace(/\\/g, '/');
                        imagePaths.push(`assets/${relativeToAssets}`);
                    }
                    logger.info(`[AssetManager] 文件夹已在 assets 目录中，找到 ${imageFiles.length} 张图片`);
                } else {
                    // 文件夹在外部，需要复制
                    const folderName = path.basename(folderPath);
                    const targetFolder = path.join(assetsDir, folderName);
                    
                    // 检查目标文件夹是否存在
                    if (fs.existsSync(targetFolder)) {
                        const result = await vscode.window.showWarningMessage(
                            vscode.l10n.t('Folder {0} already exists in assets. Overwrite?', folderName),
                            vscode.l10n.t('Overwrite'),
                            vscode.l10n.t('Cancel')
                        );
                        
                        if (result !== vscode.l10n.t('Overwrite')) {
                            return;
                        }
                    } else {
                        // 创建目标文件夹
                        await fs.promises.mkdir(targetFolder, { recursive: true });
                    }
                    
                    // 复制所有图片文件
                    for (const file of imageFiles) {
                        const sourcePath = path.join(folderPath, file);
                        const targetPath = path.join(targetFolder, file);
                        await fs.promises.copyFile(sourcePath, targetPath);
                        imagePaths.push(`assets/${folderName}/${file}`);
                    }
                    logger.info(`[AssetManager] 已复制 ${imageFiles.length} 张图片到 assets/${folderName}`);
                }
                
                // 发送消息给前端
                if (callbackId) {
                    this._panel.webview.postMessage({
                        command: 'folderImagesSelected',
                        callbackId: callbackId,
                        paths: imagePaths
                    });
                }
                
                // 重新加载资源列表
                this.handleLoadAssets(currentFilePath);
                
                vscode.window.showInformationMessage(
                    vscode.l10n.t('Successfully imported {0} images', imageFiles.length.toString())
                );
            }
        } catch (error) {
            logger.error(`[AssetManager] 选择文件夹失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to select folder'));
        }
    }

    /**
     * 处理选择文件夹路径（用于 hg_menu_cellular 图标集配置）
     * 弹出文件夹选择对话框，扫描图片文件，将路径列表返回前端
     */
    public async handleSelectFolderPath(componentId: string, currentFilePath: string | undefined): Promise<void> {
        try {
            const options: vscode.OpenDialogOptions = {
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                defaultUri: this.getDefaultDialogUri(currentFilePath),
                openLabel: vscode.l10n.t('Select Folder')
            };

            const folderUri = await vscode.window.showOpenDialog(options);
            if (folderUri && folderUri.length > 0) {
                const folderPath = folderUri[0].fsPath;

                AssetManager.rememberPath(folderPath, true);

                if (!currentFilePath) {
                    vscode.window.showErrorMessage(vscode.l10n.t('Cannot determine project path'));
                    return;
                }

                const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
                if (!projectRoot) {
                    vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
                    return;
                }

                const assetsDir = path.join(projectRoot, 'assets');
                const imageExtensions = ['.png', '.jpg', '.jpeg', '.bmp'];

                // 读取文件夹中的图片文件
                let files: string[] = [];
                try {
                    files = await fs.promises.readdir(folderPath);
                } catch (e) {
                    logger.warn(`[AssetManager] 无法读取文件夹: ${folderPath}, ${e}`);
                    vscode.window.showErrorMessage(vscode.l10n.t('Failed to read folder'));
                    return;
                }

                const imageFiles = files
                    .filter(file => imageExtensions.includes(path.extname(file).toLowerCase()))
                    .sort();

                // 检查文件夹是否已在 assets 目录中
                const normalizedFolderPath = path.normalize(folderPath);
                const normalizedAssetsDir = path.normalize(assetsDir);

                const imagePaths: string[] = [];
                let folderRelativePath: string;

                if (normalizedFolderPath.startsWith(normalizedAssetsDir)) {
                    // 文件夹已在 assets 目录中，直接计算相对路径
                    folderRelativePath = path.relative(assetsDir, folderPath).replace(/\\/g, '/');
                    for (const file of imageFiles) {
                        const filePath = path.join(folderPath, file);
                        const relativeToAssets = path.relative(assetsDir, filePath).replace(/\\/g, '/');
                        imagePaths.push(`assets/${relativeToAssets}`);
                    }
                    logger.info(`[AssetManager] 文件夹已在 assets 目录中，找到 ${imageFiles.length} 张图片`);
                } else {
                    // 文件夹在外部，复制到 assets 目录
                    const folderName = path.basename(folderPath);
                    const targetFolder = path.join(assetsDir, folderName);
                    folderRelativePath = folderName;

                    if (!fs.existsSync(targetFolder)) {
                        await fs.promises.mkdir(targetFolder, { recursive: true });
                    }

                    for (const file of imageFiles) {
                        const sourcePath = path.join(folderPath, file);
                        const targetPath = path.join(targetFolder, file);
                        if (!fs.existsSync(targetPath)) {
                            await fs.promises.copyFile(sourcePath, targetPath);
                        }
                        imagePaths.push(`assets/${folderName}/${file}`);
                    }
                    logger.info(`[AssetManager] 已复制 ${imageFiles.length} 张图片到 assets/${folderName}`);
                }

                // 返回扫描结果给前端
                this._panel.webview.postMessage({
                    command: 'folderPathSelected',
                    componentId: componentId,
                    imagePaths: imagePaths,
                    folderPath: folderRelativePath
                });

                // 刷新资源列表
                this.handleLoadAssets(currentFilePath);
            }
        } catch (error) {
            logger.error(`[AssetManager] 选择文件夹路径失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to select folder'));
        }
    }

    /**
     * 处理选择玻璃形状路径
     */
    public async handleSelectGlassPath(componentId: string, currentFilePath: string | undefined): Promise<void> {
        try {
            const options: vscode.OpenDialogOptions = {
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                defaultUri: this.getDefaultDialogUri(currentFilePath),
                filters: {
                    'Glass Shape': ['glass']
                },
                openLabel: '选择玻璃形状文件'
            };

            const fileUri = await vscode.window.showOpenDialog(options);
            if (fileUri && fileUri.length > 0) {
                const filePath = fileUri[0].fsPath;
                const fileName = path.basename(filePath);

                AssetManager.rememberPath(filePath, false);
                
                if (!currentFilePath) {
                    vscode.window.showErrorMessage('无法确定项目路径');
                    return;
                }

                const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
                if (!projectRoot) {
                    vscode.window.showErrorMessage('无法找到项目根目录');
                    return;
                }

                const assetsDir = path.join(projectRoot, 'assets');
                const targetPath = path.join(assetsDir, fileName);

                // 复制文件到 assets 目录
                await fs.promises.copyFile(filePath, targetPath);
                
                // 发送相对路径到webview
                const relativePath = `assets/${fileName}`;
                this._panel.webview.postMessage({
                    command: 'updateGlassPath',
                    componentId: componentId,
                    path: relativePath
                });
                
                logger.info(`[AssetManager] 玻璃形状文件已复制到: ${relativePath}`);
            }
        } catch (error) {
            logger.error(`[AssetManager] 选择玻璃形状文件失败: ${error}`);
            vscode.window.showErrorMessage('选择玻璃形状文件失败');
        }
    }

    public async handleSelectFontPath(componentId: string, currentFilePath: string | undefined): Promise<void> {
        try {
            const options: vscode.OpenDialogOptions = {
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                defaultUri: this.getDefaultDialogUri(currentFilePath),
                filters: {
                    'Font Files': ['ttf', 'otf', 'woff', 'woff2']
                },
                openLabel: '选择字体文件'
            };

            const fileUri = await vscode.window.showOpenDialog(options);
            if (fileUri && fileUri.length > 0) {
                const filePath = fileUri[0].fsPath;
                const fileName = path.basename(filePath);

                AssetManager.rememberPath(filePath, false);

                if (!currentFilePath) {
                    vscode.window.showErrorMessage('无法确定项目路径');
                    return;
                }

                const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
                if (!projectRoot) {
                    vscode.window.showErrorMessage('无法找到项目根目录');
                    return;
                }

                const assetsDir = path.join(projectRoot, 'assets');
                const targetPath = path.join(assetsDir, fileName);

                if (!fs.existsSync(targetPath)) {
                    await fs.promises.copyFile(filePath, targetPath);
                }

                const vfsPath = `/${fileName}`;
                this._panel.webview.postMessage({
                    command: 'fontPathSelected',
                    componentId,
                    path: vfsPath
                });

                logger.info(`[AssetManager] 字体文件已选择: ${vfsPath}`);
            }
        } catch (error) {
            logger.error(`[AssetManager] 选择字体文件失败: ${error}`);
            vscode.window.showErrorMessage('选择字体文件失败');
        }
    }

    public async handleSelectMapPath(componentId: string, currentFilePath: string | undefined): Promise<void> {
        try {
            const options: vscode.OpenDialogOptions = {
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                defaultUri: this.getDefaultDialogUri(currentFilePath),
                filters: {
                    'Map Files': ['trmap']
                },
                openLabel: '选择地图文件'
            };

            const fileUri = await vscode.window.showOpenDialog(options);
            if (fileUri && fileUri.length > 0) {
                const filePath = fileUri[0].fsPath;
                const fileName = path.basename(filePath);

                AssetManager.rememberPath(filePath, false);

                if (!currentFilePath) {
                    vscode.window.showErrorMessage('无法确定项目路径');
                    return;
                }

                const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
                if (!projectRoot) {
                    vscode.window.showErrorMessage('无法找到项目根目录');
                    return;
                }

                const assetsDir = path.join(projectRoot, 'assets');
                const targetPath = path.join(assetsDir, fileName);

                if (!fs.existsSync(targetPath)) {
                    await fs.promises.copyFile(filePath, targetPath);
                }

                const vfsPath = `/${fileName}`;
                this._panel.webview.postMessage({
                    command: 'mapPathSelected',
                    componentId,
                    path: vfsPath
                });

                logger.info(`[AssetManager] 地图文件已选择: ${vfsPath}`);
            }
        } catch (error) {
            logger.error(`[AssetManager] 选择地图文件失败: ${error}`);
            vscode.window.showErrorMessage('选择地图文件失败');
        }
    }

    /**
     * Get asset file metadata (dimensions, file size) for display in config panel
     */
    public async handleGetAssetMetadata(
        relativePath: string,
        currentFilePath: string | undefined
    ): Promise<void> {
        try {
            if (!currentFilePath) {
                return;
            }

            const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
            if (!projectRoot) {
                return;
            }

            const assetsDir = ProjectUtils.getAssetsDir(projectRoot);
            const absolutePath = path.join(assetsDir, relativePath);

            if (!fs.existsSync(absolutePath)) {
                return;
            }

            const stats = fs.statSync(absolutePath);
            const ext = path.extname(absolutePath).toLowerCase();
            const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'];
            const videoExts = ['.mp4', '.avi', '.mov', '.mkv', '.webm'];

            const metadata: any = {
                relativePath,
                fileSize: stats.size,
            };

            if (imageExts.includes(ext)) {
                const size = this.getImageSize(absolutePath);
                if (size.width > 0 && size.height > 0) {
                    metadata.width = size.width;
                    metadata.height = size.height;
                }
            } else if (videoExts.includes(ext)) {
                const size = await this.getVideoSizeAsync(absolutePath);
                if (size.width > 0 && size.height > 0) {
                    metadata.width = size.width;
                    metadata.height = size.height;
                }
            }

            this._panel.webview.postMessage({
                command: 'assetMetadata',
                metadata
            });
        } catch (error) {
            logger.error(`[AssetManager] Failed to get asset metadata: ${error}`);
        }
    }

    /**
     * 处理获取图片尺寸请求
     */
    public handleGetImageSize(
        imagePath: string,
        dropPosition: { x: number; y: number },
        targetContainerId: string,
        currentFilePath: string | undefined
    ): void {
        try {
            if (!currentFilePath) {
                return;
            }

            const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
            if (!projectRoot) {
                return;
            }

            const absolutePath = path.join(projectRoot, imagePath);
            const imageSize = this.getImageSize(absolutePath);

            this._panel.webview.postMessage({
                command: 'createImageComponent',
                imagePath,
                dropPosition,
                targetContainerId,
                imageSize
            });
        } catch (error) {
            logger.error(`[AssetManager] 获取图片尺寸失败: ${error}`);
        }
    }

    /**
     * 处理获取 GIF 尺寸请求
     */
    public handleGetGifSize(
        gifPath: string,
        dropPosition: { x: number; y: number },
        targetContainerId: string,
        currentFilePath: string | undefined
    ): void {
        try {
            if (!currentFilePath) {
                return;
            }

            const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
            if (!projectRoot) {
                return;
            }

            const absolutePath = path.join(projectRoot, gifPath);
            const imageSize = this.getImageSize(absolutePath);

            this._panel.webview.postMessage({
                command: 'createGifComponent',
                gifPath,
                dropPosition,
                targetContainerId,
                imageSize
            });
        } catch (error) {
            logger.error(`[AssetManager] 获取 GIF 尺寸失败: ${error}`);
        }
    }

    /**
     * 处理获取图片尺寸并更新现有组件
     */
    public handleGetImageSizeForComponent(
        componentId: string,
        imagePath: string,
        currentFilePath: string | undefined
    ): void {
        try {
            if (!currentFilePath || !componentId || !imagePath) {
                return;
            }

            const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
            if (!projectRoot) {
                return;
            }

            const absolutePath = path.join(projectRoot, imagePath);
            if (!fs.existsSync(absolutePath)) {
                return;
            }

            const imageSize = this.getImageSize(absolutePath);

            this._panel.webview.postMessage({
                command: 'updateImagePath',
                componentId,
                path: imagePath,
                imageSize
            });
        } catch (error) {
            logger.error(`[AssetManager] 获取图片尺寸失败: ${error}`);
        }
    }

    /**
     * 处理创建3D组件请求
     */
    public handleCreate3DComponent(
        modelPath: string,
        dropPosition: { x: number; y: number },
        targetContainerId: string,
        currentFilePath: string | undefined
    ): void {
        try {
            if (!currentFilePath) {
                return;
            }

            this._panel.webview.postMessage({
                command: 'create3DComponent',
                modelPath,
                dropPosition,
                targetContainerId
            });
        } catch (error) {
            logger.error(`[AssetManager] 创建3D组件失败: ${error}`);
        }
    }

    /**
     * 处理获取视频尺寸请求
     */
    public async handleGetVideoSize(
        videoPath: string,
        dropPosition: { x: number; y: number },
        targetContainerId: string,
        currentFilePath: string | undefined
    ): Promise<void> {
        try {
            if (!currentFilePath) {
                return;
            }

            const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
            if (!projectRoot) {
                return;
            }

            const absolutePath = path.join(projectRoot, videoPath);
            const videoSize = await this.getVideoSizeAsync(absolutePath);

            this._panel.webview.postMessage({
                command: 'createVideoComponent',
                videoPath,
                dropPosition,
                targetContainerId,
                videoSize
            });
        } catch (error) {
            logger.error(`[AssetManager] 获取视频尺寸失败: ${error}`);
        }
    }

    /**
     * 处理属性面板获取视频尺寸请求
     */
    public async handleGetVideoSizeForProperty(
        videoPath: string,
        componentId: string,
        currentFilePath: string | undefined
    ): Promise<void> {
        try {
            if (!currentFilePath) {
                return;
            }

            const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
            if (!projectRoot) {
                return;
            }

            const absolutePath = path.join(projectRoot, videoPath);
            const videoSize = await this.getVideoSizeAsync(absolutePath);

            this._panel.webview.postMessage({
                command: 'updateVideoSize',
                componentId,
                videoSize
            });
        } catch (error) {
            logger.error(`[AssetManager] 获取视频尺寸失败: ${error}`);
        }
    }

    /**
     * 处理画布组件获取视频自然尺寸请求（不修改组件状态，仅用于 VideoWidget 预览）
     */
    public async handleGetVideoNaturalSize(
        videoPath: string,
        currentFilePath: string | undefined
    ): Promise<void> {
        try {
            if (!currentFilePath) {
                return;
            }

            const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
            if (!projectRoot) {
                return;
            }

            const absolutePath = path.join(projectRoot, videoPath);
            const videoSize = await this.getVideoSizeAsync(absolutePath);

            this._panel.webview.postMessage({
                command: 'videoNaturalSizeResult',
                videoPath,
                width: videoSize.width,
                height: videoSize.height
            });
        } catch (error) {
            logger.error(`[AssetManager] 获取视频自然尺寸失败: ${error}`);
        }
    }

    /**
     * 处理创建视频组件请求（已废弃，使用 handleGetVideoSize）
     */
    public handleCreateVideoComponent(
        videoPath: string,
        dropPosition: { x: number; y: number },
        targetContainerId: string,
        currentFilePath: string | undefined
    ): void {
        try {
            if (!currentFilePath) {
                return;
            }

            this._panel.webview.postMessage({
                command: 'createVideoComponent',
                videoPath,
                dropPosition,
                targetContainerId
            });
        } catch (error) {
            logger.error(`[AssetManager] 创建视频组件失败: ${error}`);
        }
    }

    /**
     * 处理创建 SVG 组件请求
     */
    public handleCreateSvgComponent(
        svgPath: string,
        dropPosition: { x: number; y: number },
        targetContainerId: string,
        currentFilePath: string | undefined
    ): void {
        try {
            if (!currentFilePath) {
                return;
            }

            // 获取 SVG 尺寸
            const projectRoot = path.dirname(path.dirname(currentFilePath));
            const fullPath = path.join(projectRoot, svgPath);
            const size = this.getSvgSize(fullPath);

            this._panel.webview.postMessage({
                command: 'createSvgComponent',
                svgPath,
                dropPosition,
                targetContainerId,
                size
            });
        } catch (error) {
            logger.error(`[AssetManager] 创建 SVG 组件失败: ${error}`);
        }
    }

    /**
     * 处理创建 Glass 组件请求
     */
    public handleCreateGlassComponent(
        glassPath: string,
        dropPosition: { x: number; y: number },
        targetContainerId: string,
        currentFilePath: string | undefined
    ): void {
        try {
            if (!currentFilePath) {
                return;
            }

            // 获取 Glass 文件尺寸（按 SVG 格式解析）
            const projectRoot = path.dirname(path.dirname(currentFilePath));
            const fullPath = path.join(projectRoot, glassPath);
            const size = this.getSvgSize(fullPath);

            this._panel.webview.postMessage({
                command: 'createGlassComponent',
                glassPath,
                dropPosition,
                targetContainerId,
                size
            });
        } catch (error) {
            logger.error(`[AssetManager] 创建 Glass 组件失败: ${error}`);
        }
    }

    /**
     * 处理创建 Lottie 组件请求
     */
    public handleCreateLottieComponent(
        lottiePath: string,
        dropPosition: { x: number; y: number },
        targetContainerId: string,
        currentFilePath: string | undefined
    ): void {
        try {
            if (!currentFilePath) {
                return;
            }

            // 获取 Lottie 文件尺寸（目前默认为 150x150，或者可以尝试读取 json）
            // 这里简单处理，前端默认值
            
            this._panel.webview.postMessage({
                command: 'createLottieComponent',
                lottiePath,
                dropPosition,
                targetContainerId
            });
        } catch (error) {
            logger.error(`[AssetManager] 创建 Lottie 组件失败: ${error}`);
        }
    }

    /**
     * 获取 SVG 尺寸
     */
    private getSvgSize(filePath: string): { width: number; height: number } {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            
            // 解析 SVG 中的图形元素，计算实际边界
            const bbox = this.calculateSvgGraphicsBoundingBox(content);
            if (bbox) {
                const width = Math.ceil(bbox.maxX - bbox.minX);
                const height = Math.ceil(bbox.maxY - bbox.minY);
                if (width > 0 && height > 0) {
                    return { width, height };
                }
            }
            
            // 如果无法计算边界，回退到 SVG 属性
            const widthMatch = content.match(/width\s*=\s*["']?(\d+)/);
            const heightMatch = content.match(/height\s*=\s*["']?(\d+)/);
            
            const width = widthMatch ? parseInt(widthMatch[1], 10) : 100;
            const height = heightMatch ? parseInt(heightMatch[1], 10) : 100;
            
            return { width, height };
        } catch (error) {
            return { width: 100, height: 100 };
        }
    }

    /**
     * 计算 SVG 图形元素的边界框（与 glass generator 逻辑一致）
     */
    private calculateSvgGraphicsBoundingBox(svgContent: string): { minX: number; minY: number; maxX: number; maxY: number } | null {
        const points: Array<{x: number, y: number}> = [];
        
        // 解析 <path d="..."> 元素
        const pathPattern = /<path[^>]*\sd="([^"]*)"[^>]*>/gi;
        let match;
        while ((match = pathPattern.exec(svgContent)) !== null) {
            const pathData = match[1].trim();
            if (pathData) {
                points.push(...this.svgPathToPoints(pathData));
            }
        }
        
        // 解析 <polygon points="..."> 元素
        const polygonPattern = /<polygon[^>]*\spoints="([^"]*)"[^>]*>/gi;
        while ((match = polygonPattern.exec(svgContent)) !== null) {
            const pointsData = match[1].trim();
            if (pointsData) {
                points.push(...this.parsePolygonPoints(pointsData));
            }
        }
        
        // 解析 <polyline points="..."> 元素
        const polylinePattern = /<polyline[^>]*\spoints="([^"]*)"[^>]*>/gi;
        while ((match = polylinePattern.exec(svgContent)) !== null) {
            const pointsData = match[1].trim();
            if (pointsData) {
                points.push(...this.parsePolygonPoints(pointsData));
            }
        }
        
        // 解析 <circle> 元素
        const circlePattern = /<circle[^>]*>/gi;
        while ((match = circlePattern.exec(svgContent)) !== null) {
            const circlePoints = this.parseCirclePoints(match[0]);
            if (circlePoints) {
                points.push(...circlePoints);
            }
        }
        
        // 解析 <ellipse> 元素
        const ellipsePattern = /<ellipse[^>]*>/gi;
        while ((match = ellipsePattern.exec(svgContent)) !== null) {
            const ellipsePoints = this.parseEllipsePoints(match[0]);
            if (ellipsePoints) {
                points.push(...ellipsePoints);
            }
        }
        
        if (points.length === 0) {
            return null;
        }
        
        // 计算边界
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of points) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
        
        return { minX, minY, maxX, maxY };
    }

    /**
     * 将 SVG path d 属性转换为点数组
     */
    private svgPathToPoints(pathData: string): Array<{x: number, y: number}> {
        const points: Array<{x: number, y: number}> = [];
        const commandPattern = /([MLHVCSQTAZ])\s*([^MLHVCSQTAZ]*)/gi;
        let currentX = 0, currentY = 0;
        let match;

        while ((match = commandPattern.exec(pathData)) !== null) {
            const cmd = match[1].toUpperCase();
            const params = match[2].trim();
            const numbers = params.match(/-?\d+\.?\d*/g)?.map(Number) || [];

            switch (cmd) {
                case 'M':
                case 'L':
                    if (numbers.length >= 2) {
                        currentX = numbers[0];
                        currentY = numbers[1];
                        points.push({ x: currentX, y: currentY });
                    }
                    break;
                case 'H':
                    if (numbers.length >= 1) {
                        currentX = numbers[0];
                        points.push({ x: currentX, y: currentY });
                    }
                    break;
                case 'V':
                    if (numbers.length >= 1) {
                        currentY = numbers[0];
                        points.push({ x: currentX, y: currentY });
                    }
                    break;
                case 'C':
                    // 三次贝塞尔曲线：采样多个点
                    if (numbers.length >= 6) {
                        const p0 = { x: currentX, y: currentY };
                        const p1 = { x: numbers[0], y: numbers[1] };
                        const p2 = { x: numbers[2], y: numbers[3] };
                        const p3 = { x: numbers[4], y: numbers[5] };
                        
                        for (let i = 1; i <= 16; i++) {
                            const t = i / 16;
                            points.push(this.cubicBezierPoint(t, p0, p1, p2, p3));
                        }
                        
                        currentX = numbers[4];
                        currentY = numbers[5];
                    }
                    break;
                case 'Q':
                    if (numbers.length >= 4) {
                        currentX = numbers[2];
                        currentY = numbers[3];
                        points.push({ x: currentX, y: currentY });
                    }
                    break;
            }
        }

        return points;
    }

    /**
     * 计算三次贝塞尔曲线上的点
     */
    private cubicBezierPoint(
        t: number,
        p0: {x: number, y: number},
        p1: {x: number, y: number},
        p2: {x: number, y: number},
        p3: {x: number, y: number}
    ): {x: number, y: number} {
        const t2 = t * t;
        const t3 = t2 * t;
        const mt = 1 - t;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;
        
        return {
            x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
            y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y
        };
    }

    /**
     * 解析 polygon/polyline 的 points 属性
     */
    private parsePolygonPoints(pointsData: string): Array<{x: number, y: number}> {
        const numbers = pointsData.match(/-?\d+\.?\d*/g)?.map(Number);
        if (!numbers || numbers.length < 4) return [];
        
        const points: Array<{x: number, y: number}> = [];
        for (let i = 0; i < numbers.length - 1; i += 2) {
            points.push({ x: numbers[i], y: numbers[i + 1] });
        }
        return points;
    }

    /**
     * 解析 circle 元素的边界点
     */
    private parseCirclePoints(circleTag: string): Array<{x: number, y: number}> | null {
        const cxMatch = circleTag.match(/\bcx\s*=\s*["']?(-?\d+\.?\d*)["']?/i);
        const cyMatch = circleTag.match(/\bcy\s*=\s*["']?(-?\d+\.?\d*)["']?/i);
        const rMatch = circleTag.match(/\br\s*=\s*["']?(-?\d+\.?\d*)["']?/i);
        
        const cx = cxMatch ? parseFloat(cxMatch[1]) : 0;
        const cy = cyMatch ? parseFloat(cyMatch[1]) : 0;
        const r = rMatch ? parseFloat(rMatch[1]) : 0;
        
        if (r <= 0) return null;
        
        // 返回圆的四个极值点
        return [
            { x: cx - r, y: cy },
            { x: cx + r, y: cy },
            { x: cx, y: cy - r },
            { x: cx, y: cy + r }
        ];
    }

    /**
     * 解析 ellipse 元素的边界点
     */
    private parseEllipsePoints(ellipseTag: string): Array<{x: number, y: number}> | null {
        const cxMatch = ellipseTag.match(/\bcx\s*=\s*["']?(-?\d+\.?\d*)["']?/i);
        const cyMatch = ellipseTag.match(/\bcy\s*=\s*["']?(-?\d+\.?\d*)["']?/i);
        const rxMatch = ellipseTag.match(/\brx\s*=\s*["']?(-?\d+\.?\d*)["']?/i);
        const ryMatch = ellipseTag.match(/\bry\s*=\s*["']?(-?\d+\.?\d*)["']?/i);
        
        const cx = cxMatch ? parseFloat(cxMatch[1]) : 0;
        const cy = cyMatch ? parseFloat(cyMatch[1]) : 0;
        const rx = rxMatch ? parseFloat(rxMatch[1]) : 0;
        const ry = ryMatch ? parseFloat(ryMatch[1]) : 0;
        
        if (rx <= 0 || ry <= 0) return null;
        
        // 返回椭圆的四个极值点
        return [
            { x: cx - rx, y: cy },
            { x: cx + rx, y: cy },
            { x: cx, y: cy - ry },
            { x: cx, y: cy + ry }
        ];
    }

    /**
     * 获取图片尺寸
     */
    private getImageSize(filePath: string): { width: number; height: number } {
        try {
            const buffer = fs.readFileSync(filePath);
            
            // PNG
            if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
                const width = buffer.readUInt32BE(16);
                const height = buffer.readUInt32BE(20);
                return { width, height };
            }
            
            // JPEG
            if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
                let offset = 2;
                while (offset < buffer.length) {
                    if (buffer[offset] !== 0xFF) break;
                    const marker = buffer[offset + 1];
                    if (marker === 0xC0 || marker === 0xC2) {
                        const height = buffer.readUInt16BE(offset + 5);
                        const width = buffer.readUInt16BE(offset + 7);
                        return { width, height };
                    }
                    offset += 2 + buffer.readUInt16BE(offset + 2);
                }
            }
            
            // BMP
            if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
                const width = buffer.readInt32LE(18);
                const height = Math.abs(buffer.readInt32LE(22)); // 高度可能为负（表示自上而下）
                return { width, height };
            }
            
            // GIF
            if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
                const width = buffer.readUInt16LE(6);
                const height = buffer.readUInt16LE(8);
                return { width, height };
            }
            
            return { width: 100, height: 100 };
        } catch (error) {
            logger.error(`[AssetManager] 读取图片尺寸失败: ${error}`);
            return { width: 100, height: 100 };
        }
    }

    /**
     * 获取视频尺寸（异步）
     */
    private async getVideoSizeAsync(filePath: string): Promise<{ width: number; height: number }> {
        try {
            // 检查文件扩展名
            const ext = path.extname(filePath).toLowerCase();
            
            // 只处理 MP4 格式
            if (ext !== '.mp4') {
                logger.info(`[AssetManager] 非 MP4 格式视频，使用默认尺寸: ${ext}`);
                return { width: 320, height: 240 };
            }

            // 读取文件
            const buffer = fs.readFileSync(filePath);
            const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

            // 创建 MP4Box 文件对象
            const mp4boxfile = MP4Box.createFile();
            
            return new Promise((resolve) => {
                let resolved = false;

                // 设置回调
                mp4boxfile.onReady = (info: any) => {
                    if (!resolved) {
                        resolved = true;
                        if (info.videoTracks && info.videoTracks.length > 0) {
                            const track = info.videoTracks[0];
                            resolve({
                                width: Math.round(track.track_width) || 320,
                                height: Math.round(track.track_height) || 240
                            });
                        } else {
                            resolve({ width: 320, height: 240 });
                        }
                    }
                };

                mp4boxfile.onError = (e: any) => {
                    if (!resolved) {
                        resolved = true;
                        logger.warn(`[AssetManager] MP4Box 解析失败: ${e}`);
                        resolve({ width: 320, height: 240 });
                    }
                };

                // 添加 buffer（需要添加 fileStart 属性）
                const mp4Buffer = arrayBuffer as any;
                mp4Buffer.fileStart = 0;
                mp4boxfile.appendBuffer(mp4Buffer);
                mp4boxfile.flush();

                // 超时保护
                setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        logger.warn(`[AssetManager] MP4Box 解析超时`);
                        resolve({ width: 320, height: 240 });
                    }
                }, 3000);
            });
        } catch (error) {
            logger.warn(`[AssetManager] 读取视频尺寸失败: ${error}`);
            return { width: 320, height: 240 };
        }
    }

    /**
     * 获取视频尺寸（同步版本，用于兼容）
     */
    private getVideoSize(filePath: string): { width: number; height: number } {
        try {
            // 检查文件扩展名
            const ext = path.extname(filePath).toLowerCase();
            
            // 只处理 MP4 格式
            if (ext !== '.mp4') {
                logger.info(`[AssetManager] 非 MP4 格式视频，使用默认尺寸: ${ext}`);
                return { width: 320, height: 240 };
            }

            // 读取文件
            const buffer = fs.readFileSync(filePath);
            const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

            // 创建 MP4Box 文件对象
            const mp4boxfile = MP4Box.createFile();
            
            let videoSize = { width: 320, height: 240 };

            // 设置回调
            mp4boxfile.onReady = (info: any) => {
                if (info.videoTracks && info.videoTracks.length > 0) {
                    const track = info.videoTracks[0];
                    videoSize = {
                        width: Math.round(track.track_width) || 320,
                        height: Math.round(track.track_height) || 240
                    };
                }
            };

            mp4boxfile.onError = (e: any) => {
                logger.warn(`[AssetManager] MP4Box 解析失败: ${e}`);
            };

            // 添加 buffer（需要添加 fileStart 属性）
            const mp4Buffer = arrayBuffer as any;
            mp4Buffer.fileStart = 0;
            mp4boxfile.appendBuffer(mp4Buffer);
            mp4boxfile.flush();

            return videoSize;
        } catch (error) {
            logger.warn(`[AssetManager] 读取视频尺寸失败: ${error}`);
            return { width: 320, height: 240 };
        }
    }

    /**
     * 处理转换路径为 webview URI 的请求
     */
    public handleConvertPathToWebviewUri(relativePath: string, requestId: string, currentFilePath: string | undefined): void {
        try {
            if (!currentFilePath) {
                this._panel.webview.postMessage({
                    command: 'webviewUriConverted',
                    requestId,
                    uri: relativePath,
                    error: '没有文件路径'
                });
                return;
            }

            const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
            if (!projectRoot) {
                this._panel.webview.postMessage({
                    command: 'webviewUriConverted',
                    requestId,
                    uri: relativePath,
                    error: '未找到项目根目录'
                });
                return;
            }

            // 转换相对路径为绝对路径
            const absolutePath = path.join(projectRoot, relativePath);
            const webviewUri = this._panel.webview.asWebviewUri(vscode.Uri.file(absolutePath));

            this._panel.webview.postMessage({
                command: 'webviewUriConverted',
                requestId,
                uri: webviewUri.toString()
            });
        } catch (error) {
            this._panel.webview.postMessage({
                command: 'webviewUriConverted',
                requestId,
                uri: relativePath,
                error: error instanceof Error ? error.message : '转换失败'
            });
        }
    }

    /**
     * 检测字体是否支持指定文本中的所有字符
     * 通过解析 TTF/OTF 文件的 cmap 表获取支持的字符集
     */
    public async handleCheckFontGlyphs(
        fontPath: string,
        text: string,
        requestId: string,
        currentFilePath: string | undefined
    ): Promise<void> {
        try {
            if (!currentFilePath || !fontPath || !text) {
                this._panel.webview.postMessage({
                    command: 'fontGlyphCheckResult',
                    requestId,
                    supported: true,
                    missingChars: []
                });
                return;
            }

            const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
            if (!projectRoot) {
                this._panel.webview.postMessage({
                    command: 'fontGlyphCheckResult',
                    requestId,
                    supported: true,
                    missingChars: []
                });
                return;
            }

            // fontPath 格式为 /font/xxx.ttf，需要转换为 assets/font/xxx.ttf
            const absolutePath = path.join(projectRoot, 'assets', fontPath.replace(/^\//, ''));
            
            if (!fs.existsSync(absolutePath)) {
                logger.warn(`[字形检测] 字体文件不存在: ${absolutePath}`);
                this._panel.webview.postMessage({
                    command: 'fontGlyphCheckResult',
                    requestId,
                    supported: true,
                    missingChars: []
                });
                return;
            }

            // 解析字体文件获取支持的字符集
            const supportedChars = this.parseFontCmap(absolutePath);
            
            // 检测文本中哪些字符不被支持
            const uniqueChars = [...new Set(text)];
            const missingChars: string[] = [];
            
            for (const char of uniqueChars) {
                // 跳过空白字符
                if (/\s/.test(char)) continue;
                
                const codePoint = char.codePointAt(0);
                if (codePoint !== undefined && !supportedChars.has(codePoint)) {
                    missingChars.push(char);
                }
            }

            this._panel.webview.postMessage({
                command: 'fontGlyphCheckResult',
                requestId,
                supported: missingChars.length === 0,
                missingChars
            });
        } catch (error) {
            logger.error(`[字形检测] 检测失败: ${error}`);
            this._panel.webview.postMessage({
                command: 'fontGlyphCheckResult',
                requestId,
                supported: true,
                missingChars: []
            });
        }
    }

    /**
     * 解析 TTF/OTF 字体文件的 cmap 表，获取支持的字符码点集合
     */
    private parseFontCmap(fontPath: string): Set<number> {
        const supportedChars = new Set<number>();
        
        try {
            const buffer = fs.readFileSync(fontPath);
            
            // 读取字体文件头
            const sfntVersion = buffer.readUInt32BE(0);
            // 0x00010000 = TrueType, 0x4F54544F = 'OTTO' (OpenType with CFF)
            if (sfntVersion !== 0x00010000 && sfntVersion !== 0x4F54544F) {
                logger.warn(`[字形检测] 不支持的字体格式: ${sfntVersion.toString(16)}`);
                return supportedChars;
            }

            const numTables = buffer.readUInt16BE(4);
            
            // 查找 cmap 表
            let cmapOffset = 0;
            for (let i = 0; i < numTables; i++) {
                const tableOffset = 12 + i * 16;
                const tag = buffer.toString('ascii', tableOffset, tableOffset + 4);
                if (tag === 'cmap') {
                    cmapOffset = buffer.readUInt32BE(tableOffset + 8);
                    break;
                }
            }

            if (cmapOffset === 0) {
                logger.warn(`[字形检测] 未找到 cmap 表`);
                return supportedChars;
            }

            // 解析 cmap 表
            const cmapVersion = buffer.readUInt16BE(cmapOffset);
            const numSubtables = buffer.readUInt16BE(cmapOffset + 2);

            // 查找最佳的子表（优先 Unicode BMP 或 Full Unicode）
            let bestSubtableOffset = 0;
            let bestPriority = -1;

            for (let i = 0; i < numSubtables; i++) {
                const subtableOffset = cmapOffset + 4 + i * 8;
                const platformID = buffer.readUInt16BE(subtableOffset);
                const encodingID = buffer.readUInt16BE(subtableOffset + 2);
                const offset = buffer.readUInt32BE(subtableOffset + 4);

                // 优先级：Unicode Full (0,4) > Unicode BMP (0,3) > Windows Unicode BMP (3,1) > Windows Unicode Full (3,10)
                let priority = -1;
                if (platformID === 0 && encodingID === 4) priority = 4; // Unicode Full
                else if (platformID === 0 && encodingID === 3) priority = 3; // Unicode BMP
                else if (platformID === 3 && encodingID === 10) priority = 2; // Windows Unicode Full
                else if (platformID === 3 && encodingID === 1) priority = 1; // Windows Unicode BMP

                if (priority > bestPriority) {
                    bestPriority = priority;
                    bestSubtableOffset = cmapOffset + offset;
                }
            }

            if (bestSubtableOffset === 0) {
                logger.warn(`[字形检测] 未找到合适的 cmap 子表`);
                return supportedChars;
            }

            // 解析子表
            const format = buffer.readUInt16BE(bestSubtableOffset);
            
            if (format === 4) {
                // Format 4: Segment mapping to delta values (BMP only)
                this.parseCmapFormat4(buffer, bestSubtableOffset, supportedChars);
            } else if (format === 12) {
                // Format 12: Segmented coverage (Full Unicode)
                this.parseCmapFormat12(buffer, bestSubtableOffset, supportedChars);
            } else {
                logger.warn(`[字形检测] 不支持的 cmap 格式: ${format}`);
            }

        } catch (error) {
            logger.error(`[字形检测] 解析字体文件失败: ${error}`);
        }

        return supportedChars;
    }

    /**
     * 解析 cmap Format 4 子表（BMP 字符）
     */
    private parseCmapFormat4(buffer: Buffer, offset: number, supportedChars: Set<number>): void {
        const segCountX2 = buffer.readUInt16BE(offset + 6);
        const segCount = segCountX2 / 2;

        const endCodeOffset = offset + 14;
        const startCodeOffset = endCodeOffset + segCountX2 + 2; // +2 for reservedPad
        const idDeltaOffset = startCodeOffset + segCountX2;
        const idRangeOffsetOffset = idDeltaOffset + segCountX2;

        for (let i = 0; i < segCount; i++) {
            const endCode = buffer.readUInt16BE(endCodeOffset + i * 2);
            const startCode = buffer.readUInt16BE(startCodeOffset + i * 2);
            const idDelta = buffer.readInt16BE(idDeltaOffset + i * 2);
            const idRangeOffset = buffer.readUInt16BE(idRangeOffsetOffset + i * 2);

            if (startCode === 0xFFFF) break;

            for (let charCode = startCode; charCode <= endCode; charCode++) {
                let glyphIndex: number;
                
                if (idRangeOffset === 0) {
                    glyphIndex = (charCode + idDelta) & 0xFFFF;
                } else {
                    const glyphIndexOffset = idRangeOffsetOffset + i * 2 + idRangeOffset + (charCode - startCode) * 2;
                    glyphIndex = buffer.readUInt16BE(glyphIndexOffset);
                    if (glyphIndex !== 0) {
                        glyphIndex = (glyphIndex + idDelta) & 0xFFFF;
                    }
                }

                if (glyphIndex !== 0) {
                    supportedChars.add(charCode);
                }
            }
        }
    }

    /**
     * 解析 cmap Format 12 子表（Full Unicode）
     */
    private parseCmapFormat12(buffer: Buffer, offset: number, supportedChars: Set<number>): void {
        const numGroups = buffer.readUInt32BE(offset + 12);

        for (let i = 0; i < numGroups; i++) {
            const groupOffset = offset + 16 + i * 12;
            const startCharCode = buffer.readUInt32BE(groupOffset);
            const endCharCode = buffer.readUInt32BE(groupOffset + 4);
            const startGlyphID = buffer.readUInt32BE(groupOffset + 8);

            for (let charCode = startCharCode; charCode <= endCharCode; charCode++) {
                const glyphID = startGlyphID + (charCode - startCharCode);
                if (glyphID !== 0) {
                    supportedChars.add(charCode);
                }
            }
        }
    }
}
