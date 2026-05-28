import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

// 直接导入本地 video-converter 源码
import { VideoConverter, OutputFormat, ProgressCallback, ConversionOptions, ScaleOptions, CropOptions, PreprocessStep } from '../../tools/video-converter-ts/src/index';

export interface VideoConvertOptions {
    format: 'mjpeg' | 'avi' | 'h264' | 'avi_msv1';
    frameRate?: number;  // 帧率
    quality?: number;    // 质量: MJPEG/AVI 为 1-31（1最高），H264 为 CRF 值 0-51
    // 视频裁剪（由 video-converter-ts 库的 preprocess 管道处理，x/y 可选，留空自动居中）
    crop?: CropOptions;
    // 视频缩放（由 video-converter-ts 库的 preprocess 管道处理）
    // 只指定 width 或 height 时自动保持宽高比；两者都指定则按精确尺寸缩放
    scale?: ScaleOptions;
    // 预处理顺序：'crop-then-scale'（先裁剪再缩放，默认）或 'scale-then-crop'
    preprocessOrder?: 'crop-then-scale' | 'scale-then-crop';
}

export interface VideoConvertResult {
    success: boolean;
    inputPath: string;
    outputPath: string;
    error?: string;
    warning?: string;    // 警告信息（非致命错误）
    duration?: number;   // 转换耗时（秒）
    frameCount?: number; // 帧数
    frameRate?: number;  // 帧率
}

/**
 * 日志回调函数类型
 */
export type LogCallback = (message: string) => void;

/**
 * 视频转换服务
 * 
 * 转换流程（统一 preprocess 管道）：
 * 1. 如有裁剪需求，先执行 crop 步骤
 * 2. 如有缩放需求，再执行 scale 步骤
 * 3. 两者均由 video-converter-ts 库内部通过 FFmpeg 处理
 */
export class VideoConverterService {
    private logCallback?: LogCallback;
    private progressCallback?: ProgressCallback;
    private converter: VideoConverter;

    constructor(logCallback?: LogCallback, progressCallback?: ProgressCallback) {
        this.logCallback = logCallback;
        this.progressCallback = progressCallback;
        this.converter = new VideoConverter(progressCallback);
    }


    /**
     * 输出日志
     */
    private log(message: string): void {
        if (this.logCallback) {
            this.logCallback(message);
        }
        console.log(`[VideoConverter] ${message}`);
    }

    /**
     * 检查 FFmpeg 是否可用
     */
    async checkFFmpegAvailable(): Promise<boolean> {
        return new Promise((resolve) => {
            const proc = spawn('ffmpeg', ['-version'], { shell: true });
            
            proc.on('close', (code) => {
                resolve(code === 0);
            });
            
            proc.on('error', () => {
                resolve(false);
            });
        });
    }

    /**
     * 根据格式构建输出文件扩展名
     */
    private getOutputExtension(format: string): string {
        switch (format) {
            case 'mjpeg':
                return '.mjpeg';
            case 'avi':
            case 'avi_msv1':
                return '.avi';
            case 'h264':
                return '.h264';
            default:
                return '.mjpeg';
        }
    }

    /**
     * 检查是否需要 FFmpeg 预处理（仅裁剪；缩放由库处理）
     * @deprecated 裁剪现已通过 preprocess 管道由库统一处理
     */
    private needsPreprocessing(_options: VideoConvertOptions): boolean {
        return false;
    }

    /**
     * 将服务格式映射到转换器格式
     */
    private mapFormat(format: 'mjpeg' | 'avi' | 'h264' | 'avi_msv1'): OutputFormat {
        switch (format) {
            case 'mjpeg':
                return OutputFormat.MJPEG;
            case 'avi':
                return OutputFormat.AVI_MJPEG;
            case 'avi_msv1':
                return OutputFormat.AVI_MSV1;
            case 'h264':
                return OutputFormat.H264;
            default:
                return OutputFormat.MJPEG;
        }
    }

    /**
     * 转换单个视频文件
     * 
     * 使用 video-converter-ts preprocess 管道统一处理裁剪和缩放：
     * 先裁剪（crop），再缩放（scale），再进行格式转换
     */
    async convert(
        inputPath: string,
        outputPath: string,
        options: VideoConvertOptions
    ): Promise<VideoConvertResult> {
        // 检查输入文件是否存在
        if (!fs.existsSync(inputPath)) {
            return {
                success: false,
                inputPath,
                outputPath,
                error: `Input file not found: ${inputPath}`
            };
        }

        // 确保输出目录存在
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const startTime = Date.now();

        try {
            const outputFormat = this.mapFormat(options.format);

    // 构建预处理管道：顺序由 preprocessOrder 决定，默认先裁剪后缩放
            const preprocessSteps: PreprocessStep[] = [];
            const order = options.preprocessOrder ?? 'crop-then-scale';
            if (order === 'crop-then-scale') {
                if (options.crop) preprocessSteps.push({ type: 'crop', options: options.crop });
                if (options.scale) preprocessSteps.push({ type: 'scale', options: options.scale });
            } else {
                if (options.scale) preprocessSteps.push({ type: 'scale', options: options.scale });
                if (options.crop) preprocessSteps.push({ type: 'crop', options: options.crop });
            }

            const conversionOptions: ConversionOptions = {
                frameRate: options.frameRate,
                quality: options.quality,
                preprocess: preprocessSteps.length > 0 ? preprocessSteps : undefined,
            };

            const result = await this.converter.convert(
                inputPath,
                outputPath,
                outputFormat,
                conversionOptions
            );

            return {
                success: true,
                inputPath,
                outputPath,
                duration: (Date.now() - startTime) / 1000,
                frameCount: result.frameCount,
                frameRate: result.frameRate
            };
        } catch (error) {
            return {
                success: false,
                inputPath,
                outputPath,
                error: `Conversion error: ${error}`,
                duration: (Date.now() - startTime) / 1000
            };
        }
    }


    /**
     * 批量转换视频
     */
    async convertBatch(
        items: Array<{
            input: string;
            output: string;
            options: VideoConvertOptions;
        }>
    ): Promise<VideoConvertResult[]> {
        return Promise.all(
            items.map(item => this.convert(item.input, item.output, item.options))
        );
    }

    /**
     * 获取视频信息
     */
    async getVideoInfo(videoPath: string): Promise<{
        duration?: number;
        width?: number;
        height?: number;
        frameRate?: number;
        frameCount?: number;
        codec?: string;
    } | null> {
        if (!fs.existsSync(videoPath)) {
            return null;
        }

        try {
            const info = await this.converter.getVideoInfo(videoPath);
            return {
                duration: info.duration,
                width: info.width,
                height: info.height,
                frameRate: info.frameRate,
                frameCount: info.frameCount,
                codec: info.codec
            };
        } catch (error) {
            this.log(`Failed to get video info: ${error}`);
            return null;
        }
    }
}
