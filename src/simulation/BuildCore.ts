import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { minimatch } from 'minimatch';
import { ImageConverterService, ImageConvertOptions, ConvertResult, CompressionType, YuvSampleMode, YuvBlurBits } from '../services/ImageConverterService';
import { VideoConverterService } from '../services/VideoConverterService';
import { Model3DConverterService } from '../services/Model3DConverterService';
import { FontConverterService, FontConvertOptions } from '../services/FontConverterService';
import { GlassConverterService, GlassConvertOptions, GlassConvertResult } from '../services/GlassConverterService';
import { ConversionConfigService, VideoFormat, ConversionConfig, YuvBlur, VideoScaleConfig, VideoCropConfig, PreprocessOrder } from '../services/ConversionConfigService';
import { SamplingFactor } from '../../tools/image-to-jpeg-converter/src/index';
import { ProjectConfig, DEFAULT_ROMFS_BASE_ADDR } from '../common/ProjectConfig';
import { RomfsConfig } from '../common/RomfsConfig';
import { buildSConstruct } from './SConstructTemplate';
import { ProjectUtils } from '../utils/ProjectUtils';

/**
 * romfs 打包前需要清理的文件规则
 * 这些文件由各转换工具生成，但不是运行时必需的，不应打包到 romfs 中
 * 
 * 支持两种格式：
 * - 扩展名匹配：以 '*' 开头，如 '*.cst'
 * - 精确文件名匹配：如 'NotSupportedChars.txt'
 */
const ROMFS_CLEANUP_PATTERNS: string[] = [
    '*.cst',                    // 字体转换工具生成的字符集文件，仅供客户后续复用
    'NotSupportedChars.txt',    // 字体转换工具生成的不支持字符列表
];

/**
 * 日志接口
 */
export interface Logger {
    log(message: string, isError?: boolean, isWarning?: boolean): void;
}

/**
 * 编译核心逻辑（不依赖 VSCode）
 * sdkPath 现在指向插件内置的 lib/sim 目录
 */
export class BuildCore {
    protected buildDir: string;
    protected projectRoot: string;
    protected libSimPath: string;  // 插件内置的 lib/sim 路径
    protected logger: Logger;
    protected projectConfig: ProjectConfig;
    private compileProcess: ChildProcess | null = null;

    constructor(projectRoot: string, libSimPath: string, projectConfig: ProjectConfig, logger: Logger) {
        this.projectRoot = projectRoot;
        this.libSimPath = libSimPath;
        this.projectConfig = projectConfig;
        this.buildDir = path.join(projectRoot, 'build');
        this.logger = logger;
    }

    getBuildDir(): string {
        return this.buildDir;
    }

    async setupBuildDir(): Promise<void> {
        this.logger.log(vscode.l10n.t('Preparing build directory...'));

        const parentDir = path.dirname(this.buildDir);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }

        // 使用内置的 win32_sim
        const win32SimSource = path.join(this.libSimPath, 'win32_sim');
        if (!fs.existsSync(win32SimSource)) {
            throw new Error(vscode.l10n.t('Built-in win32_sim directory does not exist: {0}', win32SimSource));
        }

        if (!fs.existsSync(this.buildDir)) {
            this.logger.log(vscode.l10n.t('Copying win32_sim...'));
            this.copyDirectory(win32SimSource, this.buildDir);
            this.logger.log(vscode.l10n.t('win32_sim copied'));
        } else {
            this.logger.log(vscode.l10n.t('Build directory exists, skipping copy'));
        }

        // 拷贝 .config
        const configSource = path.join(win32SimSource, '.config');
        const configDest = path.join(this.buildDir, '.config');
        if (fs.existsSync(configSource)) {
            fs.copyFileSync(configSource, configDest);
            this.logger.log(vscode.l10n.t('.config copied'));
        } else {
            this.logger.log(vscode.l10n.t('.config does not exist, generating default'));
            this.generateConfig();
        }

        // 确保 menu_config.py 存在
        const menuConfigSource = path.join(win32SimSource, 'menu_config.py');
        const menuConfigDest = path.join(this.buildDir, 'menu_config.py');
        if (fs.existsSync(menuConfigSource) && !fs.existsSync(menuConfigDest)) {
            fs.copyFileSync(menuConfigSource, menuConfigDest);
            this.logger.log(vscode.l10n.t('menu_config.py copied'));
        }

        // 确保链接脚本文件存在
        const linkerScriptSource = path.join(win32SimSource, 'honeygui_mingw.ld');
        const linkerScriptDest = path.join(this.buildDir, 'honeygui_mingw.ld');
        if (fs.existsSync(linkerScriptSource) && !fs.existsSync(linkerScriptDest)) {
            fs.copyFileSync(linkerScriptSource, linkerScriptDest);
            this.logger.log(vscode.l10n.t('honeygui_mingw.ld copied'));
        }

        // 确保 main.c 存在
        const mainSource = path.join(win32SimSource, 'main.c');
        const mainDest = path.join(this.buildDir, 'main.c');
        if (fs.existsSync(mainSource) && !fs.existsSync(mainDest)) {
            fs.copyFileSync(mainSource, mainDest);
            this.logger.log(vscode.l10n.t('main.c copied'));
        }

        // 创建 SConscript（编译 main.c 和 app_romfs.c）
        const sconscriptPath = path.join(this.buildDir, 'SConscript');
        if (!fs.existsSync(sconscriptPath)) {
            const sconscriptContent = `# SConscript for build directory
from building import *

cwd = GetCurrentDir()
inc = [cwd]

# 编译 main.c 和 app_romfs.c
src = ['main.c', 'app_romfs.c']

objs = DefineGroup('build', src, depend = [''], CPPPATH = inc)

Return('objs')
`;
            fs.writeFileSync(sconscriptPath, sconscriptContent, 'utf-8');
            this.logger.log(vscode.l10n.t('SConscript file generated'));
        }

        this.modifySConstruct();
        this.logger.log(vscode.l10n.t('Build directory ready'));
    }

    async copyGeneratedCode(): Promise<void> {
        this.logger.log('检查生成的代码...');

        const srcDir = path.join(this.projectRoot, 'src');
        if (!fs.existsSync(srcDir)) {
            throw new Error(`生成的代码目录不存在: ${srcDir}`);
        }

        const sconscript = path.join(srcDir, 'SConscript');
        if (!fs.existsSync(sconscript)) {
            throw new Error(`SConscript 文件不存在: ${sconscript}，请先生成代码`);
        }

        this.logger.log('代码检查完成');
    }

    async convertAssets(): Promise<void> {
        const assetsDir = path.join(this.projectRoot, 'assets');
        const outputDir = path.join(this.buildDir, 'assets');

        // 确保 build/assets 目录存在
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // 检查是否启用灵活打包模式
        const configService = ConversionConfigService.getInstance();
        const conversionConfig = configService.loadConfig(this.projectRoot);
        const smartPacking = conversionConfig.smartPacking === true;

        let usedAssets: {
            images: Set<string>;
            videos: Set<string>;
            models: Set<string>;
            fonts: Set<string>;
            mapFonts: Set<string>;
        };

        if (smartPacking) {
            // 灵活打包：只转换 HML 引用的资源 + alwaysConvert 列表
            this.logger.log(vscode.l10n.t('Scanning asset references in HML files...'));
            usedAssets = await this.scanUsedAssets();
            this.logger.log(`找到 ${usedAssets.images.size} 个图片, ${usedAssets.videos.size} 个视频, ${usedAssets.models.size} 个3D模型`);
        } else {
            // 全量打包（默认）：转换 assets 目录下所有资源
            this.logger.log(vscode.l10n.t('Scanning all assets for full packaging...'));
            usedAssets = await this.scanAllAssets();
            this.logger.log(`找到 ${usedAssets.images.size} 个图片, ${usedAssets.videos.size} 个视频, ${usedAssets.models.size} 个3D模型`);
        }

        // 转换图片资源（只转换使用的）
        this.logger.log(vscode.l10n.t('Converting image assets...'));
        const imageConverter = new ImageConverterService();
        
        // 从项目配置读取压缩设置
        const compressionConfig = this.projectConfig.imageCompression;
        const imageOptions = compressionConfig?.enabled ? {
            compression: compressionConfig.algorithm || 'none',
            yuvSampleMode: compressionConfig.yuvSampleMode,
            yuvBlurBits: compressionConfig.yuvBlurBits,
            yuvFastlz: compressionConfig.yuvFastlz
        } : undefined;
        
        if (imageOptions?.compression && imageOptions.compression !== 'none') {
            this.logger.log(`使用压缩算法: ${imageOptions.compression}`);
        }
        
        const imageResults = await this.convertUsedImages(assetsDir, outputDir, usedAssets.images, imageOptions);

        const imageFailed = imageResults.filter(r => !r.success);
        if (imageFailed.length > 0) {
            for (const f of imageFailed) {
                this.logger.log(`图片转换失败: ${f.inputPath} - ${f.error}`, true);
            }
            throw new Error(`${imageFailed.length} 个图片转换失败`);
        }

        this.logger.log(`图片转换完成: ${imageResults.length} 个`);

        // 拷贝 SVG 资源（不需要转换）
        this.logger.log(vscode.l10n.t('Copying SVG assets...'));
        const svgCount = this.copySvgAssets(assetsDir, outputDir);
        this.logger.log(`SVG 拷贝完成: ${svgCount} 个`);

        // 拷贝 TRMAP 资源（不需要转换）
        this.logger.log('拷贝 TRMAP 资源...');
        const trmapCount = this.copyTrmapAssets(assetsDir, outputDir);
        this.logger.log(`TRMAP 拷贝完成: ${trmapCount} 个`);

        // 拷贝 user 目录（不转换，原样复制）
        const userCount = this.copyUserAssets(assetsDir, outputDir);
        if (userCount > 0) {
            this.logger.log(`user 目录拷贝完成: ${userCount} 个`);
        }

        // 拷贝向量地图（hg_map）引用的字体文件（直接拷贝，不转换格式）
        this.logger.log('拷贝向量地图字体资源...');
        const mapFontCount = this.copyMapFonts(assetsDir, outputDir, usedAssets.mapFonts);
        if (mapFontCount > 0) {
            this.logger.log(`向量地图字体拷贝完成: ${mapFontCount} 个`);
        }

        // 转换视频资源（只转换使用的）
        this.logger.log(vscode.l10n.t('Checking video assets...'));
        const videoConverter = new VideoConverterService((msg) => {
            this.logger.log(msg);
        });
        
        // 检查 FFmpeg 是否可用
        const ffmpegAvailable = await videoConverter.checkFFmpegAvailable();
        if (!ffmpegAvailable) {
            this.logger.log('FFmpeg 未找到，跳过视频转换。请安装 FFmpeg 并添加到系统 PATH。', true);
            this.logger.log('视频转换跳过: 0 个');
        } else {
            // 获取视频组件配置并进行智能转换（只转换使用的）
            const videoResults = await this.convertUsedVideos(
                videoConverter,
                assetsDir,
                outputDir,
                usedAssets.videos
            );

            const videoFailed = videoResults.filter(r => !r.success);
            if (videoFailed.length > 0) {
                for (const f of videoFailed) {
                    this.logger.log(`视频转换失败: ${f.inputPath} - ${f.error}`, true);
                }
                throw new Error(`${videoFailed.length} 个视频转换失败`);
            }

            // 记录警告信息
            const videoWarnings = videoResults.filter(r => r.success && r.warning);
            if (videoWarnings.length > 0) {
                for (const w of videoWarnings) {
                    this.logger.log(`视频转换警告: ${w.inputPath} - ${w.warning}`, false);
                }
            }

            this.logger.log(`视频转换完成: ${videoResults.length} 个`);
        }



        // 转换 3D 模型资源（只转换使用的）
        this.logger.log('转换 3D 模型资源...');
        const model3DResults = await this.convertUsedModels(assetsDir, outputDir, usedAssets.models);

        const model3DFailed = model3DResults.filter(r => !r.success);
        if (model3DFailed.length > 0) {
            for (const f of model3DFailed) {
                this.logger.log(`3D模型转换失败: ${f.inputPath} - ${f.error}`, true);
            }
            throw new Error(`${model3DFailed.length} 个3D模型转换失败`);
        }

        this.logger.log(`3D模型转换完成: ${model3DResults.length} 个`);

        // 转换字体资源
        this.logger.log('转换字体资源...');
        const fontResults = await this.convertFontsWithLabelConfig(assetsDir, outputDir, usedAssets.fonts);
        const fontFailed = fontResults.filter(r => !r.success);
        if (fontFailed.length > 0) {
            for (const f of fontFailed) {
                this.logger.log(`字体转换失败: ${f.inputPath} - ${f.error}`, true);
            }
            // 字体转换失败不阻止编译，只是警告
            this.logger.log(`警告: ${fontFailed.length} 个字体转换失败`, true);
        }
        this.logger.log(`字体转换完成: ${fontResults.filter(r => r.success).length} 个`);

        // 转换玻璃效果资源
        this.logger.log('转换玻璃效果资源...');
        const glassResults = await this.convertGlassWithComponentConfig(assetsDir, outputDir);
        const glassFailed = glassResults.filter(r => !r.success);
        if (glassFailed.length > 0) {
            for (const f of glassFailed) {
                this.logger.log(`玻璃效果转换失败: ${f.inputPath} - ${f.error}`, true);
            }
        }
        this.logger.log(`玻璃效果转换完成: ${glassResults.filter(r => r.success).length} 个`);

        // 拷贝 ui 目录到 build/assets
        const uiSrcDir = path.join(this.projectRoot, 'ui');
        const uiDestDir = path.join(outputDir, 'ui');
        if (fs.existsSync(uiSrcDir)) {
            this.copyDirectory(uiSrcDir, uiDestDir);
            this.logger.log('UI 目录已拷贝到 assets');
        }

        // 拷贝 project.json 到 build/assets
        const projectJsonSrc = path.join(this.projectRoot, 'project.json');
        const projectJsonDest = path.join(outputDir, 'project.json');
        if (fs.existsSync(projectJsonSrc)) {
            fs.copyFileSync(projectJsonSrc, projectJsonDest);
            this.logger.log('project.json 已拷贝到 assets');
        }

        // 清理非运行时文件（规则见 ROMFS_CLEANUP_PATTERNS）
        this.cleanupNonRuntimeFiles(outputDir);

        // 打包 romfs
        await this.packRomfs();
    }

    /**
     * 根据 ROMFS_CLEANUP_PATTERNS 清理输出目录中不需要打包的文件
     */
    private cleanupNonRuntimeFiles(dir: string): void {
        if (!fs.existsSync(dir)) { return; }
        let count = 0;
        const walk = (d: string) => {
            for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
                const fullPath = path.join(d, entry.name);
                if (entry.isDirectory()) {
                    walk(fullPath);
                } else if (entry.isFile() && this.matchCleanupPattern(entry.name)) {
                    fs.unlinkSync(fullPath);
                    count++;
                }
            }
        };
        walk(dir);
        if (count > 0) {
            this.logger.log(`已清理 ${count} 个非运行时文件`);
        }
    }

    /**
     * 检查文件名是否匹配清理规则
     */
    private matchCleanupPattern(fileName: string): boolean {
        for (const pattern of ROMFS_CLEANUP_PATTERNS) {
            if (pattern.startsWith('*.')) {
                // 扩展名匹配
                if (fileName.endsWith(pattern.substring(1))) { return true; }
            } else {
                // 精确文件名匹配
                if (fileName === pattern) { return true; }
            }
        }
        return false;
    }

    private async packRomfs(): Promise<void> {
        this.logger.log('打包 romfs...');

        const assetsDir = path.join(this.buildDir, 'assets');
        const romfsOutput = path.join(this.buildDir, RomfsConfig.getFileName());
        const romfsBinOutput = path.join(this.buildDir, 'app_romfs.bin');

        // 获取 romfs 基地址
        const baseAddr = this.projectConfig.romfsBaseAddr || DEFAULT_ROMFS_BASE_ADDR;

        // 使用 Python 版本的 mkromfs_for_honeygui.py
        const mkromfsScript = path.join(__dirname, '..', '..', '..', 'tools', 'mkromfs_for_honeygui.py');
        const { execSync } = require('child_process');
        
        // Windows 使用 python，Linux/Mac 使用 python3
        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
        
        // 生成 C 文件
        try {
            execSync(`${pythonCmd} "${mkromfsScript}" -i "${assetsDir}" -o "${romfsOutput}" -a ${baseAddr}`, {
                stdio: 'pipe',  // 改为 pipe 避免继承父进程的 stdio
                windowsHide: true  // Windows 上隐藏命令行窗口
            });
            this.logger.log('romfs C 文件生成完成');
        } catch (error) {
            throw new Error(`生成 romfs C 文件失败: ${error}`);
        }

        // 生成二进制文件（用于 UART 下载）
        try {
            execSync(`${pythonCmd} "${mkromfsScript}" -i "${assetsDir}" -o "${romfsBinOutput}" -a ${baseAddr} -b`, {
                stdio: 'pipe',  // 改为 pipe 避免继承父进程的 stdio
                windowsHide: true  // Windows 上隐藏命令行窗口
            });
            this.logger.log(`romfs 二进制文件生成完成 (基地址: ${baseAddr})`);
        } catch (error) {
            throw new Error(`生成 romfs 二进制文件失败: ${error}`);
        }
    }

    /**
     * 中止编译进程
     */
    abort(): void {
        if (this.compileProcess && this.compileProcess.pid) {
            this.logger.log('正在中止编译...');
            try {
                if (process.platform === 'win32') {
                    spawn('taskkill', ['/F', '/T', '/PID', String(this.compileProcess.pid)], { windowsHide: true });
                } else {
                    this.compileProcess.kill('SIGTERM');
                }
            } catch {
                // 进程可能已退出
            }
            this.compileProcess = null;
        }
    }

    async compile(): Promise<void> {
        this.logger.log('开始编译...');

        return new Promise((resolve, reject) => {
            const compileProcess = spawn('scons', ['-j4'], {
                cwd: this.buildDir,
                shell: true,
                windowsHide: true  // Windows 上隐藏命令行窗口
            });
            this.compileProcess = compileProcess;

            let compiledCount = 0;

            compileProcess.stdout?.on('data', (data) => {
                const output = data.toString();
                const lines = output.split('\n');
                
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    
                    // 过滤掉不需要的日志
                    if (trimmed.includes('Warning: Command is too long')) continue;
                    
                    // 显示所有编译信息
                    if (trimmed.startsWith('CC ') || trimmed.startsWith('Compiling ')) {
                        compiledCount++;
                        this.logger.log(trimmed);  // 显示每个文件的编译信息
                    } else if (trimmed.startsWith('LINK ') || trimmed.includes('Linking')) {
                        this.logger.log(`链接中... (已编译 ${compiledCount} 个文件)`);
                    } else if (trimmed.includes('error:') || trimmed.includes('Error:') ||
                               trimmed.includes('undefined reference') ||
                               trimmed.includes('multiple definition') ||
                               trimmed.includes('collect2') ||
                               trimmed.includes('ld returned')) {
                        // 显示所有错误信息，包括链接错误
                        this.logger.log(trimmed, true);
                    } else if (trimmed.includes('warning:') && !trimmed.includes('Command is too long')) {
                        // 显示警告信息
                        this.logger.log(trimmed, false, true);
                    } else if (trimmed.startsWith('scons:')) {
                        this.logger.log(trimmed);
                    } else {
                        // 显示其他所有输出
                        this.logger.log(trimmed);
                    }
                }
            });

            compileProcess.stderr?.on('data', (data) => {
                const output = data.toString();
                const lines = output.split('\n');
                
                let isInWarningContext = false;
                
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    if (trimmed.includes('Warning: Command is too long')) continue;
                    
                    // 检测是否是警告相关的行
                    if (trimmed.includes('warning:')) {
                        isInWarningContext = true;
                        this.logger.log(trimmed, false, true);  // 警告
                    } else if (trimmed.includes('note:') && isInWarningContext) {
                        // note 通常是警告的补充说明
                        this.logger.log(trimmed, false, true);  // 警告
                    } else if (trimmed.match(/^[\s^~]+$/) || trimmed === '^') {
                        // 代码指示符（如 ^、~~~）
                        this.logger.log(trimmed, false, isInWarningContext);
                    } else if (trimmed.includes(': In function ') || 
                               trimmed.includes('In file included from') ||
                               trimmed.includes('from ')) {
                        // 上下文信息
                        this.logger.log(trimmed, false, isInWarningContext);
                    } else if (trimmed.includes('error:') || 
                               trimmed.includes('Error:') ||
                               trimmed.includes('undefined reference') ||
                               trimmed.includes('multiple definition')) {
                        // 真正的错误
                        isInWarningContext = false;
                        this.logger.log(trimmed, true);
                    } else {
                        // 其他行：如果在警告上下文中，显示为警告；否则显示为错误
                        this.logger.log(trimmed, !isInWarningContext, isInWarningContext);
                    }
                }
            });

            compileProcess.on('exit', (code) => {
                this.compileProcess = null;
                if (code === 0) {
                    this.logger.log(`编译成功！共编译 ${compiledCount} 个文件`);
                    resolve();
                } else {
                    reject(new Error(`编译失败，退出码: ${code}`));
                }
            });

            compileProcess.on('error', (err) => {
                this.compileProcess = null;
                reject(err);
            });
        });
    }

    getExecutablePath(): string {
        const exeName = process.platform === 'win32' ? 'gui.exe' : 'gui';
        return path.join(this.buildDir, exeName);
    }

    private generateConfig(): void {
        // 固定配置，不依赖 Kconfig.gui
        const configLines: string[] = [
            'CONFIG_REALTEK_HONEYGUI=y',
            'CONFIG_REALTEK_BUILD_PINYIN=y',
            'CONFIG_REALTEK_BUILD_LETTER_SHELL=y',
            'CONFIG_REALTEK_BUILD_MONKEY_TEST=y',
            'CONFIG_REALTEK_H264_DECODER=y',
            'CONFIG_REALTEK_H264BSD=y',
            'CONFIG_REALTEK_BUILD_GUI_BOX2D=y',
            'CONFIG_REALTEK_BUILD_LITE3D=y'
        ];
        
        const configPath = path.join(this.buildDir, '.config');
        fs.writeFileSync(configPath, configLines.join('\n') + '\n');
        this.logger.log(`.config 文件已生成，包含 ${configLines.length} 个配置项`);
    }

    private modifySConstruct(): void {
        const sconstructPath = path.join(this.buildDir, 'SConstruct');

        const libSim = this.libSimPath.replace(/\\/g, '/');
        const projectSrc = this.projectRoot.replace(/\\/g, '/') + '/src';
        const { width, height } = this.parseResolution(this.projectConfig.resolution);
        const cornerRadius = this.projectConfig.cornerRadius || 0;
        const pixelBits = ProjectUtils.getPixelBits(this.projectConfig.pixelMode);
        const platform = process.platform === 'win32' ? 'win32' : 'linux';

        const content = buildSConstruct({
            libSim,
            projectSrc,
            lcd: { width, height, cornerRadius, pixelBits },
            platform
        });

        fs.writeFileSync(sconstructPath, content, 'utf-8');
        this.logger.log('SConstruct 文件已生成');
    }

    /**
     * 解析分辨率字符串（如 "480X272"）
     */
    private parseResolution(resolution?: string): { width: number; height: number } {
        const defaultResolution = { width: 480, height: 272 };
        
        if (!resolution) {
            return defaultResolution;
        }

        const match = resolution.match(/(\d+)X(\d+)/i);
        if (match) {
            return {
                width: parseInt(match[1]),
                height: parseInt(match[2])
            };
        }

        return defaultResolution;
    }
    /**
     * 将 pixelMode 转换为像素位数
     */
    private getPixelBits(pixelMode?: string): number {
        switch (pixelMode) {
            case 'RGB565':
                return 16;
            case 'RGB888':
                return 24;
            case 'ARGB8888':
            default:
                return 32;  // 默认 ARGB8888
        }
    }

    /**
     * 扫描 HML 文件中使用的所有资源
     */
    private async scanUsedAssets(): Promise<{
        images: Set<string>;
        videos: Set<string>;
        models: Set<string>;
        fonts: Set<string>;
        mapFonts: Set<string>;
    }> {
        const images = new Set<string>();
        const videos = new Set<string>();
        const models = new Set<string>();
        const fonts = new Set<string>();
        const mapFonts = new Set<string>();

        const uiDir = path.join(this.projectRoot, 'ui');
        if (fs.existsSync(uiDir)) {
            // 递归扫描 HML 文件
            const scanDir = (dir: string) => {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        scanDir(fullPath);
                    } else if (entry.name.endsWith('.hml')) {
                        try {
                            const content = fs.readFileSync(fullPath, 'utf-8');
                            this.extractAssetReferences(content, images, videos, models, mapFonts);
                        } catch (error) {
                            this.logger.log(`读取 HML 文件失败: ${fullPath} - ${error}`, true);
                        }
                    }
                }
            };

            scanDir(uiDir);
        }

        // 添加 alwaysConvert 配置中的资源
        this.addAlwaysConvertAssets(images, videos, models, fonts);

        // 扫描 3D 模型中引用的纹理图片
        const assetsDir = path.join(this.projectRoot, 'assets');
        if (fs.existsSync(assetsDir)) {
            this.scanModelTextures(assetsDir, models, images);
        }

        return { images, videos, models, fonts, mapFonts };
    }

    /**
     * 全量扫描 assets 目录，返回所有资源文件
     * 仍需扫描 HML 获取 mapFonts（地图字体需特殊拷贝处理）
     */
    private async scanAllAssets(): Promise<{
        images: Set<string>;
        videos: Set<string>;
        models: Set<string>;
        fonts: Set<string>;
        mapFonts: Set<string>;
    }> {
        const images = new Set<string>();
        const videos = new Set<string>();
        const models = new Set<string>();
        const fonts = new Set<string>();
        const mapFonts = new Set<string>();

        const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp']);
        const videoExts = new Set(['.mp4', '.avi', '.mov', '.mkv', '.webm']);
        const modelExts = new Set(['.gltf', '.glb', '.obj']);
        // 字体不在全量扫描中收集，只转换 HML 中 Label 引用的字体

        // 预加载 conversion.json 用于 GIF 分类决策
        const conversionConfigService = ConversionConfigService.getInstance();
        const conversionConfig = conversionConfigService.loadConfig(this.projectRoot);

        const assetsDir = path.join(this.projectRoot, 'assets');
        if (fs.existsSync(assetsDir)) {
            const scanDir = (dir: string) => {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        // 跳过 user/ 目录，由 copyUserAssets 处理
                        const relDir = path.relative(assetsDir, fullPath).replace(/\\/g, '/');
                        if (relDir === 'user' || relDir.startsWith('user/')) {
                            continue;
                        }
                        scanDir(fullPath);
                    } else {
                        const relativePath = path.relative(assetsDir, fullPath).replace(/\\/g, '/');
                        // 跳过 user/ 目录下的文件
                        if (relativePath.startsWith('user/')) {
                            continue;
                        }
                        const ext = path.extname(entry.name).toLowerCase();
                        if (ext === '.gif') {
                            // GIF: 根据 conversion.json 的 gifAsVideo 标志决定分类
                            const gifSettings = conversionConfig.items[relativePath];
                            if (gifSettings?.gifAsVideo) {
                                videos.add(relativePath);
                            } else {
                                images.add(relativePath);
                            }
                        } else if (imageExts.has(ext)) {
                            images.add(relativePath);
                        } else if (videoExts.has(ext)) {
                            videos.add(relativePath);
                        } else if (modelExts.has(ext)) {
                            models.add(relativePath);
                        }
                    }
                }
            };
            scanDir(assetsDir);

            // 扫描 3D 模型中引用的纹理图片
            this.scanModelTextures(assetsDir, models, images);
        }

        // mapFonts 仍需从 HML 中获取（hg_map/hg_openclaw 组件的字体需直接拷贝）
        const uiDir = path.join(this.projectRoot, 'ui');
        if (fs.existsSync(uiDir)) {
            const dummyImages = new Set<string>();
            const dummyVideos = new Set<string>();
            const dummyModels = new Set<string>();
            const scanDir = (dir: string) => {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        scanDir(fullPath);
                    } else if (entry.name.endsWith('.hml')) {
                        try {
                            const content = fs.readFileSync(fullPath, 'utf-8');
                            this.extractAssetReferences(content, dummyImages, dummyVideos, dummyModels, mapFonts);
                        } catch (error) {
                            this.logger.log(`读取 HML 文件失败: ${fullPath} - ${error}`, true);
                        }
                    }
                }
            };
            scanDir(uiDir);
        }

        return { images, videos, models, fonts, mapFonts };
    }

    private addAlwaysConvertAssets(
        images: Set<string>,
        videos: Set<string>,
        models: Set<string>,
        fonts: Set<string>
    ): void {
        // 从 conversion.json 读取 alwaysConvert 配置
        const configService = ConversionConfigService.getInstance();
        const conversionConfig = configService.loadConfig(this.projectRoot);
        const alwaysConvert = conversionConfig.alwaysConvert;
        if (!alwaysConvert) {
            return;
        }

        const assetsDir = path.join(this.projectRoot, 'assets');
        if (!fs.existsSync(assetsDir)) {
            return;
        }

        // 收集 assets 目录下的所有文件
        const allFiles: string[] = [];
        const scanDir = (dir: string) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    scanDir(fullPath);
                } else {
                    const relativePath = path.relative(assetsDir, fullPath).replace(/\\/g, '/');
                    allFiles.push(relativePath);
                }
            }
        };
        scanDir(assetsDir);

        const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg']);
        const videoExts = new Set(['.mp4', '.avi', '.mov', '.mkv', '.webm']);
        const modelExts = new Set(['.gltf', '.glb', '.obj']);
        const fontExts  = new Set(['.ttf', '.otf', '.woff', '.woff2']);

        const matchFiles = (pattern: string, extFilter: Set<string>, target: Set<string>) => {
            if (allFiles.includes(pattern)) {
                // 精确路径：仍按扩展名过滤，避免误分类
                if (extFilter.has(path.extname(pattern).toLowerCase())) {
                    target.add(pattern);
                }
            } else {
                for (const file of allFiles) {
                    if (minimatch(file, pattern) && extFilter.has(path.extname(file).toLowerCase())) {
                        target.add(file);
                    }
                }
            }
        };

        // 匹配图片（支持精确路径和 glob 模式）
        if (alwaysConvert.images && Array.isArray(alwaysConvert.images)) {
            for (const pattern of alwaysConvert.images) {
                matchFiles(pattern, imageExts, images);
            }
        }

        // 匹配视频
        if (alwaysConvert.videos && Array.isArray(alwaysConvert.videos)) {
            for (const pattern of alwaysConvert.videos) {
                matchFiles(pattern, videoExts, videos);
            }
        }

        // 匹配 3D 模型
        if (alwaysConvert.models && Array.isArray(alwaysConvert.models)) {
            for (const pattern of alwaysConvert.models) {
                matchFiles(pattern, modelExts, models);
            }
        }

        // 匹配字体
        if (alwaysConvert.fonts && Array.isArray(alwaysConvert.fonts)) {
            for (const pattern of alwaysConvert.fonts) {
                matchFiles(pattern, fontExts, fonts);
            }
        }
    }

    /**
     * 从 HML 内容中提取资源引用
     */
    private extractAssetReferences(
        hmlContent: string,
        images: Set<string>,
        videos: Set<string>,
        models: Set<string>,
        mapFonts: Set<string>
    ): void {
        // 定义图片、视频、模型的扩展名
        const imageExts = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.svg'];
        const videoExts = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.m4v', '.3gp', '.asf', '.rm', '.rmvb', '.vob', '.ts'];
        const modelExts = ['.obj', '.gltf', '.glb'];

        // 辅助函数：处理资源路径并分类
        const processAssetPath = (assetPath: string) => {
            // 移除 assets/ 前缀
            if (assetPath.startsWith('assets/')) {
                assetPath = assetPath.substring(7);
            }

            // 根据扩展名分类
            const ext = path.extname(assetPath).toLowerCase();
            
            if (ext === '.gif') {
                // GIF: 根据 conversion.json 的 gifAsVideo 标志决定分类
                const conversionConfigService = ConversionConfigService.getInstance();
                const conversionConfig = conversionConfigService.loadConfig(this.projectRoot);
                const gifSettings = conversionConfig.items[assetPath];
                if (gifSettings?.gifAsVideo) {
                    videos.add(assetPath);
                } else {
                    images.add(assetPath);
                }
            } else if (imageExts.includes(ext)) {
                images.add(assetPath);
            } else if (videoExts.includes(ext)) {
                videos.add(assetPath);
            } else if (modelExts.includes(ext)) {
                models.add(assetPath);
            }
        };

        // 匹配所有可能包含资源路径的属性
        // src, modelPath, imageOn, imageOff, imageNormal, imagePressed, imageDisabled, backgroundImage 等
        const assetAttributeRegex = /(src|modelPath|imageOn|imageOff|imageNormal|imagePressed|imageDisabled|backgroundImage)\s*=\s*["']([^"']+)["']/g;
        let match;

        while ((match = assetAttributeRegex.exec(hmlContent)) !== null) {
            const assetPath = match[2];
            processAssetPath(assetPath);
        }

        // 特殊处理：hg_map/hg_openclaw 组件的 fontFile 和 emojiFontFile 属性（字体文件需要直接拷贝，不进行格式转换）
        // 只匹配 hg_map 和 hg_openclaw 标签内的 fontFile，避免误匹配 hg_label 等组件的字体属性
        const mapComponentRegex = /<(hg_map|hg_openclaw)\s[^>]*>/g;
        let compMatch;
        while ((compMatch = mapComponentRegex.exec(hmlContent)) !== null) {
            const tagContent = compMatch[0];
            const fontFileInTag = /(fontFile|emojiFontFile)\s*=\s*["']([^"']+)["']/g;
            let fontMatch;
            while ((fontMatch = fontFileInTag.exec(tagContent)) !== null) {
                let fontPath = fontMatch[2];
                if (fontPath.startsWith('assets/')) {
                    fontPath = fontPath.substring(7);
                }
                if (fontPath) {
                    mapFonts.add(fontPath);
                }
            }
        }

        // 特殊处理：timers 属性中的 imageSequence 和 changeImage 资源引用
        const timersRegex = /timers\s*=\s*"([^"]*)"/g;
        let timersMatch;
        while ((timersMatch = timersRegex.exec(hmlContent)) !== null) {
            try {
                // timers 属性值经过 HTML 实体编码，需要先解码
                const decoded = timersMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                const timers = JSON.parse(decoded);
                if (Array.isArray(timers)) {
                    for (const timer of timers) {
                        const segments = timer.segments || [];
                        for (const segment of segments) {
                            const actions = segment.actions || [];
                            for (const action of actions) {
                                // imageSequence: 图片序列动作
                                if (action.type === 'imageSequence' && Array.isArray(action.imageSequence)) {
                                    for (const imgPath of action.imageSequence) {
                                        processAssetPath(imgPath);
                                    }
                                }
                                // changeImage: 更换图片动作
                                if (action.type === 'changeImage' && action.imagePath) {
                                    processAssetPath(action.imagePath);
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                // timers JSON 解析失败，跳过
            }
        }

        // 特殊处理：hg_glass 的 src（玻璃效果文件已经在 convertGlassWithComponentConfig 中处理）
    }

    /**
     * 扫描 3D 模型文件中引用的纹理图片
     * 将纹理图片添加到待转换的图片列表中
     */
    private scanModelTextures(
        assetsDir: string,
        models: Set<string>,
        images: Set<string>
    ): void {
        for (const modelPath of models) {
            const fullPath = path.join(assetsDir, modelPath);
            if (!fs.existsSync(fullPath)) {
                continue;
            }

            const ext = path.extname(modelPath).toLowerCase();
            const modelDir = path.dirname(modelPath);

            try {
                if (ext === '.gltf') {
                    // 解析 GLTF 文件中的纹理引用
                    const gltfContent = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
                    if (gltfContent.images) {
                        for (const image of gltfContent.images) {
                            if (image.uri && !image.uri.startsWith('data:')) {
                                // GLTF 中的 URI 是相对于 GLTF 文件的路径
                                const texturePath = modelDir ? `${modelDir}/${image.uri}` : image.uri;
                                images.add(texturePath);
                            }
                        }
                    }
                } else if (ext === '.obj') {
                    // 解析 OBJ 文件中的 MTL 引用
                    const objContent = fs.readFileSync(fullPath, 'utf-8');
                    const mtlMatch = /^mtllib\s+(.+)$/m.exec(objContent);
                    if (mtlMatch) {
                        const mtlPath = path.join(assetsDir, modelDir, mtlMatch[1].trim());
                        if (fs.existsSync(mtlPath)) {
                            // 解析 MTL 文件中的纹理引用
                            const mtlContent = fs.readFileSync(mtlPath, 'utf-8');
                            const textureMatches = mtlContent.matchAll(/^map_Kd\s+(.+)$/gm);
                            for (const match of textureMatches) {
                                const texturePath = modelDir ? `${modelDir}/${match[1].trim()}` : match[1].trim();
                                images.add(texturePath);
                            }
                        }
                    }
                }
            } catch (error) {
                this.logger.log(`扫描模型纹理失败: ${modelPath} - ${error}`, true);
            }
        }
    }

    /**
     * 转换使用的图片资源
     */
    private async convertUsedImages(
        assetsDir: string,
        outputDir: string,
        usedImages: Set<string>,
        fallbackOptions?: ImageConvertOptions
    ): Promise<ConvertResult[]> {
        if (usedImages.size === 0) {
            return [];
        }

        // 获取项目根目录
        const projectRoot = path.dirname(assetsDir);
        
        // 加载 conversion.json 配置
        const configService = ConversionConfigService.getInstance();
        const config = configService.loadConfig(projectRoot);

        const imageConverter = new ImageConverterService();
        const items: Array<{ input: string; output: string; options?: ImageConvertOptions }> = [];

        for (const relativePath of usedImages) {
            const fullPath = path.join(assetsDir, relativePath);
            
            // 检查文件是否存在
            if (!fs.existsSync(fullPath)) {
                this.logger.log(`图片文件不存在: ${relativePath}`, true);
                continue;
            }

            const outputPath = path.join(outputDir, relativePath.replace(/\.(png|jpe?g|bmp|gif|svg)$/i, '.bin'));
            
            // GIF 和 SVG 文件特殊处理
            const ext = path.extname(relativePath).toLowerCase();
            if (ext === '.gif') {
                // 如果该 GIF 被标记为按视频处理，跳过（由视频管道处理）
                const gifSettings = config.items[relativePath];
                if (gifSettings?.gifAsVideo) {
                    continue;
                }
                items.push({ input: fullPath, output: outputPath });
            } else if (ext === '.svg') {
                // SVG 直接拷贝，不转换
                const destDir = path.dirname(outputPath.replace(/\.bin$/, '.svg'));
                if (!fs.existsSync(destDir)) {
                    fs.mkdirSync(destDir, { recursive: true });
                }
                fs.copyFileSync(fullPath, outputPath.replace(/\.bin$/, '.svg'));
            } else {
                // 为每个图片解析其特定的配置
                const imageOptions = this.resolveImageOptions(relativePath, fullPath, config, fallbackOptions);
                items.push({ input: fullPath, output: outputPath, options: imageOptions });
            }
        }

        return imageConverter.convertBatch(items);
    }

    /**
     * 转换使用的视频资源
     */
    private async convertUsedVideos(
        videoConverter: VideoConverterService,
        assetsDir: string,
        outputDir: string,
        usedVideos: Set<string>
    ): Promise<any[]> {
        if (usedVideos.size === 0) {
            return [];
        }

        // 获取项目中所有视频组件的配置
        const videoComponentConfigs = await this.getVideoComponentConfigs();
        
        // 加载 conversion.json 配置
        const conversionConfigService = ConversionConfigService.getInstance();
        const conversionConfig = conversionConfigService.loadConfig(this.projectRoot);
        
        const convertTasks: Array<Promise<any>> = [];

        for (const relativePath of usedVideos) {
            const fullPath = path.join(assetsDir, relativePath);
            
            // 检查文件是否存在
            if (!fs.existsSync(fullPath)) {
                this.logger.log(`视频文件不存在: ${relativePath}`, true);
                continue;
            }

            const normalizedPath = relativePath.replace(/\\/g, '/');
            
            // 查找使用此视频的组件配置
            const componentConfig = videoComponentConfigs.find(config => 
                config.src === normalizedPath || 
                config.src === `assets/${normalizedPath}` ||
                config.src.endsWith(normalizedPath)
            );
            
            // 从 conversion.json 解析视频格式（处理继承）
            const resolvedVideoFormat = this.resolveVideoFormat(normalizedPath, conversionConfig);
            
            // 从 conversion.json 解析视频质量（处理继承）
            const resolvedVideoQuality = this.resolveVideoQuality(normalizedPath, conversionConfig);
            
            // 从 conversion.json 解析视频帧率（处理继承）
            const resolvedVideoFrameRate = this.resolveVideoFrameRate(normalizedPath, conversionConfig);
            
            // 从 conversion.json 解析视频缩放（处理继承）
            const resolvedVideoScale = this.resolveVideoScale(normalizedPath, conversionConfig);
            
            // 从 conversion.json 解析视频裁剪（处理继承）
            const resolvedVideoCrop = this.resolveVideoCrop(normalizedPath, conversionConfig);
            
            // 从 conversion.json 解析预处理顺序（处理继承）
            const resolvedPreprocessOrder = this.resolvePreprocessOrder(normalizedPath, conversionConfig);
            
            // 优先级：组件配置 > conversion.json > 项目配置 > 默认值
            const configFormat = componentConfig?.format || 
                resolvedVideoFormat ||
                (this.projectConfig.videoFormat as 'mjpeg' | 'avi' | 'h264') || 'mjpeg';
            
            // 获取原始质量值：组件配置 > conversion.json > 项目配置
            const rawQuality = componentConfig?.quality ?? resolvedVideoQuality ?? this.projectConfig.videoQuality;
            
            // 获取帧率：组件配置 > conversion.json > 项目配置 > 默认值 30
            const frameRate = componentConfig?.frameRate ?? resolvedVideoFrameRate ?? this.projectConfig.videoFrameRate ?? 30;
            
            // 根据格式校验和修正质量值
            const quality = this.normalizeVideoQuality(rawQuality, configFormat);
            
            // 从 conversion.json 缩放配置计算 ScaleOptions
            let computedScale: { width?: number; height?: number } | undefined;
            if (resolvedVideoScale) {
                if (resolvedVideoScale.mode === 'percentage' && (resolvedVideoScale.widthPercentage || resolvedVideoScale.heightPercentage)) {
                    try {
                        // crop-then-scale：百分比基于裁剪后的尺寸（上一步输出），而非原始视频
                        // scale-then-crop 或无裁剪：百分比基于原始视频尺寸
                        let baseWidth: number | undefined;
                        let baseHeight: number | undefined;
                        const effectiveOrder = resolvedPreprocessOrder ?? 'crop-then-scale';
                        if (effectiveOrder === 'crop-then-scale' && resolvedVideoCrop) {
                            baseWidth = resolvedVideoCrop.width;
                            baseHeight = resolvedVideoCrop.height;
                        } else {
                            const videoInfo = await videoConverter.getVideoInfo(fullPath);
                            if (videoInfo?.width && videoInfo?.height) {
                                baseWidth = videoInfo.width;
                                baseHeight = videoInfo.height;
                            } else {
                                this.logger.log(`无法获取视频信息以计算缩放比例: ${normalizedPath}，跳过缩放`, true);
                            }
                        }
                        if (baseWidth && baseHeight) {
                            const wp = resolvedVideoScale.widthPercentage;
                            const hp = resolvedVideoScale.heightPercentage;
                            if (wp && hp) {
                                computedScale = {
                                    width: Math.round(baseWidth * wp / 100 / 2) * 2,
                                    height: Math.round(baseHeight * hp / 100 / 2) * 2,
                                };
                            } else if (wp) {
                                computedScale = { width: Math.round(baseWidth * wp / 100 / 2) * 2 };
                            } else if (hp) {
                                computedScale = { height: Math.round(baseHeight * hp / 100 / 2) * 2 };
                            }
                        }
                    } catch (e) {
                        this.logger.log(`获取视频信息失败: ${normalizedPath} - ${e}，跳过缩放`, true);
                    }
                } else if (resolvedVideoScale.mode === 'pixels' && (resolvedVideoScale.width || resolvedVideoScale.height)) {
                    computedScale = {
                        width: resolvedVideoScale.width,
                        height: resolvedVideoScale.height,
                    };
                }
            }
            
            const options = {
                format: configFormat,
                quality: quality,
                frameRate: frameRate,
                crop: resolvedVideoCrop,
                scale: computedScale,
                preprocessOrder: resolvedPreprocessOrder,
            };
            
            // 生成输出路径
            const outputExt = this.getVideoOutputExtension(options.format);
            const outputPath = path.join(
                outputDir,
                relativePath.replace(/\.[^.]+$/i, outputExt)
            );
            
            // 添加转换任务
            convertTasks.push(
                videoConverter.convert(fullPath, outputPath, options)
            );
            
            this.logger.log(`计划转换: ${normalizedPath} -> ${options.format} (${outputExt})`);
        }

        // 并行执行所有转换任务
        return Promise.all(convertTasks);
    }

    /**
     * 转换使用的 3D 模型资源
     */
    private async convertUsedModels(
        assetsDir: string,
        outputDir: string,
        usedModels: Set<string>
    ): Promise<any[]> {
        if (usedModels.size === 0) {
            return [];
        }

        const model3DConverter = new Model3DConverterService();
        const convertTasks: Array<Promise<any>> = [];

        for (const relativePath of usedModels) {
            const fullPath = path.join(assetsDir, relativePath);
            
            // 检查文件是否存在
            if (!fs.existsSync(fullPath)) {
                this.logger.log(`3D模型文件不存在: ${relativePath}`, true);
                continue;
            }

            // 根据文件类型生成正确的输出文件名
            const ext = path.extname(relativePath).toLowerCase();
            const baseName = path.basename(relativePath, ext);
            const dirName = path.dirname(relativePath);
            
            // GLTF 文件使用 gltf_desc_ 前缀，OBJ 文件使用 desc_ 前缀
            const prefix = ext === '.gltf' ? 'gltf_desc_' : 'desc_';
            const outputFileName = prefix + baseName + '.bin';
            const outputPath = path.join(outputDir, dirName, outputFileName);
            
            // 直接传递 outputDir，让 Parser 在整个输出目录中查找纹理
            // Parser 会使用递归查找来定位纹理 bin 文件
            convertTasks.push(
                model3DConverter.convert(fullPath, outputPath, outputDir)
            );
        }

        // 并行执行所有转换任务
        return Promise.all(convertTasks);
    }

    /**
     * 判断格式是否为自适应格式
     * @param format 目标格式
     * @returns 如果是 adaptive16 或 adaptive24 返回 true，否则返回 false
     */
    private static isAdaptiveFormat(format: string): boolean {
        return format === 'adaptive16' || format === 'adaptive24';
    }

    /**
     * 判断格式是否为明确指定的格式
     * @param format 目标格式
     * @returns 如果是明确格式（RGB565、ARGB8565、RGB888、ARGB8888、I8）返回 true，否则返回 false
     */
    private static isExplicitFormat(format: string): boolean {
        const explicitFormats = ['RGB565', 'ARGB8565', 'RGB888', 'ARGB8888', 'I8'];
        return explicitFormats.includes(format);
    }

    /**
     * 解析单个图片的转换选项
     * @param relativePath 相对于 assets 目录的路径
     * @param fullPath 图片完整路径
     * @param config 转换配置
     * @param fallbackOptions 回退选项
     */
    private resolveImageOptions(
        relativePath: string,
        fullPath: string,
        config: ConversionConfig,
        fallbackOptions?: ImageConvertOptions
    ): ImageConvertOptions {
        const configService = ConversionConfigService.getInstance();
        const resolvedConfig = configService.resolveEffectiveConfig(relativePath, config);
        
        // 使用继承解析后的原始格式（rawFormat 包含了父文件夹继承的结果）
        const effectiveFormat = resolvedConfig.rawFormat || resolvedConfig.format || 'adaptive16';
        
        // 调试日志
        console.log(`[DEBUG] resolveImageOptions for: ${relativePath}`);
        console.log(`[DEBUG] effectiveFormat (from inheritance): ${effectiveFormat}`);
        console.log(`[DEBUG] isAdaptiveFormat: ${BuildCore.isAdaptiveFormat(effectiveFormat)}`);
        console.log(`[DEBUG] isInherited: ${resolvedConfig.isInherited}, inheritedFrom: ${resolvedConfig.inheritedFrom}`);
        
        // 解析格式（只对自适应格式进行透明通道检测和格式调整）
        let format: string;
        
        // 只对自适应格式进行透明通道检测和格式调整
        if (BuildCore.isAdaptiveFormat(effectiveFormat)) {
            // 检查图片是否有透明度
            const hasAlpha = this.checkImageHasAlpha(fullPath);
            // 解析自适应格式
            format = configService.resolveAdaptiveFormat(effectiveFormat, hasAlpha);
            console.log(`[DEBUG] Adaptive format - hasAlpha: ${hasAlpha}, resolved to: ${format}`);
        } else {
            // 对于明确指定的格式，直接使用原始格式，不做任何调整
            format = effectiveFormat;
            console.log(`[DEBUG] Explicit format - using: ${format}`);
        }
        
        // 构建选项
        const options: ImageConvertOptions = {
            format: format.toLowerCase(),
            compression: resolvedConfig.compression as CompressionType,
            dither: resolvedConfig.dither
        };
        
        // 如果是 YUV 压缩，添加 YUV 参数
        if (resolvedConfig.compression === 'yuv' && resolvedConfig.yuvParams) {
            options.yuvSampleMode = resolvedConfig.yuvParams.sampling.toLowerCase() as YuvSampleMode;
            options.yuvBlurBits = this.parseYuvBlurBits(resolvedConfig.yuvParams.blur);
            options.yuvFastlz = resolvedConfig.yuvParams.fastlzSecondary;
        }
        
        // 如果是 JPEG 压缩，添加 JPEG 参数
        if (resolvedConfig.compression === 'jpeg' && resolvedConfig.jpegParams) {
            const samplingMap: Record<string, SamplingFactor> = {
                'yuv420': SamplingFactor.YUV420,
                'yuv422': SamplingFactor.YUV422,
                'yuv444': SamplingFactor.YUV444,
                'grayscale': SamplingFactor.Grayscale
            };
            options.jpegSampling = samplingMap[resolvedConfig.jpegParams.sampling.toLowerCase()] || SamplingFactor.YUV420;
            options.jpegQuality = resolvedConfig.jpegParams.quality;
            options.jpegBackgroundColor = resolvedConfig.jpegParams.backgroundColor;
        }
        
        // adaptive 压缩直接传递，由 ImageConverterService.convert 自动比较 RLE/FastLZ 选最优
        
        return options;
    }

    /**
     * 检查图片是否包含透明度
     */
    private checkImageHasAlpha(imagePath: string): boolean {
        try {
            // 简单判断：PNG 文件可能有透明度，其他格式通常没有
            const ext = path.extname(imagePath).toLowerCase();
            if (ext !== '.png') {
                return false;
            }
            
            // 读取 PNG 文件头来判断是否有 alpha 通道
            const buffer = fs.readFileSync(imagePath);
            if (buffer.length < 26) {
                return false;
            }
            
            // PNG 签名检查
            const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
            for (let i = 0; i < 8; i++) {
                if (buffer[i] !== pngSignature[i]) {
                    return false;
                }
            }
            
            // IHDR chunk 中的 color type 在偏移 25 处
            // Color type 4 = Grayscale with alpha
            // Color type 6 = RGBA
            const colorType = buffer[25];
            return colorType === 4 || colorType === 6;
        } catch (error) {
            // 如果无法读取，假设没有透明度
            return false;
        }
    }

    /**
     * 解析 YUV 模糊位数
     */
    private parseYuvBlurBits(blur: YuvBlur): YuvBlurBits {
        switch (blur) {
            case '1bit': return 1;
            case '2bit': return 2;
            case '4bit': return 4;
            default: return 0;
        }
    }

    /**
     * 根据组件配置转换视频资源
     */
    private async convertVideosWithComponentConfig(
        videoConverter: VideoConverterService,
        assetsDir: string,
        outputDir: string
    ): Promise<any[]> {
        if (!fs.existsSync(assetsDir)) {
            return [];
        }

        // 获取项目中所有视频组件的配置
        const videoComponentConfigs = await this.getVideoComponentConfigs();
        
        // 加载 conversion.json 配置
        const conversionConfigService = ConversionConfigService.getInstance();
        const conversionConfig = conversionConfigService.loadConfig(this.projectRoot);
        
        // 支持的视频格式
        const videoExts = [
            '.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv',
            '.m4v', '.3gp', '.asf', '.rm', '.rmvb', '.vob', '.ts',
            '.gif'  // GIF 当 gifAsVideo=true 时作为视频处理
        ];
        
        const convertTasks: Array<Promise<any>> = [];

        const scanDir = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    scanDir(fullPath);
                } else if (videoExts.includes(path.extname(entry.name).toLowerCase())) {
                    const relativePath = path.relative(assetsDir, fullPath);
                    const normalizedPath = relativePath.replace(/\\/g, '/');
                    
                    // GIF 文件：仅当 gifAsVideo=true 时才作为视频处理
                    if (path.extname(entry.name).toLowerCase() === '.gif') {
                        const gifSettings = conversionConfig.items[normalizedPath];
                        if (!gifSettings?.gifAsVideo) {
                            continue;
                        }
                    }
                    
                    // 查找使用此视频的组件配置
                    const componentConfig = videoComponentConfigs.find(config => 
                        config.src === normalizedPath || 
                        config.src === `assets/${normalizedPath}` ||
                        config.src.endsWith(normalizedPath)
                    );
                    
                    // 从 conversion.json 解析视频格式（处理继承）
                    const resolvedVideoFormat = this.resolveVideoFormat(normalizedPath, conversionConfig);
                    
                    // 从 conversion.json 解析视频质量（处理继承）
                    const resolvedVideoQuality = this.resolveVideoQuality(normalizedPath, conversionConfig);
                    
                    // 从 conversion.json 解析视频帧率（处理继承）
                    const resolvedVideoFrameRate = this.resolveVideoFrameRate(normalizedPath, conversionConfig);
                    
                    // 优先级：组件配置 > conversion.json > 项目配置 > 默认值
                    const configFormat = componentConfig?.format || 
                        resolvedVideoFormat ||
                        (this.projectConfig.videoFormat as 'mjpeg' | 'avi' | 'h264') || 'mjpeg';
                    
                    // 获取原始质量值：组件配置 > conversion.json > 项目配置
                    const rawQuality = componentConfig?.quality ?? resolvedVideoQuality ?? this.projectConfig.videoQuality;
                    
                    // 获取帧率：组件配置 > conversion.json > 项目配置 > 默认值 30
                    const frameRate = componentConfig?.frameRate ?? resolvedVideoFrameRate ?? this.projectConfig.videoFrameRate ?? 30;
                    
                    // 根据格式校验和修正质量值
                    const quality = this.normalizeVideoQuality(rawQuality, configFormat);
                    
                    const options = componentConfig ? {
                        format: configFormat,
                        quality: quality,
                        frameRate: frameRate,
                        crop: componentConfig.crop,
                        scale: componentConfig.scale
                    } : {
                        format: configFormat,
                        quality: quality,
                        frameRate: frameRate
                    };
                    
                    // 生成输出路径
                    const outputExt = this.getVideoOutputExtension(options.format);
                    const outputPath = path.join(
                        outputDir,
                        relativePath.replace(/\.[^.]+$/i, outputExt)
                    );
                    
                    // 添加转换任务
                    convertTasks.push(
                        videoConverter.convert(fullPath, outputPath, options)
                    );
                    
                    this.logger.log(`计划转换: ${normalizedPath} -> ${options.format} (${outputExt})`);
                }
            }
        };

        scanDir(assetsDir);
        
        // 并行执行所有转换任务
        return Promise.all(convertTasks);
    }
    
    /**
     * 解析视频格式配置（处理继承）
     * @param assetPath 资源路径（相对于 assets 目录）
     * @param config conversion.json 配置
     * @returns 解析后的视频格式，如果没有配置则返回 undefined
     */
    private resolveVideoFormat(
        assetPath: string, 
        config: { items: Record<string, { videoFormat?: VideoFormat }> }
    ): 'mjpeg' | 'avi' | 'h264' | 'avi_msv1' | 'avi_cinepak' | undefined {
        const normalizedPath = assetPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        const itemSettings = config.items[normalizedPath];
        
        // 如果有明确配置且不是 inherit，直接使用
        if (itemSettings?.videoFormat && itemSettings.videoFormat !== 'inherit') {
            const fmt = itemSettings.videoFormat.toLowerCase();
            if (fmt === 'msv1') { return 'avi_msv1'; }
            if (fmt === 'cinepak') { return 'avi_cinepak'; }
            return fmt as 'mjpeg' | 'avi' | 'h264';
        }
        
        // 需要继承：查找父级配置
        const pathParts = normalizedPath.split('/');
        for (let i = pathParts.length - 1; i >= 0; i--) {
            const parentPath = pathParts.slice(0, i).join('/');
            const parentSettings = config.items[parentPath];
            
            if (parentSettings?.videoFormat && parentSettings.videoFormat !== 'inherit') {
                const fmt = parentSettings.videoFormat.toLowerCase();
                if (fmt === 'msv1') { return 'avi_msv1'; }
                if (fmt === 'cinepak') { return 'avi_cinepak'; }
                return fmt as 'mjpeg' | 'avi' | 'h264';
            }
        }
        
        // 没有找到配置，返回 undefined（让调用方使用默认值）
        return undefined;
    }

    /**
     * 解析视频质量配置（处理继承）
     * @param assetPath 资源路径（相对于 assets 目录）
     * @param config conversion.json 配置
     * @returns 解析后的视频质量，如果没有配置则返回 undefined
     */
    private resolveVideoQuality(
        assetPath: string, 
        config: { items: Record<string, { videoQuality?: number }> }
    ): number | undefined {
        const normalizedPath = assetPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        const itemSettings = config.items[normalizedPath];
        
        // 如果有明确配置，直接使用
        if (itemSettings?.videoQuality !== undefined) {
            return itemSettings.videoQuality;
        }
        
        // 需要继承：查找父级配置
        const pathParts = normalizedPath.split('/');
        for (let i = pathParts.length - 1; i >= 0; i--) {
            const parentPath = pathParts.slice(0, i).join('/');
            const parentSettings = config.items[parentPath];
            
            if (parentSettings?.videoQuality !== undefined) {
                return parentSettings.videoQuality;
            }
        }
        
        // 没有找到配置，返回 undefined（让调用方使用默认值）
        return undefined;
    }

    /**
     * 解析视频帧率配置（处理继承）
     * @param assetPath 资源路径（相对于 assets 目录）
     * @param config conversion.json 配置
     * @returns 解析后的视频帧率，如果没有配置则返回 undefined
     */
    private resolveVideoFrameRate(
        assetPath: string, 
        config: { items: Record<string, { videoFrameRate?: number }> }
    ): number | undefined {
        const normalizedPath = assetPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        const itemSettings = config.items[normalizedPath];
        
        // 如果有明确配置，直接使用
        if (itemSettings?.videoFrameRate !== undefined) {
            return itemSettings.videoFrameRate;
        }
        
        // 需要继承：查找父级配置
        const pathParts = normalizedPath.split('/');
        for (let i = pathParts.length - 1; i >= 0; i--) {
            const parentPath = pathParts.slice(0, i).join('/');
            const parentSettings = config.items[parentPath];
            
            if (parentSettings?.videoFrameRate !== undefined) {
                return parentSettings.videoFrameRate;
            }
        }
        
        // 没有找到配置，返回 undefined（让调用方使用默认值）
        return undefined;
    }

    /**
     * 解析视频缩放配置（处理继承）
     * @param assetPath 资源路径（相对于 assets 目录）
     * @param config conversion.json 配置
     * @returns 解析后的视频缩放配置，如果没有配置则返回 undefined
     */
    private resolveVideoScale(
        assetPath: string,
        config: { items: Record<string, { videoScale?: VideoScaleConfig }> }
    ): VideoScaleConfig | undefined {
        const normalizedPath = assetPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        const itemSettings = config.items[normalizedPath];

        if (itemSettings?.videoScale !== undefined) {
            return itemSettings.videoScale;
        }

        const pathParts = normalizedPath.split('/');
        for (let i = pathParts.length - 1; i >= 0; i--) {
            const parentPath = pathParts.slice(0, i).join('/');
            const parentSettings = config.items[parentPath];

            if (parentSettings?.videoScale !== undefined) {
                return parentSettings.videoScale;
            }
        }

        return undefined;
    }

    /**
     * 解析视频裁剪配置（处理继承）
     * @param assetPath 资源路径（相对于 assets 目录）
     * @param config conversion.json 配置
     * @returns 解析后的视频裁剪配置，如果没有配置则返回 undefined
     */
    private resolveVideoCrop(
        assetPath: string,
        config: { items: Record<string, { videoCrop?: VideoCropConfig }> }
    ): VideoCropConfig | undefined {
        const normalizedPath = assetPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        const itemSettings = config.items[normalizedPath];

        if (itemSettings?.videoCrop !== undefined) {
            return itemSettings.videoCrop;
        }

        const pathParts = normalizedPath.split('/');
        for (let i = pathParts.length - 1; i >= 0; i--) {
            const parentPath = pathParts.slice(0, i).join('/');
            const parentSettings = config.items[parentPath];

            if (parentSettings?.videoCrop !== undefined) {
                return parentSettings.videoCrop;
            }
        }

        return undefined;
    }

    /**
     * 解析预处理顺序配置（处理继承）
     * @param assetPath 资源路径（相对于 assets 目录）
     * @param config conversion.json 配置
     * @returns 解析后的顺序配置，如果没有配置则返回 undefined
     */
    private resolvePreprocessOrder(
        assetPath: string,
        config: { items: Record<string, { preprocessOrder?: PreprocessOrder }> }
    ): PreprocessOrder | undefined {
        const normalizedPath = assetPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        const itemSettings = config.items[normalizedPath];

        if (itemSettings?.preprocessOrder !== undefined) {
            return itemSettings.preprocessOrder;
        }

        const pathParts = normalizedPath.split('/');
        for (let i = pathParts.length - 1; i >= 0; i--) {
            const parentPath = pathParts.slice(0, i).join('/');
            const parentSettings = config.items[parentPath];

            if (parentSettings?.preprocessOrder !== undefined) {
                return parentSettings.preprocessOrder;
            }
        }

        return undefined;
    }

    /**
     * 获取项目中所有视频组件的配置
     */
    private async getVideoComponentConfigs(): Promise<Array<{
        src: string;
        format?: 'mjpeg' | 'avi' | 'h264';
        quality?: number;
        frameRate?: number;
        crop?: any;
        scale?: any;
    }>> {
        const configs: Array<any> = [];
        
        try {
            // 扫描 UI 目录中的所有 HML 文件
            const uiDir = path.join(this.projectRoot, 'ui');
            if (fs.existsSync(uiDir)) {
                await this.scanHmlFilesForVideoConfigs(uiDir, configs);
            }
        } catch (error) {
            this.logger.log(`读取视频组件配置时出错: ${error}`, true);
        }
        
        return configs;
    }

    /**
     * 扫描 HML 文件中的视频组件配置
     */
    private async scanHmlFilesForVideoConfigs(dir: string, configs: Array<any>): Promise<void> {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                await this.scanHmlFilesForVideoConfigs(fullPath, configs);
            } else if (entry.name.endsWith('.hml')) {
                try {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    this.extractVideoConfigsFromHml(content, configs);
                } catch (error) {
                    this.logger.log(`读取 HML 文件失败: ${fullPath} - ${error}`, true);
                }
            }
        }
    }

    /**
     * 从 HML 内容中提取视频组件配置
     */
    private extractVideoConfigsFromHml(hmlContent: string, configs: Array<any>): void {
        // 使用正则表达式匹配 hg_video 标签
        const videoTagRegex = /<hg_video[^>]*>/g;
        let match;
        
        while ((match = videoTagRegex.exec(hmlContent)) !== null) {
            const tagContent = match[0];
            
            // 提取属性
            const config: any = {};
            
            // 提取 src 属性
            const srcMatch = tagContent.match(/src\s*=\s*["']([^"']+)["']/);
            if (srcMatch) {
                config.src = srcMatch[1];
            }
            
            // 提取 format 属性
            const formatMatch = tagContent.match(/format\s*=\s*["']([^"']+)["']/);
            if (formatMatch) {
                config.format = formatMatch[1];
            }
            
            // 提取 quality 属性
            const qualityMatch = tagContent.match(/quality\s*=\s*["']?(\d+)["']?/);
            if (qualityMatch) {
                config.quality = parseInt(qualityMatch[1]);
            }
            
            // 提取 frameRate 属性
            const frameRateMatch = tagContent.match(/frameRate\s*=\s*["']?(\d+)["']?/);
            if (frameRateMatch) {
                config.frameRate = parseInt(frameRateMatch[1]);
            }
            
            // 只有当有 src 属性时才添加配置
            if (config.src) {
                configs.push(config);
            }
        }
    }

    /**
     * 获取视频输出扩展名
     */
    private getVideoOutputExtension(format: string): string {
        switch (format) {
            case 'mjpeg':
                return '.mjpeg';
            case 'avi':
            case 'avi_msv1':
            case 'avi_cinepak':
                return '.avi';
            case 'h264':
                return '.h264';
            default:
                return '.mjpeg';
        }
    }

    /**
     * 校验和修正视频质量值
     * MJPEG/AVI: 1-31 (1=最高质量)
     * H.264: 0-51 (CRF值，23=默认)
     */
    private normalizeVideoQuality(quality: number | undefined, format: string): number {
        if (format === 'h264') {
            // H.264 CRF 值范围 0-51，默认 23
            if (quality === undefined || quality < 0 || quality > 51) {
                return 23;
            }
            return quality;
        } else {
            // MJPEG/AVI 质量范围 1-31，默认 1（最高质量）
            if (quality === undefined || quality < 1 || quality > 31) {
                return 1;
            }
            return quality;
        }
    }

    /**
     * 拷贝 SVG 资源（不需要转换，直接拷贝）
     */
    protected copySvgAssets(assetsDir: string, outputDir: string): number {
        let count = 0;
        
        const scanDir = (dir: string) => {
            if (!fs.existsSync(dir)) return;
            
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    // 跳过 user/ 目录，由 copyUserAssets 处理
                    const relDir = path.relative(assetsDir, fullPath).replace(/\\/g, '/');
                    if (relDir === 'user' || relDir.startsWith('user/')) {
                        continue;
                    }
                    scanDir(fullPath);
                } else if (entry.name.toLowerCase().endsWith('.svg')) {
                    const relativePath = path.relative(assetsDir, fullPath);
                    // 跳过 user/ 目录下的文件
                    if (relativePath.replace(/\\/g, '/').startsWith('user/')) {
                        continue;
                    }
                    const destPath = path.join(outputDir, relativePath);
                    const destDir = path.dirname(destPath);
                    
                    if (!fs.existsSync(destDir)) {
                        fs.mkdirSync(destDir, { recursive: true });
                    }
                    fs.copyFileSync(fullPath, destPath);
                    count++;
                }
            }
        };
        
        scanDir(assetsDir);
        return count;
    }

    /**
     * 拷贝 TRMAP 资源（不需要转换，直接拷贝）
     */
    protected copyTrmapAssets(assetsDir: string, outputDir: string): number {
        let count = 0;
        
        const scanDir = (dir: string) => {
            if (!fs.existsSync(dir)) return;
            
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    // 跳过 user/ 目录，由 copyUserAssets 处理
                    const relDir = path.relative(assetsDir, fullPath).replace(/\\/g, '/');
                    if (relDir === 'user' || relDir.startsWith('user/')) {
                        continue;
                    }
                    scanDir(fullPath);
                } else if (entry.name.toLowerCase().endsWith('.trmap')) {
                    const relativePath = path.relative(assetsDir, fullPath);
                    // 跳过 user/ 目录下的文件
                    if (relativePath.replace(/\\/g, '/').startsWith('user/')) {
                        continue;
                    }
                    const destPath = path.join(outputDir, relativePath);
                    const destDir = path.dirname(destPath);
                    
                    if (!fs.existsSync(destDir)) {
                        fs.mkdirSync(destDir, { recursive: true });
                    }
                    fs.copyFileSync(fullPath, destPath);
                    count++;
                }
            }
        };
        
        scanDir(assetsDir);
        return count;
    }

    /**
     * 拷贝 user 目录下的资源（直接复制，不进行任何格式转换）
     */
    protected copyUserAssets(assetsDir: string, outputDir: string): number {
        const userDir = path.join(assetsDir, 'user');
        const userOutputDir = path.join(outputDir, 'user');

        if (!fs.existsSync(userDir)) {
            return 0;
        }

        let count = 0;

        const copyDir = (src: string, dest: string) => {
            if (!fs.existsSync(dest)) {
                fs.mkdirSync(dest, { recursive: true });
            }
            for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
                const srcPath = path.join(src, entry.name);
                const destPath = path.join(dest, entry.name);
                if (entry.isDirectory()) {
                    copyDir(srcPath, destPath);
                } else {
                    fs.copyFileSync(srcPath, destPath);
                    count++;
                }
            }
        };

        copyDir(userDir, userOutputDir);
        return count;
    }

    /**
     * 拷贝向量地图（hg_map）组件引用的字体文件
     * 这些字体通过 VFS 文件系统直接加载，无需格式转换
     */
    protected copyMapFonts(assetsDir: string, outputDir: string, mapFonts: Set<string>): number {
        let count = 0;
        for (const fontRelPath of mapFonts) {
            const srcPath = path.join(assetsDir, fontRelPath);
            if (!fs.existsSync(srcPath)) {
                this.logger.log(`向量地图字体文件不存在，跳过: ${fontRelPath}`, true);
                continue;
            }
            const destPath = path.join(outputDir, fontRelPath);
            const destDir = path.dirname(destPath);
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }
            fs.copyFileSync(srcPath, destPath);
            count++;
        }
        return count;
    }

    /**
     * 根据 Label 组件配置转换字体资源
     * 
     * 从 HML 文件中提取所有 hg_label 组件的字体配置，
     * 使用组件的文本内容作为字符集进行转换
     */
    private async convertFontsWithLabelConfig(
        assetsDir: string,
        outputDir: string,
        alwaysConvertFonts: Set<string> = new Set()
    ): Promise<any[]> {
        // 获取项目中所有 Label 组件的字体配置
        const labelConfigs = await this.getLabelFontConfigs();
        
        const results: any[] = [];

        if (labelConfigs.length === 0 && alwaysConvertFonts.size === 0) {
            this.logger.log('未找到需要转换的字体配置');
            return results;
        }

        // 加载 conversion.json 以获取每个字体的 fontCopyOnly 设置
        const conversionConfigService = ConversionConfigService.getInstance();
        const conversionConfig = conversionConfigService.loadConfig(this.projectRoot);

        // 按字体文件+配置分组，合并相同配置的字符集
        const fontGroups = this.groupLabelConfigsByFont(labelConfigs);
        
        const fontConverter = new FontConverterService();

        for (const group of fontGroups) {
            const fontPath = path.join(assetsDir, group.fontFile);
            
            // 检查字体文件是否存在
            if (!fs.existsSync(fontPath)) {
                this.logger.log(`字体文件不存在: ${group.fontFile}`, true);
                results.push({
                    success: false,
                    inputPath: fontPath,
                    outputPath: outputDir,
                    error: '字体文件不存在'
                });
                continue;
            }

            // 确定输出目录（保持原始目录结构）
            const fontDir = path.dirname(group.fontFile);
            const fontOutputDir = fontDir ? path.join(outputDir, fontDir) : outputDir;

            // 检查是否设置了"直接拷贝"
            const fontItemSettings = conversionConfig.items[group.fontFile.replace(/\\/g, '/')];
            if (fontItemSettings?.fontCopyOnly) {
                if (!fs.existsSync(fontOutputDir)) {
                    fs.mkdirSync(fontOutputDir, { recursive: true });
                }
                const destPath = path.join(fontOutputDir, path.basename(fontPath));
                fs.copyFileSync(fontPath, destPath);
                results.push({ success: true, outputPath: destPath, message: '字体文件已直接拷贝' });
                continue;
            }

            // 构建转换选项
            const options: FontConvertOptions = {
                fontSize: group.fontSize,
                renderMode: group.renderMode,
                outputFormat: group.fontType,
                characterSets: [
                    // 使用合并后的字符集（文本字符）
                    { type: 'string', value: group.characters },
                    // 添加附加字符集，将文件路径转换为绝对路径
                    ...group.additionalCharSets.map(cs => {
                        if ((cs.type === 'file' || cs.type === 'codepage') && cs.value) {
                            // 如果是相对路径，转换为相对于项目根目录的绝对路径
                            let absolutePath: string;
                            if (path.isAbsolute(cs.value)) {
                                absolutePath = cs.value;
                            } else {
                                // 规范化路径，移除 ../ 等相对路径符号
                                const normalizedPath = path.normalize(cs.value);
                                absolutePath = path.resolve(this.projectRoot, normalizedPath);
                            }
                            return { type: cs.type, value: absolutePath };
                        }
                        return cs;
                    })
                ]
            };

            try {
                const result = await fontConverter.convert(fontPath, fontOutputDir, options);
                results.push(result);
                
                if (result.success) {
                    // 成功时不显示日志，只在最后统计
                } else {
                    // 失败时显示详细信息，方便调试
                    this.logger.log(`转换字体: ${group.fontFile} (${group.fontType}, size=${group.fontSize}, bits=${group.renderMode})`);
                    this.logger.log(`  文本字符: "${group.characters.substring(0, 50)}${group.characters.length > 50 ? '...' : ''}" (${group.characters.length} 字符)`);
                    if (group.additionalCharSets.length > 0) {
                        this.logger.log(`  附加字符集: ${group.additionalCharSets.length} 个`);
                        group.additionalCharSets.forEach((cs, idx) => {
                            // 显示原始路径
                            this.logger.log(`    [${idx + 1}] ${cs.type}: ${cs.value}`);
                        });
                        // 显示转换后的绝对路径（用于调试）
                        options.characterSets.slice(1).forEach((cs, idx) => {
                            if (cs.type === 'file' || cs.type === 'codepage') {
                                this.logger.log(`    [${idx + 1}] file: ${cs.value}`);
                            }
                        });
                    }
                    this.logger.log(`  ✗ 失败: ${result.error}`, true);
                }
            } catch (error: any) {
                // 异常时显示详细信息，方便调试
                this.logger.log(`转换字体: ${group.fontFile} (${group.fontType}, size=${group.fontSize}, bits=${group.renderMode})`);
                this.logger.log(`  文本字符: "${group.characters.substring(0, 50)}${group.characters.length > 50 ? '...' : ''}" (${group.characters.length} 字符)`);
                if (group.additionalCharSets.length > 0) {
                    this.logger.log(`  附加字符集: ${group.additionalCharSets.length} 个`);
                    group.additionalCharSets.forEach((cs, idx) => {
                        // 显示原始路径
                        this.logger.log(`    [${idx + 1}] ${cs.type}: ${cs.value}`);
                    });
                    // 显示转换后的绝对路径（用于调试）
                    options.characterSets.slice(1).forEach((cs, idx) => {
                        if (cs.type === 'file' || cs.type === 'codepage') {
                            this.logger.log(`    [${idx + 1}] file: ${cs.value}`);
                        }
                    });
                }
                results.push({
                    success: false,
                    inputPath: fontPath,
                    outputPath: fontOutputDir,
                    error: error.message
                });
                this.logger.log(`  ✗ 异常: ${error.message}`, true);
            }
        }

        // 处理 alwaysConvert 中的字体（未被 HML 引用但标记为强制转换的）
        const convertedFontFiles = new Set(fontGroups.map(g => g.fontFile));
        for (const fontRelPath of alwaysConvertFonts) {
            if (convertedFontFiles.has(fontRelPath)) {
                continue; // 已经通过 HML 配置处理过了
            }

            const fontPath = path.join(assetsDir, fontRelPath);
            if (!fs.existsSync(fontPath)) {
                this.logger.log(`强制转换字体文件不存在: ${fontRelPath}`, true);
                continue;
            }

            const fontDir = path.dirname(fontRelPath);
            const fontOutputDir = fontDir ? path.join(outputDir, fontDir) : outputDir;

            // 检查是否设置了"直接拷贝"
            const fontItemSettings = conversionConfig.items[fontRelPath.replace(/\\/g, '/')];
            if (fontItemSettings?.fontCopyOnly) {
                if (!fs.existsSync(fontOutputDir)) {
                    fs.mkdirSync(fontOutputDir, { recursive: true });
                }
                const destPath = path.join(fontOutputDir, path.basename(fontPath));
                fs.copyFileSync(fontPath, destPath);
                results.push({ success: true, outputPath: destPath, message: '字体文件已直接拷贝' });
                continue;
            }

            // 使用默认转换选项：bitmap, size=32, ASCII 字符集
            const options: FontConvertOptions = {
                fontSize: 32,
                renderMode: 4,
                outputFormat: 'bitmap',
                characterSets: [{ type: 'range', value: '0x20-0x7E' }]
            };

            try {
                const result = await fontConverter.convert(fontPath, fontOutputDir, options);
                results.push(result);
                if (!result.success) {
                    this.logger.log(`强制转换字体失败: ${fontRelPath} - ${result.error}`, true);
                }
            } catch (error: any) {
                results.push({ success: false, inputPath: fontPath, outputPath: fontOutputDir, error: error.message });
                this.logger.log(`强制转换字体异常: ${fontRelPath} - ${error.message}`, true);
            }
        }

        return results;
    }

    /**
     * 获取项目中所有 Label 组件的字体配置
     */
    private async getLabelFontConfigs(): Promise<Array<{
        fontFile: string;
        fontSize: number;
        fontType: 'bitmap' | 'vector';
        renderMode: number;
        text: string;
        characterSets: Array<{ type: string; value: string }>;
    }>> {
        const configs: Array<any> = [];
        
        try {
            const uiDir = path.join(this.projectRoot, 'ui');
            if (fs.existsSync(uiDir)) {
                await this.scanHmlFilesForLabelConfigs(uiDir, configs);
            }
        } catch (error) {
            this.logger.log(`读取 Label 组件配置时出错: ${error}`, true);
        }
        
        return configs;
    }

    /**
     * 扫描 HML 文件中的 Label 组件配置
     */
    private async scanHmlFilesForLabelConfigs(dir: string, configs: Array<any>): Promise<void> {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                await this.scanHmlFilesForLabelConfigs(fullPath, configs);
            } else if (entry.name.endsWith('.hml')) {
                try {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    this.extractLabelConfigsFromHml(content, configs);
                } catch (error) {
                    this.logger.log(`读取 HML 文件失败: ${fullPath} - ${error}`, true);
                }
            }
        }
    }

    /**
     * 从 HML 内容中提取 Label 组件的字体配置
     */
    private extractLabelConfigsFromHml(hmlContent: string, configs: Array<any>): void {
        // 匹配 hg_label、hg_time_label 和 hg_timer_label 标签
        const labelTagRegex = /<hg_(label|time_label|timer_label)[^>]*>/g;
        let match;
        
        while ((match = labelTagRegex.exec(hmlContent)) !== null) {
            const tagContent = match[0];
            const tagType = match[1]; // 'label'、'time_label' 或 'timer_label'
            
            // 提取 fontFile 属性
            const fontFileMatch = tagContent.match(/fontFile\s*=\s*["']([^"']+)["']/);
            if (!fontFileMatch) {
                continue; // 没有指定字体文件，跳过
            }
            
            const config: any = {
                fontFile: fontFileMatch[1],
                fontSize: 16,
                fontType: 'bitmap',
                renderMode: 4,
                text: '',
                characterSets: []
            };
            
            // 提取 fontSize 属性
            const fontSizeMatch = tagContent.match(/fontSize\s*=\s*["']?(\d+)["']?/);
            if (fontSizeMatch) {
                config.fontSize = parseInt(fontSizeMatch[1]);
            }
            
            // 提取 fontType 属性
            const fontTypeMatch = tagContent.match(/fontType\s*=\s*["']([^"']+)["']/);
            if (fontTypeMatch) {
                config.fontType = fontTypeMatch[1] === 'vector' ? 'vector' : 'bitmap';
            }
            
            // 提取 renderMode 属性
            const renderModeMatch = tagContent.match(/renderMode\s*=\s*["']?(\d+)["']?/);
            if (renderModeMatch) {
                config.renderMode = parseInt(renderModeMatch[1]);
            }
            
            // 提取 text 属性
            const textMatch = tagContent.match(/text\s*=\s*["']([^"']*)["']/);
            if (textMatch) {
                // 反转义 XML 实体（&lt; &gt; &amp; &quot; &#39;）
                config.text = this.unescapeXml(textMatch[1]);
            }
            
            // 时间标签：自动添加时间显示所需的字符（已在创建时添加到 characterSets）
            // 不再在此处自动添加，由前端创建时处理
            
            // 提取 characterSets 属性（JSON 数组）
            const charSetsMatch = tagContent.match(/characterSets\s*=\s*["']([^"']+)["']/);
            if (charSetsMatch) {
                try {
                    const charSets = JSON.parse(charSetsMatch[1].replace(/&quot;/g, '"'));
                    if (Array.isArray(charSets)) {
                        config.characterSets = charSets;
                    }
                } catch (e) {
                    this.logger.log(`解析 characterSets 失败: ${e}`, true);
                }
            }
            
            configs.push(config);
        }
    }

    /**
     * 反转义 XML 实体
     * @param text 包含 XML 实体的文本
     * @returns 反转义后的文本
     */
    private unescapeXml(text: string): string {
        return text
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&'); // &amp; 必须最后处理
    }

    /**
     * 按字体文件和配置分组，合并相同配置的字符集
     * 
     * 位图字体：相同的字体文件 + fontSize + fontType + renderMode 视为同一组
     * 矢量字体：相同的字体文件 + fontType 视为同一组，fontSize 取最大值（高精度可渲染小字）
     */
    private groupLabelConfigsByFont(configs: Array<{
        fontFile: string;
        fontSize: number;
        fontType: 'bitmap' | 'vector';
        renderMode: number;
        text: string;
        characterSets: Array<{ type: string; value: string }>;
    }>): Array<{
        fontFile: string;
        fontSize: number;
        fontType: 'bitmap' | 'vector';
        renderMode: number;
        characters: string;
        additionalCharSets: Array<{ type: 'range' | 'file' | 'codepage' | 'string'; value: string }>;
    }> {
        const groups = new Map<string, {
            fontFile: string;
            fontSize: number;
            fontType: 'bitmap' | 'vector';
            renderMode: number;
            charSet: Set<string>;
            additionalCharSets: Set<string>;
        }>();

        for (const config of configs) {
            // 生成分组键：矢量字体不按 fontSize 和 renderMode 分组
            const key = config.fontType === 'vector'
                ? `${config.fontFile}|vector`
                : `${config.fontFile}|${config.fontSize}|${config.fontType}|${config.renderMode}`;
            
            if (!groups.has(key)) {
                groups.set(key, {
                    fontFile: config.fontFile,
                    fontSize: config.fontSize,
                    fontType: config.fontType,
                    renderMode: config.fontType === 'vector' ? 8 : config.renderMode,
                    charSet: new Set(),
                    additionalCharSets: new Set()
                });
            }
            
            const group = groups.get(key)!;
            
            // 矢量字体：取最大字号（高精度可渲染小字）
            if (config.fontType === 'vector' && config.fontSize > group.fontSize) {
                group.fontSize = config.fontSize;
            }
            
            // 将文本中的每个字符添加到字符集
            for (const char of config.text) {
                group.charSet.add(char);
            }
            
            // 收集附加字符集（去重）
            if (config.characterSets && Array.isArray(config.characterSets)) {
                for (const cs of config.characterSets) {
                    group.additionalCharSets.add(JSON.stringify(cs));
                }
            }
        }

        // 转换为数组，并将字符集转为字符串
        return Array.from(groups.values()).map(group => ({
            fontFile: group.fontFile,
            fontSize: group.fontSize,
            fontType: group.fontType,
            renderMode: group.renderMode,
            characters: Array.from(group.charSet).join(''),
            additionalCharSets: Array.from(group.additionalCharSets).map(s => {
                const parsed = JSON.parse(s);
                return {
                    type: parsed.type as 'range' | 'file' | 'codepage' | 'string',
                    value: parsed.value
                };
            })
        }));
    }

    /**
     * 根据 Glass 组件配置转换玻璃效果资源
     * 
     * 从 HML 文件中提取所有 hg_glass 组件的配置，
     * 使用组件的 distortion 和 region 参数进行转换
     * 相同 src 但不同参数的组件会生成带数字后缀的文件（如 circle1.bin, circle2.bin）
     */
    private async convertGlassWithComponentConfig(
        assetsDir: string,
        outputDir: string
    ): Promise<GlassConvertResult[]> {
        // 获取项目中所有 Glass 组件的配置
        const glassConfigs = await this.getGlassComponentConfigs();
        
        if (glassConfigs.length === 0) {
            this.logger.log('未找到需要转换的玻璃效果配置');
            return [];
        }

        const glassConverter = new GlassConverterService();
        const results: GlassConvertResult[] = [];
        
        // 记录每个 src 文件已生成的数量，用于生成带数字后缀的文件名
        const srcCountMap = new Map<string, number>();

        for (const config of glassConfigs) {
            // 处理 src 路径，移除 assets/ 前缀
            let srcPath = config.src;
            if (srcPath.startsWith('assets/')) {
                srcPath = srcPath.substring(7);
            }
            
            const inputPath = path.join(assetsDir, srcPath);
            
            // 检查源文件是否存在
            if (!fs.existsSync(inputPath)) {
                this.logger.log(`玻璃效果源文件不存在: ${srcPath}`, true);
                results.push({
                    success: false,
                    inputPath,
                    outputPath: outputDir,
                    error: '源文件不存在'
                });
                continue;
            }

            // 确定输出路径（保持原始目录结构，将 .glass 改为 .bin）
            const srcDir = path.dirname(srcPath);
            const srcName = path.basename(srcPath, '.glass');
            const outputSubDir = srcDir ? path.join(outputDir, srcDir) : outputDir;
            
            // 获取当前 src 的计数，生成带数字后缀的文件名
            const currentCount = (srcCountMap.get(srcPath) || 0) + 1;
            srcCountMap.set(srcPath, currentCount);
            
            // 生成输出文件名：第一个不带数字，后续带数字（如 circle.bin, circle2.bin, circle3.bin）
            const outputFileName = currentCount === 1 
                ? `${srcName}.bin` 
                : `${srcName}${currentCount}.bin`;
            const outputPath = path.join(outputSubDir, outputFileName);

            // 确保输出目录存在
            if (!fs.existsSync(outputSubDir)) {
                fs.mkdirSync(outputSubDir, { recursive: true });
            }

            // 转换参数：
            // distortion 存储为百分比 (0-100)，需要转换为实际值: distortion / 500
            // region 存储为百分比 (0-100)，需要转换为实际值: region / 100
            const distortion = (config.distortion ?? 10) / 500;
            const region = (config.region ?? 50) / 100;

            const options: GlassConvertOptions = {
                blurRadius: config.region ?? 50,
                blurIntensity: config.distortion ?? 10,
                distortion,
                region
            };

            this.logger.log(`转换玻璃效果: ${srcPath} -> ${outputFileName} (distortion=${config.distortion}%, region=${config.region}%)`);

            try {
                const result = await glassConverter.convert(inputPath, outputPath, options);
                results.push(result);
                
                if (result.success) {
                    this.logger.log(`  ✓ 成功: ${outputPath}`);
                } else {
                    this.logger.log(`  ✗ 失败: ${result.error}`, true);
                }
            } catch (error: any) {
                results.push({
                    success: false,
                    inputPath,
                    outputPath,
                    error: error.message
                });
                this.logger.log(`  ✗ 异常: ${error.message}`, true);
            }
        }

        return results;
    }

    /**
     * 获取项目中所有 Glass 组件的配置
     */
    private async getGlassComponentConfigs(): Promise<Array<{
        src: string;
        distortion: number;
        region: number;
    }>> {
        const configs: Array<{
            src: string;
            distortion: number;
            region: number;
        }> = [];
        
        try {
            // 扫描 ui 目录
            const uiDir = path.join(this.projectRoot, 'ui');
            if (fs.existsSync(uiDir)) {
                await this.scanHmlFilesForGlassConfigs(uiDir, configs);
            }
            
            // 扫描项目根目录下的 HML 文件
            const rootEntries = fs.readdirSync(this.projectRoot, { withFileTypes: true });
            for (const entry of rootEntries) {
                if (!entry.isDirectory() && entry.name.endsWith('.hml')) {
                    const fullPath = path.join(this.projectRoot, entry.name);
                    try {
                        const content = fs.readFileSync(fullPath, 'utf-8');
                        this.extractGlassConfigsFromHml(content, configs);
                    } catch (err) {
                        this.logger.log(`读取 HML 文件失败: ${fullPath} - ${err}`, true);
                    }
                }
            }
        } catch (error) {
            this.logger.log(`读取 Glass 组件配置时出错: ${error}`, true);
        }
        
        return configs;
    }

    /**
     * 扫描 HML 文件中的 Glass 组件配置
     */
    private async scanHmlFilesForGlassConfigs(dir: string, configs: Array<{
        src: string;
        distortion: number;
        region: number;
    }>): Promise<void> {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                await this.scanHmlFilesForGlassConfigs(fullPath, configs);
            } else if (entry.name.endsWith('.hml')) {
                try {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    this.extractGlassConfigsFromHml(content, configs);
                } catch (error) {
                    this.logger.log(`读取 HML 文件失败: ${fullPath} - ${error}`, true);
                }
            }
        }
    }

    /**
     * 从 HML 内容中提取 Glass 组件的配置
     */
    private extractGlassConfigsFromHml(hmlContent: string, configs: Array<{
        src: string;
        distortion: number;
        region: number;
    }>): void {
        // 匹配 hg_glass 标签
        const glassTagRegex = /<hg_glass[^>]*>/g;
        let match;
        
        while ((match = glassTagRegex.exec(hmlContent)) !== null) {
            const tagContent = match[0];
            
            // 提取 src 属性
            const srcMatch = tagContent.match(/src\s*=\s*["']([^"']+)["']/);
            if (!srcMatch) {
                continue; // 没有指定源文件，跳过
            }
            
            const config: {
                src: string;
                distortion: number;
                region: number;
            } = {
                src: srcMatch[1],
                distortion: 10,  // 默认值
                region: 50       // 默认值
            };
            
            // 提取 distortion 属性
            const distortionMatch = tagContent.match(/distortion\s*=\s*["']?(\d+(?:\.\d+)?)["']?/);
            if (distortionMatch) {
                config.distortion = parseFloat(distortionMatch[1]);
            }
            
            // 提取 region 属性
            const regionMatch = tagContent.match(/region\s*=\s*["']?(\d+(?:\.\d+)?)["']?/);
            if (regionMatch) {
                config.region = parseFloat(regionMatch[1]);
            }
            
            // 直接添加配置，不合并（相同 src 不同参数会生成不同的输出文件）
            configs.push(config);
        }
    }

    protected copyDirectory(src: string, dest: string): void {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            let destPath = path.join(dest, entry.name);
            
            if (entry.isDirectory()) {
                this.copyDirectory(srcPath, destPath);
            } else {
                // 如果是 .hml 文件，改为 .xml 后缀
                if (entry.name.endsWith('.hml')) {
                    const newName = entry.name.replace(/\.hml$/, '.xml');
                    destPath = path.join(dest, newName);
                }
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }
}
