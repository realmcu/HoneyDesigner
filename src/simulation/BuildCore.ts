import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { minimatch } from 'minimatch';
import { ImageConverterService, ImageConvertOptions, ConvertResult, CompressionType, YuvSampleMode, YuvBlurBits } from '../services/ImageConverterService';
import { VideoConverterService, VideoConvertOptions, VideoConvertResult } from '../services/VideoConverterService';
import { Model3DConverterService } from '../services/Model3DConverterService';
import { FontConverterService, FontConvertOptions, CharacterSetItem } from '../services/FontConverterService';
import { GlassConverterService, GlassConvertOptions, GlassConvertResult } from '../services/GlassConverterService';
import { ConversionConfigService, AssetRoot, ASSET_ROOT_ID_ROOT, VideoFormat, ConversionConfig, YuvBlur, VideoScaleConfig, VideoCropConfig, PreprocessOrder } from '../services/ConversionConfigService';
import { SamplingFactor } from '../../tools/image-to-jpeg-converter/src/index';
import { ProjectConfig, DEFAULT_ROMFS_BASE_ADDR } from '../common/ProjectConfig';
import { RomfsConfig } from '../common/RomfsConfig';
import { generateRomfsC, romfsRootName } from './RomfsC';
import { ConversionCache } from './ConversionCache';
import { FontManifestGroup, loadFontManifest, manifestCovers, saveFontManifest } from './FontManifest';
import { buildSConstruct } from './SConstructTemplate';
import { ProjectUtils } from '../utils/ProjectUtils';
import { CharsetSourceResolver } from '../utils/CharsetSourceResolver';
import { CharsetProcessor } from '../../tools/font-converter/src/charset-processor';
import { imageFileHasAlpha } from '../utils/imageAlpha';
import { loadProjectI18nCatalog } from '../project-i18n/files';
import { summarizeI18nAutoCharsetForKeys } from '../project-i18n/autoCharset';

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

export interface ConvertAssetsOptions {
    /** 是否打包 romfs（默认是）。浏览器版直接读取 build/assets，不需要 app_romfs.c */
    packRomfs?: boolean;
    /**
     * 只转换指定的资源根（分组名）。undefined 表示全部。
     * 无分组的项目只有根资源，此参数无意义。
     */
    targets?: string[];
    /**
     * 设置后逐个转换图片，每张之后调用一次（浏览器版在这里报告进度并让出页面线程，
     * 否则整批转换会让页面卡住数十秒）。未设置时整批并行转换。
     */
    onImageConverted?(done: number, total: number): Promise<void>;
    /**
     * 设置后不调用 FFmpeg，视频的转换结果由它提供（浏览器版取 CI 预转换的结果）；
     * 返回 undefined 的视频跳过，不中断其余资源的转换。
     */
    videoSource?(plan: VideoPlan): Promise<Uint8Array | undefined>;
}

/** 一个视频的转换参数（组件配置 > conversion.json > 项目配置 > 默认值 解析后的结果） */
export interface VideoSpec {
    format: VideoConvertOptions['format'];
    quality: number;
    frameRate: number;
    crop?: VideoCropConfig;
    /** conversion.json 中的缩放配置原样保留：百分比模式在转换时按视频尺寸换算 */
    scale?: VideoScaleConfig;
    preprocessOrder?: PreprocessOrder;
}

/**
 * VideoSpec 参与键计算的字段，也决定键规则的版本（见 src/web/sim/prebuiltVideos.ts）。
 * 顺序固定：键里是这些字段的 JSON 序列化。
 */
export const VIDEO_SPEC_FIELDS = ['format', 'quality', 'frameRate', 'crop', 'scale', 'preprocessOrder'] as const;

/**
 * VideoSpec 加了字段却没写进 VIDEO_SPEC_FIELDS 时，这里的类型不是 never，赋值 undefined 会编译报错，
 * 报错信息里带着漏掉的字段名。这样键规则不会悄悄落后于 VideoSpec。
 */
const UNLISTED_VIDEO_SPEC_FIELDS: Exclude<keyof VideoSpec, typeof VIDEO_SPEC_FIELDS[number]> extends never
    ? undefined
    : Exclude<keyof VideoSpec, typeof VIDEO_SPEC_FIELDS[number]> = undefined;
void UNLISTED_VIDEO_SPEC_FIELDS;

/**
 * 缩放配置换算成像素后的结果；undefined 表示不缩放。
 * 百分比模式必须先读视频尺寸才能换算，换算结果参与产物键（见 resolveScale）。
 */
export type ResolvedScale = { width?: number; height?: number } | undefined;

export interface VideoPlan {
    /** 相对 assets/ 的源文件路径（正斜杠） */
    relativePath: string;
    input: string;
    /** 相对 build/assets 的输出路径（正斜杠） */
    outputRelative: string;
    output: string;
    spec: VideoSpec;
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
    private conversionCache: ConversionCache | undefined;

    /**
     * 当前正在转换的资源根。convertAssets 按根顺序执行，转换期间非空。
     *
     * 转换链路上有十多个方法（scanAssets / addAlwaysConvertAssets /
     * extractAssetReferences / convertUsedImages / planUsedVideos ...）要读
     * conversion.json 与 assets 目录。逐个加参数容易漏改，而漏改就是静默读错配置；
     * 这里用一个字段承载，配合 assetRootDir()/assetRootConfig() 统一取值。
     */
    private currentRoot: AssetRoot | undefined;

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

    /** 当前资源根目录（转换期间为分组目录，否则为 <project>/assets） */
    private assetRootDir(): string {
        return this.currentRoot?.dir || path.join(this.projectRoot, 'assets');
    }

    /**
     * 当前资源根的 conversion.json 内容。
     *
     * items 的 key 统一归一成「相对当前资源根」的路径：
     * 面板/磁盘上可能写成 "ota/bg.png"（相对 assets/），而分组转换时查表用的是
     * "bg.png"。不归一的话，用户在分组里设的格式在转换时永远匹配不到。
     */
    private assetRootConfig(): ConversionConfig {
        const root = this.currentRoot;
        const config = ConversionConfigService.getInstance().loadConfigForRoot(this.assetRootDir());
        return root?.isGroup ? this.normalizeConfigForRoot(config, root.id) : config;
    }

    /**
     * 把 conversion.json 里带分组前缀的 items key 归一成「组内相对路径」，
     * 让转换侧用 bg.png 能查到 ota/bg.png 那条设置。根资源原样返回。
     */
    private normalizeConfigForRoot(config: ConversionConfig, rootId: string): ConversionConfig {
        if (!rootId || rootId === ASSET_ROOT_ID_ROOT) {
            return config;
        }
        const prefix = `${rootId}/`;
        const normalizedItems: typeof config.items = {};
        for (const [key, value] of Object.entries(config.items || {})) {
            const normalizedKey = key.replace(/\\/g, '/').replace(/^\/+/, '');
            normalizedItems[normalizedKey.startsWith(prefix)
                ? normalizedKey.substring(prefix.length)
                : normalizedKey] = value;
        }
        return { ...config, items: normalizedItems };
    }

    /**
     * 判断该资源路径是否属于当前正在转换的资源根。
     *
     * 有分组时，HML 里可能同时引用多个分组的资源（如同时用到 ota/x.png 与
     * theme/y.png）。转换其中一组时，另一组的资源不在这个目录下，必须跳过，
     * 否则会报"文件不存在"。
     *
     * 无分组时永远返回 true（根资源包含全部）。
     */
    private belongsToCurrentRoot(assetPath: string): boolean {
        const root = this.currentRoot;
        if (!root?.isGroup) {
            return true;
        }
        const normalized = assetPath.replace(/\\/g, '/').replace(/^\/+/, '');

        // 带别的组名前缀 → 明确属于那个分组，交给它自己那一轮
        const allGroups = this.listAssetRoots().map(r => r.id);
        for (const other of allGroups) {
            if (other !== root.id && normalized.startsWith(`${other}/`)) {
                return false;
            }
        }

        // 否则以「文件是否真的在当前根目录下」为准：
        // 带本组前缀（ota/x.png）剥掉后存在；不带前缀（x.png，分组自己
        // conversion.json 里的写法）也存在。两种写法都能正确归类。
        const relative = this.stripGroupPrefix(normalized);
        return fs.existsSync(path.join(root.dir, relative));
    }

    /**
     * HML / alwaysConvert 里的资源路径是相对 assets/ 的（可能带 "ota/" 前缀），
     * 而分组转换时工作目录已经是 assets/ota。这里把分组前缀剥掉，
     * 让两者能对上。
     */
    private stripGroupPrefix(assetPath: string): string {
        const root = this.currentRoot;
        if (!root?.isGroup) {
            return assetPath;
        }
        const normalized = assetPath.replace(/\\/g, '/').replace(/^\/+/, '');
        const prefix = `${root.id}/`;
        return normalized.startsWith(prefix) ? normalized.substring(prefix.length) : normalized;
    }

    /** 项目声明资源分组后，根 assets 不再参与转换 */
    public hasResourceGroups(): boolean {
        return ConversionConfigService.getInstance().hasResourceGroups(this.projectRoot);
    }

    /** 参与转换的资源根，分组名即资源根 id */
    public listAssetRoots(): AssetRoot[] {
        return ConversionConfigService.getInstance().listAssetRoots(this.projectRoot);
    }

    /** 浏览器版在多次仿真之间复用图片与字体的转换结果；桌面版不设置 */
    setConversionCache(cache: ConversionCache | undefined): void {
        this.conversionCache = cache;
    }

    async setupBuildDir(): Promise<void> {
        this.logger.log(vscode.l10n.t('Preparing build directory...'));

        // 浏览器版不用 SCons / win32_sim 脚手架：只需要一个存放资源和 app_romfs.c 的目录
        if (BuildCore.isBrowser()) {
            fs.mkdirSync(this.buildDir, { recursive: true });
            this.logger.log(vscode.l10n.t('Build directory ready'));
            return;
        }

        const parentDir = path.dirname(this.buildDir);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }

        // 使用内置的 win32_sim
        const win32SimSource = path.join(this.libSimPath, 'win32_sim');
        if (!fs.existsSync(win32SimSource)) {
            throw new Error(vscode.l10n.t('Built-in win32_sim directory does not exist: {0}', win32SimSource));
        }

        const portDir = path.join(this.buildDir, 'port');
        if (!fs.existsSync(this.buildDir) || !fs.existsSync(portDir)) {
            if (fs.existsSync(this.buildDir)) {
                this.logger.log(vscode.l10n.t('Build directory incomplete, cleaning for fresh setup...'));
                fs.rmSync(this.buildDir, { recursive: true, force: true });
            }
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

# Build main.c and app_romfs.c
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
        this.logger.log(vscode.l10n.t('Checking generated code...'));

        const srcDir = path.join(this.projectRoot, 'src');
        if (!fs.existsSync(srcDir)) {
            throw new Error(vscode.l10n.t('Generated code directory does not exist: {0}', srcDir));
        }

        const sconscript = path.join(srcDir, 'SConscript');
        if (!fs.existsSync(sconscript)) {
            throw new Error(vscode.l10n.t('SConscript file does not exist: {0}. Generate code first.', sconscript));
        }

        this.logger.log(vscode.l10n.t('Code check completed'));
    }

    async convertAssets(options: ConvertAssetsOptions = {}): Promise<void> {
        const roots = this.listAssetRoots();
        const selected = options.targets && options.targets.length > 0
            ? roots.filter(r => options.targets!.includes(r.id))
            : roots;

        if (selected.length === 0) {
            this.logger.log(vscode.l10n.t('No matching resource group to convert, skipped'), true);
            return;
        }

        // 有分组时根 assets 被排除，提示用户把资源放进分组目录
        if (this.hasResourceGroups()) {
            this.logger.log(vscode.l10n.t('Resource groups are defined: only group directories are converted. Files directly under assets/ are ignored.'));
            this.warnIfRootAssetsIgnored();
        }

        // 产物统一落到 build/assets：分组产物保留 <group>/ 层级，
        // 这样模拟器 POSIX 挂载与合并版 app_romfs.c 都天然可用（C4）。
        const outputDir = path.join(this.buildDir, 'assets');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        for (const root of selected) {
            this.currentRoot = root;
            try {
                const rootOutputDir = root.isGroup ? path.join(outputDir, root.id) : outputDir;
                if (!fs.existsSync(rootOutputDir)) {
                    fs.mkdirSync(rootOutputDir, { recursive: true });
                }
                const label = root.isGroup ? `group "${root.id}"` : 'assets';
                this.logger.log(vscode.l10n.t('Converting resource root: {0}', label));
                await this.convertAssetsForRoot(root.dir, rootOutputDir, options);
            } finally {
                this.currentRoot = undefined;
            }
        }

        // 清理非运行时文件（规则见 ROMFS_CLEANUP_PATTERNS）
        this.cleanupNonRuntimeFiles(outputDir);

        if (options.packRomfs !== false) {
            await this.packRomfs(selected);
        }
    }

    /**
     * 有分组时，提醒用户 assets/ 根目录下的资源不会被转换。
     * 只警告不报错：用户可能故意留着旧资源。
     */
    private warnIfRootAssetsIgnored(): void {
        const assetsDir = path.join(this.projectRoot, 'assets');
        if (!fs.existsSync(assetsDir)) { return; }

        const convertibleExts = new Set([
            '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg',
            '.mp4', '.avi', '.mov', '.mkv', '.webm',
            '.gltf', '.glb', '.obj', '.ttf', '.otf', '.woff', '.woff2',
        ]);
        const groupNames = new Set(this.listAssetRoots().map(r => r.id));

        let count = 0;
        const walk = (dir: string, depth: number) => {
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch { return; }
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    // 不进分组目录，也不进 user/（user 目录本身随根打包）
                    if (depth === 0 && groupNames.has(entry.name)) { continue; }
                    if (entry.name === 'user') { continue; }
                    walk(full, depth + 1);
                } else if (convertibleExts.has(path.extname(entry.name).toLowerCase())) {
                    count++;
                }
            }
        };
        walk(assetsDir, 0);

        if (count > 0) {
            this.logger.log(
                vscode.l10n.t('{0} file(s) under assets/ are ignored because resource groups are defined. Move them into a group directory to convert them.', count),
                false,
                true
            );
        }
    }

    /**
     * 转换单个资源根。assetsDir/outputDir 由调用方按根传入，
     * 其余逻辑与原实现在根资源上完全一致（C3）。
     */
    private async convertAssetsForRoot(
        assetsDir: string,
        outputDir: string,
        options: ConvertAssetsOptions
    ): Promise<void> {

        const usedAssets = await this.scanAssets();
        this.logger.log(vscode.l10n.t('Found {0} images, {1} videos, {2} 3D models', usedAssets.images.size, usedAssets.videos.size, usedAssets.models.size));

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
            this.logger.log(vscode.l10n.t('Using compression algorithm: {0}', imageOptions.compression));
        }
        
        const imageResults = await this.convertUsedImages(assetsDir, outputDir, usedAssets.images, imageOptions, options.onImageConverted);

        const imageFailed = imageResults.filter(r => !r.success);
        if (imageFailed.length > 0) {
            for (const f of imageFailed) {
                this.logger.log(vscode.l10n.t('Image conversion failed: {0} - {1}', f.inputPath, String(f.error)), true);
            }
            throw new Error(vscode.l10n.t('{0} image(s) failed to convert', imageFailed.length));
        }

        this.logger.log(vscode.l10n.t('Images converted: {0}', imageResults.length));

        // 拷贝 SVG 资源（不需要转换）
        this.logger.log(vscode.l10n.t('Copying SVG assets...'));
        const svgCount = this.copySvgAssets(assetsDir, outputDir);
        this.logger.log(vscode.l10n.t('SVG assets copied: {0}', svgCount));

        // 拷贝 TRMAP 资源（不需要转换）
        this.logger.log(vscode.l10n.t('Copying TRMAP assets...'));
        const trmapCount = this.copyTrmapAssets(assetsDir, outputDir);
        this.logger.log(vscode.l10n.t('TRMAP assets copied: {0}', trmapCount));

        // 拷贝 user 目录（不转换，原样复制）
        const userCount = this.copyUserAssets(assetsDir, outputDir);
        if (userCount > 0) {
            this.logger.log(vscode.l10n.t('user directory copied: {0}', userCount));
        }

        // 转换视频资源（只转换使用的）
        this.logger.log(vscode.l10n.t('Checking video assets...'));
        const videoConverter = new VideoConverterService((msg) => {
            this.logger.log(msg);
        });
        
        const videoPlans = await this.planUsedVideos(assetsDir, outputDir, usedAssets.videos);

        // 浏览器版没有 FFmpeg，转换结果由调用方提供（CI 预转换）
        if (options.videoSource) {
            await this.supplyVideos(options.videoSource, videoPlans);
        } else if (BuildCore.isBrowser() || !await videoConverter.checkFFmpegAvailable()) {
            this.logger.log(BuildCore.isBrowser()
                ? vscode.l10n.t('Video conversion is not supported in the browser build; skipped (convert videos in the VS Code extension).')
                : vscode.l10n.t('FFmpeg not found, skipping video conversion. Install FFmpeg and add it to PATH.'), true);
            this.logger.log(vscode.l10n.t('Videos skipped: {0}', videoPlans.length));
        } else {
            // 并行执行所有转换任务
            const videoResults = await Promise.all(videoPlans.map(plan => this.convertVideo(videoConverter, plan)));

            const videoFailed = videoResults.filter(r => !r.success);
            if (videoFailed.length > 0) {
                for (const f of videoFailed) {
                    this.logger.log(vscode.l10n.t('Video conversion failed: {0} - {1}', f.inputPath, String(f.error)), true);
                }
                throw new Error(vscode.l10n.t('{0} video(s) failed to convert', videoFailed.length));
            }

            // 记录警告信息
            const videoWarnings = videoResults.filter(r => r.success && r.warning);
            if (videoWarnings.length > 0) {
                for (const w of videoWarnings) {
                    this.logger.log(vscode.l10n.t('Video conversion warning: {0} - {1}', w.inputPath, String(w.warning)), false);
                }
            }

            this.logger.log(vscode.l10n.t('Videos converted: {0}', videoResults.length));
        }



        // 转换 3D 模型资源（只转换使用的）
        this.logger.log(vscode.l10n.t('Converting 3D model assets...'));
        const model3DResults = await this.convertUsedModels(assetsDir, outputDir, usedAssets.models);

        const model3DFailed = model3DResults.filter(r => !r.success);
        if (model3DFailed.length > 0) {
            for (const f of model3DFailed) {
                this.logger.log(vscode.l10n.t('3D model conversion failed: {0} - {1}', f.inputPath, f.error), true);
            }
            throw new Error(vscode.l10n.t('{0} 3D model(s) failed to convert', model3DFailed.length));
        }

        this.logger.log(vscode.l10n.t('3D models converted: {0}', model3DResults.length));

        // 转换字体资源
        this.logger.log(vscode.l10n.t('Converting font assets...'));
        const fontResults = await this.convertFontsWithLabelConfig(assetsDir, outputDir, usedAssets.fonts);
        const fontFailed = fontResults.filter(r => !r.success);
        if (fontFailed.length > 0) {
            for (const f of fontFailed) {
                this.logger.log(vscode.l10n.t('Font conversion failed: {0} - {1}', f.inputPath, f.error), true);
            }
            // 字体转换失败不阻止编译，只是警告
            this.logger.log(vscode.l10n.t('Warning: {0} font(s) failed to convert', fontFailed.length), true);
        }
        this.logger.log(vscode.l10n.t('Fonts converted: {0}', fontResults.filter(r => r.success).length));

        // 转换玻璃效果资源
        this.logger.log(vscode.l10n.t('Converting glass effect assets...'));
        const glassResults = await this.convertGlassWithComponentConfig(assetsDir, outputDir);
        const glassFailed = glassResults.filter(r => !r.success);
        if (glassFailed.length > 0) {
            for (const f of glassFailed) {
                this.logger.log(vscode.l10n.t('Glass effect conversion failed: {0} - {1}', f.inputPath, String(f.error)), true);
            }
        }
        this.logger.log(vscode.l10n.t('Glass effects converted: {0}', glassResults.filter(r => r.success).length));

        // ui/ 与 project.json 只属于合并视图的根部：分组子目录里再放一份
        // 会被打进分组 bin，运行时多出无意义的 /ota/ui、/ota/project.json。
        if (!this.currentRoot?.isGroup) {
            const uiSrcDir = path.join(this.projectRoot, 'ui');
            const uiDestDir = path.join(outputDir, 'ui');
            if (fs.existsSync(uiSrcDir)) {
                this.copyDirectory(uiSrcDir, uiDestDir);
                this.logger.log(vscode.l10n.t('UI directory copied to assets'));
            }

            const projectJsonSrc = path.join(this.projectRoot, 'project.json');
            const projectJsonDest = path.join(outputDir, 'project.json');
            if (fs.existsSync(projectJsonSrc)) {
                fs.copyFileSync(projectJsonSrc, projectJsonDest);
                this.logger.log(vscode.l10n.t('project.json copied to assets'));
            }
        }
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
            this.logger.log(vscode.l10n.t('Removed {0} non-runtime file(s)', count));
        }
    }

    /**
     * 找出还没有按当前 HML 需求准备好的字体产物。
     *
     * 判据是「该字体组已转换的码点是否覆盖当前需求」，而不是 HML 的修改时间：
     * 改控件坐标、增删无关控件都不再触发字体重转。字体文件与字符集文件变化由
     * 清单指纹负责（见 FontManifest）。
     */
    public async findStaleFontAsset(): Promise<string | undefined> {
        const configs = await this.getLabelFontConfigs();
        if (configs.length === 0) {
            return undefined;
        }

        const projectI18nCatalog = loadProjectI18nCatalog(this.projectRoot);
        const manifest = loadFontManifest(this.buildDir);
        const combinedOutputDir = path.join(this.buildDir, 'assets');
        const roots = this.listAssetRoots();
        const groupIds = roots.filter(r => r.isGroup).map(r => r.id);
        const fontGroups = this.groupLabelConfigsByFont(configs);

        // 与 convertAssets 一样按资源根逐组检查：字体属于哪个分组，就只在那个
        // 分组的目录里判断新鲜度。用根 assets 去拼分组字体会得到不存在的路径，
        // 每轮都判为"已过期"，用户就永远卡在「字体资源准备失败」。
        for (const root of roots) {
            const assetsDir = root.dir;
            const outputDir = root.isGroup ? path.join(combinedOutputDir, root.id) : combinedOutputDir;

            // 该根产物的 romfs 修改时间：分组看分组 bin，根看合并版
            const romfsPath = root.isGroup
                ? path.join(this.buildDir, 'groups', root.id, `app_${root.id}_romfs_${root.baseAddr || this.projectConfig.romfsBaseAddr || DEFAULT_ROMFS_BASE_ADDR}.bin`)
                : path.join(this.buildDir, RomfsConfig.getFileName());
            const romfsTime = fs.existsSync(romfsPath) ? fs.statSync(romfsPath).mtimeMs : 0;

            const conversionConfig = this.normalizeConfigForRoot(
                ConversionConfigService.getInstance().loadConfigForRoot(assetsDir),
                root.id
            );

            // 只保留落在本根目录里的字体：其它分组的字体由那一轮负责，
            // 根 assets 的字体在无分组时才存在。
            const candidates = fontGroups
                .map(group => ({ group, fontRelativePath: this.fontPathInRoot(group.fontFile, root.id, groupIds, root.dir) }))
                .filter((c): c is { group: typeof c.group; fontRelativePath: string } => c.fontRelativePath !== undefined);

            for (const { group, fontRelativePath } of candidates) {
                const sourcePath = path.join(assetsDir, fontRelativePath);

                // 查表用「相对本资源根」的路径：分组配置的 key 可能带分组前缀
                // （ota/x.ttf），归一后才能命中。无分组时与原实现完全一致。
                if (conversionConfig.items[fontRelativePath]?.fontCopyOnly) {
                    const fontDir = path.dirname(fontRelativePath);
                    const fontOutputDir = fontDir === '.' ? outputDir : path.join(outputDir, fontDir);
                    const copiedPath = path.join(fontOutputDir, path.basename(sourcePath));
                    const sourceTime = fs.existsSync(sourcePath) ? fs.statSync(sourcePath).mtimeMs : 0;
                    const copiedTime = fs.existsSync(copiedPath) ? fs.statSync(copiedPath).mtimeMs : 0;
                    if (!sourceTime || !copiedTime || copiedTime < sourceTime) {
                        return copiedPath;
                    }
                    continue;
                }

                // 与转换链路同一套路径：group 传「相对本资源根」的形式
                const outputPath = this.fontGroupOutputPath(
                    { ...group, fontFile: fontRelativePath },
                    outputDir
                );
                const outputTime = fs.existsSync(outputPath) ? fs.statSync(outputPath).mtimeMs : 0;
                if (!outputTime || romfsTime < outputTime) {
                    return outputPath;
                }

                const key = this.fontGroupManifestKey(group);
                let fresh: boolean;
                try {
                    // 指纹与产物路径都按「相对本资源根」的路径计算：
                    // fontFile 在根里是 "ota/x.ttf"，在分组里要变成 "x.ttf"
                    fresh = manifestCovers(
                        manifest,
                        key,
                        this.fontGroupFingerprint(
                            { ...group, fontFile: fontRelativePath } as never,
                            assetsDir
                        ),
                        this.fontGroupCharacters(group, projectI18nCatalog),
                        group.fontType === 'vector' ? group.fontSize : 0,
                    );
                } catch {
                    // 字符集本身无法解析时交给转换流程报错，这里不判定为新鲜
                    return outputPath;
                }
                if (!fresh) {
                    return outputPath;
                }
            }
        }
        return undefined;
    }

    /**
     * 把 fontsFile 换算成「相对该资源根」的路径；不属于该根时返回 undefined。
     *
     * fontFile 有两种写法：
     * - 带分组前缀（HML 里写 /ota/x.ttf，相对 assets/）→ 只有 ota 根接收，返回 x.ttf
     * - 不带前缀（分组自己 conversion.json 里写 x.ttf）→ 谁目录里真有这个文件就归谁
     */
    private fontPathInRoot(
        fontFile: string,
        rootId: string,
        groupIds: string[],
        rootDir: string,
    ): string | undefined {
        const normalized = fontFile.replace(/\\/g, '/').replace(/^\/+/, '');

        // 带别的分组前缀：明确不属于本根
        const otherPrefix = groupIds.find(id => id !== rootId && normalized.startsWith(`${id}/`));
        if (otherPrefix) {
            return undefined;
        }

        // 带本根前缀：剥掉
        if (rootId !== ASSET_ROOT_ID_ROOT && normalized.startsWith(`${rootId}/`)) {
            return normalized.substring(rootId.length + 1);
        }

        // 不带前缀：以文件真实位置为准。根资源接收全部，
        // 分组只在文件确实位于自己目录下时才接收。
        if (rootId === ASSET_ROOT_ID_ROOT) {
            return normalized;
        }
        return fs.existsSync(path.join(rootDir, normalized)) ? normalized : undefined;
    }

    /**
     * 字符集来源实际展开出的码点。
     * 空值来源在这里丢弃（与 FontConverterService.convert 一致），否则 file / codepage 空串
     * 会抛异常；这里只用于判新鲜，真正的错误留给转换流程报告。
     */
    private requestedCharacters(characterSets: Array<{ type: string; value: string }>): number[] {
        const usable = characterSets.filter(cs => typeof cs.value === 'string' && cs.value.trim().length > 0);
        return CharsetProcessor.mergeCharacterSources(usable as any, path.join(this.projectRoot, 'assets'));
    }

    /** 码点序列化为字符串存入清单（GBK 等上万码点，不能用展开运算符传参） */
    private codepointsToString(chars: number[]): string {
        const parts: string[] = [];
        for (const cp of chars) {
            parts.push(String.fromCodePoint(cp));
        }
        return parts.join('');
    }

    /** 字体组的分组键，与 groupLabelConfigsByFont 保持一致 */
    private fontGroupManifestKey(group: { fontFile: string; fontSize: number; fontType: 'bitmap' | 'vector'; renderMode: number }): string {
        return group.fontType === 'vector'
            ? `${group.fontFile}|vector`
            : `${group.fontFile}|${group.fontSize}|bitmap|${group.renderMode}`;
    }

    /**
     * 字体组的产物路径，与 convertFontsWithLabelConfig 的命名规则一致。
     *
     * 传入的 group.fontFile 必须已是「相对当前资源根」的路径（见 groupInRoot）。
     * 这里刻意不调用 stripGroupPrefix：它依赖 currentRoot，而本函数在
     * findStaleFontAsset 里被调用时 currentRoot 是空的，两边会算出不同路径。
     */
    private fontGroupOutputPath(
        group: { fontFile: string; fontSize: number; fontType: 'bitmap' | 'vector'; renderMode: number },
        outputDir: string,
    ): string {
        const fontRelativePath = group.fontFile.replace(/\\/g, '/').replace(/^\/+/, '');
        const fontDir = path.dirname(fontRelativePath);
        const fontOutputDir = fontDir === '.' ? outputDir : path.join(outputDir, fontDir);
        const fontName = path.basename(fontRelativePath, path.extname(fontRelativePath)).replace(/-/g, '_');
        const outputName = group.fontType === 'vector'
            ? `${fontName}_vector.bin`
            : `${fontName}_size${group.fontSize}_bits${group.renderMode}_bitmap.bin`;
        return path.join(fontOutputDir, outputName);
    }

    /** 字体组当前需要覆盖的全部码点（文本 + i18n 文案 + 附加字符集），与转换时一致 */
    private fontGroupCharacters(
        group: {
            characters: string;
            i18nKeys: string[];
            additionalCharSets: Array<{ type: 'range' | 'file' | 'codepage' | 'string'; value: string }>;
        },
        catalog: ReturnType<typeof loadProjectI18nCatalog>,
    ): number[] {
        const merged = this.buildFontCharacterSets(group, catalog);
        return CharsetProcessor.mergeCharacterSources(merged as any, path.join(this.projectRoot, 'assets'));
    }

    /**
     * 字体组的输入指纹：字体文件与字符集文件的内容指纹 + 影响产物内容的转换参数。
     * 任一变化都必须重转，避免用到过期的字形数据。
     *
     * 矢量字体的字号只决定曲线精度，由清单的 precision 按最大值比较，不放进指纹；
     * 放进来的话，改小字号会连带把精度更高的产物判为过期。
     */
    private fontGroupFingerprint(
        group: {
            fontFile: string;
            fontSize: number;
            fontType: 'bitmap' | 'vector';
            renderMode: number;
            additionalCharSets: Array<{ type: 'range' | 'file' | 'codepage' | 'string'; value: string }>;
        },
        assetsDir: string,
    ): string {
        const fontRelativePath = group.fontFile.replace(/\\/g, '/').replace(/^\/+/, '');
        const parts = [
            ConversionCache.fileKey(path.join(assetsDir, fontRelativePath)) ?? 'missing',
            group.fontType,
            ...(group.fontType === 'vector' ? [] : [String(group.fontSize), String(group.renderMode)]),
        ];
        for (const cs of group.additionalCharSets) {
            const resolved = CharsetSourceResolver.resolve(cs as any);
            if (cs.type === 'file' || cs.type === 'codepage') {
                const absolutePath = path.isAbsolute(resolved.value)
                    ? resolved.value
                    : path.resolve(this.projectRoot, path.normalize(resolved.value));
                parts.push(`${cs.type}:${ConversionCache.fileKey(absolutePath) ?? 'missing'}`);
            } else {
                parts.push(`${cs.type}:${cs.value}`);
            }
        }
        return parts.join('|');
    }

    /** 把字体组的需求展开为 CharsetProcessor 可消费的字符集来源（与转换时使用的完全一致） */
    private buildFontCharacterSets(
        group: {
            characters: string;
            i18nKeys: string[];
            additionalCharSets: Array<{ type: 'range' | 'file' | 'codepage' | 'string'; value: string }>;
        },
        catalog: ReturnType<typeof loadProjectI18nCatalog>,
    ): CharacterSetItem[] {
        const autoCharset = summarizeI18nAutoCharsetForKeys(catalog, group.i18nKeys);
        return [
            { type: 'string', value: group.characters },
            ...(autoCharset.source ? [autoCharset.source] : []),
            ...group.additionalCharSets.map((cs): CharacterSetItem => {
                const resolved = CharsetSourceResolver.resolve(cs);
                if ((cs.type === 'file' || cs.type === 'codepage') && resolved.value) {
                    const absolutePath = path.isAbsolute(resolved.value)
                        ? resolved.value
                        : path.resolve(this.projectRoot, path.normalize(resolved.value));
                    return { type: cs.type, value: absolutePath };
                }
                return { type: cs.type, value: cs.value };
            }),
        ];
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

    /** 浏览器构建（src/web）里 process.platform 被替换为 'browser'，没有 Python / SCons / ffmpeg */
    protected static isBrowser(): boolean {
        return process.platform === ('browser' as NodeJS.Platform);
    }

    /** 读取目录下全部文件，生成 romfs 的 C 源码（与 tools/mkromfs_for_honeygui.py 一致） */
    private generateRomfsCSource(assetsDir: string, outputFileName: string): string {
        const files = new Map<string, Uint8Array>();
        const walk = (dir: string, rel: string): void => {
            for (const name of fs.readdirSync(dir)) {
                const full = path.join(dir, name);
                const relPath = rel ? `${rel}/${name}` : name;
                if (fs.statSync(full).isDirectory()) {
                    walk(full, relPath);
                } else {
                    files.set(relPath, new Uint8Array(fs.readFileSync(full)));
                }
            }
        };
        walk(assetsDir, '');
        return generateRomfsC(files, romfsRootName(outputFileName));
    }

    /**
     * 打包 romfs。
     *
     * 两种产物：
     * - 合并版 app_romfs.c / .bin：build/assets 整棵（含各分组目录层级），
     *   模拟器与合并固件用，挂载在 "/"。
     * - 分组独立版 groups/<name>/app_<name>_romfs.bin：只含该分组内容，
     *   且**剥掉分组目录层级**（已确认不带前缀），挂载在 "/<name>"。
     *
     * 两者对同一资源的运行时路径一致，例如 assets/ota/bg.png 都是 /ota/bg.bin。
     */
    private async packRomfs(roots?: AssetRoot[]): Promise<void> {
        this.logger.log(vscode.l10n.t('Packing romfs...'));

        const assetsDir = path.join(this.buildDir, 'assets');
        const romfsOutput = path.join(this.buildDir, RomfsConfig.getFileName());

        // 获取 romfs 基地址
        const baseAddr = this.projectConfig.romfsBaseAddr || DEFAULT_ROMFS_BASE_ADDR;

        // 二进制文件名带上基地址后缀，例如 app_romfs_0x70536400.bin
        const romfsBinOutput = path.join(this.buildDir, RomfsConfig.getBinFileName(baseAddr));

        // 浏览器版没有 Python，用 TypeScript 移植（与脚本输出逐字节一致）直接生成 C 文件，
        // 也不生成仅用于 UART 下载的二进制文件。
        if (BuildCore.isBrowser()) {
            try {
                fs.writeFileSync(romfsOutput, this.generateRomfsCSource(assetsDir, RomfsConfig.getFileName()));
                this.logger.log(vscode.l10n.t('romfs C file generated'));
            } catch (error) {
                throw new Error(vscode.l10n.t('Failed to generate romfs C file: {0}', String(error)));
            }
            return;
        }

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
            this.logger.log(vscode.l10n.t('romfs C file generated'));
        } catch (error) {
            throw new Error(vscode.l10n.t('Failed to generate romfs C file: {0}', String(error)));
        }

        // 生成二进制文件（用于 UART 下载）
        try {
            execSync(`${pythonCmd} "${mkromfsScript}" -i "${assetsDir}" -o "${romfsBinOutput}" -a ${baseAddr} -b`, {
                stdio: 'pipe',  // 改为 pipe 避免继承父进程的 stdio
                windowsHide: true  // Windows 上隐藏命令行窗口
            });
            this.logger.log(vscode.l10n.t('romfs binary file generated (base address: {0})', baseAddr));
        } catch (error) {
            throw new Error(vscode.l10n.t('Failed to generate romfs binary file: {0}', String(error)));
        }

        // 分组独立 bin（真机 OTA 用）。浏览器版没有 Python，跳过。
        const groups = (roots || []).filter(r => r.isGroup);
        for (const group of groups) {
            await this.packGroupRomfs(group, pythonCmd, mkromfsScript);
        }

        if (groups.length > 0) {
            this.checkFlashOverlap(groups);
        }
    }

    /**
     * 检查各 romfs 的 flash 地址区间是否重叠。
     *
     * 只提示不阻断：地址是否可用还取决于实际分区表，插件不掌握该信息，
     * 因此只把计算结果和重叠风险报给用户，由用户判断。
     *
     * 注意：合并版 app_romfs 与各分组 bin 是**包含**关系，不是并列关系——
     * 合并版本来就含全部分组内容，只是为模拟器/合并固件额外打的一份。
     * 所以「合并版区间盖住了分组地址」是正常布局，不算冲突。
     * 真正要避免的只有**分组之间**互相重叠。
     */
    private checkFlashOverlap(groups: AssetRoot[]): void {
        type Region = { name: string; start: number; end: number; size: number };
        const regions: Region[] = [];

        const addRegion = (name: string, addr: string | undefined, binPath: string) => {
            if (!addr) { return; }
            const start = Number(addr);
            if (!Number.isFinite(start) || start <= 0) {
                this.logger.log(vscode.l10n.t('Invalid flash base address for {0}: {1}', name, String(addr)), false, true);
                return;
            }
            if (!fs.existsSync(binPath)) { return; }
            const size = fs.statSync(binPath).size;
            regions.push({ name, start, end: start + size - 1, size });
        };

        const rootAddr = this.projectConfig.romfsBaseAddr || DEFAULT_ROMFS_BASE_ADDR;
        // 合并版只单独报告，不参与重叠判定（见上面的包含关系说明）
        const mergedBin = path.join(this.buildDir, RomfsConfig.getBinFileName(rootAddr));
        if (fs.existsSync(mergedBin)) {
            const mergedSize = fs.statSync(mergedBin).size;
            this.logger.log(vscode.l10n.t(
                'Flash layout: {0} @ 0x{1} - 0x{2} ({3} bytes)',
                'app_romfs (merged)',
                Number(rootAddr).toString(16).toUpperCase(),
                (Number(rootAddr) + mergedSize - 1).toString(16).toUpperCase(),
                mergedSize
            ));
        }

        for (const group of groups) {
            const addr = group.baseAddr || rootAddr;
            addRegion(
                group.id,
                addr,
                path.join(this.buildDir, 'groups', group.id, `app_${group.id}_romfs_${addr}.bin`)
            );
        }

        // 按起始地址排序后检查相邻区间是否交叠
        regions.sort((a, b) => a.start - b.start);
        const overlaps: string[] = [];
        for (let i = 0; i < regions.length; i++) {
            const cur = regions[i];
            this.logger.log(vscode.l10n.t(
                'Flash layout: {0} @ 0x{1} - 0x{2} ({3} bytes)',
                cur.name,
                cur.start.toString(16).toUpperCase(),
                cur.end.toString(16).toUpperCase(),
                cur.size
            ));
            for (let j = i + 1; j < regions.length; j++) {
                const next = regions[j];
                if (next.start <= cur.end) {
                    overlaps.push(`${cur.name} / ${next.name}`);
                }
            }
        }

        if (overlaps.length > 0) {
            this.logger.log(vscode.l10n.t(
                'Flash address overlap detected: {0}. Adjust romfsBaseAddr or the group base addresses before flashing.',
                overlaps.join(', ')
            ), false, true);
        }
    }

    /**
     * 打一个分组的独立 romfs。
     *
     * 输入是 build/assets/<name>（已转换产物），但打包时内容位于 romfs 根，
     * 不带 <name> 层级——运行时由 mount_romfs("/<name>", baseAddr, 0) 拼回完整路径。
     */
    private async packGroupRomfs(
        group: AssetRoot,
        pythonCmd: string,
        mkromfsScript: string
    ): Promise<void> {
        const sourceDir = path.join(this.buildDir, 'assets', group.id);
        if (!fs.existsSync(sourceDir)) {
            this.logger.log(vscode.l10n.t('Group "{0}" has no converted assets, skipped', group.id), false, true);
            return;
        }

        const baseAddr = group.baseAddr || this.projectConfig.romfsBaseAddr || DEFAULT_ROMFS_BASE_ADDR;
        const outDir = path.join(this.buildDir, 'groups', group.id);
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }

        const cOutput = path.join(outDir, `app_${group.id}_romfs.c`);
        const binOutput = path.join(outDir, `app_${group.id}_romfs_${baseAddr}.bin`);
        const { execSync } = require('child_process');

        try {
            execSync(`${pythonCmd} "${mkromfsScript}" -i "${sourceDir}" -o "${cOutput}" -a ${baseAddr}`, {
                stdio: 'pipe',
                windowsHide: true
            });
            execSync(`${pythonCmd} "${mkromfsScript}" -i "${sourceDir}" -o "${binOutput}" -a ${baseAddr} -b`, {
                stdio: 'pipe',
                windowsHide: true
            });
            const size = fs.statSync(binOutput).size;
            this.logger.log(vscode.l10n.t(
                'Group "{0}" romfs generated: {1} ({2} bytes, base address: {3})',
                group.id,
                path.basename(binOutput),
                size,
                baseAddr
            ));
        } catch (error) {
            throw new Error(vscode.l10n.t('Failed to generate romfs for group "{0}": {1}', group.id, String(error)));
        }
    }

    /**
     * 中止编译进程
     */
    abort(): void {
        if (this.compileProcess && this.compileProcess.pid) {
            this.logger.log(vscode.l10n.t('Aborting compilation...'));
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
        this.logger.log(vscode.l10n.t('Starting compilation...'));

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
                        this.logger.log(vscode.l10n.t('Linking... (compiled files: {0})', compiledCount));
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
                    this.logger.log(vscode.l10n.t('Compilation succeeded (compiled files: {0})', compiledCount));
                    resolve();
                } else {
                    reject(new Error(vscode.l10n.t('Compilation failed, exit code: {0}', String(code))));
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
        this.logger.log(vscode.l10n.t('.config file generated with {0} entries', configLines.length));
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
        this.logger.log(vscode.l10n.t('SConstruct file generated'));
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

    /** 需要转换的资源：启用灵活打包时只取 HML 引用的 + alwaysConvert，否则取 assets 下全部 */
    private async scanAssets(): Promise<{
        images: Set<string>;
        videos: Set<string>;
        models: Set<string>;
        fonts: Set<string>;
        mapFonts: Set<string>;
    }> {
        const conversionConfig = this.assetRootConfig();
        if (conversionConfig.smartPacking === true) {
            this.logger.log(vscode.l10n.t('Scanning asset references in HML files...'));
            return this.scanUsedAssets();
        }
        this.logger.log(vscode.l10n.t('Scanning all assets for full packaging...'));
        return this.scanAllAssets();
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
                            this.logger.log(vscode.l10n.t('Failed to read HML file: {0} - {1}', fullPath, String(error)), true);
                        }
                    }
                }
            };

            scanDir(uiDir);
        }

        // 添加 alwaysConvert 配置中的资源
        this.addAlwaysConvertAssets(images, videos, models, fonts);

        // 扫描 3D 模型中引用的纹理图片
        const assetsDir = this.assetRootDir();
        if (fs.existsSync(assetsDir)) {
            this.scanModelTextures(assetsDir, models, images);
        }

        return { images, videos, models, fonts, mapFonts };
    }

    /**
     * 全量扫描 assets 目录，返回所有资源文件
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
        const conversionConfig = this.assetRootConfig();

        const assetsDir = this.assetRootDir();
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
                            this.logger.log(vscode.l10n.t('Failed to read HML file: {0} - {1}', fullPath, String(error)), true);
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
        const conversionConfig = this.assetRootConfig();
        const alwaysConvert = conversionConfig.alwaysConvert;
        if (!alwaysConvert) {
            return;
        }

        const assetsDir = this.assetRootDir();
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
            // alwaysConvert 存的是相对于**它自己那份 conversion.json 所在资源根**的路径：
            // 根资源里写 "ota/bg.png"，分组里写 "bg.png"。两者都要能对上，
            // 所以先剥前缀，再用「文件是否真的在当前根里」判定归属——
            // 比靠前缀猜更可靠，也自然排除了其它分组的条目。
            const normalized = this.stripGroupPrefix(pattern);
            if (allFiles.includes(normalized)) {
                // 精确路径：仍按扩展名过滤，避免误分类
                if (extFilter.has(path.extname(normalized).toLowerCase())) {
                    target.add(normalized);
                }
            } else {
                for (const file of allFiles) {
                    if (minimatch(file, normalized) && extFilter.has(path.extname(file).toLowerCase())) {
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
            // 分组转换时再剥掉分组目录前缀（assets/ota/x.png -> x.png）
            assetPath = this.stripGroupPrefix(assetPath);

            // 根据扩展名分类
            const ext = path.extname(assetPath).toLowerCase();
            
            if (ext === '.gif') {
                // GIF: 根据 conversion.json 的 gifAsVideo 标志决定分类
                const conversionConfig = this.assetRootConfig();
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
                this.logger.log(vscode.l10n.t('Failed to scan model textures: {0} - {1}', modelPath, String(error)), true);
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
        fallbackOptions?: ImageConvertOptions,
        onImageConverted?: ConvertAssetsOptions['onImageConverted']
    ): Promise<ConvertResult[]> {
        if (usedImages.size === 0) {
            return [];
        }

        // 加载当前资源根自己的 conversion.json（分组用自己的那份）
        const config = this.assetRootConfig();

        const imageConverter = new ImageConverterService();
        const items: Array<{ input: string; output: string; options?: ImageConvertOptions }> = [];

        for (const relativePath of usedImages) {
            const fullPath = path.join(assetsDir, relativePath);
            
            // 检查文件是否存在
            if (!fs.existsSync(fullPath)) {
                this.logger.log(vscode.l10n.t('Image file does not exist: {0}', relativePath), true);
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

        // 输入与参数都没变、输出还在的图片直接沿用上次结果
        const cache = this.conversionCache;
        const keyOf = (item: typeof items[number]) => {
            const fileKey = ConversionCache.fileKey(item.input);
            return fileKey && `${fileKey}|${JSON.stringify(item.options ?? null)}`;
        };
        const pending = cache
            ? items.filter(item => {
                const key = keyOf(item);
                return !key || !cache.isFresh(item.output, key);
            })
            : items;

        let results: ConvertResult[];
        if (onImageConverted) {
            results = [];
            for (const item of pending) {
                results.push(await imageConverter.convert(item.input, item.output, item.options || 'auto'));
                await onImageConverted(results.length, pending.length);
            }
        } else {
            results = await imageConverter.convertBatch(pending);
        }

        if (!cache) {
            return results;
        }
        results.forEach((result, index) => {
            const key = keyOf(pending[index]);
            if (result.success && key) {
                cache.remember(pending[index].output, key);
            }
        });
        const reused = items.filter(item => !pending.includes(item))
            .map(item => ({ success: true, inputPath: item.input, outputPath: item.output }));
        return [...results, ...reused];
    }

    /**
     * 视频转换计划：输出路径与转换参数。只读 HML 与 conversion.json，不调用 FFmpeg，
     * 浏览器版据此查找 CI 预转换的结果（scripts/prebuild-web-videos.ts 用同一份计划生成）。
     */
    async planVideos(): Promise<VideoPlan[]> {
        const usedAssets = await this.scanAssets();
        const root = this.currentRoot;
        const assetsDir = root?.dir || path.join(this.projectRoot, 'assets');
        const outputDir = root?.isGroup
            ? path.join(this.buildDir, 'assets', root.id)
            : path.join(this.buildDir, 'assets');
        return this.planUsedVideos(assetsDir, outputDir, usedAssets.videos);
    }

    /**
     * 按计划转换一个视频；百分比缩放需要视频尺寸，在这里读取。
     * scale 已解析过时（CI 预转换要先用它算产物键）直接传入，省一次 FFprobe。
     */
    async convertVideo(
        videoConverter: VideoConverterService,
        plan: VideoPlan,
        scale?: ResolvedScale
    ): Promise<VideoConvertResult> {
        const { spec } = plan;
        return videoConverter.convert(plan.input, plan.output, {
            format: spec.format,
            quality: spec.quality,
            frameRate: spec.frameRate,
            crop: spec.crop,
            scale: scale ?? await this.resolveScale(videoConverter, plan),
            preprocessOrder: spec.preprocessOrder,
        });
    }

    /**
     * 不调用 FFmpeg，由 source 提供转换结果（浏览器版）。没有结果的视频跳过并删掉旧输出，
     * 不中断仿真：其余内容照常运行，只是这些视频不播放。
     */
    private async supplyVideos(source: NonNullable<ConvertAssetsOptions['videoSource']>, plans: VideoPlan[]): Promise<void> {
        let supplied = 0;
        for (const plan of plans) {
            const fileKey = ConversionCache.fileKey(plan.input);
            const cacheKey = fileKey && `${fileKey}|${JSON.stringify(plan.spec)}`;
            if (cacheKey && this.conversionCache?.isFresh(plan.output, cacheKey)) {
                supplied++;
                continue;
            }
            const data = await source(plan);
            if (!data) {
                if (fs.existsSync(plan.output)) {
                    fs.unlinkSync(plan.output);
                }
                this.logger.log(vscode.l10n.t('No prebuilt conversion for video {0}; skipped. Convert videos in the VS Code extension.', plan.relativePath), true);
                continue;
            }
            fs.mkdirSync(path.dirname(plan.output), { recursive: true });
            fs.writeFileSync(plan.output, data);
            if (cacheKey) {
                this.conversionCache?.remember(plan.output, cacheKey);
            }
            supplied++;
        }
        this.logger.log(vscode.l10n.t('Videos from prebuilt conversions: {0}, skipped: {1}', supplied, plans.length - supplied));
    }

    private async planUsedVideos(
        assetsDir: string,
        outputDir: string,
        usedVideos: Set<string>
    ): Promise<VideoPlan[]> {
        if (usedVideos.size === 0) {
            return [];
        }

        // 获取项目中所有视频组件的配置
        const videoComponentConfigs = await this.getVideoComponentConfigs();

        // 加载 conversion.json 配置
        const conversionConfig = this.assetRootConfig();

        const plans: VideoPlan[] = [];

        for (const relativePath of usedVideos) {
            const fullPath = path.join(assetsDir, relativePath);
            
            // 检查文件是否存在
            if (!fs.existsSync(fullPath)) {
                this.logger.log(vscode.l10n.t('Video file does not exist: {0}', relativePath), true);
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
            
            // 缩放保留配置原样（百分比要等转换时读视频尺寸才能换算成像素）；
            // 字段顺序固定，spec 序列化后是预转换结果的键的一部分
            const spec: VideoSpec = {
                format: configFormat,
                quality: quality,
                frameRate: frameRate,
                crop: resolvedVideoCrop,
                scale: resolvedVideoScale,
                preprocessOrder: resolvedPreprocessOrder,
            };

            // 生成输出路径
            const outputExt = this.getVideoOutputExtension(spec.format);
            const outputRelative = normalizedPath.replace(/\.[^.]+$/i, outputExt);
            plans.push({
                relativePath: normalizedPath,
                input: fullPath,
                outputRelative,
                output: path.join(outputDir, outputRelative),
                spec,
            });

            this.logger.log(vscode.l10n.t('Planned conversion: {0} -> {1} ({2})', normalizedPath, spec.format, outputExt));
        }

        return plans;
    }

    /**
     * 由缩放配置计算 ScaleOptions。
     *
     * 百分比模式要读视频尺寸（FFprobe），这个换算在桌面版与 CI 预转换中都会发生：
     * 产物键必须用换算结果而不是原始百分比，否则 ffprobe 读出的源尺寸不同时，
     * 键相同而产物不同。浏览器端全程不做 FFprobe，直接按键取结果。
     */
    async resolveScale(videoConverter: VideoConverterService, plan: VideoPlan): Promise<ResolvedScale> {
        return this.resolveScaleOptions(videoConverter, plan);
    }

    /** 由缩放配置计算 ScaleOptions；百分比模式需要读取视频尺寸（FFprobe） */
    private async resolveScaleOptions(
        videoConverter: VideoConverterService,
        plan: VideoPlan
    ): Promise<ResolvedScale> {
        const { scale, crop, preprocessOrder } = plan.spec;
        if (!scale) {
            return undefined;
        }
        if (scale.mode === 'pixels') {
            return scale.width || scale.height ? { width: scale.width, height: scale.height } : undefined;
        }
        if (scale.mode !== 'percentage' || !(scale.widthPercentage || scale.heightPercentage)) {
            return undefined;
        }
        try {
            // crop-then-scale：百分比基于裁剪后的尺寸（上一步输出），而非原始视频
            // scale-then-crop 或无裁剪：百分比基于原始视频尺寸
            let baseWidth: number | undefined;
            let baseHeight: number | undefined;
            if ((preprocessOrder ?? 'crop-then-scale') === 'crop-then-scale' && crop) {
                baseWidth = crop.width;
                baseHeight = crop.height;
            } else {
                const videoInfo = await videoConverter.getVideoInfo(plan.input);
                if (videoInfo?.width && videoInfo?.height) {
                    baseWidth = videoInfo.width;
                    baseHeight = videoInfo.height;
                } else {
                    this.logger.log(vscode.l10n.t('Cannot read video info to compute scale, skipping scaling: {0}', plan.relativePath), true);
                }
            }
            if (baseWidth && baseHeight) {
                const wp = scale.widthPercentage;
                const hp = scale.heightPercentage;
                if (wp && hp) {
                    return {
                        width: Math.round(baseWidth * wp / 100 / 2) * 2,
                        height: Math.round(baseHeight * hp / 100 / 2) * 2,
                    };
                } else if (wp) {
                    return { width: Math.round(baseWidth * wp / 100 / 2) * 2 };
                } else if (hp) {
                    return { height: Math.round(baseHeight * hp / 100 / 2) * 2 };
                }
            }
        } catch (e) {
            this.logger.log(vscode.l10n.t('Failed to read video info, skipping scaling: {0} - {1}', plan.relativePath, String(e)), true);
        }
        return undefined;
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
                this.logger.log(vscode.l10n.t('3D model file does not exist: {0}', relativePath), true);
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
            const hasAlpha = imageFileHasAlpha(fullPath);
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
            options.jpegAlign = resolvedConfig.jpegParams.align;
            options.jpegMinWidth = resolvedConfig.jpegParams.minWidth;
            options.jpegMinHeight = resolvedConfig.jpegParams.minHeight;
        }
        
        // adaptive 压缩直接传递，由 ImageConverterService.convert 自动比较 RLE/FastLZ 选最优
        
        return options;
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
        const conversionConfig = this.assetRootConfig();

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
                    
                    this.logger.log(vscode.l10n.t('Planned conversion: {0} -> {1} ({2})', normalizedPath, options.format, outputExt));
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
            this.logger.log(vscode.l10n.t('Failed to read video component config: {0}', String(error)), true);
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
                    this.logger.log(vscode.l10n.t('Failed to read HML file: {0} - {1}', fullPath, String(error)), true);
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
            this.logger.log(vscode.l10n.t('No font configs to convert'));
            return results;
        }

        // 加载 conversion.json 以获取每个字体的 fontCopyOnly 设置
        const conversionConfig = this.assetRootConfig();

        // 按字体文件+配置分组，合并相同配置的字符集。
        // 有分组时只保留属于当前资源根的字体：HML 可能同时引用多个分组的字体，
        // 转换 A 组时 B 组的字体不在这个目录下，交给 B 组自己的转换轮次处理。
        const fontGroups = this.groupLabelConfigsByFont(labelConfigs)
            .filter(group => this.belongsToCurrentRoot(group.fontFile));
        const progressFontPaths = new Set(labelConfigs
            .filter(config => config.isProgressLabel)
            .map(config => `${config.fontFile}|${config.fontType}`));
        const projectI18nCatalog = loadProjectI18nCatalog(this.projectRoot);
        const totalI18nKeyCount = fontGroups.reduce((count, group) => count + group.i18nKeys.length, 0);
        if (totalI18nKeyCount > 0) {
            this.logger.log(vscode.l10n.t('Auto i18n charset: {0} font group key references participate in font conversion', totalI18nKeyCount));
        }
        
        const fontConverter = new FontConverterService();
        // 转换完成后写入的覆盖清单，供下次判断能否跳过（见 FontManifest）
        const manifest = loadFontManifest(this.buildDir);
        const manifestGroups: Record<string, FontManifestGroup> = {};

        for (const group of fontGroups) {
            // fontFile 是相对 assets/ 的 VFS 路径（如 /ota/MiSans.ttf）。分组转换时
            // assetsDir 已经是 assets/ota，必须剥掉分组前缀，否则拼成 assets/ota/ota/...
            const fontRelativePath = this.stripGroupPrefix(
                group.fontFile.replace(/\\/g, '/').replace(/^\/+/, '')
            );
            const fontPath = path.join(assetsDir, fontRelativePath);
            const isProgressFont = progressFontPaths.has(`${group.fontFile}|${group.fontType}`);
            // 指纹与产物路径统一按「相对当前资源根」的路径计算。
            // 必须与 findStaleFontAsset 用同一套路径，否则两边算出的指纹不同，
            // 转换刚成功也会被判为"已过期"（详见 findStaleFontAsset 的注释）。
            const groupInRoot = { ...group, fontFile: fontRelativePath } as typeof group;
            
            // 检查字体文件是否存在
            if (!fs.existsSync(fontPath)) {
                if (isProgressFont) {
                    throw new Error(vscode.l10n.t('Progress label font not found: {0}', fontPath));
                }
                this.logger.log(vscode.l10n.t('Font file does not exist: {0}', group.fontFile), true);
                results.push({
                    success: false,
                    inputPath: fontPath,
                    outputPath: outputDir,
                    error: vscode.l10n.t('Font file does not exist')
                });
                continue;
            }

            // 确定输出目录（保持原始目录结构）
            const fontDir = path.dirname(fontRelativePath);
            const fontOutputDir = fontDir === '.' ? outputDir : path.join(outputDir, fontDir);

            // 检查是否设置了"直接拷贝"
            const fontItemSettings = conversionConfig.items[group.fontFile.replace(/\\/g, '/')];
            if (fontItemSettings?.fontCopyOnly) {
                if (isProgressFont) {
                    throw new Error(vscode.l10n.t('Progress label font must be converted, not copied: {0}', group.fontFile));
                }
                if (!fs.existsSync(fontOutputDir)) {
                    fs.mkdirSync(fontOutputDir, { recursive: true });
                }
                const destPath = path.join(fontOutputDir, path.basename(fontPath));
                fs.copyFileSync(fontPath, destPath);
                results.push({ success: true, outputPath: destPath, message: vscode.l10n.t('Font file copied directly') });
                continue;
            }

            const groupI18nAutoCharset = summarizeI18nAutoCharsetForKeys(projectI18nCatalog, group.i18nKeys);
            // 与 findStaleFontAsset 共用同一套字符集展开，保证「判新鲜」和「实际转换」的范围一致
            const mergedCharacterSets = this.buildFontCharacterSets(group, projectI18nCatalog);

            // 上次转换已覆盖当前需求、且产物还在时跳过：改控件坐标、增删无关控件、新增已在
            // 附加字符集范围内的字符都不再重转字库。进度标签同样跳过——它的字符需求固定为
            // 数字与符号，与设计期文本无关；若其字号恰好并入某个大字体组，重转代价很高。
            // 判新鲜失败（字符集无法解析）时按需要重转处理，错误交给下面的转换流程报告。
            const manifestKey = this.fontGroupManifestKey(group);
            const existingGroup = manifest.groups[manifestKey];
            let covered = false;
            if (existingGroup) {
                try {
                    covered = manifestCovers(
                        manifest,
                        manifestKey,
                        this.fontGroupFingerprint(groupInRoot, assetsDir),
                        this.requestedCharacters(mergedCharacterSets),
                        group.fontType === 'vector' ? group.fontSize : 0,
                    );
                } catch {
                    covered = false;
                }
            }
            if (covered) {
                const existingPath = this.fontGroupOutputPath(groupInRoot, outputDir);
                if (fs.existsSync(existingPath)) {
                    manifestGroups[manifestKey] = existingGroup;
                    results.push({ success: true, inputPath: fontPath, outputPath: fontOutputDir });
                    continue;
                }
            }

            // 构建转换选项
            const options: FontConvertOptions = {
                fontSize: group.fontSize,
                renderMode: group.renderMode,
                outputFormat: group.fontType,
                characterSets: mergedCharacterSets
            };

            const fontName = path.basename(fontRelativePath, path.extname(fontRelativePath)).replace(/-/g, '_');
            const outputName = group.fontType === 'vector'
                ? `${fontName}_vector.bin`
                : `${fontName}_size${group.fontSize}_bits${group.renderMode}_bitmap.bin`;
            const outputPath = path.join(fontOutputDir, outputName);
            // 字符集文件（file / codepage）的内容不在指纹里，带这类字符集的字体每次都转换
            const fontFileKey = ConversionCache.fileKey(fontPath);
            const cacheKey = this.conversionCache && fontFileKey
                && !mergedCharacterSets.some(cs => cs.type === 'file' || cs.type === 'codepage')
                ? `${fontFileKey}|${JSON.stringify(options)}`
                : undefined;
            if (cacheKey && this.conversionCache!.isFresh(outputPath, cacheKey)) {
                // 缓存命中也算"本次已就绪"，必须写入清单，否则 findStaleFontAsset
                // 在清单里找不到该组，会一直判过期。
                manifestGroups[manifestKey] = {
                    fingerprint: this.fontGroupFingerprint(groupInRoot, assetsDir),
                    chars: this.codepointsToString(this.requestedCharacters(mergedCharacterSets)),
                    precision: group.fontType === 'vector' ? group.fontSize : 0,
                };
                results.push({ success: true, inputPath: fontPath, outputPath: fontOutputDir });
                continue;
            }

            try {
                const result = await fontConverter.convert(fontPath, fontOutputDir, options);
                results.push(result);
                if (result.success && cacheKey) {
                    this.conversionCache!.remember(outputPath, cacheKey);
                }
                if (isProgressFont) {
                    if (!result.success) {
                        throw new Error(vscode.l10n.t('Progress label font conversion failed: {0}', result.error || group.fontFile));
                    }
                    if (!fs.existsSync(outputPath)) {
                        throw new Error(vscode.l10n.t('Progress label font output missing: {0}', outputPath));
                    }
                }
                
                if (result.success) {
                    // 记下本次实际覆盖的范围，下次同样需求即可跳过转换。
                    // 指纹必须用「相对当前资源根」的路径计算，与 findStaleFontAsset 一致。
                    manifestGroups[this.fontGroupManifestKey(group)] = {
                        fingerprint: this.fontGroupFingerprint(groupInRoot, assetsDir),
                        chars: this.codepointsToString(this.requestedCharacters(mergedCharacterSets)),
                        precision: group.fontType === 'vector' ? group.fontSize : 0,
                    };
                } else {
                    // 失败时显示详细信息，方便调试
                    this.logger.log(vscode.l10n.t('Converting font: {0} ({1}, size={2}, bits={3})', group.fontFile, group.fontType, group.fontSize, group.renderMode));
                    this.logger.log('  ' + vscode.l10n.t('Text characters: "{0}" ({1} chars)', group.characters.substring(0, 50) + (group.characters.length > 50 ? '...' : ''), group.characters.length));
                    if (groupI18nAutoCharset.charCount > 0) {
                        this.logger.log('  ' + vscode.l10n.t('Auto i18n charset: {0} chars from {1} keys', groupI18nAutoCharset.charCount, group.i18nKeys.length));
                    }
                    if (group.additionalCharSets.length > 0) {
                        this.logger.log('  ' + vscode.l10n.t('Additional charsets: {0}', group.additionalCharSets.length));
                        group.additionalCharSets.forEach((cs, idx) => {
                            // 显示原始路径
                            this.logger.log(`    [${idx + 1}] ${cs.type}: ${cs.value}`);
                        });
                        // 显示转换后的绝对路径（用于调试）
                        options.characterSets
                            .filter((cs) => cs.type === 'file' || cs.type === 'codepage')
                            .forEach((cs, idx) => {
                                this.logger.log(`    [${idx + 1}] file: ${cs.value}`);
                            });
                    }
                    this.logger.log('  ' + vscode.l10n.t('✗ Failed: {0}', String(result.error)), true);
                }
            } catch (error: any) {
                if (isProgressFont) {
                    throw error;
                }
                // 异常时显示详细信息，方便调试
                this.logger.log(vscode.l10n.t('Converting font: {0} ({1}, size={2}, bits={3})', group.fontFile, group.fontType, group.fontSize, group.renderMode));
                this.logger.log('  ' + vscode.l10n.t('Text characters: "{0}" ({1} chars)', group.characters.substring(0, 50) + (group.characters.length > 50 ? '...' : ''), group.characters.length));
                if (groupI18nAutoCharset.charCount > 0) {
                    this.logger.log('  ' + vscode.l10n.t('Auto i18n charset: {0} chars from {1} keys', groupI18nAutoCharset.charCount, group.i18nKeys.length));
                }
                if (group.additionalCharSets.length > 0) {
                    this.logger.log('  ' + vscode.l10n.t('Additional charsets: {0}', group.additionalCharSets.length));
                    group.additionalCharSets.forEach((cs, idx) => {
                        // 显示原始路径
                        this.logger.log(`    [${idx + 1}] ${cs.type}: ${cs.value}`);
                    });
                    // 显示转换后的绝对路径（用于调试）
                    options.characterSets
                        .filter((cs) => cs.type === 'file' || cs.type === 'codepage')
                        .forEach((cs, idx) => {
                            this.logger.log(`    [${idx + 1}] file: ${cs.value}`);
                        });
                }
                results.push({
                    success: false,
                    inputPath: fontPath,
                    outputPath: fontOutputDir,
                    error: error.message
                });
                this.logger.log('  ' + vscode.l10n.t('✗ Unexpected error: {0}', error.message), true);
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
                this.logger.log(vscode.l10n.t('Forced-conversion font file does not exist: {0}', fontRelPath), true);
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
                results.push({ success: true, outputPath: destPath, message: vscode.l10n.t('Font file copied directly') });
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
                    this.logger.log(vscode.l10n.t('Forced font conversion failed: {0} - {1}', fontRelPath, String(result.error)), true);
                }
            } catch (error: any) {
                results.push({ success: false, inputPath: fontPath, outputPath: fontOutputDir, error: error.message });
                this.logger.log(vscode.l10n.t('Forced font conversion error: {0} - {1}', fontRelPath, error.message), true);
            }
        }

        // 只记录本次成功转换的组；转换失败的组不进清单，下次仍会重转。
        //
        // 清单是全项目共用的一份：convertAssets 按资源根逐个调用到这里，
        // 直接整体覆盖会把前一个根刚写好的条目冲掉（转完 general 再转 ota，
        // general 的指纹就没了，检查阶段立刻判它过期）。所以这里读回磁盘上的
        // 现有内容再合并，只覆盖本根这次真正转换过的 key。
        const onDisk = loadFontManifest(this.buildDir);
        saveFontManifest(this.buildDir, {
            version: 1,
            groups: { ...onDisk.groups, ...manifestGroups },
        });

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
        i18nKey?: string;
        isProgressLabel?: boolean;
        sourceMtimeMs?: number;
    }>> {
        const configs: Array<any> = [];
        
        try {
            const uiDir = path.join(this.projectRoot, 'ui');
            if (fs.existsSync(uiDir)) {
                await this.scanHmlFilesForLabelConfigs(uiDir, configs);
            }
        } catch (error) {
            this.logger.log(vscode.l10n.t('Failed to read Label component config: {0}', String(error)), true);
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
                    const startIndex = configs.length;
                    this.extractLabelConfigsFromHml(content, configs);
                    const sourceMtimeMs = fs.statSync(fullPath).mtimeMs;
                    for (let i = startIndex; i < configs.length; i++) {
                        configs[i].sourceMtimeMs = sourceMtimeMs;
                    }
                } catch (error) {
                    this.logger.log(vscode.l10n.t('Failed to read HML file: {0} - {1}', fullPath, String(error)), true);
                }
            }
        }
    }

    /**
     * 从 HML 内容中提取 Label 组件的字体配置
     */
    private extractLabelConfigsFromHml(hmlContent: string, configs: Array<any>): void {
        // Include enabled progress labels so their runtime digits use the same font conversion.
        const labelTagRegex = /<hg_(label|time_label|timer_label|progress)[^>]*>/g;
        let match;
        
        while ((match = labelTagRegex.exec(hmlContent)) !== null) {
            const tagContent = match[0];
            const tagType = match[1]; // 'label'、'time_label' 或 'timer_label'
            if (tagType === 'progress' && (
                !/showValueLabel\s*=\s*["']true["']/.test(tagContent)
                || /progressMode\s*=\s*["'](?:loading|loading-slide)["']/.test(tagContent)
            )) {
                continue;
            }
            
            // 提取 fontFile 属性
            const fontFileMatch = tagContent.match(/fontFile\s*=\s*["']([^"']+)["']/);
            if (!fontFileMatch) {
                continue; // 没有指定字体文件，跳过
            }
            
            const config: any = {
                fontFile: fontFileMatch[1],
                isProgressLabel: tagType === 'progress',
                fontSize: 16,
                fontType: 'bitmap',
                renderMode: 4,
                text: tagType === 'progress' ? '0123456789-%' : '',
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

            // 提取 i18nKey 属性
            const i18nKeyMatch = tagContent.match(/i18nKey\s*=\s*["']([^"']+)["']/);
            if (i18nKeyMatch) {
                config.i18nKey = this.unescapeXml(i18nKeyMatch[1]).trim();
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
                    this.logger.log(vscode.l10n.t('Failed to parse characterSets: {0}', String(e)), true);
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
        i18nKey?: string;
    }>): Array<{
        fontFile: string;
        fontSize: number;
        fontType: 'bitmap' | 'vector';
        renderMode: number;
        characters: string;
        additionalCharSets: Array<{ type: 'range' | 'file' | 'codepage' | 'string'; value: string }>;
        i18nKeys: string[];
    }> {
        const groups = new Map<string, {
            fontFile: string;
            fontSize: number;
            fontType: 'bitmap' | 'vector';
            renderMode: number;
            charSet: Set<string>;
            additionalCharSets: Set<string>;
            i18nKeys: Set<string>;
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
                    additionalCharSets: new Set(),
                    i18nKeys: new Set()
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

            const cleanI18nKey = typeof config.i18nKey === 'string' ? config.i18nKey.trim() : '';
            if (cleanI18nKey) {
                group.i18nKeys.add(cleanI18nKey);
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
            i18nKeys: Array.from(group.i18nKeys).sort((a, b) => a.localeCompare(b)),
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
            this.logger.log(vscode.l10n.t('No glass effect configs to convert'));
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
                this.logger.log(vscode.l10n.t('Glass effect source file does not exist: {0}', srcPath), true);
                results.push({
                    success: false,
                    inputPath,
                    outputPath: outputDir,
                    error: vscode.l10n.t('Source file does not exist')
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

            this.logger.log(vscode.l10n.t('Converting glass effect: {0} -> {1} (distortion={2}%, region={3}%)', srcPath, outputFileName, config.distortion, config.region));

            try {
                const result = await glassConverter.convert(inputPath, outputPath, options);
                results.push(result);
                
                if (result.success) {
                    this.logger.log('  ' + vscode.l10n.t('✓ Success: {0}', outputPath));
                } else {
                    this.logger.log('  ' + vscode.l10n.t('✗ Failed: {0}', String(result.error)), true);
                }
            } catch (error: any) {
                results.push({
                    success: false,
                    inputPath,
                    outputPath,
                    error: error.message
                });
                this.logger.log('  ' + vscode.l10n.t('✗ Unexpected error: {0}', error.message), true);
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
                        this.logger.log(vscode.l10n.t('Failed to read HML file: {0} - {1}', fullPath, String(err)), true);
                    }
                }
            }
        } catch (error) {
            this.logger.log(vscode.l10n.t('Failed to read Glass component config: {0}', String(error)), true);
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
                    this.logger.log(vscode.l10n.t('Failed to read HML file: {0} - {1}', fullPath, String(error)), true);
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
