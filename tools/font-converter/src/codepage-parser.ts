/**
 * CodePage Parser for TypeScript Font Converter
 *
 * Parses Windows NLS (National Language Support) files to extract
 * valid Unicode code points for a given code page.
 *
 * NLS File Format (simplified):
 * - Offset 4 (2 bytes): EntrySize (1 = SBCS, 2 = DBCS)
 * - Offset 6 (2 bytes): DefaultChar (usually 0x003F '?')
 * - File ends with Unicode->CodePage table (65536 * entrySize bytes)
 *
 * C++ Reference: CodePageParser.h - ParseNlsFile()
 */

import * as fs from 'fs';
import * as path from 'path';
import { FontConverterError, ErrorCode } from './errors';
import { BINARY_FORMAT } from './constants';

/**
 * File type detection for .cp files
 */
enum CpFileType {
  HEX_FORMAT, // 0xABCD format
  STRING_FORMAT, // Plain text string
  UNKNOWN,
}

/**
 * CodePage Parser class
 */
export class CodePageParser {
  /**
   * Parse a Windows NLS file
   *
   * @param filePath - Path to the NLS file (e.g., CP1252, CP936)
   * @returns Array of valid Unicode code points
   * @throws FontConverterError if file not found or parsing fails
   */
  static parseNlsFile(filePath: string): number[] {
    if (!fs.existsSync(filePath)) {
      throw new FontConverterError(
        ErrorCode.CODEPAGE_NOT_FOUND,
        `CodePage file not found: ${filePath}`,
        { filePath }
      );
    }

    const buffer = fs.readFileSync(filePath);
    const fileSize = buffer.length;

    // Minimum NLS file header check
    if (fileSize < 16) {
      throw new FontConverterError(
        ErrorCode.CHARSET_PARSE_ERROR,
        `Invalid NLS file (too small): ${filePath}`,
        { filePath }
      );
    }

    // Parse header
    // Offset 4 (2 bytes): EntrySize (1 = SBCS, 2 = DBCS)
    // Offset 6 (2 bytes): DefaultChar
    const entrySize = buffer.readUInt16LE(4);
    const defaultChar = buffer.readUInt16LE(6);

    // Validate entry size
    if (entrySize !== 1 && entrySize !== 2) {
      throw new FontConverterError(
        ErrorCode.CHARSET_PARSE_ERROR,
        `Invalid NLS entry size: ${entrySize}`,
        { filePath, details: `entrySize=${entrySize}` }
      );
    }

    // Unicode->CodePage table is at the end of file (65536 entries)
    const tableSize = 65536 * entrySize;
    if (fileSize < tableSize) {
      throw new FontConverterError(
        ErrorCode.CHARSET_PARSE_ERROR,
        `NLS file corrupted (too small for table): ${filePath}`,
        { filePath, details: `fileSize=${fileSize}, expected>=${tableSize}` }
      );
    }

    const tableOffset = fileSize - tableSize;
    const unicodes: number[] = [];

    // Traverse table and collect valid characters
    if (entrySize === 1) {
      // SBCS (Single Byte Character Set, e.g., CP1252)
      for (let i = 0; i < 65536; i++) {
        const cpChar = buffer.readUInt8(tableOffset + i);
        if (cpChar !== defaultChar) {
          unicodes.push(i);
        }
      }
    } else {
      // DBCS (Double Byte Character Set, e.g., CP936)
      for (let i = 0; i < 65536; i++) {
        const cpChar = buffer.readUInt16LE(tableOffset + i * 2);
        if (cpChar !== defaultChar) {
          unicodes.push(i);
        }
      }
    }

    return unicodes;
  }

  /**
   * Detect file type for .cp files (HEX or STRING format)
   */
  private static detectCpFileType(content: string): CpFileType {
    const lines = content.split(/\r?\n/).slice(0, 5);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // HEX format: starts with 0x
      if (trimmed.startsWith('0x')) {
        // Verify it's a valid hex number
        const hexPart = trimmed.substring(2);
        if (/^[0-9a-fA-F]+/.test(hexPart)) {
          return CpFileType.HEX_FORMAT;
        }
      }

      // Non-HEX format is STRING
      return CpFileType.STRING_FORMAT;
    }

    return CpFileType.UNKNOWN;
  }

  /**
   * Parse a .cp file (mapping file or symbol file)
   *
   * Supports two formats:
   * - HEX format: Lines starting with 0xXXXX
   * - STRING format: Plain text (UTF-8), each character is extracted
   *
   * @param filePath - Path to the .cp file
   * @returns Array of Unicode code points
   */
  static parseCpFile(filePath: string): number[] {
    if (!fs.existsSync(filePath)) {
      throw new FontConverterError(
        ErrorCode.CHARSET_FILE_NOT_FOUND,
        `CP file not found: ${filePath}`,
        { filePath }
      );
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const fileType = this.detectCpFileType(content);
    const unicodes: number[] = [];

    const lines = content.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (fileType === CpFileType.HEX_FORMAT) {
        // Parse HEX format: 0xXXXX or 0xXXXX 0xYYYY
        const tokens = trimmed.split(/\s+/);
        for (const token of tokens) {
          if (!token.toLowerCase().startsWith('0x')) continue;

          try {
            const codePoint = parseInt(token, 16);
            if (!isNaN(codePoint) && codePoint <= BINARY_FORMAT.MAX_UNICODE) {
              unicodes.push(codePoint);
            }
          } catch {
            // Ignore parse errors
          }
        }
      } else if (fileType === CpFileType.STRING_FORMAT) {
        // Parse STRING format: extract each character's code point
        for (const char of trimmed) {
          const codePoint = char.codePointAt(0);
          if (codePoint !== undefined && codePoint <= BINARY_FORMAT.MAX_UNICODE) {
            unicodes.push(codePoint);
          }
        }
      }
    }

    return unicodes;
  }

  /**
   * Resolve CodePage file path
   *
   * Searches in common locations:
   * - Direct path (if codePage contains path separator)
   * - ./CodePage/
   * - ../CodePage/
   * - Relative to config file
   *
   * @param codePage - CodePage name (e.g., "CP1252", "1252") or path
   * @param basePath - Base path for resolution (config file directory)
   * @returns Resolved file path or null if not found
   */
  static resolveCodePagePath(codePage: string, basePath: string): string | null {
    // If codePage contains path separator, treat as direct path
    if (codePage.includes('/') || codePage.includes('\\')) {
      const directPath = path.isAbsolute(codePage) ? codePage : path.resolve(basePath, codePage);
      if (fs.existsSync(directPath)) {
        return directPath;
      }
      // Also try from cwd
      const cwdPath = path.resolve(process.cwd(), codePage);
      if (fs.existsSync(cwdPath)) {
        return cwdPath;
      }
      return null;
    }

    // Normalize codePage name (add CP prefix if needed)
    const cpName = codePage.toUpperCase().startsWith('CP')
      ? codePage.toUpperCase()
      : `CP${codePage}`;

    // Search paths
    const searchPaths = [
      path.join(basePath, 'CodePage', cpName),
      path.join(basePath, '..', 'CodePage', cpName),
      path.join(basePath, '..', '..', 'CodePage', cpName),
      path.join(process.cwd(), 'CodePage', cpName),
    ];

    for (const searchPath of searchPaths) {
      if (fs.existsSync(searchPath)) {
        return searchPath;
      }
    }

    return null;
  }
}
