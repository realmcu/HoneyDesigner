/**
 * Cross-platform path utilities
 *
 * This module provides utilities for handling file paths consistently
 * across Windows, macOS, and Linux platforms.
 *
 * Requirements: 1.5, 10.2
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Path utilities for cross-platform compatibility
 */
export class PathUtils {
  /**
   * Normalizes a file path to use the platform-specific separator
   *
   * @param filePath - Path to normalize
   * @returns Normalized path
   */
  public static normalize(filePath: string): string {
    // Normalize backslashes to forward slashes first for cross-platform consistency,
    // then let path.normalize handle . and .. resolution
    return path.normalize(filePath.replace(/\\/g, '/'));
  }

  /**
   * Joins path segments using the platform-specific separator
   *
   * @param segments - Path segments to join
   * @returns Joined path
   */
  public static join(...segments: string[]): string {
    return path.join(...segments);
  }

  /**
   * Resolves a path to an absolute path
   * Relative paths are resolved relative to the current working directory
   *
   * @param filePath - Path to resolve
   * @returns Absolute path
   */
  public static resolve(filePath: string): string {
    return path.resolve(filePath);
  }

  /**
   * Resolves a path relative to a base directory
   *
   * @param basePath - Base directory path
   * @param relativePath - Relative path to resolve
   * @returns Absolute path
   */
  public static resolveRelative(basePath: string, relativePath: string): string {
    if (path.isAbsolute(relativePath)) {
      return relativePath;
    }
    return path.resolve(basePath, relativePath);
  }

  /**
   * Checks if a path is absolute
   *
   * @param filePath - Path to check
   * @returns True if path is absolute
   */
  public static isAbsolute(filePath: string): boolean {
    return path.isAbsolute(filePath);
  }

  /**
   * Gets the directory name from a path
   *
   * @param filePath - File path
   * @returns Directory name
   */
  public static dirname(filePath: string): string {
    return path.dirname(filePath);
  }

  /**
   * Gets the base name (filename) from a path
   *
   * @param filePath - File path
   * @param ext - Optional extension to remove
   * @returns Base name
   */
  public static basename(filePath: string, ext?: string): string {
    return path.basename(filePath, ext);
  }

  /**
   * Gets the file extension from a path
   *
   * @param filePath - File path
   * @returns File extension (including the dot)
   */
  public static extname(filePath: string): string {
    return path.extname(filePath);
  }

  /**
   * Converts a path to use forward slashes (Unix-style)
   * Useful for consistent path representation in logs or comparisons
   *
   * @param filePath - Path to convert
   * @returns Path with forward slashes
   */
  public static toUnixStyle(filePath: string): string {
    return filePath.replace(/\\/g, '/');
  }

  /**
   * Converts a path to use the platform-specific separator
   *
   * @param filePath - Path to convert
   * @returns Path with platform-specific separators
   */
  public static toPlatformStyle(filePath: string): string {
    return filePath.split(/[/\\]/).join(path.sep);
  }

  /**
   * Checks if a file or directory exists
   *
   * @param filePath - Path to check
   * @returns True if path exists
   */
  public static exists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  /**
   * Checks if a path points to a directory
   *
   * @param filePath - Path to check
   * @returns True if path is a directory
   */
  public static isDirectory(filePath: string): boolean {
    try {
      return fs.statSync(filePath).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Checks if a path points to a file
   *
   * @param filePath - Path to check
   * @returns True if path is a file
   */
  public static isFile(filePath: string): boolean {
    try {
      return fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  }

  /**
   * Creates a directory recursively (like mkdir -p)
   *
   * @param dirPath - Directory path to create
   */
  public static mkdirRecursive(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  /**
   * Gets the relative path from one path to another
   *
   * @param from - Source path
   * @param to - Target path
   * @returns Relative path
   */
  public static relative(from: string, to: string): string {
    return path.relative(from, to);
  }

  /**
   * Parses a path into its components
   *
   * @param filePath - Path to parse
   * @returns Path components (root, dir, base, ext, name)
   */
  public static parse(filePath: string): path.ParsedPath {
    return path.parse(filePath);
  }

  /**
   * Formats a path from components
   *
   * @param pathObject - Path components
   * @returns Formatted path
   */
  public static format(pathObject: path.FormatInputPathObject): string {
    return path.format(pathObject);
  }

  /**
   * Gets the platform-specific path separator
   *
   * @returns Path separator ('/' on Unix, '\' on Windows)
   */
  public static get separator(): string {
    return path.sep;
  }

  /**
   * Gets the platform-specific path delimiter
   *
   * @returns Path delimiter (':' on Unix, ';' on Windows)
   */
  public static get delimiter(): string {
    return path.delimiter;
  }

  /**
   * Gets the platform-specific line ending
   *
   * @returns Line ending ('\n' on Unix, '\r\n' on Windows)
   */
  public static get lineEnding(): string {
    return os.EOL;
  }

  /**
   * Normalizes line endings in text to platform-specific format
   *
   * @param text - Text to normalize
   * @returns Text with platform-specific line endings
   */
  public static normalizeLineEndings(text: string): string {
    // Replace all line endings with platform-specific ones
    return text.replace(/\r\n|\r|\n/g, os.EOL);
  }

  /**
   * Converts line endings to Unix format (\n)
   *
   * @param text - Text to convert
   * @returns Text with Unix line endings
   */
  public static toUnixLineEndings(text: string): string {
    return text.replace(/\r\n|\r/g, '\n');
  }

  /**
   * Converts line endings to Windows format (\r\n)
   *
   * @param text - Text to convert
   * @returns Text with Windows line endings
   */
  public static toWindowsLineEndings(text: string): string {
    // First normalize to \n, then convert to \r\n
    return text.replace(/\r\n|\r|\n/g, '\r\n');
  }

  /**
   * Splits text by lines, handling different line ending formats
   *
   * @param text - Text to split
   * @returns Array of lines
   */
  public static splitLines(text: string): string[] {
    return text.split(/\r\n|\r|\n/);
  }

  /**
   * Joins lines with platform-specific line endings
   *
   * @param lines - Lines to join
   * @returns Joined text with platform-specific line endings
   */
  public static joinLines(lines: string[]): string {
    return lines.join(os.EOL);
  }
}
