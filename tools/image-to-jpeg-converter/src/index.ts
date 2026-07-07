/**
 * Image to JPEG Converter - Public API
 * 
 * A TypeScript library for converting images to JPEG format with custom binary headers
 * for embedded display systems. Uses FFmpeg for image conversion and provides both
 * programmatic API and CLI interface.
 * 
 * @module image-to-jpeg-converter
 * @see Requirements 11.2, 11.5, 11.6
 * 
 * @example
 * ```typescript
 * import { convertToJpeg, SamplingFactor, ResizeOption } from 'image-to-jpeg-converter';
 * 
 * // Basic conversion
 * const result = await convertToJpeg({
 *   inputPath: 'input.png',
 *   outputPath: 'output.jpg',
 *   samplingFactor: SamplingFactor.YUV420,
 *   quality: 10
 * });
 * 
 * console.log(`Converted: ${result.dimensions.width}x${result.dimensions.height}`);
 * ```
 */

import { Converter } from './converter.js';

// Re-export all types and interfaces
export type {
  ConversionConfig,
  ConversionResult,
  ConversionError,
  ConversionErrorType,
  RgbDataHeader,
  JpegFileHeader,
} from './types.js';

// Re-export enums
export { SamplingFactor, ResizeOption } from './types.js';

/**
 * Converts an image to JPEG format with custom binary header.
 * 
 * This is the main entry point for the library. It orchestrates the complete
 * conversion pipeline:
 * 1. Validates input configuration (file existence, quality range, etc.)
 * 2. Converts image to JPEG using FFmpeg with specified sampling and quality
 * 3. Generates custom binary header with image metadata
 * 4. Combines header and JPEG data into output file
 * 5. Cleans up temporary files
 * 
 * The function ensures atomic output creation - the output file is only created
 * on complete success. All temporary files are cleaned up on both success and error.
 * 
 * **Requirements:**
 * - FFmpeg must be installed and available in system PATH
 * - Input file must exist and be a valid image format supported by FFmpeg
 * - Output path must be writable
 * - Quality must be in range 1-31 (lower is higher quality)
 * - Sampling factor must be 400, 420, 422, or 444
 * 
 * **Binary Header Structure:**
 * 
 * The output file contains a 16-byte custom header followed by JPEG data:
 * - Bytes 0-7: RGB data header (image metadata and flags)
 * - Bytes 8-11: JPEG data size (uint32, little-endian, from 0xFFD8 marker)
 * - Bytes 12-15: Dummy field for alignment (uint32, always 0)
 * - Bytes 16+: JPEG data (starting with 0xFFD8 SOI marker)
 * 
 * @param config - Conversion configuration with input/output paths and parameters
 * @returns Promise resolving to ConversionResult on success
 * @throws ConversionError on validation, FFmpeg, header generation, or I/O errors
 * 
 * @example
 * ```typescript
 * // Basic conversion with 4:2:0 sampling
 * const result = await convertToJpeg({
 *   inputPath: 'photo.png',
 *   outputPath: 'photo.jpg',
 *   samplingFactor: SamplingFactor.YUV420,
 *   quality: 10
 * });
 * ```
 * 
 * @example
 * ```typescript
 * // Grayscale conversion
 * const result = await convertToJpeg({
 *   inputPath: 'image.bmp',
 *   outputPath: 'image.jpg',
 *   samplingFactor: SamplingFactor.Grayscale,
 *   quality: 15
 * });
 * ```
 * 
 * @example
 * ```typescript
 * // High quality conversion with resize
 * const result = await convertToJpeg({
 *   inputPath: 'large.tiff',
 *   outputPath: 'small.jpg',
 *   samplingFactor: SamplingFactor.YUV444,
 *   quality: 2,
 *   resize: ResizeOption.Fifty,
 *   compress: true
 * });
 * ```
 * 
 * @example
 * ```typescript
 * // Error handling
 * try {
 *   const result = await convertToJpeg({
 *     inputPath: 'input.png',
 *     outputPath: 'output.jpg',
 *     samplingFactor: SamplingFactor.YUV422,
 *     quality: 5
 *   });
 *   console.log(`Success: ${result.outputPath}`);
 *   console.log(`Size: ${result.jpegSize} bytes`);
 *   console.log(`Dimensions: ${result.dimensions.width}x${result.dimensions.height}`);
 * } catch (error) {
 *   const convError = error as ConversionError;
 *   if (convError.type === 'validation') {
 *     console.error('Invalid input:', convError.message);
 *   } else if (convError.type === 'ffmpeg') {
 *     console.error('FFmpeg error:', convError.details);
 *   } else if (convError.type === 'io') {
 *     console.error('File I/O error:', convError.message);
 *   } else if (convError.type === 'header') {
 *     console.error('Header generation error:', convError.message);
 *   }
 * }
 * ```
 * 
 * @see Requirements 1.1, 1.2, 11.2, 11.6
 */
export async function convertToJpeg(
  config: import('./types.js').ConversionConfig
): Promise<import('./types.js').ConversionResult> {
  const converter = new Converter();
  return converter.convert(config);
}

/**
 * Default export for convenience.
 * 
 * @example
 * ```typescript
 * import convertToJpeg from 'image-to-jpeg-converter';
 * 
 * const result = await convertToJpeg({
 *   inputPath: 'input.png',
 *   outputPath: 'output.jpg',
 *   samplingFactor: 420,
 *   quality: 10
 * });
 * ```
 */
export default convertToJpeg;
