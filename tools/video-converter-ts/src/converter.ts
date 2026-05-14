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
  ConversionOptions
} from './models';
import { VideoConverterError, FFmpegNotFoundError } from './errors';
import { VideoParser } from './parser';
import { FFmpegBuilder } from './ffmpeg-builder';
import { FFmpegExecutor } from './ffmpeg-executor';
import { MjpegPacker, AviAligner, H264Packer } from './postprocess/index';
import { VideoScaler } from './preprocess/index';

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
   * If `options.scale` is provided, the input video is first scaled by
   * {@link VideoScaler} (a pre-processing step decoupled from conversion),
   * then the scaled intermediate file is used as the conversion input.
   *
   * In `debug` mode the scaled intermediate file is kept next to the output
   * file (e.g. `output.pre-scaled.mp4`); otherwise it is deleted after the
   * conversion completes.
   *
   * @param inputPath - Path to input video file
   * @param outputPath - Path to output file
   * @param outputFormat - Target output format
   * @param options - Conversion options (frameRate, quality, debug, scale)
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
    let tempScaledPath: string | null = null;

    try {
      // ── Pre-processing: scale ──────────────────────────────────────────
      if (options.scale) {
        if (debug) {
          // Place the scaled file next to the output for easy inspection
          const baseName = path.basename(outputPath, path.extname(outputPath));
          const outputDir = path.dirname(outputPath);
          tempScaledPath = path.join(outputDir, `${baseName}.pre-scaled.mp4`);
        } else {
          tempScaledPath = path.join(os.tmpdir(), `pre-scaled-${Date.now()}.mp4`);
        }

        const scaler = new VideoScaler(this.progressCallback);
        await scaler.scale(inputPath, tempScaledPath, options.scale);

        if (debug) {
          console.log(`[DEBUG] Scaled video saved: ${tempScaledPath}`);
        }

        actualInputPath = tempScaledPath;
      }

      // ── Video info (from actual input, may be the scaled file) ─────────
      const videoInfo = await this.getVideoInfo(actualInputPath);

      const targetFps = options.frameRate ?? videoInfo.frameRate;
      const quality = options.quality ?? (outputFormat === OutputFormat.H264 ? 23 : 1);

      // ── Conversion ────────────────────────────────────────────────────
      const convResult = await this.runConversion(
        actualInputPath, outputPath, outputFormat, videoInfo, targetFps, quality, debug
      );

      // Always report the *original* inputPath in the result, not the temp
      // scaled file path, so callers see the path they originally provided.
      return { ...convResult, inputPath };

    } catch (error) {
      if (error instanceof VideoConverterError || error instanceof FFmpegNotFoundError) {
        throw error;
      }
      throw new VideoConverterError(`Conversion failed: ${error}`);
    } finally {
      // Clean up the scaled intermediate file unless debug mode is active
      if (tempScaledPath && !debug && fs.existsSync(tempScaledPath)) {
        fs.unlinkSync(tempScaledPath);
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
    debug: boolean
  ): Promise<ConversionResult> {
    switch (outputFormat) {
      case OutputFormat.MJPEG:
        return this.convertToMjpeg(inputPath, outputPath, videoInfo, targetFps, quality);
      case OutputFormat.AVI_MJPEG:
        return this.convertToAviMjpeg(inputPath, outputPath, videoInfo, targetFps, quality, debug);
      case OutputFormat.H264:
        return this.convertToH264(inputPath, outputPath, videoInfo, targetFps, quality);
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
    quality: number
  ): Promise<ConversionResult> {
    // Create temp directory for JPEG frames
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjpeg_frames_'));
    
    try {
      // Build FFmpeg command
      const cmd = this.builder.buildMjpegFramesCmd(inputPath, tempDir, targetFps, quality);
      
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
    debug: boolean = false
  ): Promise<ConversionResult> {
    // Create temp AVI file
    const tempAvi = debug 
      ? outputPath.replace(/\.avi$/i, '.ffmpeg.avi')
      : outputPath + '.temp.avi';
    
    try {
      // Build FFmpeg command
      const cmd = this.builder.buildAviCmd(inputPath, tempAvi, targetFps, quality);
      
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
   * Convert to H264 format
   */
  private async convertToH264(
    inputPath: string,
    outputPath: string,
    videoInfo: VideoInfo,
    targetFps: number,
    crf: number
  ): Promise<ConversionResult> {
    // Create temp H264 file
    const tempH264 = outputPath + '.temp.h264';
    
    try {
      // Build FFmpeg command
      const cmd = this.builder.buildH264Cmd(inputPath, tempH264, targetFps, crf);
      
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
