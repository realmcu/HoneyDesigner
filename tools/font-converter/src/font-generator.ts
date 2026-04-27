/**
 * Font Generator Base Class
 *
 * Abstract base class for font generators (bitmap and vector).
 * Provides common functionality for font loading, character set processing,
 * and output file generation.
 *
 * Bitmap fonts use V2 format with bearing-based glyph headers and
 * typography metrics in the header extension. The parsed font metrics
 * (ascender, descender, lineGap, unitsPerEm) are extracted by
 * FontParser.extractMetrics() and available via parsedFont.metrics.
 */

import * as fs from 'fs';
import * as path from 'path';
import { FontConfig } from './types';
import { FontParser, ParsedFont } from './font-parser';
import { CharsetProcessor } from './charset-processor';
import { createOutputDirectoryError } from './errors';
import { FILE_NAMING } from './constants';
import { PathUtils } from './path-utils';

/**
 * Abstract base class for font generators
 */
export abstract class FontGenerator {
  /** Font configuration */
  protected config: FontConfig;

  /** Parsed font data */
  protected parsedFont: ParsedFont | null = null;

  /** Font parser instance */
  protected fontParser: FontParser;

  /** Character set (Unicode code points) */
  protected characters: number[] = [];

  /** Characters that failed to render */
  protected failedCharacters: number[] = [];

  /** Partial output files created during generation (for cleanup on error) */
  protected partialOutputFiles: string[] = [];

  /**
   * Creates a new FontGenerator
   *
   * @param config - Font configuration
   */
  constructor(config: FontConfig) {
    this.config = config;
    this.fontParser = new FontParser();
  }

  /**
   * Generate the font file
   * Must be implemented by subclasses
   */
  abstract generate(): Promise<void>;

  /**
   * Load the font file
   *
   * @throws FontConverterError if font cannot be loaded
   */
  protected async loadFont(): Promise<void> {
    this.parsedFont = await this.fontParser.load(this.config.fontPath);
  }

  /**
   * Load and merge character sets from all sources
   *
   * This loads ALL requested characters from the configuration,
   * which will later be written to the CST file regardless of
   * whether they can be successfully rendered.
   *
   * @throws FontConverterError if character sets cannot be loaded
   *
   * Requirements: 1.1
   */
  protected async loadCharacterSet(): Promise<void> {
    const basePath = PathUtils.dirname(this.config.fontPath);
    this.characters = CharsetProcessor.mergeCharacterSources(this.config.characterSets, basePath);
  }

  /**
   * Ensure output directory exists, create if necessary
   *
   * @throws FontConverterError if directory cannot be created
   */
  protected async ensureOutputDirectory(): Promise<void> {
    const outputDir = this.config.outputPath;

    if (!fs.existsSync(outputDir)) {
      try {
        fs.mkdirSync(outputDir, { recursive: true });
      } catch (error) {
        throw createOutputDirectoryError(outputDir, error as Error);
      }
    }
  }

  /**
   * Write character set to .cst file
   *
   * IMPORTANT: This writes ALL requested characters (this.characters),
   * not just successfully rendered ones. This matches C++ behavior where
   * the CST file contains all characters from the input character set,
   * regardless of whether they could be rendered successfully.
   *
   * Failed characters are separately recorded in NotSupportedChars.txt.
   *
   * C++ Reference: GenerateCstFile() in fontDictionary_o.cpp
   * - CST is written BEFORE rendering
   * - Contains all characters from ParseCodePage()
   * - Failed renders go to NotSupportedChars.txt, but stay in CST
   *
   * @param baseName - Base name for the output file (without extension)
   *
   * Requirements: 1.1, 1.4
   */
  protected async writeCharacterSetFile(baseName: string): Promise<void> {
    const cstPath = PathUtils.join(this.config.outputPath, baseName + FILE_NAMING.CST_EXTENSION);

    // Write ALL requested characters, including those that failed to render
    // This ensures compatibility with C++ implementation
    CharsetProcessor.writeCSTFile(cstPath, this.characters);
  }

  /**
   * Write failed characters to NotSupportedChars.txt
   */
  protected async writeFailedCharactersFile(): Promise<void> {
    if (this.failedCharacters.length === 0) {
      return;
    }

    const filePath = PathUtils.join(this.config.outputPath, FILE_NAMING.UNSUPPORTED_CHARS_FILE);

    const lines = this.failedCharacters.map((unicode) => {
      const char = String.fromCodePoint(unicode);
      const hex = unicode.toString(16).toUpperCase().padStart(4, '0');
      return `U+${hex} (${char})`;
    });

    try {
      // Use platform-specific line endings
      const content = PathUtils.joinLines(lines);
      fs.writeFileSync(filePath, content, 'utf-8');
    } catch (error) {
      // Log but don't fail - this is a non-critical file
      console.warn(
        `Warning: Could not write ${FILE_NAMING.UNSUPPORTED_CHARS_FILE}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Get the font name for use in output filenames
   *
   * IMPORTANT: This must match C++ behavior for compatibility!
   * C++ uses the font filename (without path and extension), not the internal font name.
   *
   * Example:
   *   Input:  "Font/NotoSans-Regular.ttf"
   *   Output: "NotoSans_Regular"
   *
   * C++ Reference: BitmapFontHeader constructor in FontDefine.h
   *
   * @returns Font name derived from filename
   */
  protected getFontName(): string {
    // Use the font filename (without path and extension)
    // This matches C++ behavior: font.erase(font.find("."))
    const fontPath = this.config.fontPath;
    const fileName = path.basename(fontPath, path.extname(fontPath));

    // Replace hyphens with underscores to match C++ output
    // C++ output: "NotoSans_Regular_size16_bits4_bitmap.bin"
    return fileName.replace(/-/g, '_');
  }

  /**
   * Record a failed character
   *
   * @param unicode - Unicode code point that failed
   */
  protected recordFailedCharacter(unicode: number): void {
    this.failedCharacters.push(unicode);
  }

  /**
   * Track a partial output file for cleanup on error
   *
   * @param filePath - Path to the partial output file
   */
  protected trackPartialFile(filePath: string): void {
    this.partialOutputFiles.push(filePath);
  }

  /**
   * Clean up partial output files on error
   * Deletes all tracked partial files
   */
  protected cleanupPartialFiles(): void {
    for (const filePath of this.partialOutputFiles) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        // Log but don't throw - cleanup is best effort
        console.warn(
          `Warning: Could not delete partial file ${filePath}: ${(error as Error).message}`
        );
      }
    }
    this.partialOutputFiles = [];
  }

  /**
   * Get the list of failed characters
   */
  getFailedCharacters(): number[] {
    return [...this.failedCharacters];
  }

  /**
   * Get the list of successfully processed characters
   */
  getProcessedCharacters(): number[] {
    return this.characters.filter((c) => !this.failedCharacters.includes(c));
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.fontParser.unload();
    this.parsedFont = null;
    this.characters = [];
    this.failedCharacters = [];
  }
}
