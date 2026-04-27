/**
 * Vector Font Generator
 *
 * Generates vector font files from TrueType fonts.
 * Stores glyph contours as windings (closed paths) with bounding box
 * and advance width information.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 5.5, 5.6, 9.2
 */

import * as fs from 'fs';
import { FontGenerator } from './font-generator';
import { FontConfig, IndexMethod } from './types';
import { VectorGlyphData } from './types/binary';
import { VectorFontHeader, VectorFontHeaderConfig } from './vector-font-header';
import { BinaryWriter } from './binary-writer';
import { GlyphOutline, ContourPoint } from './font-parser';
import { BINARY_FORMAT, FILE_NAMING } from './constants';
import { FontConverterError, ErrorCode, createFileWriteError } from './errors';
import { PathUtils } from './path-utils';

/**
 * Processed vector glyph with all data
 */
interface ProcessedVectorGlyph {
  /** Unicode code point */
  unicode: number;
  /** Glyph data */
  data: VectorGlyphData;
}

/**
 * Index entry for the index array
 */
interface IndexEntry {
  /** Unicode code point */
  unicode: number;
  /** File offset */
  offset: number;
}

/**
 * VectorFontGenerator class
 * Generates vector font files from TrueType fonts
 */
export class VectorFontGenerator extends FontGenerator {
  /** Processed glyphs */
  private glyphs: Map<number, ProcessedVectorGlyph> = new Map();

  /**
   * Creates a new VectorFontGenerator
   *
   * @param config - Font configuration
   */
  constructor(config: FontConfig) {
    super(config);
  }

  /**
   * Generate the vector font file
   *
   * Process:
   * 1. Load font
   * 2. Load character set
   * 3. Extract all glyph outlines
   * 4. Create header
   * 5. Create index array
   * 6. Write binary file
   * 7. Write character set file
   * 8. Write failed characters file (if any)
   */
  async generate(): Promise<void> {
    try {
      // 校验 fontSize：必须为正数（Requirements: 2.3）
      if (this.config.fontSize <= 0) {
        throw new FontConverterError(
          ErrorCode.CONFIG_VALIDATION_ERROR,
          `Invalid fontSize: ${this.config.fontSize}. fontSize must be greater than 0.`,
          { fieldName: 'fontSize', expected: '> 0', actual: String(this.config.fontSize) }
        );
      }

      // Load font and character set
      await this.loadFont();
      await this.loadCharacterSet();

      // Ensure output directory exists
      await this.ensureOutputDirectory();

      // Extract all glyph outlines
      await this.extractAllGlyphs();

      // Generate output filename
      const baseName = this.generateOutputBaseName();

      // Create header
      const header = this.createHeader();

      // Create index array
      const indexArray = this.createIndexArray();

      // Write binary file
      const binPath = PathUtils.join(this.config.outputPath, baseName + '.bin');
      this.trackPartialFile(binPath);
      await this.writeBinaryFile(baseName, header, indexArray);

      // Write character set file
      const cstPath = PathUtils.join(this.config.outputPath, baseName + '.cst');
      this.trackPartialFile(cstPath);
      await this.writeCharacterSetFile(baseName);

      // Write failed characters file
      if (this.failedCharacters.length > 0) {
        const failedPath = PathUtils.join(
          this.config.outputPath,
          FILE_NAMING.UNSUPPORTED_CHARS_FILE
        );
        this.trackPartialFile(failedPath);
        await this.writeFailedCharactersFile();
      }

      // Clear partial file tracking on success
      this.partialOutputFiles = [];
    } catch (error) {
      // Clean up partial files on error
      this.cleanupPartialFiles();
      throw error;
    }
  }

  /**
   * Extract all glyph outlines in the character set
   *
   * IMPORTANT: Failed characters are recorded in this.failedCharacters
   * but are NOT removed from this.characters. This ensures that the
   * CST file will contain all requested characters, matching C++ behavior.
   *
   * C++ Reference: GenerateVectorFont() in fontDictionary_o.cpp
   * - CST is written before glyph extraction
   * - Failed extractions go to NotSupportedChars.txt
   * - But all requested characters stay in CST
   *
   * Requirements: 1.1, 1.2
   */
  private async extractAllGlyphs(): Promise<void> {
    for (const unicode of this.characters) {
      try {
        const glyph = await this.extractGlyph(unicode);
        if (glyph) {
          this.glyphs.set(unicode, glyph);
        } else {
          this.recordFailedCharacter(unicode);
        }
      } catch (error) {
        // Record failed character and continue
        this.recordFailedCharacter(unicode);
      }
    }
  }

  /**
   * Extract a single glyph outline
   *
   * For glyphs with contours (most visible characters), extracts full outline data.
   * For glyphs without contours but with a valid advance (e.g., space U+0020),
   * creates an advance-only FontGlyphData entry with empty bounding box and zero windings.
   *
   * @param unicode - Unicode code point
   * @returns Processed glyph or null if extraction failed
   *
   * Requirements: 15.3
   */
  private async extractGlyph(unicode: number): Promise<ProcessedVectorGlyph | null> {
    if (!this.parsedFont) {
      return null;
    }

    // Get glyph outline from font parser WITHOUT scaling
    // C++ stores vector fonts in original font units (not scaled to pixel space)
    // The fontSize is only stored in the header for reference
    const outline = this.fontParser.getGlyphOutline(unicode);

    if (!outline) {
      return null;
    }

    // Handle glyphs with no contours (e.g., space U+0020)
    // These glyphs have a valid advance width but no visible outlines.
    // We still need to include them in the output so the renderer can use
    // the font-defined advance value for spacing (Requirements: 15.3).
    if (outline.contours.length === 0) {
      const data: VectorGlyphData = {
        sx0: 0,
        sy0: 0,
        sx1: 0,
        sy1: 0,
        advance: outline.advanceWidth,
        windingCount: 0,
        windingLengths: [],
        windings: [],
      };

      return {
        unicode,
        data,
      };
    }

    // Convert outline to vector glyph data
    const data = await this.convertOutlineToVectorData(outline);

    return {
      unicode,
      data,
    };
  }

  /**
   * Convert glyph outline to vector glyph data format
   *
   * IMPORTANT: C++ uses stbtt_GetGlyphBitmapBox which flips Y axis:
   * - iy0 = floor(-y1)  (negate and swap)
   * - iy1 = ceil(-y0)
   *
   * Process:
   * 1. Flatten Bezier curves to line segments
   * 2. Remove overlapping contours (for fonts with overlapping outlines)
   * 3. Convert to binary format
   *
   * @param outline - Glyph outline from font parser
   * @returns Vector glyph data
   */
  /**
   * Convert glyph outline to vector glyph data format
   *
   * IMPORTANT: C++ uses stbtt_GetGlyphBitmapBox which flips Y axis:
   * - iy0 = floor(-y1)  (negate and swap)
   * - iy1 = ceil(-y0)
   *
   * Process:
   * 1. Flatten Bezier curves to line segments
   * 2. Remove overlapping contours (for fonts with overlapping outlines)
   * 3. Convert to binary format
   *
   * @param outline - Glyph outline from font parser
   * @returns Vector glyph data
   */
  private async convertOutlineToVectorData(outline: GlyphOutline): Promise<VectorGlyphData> {
    const { boundingBox, advanceWidth, contours } = outline;

    // Apply Y-axis flip to match C++ stbtt_GetGlyphBitmapBox behavior
    // C++: iy0 = floor(-y1), iy1 = ceil(-y0)
    const sx0 = Math.floor(boundingBox.x1);
    const sy0 = Math.floor(-boundingBox.y2); // Negate y2 (top)
    const sx1 = Math.ceil(boundingBox.x2);
    const sy1 = Math.ceil(-boundingBox.y1); // Negate y1 (bottom)

    // Calculate flatness tolerance to match C++ stbtt_FlattenCurves behavior
    // C++: flatness = 1.0f / (scale * renderMode)
    // where scale = stbtt_ScaleForPixelHeight = fontSize / (ascent - descent)
    const flatness = this.calculateFlatness();

    // Step 1: Flatten curves to line segments
    const flattenedContours = contours.map((contour) => this.flattenContour(contour, flatness));

    // Filter out invalid contours (less than 3 points)
    const processedContours = flattenedContours.filter((c) => c.length >= 3);

    // Prepare winding data
    const windingCount = processedContours.length;
    const windingLengths: number[] = [];
    const windings: number[] = [];

    // Process each contour (winding)
    for (const contour of processedContours) {
      windingLengths.push(contour.length);

      // Add all points from this contour
      for (const point of contour) {
        windings.push(point.x);
        windings.push(point.y);
      }
    }

    return {
      sx0,
      sy0,
      sx1,
      sy1,
      advance: advanceWidth,
      windingCount,
      windingLengths,
      windings,
    };
  }

  /**
   * Calculate flatness tolerance to match C++ stbtt_FlattenCurves behavior
   *
   * C++ uses: flatness = 1.0f / (scale * renderMode)
   * where scale = stbtt_ScaleForPixelHeight = fontSize / (ascent - descent)
   *
   * Since vector fonts store coordinates in original font units (no scaling),
   * the flatness must account for the font's coordinate space.
   * A larger flatness value means fewer line segments (coarser approximation).
   *
   * @returns Flatness tolerance value
   */
  private calculateFlatness(): number {
    if (!this.parsedFont) {
      return 1.0; // Fallback
    }

    const { ascent, descent } = this.parsedFont.metrics;
    const fontSize = this.config.fontSize;
    const renderMode = this.config.renderMode;

    // C++: scale = stbtt_ScaleForPixelHeight = fontSize / (ascent - descent)
    const scale = fontSize / (ascent - descent);

    // C++: flatness = 1.0f / (scale * renderMode)
    return 1.0 / (scale * renderMode);
  }

  /**
   * Flatten a contour with Bezier curves to line segments
   *
   * @param contour - Contour with on-curve and off-curve points
   * @returns Flattened contour with only line segment endpoints
   */
  private flattenContour(
    contour: ContourPoint[],
    tolerance: number = 1.0
  ): Array<{ x: number; y: number }> {
    if (contour.length < 2) {
      return contour.map((p) => ({ x: p.x, y: p.y }));
    }

    const result: Array<{ x: number; y: number }> = [];
    let i = 0;

    while (i < contour.length) {
      const current = contour[i];

      if (current.onCurve) {
        result.push({ x: current.x, y: current.y });
        i++;
      } else {
        // Off-curve point - need to find curve segment
        // Look back for start point
        const startIdx = result.length > 0 ? result.length - 1 : 0;
        const start =
          result.length > 0
            ? result[startIdx]
            : { x: contour[contour.length - 1].x, y: contour[contour.length - 1].y };

        // Collect consecutive off-curve points
        const controlPoints: Array<{ x: number; y: number }> = [];
        while (i < contour.length && !contour[i].onCurve) {
          controlPoints.push({ x: contour[i].x, y: contour[i].y });
          i++;
        }

        // Find end point
        const end =
          i < contour.length
            ? { x: contour[i].x, y: contour[i].y }
            : { x: contour[0].x, y: contour[0].y };

        // Flatten the curve(s)
        if (controlPoints.length === 1) {
          // Quadratic Bezier
          this.flattenQuadratic(start, controlPoints[0], end, result, tolerance);
        } else if (controlPoints.length === 2) {
          // Cubic Bezier
          this.flattenCubic(start, controlPoints[0], controlPoints[1], end, result, tolerance);
        } else {
          // Multiple control points - split into quadratics with implied on-curve points
          let currentStart = start;
          for (let j = 0; j < controlPoints.length - 1; j++) {
            const cp = controlPoints[j];
            const nextCp = controlPoints[j + 1];
            const impliedEnd = {
              x: Math.round((cp.x + nextCp.x) / 2),
              y: Math.round((cp.y + nextCp.y) / 2),
            };
            this.flattenQuadratic(currentStart, cp, impliedEnd, result, tolerance);
            currentStart = impliedEnd;
          }
          // Last segment
          this.flattenQuadratic(
            currentStart,
            controlPoints[controlPoints.length - 1],
            end,
            result,
            tolerance
          );
        }

        // Add end point if on-curve
        if (i < contour.length && contour[i].onCurve) {
          result.push(end);
          i++;
        }
      }
    }

    // Remove duplicate consecutive points
    return this.removeDuplicatePoints(result);
  }

  /**
   * Flatten quadratic Bezier curve
   */
  private flattenQuadratic(
    p0: { x: number; y: number },
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    result: Array<{ x: number; y: number }>,
    tolerance: number = 1.0
  ): void {
    // Check if flat enough
    const dx = p2.x - p0.x;
    const dy = p2.y - p0.y;
    const d =
      Math.abs((p1.x - p0.x) * dy - (p1.y - p0.y) * dx) / Math.sqrt(dx * dx + dy * dy + 0.0001);

    if (d <= tolerance) {
      return; // Flat enough, end point will be added by caller
    }

    // Subdivide at t=0.5
    const mid01 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    const mid12 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const mid = { x: (mid01.x + mid12.x) / 2, y: (mid01.y + mid12.y) / 2 };

    this.flattenQuadratic(p0, mid01, mid, result, tolerance);
    result.push({ x: Math.round(mid.x), y: Math.round(mid.y) });
    this.flattenQuadratic(mid, mid12, p2, result, tolerance);
  }

  /**
   * Flatten cubic Bezier curve
   */
  private flattenCubic(
    p0: { x: number; y: number },
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    p3: { x: number; y: number },
    result: Array<{ x: number; y: number }>,
    tolerance: number = 1.0
  ): void {
    // Check if flat enough
    const dx = p3.x - p0.x;
    const dy = p3.y - p0.y;
    const len = Math.sqrt(dx * dx + dy * dy + 0.0001);
    const d1 = Math.abs((p1.x - p0.x) * dy - (p1.y - p0.y) * dx) / len;
    const d2 = Math.abs((p2.x - p0.x) * dy - (p2.y - p0.y) * dx) / len;

    if (Math.max(d1, d2) <= tolerance) {
      return; // Flat enough
    }

    // Subdivide at t=0.5 using de Casteljau
    const mid01 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    const mid12 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const mid23 = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
    const mid012 = { x: (mid01.x + mid12.x) / 2, y: (mid01.y + mid12.y) / 2 };
    const mid123 = { x: (mid12.x + mid23.x) / 2, y: (mid12.y + mid23.y) / 2 };
    const mid = { x: (mid012.x + mid123.x) / 2, y: (mid012.y + mid123.y) / 2 };

    this.flattenCubic(p0, mid01, mid012, mid, result, tolerance);
    result.push({ x: Math.round(mid.x), y: Math.round(mid.y) });
    this.flattenCubic(mid, mid123, mid23, p3, result, tolerance);
  }

  /**
   * Remove duplicate consecutive points
   */
  private removeDuplicatePoints(
    points: Array<{ x: number; y: number }>
  ): Array<{ x: number; y: number }> {
    if (points.length < 2) return points;

    const result: Array<{ x: number; y: number }> = [points[0]];
    for (let i = 1; i < points.length; i++) {
      if (points[i].x !== points[i - 1].x || points[i].y !== points[i - 1].y) {
        result.push(points[i]);
      }
    }
    return result;
  }

  /**
   * Create the vector font header
   *
   * 从 parsedFont.metrics 提取 unitsPerEm 并传入 VectorFontHeaderConfig。
   * 校验 unitsPerEm > 0，否则报错中止。
   *
   * Requirements: 2.1, 2.3, 14.1, 14.2
   */
  private createHeader(): VectorFontHeader {
    if (!this.parsedFont) {
      throw new Error('Font not loaded');
    }

    // 校验 unitsPerEm：必须为正数（Requirements: 14.1, 14.2）
    const unitsPerEm = this.parsedFont.metrics.unitsPerEm;
    if (!unitsPerEm || unitsPerEm <= 0) {
      throw new FontConverterError(
        ErrorCode.FONT_PARSE_ERROR,
        `Invalid unitsPerEm: ${unitsPerEm}. Font must have unitsPerEm > 0.`,
        {
          fieldName: 'unitsPerEm',
          expected: '> 0',
          actual: String(unitsPerEm),
          details: 'unitsPerEm is required for V3 standard typography format',
        }
      );
    }

    const config: VectorFontHeaderConfig = {
      fontName: this.getFontName(),
      fontSize: this.config.fontSize,
      renderMode: 0, // Unused for vector fonts
      bold: this.config.bold,
      italic: this.config.italic,
      indexMethod: this.config.indexMethod,
      ascent: this.parsedFont.metrics.ascent,
      descent: this.parsedFont.metrics.descent,
      lineGap: this.parsedFont.metrics.lineGap,
      unitsPerEm: unitsPerEm,
      characterCount: this.glyphs.size,
    };

    return new VectorFontHeader(config);
  }

  /**
   * Create the index array based on index method
   *
   * Index modes for vector fonts:
   * 1. indexMethod=ADDRESS: 65536 × 4 bytes (file offsets)
   * 2. indexMethod=OFFSET: N × 6 bytes (unicode + file offset)
   *
   * Vector fonts use file offsets (not character indices) because glyph data sizes vary.
   */
  private createIndexArray(): IndexEntry[] {
    const entries: IndexEntry[] = [];

    if (this.config.indexMethod === IndexMethod.ADDRESS) {
      // Address mode: 65536 entries with file offsets
      // Initialize all entries with 0x00000000 (unused)
      for (let i = 0; i < BINARY_FORMAT.MAX_INDEX_SIZE; i++) {
        entries.push({ unicode: i, offset: 0 });
      }

      // Offsets will be calculated and updated during write
    } else {
      // Offset mode: N entries with unicode + file offset
      // Sort by unicode for consistent output
      const sortedUnicodes = Array.from(this.glyphs.keys()).sort((a, b) => a - b);

      for (const unicode of sortedUnicodes) {
        entries.push({ unicode, offset: 0 }); // Offset will be calculated during write
      }
    }

    return entries;
  }

  /**
   * Generate output base name for files
   * Format: [fontName]_vector
   */
  private generateOutputBaseName(): string {
    const fontName = this.getFontName();
    return `${fontName}_vector`;
  }

  /**
   * Generate output filename
   * Format: [fontName]_vector.bin
   */
  generateOutputFilename(): string {
    return this.generateOutputBaseName() + '.bin';
  }

  /**
   * Write the binary font file
   */
  private async writeBinaryFile(
    baseName: string,
    header: VectorFontHeader,
    indexArray: IndexEntry[]
  ): Promise<void> {
    const filePath = PathUtils.join(this.config.outputPath, baseName + '.bin');

    // Calculate total file size
    const headerSize = header.getSize();
    const indexSize = header.indexAreaSize;

    // Calculate glyph data size
    let glyphDataSize = 0;
    for (const glyph of this.glyphs.values()) {
      glyphDataSize += this.calculateGlyphDataSize(glyph.data);
    }

    const totalSize = headerSize + indexSize + glyphDataSize;
    const writer = new BinaryWriter(totalSize);

    // Write header
    const headerBytes = header.toBytes();
    writer.writeBytes(headerBytes);

    // Write index array (placeholder values)
    const indexStartOffset = writer.getOffset();
    this.writeIndexArray(writer, indexArray);

    // Write glyph data and update index array with file offsets
    writer.getOffset(); // glyphDataStartOffset - advance past index
    await this.writeGlyphData(writer, indexArray, indexStartOffset);

    // Write to file
    try {
      fs.writeFileSync(filePath, writer.getBuffer());
    } catch (error) {
      throw createFileWriteError(filePath, error as Error);
    }
  }

  /**
   * Calculate the size of a glyph's data in bytes
   *
   * IMPORTANT: C++ uses uint8 for winding_count and winding_lengths
   */
  private calculateGlyphDataSize(data: VectorGlyphData): number {
    let size = 0;
    size += 2; // sx0 (int16)
    size += 2; // sy0 (int16)
    size += 2; // sx1 (int16)
    size += 2; // sy1 (int16)
    size += 2; // advance (uint16)
    size += 1; // windingCount (uint8 - C++ compatibility)
    size += data.windingCount * 1; // windingLengths (uint8 each - C++ compatibility)
    size += data.windings.length * 2; // points (int16 each)
    return size;
  }

  /**
   * Write the index array to the binary writer
   *
   * Vector fonts use file offsets in both modes because glyph data sizes vary.
   *
   * IMPORTANT: Unused entries must be 0xFFFFFFFF (not 0x00000000) for C++ compatibility
   */
  private writeIndexArray(writer: BinaryWriter, indexArray: IndexEntry[]): void {
    if (this.config.indexMethod === IndexMethod.ADDRESS) {
      // Address mode: 65536 × 4 bytes (uint32 file offsets)
      // Initially write 0xFFFFFFFF for unused entries (C++ compatibility)
      for (let i = 0; i < BINARY_FORMAT.MAX_INDEX_SIZE; i++) {
        writer.writeUint32LE(0xffffffff);
      }
    } else {
      // Offset mode: N × 6 bytes (uint16 unicode + uint32 offset)
      // Write placeholder values
      for (const entry of indexArray) {
        writer.writeUint16LE(entry.unicode);
        writer.writeUint32LE(0); // Placeholder offset
      }
    }
  }

  /**
   * Write glyph data to the binary writer
   * Also updates the index array with file offsets
   */
  private async writeGlyphData(
    writer: BinaryWriter,
    indexArray: IndexEntry[],
    indexStartOffset: number
  ): Promise<void> {
    // Sort glyphs by unicode for consistent output
    const sortedGlyphs = Array.from(this.glyphs.entries()).sort((a, b) => a[0] - b[0]);

    for (let i = 0; i < sortedGlyphs.length; i++) {
      const [unicode, glyph] = sortedGlyphs[i];
      const glyphOffset = writer.getOffset();

      // Update index array with file offset
      if (this.config.indexMethod === IndexMethod.ADDRESS) {
        // Address mode: update entry at unicode position
        const indexOffset = indexStartOffset + unicode * 4;
        writer.writeUint32LEAt(indexOffset, glyphOffset);
      } else {
        // Offset mode: update entry at position i
        const indexOffset = indexStartOffset + i * 6 + 2; // +2 to skip unicode field
        writer.writeUint32LEAt(indexOffset, glyphOffset);
      }

      // Write glyph data
      this.writeGlyphDataFields(writer, glyph.data);
    }
  }

  /**
   * Write glyph data fields to the binary writer
   *
   * IMPORTANT: C++ uses uint8 for winding_count and winding_lengths (not uint16)
   */
  private writeGlyphDataFields(writer: BinaryWriter, data: VectorGlyphData): void {
    // Write bounding box (4 × int16)
    writer.writeInt16LE(data.sx0);
    writer.writeInt16LE(data.sy0);
    writer.writeInt16LE(data.sx1);
    writer.writeInt16LE(data.sy1);

    // Write advance width (uint16)
    writer.writeUint16LE(data.advance);

    // Write winding count (uint8 - C++ compatibility)
    writer.writeUint8(data.windingCount);

    // Write winding lengths (uint8 each - C++ compatibility)
    for (const length of data.windingLengths) {
      writer.writeUint8(length);
    }

    // Write all points (int16 each)
    for (const coord of data.windings) {
      writer.writeInt16LE(coord);
    }
  }

  /**
   * Get the number of successfully extracted glyphs
   */
  getGlyphCount(): number {
    return this.glyphs.size;
  }
}
