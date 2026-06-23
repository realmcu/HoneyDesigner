/**
 * Font Parser Module
 *
 * Provides functionality to load and parse TrueType fonts (.ttf, .ttc)
 * using opentype.js library.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.6
 */

import * as opentype from 'opentype.js';
import * as fs from 'fs';
import {
  ErrorCode,
  FontConverterError,
  createFontFileNotFoundError,
  createFontParseError,
} from './errors';
import { PathUtils } from './path-utils';

/**
 * Font metrics extracted from TrueType font
 */
export interface FontMetrics {
  /** Font ascent (units per em) */
  ascent: number;
  /** Font descent (units per em, typically negative) */
  descent: number;
  /** Line gap (units per em) */
  lineGap: number;
  /** Units per em (typically 1000 or 2048) */
  unitsPerEm: number;
}

/**
 * Point in a glyph contour
 */
export interface ContourPoint {
  /** X coordinate */
  x: number;
  /** Y coordinate */
  y: number;
  /** Whether this is an on-curve point */
  onCurve: boolean;
}

/**
 * Bounding box for a glyph
 */
export interface BoundingBox {
  /** Minimum X coordinate */
  x1: number;
  /** Minimum Y coordinate */
  y1: number;
  /** Maximum X coordinate */
  x2: number;
  /** Maximum Y coordinate */
  y2: number;
}

/**
 * Glyph outline data for vector fonts
 */
export interface GlyphOutline {
  /** Unicode code point */
  unicode: number;
  /** Glyph bounding box */
  boundingBox: BoundingBox;
  /** Advance width */
  advanceWidth: number;
  /** Contours (windings) - each contour is an array of points */
  contours: ContourPoint[][];
}

/**
 * Parsed font data
 */
export interface ParsedFont {
  /** Font family name */
  familyName: string;
  /** Font subfamily name (e.g., "Regular", "Bold") */
  subfamilyName: string;
  /** Font metrics */
  metrics: FontMetrics;
  /** The underlying opentype.js Font object */
  opentypeFont: opentype.Font;
}

/**
 * FontParser class for loading and parsing TrueType fonts
 */
export class FontParser {
  private font: opentype.Font | null = null;
  private fontPath: string = '';

  /**
   * Load a TrueType font from file
   *
   * @param fontPath - Path to the .ttf or .ttc file
   * @param fontIndex - Index of font in collection (for .ttc files), default 0
   * @returns Parsed font data
   * @throws FontConverterError if file not found or parsing fails
   */
  async load(fontPath: string, fontIndex: number = 0): Promise<ParsedFont> {
    // Resolve to absolute path
    const absolutePath = PathUtils.resolve(fontPath);

    // Check if file exists
    if (!fs.existsSync(absolutePath)) {
      throw createFontFileNotFoundError(fontPath);
    }

    try {
      // Read file buffer
      const buffer = fs.readFileSync(absolutePath);
      const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      );

      // Check if it's a TTC file
      const isTTC = this.isTrueTypeCollection(buffer);

      if (isTTC) {
        this.font = this.loadFromCollection(arrayBuffer, fontIndex, fontPath);
      } else {
        // Parse as regular TTF
        this.font = opentype.parse(arrayBuffer);
      }

      this.fontPath = absolutePath;

      return this.getParsedFontData();
    } catch (error) {
      if (error instanceof FontConverterError) {
        throw error;
      }
      throw createFontParseError(fontPath, error as Error);
    }
  }

  /**
   * Check if a buffer contains a TrueType Collection
   */
  private isTrueTypeCollection(buffer: Buffer): boolean {
    // TTC files start with 'ttcf' signature
    if (buffer.length < 4) return false;
    const signature = buffer.toString('ascii', 0, 4);
    return signature === 'ttcf';
  }

  /**
   * Load a font from a TrueType Collection
   *
   * TTC Header Structure:
   * - 4 bytes: 'ttcf' tag
   * - 2 bytes: major version
   * - 2 bytes: minor version
   * - 4 bytes: number of fonts
   * - 4 bytes × numFonts: offset to each font's offset table
   */
  private loadFromCollection(
    arrayBuffer: ArrayBuffer,
    fontIndex: number,
    fontPath: string
  ): opentype.Font {
    const dataView = new DataView(arrayBuffer);

    // Read TTC header
    const numFonts = dataView.getUint32(8);

    if (fontIndex < 0 || fontIndex >= numFonts) {
      throw new FontConverterError(
        ErrorCode.FONT_COLLECTION_INDEX_ERROR,
        `Font index ${fontIndex} out of range. Collection contains ${numFonts} fonts.`,
        { filePath: fontPath, expected: `0-${numFonts - 1}`, actual: String(fontIndex) }
      );
    }

    // opentype.js doesn't support parsing at offset directly,
    // but it can handle TTC files by parsing from the beginning.
    // For TTC files, we parse the entire file and opentype.js
    // will use the first font. For specific font index support,
    // we would need to slice the buffer or use a different approach.
    //
    // Note: opentype.js 1.3.4 doesn't have built-in TTC support with index,
    // so we parse the whole file. The font at index 0 will be used.
    // For full TTC support with arbitrary index, consider using fontkit
    // or implementing manual offset-based parsing.

    if (fontIndex !== 0) {
      // opentype.js 1.3 does not support parsing TTC at an arbitrary font offset.
      // Rather than silently returning the wrong font (index 0), fail explicitly.
      throw new FontConverterError(
        ErrorCode.FONT_COLLECTION_INDEX_ERROR,
        `TTC font index ${fontIndex} is not supported. ` +
          `opentype.js only supports index 0. Collection contains ${numFonts} fonts.`,
        { filePath: fontPath, expected: '0', actual: String(fontIndex) }
      );
    }

    // Parse the font - opentype.js will parse the first font in the TTC
    return opentype.parse(arrayBuffer);
  }

  /**
   * Get the number of fonts in a TrueType Collection
   *
   * @param fontPath - Path to the .ttc file
   * @returns Number of fonts in the collection, or 1 for non-TTC files
   */
  static getFontCountInCollection(fontPath: string): number {
    const absolutePath = PathUtils.resolve(fontPath);

    if (!fs.existsSync(absolutePath)) {
      throw createFontFileNotFoundError(fontPath);
    }

    const buffer = fs.readFileSync(absolutePath);

    // Check if it's a TTC file
    if (buffer.length < 12) return 1;
    const signature = buffer.toString('ascii', 0, 4);
    if (signature !== 'ttcf') return 1;

    // Read number of fonts from TTC header
    const dataView = new DataView(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    );
    return dataView.getUint32(8);
  }

  /**
   * Check if a file is a TrueType Collection
   *
   * @param fontPath - Path to the font file
   * @returns true if the file is a TTC
   */
  static isTrueTypeCollectionFile(fontPath: string): boolean {
    const absolutePath = PathUtils.resolve(fontPath);

    if (!fs.existsSync(absolutePath)) {
      return false;
    }

    const buffer = fs.readFileSync(absolutePath, { encoding: null });
    if (buffer.length < 4) return false;

    const signature = buffer.toString('ascii', 0, 4);
    return signature === 'ttcf';
  }

  /**
   * Get parsed font data from loaded font
   */
  private getParsedFontData(): ParsedFont {
    if (!this.font) {
      throw new FontConverterError(ErrorCode.INTERNAL_ERROR, 'No font loaded');
    }

    const metrics = this.extractMetrics();

    return {
      familyName: this.font.names.fontFamily?.en || 'Unknown',
      subfamilyName: this.font.names.fontSubfamily?.en || 'Regular',
      metrics,
      opentypeFont: this.font,
    };
  }

  /**
   * Extract font metrics from loaded font
   *
   * @returns Font metrics (ascent, descent, lineGap, unitsPerEm)
   */
  extractMetrics(): FontMetrics {
    if (!this.font) {
      throw new FontConverterError(ErrorCode.INTERNAL_ERROR, 'No font loaded. Call load() first.');
    }

    return {
      ascent: this.font.ascender,
      descent: this.font.descender,
      lineGap: this.font.tables.hhea?.lineGap || 0,
      unitsPerEm: this.font.unitsPerEm,
    };
  }

  /**
   * Get glyph outline for a specific Unicode character
   *
   * @param unicode - Unicode code point
   * @param fontSize - Target font size in pixels (optional, for scaling)
   * @returns Glyph outline data or null if glyph not found
   */
  getGlyphOutline(unicode: number, fontSize?: number): GlyphOutline | null {
    if (!this.font) {
      throw new FontConverterError(ErrorCode.INTERNAL_ERROR, 'No font loaded. Call load() first.');
    }

    const glyph = this.font.charToGlyph(String.fromCodePoint(unicode));

    // Check if glyph exists (glyph index 0 is typically .notdef)
    if (!glyph || glyph.index === 0) {
      return null;
    }

    // Calculate scale factor if fontSize is provided
    // C++ uses: stbtt_ScaleForPixelHeight = height / (ascent - descent)
    let scale = 1.0;
    if (fontSize !== undefined) {
      const fheight = this.font.ascender - this.font.descender;
      scale = fontSize / fheight;
    }

    // Get bounding box and apply scale
    const bbox = glyph.getBoundingBox();
    const boundingBox: BoundingBox = {
      x1: Math.round(bbox.x1 * scale),
      y1: Math.round(bbox.y1 * scale),
      x2: Math.round(bbox.x2 * scale),
      y2: Math.round(bbox.y2 * scale),
    };

    // Extract contours from path with scale
    const contours = this.extractContours(glyph, scale);

    return {
      unicode,
      boundingBox,
      advanceWidth: Math.round((glyph.advanceWidth || 0) * scale),
      contours,
    };
  }

  /**
   * Extract contours from a glyph's path
   *
   * @param glyph - OpenType glyph
   * @param scale - Scale factor to apply to coordinates (default 1.0)
   */
  private extractContours(glyph: opentype.Glyph, scale: number = 1.0): ContourPoint[][] {
    const path = glyph.path;
    const contours: ContourPoint[][] = [];
    let currentContour: ContourPoint[] = [];

    for (const cmd of path.commands) {
      switch (cmd.type) {
        case 'M': // Move to - start new contour
          if (currentContour.length > 0) {
            contours.push(currentContour);
          }
          currentContour = [
            {
              x: Math.round(cmd.x * scale),
              y: Math.round(cmd.y * scale),
              onCurve: true,
            },
          ];
          break;

        case 'L': // Line to
          currentContour.push({
            x: Math.round(cmd.x * scale),
            y: Math.round(cmd.y * scale),
            onCurve: true,
          });
          break;

        case 'Q': // Quadratic curve
          // Add control point (off-curve)
          currentContour.push({
            x: Math.round(cmd.x1 * scale),
            y: Math.round(cmd.y1 * scale),
            onCurve: false,
          });
          // Add end point (on-curve)
          currentContour.push({
            x: Math.round(cmd.x * scale),
            y: Math.round(cmd.y * scale),
            onCurve: true,
          });
          break;

        case 'C': // Cubic curve (convert to quadratic approximation)
          // Add first control point
          currentContour.push({
            x: Math.round(cmd.x1 * scale),
            y: Math.round(cmd.y1 * scale),
            onCurve: false,
          });
          // Add second control point
          currentContour.push({
            x: Math.round(cmd.x2 * scale),
            y: Math.round(cmd.y2 * scale),
            onCurve: false,
          });
          // Add end point
          currentContour.push({
            x: Math.round(cmd.x * scale),
            y: Math.round(cmd.y * scale),
            onCurve: true,
          });
          break;

        case 'Z': // Close path
          // Contour is closed, push it
          if (currentContour.length > 0) {
            contours.push(currentContour);
            currentContour = [];
          }
          break;
      }
    }

    // Push any remaining contour
    if (currentContour.length > 0) {
      contours.push(currentContour);
    }

    return contours;
  }

  /**
   * Check if a glyph exists for a Unicode character
   *
   * @param unicode - Unicode code point
   * @returns true if glyph exists
   */
  hasGlyph(unicode: number): boolean {
    if (!this.font) {
      return false;
    }

    const glyph = this.font.charToGlyph(String.fromCodePoint(unicode));
    return glyph && glyph.index !== 0;
  }

  /**
   * Get the number of glyphs in the font
   */
  getGlyphCount(): number {
    if (!this.font) {
      return 0;
    }
    return this.font.numGlyphs;
  }

  /**
   * Get the font family name
   */
  getFamilyName(): string {
    if (!this.font) {
      return '';
    }
    return this.font.names.fontFamily?.en || 'Unknown';
  }

  /**
   * Get the underlying opentype.js Font object
   */
  getOpentypeFont(): opentype.Font | null {
    return this.font;
  }

  /**
   * Get the loaded font path
   */
  getFontPath(): string {
    return this.fontPath;
  }

  /**
   * Check if a font is loaded
   */
  isLoaded(): boolean {
    return this.font !== null;
  }

  /**
   * Unload the current font and free resources
   */
  unload(): void {
    this.font = null;
    this.fontPath = '';
  }
}

/**
 * Convenience function to load a font
 *
 * @param fontPath - Path to the font file
 * @param fontIndex - Index for TTC files (default 0)
 * @returns Parsed font data
 */
export async function loadFont(fontPath: string, fontIndex: number = 0): Promise<ParsedFont> {
  const parser = new FontParser();
  return parser.load(fontPath, fontIndex);
}

/**
 * Convenience function to extract metrics from a font file
 *
 * @param fontPath - Path to the font file
 * @returns Font metrics
 */
export async function extractFontMetrics(fontPath: string): Promise<FontMetrics> {
  const parser = new FontParser();
  const parsed = await parser.load(fontPath);
  return parsed.metrics;
}
