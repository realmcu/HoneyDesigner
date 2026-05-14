import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

// 直接导入本地 video-converter 源码
import { VideoConverter, OutputFormat, ProgressCallback, ConversionOptions, ScaleOptions } from '../../tools/video-converter-ts/src/index';

export interface VideoConvertOptions {
    format: 'mjpeg' | 'avi' | 'h264';
    frameRate?: number;  // 帧率
    quality?: number;    // 质量: MJPEG/AVI 为 1-31（1最高），H264 为 CRF 值 0-51
    // 视频裁剪（FFmpeg 预处理）
    crop?: {
        x: number;       // 裁剪起始 X 坐标
        y: number;       // 裁剪起始 Y 坐标
        width: number;   // 裁剪宽度
        height: number;  // 裁剪高度
    };
    // 视频缩放（委托给 video-converter-ts 库处理）
    // 只指定 width 或 height 时自动保持宽高比；两者都指定则按精确尺寸缩放
    scale?: ScaleOptions;
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
 * 转换流程：
 * 1. FFmpeg 预处理（仅裁剪），如有 crop 需求
 * 2. 使用 TypeScript 视频转换器进行格式转换和编码（内置支持 scale）
 * 3. 如果没有裁剪需求，直接调用转换器转换原始视频
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
                return '.avi';
            case 'h264':
                return '.h264';
            default:
                return '.mjpeg';
        }
    }

    /**
     * 检查是否需要 FFmpeg 预处理（仅裁剪；缩放由库处理）
     */
    private needsPreprocessing(options: VideoConvertOptions): boolean {
        return !!options.crop;
    }

    /**
     * 将服务格式映射到转换器格式
     */
    private mapFormat(format: 'mjpeg' | 'avi' | 'h264'): OutputFormat {
        switch (format) {
            case 'mjpeg':
                return OutputFormat.MJPEG;
            case 'avi':
                return OutputFormat.AVI_MJPEG;
            case 'h264':
                return OutputFormat.H264;
            default:
                return OutputFormat.MJPEG;
        }
    }

    /**
     * 转换单个视频文件
     * 
     * 流程：
     * 1. 如果有裁剪需求，先用 FFmpeg 预处理裁剪
     * 2. 调用 TypeScript 视频转换器进行格式转换（缩放由库内部处理）
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
        let videoToConvert = inputPath;
        let tempPreprocessFile: string | null = null;

        // 第一步：FFmpeg 预处理（仅用于裁剪）
        if (this.needsPreprocessing(options)) {
            const ffmpegAvailable = await this.checkFFmpegAvailable();
            if (!ffmpegAvailable) {
                return {
                    success: false,
                    inputPath,
                    outputPath,
                    error: 'FFmpeg not found. Required for video cropping.'
                };
            }

            // 创建临时文件用于预处理输出
            const inputExt = path.extname(inputPath);
            const outputBase = outputPath.slice(0, -path.extname(outputPath).length);
            tempPreprocessFile = outputBase + '.preprocess' + inputExt;

            const preprocessResult = await this.ffmpegPreprocess(inputPath, tempPreprocessFile, options);
            if (!preprocessResult.success) {
                return preprocessResult;
            }

            videoToConvert = tempPreprocessFile;
        }

        // 第二步：使用 TypeScript 转换器进行格式转换（scale 由库处理）
        try {
            const outputFormat = this.mapFormat(options.format);
            const conversionOptions: ConversionOptions = {
                frameRate: options.frameRate,
                quality: options.quality,
                scale: options.scale  // 缩放委托给库
            };
            const result = await this.converter.convert(
                videoToConvert,
                outputPath,
                outputFormat,
                conversionOptions
            );

            const totalDuration = (Date.now() - startTime) / 1000;

            return {
                success: true,
                inputPath,
                outputPath,
                duration: totalDuration,
                frameCount: result.frameCount,
                frameRate: result.frameRate
            };
        } catch (error) {
            const totalDuration = (Date.now() - startTime) / 1000;
            return {
                success: false,
                inputPath,
                outputPath,
                error: `Conversion error: ${error}`,
                duration: totalDuration
            };
        }
    }


    /**
     * FFmpeg 预处理（仅处理裁剪；缩放由 video-converter-ts 库处理）
     */
    private async ffmpegPreprocess(
        inputPath: string,
        outputPath: string,
        options: VideoConvertOptions
    ): Promise<VideoConvertResult> {
        return new Promise((resolve) => {
            const args = [
                '-i', inputPath,
                '-y',
            ];

            if (options.crop) {
                const { x, y, width, height } = options.crop;
                args.push('-vf', `crop=${width}:${height}:${x}:${y}`);
            }

            // 重新编码为通用格式（滤镜存在时无法直接复制流）
            args.push(
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-crf', '18',
                '-an',
                outputPath
            );

            // 打印 FFmpeg 预处理命令
            const ffmpegCmd = `ffmpeg ${args.join(' ')}`;
            this.log(`FFmpeg 预处理命令: ${ffmpegCmd}`);

            const proc = spawn('ffmpeg', args, {
                shell: true,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stderr = '';
            proc.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve({
                        success: true,
                        inputPath,
                        outputPath
                    });
                } else {
                    resolve({
                        success: false,
                        inputPath,
                        outputPath,
                        error: `FFmpeg preprocessing failed: ${this.parseFFmpegError(stderr)}`
                    });
                }
            });

            proc.on('error', (err) => {
                resolve({
                    success: false,
                    inputPath,
                    outputPath,
                    error: `FFmpeg process error: ${err.message}`
                });
            });
        });
    }

    /**
     * 解析 FFmpeg 错误信息
     */
    private parseFFmpegError(stderr: string): string {
        if (!stderr) return 'Unknown error';
        const lines = stderr.trim().split('\n');
        return lines.slice(-3).join('\n');
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
