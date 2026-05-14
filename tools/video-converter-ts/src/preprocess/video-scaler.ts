/**
 * VideoScaler - Standalone video scaling pre-processor
 *
 * Provides an independent API for resizing a video before it is passed to the
 * conversion pipeline. VideoScaler is intentionally decoupled from the
 * conversion logic so it can be called and tested in isolation.
 *
 * @example
 * ```typescript
 * import { VideoScaler } from './preprocess/index';
 *
 * const scaler = new VideoScaler();
 *
 * // Scale to 1280 wide, maintain aspect ratio
 * await scaler.scale('input.mp4', 'scaled.mp4', { width: 1280 });
 *
 * // Scale to exact dimensions
 * await scaler.scale('input.mp4', 'scaled.mp4', { width: 1280, height: 720 });
 * ```
 */

import { FFmpegBuilder } from '../ffmpeg-builder';
import { FFmpegExecutor } from '../ffmpeg-executor';
import { VideoParser } from '../parser';
import { ProgressCallback, ScaleOptions } from '../models';
import { VideoConverterError } from '../errors';

/**
 * VideoScaler — pre-processor that resizes a video using FFmpeg's scale filter.
 *
 * This class is a standalone unit: it owns its own FFmpegBuilder, FFmpegExecutor,
 * and VideoParser instances and does not share state with VideoConverter.
 */
export class VideoScaler {
  private builder: FFmpegBuilder;
  private executor: FFmpegExecutor;
  private parser: VideoParser;

  /**
   * Create a new VideoScaler.
   * @param progressCallback - Optional callback for progress reporting during scaling.
   */
  constructor(progressCallback?: ProgressCallback) {
    this.builder = new FFmpegBuilder();
    this.executor = new FFmpegExecutor(progressCallback);
    this.parser = new VideoParser();
  }

  /**
   * Scale (resize) a video to the specified dimensions.
   *
   * At least one of `width` or `height` must be provided.
   * When only one dimension is given, the other is auto-calculated to maintain
   * the original aspect ratio (rounded to the nearest even number so the output
   * is compatible with all common video codecs).
   *
   * The output is encoded with libx264 at CRF 18 (near-lossless quality) for
   * maximum compatibility as an intermediate file.
   *
   * @param inputPath  - Path to the input video file.
   * @param outputPath - Path for the scaled output file (recommend `.mp4`).
   * @param options    - Scale dimensions in pixels.
   * @throws VideoConverterError if neither width nor height is provided, or if
   *   either dimension is not a positive integer.
   * @throws FFmpegNotFoundError if FFmpeg is not installed.
   * @throws FFmpegError if FFmpeg execution fails.
   */
  async scale(
    inputPath: string,
    outputPath: string,
    options: ScaleOptions
  ): Promise<void> {
    if (options.width === undefined && options.height === undefined) {
      throw new VideoConverterError(
        'At least one of width or height must be specified for scaling'
      );
    }
    if (options.width !== undefined && (!Number.isInteger(options.width) || options.width <= 0)) {
      throw new VideoConverterError(
        `Scale width must be a positive integer, got: ${options.width}`
      );
    }
    if (options.height !== undefined && (!Number.isInteger(options.height) || options.height <= 0)) {
      throw new VideoConverterError(
        `Scale height must be a positive integer, got: ${options.height}`
      );
    }

    const videoInfo = await this.parser.parse(inputPath);
    const cmd = this.builder.buildScaleCmd(inputPath, outputPath, options);
    await this.executor.execute(cmd, videoInfo.frameCount);
  }
}
