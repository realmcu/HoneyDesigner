import * as path from 'path';
import * as fs from 'fs';
import { ImageConverter } from '../../tools/image-converter/converter';
import { PixelFormat } from '../../tools/image-converter/types';
import { RLECompression, FastLzCompression, YUVCompression } from '../../tools/image-converter/compress';
import { ConversionConfigService, ConversionConfig, TargetFormat, CompressionMethod, YuvBlur } from './ConversionConfigService';
import { convertToJpeg, SamplingFactor } from '../../tools/image-to-jpeg-converter/src/index';
import { imageFileHasAlpha } from '../utils/imageAlpha';

export type CompressionType = 'none' | 'rle' | 'fastlz' | 'yuv' | 'jpeg' | 'adaptive';
export type YuvSampleMode = 'yuv444' | 'yuv422' | 'yuv411';
export type YuvBlurBits = 0 | 1 | 2 | 4;

export interface ImageConvertOptions {
    format?: string;
    compression?: CompressionType;
    yuvSampleMode?: YuvSampleMode;
    yuvBlurBits?: YuvBlurBits;
    yuvFastlz?: boolean;
    dither?: boolean;
    /** JPEG 采样方式 */
    jpegSampling?: SamplingFactor;
    /** JPEG 编码质量 1-31，越小质量越高 */
    jpegQuality?: number;
    /** JPEG 透明图片背景色 */
    jpegBackgroundColor?: string;
    /** JPEG Padding 到最小编码单元（MCU 对齐），默认 false */
    jpegAlign?: boolean;
}

export interface ConvertResult {
    success: boolean;
    inputPath: string;
    outputPath: string;
    error?: string;
}

export class ImageConverterService {
    constructor(sdkPath?: string) {
        // SDK path 不再需要，但保留参数以兼容现有代码
    }

    /**
     * 判断格式是否为自适应格式
     * @param format 目标格式
     * @returns 如果是 adaptive16 或 adaptive24 返回 true，否则返回 false
     */
    private static isAdaptiveFormat(format: TargetFormat): boolean {
        return format === 'adaptive16' || format === 'adaptive24';
    }

    /**
     * 判断格式是否为明确指定的格式
     * @param format 目标格式
     * @returns 如果是明确格式（RGB565、ARGB8565、RGB888、ARGB8888、I8）返回 true，否则返回 false
     */
    private static isExplicitFormat(format: TargetFormat): boolean {
        const explicitFormats: TargetFormat[] = ['RGB565', 'ARGB8565', 'RGB888', 'ARGB8888', 'I8'];
        return explicitFormats.includes(format);
    }

    /**
     * Convert a single image to bin format
     */
    async convert(inputPath: string, outputPath: string, options: string | ImageConvertOptions = 'auto'): Promise<ConvertResult> {
        try {
            // 兼容旧的字符串参数
            const opts: ImageConvertOptions = typeof options === 'string' 
                ? { format: options } 
                : options;
            
            // 确保输出目录存在
            const outputDir = path.dirname(outputPath);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            // 转换格式字符串到 PixelFormat
            let pixelFormat: PixelFormat | 'auto' = 'auto';
            if (opts.format && opts.format !== 'auto') {
                const formatMap: Record<string, PixelFormat> = {
                    'rgb565': PixelFormat.RGB565,
                    'rgb888': PixelFormat.RGB888,
                    'argb8888': PixelFormat.ARGB8888,
                    'argb8565': PixelFormat.ARGB8565,
                    'a8': PixelFormat.A8,
                    'a4': PixelFormat.A4,
                    'a2': PixelFormat.A2,
                    'a1': PixelFormat.A1,
                    'i8': PixelFormat.I8,
                };
                const mappedFormat = formatMap[opts.format.toLowerCase()];
                // 使用 !== undefined 而不是 || 来避免 0 值被当作 falsy
                pixelFormat = mappedFormat !== undefined ? mappedFormat : 'auto';
            }

            // JPEG 走独立管线（FFmpeg），不走 ImageConverter
            if (opts.compression === 'jpeg') {
                return await this.convertToJpegFormat(inputPath, outputPath, opts);
            }

            // 自适应压缩：分别用 RLE 和 FastLZ 转换，比较文件大小，保留更小的
            if (opts.compression === 'adaptive') {
                return await this.convertWithAdaptiveCompression(inputPath, outputPath, pixelFormat, opts);
            }

            // 为每次转换创建新的 ImageConverter 实例，避免并行转换时压缩器状态互相干扰
            const converter = new ImageConverter();

            // 设置压缩算法
            if (opts.compression && opts.compression !== 'none') {
                switch (opts.compression) {
                    case 'rle':
                        converter.setCompressor(new RLECompression());
                        break;
                    case 'fastlz':
                        converter.setCompressor(new FastLzCompression());
                        break;
                    case 'yuv':
                        converter.setCompressor(new YUVCompression(
                            opts.yuvSampleMode || 'yuv422',
                            opts.yuvBlurBits || 0,
                            opts.yuvFastlz || false
                        ));
                        break;
                    default:
                        console.log(`[ImageConverter] Unknown compression type: ${opts.compression}`);
                }
            } else {
            }

            await converter.convert(inputPath, outputPath, pixelFormat, { dither: opts.dither });
            return { success: true, inputPath, outputPath };
        } catch (error: any) {
            return { success: false, inputPath, outputPath, error: error.message };
        }
    }

    /**
     * 自适应压缩：分别用 RLE 和 FastLZ 压缩，比较输出文件大小，保留更小的结果
     * 如果压缩后反而更大，则使用不压缩的版本
     */
    private async convertWithAdaptiveCompression(
        inputPath: string,
        outputPath: string,
        pixelFormat: PixelFormat | 'auto',
        opts: ImageConvertOptions
    ): Promise<ConvertResult> {
        const dither = opts.dither;
        const candidates: { name: string; compressor: any }[] = [
            { name: 'rle', compressor: new RLECompression() },
            { name: 'fastlz', compressor: new FastLzCompression() },
        ];

        // 先生成不压缩的版本作为基准
        const noCompressPath = outputPath + '.nocompress.tmp';
        const converterNoCompress = new ImageConverter();
        await converterNoCompress.convert(inputPath, noCompressPath, pixelFormat, { dither });
        let bestPath = noCompressPath;
        let bestSize = fs.statSync(noCompressPath).size;
        let bestName = 'none';

        // 依次尝试每种压缩算法
        for (const candidate of candidates) {
            const tmpPath = outputPath + `.${candidate.name}.tmp`;
            try {
                const converterWithCompress = new ImageConverter();
                converterWithCompress.setCompressor(candidate.compressor);
                await converterWithCompress.convert(inputPath, tmpPath, pixelFormat, { dither });
                const size = fs.statSync(tmpPath).size;
                if (size < bestSize) {
                    // 删除之前的最优临时文件
                    if (bestPath !== tmpPath && fs.existsSync(bestPath)) {
                        fs.unlinkSync(bestPath);
                    }
                    bestSize = size;
                    bestPath = tmpPath;
                    bestName = candidate.name;
                } else {
                    // 这个候选不是最优，删除
                    fs.unlinkSync(tmpPath);
                }
            } catch {
                // 压缩失败，跳过该算法，清理临时文件
                if (fs.existsSync(tmpPath)) {
                    fs.unlinkSync(tmpPath);
                }
            }
        }

        // 将最优结果重命名为目标路径
        if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
        }
        fs.renameSync(bestPath, outputPath);

        return { success: true, inputPath, outputPath };
    }

    /**
     * JPEG 转换：使用 FFmpeg 将图片转换为带自定义头的 JPEG 二进制文件
     */
    private async convertToJpegFormat(
        inputPath: string,
        outputPath: string,
        opts: ImageConvertOptions
    ): Promise<ConvertResult> {
        try {
            // 映射采样参数
            const samplingFactor = opts.jpegSampling || SamplingFactor.YUV420;
            const quality = opts.jpegQuality || 10;
            const backgroundColor = opts.jpegBackgroundColor || 'black';
            const align = opts.jpegAlign ?? false;

            // 确保输出目录存在
            const outputDir = path.dirname(outputPath);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            await convertToJpeg({
                inputPath,
                outputPath,
                samplingFactor,
                quality,
                backgroundColor,
                align
            });

            return { success: true, inputPath, outputPath };
        } catch (error: any) {
            return { success: false, inputPath, outputPath, error: error.message || String(error) };
        }
    }

    /**
     * Convert multiple images in batch
     */
    async convertBatch(items: Array<{ input: string; output: string; options?: ImageConvertOptions }>): Promise<ConvertResult[]> {
        return Promise.all(items.map(item => this.convert(item.input, item.output, item.options || 'auto')));
    }

    /**
     * Convert all images in assets directory to build output
     * 读取 conversion.json 配置，为每个图片应用其特定的格式和压缩设置
     * @param assetsDir 资源目录
     * @param outputDir 输出目录
     * @param fallbackOptions 回退选项（当没有配置时使用）
     */
    async convertAssetsDir(assetsDir: string, outputDir: string, fallbackOptions?: ImageConvertOptions): Promise<ConvertResult[]> {
        if (!fs.existsSync(assetsDir)) {
            return [];
        }

        // 获取项目根目录（assets 的父目录）
        const projectRoot = path.dirname(assetsDir);
        
        // 加载 conversion.json 配置
        const configService = ConversionConfigService.getInstance();
        const config = configService.loadConfig(projectRoot);

        const imageExts = ['.png', '.jpg', '.jpeg', '.bmp', '.gif'];
        const items: Array<{ input: string; output: string; options?: ImageConvertOptions }> = [];

        const scanDir = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    scanDir(fullPath);
                } else if (imageExts.includes(path.extname(entry.name).toLowerCase())) {
                    const relativePath = path.relative(assetsDir, fullPath);
                    const outputPath = path.join(outputDir, relativePath.replace(/\.(png|jpe?g|bmp|gif)$/i, '.bin'));
                    
                    // GIF 文件不需要配置选项，直接打包原始数据
                    const ext = path.extname(entry.name).toLowerCase();
                    if (ext === '.gif') {
                        items.push({ input: fullPath, output: outputPath });
                    } else {
                        // 为每个图片解析其特定的配置
                        const imageOptions = this.resolveImageOptions(relativePath, fullPath, config, fallbackOptions);
                        items.push({ input: fullPath, output: outputPath, options: imageOptions });
                    }
                }
            }
        };

        scanDir(assetsDir);
        return this.convertBatch(items);
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
        
        // 解析格式（只对自适应格式进行透明通道检测和格式调整）
        let format: string;
        
        // 只对自适应格式进行透明通道检测和格式调整
        if (ImageConverterService.isAdaptiveFormat(effectiveFormat)) {
            // 检查图片是否有透明度
            const hasAlpha = imageFileHasAlpha(fullPath);
            // 解析自适应格式
            format = configService.resolveAdaptiveFormat(effectiveFormat, hasAlpha);
        } else {
            // 对于明确指定的格式，直接使用原始格式，不做任何调整
            format = effectiveFormat;
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
        }
        
        // adaptive 压缩直接传递，由 convert 方法中自动比较 RLE/FastLZ 选最优
        
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
}
