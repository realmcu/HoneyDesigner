/**
 * VideoCropper - Standalone video cropping pre-processor
 *
 * Provides an independent API for cropping a video before it is passed to the
 * conversion pipeline. VideoCropper is intentionally decoupled from the
 * conversion logic so it can be called and tested in isolation.
 *
 * @example
 * ```typescript
 * import { VideoCropper } from './preprocess/index';
 *
 * const cropper = new VideoCropper();
 *
 * // Crop to 640×360, centered
 * await cropper.crop('input.mp4', 'cropped.mp4', { width: 640, height: 360 });
 *
 * // Crop to 640×360 starting at pixel (100, 50)
 * await cropper.crop('input.mp4', 'cropped.mp4', { width: 640, height: 360, x: 100, y: 50 });
 * ```
 */

import { FFmpegBuilder } from '../ffmpeg-builder';
import { FFmpegExecutor } from '../ffmpeg-executor';
import { VideoParser } from '../parser';
import { ProgressCallback, CropOptions } from '../models';
import { VideoConverterError } from '../errors';

/**
 * VideoCropper — pre-processor that crops a video using FFmpeg's crop filter.
 *
 * This class is a standalone unit: it owns its own FFmpegBuilder, FFmpegExecutor,
 * and VideoParser instances and does not share state with VideoConverter.
 */
export class VideoCropper {
  private builder: FFmpegBuilder;
  private executor: FFmpegExecutor;
  private parser: VideoParser;

  /**
   * Create a new VideoCropper.
   * @param progressCallback - Optional callback for progress reporting during cropping.
   */
  constructor(progressCallback?: ProgressCallback) {
    this.builder = new FFmpegBuilder();
    this.executor = new FFmpegExecutor(progressCallback);
    this.parser = new VideoParser();
  }

  /**
   * Crop a video to the specified region.
   *
   * Both `width` and `height` are required. The optional `x` and `y` parameters
   * specify the top-left corner of the crop region; when omitted the region is
   * automatically centered in the source frame by FFmpeg.
   *
   * The output is encoded with libx264 at CRF 18 (near-lossless quality) for
   * maximum compatibility as an intermediate file.
   *
   * @param inputPath  - Path to the input video file.
   * @param outputPath - Path for the cropped output file (recommend `.mp4`).
   * @param options    - Crop dimensions and optional position in pixels.
   * @throws VideoConverterError if width or height is missing, non-integer, or ≤ 0,
   *   or if x/y is a non-integer or negative number.
   * @throws FFmpegNotFoundError if FFmpeg is not installed.
   * @throws FFmpegError if FFmpeg execution fails.
   */
  async crop(
    inputPath: string,
    outputPath: string,
    options: CropOptions
  ): Promise<void> {
    const { width, height, x, y } = options;

    if (!Number.isInteger(width) || width <= 0) {
      throw new VideoConverterError(
        `Crop width must be a positive integer, got: ${width}`
      );
    }
    if (!Number.isInteger(height) || height <= 0) {
      throw new VideoConverterError(
        `Crop height must be a positive integer, got: ${height}`
      );
    }
    if (x !== undefined && (!Number.isInteger(x) || x < 0)) {
      throw new VideoConverterError(
        `Crop x must be a non-negative integer, got: ${x}`
      );
    }
    if (y !== undefined && (!Number.isInteger(y) || y < 0)) {
      throw new VideoConverterError(
        `Crop y must be a non-negative integer, got: ${y}`
      );
    }

    const videoInfo = await this.parser.parse(inputPath);
    const cmd = this.builder.buildCropCmd(inputPath, outputPath, options);
    await this.executor.execute(cmd, videoInfo.frameCount);
  }
}
