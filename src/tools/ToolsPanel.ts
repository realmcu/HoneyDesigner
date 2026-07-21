import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../utils/Logger';
import { RomfsConfig } from '../common/RomfsConfig';
import { ImageConverterService } from '../services/ImageConverterService';
import { VideoConverterService } from '../services/VideoConverterService';
import { Model3DConverterService } from '../services/Model3DConverterService';
import { FontConverterService } from '../services/FontConverterService';
import { GlassConverterService } from '../services/GlassConverterService';
import { ConversionConfigService, ConversionConfig, TargetFormat, YuvBlur, ItemSettings } from '../services/ConversionConfigService';
import { getToolsPanelHtml, getToolsPanelTranslations } from './ToolsPanelHtml';
import { CharsetProcessor } from '../../tools/font-converter/src/charset-processor';
import { CharacterSetSource } from '../../tools/font-converter/src/types/config';
import { CharsetSourceResolver } from '../utils/CharsetSourceResolver';
import { parseFontCmap } from '../utils/fontCmapParser';
import { bufferHasAlpha } from '../utils/imageAlpha';
import * as os from 'os';

interface FileItem {
    id: string;
    name: string;
    relativePath: string;
    type: 'image' | 'video' | 'model' | 'font' | 'glass' | 'trmap' | 'unknown';
    data: number[];
    settings?: any;
}

export class ToolsPanel {
    public static currentPanel: ToolsPanel | undefined;
    private static readonly viewType = 'honeygui.toolsPanel';

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];

    private imageConverter: ImageConverterService;
    private videoConverter: VideoConverterService;
    private model3DConverter: Model3DConverterService;
    private fontConverter: FontConverterService;
    private glassConverter: GlassConverterService;

    private files: Map<string, FileItem> = new Map();
    private folderSettings: Map<string, any> = new Map();
    private outputDir: string = '';
    private inputDir: string = '';  // 输入目录（用于读取 conversion.json）
    private conversionConfig: ConversionConfig | null = null;  // 从 conversion.json 加载的配置

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.imageConverter = new ImageConverterService();
        this.videoConverter = new VideoConverterService(msg => logger.info(msg));
        this.model3DConverter = new Model3DConverterService();
        this.fontConverter = new FontConverterService();
        this.glassConverter = new GlassConverterService();

        this.panel.webview.html = getToolsPanelHtml(getToolsPanelTranslations());
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg), null, this.disposables);
    }

    public static createOrShow(extensionUri: vscode.Uri): void {
        if (ToolsPanel.currentPanel) {
            ToolsPanel.currentPanel.panel.reveal();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            ToolsPanel.viewType, vscode.l10n.t('Resource Conversion Tool'), vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        ToolsPanel.currentPanel = new ToolsPanel(panel, extensionUri);
    }

    private getFileType(fileName: string): 'image' | 'video' | 'model' | 'font' | 'glass' | 'trmap' | 'unknown' {
        const ext = path.extname(fileName).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.bmp', '.gif'].includes(ext)) return 'image';
        if (['.mp4', '.avi', '.mov', '.mkv', '.webm'].includes(ext)) return 'video';
        if (['.obj', '.gltf', '.mtl'].includes(ext)) return 'model';
        if (['.ttf', '.otf'].includes(ext)) return 'font';
        if (['.glass'].includes(ext)) return 'glass';
        if (['.trmap'].includes(ext)) return 'trmap';
        
        // .bin 文件需要特殊处理：只有当存在同名 .gltf 文件时才识别为 model 类型
        if (ext === '.bin') {
            // 这个判断会在 addFile 时进行，这里先返回 unknown
            // 实际判断在 handleMessage 的 addFile 中
            return 'unknown';
        }
        
        return 'unknown';
    }
    
    /**
     * 检查 bin 文件是否是 GLTF 的辅助文件
     */
    private isGltfBufferFile(fileName: string, relativePath: string): boolean {
        const gltfName = fileName.replace(/\.bin$/i, '.gltf');
        // 检查是否有同名的 gltf 文件
        return Array.from(this.files.values()).some(
            f => f.name === gltfName && f.relativePath === relativePath
        );
    }

    private async handleMessage(message: any): Promise<void> {
        switch (message.type) {
            case 'addFile':
                this.addFile(message.id, message.name, message.relativePath, message.data);
                break;
            case 'copyFileToOrigin':
                await this.copyFileToOrigin(message.id, message.name, message.relativePath, message.data);
                break;
            case 'removeFile':
                this.files.delete(message.id);
                // 同时删除硬盘上的文件
                await this.deleteFileFromOrigin(message.id, message.name, message.relativePath);
                break;
            case 'removeFolder':
                // 删除文件夹及其所有内容
                await this.deleteFolderFromOrigin(message.folderPath);
                break;
            case 'clearFiles':
                this.files.clear();
                this.folderSettings.clear();
                this.conversionConfig = null;
                this.inputDir = '';
                break;
            case 'setInputDir':
                this.setInputDir(message.dir);
                break;
            case 'updateFileSettings':
                this.updateFileSettings(message.id, message.settings);
                break;
            case 'updateFolderSettings':
                this.folderSettings.set(message.folderPath, message.settings);
                break;
            case 'updateConversionConfig':
                await this.updateConversionConfig(message.assetPath, message.settings);
                break;
            case 'selectOutputDir':
                await this.selectOutputDir();
                break;
            case 'selectCharsetFile':
                await this.selectCharsetFile(message.charsetIdx, message.charsetType);
                break;
            case 'startConvert':
                await this.startConvert(message.baseAddr);
                break;
            case 'previewGlass':
                await this.previewGlass(message.id, message.data, message.settings);
                break;
            case 'getVideoInfo':
                await this.handleGetVideoInfo(message.id, message.name, message.relativePath);
                break;
            case 'getCharsetStats':
                await this.handleGetCharsetStats(message.id, message.characterSets, message.fontSize, message.bpp);
                break;
        }
    }

    private async handleGetCharsetStats(
        id: string,
        characterSets: CharacterSetSource[],
        fontSize: number,
        bpp: number
    ): Promise<void> {
        const effectiveFontSize = fontSize || 32;
        const effectiveBpp = bpp || 4;

        let codepoints: number[] = [];
        try {
            // 预置标识符（如 "GBK.cst"/"CP936"）先还原为插件内绝对路径再合并
            const resolved = CharsetSourceResolver.resolveAll((characterSets || []) as any) as any;
            codepoints = CharsetProcessor.mergeCharacterSources(resolved, '');
        } catch {
            // charset 解析失败时返回空
        }
        const charCount = codepoints.length;
        const estimatedSizeKB = Math.round(
            charCount * Math.ceil(effectiveFontSize * effectiveFontSize * effectiveBpp / 8) / 1024
        );

        let missingChars: string[] = [];
        const file = this.files.get(id);
        if (file?.type === 'font' && file.data?.length) {
            const tempPath = path.join(os.tmpdir(), `hg_cmap_${id}_${Date.now()}_${file.name}`);
            try {
                fs.writeFileSync(tempPath, Buffer.from(file.data));
                const cmapSet = parseFontCmap(tempPath);
                missingChars = codepoints
                    .filter(cp => !cmapSet.has(cp))
                    .map(cp => String.fromCodePoint(cp));
            } catch (error) {
                logger.warn(`[字符集统计] cmap 解析失败: ${error}`);
            } finally {
                try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
            }
        }

        this.panel.webview.postMessage({
            type: 'charsetStatsResult',
            charCount,
            estimatedSizeKB,
            missingChars,
        });
    }

    private async handleGetVideoInfo(id: string, name: string, relativePath: string): Promise<void> {
        if (!this.outputDir) {
            this.panel.webview.postMessage({ type: 'videoInfoResult', id, info: null });
            return;
        }
        const originDir = path.join(this.outputDir, 'origin');
        const filePath = path.join(originDir, relativePath || '', name);
        try {
            const info = await this.videoConverter.getVideoInfo(filePath);
            this.panel.webview.postMessage({ type: 'videoInfoResult', id, info });
        } catch (e) {
            logger.error(`getVideoInfo failed: ${e}`);
            this.panel.webview.postMessage({ type: 'videoInfoResult', id, info: null });
        }
    }

    private addFile(id: string, name: string, relativePath: string, data: number[]): void {
        let type = this.getFileType(name);
        
        // 特殊处理 .bin 文件：
        // 如果有同名 .gltf 文件，识别为 model 类型（GLTF buffer）
        // 否则可能是字体等其他类型的 bin，暂时标记为 unknown
        if (type === 'unknown' && path.extname(name).toLowerCase() === '.bin') {
            if (this.isGltfBufferFile(name, relativePath)) {
                type = 'model';
            }
            // 注意：即使是 unknown，也继续处理，让前端显示
        }
        
        // 如果添加的是 GLTF 文件，检查是否有对应的 bin 文件需要更新类型
        if (type === 'model' && path.extname(name).toLowerCase() === '.gltf') {
            const binName = name.replace(/\.gltf$/i, '.bin');
            // 查找对应的 bin 文件并更新其类型
            for (const [fileId, file] of this.files.entries()) {
                if (file.name === binName && file.relativePath === relativePath && file.type === 'unknown') {
                    file.type = 'model';
                    logger.info(`已将 ${binName} 识别为 GLTF buffer 文件`);
                    // 通知前端更新显示（如果之前没显示的话）
                    this.panel.webview.postMessage({ 
                        type: 'updateFileType', 
                        id: fileId, 
                        newType: 'model'
                    });
                    break;
                }
            }
        }
        
        this.files.set(id, { id, name, relativePath, type, data });
    }

    /**
     * 从 origin 文件夹删除文件
     */
    private async deleteFileFromOrigin(id: string, name: string, relativePath: string): Promise<void> {
        if (!this.outputDir) return;

        const originDir = path.join(this.outputDir, 'origin');
        const targetDir = relativePath ? path.join(originDir, relativePath) : originDir;
        const targetPath = path.join(targetDir, name);

        try {
            if (fs.existsSync(targetPath)) {
                fs.unlinkSync(targetPath);
                logger.info(`已从 origin 删除文件: ${targetPath}`);

                // 同时删除 conversion.json 中的配置
                if (this.conversionConfig) {
                    const configPath = relativePath ? `${relativePath}/${name}` : name;
                    const normalizedPath = configPath.replace(/\\/g, '/');
                    if (this.conversionConfig.items[normalizedPath]) {
                        delete this.conversionConfig.items[normalizedPath];
                        this.saveOriginConversionConfig();
                    }
                }

                // 检查父目录是否为空，如果为空则删除
                this.cleanEmptyDirectories(targetDir, originDir);
            }
        } catch (error) {
            logger.error(`从 origin 删除文件失败: ${error}`);
        }
    }

    /**
     * 从 origin 文件夹删除整个文件夹
     */
    private async deleteFolderFromOrigin(folderPath: string): Promise<void> {
        if (!this.outputDir) return;

        const originDir = path.join(this.outputDir, 'origin');
        const targetPath = path.join(originDir, folderPath);

        try {
            if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
                // 递归删除文件夹
                fs.rmSync(targetPath, { recursive: true, force: true });
                logger.info(`已从 origin 删除文件夹: ${targetPath}`);

                // 从内存中删除该文件夹下的所有文件
                const filesToDelete: string[] = [];
                this.files.forEach((file, id) => {
                    if (file.relativePath === folderPath || file.relativePath.startsWith(folderPath + '/')) {
                        filesToDelete.push(id);
                    }
                });
                filesToDelete.forEach(id => this.files.delete(id));

                // 删除 conversion.json 中该文件夹及其子项的配置
                if (this.conversionConfig) {
                    const normalizedFolderPath = folderPath.replace(/\\/g, '/');
                    const keysToDelete: string[] = [];
                    Object.keys(this.conversionConfig.items).forEach(key => {
                        if (key === normalizedFolderPath || key.startsWith(normalizedFolderPath + '/')) {
                            keysToDelete.push(key);
                        }
                    });
                    if (keysToDelete.length > 0) {
                        keysToDelete.forEach(key => delete this.conversionConfig!.items[key]);
                        this.saveOriginConversionConfig();
                    }
                }

                // 通知前端刷新
                this.panel.webview.postMessage({ type: 'folderDeleted', folderPath });
            }
        } catch (error) {
            logger.error(`从 origin 删除文件夹失败: ${error}`);
        }
    }

    /**
     * 清理空目录
     */
    private cleanEmptyDirectories(dirPath: string, rootPath: string): void {
        try {
            // 不删除根目录
            if (dirPath === rootPath) return;

            const files = fs.readdirSync(dirPath);
            if (files.length === 0) {
                fs.rmdirSync(dirPath);
                logger.info(`已删除空目录: ${dirPath}`);
                // 递归检查父目录
                const parentDir = path.dirname(dirPath);
                this.cleanEmptyDirectories(parentDir, rootPath);
            }
        } catch (error) {
            // 忽略错误
        }
    }

    /**
     * 复制文件到 origin 文件夹并添加到文件列表
     */
    private async copyFileToOrigin(id: string, name: string, relativePath: string, data: number[]): Promise<void> {
        let type = this.getFileType(name);
        
        // 特殊处理 .bin 文件（与 addFile 逻辑一致）
        if (type === 'unknown' && path.extname(name).toLowerCase() === '.bin') {
            // 暂时接受 bin 文件，可能是 GLTF buffer
            // 先保存到 origin，后续会判断
        } else if (type === 'unknown') {
            return;
        }
        
        if (!this.outputDir) {
            logger.error('输出目录未设置，无法复制文件到 origin');
            return;
        }

        const originDir = path.join(this.outputDir, 'origin');
        
        // 确保 origin 目录存在
        if (!fs.existsSync(originDir)) {
            fs.mkdirSync(originDir, { recursive: true });
        }

        // 确保子目录存在
        const targetDir = relativePath ? path.join(originDir, relativePath) : originDir;
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        // 检查文件是否已存在且内容相同
        const targetPath = path.join(targetDir, name);
        const newData = Buffer.from(data);
        
        if (fs.existsSync(targetPath)) {
            const existingData = fs.readFileSync(targetPath);
            if (existingData.equals(newData)) {
                // 文件内容完全相同，忽略此次添加
                logger.info(`文件已存在且内容相同，跳过: ${targetPath}`);
                this.panel.webview.postMessage({ type: 'fileDuplicate', id, name, relativePath });
                return;
            }
        }

        // 写入文件
        try {
            fs.writeFileSync(targetPath, newData);
            logger.info(`已复制文件到 origin: ${targetPath}`);
        } catch (error) {
            logger.error(`复制文件到 origin 失败: ${error}`);
            return;
        }

        // 添加到文件列表（使用与 addFile 相同的逻辑）
        this.addFile(id, name, relativePath, data);
    }

    /**
     * 设置输入目录并尝试加载 conversion.json
     */
    private setInputDir(dir: string): void {
        this.inputDir = dir;
        this.loadConversionConfig();
    }

    /**
     * 加载 conversion.json 配置文件
     * 查找顺序：输入目录 -> 输入目录的父目录（如果输入目录是 assets）
     */
    private loadConversionConfig(): void {
        if (!this.inputDir) {
            this.conversionConfig = null;
            return;
        }

        const configService = ConversionConfigService.getInstance();
        
        // 尝试从输入目录加载（假设输入目录就是 assets 目录）
        let configPath = path.join(this.inputDir, 'conversion.json');
        if (fs.existsSync(configPath)) {
            try {
                this.conversionConfig = configService.loadConfig(path.dirname(this.inputDir));
                logger.info(`已加载转换配置: ${configPath}`);
                return;
            } catch (error) {
                logger.error(`加载转换配置失败: ${error}`);
            }
        }

        // 尝试从输入目录的父目录加载（如果输入目录名为 assets）
        if (path.basename(this.inputDir).toLowerCase() === 'assets') {
            const parentDir = path.dirname(this.inputDir);
            configPath = path.join(parentDir, 'assets', 'conversion.json');
            if (fs.existsSync(configPath)) {
                try {
                    this.conversionConfig = configService.loadConfig(parentDir);
                    logger.info(`已加载转换配置: ${configPath}`);
                    return;
                } catch (error) {
                    logger.error(`加载转换配置失败: ${error}`);
                }
            }
        }

        // 没有找到配置文件，使用默认值
        this.conversionConfig = null;
        logger.info('未找到 conversion.json，将使用默认转换设置');
    }

    private updateFileSettings(id: string, settings: any): void {
        const file = this.files.get(id);
        if (file) file.settings = settings;
    }

    private async selectOutputDir(): Promise<void> {
        const result = await vscode.window.showOpenDialog({
            canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: '选择输出目录'
        });
        if (result?.[0]) {
            const selectedPath = result[0].fsPath;
            
            // 如果路径不存在，自动创建（支持 Ubuntu 等系统手动输入路径的场景）
            if (!fs.existsSync(selectedPath)) {
                try {
                    fs.mkdirSync(selectedPath, { recursive: true });
                    logger.info(`已创建输出目录: ${selectedPath}`);
                } catch (error) {
                    logger.error(`创建输出目录失败: ${error}`);
                    vscode.window.showErrorMessage(`创建目录失败: ${selectedPath}`);
                    return;
                }
            }
            
            this.outputDir = selectedPath;
            this.panel.webview.postMessage({ type: 'outputDirSelected', dir: this.outputDir });
            
            // 尝试在输出目录或其父目录查找 conversion.json
            this.tryLoadConversionConfigFromOutputDir();
            
            // 自动加载 origin 文件夹中的资源
            await this.loadOriginFolder();
        }
    }

    /**
     * 加载 origin 文件夹中的资源
     * 如果 origin 文件夹不存在则创建
     */
    private async loadOriginFolder(): Promise<void> {
        if (!this.outputDir) return;

        const originDir = path.join(this.outputDir, 'origin');
        
        // 如果 origin 文件夹不存在，创建它
        if (!fs.existsSync(originDir)) {
            try {
                fs.mkdirSync(originDir, { recursive: true });
                logger.info(`已创建 origin 文件夹: ${originDir}`);
                vscode.window.showInformationMessage(`已创建 origin 文件夹: ${originDir}`);
            } catch (error) {
                logger.error(`创建 origin 文件夹失败: ${error}`);
                return;
            }
            // 新创建的文件夹也需要加载默认配置
            this.loadOriginConversionConfig();
            return;
        }

        // 清空当前文件列表（先清空再加载配置，避免配置被清空）
        this.files.clear();
        this.folderSettings.clear();
        this.panel.webview.postMessage({ type: 'clearFilesUI' });

        // 加载 origin 目录下的 conversion.json 配置（在 clearFilesUI 之后）
        this.loadOriginConversionConfig();

        // 递归扫描 origin 文件夹
        const filesToLoad: { filePath: string; relativePath: string }[] = [];
        this.scanDirectory(originDir, '', filesToLoad);

        if (filesToLoad.length === 0) {
            logger.info('origin 文件夹为空');
            return;
        }

        // 加载所有文件
        for (const { filePath, relativePath } of filesToLoad) {
            try {
                const data = fs.readFileSync(filePath);
                const fileName = path.basename(filePath);
                const id = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                
                // 添加到后端
                this.addFile(id, fileName, relativePath, Array.from(data));
                
                // 通知前端添加文件
                this.panel.webview.postMessage({
                    type: 'addFileFromBackend',
                    id,
                    name: fileName,
                    relativePath,
                    data: Array.from(data)
                });
            } catch (error) {
                logger.error(`加载文件失败: ${filePath}, ${error}`);
            }
        }

        logger.info(`已从 origin 文件夹加载 ${filesToLoad.length} 个文件`);
        this.panel.webview.postMessage({ type: 'originLoaded', count: filesToLoad.length });
    }

    /**
     * 递归扫描目录
     */
    private scanDirectory(dir: string, relativePath: string, results: { filePath: string; relativePath: string }[]): void {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
            
            if (entry.isDirectory()) {
                // 递归扫描子目录，但相对路径不包含文件名
                this.scanDirectory(fullPath, relativePath ? `${relativePath}/${entry.name}` : entry.name, results);
            } else if (entry.isFile()) {
                const type = this.getFileType(entry.name);
                const ext = path.extname(entry.name).toLowerCase();
                // 也扫描 .bin 文件（可能是 GLTF 的 buffer 文件）
                if (type !== 'unknown' || ext === '.bin') {
                    results.push({ filePath: fullPath, relativePath });
                }
            }
        }
    }

    /**
     * 尝试从输出目录或其父目录加载 conversion.json
     */
    private tryLoadConversionConfigFromOutputDir(): void {
        if (!this.outputDir) return;

        const configService = ConversionConfigService.getInstance();
        
        // 尝试多个可能的位置
        const possiblePaths = [
            // 输出目录本身（如果输出目录是 assets）
            path.join(this.outputDir, 'conversion.json'),
            // 输出目录的父目录（如果输出目录是 build/assets）
            path.join(path.dirname(this.outputDir), 'assets', 'conversion.json'),
            // 输出目录的父父目录（如果输出目录是 project/build/assets）
            path.join(path.dirname(path.dirname(this.outputDir)), 'assets', 'conversion.json'),
        ];

        for (const configPath of possiblePaths) {
            if (fs.existsSync(configPath)) {
                try {
                    const projectRoot = path.dirname(path.dirname(configPath));
                    this.conversionConfig = configService.loadConfig(projectRoot);
                    logger.info(`已加载转换配置: ${configPath}`);
                    return;
                } catch (error) {
                    logger.error(`加载转换配置失败: ${error}`);
                }
            }
        }

        // 没有找到配置文件
        this.conversionConfig = null;
        logger.info('未找到 conversion.json，将使用默认转换设置');
    }

    /**
     * 加载 origin 目录下的 conversion.json 配置
     */
    private loadOriginConversionConfig(): void {
        if (!this.outputDir) return;

        const originDir = path.join(this.outputDir, 'origin');
        const configPath = path.join(originDir, 'conversion.json');

        try {
            if (fs.existsSync(configPath)) {
                const content = fs.readFileSync(configPath, 'utf-8');
                this.conversionConfig = JSON.parse(content) as ConversionConfig;
                logger.info(`已加载 origin 转换配置: ${configPath}`);
            } else {
                // 创建默认配置（带注释说明）
                this.conversionConfig = {
                    version: '1.0',
                    defaultSettings: {
                        format: 'adaptive16',
                        compression: 'none'
                    },
                    items: {}
                };
                
                // 保存带注释的配置文件到磁盘
                this.createDefaultConversionConfig(configPath);
                logger.info(`已创建默认转换配置: ${configPath}`);
            }
            
            // 发送配置到前端
            this.panel.webview.postMessage({
                type: 'conversionConfigLoaded',
                config: this.conversionConfig
            });
        } catch (error) {
            logger.error(`加载 origin 转换配置失败: ${error}`);
            this.conversionConfig = null;
        }
    }

    /**
     * 创建带注释的默认 conversion.json 配置文件
     */
    private createDefaultConversionConfig(configPath: string): void {
        const isZhCn = vscode.env.language.startsWith('zh');
        const configContent = isZhCn ? `{
  "_comment": [
    "资源转换配置文件 - 用于配置图片、视频等资源的转换参数",
    "",
    "【图片默认值】",
    "  format: adaptive16 (自适应16位: 有透明度→ARGB8565, 无透明度→RGB565)",
    "  compression: none (不压缩)",
    "  可选格式: RGB565, RGB888, ARGB8565, ARGB8888, I8, adaptive16, adaptive24",
    "  可选压缩: none, rle, fastlz, yuv, adaptive",
    "",
    "【视频默认值】",
    "  format: MJPEG",
    "  quality: 1 (最高质量, MJPEG/AVI范围1-31, H264范围0-51)",
    "  frameRate: 保持原始帧率",
    "  可选格式: MJPEG, AVI, H264",
    "",
    "【字体默认值】",
    "  输出格式: 位图字体 (.bin)",
    "",
    "【3D模型默认值】",
    "  输出格式: HoneyGUI 3D格式 (.bin)"
  ],
  "version": "1.0",
  "defaultSettings": {
    "format": "adaptive16",
    "compression": "none"
  },
  "items": {}
}` : `{
  "_comment": [
    "Asset conversion config file - Configure conversion parameters for images, videos, etc.",
    "",
    "[Image Defaults]",
    "  format: adaptive16 (Adaptive 16-bit: with alpha→ARGB8565, without alpha→RGB565)",
    "  compression: none",
    "  Available formats: RGB565, RGB888, ARGB8565, ARGB8888, I8, adaptive16, adaptive24",
    "  Available compressions: none, rle, fastlz, yuv, adaptive",
    "",
    "[Video Defaults]",
    "  format: MJPEG",
    "  quality: 1 (Best quality, MJPEG/AVI range 1-31, H264 range 0-51)",
    "  frameRate: Keep original frame rate",
    "  Available formats: MJPEG, AVI, H264",
    "",
    "[Font Defaults]",
    "  Output format: Bitmap font (.bin)",
    "",
    "[3D Model Defaults]",
    "  Output format: HoneyGUI 3D format (.bin)"
  ],
  "version": "1.0",
  "defaultSettings": {
    "format": "adaptive16",
    "compression": "none"
  },
  "items": {}
}`;

        try {
            const configDir = path.dirname(configPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }
            fs.writeFileSync(configPath, configContent, 'utf-8');
        } catch (error) {
            logger.error(`创建默认转换配置失败: ${error}`);
        }
    }

    /**
     * 保存 conversion.json 到 origin 目录
     */
    private saveOriginConversionConfig(): void {
        if (!this.outputDir || !this.conversionConfig) return;

        const originDir = path.join(this.outputDir, 'origin');
        const configPath = path.join(originDir, 'conversion.json');

        try {
            // 确保 origin 目录存在
            if (!fs.existsSync(originDir)) {
                fs.mkdirSync(originDir, { recursive: true });
            }

            const content = JSON.stringify(this.conversionConfig, null, 2);
            fs.writeFileSync(configPath, content, 'utf-8');
            logger.info(`已保存转换配置到: ${configPath}`);
        } catch (error) {
            logger.error(`保存转换配置失败: ${error}`);
        }
    }

    /**
     * 更新资源的转换配置
     */
    private async updateConversionConfig(assetPath: string, settings: ItemSettings): Promise<void> {
        if (!this.conversionConfig) {
            this.conversionConfig = {
                version: '1.0',
                defaultSettings: {
                    format: 'adaptive16',
                    compression: 'none'
                },
                items: {}
            };
        }

        const normalizedPath = assetPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

        if (Object.keys(settings).length === 0) {
            // 删除配置
            delete this.conversionConfig.items[normalizedPath];
        } else {
            // 更新配置
            this.conversionConfig.items[normalizedPath] = settings;
        }

        // 保存到文件
        this.saveOriginConversionConfig();

        // 通知前端配置已更新
        this.panel.webview.postMessage({
            type: 'conversionConfigLoaded',
            config: this.conversionConfig
        });
    }

    private async selectCharsetFile(charsetIdx: number, charsetType: string): Promise<void> {
        // 获取扩展所在目录
        const extensionPath = this.extensionUri.fsPath;
        
        let defaultUri: vscode.Uri | undefined;
        let filters: Record<string, string[]> | undefined;
        let title: string;

        if (charsetType === 'codepage') {
            // CodePage 文件：默认路径 tools/font-converter/CodePage，无后缀限制
            const codepagePath = path.join(extensionPath, 'tools', 'font-converter', 'CodePage');
            if (fs.existsSync(codepagePath)) {
                defaultUri = vscode.Uri.file(codepagePath);
            }
            title = '选择 CodePage 文件';
            // 不设置 filters，允许选择所有文件
        } else {
            // Charset 文件：默认路径 tools/font-converter/charset
            const charsetPath = path.join(extensionPath, 'tools', 'font-converter', 'charset');
            if (fs.existsSync(charsetPath)) {
                defaultUri = vscode.Uri.file(charsetPath);
            }
            filters = { '字符集文件': ['cst', 'txt'] };
            title = '选择字符集文件';
        }

        const result = await vscode.window.showOpenDialog({
            canSelectMany: false,
            defaultUri,
            filters,
            openLabel: title
        });

        if (result?.[0]) {
            this.panel.webview.postMessage({
                type: 'charsetFileSelected',
                charsetIdx,
                filePath: result[0].fsPath
            });
        }
    }

    private async startConvert(baseAddr: string = '0x704D1000'): Promise<void> {
        if (!this.outputDir || this.files.size === 0) return;

        // 删除上一次生成的 ROMFS 文件，避免重复打包导致文件大小暴增
        this.cleanPreviousRomfsFiles();

        const results: any[] = [];
        let completed = 0;
        const total = this.files.size;

        // 创建临时构建目录，用于存放生成的资源文件
        // 这样可以确保 mkromfs 只打包生成的文件，而不会把输出目录下的杂乱文件（如原图）打包进去
        const os = require('os');
        const tempBuildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'honeygui-build-'));
        logger.info(`创建临时构建目录: ${tempBuildDir}`);

        try {
            // 按类型分组文件，确保转换顺序正确：
            // 1. 先转换图片（3D 模型的纹理依赖图片的 .bin 文件）
            // 2. 再转换视频
            // 3. 再转换 3D 模型（需要查找已转换的纹理 .bin）
            // 4. 最后转换字体、玻璃效果和 trmap 文件
            const filesByType: Map<string, FileItem[]> = new Map();
            const typeOrder = ['image', 'video', 'model', 'font', 'glass', 'trmap'];
            
            for (const type of typeOrder) {
                filesByType.set(type, []);
            }
            
            for (const file of this.files.values()) {
                const typeFiles = filesByType.get(file.type);
                if (typeFiles) {
                    typeFiles.push(file);
                } else {
                    // 未知类型放到最后
                    if (!filesByType.has('unknown')) {
                        filesByType.set('unknown', []);
                    }
                    filesByType.get('unknown')!.push(file);
                }
            }

            // 按顺序转换各类型文件，输出到临时构建目录
            for (const type of [...typeOrder, 'unknown']) {
                const files = filesByType.get(type) || [];
                for (const file of files) {
                    this.panel.webview.postMessage({ 
                        type: 'progress', current: completed, total, fileName: file.name 
                    });

                    // 传入 tempBuildDir 作为输出根目录
                    const result = await this.convertFile(file, tempBuildDir);
                    results.push(result);
                    completed++;
                }
            }

            // 转换完成后，在临时目录下打包成 ROMFS
            // mkromfs 会扫描 tempBuildDir 下的所有文件
            const romfsResult = await this.generateRomfs(baseAddr, tempBuildDir);
            if (romfsResult) {
                results.push(romfsResult);
            }

            // 将生成的 ROMFS 文件和资源文件从临时目录复制到最终输出目录
            logger.info(`正在将生成的文件复制到输出目录: ${this.outputDir}`);
            this.copyDirectory(tempBuildDir, this.outputDir);

        } catch (error: any) {
            logger.error(`转换过程出错: ${error}`);
            results.push({ success: false, error: `转换过程出错: ${error.message}` });
        } finally {
            // 清理临时目录
            try {
                fs.rmSync(tempBuildDir, { recursive: true, force: true });
                logger.info(`已清理临时构建目录: ${tempBuildDir}`);
            } catch (error) {
                logger.error(`清理临时目录失败: ${error}`);
            }
        }

        this.panel.webview.postMessage({ type: 'convertComplete', results });
    }

    private async convertFile(file: FileItem, outputRootDir?: string): Promise<any> {
        const tempDir = require('os').tmpdir();
        // 字体文件和 3D 模型文件使用原始文件名（因为它们之间有文件名依赖关系）
        // 其他类型使用带 ID 的名称避免冲突
        const useOriginalName = file.type === 'font' || file.type === 'model';
        const tempFileName = useOriginalName ? file.name : `honeygui_${file.id}_${file.name}`;
        const tempInput = path.join(tempDir, tempFileName);
        
        try {
            fs.writeFileSync(tempInput, Buffer.from(file.data));
            const settings = this.getEffectiveSettings(file);
            let outputPath: string;
            let result: any;

            // 确保输出子目录存在
            const targetRootDir = outputRootDir || this.outputDir;
            if (!targetRootDir) return { success: false, error: '输出目录未设置' };

            const outputSubDir = path.join(targetRootDir, file.relativePath);
            if (!fs.existsSync(outputSubDir)) {
                fs.mkdirSync(outputSubDir, { recursive: true });
            }

            switch (file.type) {
                case 'image':
                    outputPath = path.join(outputSubDir, file.name.replace(/\.[^.]+$/, '.bin'));
                    result = await this.imageConverter.convert(tempInput, outputPath, {
                        format: settings.format || 'auto',
                        compression: settings.compression || 'none',
                        dither: settings.dither,
                        yuvSampleMode: settings.yuvSampleMode,
                        yuvBlurBits: settings.yuvBlurBits,
                        yuvFastlz: settings.yuvFastlz
                    });
                    break;
                case 'video':
                    const extMap: Record<string, string> = { avi: '.avi', h264: '.h264', mjpeg: '.mjpeg' };
                    outputPath = path.join(outputSubDir, file.name.replace(/\.[^.]+$/, extMap[settings.format] || '.mjpeg'));

                    // 解析百分比缩放为像素（逻辑同 BuildCore.ts）
                    let resolvedScale: { width?: number; height?: number } | undefined;
                    if (settings.videoScaleConfig) {
                        const scaleConfig = settings.videoScaleConfig;
                        if (scaleConfig.mode === 'pixels' && (scaleConfig.width || scaleConfig.height)) {
                            resolvedScale = { width: scaleConfig.width, height: scaleConfig.height };
                        } else if (scaleConfig.mode === 'percentage' && (scaleConfig.widthPercentage || scaleConfig.heightPercentage)) {
                            try {
                                const effectiveOrder = settings.preprocessOrder ?? 'crop-then-scale';
                                let baseWidth: number | undefined;
                                let baseHeight: number | undefined;
                                if (effectiveOrder === 'crop-then-scale' && settings.crop) {
                                    baseWidth = settings.crop.width;
                                    baseHeight = settings.crop.height;
                                } else {
                                    const videoInfo = await this.videoConverter.getVideoInfo(tempInput);
                                    if (videoInfo?.width && videoInfo?.height) {
                                        baseWidth = videoInfo.width;
                                        baseHeight = videoInfo.height;
                                    }
                                }
                                if (baseWidth && baseHeight) {
                                    const wp = scaleConfig.widthPercentage;
                                    const hp = scaleConfig.heightPercentage;
                                    if (wp && hp) {
                                        resolvedScale = {
                                            width: Math.round(baseWidth * wp / 100 / 2) * 2,
                                            height: Math.round(baseHeight * hp / 100 / 2) * 2,
                                        };
                                    } else if (wp) {
                                        resolvedScale = { width: Math.round(baseWidth * wp / 100 / 2) * 2 };
                                    } else if (hp) {
                                        resolvedScale = { height: Math.round(baseHeight * hp / 100 / 2) * 2 };
                                    }
                                }
                            } catch (e) {
                                logger.warn(`获取视频信息失败，跳过缩放: ${file.name} - ${e}`);
                            }
                        }
                    }

                    result = await this.videoConverter.convert(tempInput, outputPath, {
                        format: settings.format || 'mjpeg',
                        quality: settings.quality || 1,
                        frameRate: settings.frameRate,
                        scale: resolvedScale,
                        crop: settings.crop,
                        preprocessOrder: settings.preprocessOrder,
                    });
                    break;
                case 'model':
                    const ext = path.extname(file.name).toLowerCase();
                    
                    // MTL 和 BIN 文件是辅助文件，不需要单独转换
                    if (ext === '.mtl') {
                        return { success: true, fileName: file.name, skipped: true, message: 'MTL 文件作为 OBJ 的辅助文件，无需单独转换' };
                    }
                    if (ext === '.bin') {
                        return { success: true, fileName: file.name, skipped: true, message: 'BIN 文件作为 GLTF 的辅助文件，无需单独转换' };
                    }
                    
                    const prefix = ext === '.gltf' ? 'gltf_desc_' : 'desc_';
                    outputPath = path.join(outputSubDir, prefix + file.name.replace(/\.[^.]+$/, '.bin'));
                    
                    // 对于 OBJ 文件，需要检查并复制 MTL 文件到临时目录
                    if (ext === '.obj') {
                        const mtlName = file.name.replace(/\.obj$/i, '.mtl');
                        const mtlFile = Array.from(this.files.values()).find(
                            f => f.name === mtlName && f.relativePath === file.relativePath
                        );
                        if (mtlFile) {
                            const tempMtlPath = path.join(tempDir, mtlName);
                            fs.writeFileSync(tempMtlPath, Buffer.from(mtlFile.data));
                            logger.info(`已复制 MTL 文件到临时目录: ${tempMtlPath}`);
                        } else {
                            logger.warn(`未找到对应的 MTL 文件: ${mtlName}`);
                        }
                    }
                    
                    // 对于 GLTF 文件，需要检查并复制 BIN 文件到临时目录
                    if (ext === '.gltf') {
                        const binName = file.name.replace(/\.gltf$/i, '.bin');
                        const binFile = Array.from(this.files.values()).find(
                            f => f.name === binName && f.relativePath === file.relativePath
                        );
                        if (binFile) {
                            const tempBinPath = path.join(tempDir, binName);
                            fs.writeFileSync(tempBinPath, Buffer.from(binFile.data));
                            logger.info(`已复制 GLTF BIN 文件到临时目录: ${tempBinPath}`);
                        } else {
                            logger.warn(`未找到对应的 GLTF BIN 文件: ${binName}`);
                        }
                    }
                    
                    // 传递 outputSubDir 而不是 this.outputDir，这样纹理查找路径才正确
                    result = await this.model3DConverter.convert(tempInput, outputPath, outputSubDir);
                    break;
                case 'font':
                    outputPath = outputSubDir;
                    result = await this.fontConverter.convert(tempInput, outputPath, {
                        fontSize: settings.fontSize || 32,
                        renderMode: settings.renderMode || 4,
                        outputFormat: settings.outputFormat || 'bitmap',
                        // 预置标识符（如 "GBK.cst"/"CP936"）还原为插件内绝对路径
                        characterSets: CharsetSourceResolver.resolveAll(
                            (settings.characterSets || [{ type: 'range', value: '0x20-0x7E' }]) as any
                        ) as any,
                        crop: settings.crop
                    });
                    break;
                case 'glass':
                    outputPath = path.join(outputSubDir, file.name.replace(/\.[^.]+$/, '.bin'));
                    result = await this.glassConverter.convert(tempInput, outputPath, {
                        blurRadius: settings.blurRadius || 50,
                        blurIntensity: settings.blurIntensity || 50
                    });
                    break;
                case 'trmap':
                    // 直接拷贝 .trmap 文件到输出目录
                    outputPath = path.join(outputSubDir, file.name);
                    fs.copyFileSync(tempInput, outputPath);
                    result = { success: true, outputPath, message: '文件已直接拷贝' };
                    break;
                default:
                    result = { success: false, error: 'Unknown file type' };
            }

            return { ...result, fileName: file.name };
        } finally {
            try { fs.unlinkSync(tempInput); } catch {}
        }
    }

    private getEffectiveSettings(file: FileItem): any {
        // 1. 优先使用用户在 UI 中设置的单个文件设置
        if (file.settings && Object.keys(file.settings).length > 0) {
            return file.settings;
        }
        
        // 2. 对于图片类型，尝试从 conversion.json 获取配置
        if (file.type === 'image' && this.conversionConfig) {
            // 构建完整的图片路径（包含文件名）
            const imagePath = file.relativePath ? `${file.relativePath}/${file.name}` : file.name;
            const configSettings = this.getImageSettingsFromConfig(imagePath);
            if (configSettings) {
                return configSettings;
            }
        }
        
        // 2.1 对于视频类型，尝试从 conversion.json 获取配置
        if (file.type === 'video' && this.conversionConfig) {
            const videoPath = file.relativePath ? `${file.relativePath}/${file.name}` : file.name;
            const configSettings = this.getVideoSettingsFromConfig(videoPath);
            if (configSettings) {
                return configSettings;
            }
        }
        
        // 3. 查找继承的文件夹设置（UI 中设置的）
        if (file.relativePath) {
            const parts = file.relativePath.split('/');
            for (let i = parts.length; i > 0; i--) {
                const folderPath = parts.slice(0, i).join('/');
                const folderSetting = this.folderSettings.get(folderPath);
                if (folderSetting) {
                    const typeSetting = folderSetting[file.type];
                    if (typeSetting) return typeSetting;
                }
            }
        }
        
        // 4. 返回空对象，使用默认值
        return {};
    }

    /**
     * 从 conversion.json 配置中获取图片设置
     */
    private getImageSettingsFromConfig(relativePath: string): any | null {
        if (!this.conversionConfig) {
            return null;
        }

        const configService = ConversionConfigService.getInstance();
        const resolvedConfig = configService.resolveEffectiveConfig(relativePath, this.conversionConfig);
        
        // 获取原始配置的格式（未解析前）
        const normalizedPath = relativePath.replace(/\\/g, '/');
        const itemSettings = this.conversionConfig.items[normalizedPath];
        const effectiveFormat = itemSettings?.format || this.conversionConfig.defaultSettings.format || 'adaptive16';
        
        // 解析格式（只对自适应格式进行透明通道检测和格式调整）
        let format: string;
        
        // 判断是否为自适应格式
        const isAdaptive = effectiveFormat === 'adaptive16' || effectiveFormat === 'adaptive24';
        
        if (isAdaptive) {
            // 检查图片是否有透明度
            const file = Array.from(this.files.values()).find(f => {
                const filePath = f.relativePath ? `${f.relativePath}/${f.name}` : f.name;
                return filePath === relativePath;
            });
            const hasAlpha = file ? bufferHasAlpha(Buffer.from(file.data)) : false;
            // 解析自适应格式
            format = configService.resolveAdaptiveFormat(effectiveFormat, hasAlpha);
        } else {
            // 对于明确指定的格式，直接使用原始格式，不做任何调整
            format = effectiveFormat;
        }
        
        // 构建设置对象
        const settings: any = {
            format: format.toLowerCase(),
            compression: resolvedConfig.compression,
            dither: resolvedConfig.dither
        };
        
        // 如果是 YUV 压缩，添加 YUV 参数
        if (resolvedConfig.compression === 'yuv' && resolvedConfig.yuvParams) {
            settings.yuvSampleMode = resolvedConfig.yuvParams.sampling.toLowerCase();
            settings.yuvBlurBits = this.parseYuvBlurBits(resolvedConfig.yuvParams.blur);
            settings.yuvFastlz = resolvedConfig.yuvParams.fastlzSecondary;
        }
        
        // 如果配置为 adaptive 压缩，暂时使用不压缩
        if (resolvedConfig.compression === 'adaptive') {
            settings.compression = 'none';
        }
        
        return settings;
    }

    // 透明度检测已抽到 ../utils/imageAlpha 的 bufferHasAlpha,三处调用方共用同一实现

    /**
     * 解析 YUV 模糊位数
     */
    private parseYuvBlurBits(blur: YuvBlur): number {
        switch (blur) {
            case '1bit': return 1;
            case '2bit': return 2;
            case '4bit': return 4;
            default: return 0;
        }
    }

    /**
     * 从 conversion.json 配置中获取视频设置
     */
    private getVideoSettingsFromConfig(relativePath: string): any | null {
        if (!this.conversionConfig) {
            return null;
        }

        const normalizedPath = relativePath.replace(/\\/g, '/');
        
        // 查找文件自身的配置
        let itemSettings = this.conversionConfig.items[normalizedPath];
        
        // 如果没有，查找父文件夹的配置
        if (!itemSettings) {
            const pathParts = normalizedPath.split('/');
            for (let i = pathParts.length - 1; i >= 0; i--) {
                const parentPath = pathParts.slice(0, i).join('/');
                if (parentPath && this.conversionConfig.items[parentPath]) {
                    itemSettings = this.conversionConfig.items[parentPath];
                    break;
                }
            }
        }
        
        if (!itemSettings) {
            return null;
        }
        
        // 检查是否有视频相关配置
        if (!itemSettings.videoFormat && !itemSettings.videoQuality && !itemSettings.videoFrameRate &&
            !itemSettings.videoScale && !itemSettings.videoCrop) {
            return null;
        }
        
        // 构建设置对象
        const settings: any = {
            format: itemSettings.videoFormat || 'mjpeg',
            quality: itemSettings.videoQuality || 1
        };
        
        if (itemSettings.videoFrameRate) {
            settings.frameRate = itemSettings.videoFrameRate;
        }
        
        if (itemSettings.videoScale) {
            settings.videoScaleConfig = itemSettings.videoScale;
        }
        
        if (itemSettings.videoCrop) {
            settings.crop = {
                width: itemSettings.videoCrop.width,
                height: itemSettings.videoCrop.height,
                x: itemSettings.videoCrop.x,
                y: itemSettings.videoCrop.y,
            };
        }
        
        if (itemSettings.preprocessOrder) {
            settings.preprocessOrder = itemSettings.preprocessOrder;
        }
        
        return settings;
    }

    /**
     * 预览玻璃效果
     */
    private async previewGlass(id: string, data: number[], settings: any): Promise<void> {
        try {
            const svgData = Buffer.from(data);
            const result = await this.glassConverter.generatePreview(svgData, {
                blurRadius: settings?.blurRadius || 50,
                blurIntensity: settings?.blurIntensity || 50
            });

            if (result.success && result.base64) {
                this.panel.webview.postMessage({
                    type: 'glassPreviewResult',
                    id,
                    success: true,
                    base64: result.base64,
                    width: result.width,
                    height: result.height
                });
            } else {
                this.panel.webview.postMessage({
                    type: 'glassPreviewResult',
                    id,
                    success: false,
                    error: result.error || '预览生成失败'
                });
            }
        } catch (error: any) {
            this.panel.webview.postMessage({
                type: 'glassPreviewResult',
                id,
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 清理上一次生成的 ROMFS 文件，避免重复打包导致文件大小暴增
     */
    private cleanPreviousRomfsFiles(): void {
        if (!this.outputDir) return;

        // 固定名产物 + 所有 romfs 二进制文件（app_romfs.bin 或带基地址后缀的 app_romfs_<addr>.bin）
        const filesToDelete = new Set(['app_romfs.c', 'ui_resource.h']);
        try {
            for (const entry of fs.readdirSync(this.outputDir)) {
                if (RomfsConfig.isBinFileName(entry)) {
                    filesToDelete.add(entry);
                }
            }
        } catch (error) {
            logger.error(`扫描 romfs 文件失败: ${this.outputDir}, ${error}`);
        }

        for (const fileName of filesToDelete) {
            const filePath = path.join(this.outputDir, fileName);
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    logger.info(`已删除旧文件: ${filePath}`);
                }
            } catch (error) {
                logger.error(`删除旧文件失败: ${filePath}, ${error}`);
            }
        }
    }

    /**
     * 递归复制目录内容
     */
    private copyDirectory(src: string, dest: string): void {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        
        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            
            if (entry.isDirectory()) {
                this.copyDirectory(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    /**
     * 生成 ROMFS 打包文件（romfs.c 和 romfs.bin）和 ui_resource.h
     * @param baseAddr 基地址
     * @param inputDir 输入目录（默认为 this.outputDir）
     */
    private async generateRomfs(baseAddr: string, inputDir?: string): Promise<any> {
        const targetDir = inputDir || this.outputDir;
        
        if (!targetDir) {
            return { success: false, error: '输出目录未设置', fileName: 'romfs' };
        }

        try {
            const { execSync } = require('child_process');
            const mkromfsScript = path.join(__dirname, '..', '..', '..', 'tools', 'mkromfs_for_honeygui.py');
            
            if (!fs.existsSync(mkromfsScript)) {
                return { success: false, error: 'mkromfs 脚本不存在', fileName: 'romfs' };
            }

            // 检测 Python 命令
            let pythonCmd = 'python';
            try {
                execSync('python --version', { stdio: 'pipe' });
            } catch {
                try {
                    execSync('python3 --version', { stdio: 'pipe' });
                    pythonCmd = 'python3';
                } catch {
                    return { success: false, error: 'Python 未安装或不在 PATH 中', fileName: 'romfs' };
                }
            }

            const romfsCOutput = path.join(targetDir, 'app_romfs.c');
            // 二进制文件名带上基地址后缀，例如 app_romfs_0x70536400.bin
            const romfsBinName = RomfsConfig.getBinFileName(baseAddr);
            const romfsBinOutput = path.join(targetDir, romfsBinName);

            // 生成 C 文件
            execSync(`${pythonCmd} "${mkromfsScript}" -i "${targetDir}" -o "${romfsCOutput}" -a ${baseAddr}`, {
                cwd: targetDir,
                stdio: 'pipe',
                windowsHide: true
            });
            logger.info(`ROMFS C 文件生成完成: ${romfsCOutput}`);

            // 生成二进制文件（同时会生成 ui_resource.h）
            execSync(`${pythonCmd} "${mkromfsScript}" -i "${targetDir}" -o "${romfsBinOutput}" -a ${baseAddr} -b`, {
                cwd: targetDir,
                stdio: 'pipe',
                windowsHide: true
            });
            logger.info(`ROMFS 二进制文件生成完成: ${romfsBinOutput}`);
            
            // 检查 ui_resource.h 是否生成
            const headerPath = path.join(targetDir, 'ui_resource.h');
            const headerGenerated = fs.existsSync(headerPath);

            return {
                success: true,
                fileName: `app_romfs.c / ${romfsBinName}`,
                message: `ROMFS 打包完成 (基地址: ${baseAddr})${headerGenerated ? '，ui_resource.h 已生成' : ''}`
            };
        } catch (error: any) {
            logger.error(`ROMFS 打包失败: ${error.message}`);
            return { success: false, error: error.message, fileName: 'romfs' };
        }
    }

    public dispose(): void {
        ToolsPanel.currentPanel = undefined;
        this.panel.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
