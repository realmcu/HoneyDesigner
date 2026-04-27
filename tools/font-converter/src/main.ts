/**
 * Main entry point for CLI
 *
 * Handles loading configuration, applying CLI overrides, creating font generators,
 * and managing error handling and exit codes.
 *
 * Requirements: 7.2, 7.6, 7.7
 */

import { CLIManager } from './cli';
import { ConfigManager } from './config';
import { BitmapFontGenerator } from './bitmap-generator';
import { VectorFontGenerator } from './vector-generator';
import { FontGenerator } from './font-generator';
import { FontConverterError, ErrorCode } from './errors';

/**
 * Font Generator Factory
 * Creates the appropriate generator based on configuration
 */
export class FontGeneratorFactory {
  /**
   * Creates a font generator based on configuration
   *
   * @param config - Font configuration
   * @returns Font generator instance
   */
  static create(config: any): FontGenerator {
    if (config.outputFormat === 'vector') {
      return new VectorFontGenerator(config);
    } else {
      return new BitmapFontGenerator(config);
    }
  }
}

/**
 * Main CLI execution function
 *
 * @param argv - Command-line arguments (defaults to process.argv)
 * @returns Exit code (0 for success, non-zero for error)
 */
export async function main(argv?: string[]): Promise<number> {
  try {
    // Parse CLI arguments
    const cliManager = new CLIManager();
    const cliArgs = cliManager.parse(argv);

    // Load configuration from file
    const rootConfig = await ConfigManager.loadConfig(cliArgs.configPath);

    // Validate configuration
    ConfigManager.validateRootConfig(rootConfig);

    // Process each font configuration
    for (let i = 0; i < rootConfig.fonts.length; i++) {
      let fontConfig = rootConfig.fonts[i];

      // Apply CLI overrides
      fontConfig = CLIManager.applyOverrides(fontConfig, cliArgs.overrides);

      // Validate the overridden configuration
      ConfigManager.validateConfig(fontConfig);

      console.log(`\nProcessing font ${i + 1}/${rootConfig.fonts.length}...`);
      console.log(`  Font: ${fontConfig.fontPath}`);
      console.log(`  Output: ${fontConfig.outputPath}`);
      console.log(`  Format: ${fontConfig.outputFormat}`);
      console.log(`  Size: ${fontConfig.fontSize}`);
      console.log(`  Render mode: ${fontConfig.renderMode}-bit`);

      // Create and run generator
      const generator = FontGeneratorFactory.create(fontConfig);

      try {
        await generator.generate();

        // Report results
        const processed = generator.getProcessedCharacters();
        const failed = generator.getFailedCharacters();

        console.log(`  ✓ Successfully generated ${processed.length} characters`);

        if (failed.length > 0) {
          console.log(
            `  ⚠ ${failed.length} characters failed to render (see NotSupportedChars.txt)`
          );
        }
      } finally {
        // Clean up resources
        generator.cleanup();
      }
    }

    console.log('\n✓ Font conversion completed successfully');
    return 0;
  } catch (error) {
    // Handle errors and return appropriate exit code
    if (error instanceof FontConverterError) {
      console.error(`\n✗ Error: ${error.message}`);

      if (error.context) {
        console.error('Details:', error.context);
      }

      // Return specific exit codes based on error type
      switch (error.code) {
        case ErrorCode.CONFIG_FILE_NOT_FOUND:
        case ErrorCode.FONT_FILE_NOT_FOUND:
        case ErrorCode.CHARSET_FILE_NOT_FOUND:
          return 2; // File not found errors

        case ErrorCode.CONFIG_PARSE_ERROR:
        case ErrorCode.CONFIG_VALIDATION_ERROR:
        case ErrorCode.INVALID_PARAMETER_COMBINATION:
        case ErrorCode.INDEX_METHOD_CONFLICT:
          return 3; // Configuration errors

        case ErrorCode.FONT_PARSE_ERROR:
        case ErrorCode.UNSUPPORTED_FONT_FORMAT:
          return 4; // Font file errors

        case ErrorCode.CHARSET_PARSE_ERROR:
        case ErrorCode.CODEPAGE_NOT_FOUND:
        case ErrorCode.INVALID_UNICODE_RANGE:
          return 5; // Character set errors

        case ErrorCode.GLYPH_RENDER_FAILED:
        case ErrorCode.IMAGE_PROCESSING_ERROR:
          return 6; // Rendering errors

        case ErrorCode.OUTPUT_DIRECTORY_ERROR:
        case ErrorCode.FILE_WRITE_ERROR:
        case ErrorCode.DISK_SPACE_ERROR:
          return 7; // Output errors

        default:
          return 1; // Generic error
      }
    } else if (error instanceof Error) {
      // Handle unexpected errors
      console.error(`\n✗ Unexpected error: ${error.message}`);
      if (error.stack) {
        console.error(error.stack);
      }
      return 99; // Unexpected error code
    } else {
      // Handle unknown errors
      console.error(`\n✗ Unknown error:`, error);
      return 99;
    }
  }
}

/**
 * CLI entry point
 * Runs main function and exits with appropriate code
 */
export async function cli(): Promise<void> {
  const exitCode = await main();
  process.exit(exitCode);
}
