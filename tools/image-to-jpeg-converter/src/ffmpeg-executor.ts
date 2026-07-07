/**
 * FFmpeg executor module for the Image to JPEG Converter.
 * 
 * Handles FFmpeg command construction and execution for converting images
 * to JPEG format with specific sampling factors and quality settings.
 * 
 * @module ffmpeg-executor
 * @see Requirements 1.1, 1.2, 2.1, 7.1-7.5
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import { ConversionConfig, SamplingFactor } from './types.js';

/**
 * Result of FFmpeg execution.
 * Contains the JPEG data buffer and metadata about the conversion.
 */
export interface FFmpegResult {
  /** JPEG data buffer (including 0xFFD8 SOI marker) */
  jpegData: Buffer;
  /** Path to the temporary output file */
  outputPath: string;
}

/**
 * Error information for FFmpeg execution failures.
 */
export interface FFmpegError {
  /** Error message describing what went wrong */
  message: string;
  /** FFmpeg exit code (if process completed) */
  exitCode?: number;
  /** FFmpeg stderr output */
  stderr?: string;
  /** FFmpeg stdout output */
  stdout?: string;
}

/**
 * FFmpeg executor for image to JPEG conversion.
 * 
 * Constructs and executes FFmpeg commands with appropriate parameters
 * for different sampling factors and quality settings. Handles process
 * execution, output capture, and error reporting.
 * 
 * Sampling factor to pixel format mapping:
 * - 400 (Grayscale) → gray
 * - 420 (YUV420) → yuvj420p
 * - 422 (YUV422) → yuvj422p
 * - 444 (YUV444) → yuvj444p
 * 
 * @see Requirements 1.1, 1.2, 2.1, 7.1-7.5
 */
export class FFmpegExecutor {
  /**
   * Converts an image to JPEG format using FFmpeg.
   * 
   * Executes FFmpeg with the specified configuration and writes the output
   * to a temporary file. Captures stdout, stderr, and exit code for error
   * reporting.
   * 
   * @param config - Conversion configuration with input path, sampling factor, and quality
   * @param tempOutputPath - Path where FFmpeg should write the output JPEG file
   * @param alignTo - Optional coded (SOF) target size. When provided, a `pad`
   *   filter is inserted so the encoded JPEG and its SOF marker use these
   *   dimensions. The target may be non-MCU (min padding with `align` off) or
   *   MCU-aligned (`align` on) — this method just pads to whatever it is given.
   * @returns Promise resolving to FFmpegResult with JPEG data, or rejecting with FFmpegError
   * 
   * @example
   * ```typescript
   * const executor = new FFmpegExecutor();
   * try {
   *   const result = await executor.convert(config, '/tmp/output.jpg');
   *   console.log(`Converted: ${result.jpegData.length} bytes`);
   * } catch (error) {
   *   console.error(`FFmpeg error: ${error.message}`);
   * }
   * ```
   * 
   * @see Requirements 1.1, 7.1, 7.2, 7.3, 7.4, 7.5
   */
  async convert(
    config: ConversionConfig,
    tempOutputPath: string,
    alignTo?: { width: number; height: number }
  ): Promise<FFmpegResult> {
    // Build FFmpeg command (Requirement 7.1)
    const command = this.buildCommand(config, tempOutputPath, alignTo);

    try {
      // Execute FFmpeg process (Requirement 7.2)
      await this.executeFFmpeg(command);

      // Validate output file exists (Requirement 7.5). FFmpeg has reported
      // exit 0, but on Windows the file it just wrote can briefly be invisible
      // to this process (filesystem flush lag, pronounced under parallel I/O).
      // Retry for a short bounded window before declaring failure so a
      // successful conversion is not misreported as "output not created".
      if (!(await this.waitForFile(tempOutputPath))) {
        throw {
          message: `FFmpeg completed but output file was not created: ${tempOutputPath}`,
          exitCode: 0,
        } as FFmpegError;
      }

      // Read the JPEG data
      const jpegData = fs.readFileSync(tempOutputPath);

      // Verify JPEG data starts with 0xFFD8 marker
      if (jpegData.length < 2 || jpegData[0] !== 0xff || jpegData[1] !== 0xd8) {
        throw {
          message: 'Output file does not contain valid JPEG data (missing 0xFFD8 SOI marker)',
        } as FFmpegError;
      }

      return {
        jpegData,
        outputPath: tempOutputPath,
      };
    } catch (error) {
      // Re-throw FFmpegError as-is
      if (this.isFFmpegError(error)) {
        throw error;
      }

      // Wrap other errors
      throw {
        message: `FFmpeg execution failed: ${error instanceof Error ? error.message : String(error)}`,
      } as FFmpegError;
    }
  }

  /**
   * Waits briefly for a file to become visible on disk.
   *
   * FFmpeg signals completion via its process `close` event, but on Windows the
   * output file it just wrote can lag a few milliseconds before `fs.existsSync`
   * sees it — especially when many conversions run in parallel. This polls a
   * bounded number of times so a genuinely successful conversion is not
   * misreported as "output file was not created". The common case (file already
   * present) returns immediately on the first check with no delay.
   *
   * @param filePath - Path to wait for
   * @param attempts - Maximum number of checks (default 20)
   * @param delayMs - Delay between checks in milliseconds (default 25 → ~500ms budget)
   * @returns Promise resolving to true if the file appeared within the budget
   */
  private async waitForFile(
    filePath: string,
    attempts = 20,
    delayMs = 25
  ): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
      if (fs.existsSync(filePath)) {
        return true;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
    return fs.existsSync(filePath);
  }

  /**
   * Reads the original pixel dimensions of an input image using ffprobe.
   *
   * Used when MCU alignment is enabled: the JPEG gets padded to aligned
   * dimensions, so the ORIGINAL size (needed for the GUI header) must be read
   * from the source rather than from the padded JPEG SOF marker. Requires
   * ffprobe, which ships with FFmpeg.
   *
   * @param inputPath - Path to the input image file
   * @returns Promise resolving to the original { width, height }
   * @throws FFmpegError if ffprobe is missing, exits non-zero, or output is unparseable
   */
  async probeDimensions(
    inputPath: string
  ): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'csv=p=0:s=x',
        inputPath,
      ];

      const ffprobeProcess = spawn('ffprobe', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      ffprobeProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      ffprobeProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      ffprobeProcess.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          reject({
            message:
              'ffprobe is not installed or not found in PATH. It is required when align=true and ships with FFmpeg.',
            stderr: error.message,
          } as FFmpegError);
        } else {
          reject({
            message: `Failed to execute ffprobe: ${error.message}`,
            stderr: error.message,
          } as FFmpegError);
        }
      });

      ffprobeProcess.on('close', (exitCode: number | null) => {
        if (exitCode !== 0) {
          reject({
            message: `ffprobe exited with code ${exitCode ?? 'unknown'}`,
            exitCode: exitCode ?? undefined,
            stderr,
          } as FFmpegError);
          return;
        }

        // Output looks like "686x686" (first video stream, width x height).
        const match = /^(\d+)x(\d+)/.exec(stdout.trim());
        const widthStr = match?.[1];
        const heightStr = match?.[2];
        if (!widthStr || !heightStr) {
          reject({
            message: `Failed to parse ffprobe dimensions from output: "${stdout.trim()}"`,
            stderr,
          } as FFmpegError);
          return;
        }

        resolve({
          width: parseInt(widthStr, 10),
          height: parseInt(heightStr, 10),
        });
      });
    });
  }

  /**
   * Builds the FFmpeg command with appropriate parameters.
   * 
   * Constructs a command array with:
   * - Input file path
   * - Transparency handling (if needed)
   * - Pixel format based on sampling factor
   * - Quality parameter
   * - Output file path
   * - Overwrite flag (-y)
   * 
   * For images with transparency (PNG, etc.), uses a black background by default:
   * ffmpeg -i input.png -f lavfi -i "color=black" -filter_complex "[1:v][0:v]scale2ref[bg][fg];[bg][fg]overlay=format=auto" -c:v mjpeg -pix_fmt yuvj420p -q:v 2 -frames:v 1 output.jpg
   * 
   * Sampling factor to pixel format mapping (Requirement 2.1):
   * - 400 → gray (grayscale)
   * - 420 → yuvj420p (4:2:0 subsampling)
   * - 422 → yuvj422p (4:2:2 subsampling)
   * - 444 → yuvj444p (4:4:4 subsampling, no subsampling)
   * 
   * When `alignTo` is provided, a `pad` filter grows the frame to the given
   * coded (SOF) dimensions with black fill on the right/bottom, so the encoded
   * JPEG's SOF marker reports that size. The target is the caller's computed
   * SOF size — MCU-aligned when `align` is on, or the exact (possibly non-MCU)
   * content size when only `min` padding is in effect.
   *
   * @param config - Conversion configuration
   * @param outputPath - Path where FFmpeg should write the output
   * @param alignTo - Optional coded (SOF) target size to pad the frame up to
   * @returns Array of command arguments for FFmpeg
   * 
   * @example
   * ```typescript
   * const executor = new FFmpegExecutor();
   * const command = executor.buildCommand(config, '/tmp/output.jpg');
   * // Returns: ['ffmpeg', '-i', 'input.png', '-pix_fmt', 'yuvj420p', '-q:v', '10', '-y', '/tmp/output.jpg']
   * ```
   * 
   * @see Requirements 2.1, 7.1, spec_v4.txt transparency handling
   */
  buildCommand(
    config: ConversionConfig,
    outputPath: string,
    alignTo?: { width: number; height: number }
  ): string[] {
    // Map sampling factor to pixel format (Requirement 2.1)
    const pixelFormat = this.getPixelFormat(config.samplingFactor);

    // Get quality value (use provided or default)
    const quality = config.quality ?? this.getDefaultQuality(config.samplingFactor);

    // Build the pad filter when a coded (SOF) target is requested. Padding adds
    // pixels on the right/bottom only (x=0, y=0) so existing content keeps its
    // top-left origin; the extra pixels lie outside the GUI header's reported
    // size. The target may be non-MCU (min padding, `align` off) or MCU-aligned.
    const padFilter = alignTo
      ? `pad=${alignTo.width}:${alignTo.height}:0:0:black`
      : null;

    // Check if input might have transparency (PNG, WEBP, etc.)
    const hasTransparency = this.mightHaveTransparency(config.inputPath);
    
    if (hasTransparency) {
      // Handle transparency with background color (spec_v4.txt)
      const backgroundColor = config.backgroundColor || 'black';

      // Composite the input over the background. When padding, chain the pad
      // filter onto the overlay output and label it '[out]' so it can be mapped.
      const overlay = '[1:v][0:v]scale2ref[bg][fg];[bg][fg]overlay=format=auto';
      const filterComplex = padFilter ? `${overlay},${padFilter}[out]` : overlay;
      
      const command = [
        'ffmpeg',
        '-i', config.inputPath,                    // Input file
        '-f', 'lavfi',                             // Lavfi input for background
        '-i', `color=${backgroundColor}`,          // Background color
        '-filter_complex', filterComplex,          // Composite (+ optional pad) filter
        ...(padFilter ? ['-map', '[out]'] : []),   // Map the labeled pad output
        '-c:v', 'mjpeg',                          // MJPEG codec
        '-pix_fmt', pixelFormat,                  // Pixel format based on sampling factor
        '-q:v', quality.toString(),               // Quality parameter
        '-frames:v', '1',                         // Single frame output
        '-y',                                     // Overwrite output file without asking
        outputPath,                               // Output file
      ];
      
      return command;
    } else {
      // Standard conversion without transparency handling
      const command = [
        'ffmpeg',
        '-i', config.inputPath,           // Input file
        ...(padFilter ? ['-vf', padFilter] : []), // Optional coded-size (SOF) padding
        '-pix_fmt', pixelFormat,          // Pixel format based on sampling factor
        '-q:v', quality.toString(),       // Quality parameter
        '-y',                             // Overwrite output file without asking
        outputPath,                       // Output file
      ];

      return command;
    }
  }

  /**
   * Maps sampling factor to FFmpeg pixel format.
   * 
   * @param samplingFactor - Chroma subsampling factor
   * @returns FFmpeg pixel format string
   * 
   * @see Requirements 2.1, 2.2, 2.3, 2.4, 2.5
   */
  private getPixelFormat(samplingFactor: SamplingFactor): string {
    switch (samplingFactor) {
      case SamplingFactor.Grayscale: // 400
        return 'gray';
      case SamplingFactor.YUV420:    // 420
        return 'yuvj420p';
      case SamplingFactor.YUV422:    // 422
        return 'yuvj422p';
      case SamplingFactor.YUV444:    // 444
        return 'yuvj444p';
      default:
        // This should never happen due to validation, but TypeScript requires it
        throw new Error(`Invalid sampling factor: ${samplingFactor}`);
    }
  }

  /**
   * Gets default quality value for a sampling factor.
   * 
   * Provides reasonable default quality values when not specified:
   * - Grayscale (400): 15 (medium quality)
   * - YUV420 (420): 10 (good quality, most common)
   * - YUV422 (422): 8 (higher quality)
   * - YUV444 (444): 5 (best quality)
   * 
   * @param samplingFactor - Chroma subsampling factor
   * @returns Default quality value (1-31)
   * 
   * @see Requirements 3.4
   */
  private getDefaultQuality(samplingFactor: SamplingFactor): number {
    switch (samplingFactor) {
      case SamplingFactor.Grayscale:
        return 15;
      case SamplingFactor.YUV420:
        return 10;
      case SamplingFactor.YUV422:
        return 8;
      case SamplingFactor.YUV444:
        return 5;
      default:
        return 10; // Fallback default
    }
  }

  /**
   * Checks if the input file might have transparency based on file extension.
   * 
   * PNG, WEBP, and some other formats support transparency and may need
   * background color processing.
   * 
   * @param inputPath - Path to the input image file
   * @returns True if the file format might support transparency
   * 
   * @see spec_v4.txt transparency handling
   */
  private mightHaveTransparency(inputPath: string): boolean {
    const extension = inputPath.toLowerCase().split('.').pop() || '';
    const transparencyFormats = ['png', 'webp', 'gif', 'tiff', 'tif'];
    return transparencyFormats.includes(extension);
  }

  /**
   * Executes FFmpeg command and captures output.
   * 
   * Spawns FFmpeg process, captures stdout and stderr, and waits for completion.
   * Handles various error conditions:
   * - FFmpeg not found (ENOENT)
   * - Non-zero exit code
   * - Process errors
   * 
   * @param command - FFmpeg command array (first element is 'ffmpeg')
   * @returns Promise that resolves when FFmpeg completes successfully
   * @throws FFmpegError if execution fails
   * 
   * @see Requirements 7.2, 7.3, 7.4
   */
  private executeFFmpeg(command: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      // Extract executable and arguments
      const [executable, ...args] = command;

      // Validate executable exists
      if (!executable) {
        reject({
          message: 'FFmpeg command is empty',
          stderr: 'No executable specified',
        } as FFmpegError);
        return;
      }

      // Spawn FFmpeg process
      const ffmpegProcess = spawn(executable, args, {
        stdio: ['ignore', 'pipe', 'pipe'], // stdin ignored, capture stdout and stderr
      });

      let stdout = '';
      let stderr = '';

      // Capture stdout (Requirement 7.2)
      ffmpegProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      // Capture stderr (Requirement 7.2)
      ffmpegProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Handle process errors (Requirement 7.4)
      ffmpegProcess.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          // FFmpeg not found (Requirement 7.4)
          reject({
            message: 'FFmpeg is not installed or not found in PATH. Please install FFmpeg to use this converter.',
            stderr: error.message,
          } as FFmpegError);
        } else {
          reject({
            message: `Failed to execute FFmpeg: ${error.message}`,
            stderr: error.message,
          } as FFmpegError);
        }
      });

      // Handle process exit (Requirement 7.2, 7.3)
      ffmpegProcess.on('close', (exitCode: number | null) => {
        if (exitCode === 0) {
          // Success
          resolve();
        } else {
          // Non-zero exit code (Requirement 7.3)
          reject({
            message: `FFmpeg exited with code ${exitCode ?? 'unknown'}`,
            exitCode: exitCode ?? undefined,
            stdout,
            stderr,
          } as FFmpegError);
        }
      });
    });
  }

  /**
   * Type guard to check if an error is an FFmpegError.
   * 
   * @param error - Error object to check
   * @returns True if error is an FFmpegError
   */
  private isFFmpegError(error: unknown): error is FFmpegError {
    return (
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof (error as FFmpegError).message === 'string'
    );
  }
}
