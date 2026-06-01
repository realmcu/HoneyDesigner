/**
 * VideoConverter - Main video conversion orchestrator
 * 
 * This module provides the main VideoConverter class that coordinates
 * video parsing, FFmpeg conversion, and post-processing for different
 * output formats (MJPEG, AVI-MJPEG, H264).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  VideoInfo,
  ConversionResult,
  OutputFormat,
  ProgressCallback,
  ConversionOptions,
  PreprocessStep
} from './models';
import { VideoConverterError, FFmpegNotFoundError } from './errors';
import { VideoParser } from './parser';
import { FFmpegBuilder } from './ffmpeg-builder';
import { FFmpegExecutor } from './ffmpeg-executor';
import { MjpegPacker, AviAligner, H264Packer } from './postprocess/index';
import { VideoScaler, VideoCropper } from './preprocess/index';

/**
 * VideoConverter class - Main entry point for video conversion
 * 
 * Usage:
 * ```typescript
 * const converter = new VideoConverter((current, total) => {
 *   console.log(`Progress: ${current}/${total}`);
 * });
 * 
 * const info = await converter.getVideoInfo('input.mp4');
 * const result = await converter.convert('input.mp4', 'output.mjpeg', OutputFormat.MJPEG);
 * ```
 */
export class VideoConverter {
  private parser: VideoParser;
  private builder: FFmpegBuilder;
  private executor: FFmpegExecutor;
  private progressCallback?: ProgressCallback;

  /**
   * Create a new VideoConverter
   * @param progressCallback - Optional callback for progress reporting
   */
  constructor(progressCallback?: ProgressCallback) {
    this.progressCallback = progressCallback;
    this.parser = new VideoParser();
    this.builder = new FFmpegBuilder();
    this.executor = new FFmpegExecutor(progressCallback);
  }

  /**
   * Get video information
   * @param inputPath - Path to input video file
   * @returns Promise<VideoInfo> - Video metadata
   */
  async getVideoInfo(inputPath: string): Promise<VideoInfo> {
    return this.parser.parse(inputPath);
  }

  /**
   * Convert video to specified format
   *
   * When `options.preprocess` is provided, each step is executed in order
   * before the main conversion — the output of each step becomes the input for
   * the next. When only `options.scale` is provided (v1.1 shorthand), it is
   * wrapped into a single-element preprocess array for backward compatibility.
   *
   * In `debug` mode all intermediate files are kept next to the output file
   * (e.g. `output.pre-1-scale.mp4`, `output.pre-2-crop.mp4`); otherwise they
   * are deleted in a `finally` block even when conversion throws.
   *
   * @param inputPath - Path to input video file
   * @param outputPath - Path to output file
   * @param outputFormat - Target output format
   * @param options - Conversion options (frameRate, quality, debug, preprocess, scale)
   * @returns Promise<ConversionResult> - Conversion result
   */
  async convert(
    inputPath: string,
    outputPath: string,
    outputFormat: OutputFormat,
    options: ConversionOptions = {}
  ): Promise<ConversionResult> {
    const debug = options.debug ?? false;
    let actualInputPath = inputPath;
    const tempPaths: string[] = [];

    // Normalise: preprocess[] takes precedence; scale? is a shorthand alias
    const preprocessSteps: PreprocessStep[] =
      options.preprocess && options.preprocess.length > 0
        ? options.preprocess
        : options.scale
          ? [{ type: 'scale', options: options.scale }]
          : [];

    try {
      // ── Pre-processing pipeline ─────────────────────────────────────────
      for (const [i, step] of preprocessSteps.entries()) {
        let tempPath: string;

        if (debug) {
          const baseName = path.basename(outputPath, path.extname(outputPath));
          const outputDir  = path.dirname(outputPath);
          tempPath = path.join(outputDir, `${baseName}.pre-${i + 1}-${step.type}.mp4`);
        } else {
          tempPath = path.join(os.tmpdir(), `pre-${step.type}-${Date.now()}-${i}.mp4`);
        }

        if (step.type === 'scale') {
          const scaler = new VideoScaler(this.progressCallback);
          await scaler.scale(actualInputPath, tempPath, step.options);
        } else {
          const cropper = new VideoCropper(this.progressCallback);
          await cropper.crop(actualInputPath, tempPath, step.options);
        }

        if (debug) {
          console.log(`[DEBUG] Preprocess step ${i + 1} (${step.type}) saved: ${tempPath}`);
        }

        tempPaths.push(tempPath);
        actualInputPath = tempPath;
      }

      // ── Video info (from actual input, may be a preprocessed file) ──────
      const videoInfo = await this.getVideoInfo(actualInputPath);

      const targetFps = options.frameRate ?? videoInfo.frameRate;
      const quality = options.quality ?? (outputFormat === OutputFormat.H264 ? 23 : 1);

      // ── Conversion ────────────────────────────────────────────────────
      const convResult = await this.runConversion(
        actualInputPath, outputPath, outputFormat, videoInfo, targetFps, quality, debug,
        options.backgroundColor
      );

      // Always report the *original* inputPath in the result, not a temp path
      return { ...convResult, inputPath };

    } catch (error) {
      if (error instanceof VideoConverterError || error instanceof FFmpegNotFoundError) {
        throw error;
      }
      throw new VideoConverterError(`Conversion failed: ${error}`);
    } finally {
      // Clean up all preprocess intermediates unless debug mode is active
      if (!debug) {
        for (const p of tempPaths) {
          if (fs.existsSync(p)) {
            fs.unlinkSync(p);
          }
        }
      }
    }
  }

  /**
   * Dispatch conversion to the appropriate format-specific handler.
   */
  private async runConversion(
    inputPath: string,
    outputPath: string,
    outputFormat: OutputFormat,
    videoInfo: VideoInfo,
    targetFps: number,
    quality: number,
    debug: boolean,
    backgroundColor?: string
  ): Promise<ConversionResult> {
    switch (outputFormat) {
      case OutputFormat.MJPEG:
        return this.convertToMjpeg(inputPath, outputPath, videoInfo, targetFps, quality, backgroundColor);
      case OutputFormat.AVI_MJPEG:
        return this.convertToAviMjpeg(inputPath, outputPath, videoInfo, targetFps, quality, debug, backgroundColor);
      case OutputFormat.AVI_MSV1:
        return this.convertToAviMsv1(inputPath, outputPath, videoInfo, targetFps, quality, backgroundColor);
      case OutputFormat.AVI_CINEPAK:
        return this.convertToAviCinepak(inputPath, outputPath, videoInfo, targetFps, quality, backgroundColor);
      case OutputFormat.H264:
        return this.convertToH264(inputPath, outputPath, videoInfo, targetFps, quality, backgroundColor);
      default:
        throw new VideoConverterError(`Unsupported output format: ${outputFormat}`);
    }
  }


  /**
   * Convert to MJPEG format
   */
  private async convertToMjpeg(
    inputPath: string,
    outputPath: string,
    videoInfo: VideoInfo,
    targetFps: number,
    quality: number,
    backgroundColor?: string
  ): Promise<ConversionResult> {
    // Create temp directory for JPEG frames
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjpeg_frames_'));
    
    try {
      // Build FFmpeg command
      const cmd = this.builder.buildMjpegFramesCmd(inputPath, tempDir, targetFps, quality, backgroundColor);
      
      // Execute FFmpeg
      await this.executor.execute(cmd, videoInfo.frameCount);
      
      // Count actual frames
      const frameFiles = fs.readdirSync(tempDir).filter(f => f.endsWith('.jpg'));
      const frameCount = frameFiles.length;
      
      // Pack frames into MJPEG
      const packer = new MjpegPacker();
      await packer.pack(tempDir, outputPath);
      
      return {
        success: true,
        inputPath,
        outputPath,
        outputFormat: OutputFormat.MJPEG,
        frameCount,
        frameRate: targetFps,
        quality
      };
    } finally {
      // Clean up temp directory
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true });
      }
    }
  }

  /**
   * Convert to AVI-MJPEG format
   */
  private async convertToAviMjpeg(
    inputPath: string,
    outputPath: string,
    videoInfo: VideoInfo,
    targetFps: number,
    quality: number,
    debug: boolean = false,
    backgroundColor?: string
  ): Promise<ConversionResult> {
    // Create temp AVI file
    const tempAvi = debug 
      ? outputPath.replace(/\.avi$/i, '.ffmpeg.avi')
      : outputPath + '.temp.avi';
    
    try {
      // Build FFmpeg command
      const cmd = this.builder.buildAviCmd(inputPath, tempAvi, targetFps, quality, backgroundColor);
      
      // Execute FFmpeg
      await this.executor.execute(cmd, videoInfo.frameCount);
      
      if (debug) {
        console.log(`[DEBUG] FFmpeg output saved: ${tempAvi}`);
      }
      
      // Align AVI frames
      const aligner = new AviAligner();
      await aligner.process(tempAvi, outputPath, debug);
      
      return {
        success: true,
        inputPath,
        outputPath,
        outputFormat: OutputFormat.AVI_MJPEG,
        frameCount: videoInfo.frameCount,
        frameRate: targetFps,
        quality
      };
    } finally {
      // Clean up temp file only if not in debug mode
      if (!debug && fs.existsSync(tempAvi)) {
        fs.unlinkSync(tempAvi);
      }
    }
  }

  /**
   * Convert to AVI-MSV1 format (Microsoft Video 1 / CRAM codec)
   *
   * No post-processing: AviAligner is JPEG-specific and cannot be applied
   * to MSV1 (RGB) frame data. FFmpeg output is the final file.
   */
  private async convertToAviMsv1(
    inputPath: string,
    outputPath: string,
    videoInfo: VideoInfo,
    targetFps: number,
    quality: number,
    backgroundColor?: string
  ): Promise<ConversionResult> {
    const cmd = this.builder.buildAviMsv1Cmd(inputPath, outputPath, targetFps, quality, backgroundColor);
    await this.executor.execute(cmd, videoInfo.frameCount);
    return {
      success: true,
      inputPath,
      outputPath,
      outputFormat: OutputFormat.AVI_MSV1,
      frameCount: videoInfo.frameCount,
      frameRate: targetFps,
      quality
    };
  }

  /**
   * Convert to AVI-Cinepak format
   *
   * No post-processing: AviAligner is JPEG-specific and cannot be applied
   * to Cinepak (RGB) frame data. FFmpeg output is the final file.
   */
  private async convertToAviCinepak(
    inputPath: string,
    outputPath: string,
    videoInfo: VideoInfo,
    targetFps: number,
    quality: number,
    backgroundColor?: string
  ): Promise<ConversionResult> {
    const cmd = this.builder.buildAviCinepakCmd(inputPath, outputPath, targetFps, quality, backgroundColor);
    await this.executor.execute(cmd, videoInfo.frameCount);
    return {
      success: true,
      inputPath,
      outputPath,
      outputFormat: OutputFormat.AVI_CINEPAK,
      frameCount: videoInfo.frameCount,
      frameRate: targetFps,
      quality
    };
  }

  /**
   * Convert to H264 format
   */
  private async convertToH264(
    inputPath: string,
    outputPath: string,
    videoInfo: VideoInfo,
    targetFps: number,
    crf: number,
    backgroundColor?: string
  ): Promise<ConversionResult> {
    // Create temp H264 file
    const tempH264 = outputPath + '.temp.h264';
    
    try {
      // Build FFmpeg command
      const cmd = this.builder.buildH264Cmd(inputPath, tempH264, targetFps, crf, backgroundColor);
      
      // Execute FFmpeg
      await this.executor.execute(cmd, videoInfo.frameCount);
      
      // Add header to H264
      const packer = new H264Packer();
      await packer.pack(tempH264, outputPath, targetFps);
      
      return {
        success: true,
        inputPath,
        outputPath,
        outputFormat: OutputFormat.H264,
        frameCount: videoInfo.frameCount,
        frameRate: targetFps,
        quality: crf
      };
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempH264)) {
        fs.unlinkSync(tempH264);
      }
    }
  }
}
