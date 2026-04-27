/**
 * Character Set Processor for TypeScript Font Converter
 *
 * This module handles parsing and writing of character set files (.cst),
 * Unicode range parsing, string character extraction, and character source merging.
 *
 * .cst files are binary files containing uint16_t values (2 bytes each, little-endian)
 * for each Unicode code point.
 */

import * as fs from 'fs';
import { CharacterSetSource } from './types';
import {
  FontConverterError,
  ErrorCode,
  createCharsetFileNotFoundError,
  createCharsetParseError,
  createInvalidUnicodeRangeError,
} from './errors';
import { BINARY_FORMAT } from './constants';
import { PathUtils } from './path-utils';
import { CodePageParser } from './codepage-parser';

/**
 * Character Set Processor class
 * Handles all character set related operations
 */
export class CharsetProcessor {
  /**
   * Parse a .cst (Character Set) file
   *
   * .cst files are binary files containing a sequence of uint16_t values,
   * each representing a Unicode code point (little-endian format).
   *
   * @param filePath - Path to the .cst file
   * @returns Array of Unicode code points found in the file
   * @throws FontConverterError if file not found or parsing fails
   *
   * Requirements: 4.1
   */
  static parseCSTFile(filePath: string): number[] {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw createCharsetFileNotFoundError(filePath);
    }

    try {
      const data = fs.readFileSync(filePath);

      // File size must be a multiple of 2 bytes (uint16_t)
      if (data.length % 2 !== 0) {
        throw createCharsetParseError(
          filePath,
          undefined,
          new Error('File size is not a multiple of 2 bytes')
        );
      }

      const unicodes: number[] = [];
      const numEntries = data.length / 2;

      for (let i = 0; i < numEntries; i++) {
        // Read uint16_t in little-endian format
        const codePoint = data.readUInt16LE(i * 2);

        // Only include valid Unicode values
        if (codePoint <= BINARY_FORMAT.MAX_UNICODE) {
          unicodes.push(codePoint);
        }
      }

      return unicodes;
    } catch (error) {
      if (error instanceof FontConverterError) {
        throw error;
      }
      throw createCharsetParseError(filePath, undefined, error as Error);
    }
  }

  /**
   * Write Unicode values to a .cst file
   *
   * Writes Unicode values as uint16_t values (2 bytes each, little-endian).
   *
   * IMPORTANT: This function writes ALL provided Unicode values, regardless
   * of whether they can be successfully rendered. This matches C++ behavior
   * where the CST file contains all requested characters from the input
   * character set.
   *
   * C++ Reference: GenerateCstFile() in fontDictionary_o.cpp
   * - Format: Direct sequence of uint16_t values (no header)
   * - Contains all characters from ParseCodePage()
   * - Failed renders go to NotSupportedChars.txt, but stay in CST
   *
   * @param filePath - Path to the output .cst file
   * @param unicodes - Array of Unicode code points to write (ALL requested characters)
   * @throws FontConverterError if writing fails
   *
   * Requirements: 1.1, 1.4, 4.7
   */
  static writeCSTFile(filePath: string, unicodes: number[]): void {
    try {
      // Ensure output directory exists
      const dir = PathUtils.dirname(filePath);
      if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Create buffer for all Unicode values
      const buffer = Buffer.alloc(unicodes.length * 2);

      for (let i = 0; i < unicodes.length; i++) {
        // Clamp to valid uint16_t range
        const codePoint = Math.min(Math.max(0, Math.floor(unicodes[i])), BINARY_FORMAT.MAX_UNICODE);
        buffer.writeUInt16LE(codePoint, i * 2);
      }

      fs.writeFileSync(filePath, buffer);
    } catch (error) {
      throw new FontConverterError(
        ErrorCode.FILE_WRITE_ERROR,
        `Failed to write .cst file: ${filePath}`,
        { filePath, cause: error as Error }
      );
    }
  }

  /**
   * Parse a Unicode range string
   *
   * Parses range strings in the format "0xXXXX-0xYYYY" and generates
   * all Unicode values within that range (inclusive).
   *
   * @param rangeStr - Range string (e.g., "0x0020-0x007F")
   * @returns Array of Unicode code points in the range
   * @throws FontConverterError if range format is invalid
   *
   * Requirements: 4.3
   */
  static parseUnicodeRange(rangeStr: string): number[] {
    // Normalize the string: trim whitespace
    const normalized = rangeStr.trim();

    // Match pattern: 0xXXXX-0xYYYY or XXXX-YYYY
    const rangePattern = /^(0x)?([0-9a-fA-F]+)\s*-\s*(0x)?([0-9a-fA-F]+)$/;
    const match = normalized.match(rangePattern);

    if (!match) {
      throw createInvalidUnicodeRangeError(rangeStr);
    }

    const startStr = match[2];
    const endStr = match[4];

    const start = parseInt(startStr, 16);
    const end = parseInt(endStr, 16);

    // Validate range
    if (isNaN(start) || isNaN(end)) {
      throw createInvalidUnicodeRangeError(rangeStr);
    }

    if (start > end) {
      throw createInvalidUnicodeRangeError(rangeStr);
    }

    if (start < BINARY_FORMAT.MIN_UNICODE || end > BINARY_FORMAT.MAX_UNICODE) {
      throw createInvalidUnicodeRangeError(rangeStr);
    }

    // Generate all values in range
    const unicodes: number[] = [];
    for (let i = start; i <= end; i++) {
      unicodes.push(i);
    }

    return unicodes;
  }

  /**
   * Extract unique Unicode values from a string
   *
   * Extracts all unique Unicode code points from the given string.
   *
   * @param str - Input string
   * @returns Array of unique Unicode code points
   *
   * Requirements: 4.4
   */
  static extractStringCharacters(str: string): number[] {
    const unicodeSet = new Set<number>();

    for (const char of str) {
      const codePoint = char.codePointAt(0);
      if (codePoint !== undefined && codePoint <= BINARY_FORMAT.MAX_UNICODE) {
        unicodeSet.add(codePoint);
      }
    }

    return Array.from(unicodeSet);
  }

  /**
   * Merge multiple character sources and deduplicate
   *
   * Combines characters from multiple sources (file, codepage, range, string),
   * removes duplicates, and returns a sorted array.
   *
   * @param sources - Array of character set sources
   * @param basePath - Base path for resolving relative file paths
   * @returns Sorted array of unique Unicode code points
   * @throws FontConverterError if any source cannot be processed
   *
   * Requirements: 4.5, 4.6
   */
  static mergeCharacterSources(sources: CharacterSetSource[], basePath: string = ''): number[] {
    const unicodeSet = new Set<number>();

    for (const source of sources) {
      let chars: number[] = [];

      switch (source.type) {
        case 'file': {
          // Resolve file path relative to base path
          const filePath = PathUtils.isAbsolute(source.value)
            ? source.value
            : PathUtils.resolveRelative(basePath, source.value);
          chars = CharsetProcessor.parseCSTFile(filePath);
          break;
        }

        case 'range':
          chars = CharsetProcessor.parseUnicodeRange(source.value);
          break;

        case 'string':
          chars = CharsetProcessor.extractStringCharacters(source.value);
          break;

        case 'codepage': {
          // Resolve CodePage file path
          const cpPath = CodePageParser.resolveCodePagePath(source.value, basePath);
          if (!cpPath) {
            throw new FontConverterError(
              ErrorCode.CODEPAGE_NOT_FOUND,
              `CodePage not found: ${source.value} (searched from ${basePath})`,
              { details: source.value }
            );
          }
          chars = CodePageParser.parseNlsFile(cpPath);
          break;
        }

        default:
          throw new FontConverterError(
            ErrorCode.CHARSET_PARSE_ERROR,
            `Unknown character set source type: ${(source as any).type}`,
            { details: `Type: ${(source as any).type}` }
          );
      }

      // Add all characters to the set (automatic deduplication)
      for (const char of chars) {
        unicodeSet.add(char);
      }
    }

    // Convert to sorted array
    return Array.from(unicodeSet).sort((a, b) => a - b);
  }

  /**
   * Deduplicate and sort an array of Unicode values
   *
   * @param unicodes - Array of Unicode code points (may contain duplicates)
   * @returns Sorted array of unique Unicode code points
   */
  static deduplicateAndSort(unicodes: number[]): number[] {
    return Array.from(new Set(unicodes)).sort((a, b) => a - b);
  }
}
