/**
 * Video Converter TypeScript
 * 
 * A video converter supporting MJPEG, AVI-MJPEG, and H264 output formats
 * with 8-byte alignment post-processing.
 * 
 * @example
 * ```typescript
 * import { VideoConverter, OutputFormat } from 'video-converter-ts';
 * 
 * const converter = new VideoConverter((current, total) => {
 *   console.log(`Progress: ${current}/${total}`);
 * });
 * 
 * // Get video info
 * const info = await converter.getVideoInfo('input.mp4');
 * console.log(`Resolution: ${info.width}x${info.height}`);
 * 
 * // Convert to MJPEG
 * const result = await converter.convert(
 *   'input.mp4',
 *   'output.mjpeg',
 *   OutputFormat.MJPEG,
 *   { quality: 1 }
 * );
 * ```
 */

// Main converter class
export { VideoConverter } from './converter';

// Data models
export {
  OutputFormat,
  VideoInfo,
  ConversionResult,
  ProgressCallback,
  ConversionOptions,
  ScaleOptions,
  CropOptions,
  PreprocessStep
} from './models';

// Error classes
export {
  VideoConverterError,
  VideoFormatError,
  FFmpegNotFoundError,
  FFmpegError,
  PostProcessError
} from './errors';

// Parser (for advanced usage)
export { VideoParser } from './parser';

// FFmpeg utilities (for advanced usage)
export { FFmpegBuilder } from './ffmpeg-builder';
export { FFmpegExecutor } from './ffmpeg-executor';

// Post-processors (for advanced usage)
export { MjpegPacker, AviAligner, H264Packer, BitReader } from './postprocess/index';

// Pre-processors (for advanced usage)
export { VideoScaler, VideoCropper } from './preprocess/index';
