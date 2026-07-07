/**
 * Input validation module for the Image to JPEG Converter.
 * 
 * Provides comprehensive validation of conversion configuration parameters
 * before processing begins. Validates file existence, quality ranges,
 * sampling factors, and output paths.
 * 
 * @module validator
 * @see Requirements 8.1-8.5
 */

import * as fs from 'fs';
import * as path from 'path';
import { ConversionConfig, SamplingFactor } from './types.js';

/**
 * Validation error details.
 * Contains information about a specific validation failure.
 */
export interface ValidationError {
  /** Field name that failed validation */
  field: string;
  /** Human-readable error message */
  message: string;
  /** The invalid value that was provided */
  value?: unknown;
}

/**
 * Result of validation operation.
 * Either successful (valid: true) or contains validation errors.
 */
export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: ValidationError[] };

/**
 * Input validator for conversion configuration.
 * 
 * Validates all configuration parameters before conversion begins:
 * - Input file existence and readability
 * - Quality parameter range (1-31)
 * - Sampling factor validity
 * - Output path writability
 * 
 * Aggregates multiple validation errors to provide comprehensive feedback.
 * 
 * @see Requirements 8.1-8.5
 */
export class InputValidator {
  /**
   * Validates a conversion configuration.
   * 
   * Performs all validation checks and aggregates any errors found.
   * Returns all validation errors together rather than failing on the first error.
   * 
   * @param config - The conversion configuration to validate
   * @returns ValidationResult indicating success or containing all validation errors
   * 
   * @example
   * ```typescript
   * const validator = new InputValidator();
   * const result = validator.validate(config);
   * 
   * if (!result.valid) {
   *   console.error('Validation failed:');
   *   result.errors.forEach(err => {
   *     console.error(`  ${err.field}: ${err.message}`);
   *   });
   * }
   * ```
   * 
   * @see Requirements 8.4, 8.5
   */
  validate(config: ConversionConfig): ValidationResult {
    const errors: ValidationError[] = [];

    // Validate input file existence (Requirements 8.1, 8.2)
    const inputError = this.validateInputFile(config.inputPath);
    if (inputError) {
      errors.push(inputError);
    }

    // Validate quality range (Requirements 8.3)
    const qualityError = this.validateQuality(config.quality);
    if (qualityError) {
      errors.push(qualityError);
    }

    // Validate sampling factor
    const samplingError = this.validateSamplingFactor(config.samplingFactor);
    if (samplingError) {
      errors.push(samplingError);
    }

    // Validate output path
    const outputError = this.validateOutputPath(config.outputPath);
    if (outputError) {
      errors.push(outputError);
    }

    // Validate optional minimum coded dimensions
    const minWidthError = this.validateMinDimension('minWidth', config.minWidth);
    if (minWidthError) {
      errors.push(minWidthError);
    }

    const minHeightError = this.validateMinDimension('minHeight', config.minHeight);
    if (minHeightError) {
      errors.push(minHeightError);
    }

    // Return aggregated results (Requirement 8.5)
    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true };
  }

  /**
   * Validates that the input file exists and is readable.
   * 
   * @param inputPath - Path to the input image file
   * @returns ValidationError if file doesn't exist or isn't readable, null otherwise
   * 
   * @see Requirements 8.1, 8.2
   */
  private validateInputFile(inputPath: string): ValidationError | null {
    if (!inputPath || inputPath.trim() === '') {
      return {
        field: 'inputPath',
        message: 'Input file path is required',
        value: inputPath,
      };
    }

    try {
      // Check if file exists
      if (!fs.existsSync(inputPath)) {
        return {
          field: 'inputPath',
          message: `Input file does not exist: ${inputPath}`,
          value: inputPath,
        };
      }

      // Check if it's a file (not a directory)
      const stats = fs.statSync(inputPath);
      if (!stats.isFile()) {
        return {
          field: 'inputPath',
          message: `Input path is not a file: ${inputPath}`,
          value: inputPath,
        };
      }

      // Check if file is readable
      try {
        fs.accessSync(inputPath, fs.constants.R_OK);
      } catch {
        return {
          field: 'inputPath',
          message: `Input file is not readable: ${inputPath}`,
          value: inputPath,
        };
      }

      return null;
    } catch (error) {
      return {
        field: 'inputPath',
        message: `Error checking input file: ${error instanceof Error ? error.message : String(error)}`,
        value: inputPath,
      };
    }
  }

  /**
   * Validates the quality parameter is within the valid range (1-31).
   * 
   * Quality is optional, but if provided must be in the range 1-31 inclusive.
   * Lower values indicate higher quality.
   * 
   * @param quality - JPEG quality value (optional)
   * @returns ValidationError if quality is out of range, null otherwise
   * 
   * @see Requirements 8.3
   */
  private validateQuality(quality?: number): ValidationError | null {
    // Quality is optional
    if (quality === undefined || quality === null) {
      return null;
    }

    // Check if it's a number
    if (typeof quality !== 'number' || isNaN(quality)) {
      return {
        field: 'quality',
        message: 'Quality must be a number',
        value: quality,
      };
    }

    // Check if it's an integer
    if (!Number.isInteger(quality)) {
      return {
        field: 'quality',
        message: 'Quality must be an integer',
        value: quality,
      };
    }

    // Check range (1-31 inclusive)
    if (quality < 1 || quality > 31) {
      return {
        field: 'quality',
        message: 'Quality must be in the range 1-31 (inclusive). Lower values indicate higher quality.',
        value: quality,
      };
    }

    return null;
  }

  /**
   * Validates an optional minimum coded dimension (`minWidth` / `minHeight`).
   *
   * The value is optional. If provided it must be a positive integer. Values
   * below the sampling factor's MCU size are NOT rejected here — they are
   * clamped up to the MCU at encode time ("不应小于 mcu"), so only genuinely
   * invalid values (non-number, non-integer, < 1) are reported.
   *
   * @param field - The config field name, for error reporting
   * @param value - The minimum dimension value (optional)
   * @returns ValidationError if the value is invalid, null otherwise
   */
  private validateMinDimension(
    field: 'minWidth' | 'minHeight',
    value?: number
  ): ValidationError | null {
    // Optional
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== 'number' || isNaN(value)) {
      return {
        field,
        message: `${field} must be a number`,
        value,
      };
    }

    if (!Number.isInteger(value)) {
      return {
        field,
        message: `${field} must be an integer`,
        value,
      };
    }

    if (value < 1) {
      return {
        field,
        message: `${field} must be a positive integer (values below the MCU size are raised to the MCU automatically)`,
        value,
      };
    }

    return null;
  }

  /**
   * Validates the sampling factor is a valid enum value.
   * 
   * Sampling factor must be one of: 400, 420, 422, or 444.
   * 
   * @param samplingFactor - Chroma subsampling factor
   * @returns ValidationError if sampling factor is invalid, null otherwise
   * 
   * @see Requirements 8.3
   */
  private validateSamplingFactor(samplingFactor: SamplingFactor): ValidationError | null {
    // Check if it's a number
    if (typeof samplingFactor !== 'number' || isNaN(samplingFactor)) {
      return {
        field: 'samplingFactor',
        message: 'Sampling factor must be a number',
        value: samplingFactor,
      };
    }

    // Check if it's a valid enum value
    const validValues = [
      SamplingFactor.Grayscale,
      SamplingFactor.YUV420,
      SamplingFactor.YUV422,
      SamplingFactor.YUV444,
    ];

    if (!validValues.includes(samplingFactor)) {
      return {
        field: 'samplingFactor',
        message: `Sampling factor must be one of: 400 (Grayscale), 420 (YUV420), 422 (YUV422), or 444 (YUV444). Got: ${samplingFactor}`,
        value: samplingFactor,
      };
    }

    return null;
  }

  /**
   * Validates the output path is valid and writable.
   * 
   * Checks that:
   * - Output path is not empty
   * - Parent directory exists
   * - Parent directory is writable
   * - If output file exists, it is writable
   * 
   * @param outputPath - Path where the output file will be written
   * @returns ValidationError if output path is invalid, null otherwise
   * 
   * @see Requirements 8.3
   */
  private validateOutputPath(outputPath: string): ValidationError | null {
    if (!outputPath || outputPath.trim() === '') {
      return {
        field: 'outputPath',
        message: 'Output file path is required',
        value: outputPath,
      };
    }

    try {
      // Get the directory path
      const dir = path.dirname(outputPath);

      // Check if directory exists
      if (!fs.existsSync(dir)) {
        return {
          field: 'outputPath',
          message: `Output directory does not exist: ${dir}`,
          value: outputPath,
        };
      }

      // Check if directory is actually a directory
      const dirStats = fs.statSync(dir);
      if (!dirStats.isDirectory()) {
        return {
          field: 'outputPath',
          message: `Output directory path is not a directory: ${dir}`,
          value: outputPath,
        };
      }

      // Check if directory is writable
      try {
        fs.accessSync(dir, fs.constants.W_OK);
      } catch {
        return {
          field: 'outputPath',
          message: `Output directory is not writable: ${dir}`,
          value: outputPath,
        };
      }

      // If output file already exists, check if it's writable
      if (fs.existsSync(outputPath)) {
        const fileStats = fs.statSync(outputPath);
        
        // Check if it's a file (not a directory)
        if (!fileStats.isFile()) {
          return {
            field: 'outputPath',
            message: `Output path exists but is not a file: ${outputPath}`,
            value: outputPath,
          };
        }

        // Check if file is writable
        try {
          fs.accessSync(outputPath, fs.constants.W_OK);
        } catch {
          return {
            field: 'outputPath',
            message: `Output file exists but is not writable: ${outputPath}`,
            value: outputPath,
          };
        }
      }

      return null;
    } catch (error) {
      return {
        field: 'outputPath',
        message: `Error checking output path: ${error instanceof Error ? error.message : String(error)}`,
        value: outputPath,
      };
    }
  }
}
