/**
 * Main converter orchestration module for the Image to JPEG Converter.
 * 
 * Orchestrates the complete conversion pipeline:
 * 1. Input validation
 * 2. FFmpeg conversion to JPEG
 * 3. Binary header generation
 * 4. File assembly
 * 5. Cleanup (temporary files)
 * 
 * Handles all error types and ensures proper resource cleanup on both
 * success and failure paths.
 * 
 * @module converter
 * @see Requirements 10.1-10.5
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConversionConfig, ConversionResult, ConversionError } from './types.js';
import { InputValidator, ValidationResult } from './validator.js';
import { FFmpegExecutor, FFmpegError } from './ffmpeg-executor.js';
import { HeaderGenerator } from './header-generator.js';
import { FileAssembler, FileAssemblyError } from './file-assembler.js';

/**
 * Main converter class that orchestrates the image to JPEG conversion pipeline.
 * 
 * The conversion process follows these steps:
 * 1. Validate input configuration (file existence, quality range, etc.)
 * 2. Create temporary file path for FFmpeg output
 * 3. Execute FFmpeg to convert image to JPEG
 * 4. Extract image dimensions from JPEG data
 * 5. Generate RGB data header with image metadata
 * 6. Generate complete JPEG file header
 * 7. Encode header to binary format
 * 8. Assemble final output file (header + JPEG data)
 * 9. Clean up temporary files
 * 
 * Error handling:
 * - Validates all inputs before processing (Requirement 8.4)
 * - Cleans up temporary files on error (Requirement 10.1)
 * - Ensures atomic output creation (Requirements 10.2, 10.3)
 * - Provides descriptive error messages (Requirement 10.4)
 * - Handles cleanup failures gracefully (Requirement 10.5)
 * 
 * @see Requirements 10.1-10.5
 */
export class Converter {
  private validator: InputValidator;
  private ffmpegExecutor: FFmpegExecutor;
  private headerGenerator: HeaderGenerator;
  private fileAssembler: FileAssembler;

  /**
   * Creates a new Converter instance.
   * 
   * Initializes all pipeline components:
   * - InputValidator for configuration validation
   * - FFmpegExecutor for image conversion
   * - HeaderGenerator for binary header creation
   * - FileAssembler for final file assembly
   */
  constructor() {
    this.validator = new InputValidator();
    this.ffmpegExecutor = new FFmpegExecutor();
    this.headerGenerator = new HeaderGenerator();
    this.fileAssembler = new FileAssembler();
  }

  /**
   * Converts an image to JPEG format with custom binary header.
   * 
   * Orchestrates the complete conversion pipeline with proper error handling
   * and resource cleanup. Returns a ConversionResult on success or throws
   * a ConversionError on failure.
   * 
   * The method ensures:
   * - All validation occurs before FFmpeg execution (Requirement 8.4)
   * - Temporary files are cleaned up on both success and error (Requirements 10.1, 10.5)
   * - Output file is only created on complete success (Requirements 10.2, 10.3)
   * - Error messages include context and details (Requirement 10.4)
   * 
   * @param config - Conversion configuration with input/output paths and parameters
   * @returns Promise resolving to ConversionResult on success
   * @throws ConversionError on validation, FFmpeg, header generation, or I/O errors
   * 
   * @example
   * ```typescript
   * const converter = new Converter();
   * try {
   *   const result = await converter.convert({
   *     inputPath: 'input.png',
   *     outputPath: 'output.jpg',
   *     samplingFactor: SamplingFactor.YUV420,
   *     quality: 10,
   *   });
   *   console.log(`Success: ${result.outputPath}`);
   *   console.log(`Size: ${result.jpegSize} bytes`);
   *   console.log(`Dimensions: ${result.dimensions.width}x${result.dimensions.height}`);
   * } catch (error) {
   *   console.error(`Conversion failed: ${error.message}`);
   * }
   * ```
   * 
   * @see Requirements 10.1-10.5
   */
  async convert(config: ConversionConfig): Promise<ConversionResult> {
    let tempOutputPath: string | null = null;

    try {
      // Step 1: Validate input configuration (Requirement 8.4)
      const validationResult = this.validator.validate(config);
      if (!validationResult.valid) {
        throw this.createValidationError(validationResult);
      }

      // Step 2: Create temporary file path for FFmpeg output
      tempOutputPath = this.createTempFilePath();

      // Step 3: Execute FFmpeg conversion
      let ffmpegResult;
      try {
        ffmpegResult = await this.ffmpegExecutor.convert(config, tempOutputPath);
      } catch (error) {
        throw this.createFFmpegError(error as FFmpegError);
      }

      // Step 4: Extract image dimensions from JPEG data
      const dimensions = this.headerGenerator.extractDimensions(ffmpegResult.jpegData);
      if (!dimensions) {
        throw this.createHeaderError(
          'Failed to extract image dimensions from JPEG data',
          { jpegDataLength: ffmpegResult.jpegData.length }
        );
      }

      // Step 5: Generate RGB data header with image metadata
      const rgbHeader = this.headerGenerator.generateRgbHeader(
        dimensions.width,
        dimensions.height,
        config
      );

      // Step 6: Generate complete JPEG file header
      let jpegHeader;
      try {
        jpegHeader = this.headerGenerator.generateJpegHeader(
          rgbHeader,
          ffmpegResult.jpegData
        );
      } catch (error) {
        throw this.createHeaderError(
          'Failed to generate JPEG file header',
          error
        );
      }

      // Step 7: Encode header to binary format
      const headerBytes = this.headerGenerator.encodeToBytes(jpegHeader);

      // Step 8: Assemble final output file (header + JPEG data)
      try {
        await this.fileAssembler.assemble(
          headerBytes,
          ffmpegResult.jpegData,
          config.outputPath
        );
      } catch (error) {
        throw this.createIOError(error as FileAssemblyError);
      }

      // Step 9: Clean up temporary files on success (Requirement 10.1)
      await this.cleanupTempFiles([tempOutputPath]);

      // Return success result
      return {
        success: true,
        outputPath: config.outputPath,
        jpegSize: ffmpegResult.jpegData.length,
        dimensions: {
          width: dimensions.width,
          height: dimensions.height,
        },
      };
    } catch (error) {
      // Clean up temporary files on error (Requirement 10.1)
      if (tempOutputPath) {
        await this.cleanupTempFiles([tempOutputPath]);
      }

      // Clean up partial output file on error (Requirements 10.2, 10.3)
      await this.cleanupOutputFile(config.outputPath);

      // Re-throw the error (already formatted as ConversionError)
      throw error;
    }
  }

  /**
   * Creates a temporary file path for FFmpeg output.
   * 
   * Generates a unique temporary file path in the system's temp directory.
   * The file will be cleaned up after conversion completes or on error.
   * 
   * @returns Absolute path to a temporary file
   */
  private createTempFilePath(): string {
    const tempDir = os.tmpdir();
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const filename = `image-to-jpeg-${timestamp}-${random}.jpg`;
    return path.join(tempDir, filename);
  }

  /**
   * Cleans up temporary files.
   * 
   * Attempts to delete all specified temporary files. Logs cleanup failures
   * but does not throw errors, as cleanup failures should not mask the
   * original error (Requirement 10.5).
   * 
   * @param tempFiles - Array of temporary file paths to delete
   * 
   * @see Requirement 10.1, 10.5
   */
  private async cleanupTempFiles(tempFiles: string[]): Promise<void> {
    for (const tempFile of tempFiles) {
      try {
        if (fs.existsSync(tempFile)) {
          await fs.promises.unlink(tempFile);
        }
      } catch (error) {
        // Log cleanup failure but don't throw (Requirement 10.5)
        console.warn(
          `Warning: Failed to clean up temporary file: ${tempFile}`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  /**
   * Cleans up partial output file on error.
   * 
   * Attempts to delete the output file if it was partially created during
   * a failed conversion. This ensures atomic output creation (Requirements 10.2, 10.3).
   * 
   * @param outputPath - Path to the output file to delete
   * 
   * @see Requirements 10.2, 10.3, 10.5
   */
  private async cleanupOutputFile(outputPath: string): Promise<void> {
    try {
      if (fs.existsSync(outputPath)) {
        await fs.promises.unlink(outputPath);
      }
    } catch (error) {
      // Log cleanup failure but don't throw (Requirement 10.5)
      console.warn(
        `Warning: Failed to clean up output file: ${outputPath}`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Creates a ConversionError from validation results.
   * 
   * Formats validation errors into a descriptive error message with context
   * about which fields failed validation and why (Requirement 10.4).
   * 
   * @param validationResult - Validation result with errors
   * @returns ConversionError with validation details
   * 
   * @see Requirement 10.4
   */
  private createValidationError(
    validationResult: ValidationResult & { valid: false }
  ): ConversionError {
    const errorMessages = validationResult.errors
      .map((err) => `${err.field}: ${err.message}`)
      .join('; ');

    return {
      success: false,
      type: 'validation',
      message: `Validation failed: ${errorMessages}`,
      details: {
        errors: validationResult.errors,
      },
    };
  }

  /**
   * Creates a ConversionError from FFmpeg execution error.
   * 
   * Formats FFmpeg errors with exit code and stderr output for debugging
   * (Requirement 10.4).
   * 
   * @param ffmpegError - FFmpeg execution error
   * @returns ConversionError with FFmpeg details
   * 
   * @see Requirement 10.4
   */
  private createFFmpegError(ffmpegError: FFmpegError): ConversionError {
    return {
      success: false,
      type: 'ffmpeg',
      message: `FFmpeg conversion failed: ${ffmpegError.message}`,
      details: {
        exitCode: ffmpegError.exitCode,
        stderr: ffmpegError.stderr,
        stdout: ffmpegError.stdout,
      },
    };
  }

  /**
   * Creates a ConversionError from header generation error.
   * 
   * Formats header generation errors with context about what went wrong
   * (Requirement 10.4).
   * 
   * @param message - Error message
   * @param details - Additional error details
   * @returns ConversionError with header generation details
   * 
   * @see Requirement 10.4
   */
  private createHeaderError(message: string, details?: unknown): ConversionError {
    return {
      success: false,
      type: 'header',
      message: `Header generation failed: ${message}`,
      details,
    };
  }

  /**
   * Creates a ConversionError from file assembly error.
   * 
   * Formats I/O errors with file paths and system error details
   * (Requirement 10.4).
   * 
   * @param assemblyError - File assembly error
   * @returns ConversionError with I/O details
   * 
   * @see Requirement 10.4
   */
  private createIOError(assemblyError: FileAssemblyError): ConversionError {
    return {
      success: false,
      type: 'io',
      message: `File I/O failed: ${assemblyError.message}`,
      details: assemblyError.details,
    };
  }
}
