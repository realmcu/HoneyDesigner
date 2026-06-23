/**
 * Error handling for TypeScript Font Converter
 *
 * This module defines all error types and error handling utilities used throughout
 * the font conversion process. Error codes match the C++ implementation for consistency.
 */

/**
 * Error codes for font converter operations
 * Organized by category (1xx, 2xx, 3xx, etc.)
 */
export enum ErrorCode {
  // Configuration Errors (1xx)
  /** Configuration file not found */
  CONFIG_FILE_NOT_FOUND = 101,

  /** Configuration file parsing error */
  CONFIG_PARSE_ERROR = 102,

  /** Configuration validation error */
  CONFIG_VALIDATION_ERROR = 103,

  /** Invalid parameter combination */
  INVALID_PARAMETER_COMBINATION = 104,

  /** Index method conflict (crop=true with indexMethod=1) */
  INDEX_METHOD_CONFLICT = 105,

  // Font File Errors (2xx)
  /** Font file not found */
  FONT_FILE_NOT_FOUND = 201,

  /** Font file parsing error */
  FONT_PARSE_ERROR = 202,

  /** Unsupported font format */
  UNSUPPORTED_FONT_FORMAT = 203,

  /** Font collection index out of range */
  FONT_COLLECTION_INDEX_ERROR = 204,

  // Character Set Errors (3xx)
  /** Character set file not found */
  CHARSET_FILE_NOT_FOUND = 301,

  /** Character set file parsing error */
  CHARSET_PARSE_ERROR = 302,

  /** CodePage file not found */
  CODEPAGE_NOT_FOUND = 303,

  /** Invalid Unicode range specification */
  INVALID_UNICODE_RANGE = 304,

  /** Empty character set */
  EMPTY_CHARSET = 305,

  // Rendering Errors (4xx)
  /** Glyph rendering failed */
  GLYPH_RENDER_FAILED = 401,

  /** Image processing error */
  IMAGE_PROCESSING_ERROR = 402,

  /** Unsupported render mode */
  UNSUPPORTED_RENDER_MODE = 403,

  /** Cropping error */
  CROPPING_ERROR = 404,

  // Output Errors (5xx)
  /** Output directory error */
  OUTPUT_DIRECTORY_ERROR = 501,

  /** File write error */
  FILE_WRITE_ERROR = 502,

  /** Disk space error */
  DISK_SPACE_ERROR = 503,

  /** Binary format error */
  BINARY_FORMAT_ERROR = 504,

  // Internal Errors (9xx)
  /** Internal error */
  INTERNAL_ERROR = 999,
}

/**
 * Context information for errors
 */
export interface ErrorContext {
  /** File path related to the error */
  filePath?: string;

  /** Line number in file (for parsing errors) */
  lineNumber?: number;

  /** Field name (for validation errors) */
  fieldName?: string;

  /** Expected value or format */
  expected?: string;

  /** Actual value received */
  actual?: string;

  /** Unicode character code (for rendering errors) */
  unicode?: number;

  /** Additional details */
  details?: string;

  /** Original error that caused this error */
  cause?: Error;
}

/**
 * Custom error class for font converter operations
 * Extends Error with error codes and context information
 */
export class FontConverterError extends Error {
  /**
   * Error code identifying the type of error
   */
  public readonly code: ErrorCode;

  /**
   * Context information about the error
   */
  public readonly context?: ErrorContext;

  /**
   * Creates a new FontConverterError
   *
   * @param code - Error code identifying the error type
   * @param message - Human-readable error message
   * @param context - Optional context information
   */
  constructor(code: ErrorCode, message: string, context?: ErrorContext) {
    super(message);
    this.name = 'FontConverterError';
    this.code = code;
    this.context = context;

    // Maintains proper stack trace for where error was thrown (V8 only)
    const ErrorWithCapture = Error as typeof Error & {
      captureStackTrace?: (target: object, constructor: (...args: unknown[]) => unknown) => void;
    };
    if (typeof ErrorWithCapture.captureStackTrace === 'function') {
      ErrorWithCapture.captureStackTrace(this, FontConverterError);
    }
  }

  /**
   * Formats the error as a detailed string including context
   *
   * @returns Formatted error message with context
   */
  public toString(): string {
    let result = `${this.name} [${this.code}]: ${this.message}`;

    if (this.context) {
      const contextParts: string[] = [];

      if (this.context.filePath) {
        contextParts.push(`File: ${this.context.filePath}`);
      }

      if (this.context.lineNumber !== undefined) {
        contextParts.push(`Line: ${this.context.lineNumber}`);
      }

      if (this.context.fieldName) {
        contextParts.push(`Field: ${this.context.fieldName}`);
      }

      if (this.context.expected) {
        contextParts.push(`Expected: ${this.context.expected}`);
      }

      if (this.context.actual) {
        contextParts.push(`Actual: ${this.context.actual}`);
      }

      if (this.context.unicode !== undefined) {
        contextParts.push(
          `Unicode: U+${this.context.unicode.toString(16).toUpperCase().padStart(4, '0')}`
        );
      }

      if (this.context.details) {
        contextParts.push(`Details: ${this.context.details}`);
      }

      if (contextParts.length > 0) {
        result += '\n  ' + contextParts.join('\n  ');
      }

      if (this.context.cause) {
        result += `\nCaused by: ${this.context.cause.message}`;
      }
    }

    return result;
  }

  /**
   * Converts error to JSON representation
   *
   * @returns JSON object representing the error
   */
  public toJSON(): object {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      stack: this.stack,
    };
  }
}

/**
 * Helper functions for creating specific error types
 */

/**
 * Creates a configuration file not found error
 */
export function createConfigFileNotFoundError(filePath: string): FontConverterError {
  return new FontConverterError(
    ErrorCode.CONFIG_FILE_NOT_FOUND,
    `Configuration file not found: ${filePath}`,
    { filePath }
  );
}

/**
 * Creates a configuration parse error
 */
export function createConfigParseError(filePath: string, cause: Error): FontConverterError {
  return new FontConverterError(
    ErrorCode.CONFIG_PARSE_ERROR,
    `Failed to parse configuration file: ${filePath}`,
    { filePath, cause, details: cause.message }
  );
}

/**
 * Creates a configuration validation error
 */
export function createConfigValidationError(
  fieldName: string,
  expected: string,
  actual: string
): FontConverterError {
  return new FontConverterError(
    ErrorCode.CONFIG_VALIDATION_ERROR,
    `Invalid configuration value for ${fieldName}`,
    { fieldName, expected, actual }
  );
}

/**
 * Creates an index method conflict error
 */
export function createIndexMethodConflictError(): FontConverterError {
  return new FontConverterError(
    ErrorCode.INDEX_METHOD_CONFLICT,
    'Only Address Mode support Crop!',
    { details: 'crop=true cannot be used with indexMethod=1 (Offset mode)' }
  );
}

/**
 * Creates a font file not found error
 */
export function createFontFileNotFoundError(filePath: string): FontConverterError {
  return new FontConverterError(ErrorCode.FONT_FILE_NOT_FOUND, `Font file not found: ${filePath}`, {
    filePath,
  });
}

/**
 * Creates a font parse error
 */
export function createFontParseError(filePath: string, cause: Error): FontConverterError {
  return new FontConverterError(
    ErrorCode.FONT_PARSE_ERROR,
    `Failed to parse font file: ${filePath}`,
    { filePath, cause, details: cause.message }
  );
}

/**
 * Creates a character set file not found error
 */
export function createCharsetFileNotFoundError(filePath: string): FontConverterError {
  return new FontConverterError(
    ErrorCode.CHARSET_FILE_NOT_FOUND,
    `Character set file not found: ${filePath}`,
    { filePath }
  );
}

/**
 * Creates a character set parse error
 */
export function createCharsetParseError(
  filePath: string,
  lineNumber?: number,
  cause?: Error
): FontConverterError {
  return new FontConverterError(
    ErrorCode.CHARSET_PARSE_ERROR,
    `Failed to parse character set file: ${filePath}`,
    { filePath, lineNumber, cause, details: cause?.message }
  );
}

/**
 * Creates a CodePage not found error
 */
export function createCodePageNotFoundError(codePage: string): FontConverterError {
  return new FontConverterError(
    ErrorCode.CODEPAGE_NOT_FOUND,
    `CodePage file not found: ${codePage}`,
    { details: codePage }
  );
}

/**
 * Creates an invalid Unicode range error
 */
export function createInvalidUnicodeRangeError(range: string): FontConverterError {
  return new FontConverterError(
    ErrorCode.INVALID_UNICODE_RANGE,
    `Invalid Unicode range specification: ${range}`,
    { details: range, expected: 'Format: 0xXXXX-0xYYYY' }
  );
}

/**
 * Creates a glyph render failed error
 */
export function createGlyphRenderFailedError(unicode: number, cause?: Error): FontConverterError {
  return new FontConverterError(
    ErrorCode.GLYPH_RENDER_FAILED,
    `Failed to render glyph for character U+${unicode.toString(16).toUpperCase().padStart(4, '0')}`,
    { unicode, cause, details: cause?.message }
  );
}

/**
 * Creates an output directory error
 */
export function createOutputDirectoryError(dirPath: string, cause: Error): FontConverterError {
  return new FontConverterError(
    ErrorCode.OUTPUT_DIRECTORY_ERROR,
    `Failed to create or access output directory: ${dirPath}`,
    { filePath: dirPath, cause, details: cause.message }
  );
}

/**
 * Creates a file write error
 */
export function createFileWriteError(filePath: string, cause: Error): FontConverterError {
  return new FontConverterError(ErrorCode.FILE_WRITE_ERROR, `Failed to write file: ${filePath}`, {
    filePath,
    cause,
    details: cause.message,
  });
}

/**
 * Checks if an error is a FontConverterError
 */
export function isFontConverterError(error: unknown): error is FontConverterError {
  return error instanceof FontConverterError;
}

/**
 * Checks if an error is a specific error code
 */
export function isErrorCode(error: unknown, code: ErrorCode): boolean {
  return isFontConverterError(error) && error.code === code;
}
