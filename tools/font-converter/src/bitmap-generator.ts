/**
 * Bitmap Font Generator (V3 — bearing-based tight bbox)
 *
 * Generates bitmap font files from TrueType fonts using V3 format:
 * - 10-byte GlyphHeaderV3 per glyph (bearingX, bearingY, width, height, advance; all int16/uint16)
 * - Tight bounding box bitmap (no canvas padding)
 * - Typography metrics in header extension (ascender, descender, lineGap, unitsPerEm)
 *
 * Supports multiple render modes (1/2/4/8-bit), styles (bold, italic),
 * gamma correction.
 */

import * as fs from 'fs';
import * as opentype from 'opentype.js';
import { FontGenerator } from './font-generator';
import { FontConfig, IndexMethod } from './types';
import { GlyphHeaderV3 } from './types/binary';
import {
  BitmapFontHeader,
  BitmapFontHeaderConfig,
  calculateStandardDimensions,
} from './bitmap-font-header';
import { BinaryWriter } from './binary-writer';
import { ImageProcessor } from './image-processor';
import { BINARY_FORMAT, FILE_NAMING } from './constants';
import { createFileWriteError } from './errors';
import { PathUtils } from './path-utils';

/** On-disk size of a V3.2 glyph header: int16 ×2 + uint16 ×3 = 10 bytes */
const GLYPH_HEADER_V3_SIZE = 10;

/** Clamp to the int16 range [-32768, 32767] (bearings). */
function clampInt16(value: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}

/** Clamp to the uint16 range [0, 65535] (width / height / advance). */
function clampUint16(value: number): number {
  return Math.max(0, Math.min(65535, Math.round(value)));
}

/**
 * Index entry for the index array
 */
interface IndexEntry {
  /** Unicode code point */
  unicode: number;
  /** Character index or file offset depending on mode */
  value: number;
}

/**
 * Processed glyph with bearing-based metrics
 */
interface ProcessedGlyph {
  /** Unicode code point */
  unicode: number;
  /** V3 glyph header with bearing metrics */
  header: GlyphHeaderV3;
  /** Packed tight bbox pixel data */
  pixelData: Uint8Array;
}

/**
 * BitmapFontGenerator class
 * Generates bitmap font files from TrueType fonts (V3 format)
 */
export class BitmapFontGenerator extends FontGenerator {
  /** Processed glyphs (bearing-based) */
  private glyphs: Map<number, ProcessedGlyph> = new Map();

  /** Base glyph size (width and height, aligned to 8-pixel boundaries) */
  private baseGlyphWidth: number = 0;
  private baseGlyphHeight: number = 0;

  /** Back size (canvas height derived from font metrics) */
  private backSize: number = 0;

  constructor(config: FontConfig) {
    super(config);
  }

  /**
   * Generate the bitmap font file
   */
  async generate(): Promise<void> {
    try {
      await this.loadFont();
      await this.loadCharacterSet();
      await this.ensureOutputDirectory();

      this.calculateBaseGlyphDimensions();
      await this.renderAllGlyphs();

      const baseName = this.generateOutputBaseName();
      const header = this.createHeader();
      const indexArray = this.createIndexArray();

      const binPath = PathUtils.join(this.config.outputPath, baseName + '.bin');
      this.trackPartialFile(binPath);
      await this.writeBinaryFile(baseName, header, indexArray);

      const cstPath = PathUtils.join(this.config.outputPath, baseName + '.cst');
      this.trackPartialFile(cstPath);
      await this.writeCharacterSetFile(baseName);

      if (this.failedCharacters.length > 0) {
        const failedPath = PathUtils.join(
          this.config.outputPath,
          FILE_NAMING.UNSUPPORTED_CHARS_FILE
        );
        this.trackPartialFile(failedPath);
        await this.writeFailedCharactersFile();
      }

      this.partialOutputFiles = [];
    } catch (error) {
      this.cleanupPartialFiles();
      throw error;
    }
  }

  /**
   * Calculate base glyph dimensions.
   * V2: renderSize = fontSize (no shrink), backSize = ceil(fontSize * (asc-desc) / upm)
   */
  private calculateBaseGlyphDimensions(): void {
    const fontSize = this.config.fontSize;

    if (this.parsedFont) {
      const { ascent: ascender, descent: descender, unitsPerEm } = this.parsedFont.metrics;
      const { backSize } = calculateStandardDimensions(fontSize, unitsPerEm, ascender, descender);
      this.backSize = backSize;
    } else {
      this.backSize = fontSize;
    }

    const [alignedWidth, alignedHeight] = ImageProcessor.adjustDimensionsForAlignment(
      this.backSize,
      this.backSize
    );

    this.baseGlyphWidth = alignedWidth;
    this.baseGlyphHeight = alignedHeight;
  }

  /**
   * Render all glyphs in the character set
   */
  private async renderAllGlyphs(): Promise<void> {
    for (const unicode of this.characters) {
      try {
        const glyph = this.processGlyph(unicode);
        if (glyph) {
          this.glyphs.set(unicode, glyph);
        } else {
          this.recordFailedCharacter(unicode);
        }
      } catch (error) {
        this.recordFailedCharacter(unicode);
      }
    }
  }

  /**
   * Process a single glyph (bearing-based V3)
   *
   * Renders the glyph at fontSize (em-size), computes tight bounding box,
   * extracts bearing metrics from opentype.js, and packs the tight bbox bitmap.
   *
   * @param unicode - Unicode code point
   * @returns ProcessedGlyph or null if rendering failed
   */
  private processGlyph(unicode: number): ProcessedGlyph | null {
    if (!this.parsedFont) {
      return null;
    }

    const font = this.parsedFont.opentypeFont;
    const glyph = font.charToGlyph(String.fromCodePoint(unicode));

    if (!glyph || glyph.index === 0) {
      return null;
    }

    const fontSize = this.config.fontSize;
    const unitsPerEm = font.unitsPerEm;
    const scale = fontSize / unitsPerEm;

    // Extract bearing metrics from opentype.js glyph bounding box
    const bbox = glyph.getBoundingBox();
    const rawBearingX = Math.round(bbox.x1 * scale);
    const rawBearingY = Math.round(bbox.y2 * scale);
    const rawAdvance = Math.round((glyph.advanceWidth || 0) * scale);

    // Render glyph to bitmap at fontSize (em-size)
    let { pixels, width, height } = this.renderGlyphToBitmap(glyph, fontSize, unitsPerEm);

    if (width === 0 || height === 0) {
      // Empty glyph (like space)
      const header: GlyphHeaderV3 = {
        bearingX: clampInt16(rawBearingX),
        bearingY: clampInt16(rawBearingY),
        width: 0,
        height: 0,
        advance: clampUint16(rawAdvance),
      };
      return { unicode, header, pixelData: new Uint8Array(0) };
    }

    // Apply gamma correction
    if (this.config.gamma !== 1.0) {
      pixels = ImageProcessor.applyGamma(pixels, width, height, this.config.gamma);
    }

    // Apply bold effect
    if (this.config.bold) {
      const result = ImageProcessor.applyBold(pixels, width, height);
      pixels = result.pixels;
      width = result.width;
      height = result.height;
    }

    // Apply italic effect
    if (this.config.italic) {
      const result = ImageProcessor.applyItalic(pixels, width, height);
      pixels = result.pixels;
      width = result.width;
      height = result.height;
    }

    // Compute tight bounding box from the rendered bitmap.
    // Use the render mode's effective visibility threshold so that the tight bbox
    // only includes rows/columns that will actually have visible pixels after packing.
    // This prevents "ghost rows" where anti-aliased pixels below the packing threshold
    // cause the tight bbox to be larger than the visible content.
    const visibilityThreshold = ImageProcessor.getVisibilityThreshold(this.config.renderMode);

    let minX = width,
      maxX = -1,
      minY = height,
      maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[y * width + x] >= visibilityThreshold) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    let tightWidth: number;
    let tightHeight: number;
    let tightPixels: Uint8Array;

    if (maxX < 0) {
      tightWidth = 0;
      tightHeight = 0;
      tightPixels = new Uint8Array(0);
    } else {
      tightWidth = maxX - minX + 1;
      tightHeight = maxY - minY + 1;
      tightPixels = new Uint8Array(tightWidth * tightHeight);
      for (let y = 0; y < tightHeight; y++) {
        for (let x = 0; x < tightWidth; x++) {
          tightPixels[y * tightWidth + x] = pixels[(y + minY) * width + (x + minX)];
        }
      }
    }

    // Pack tight bbox pixels according to render mode
    const packedPixels =
      tightWidth > 0 && tightHeight > 0
        ? ImageProcessor.packPixels(tightPixels, tightWidth, tightHeight, this.config.renderMode)
        : new Uint8Array(0);

    // Recompute bearingX/bearingY from actual rendered pixel positions.
    // The full render canvas starts at (screenX1, screenY1) relative to the baseline origin.
    // screenY1 = floor(-bbox.y2 * scale), so baseline is at y = -screenY1 in the canvas.
    // The tight bbox top is at canvas row minY, so its position relative to baseline is:
    //   bearingY = -(screenY1 + minY)  (distance from baseline to top of visible pixels)
    // Similarly for X:
    //   bearingX = x1 + minX  where x1 = floor(bbox.x1 * scale)
    const screenX1 = Math.floor(bbox.x1 * scale);
    const screenY1 = Math.floor(-bbox.y2 * scale);
    const actualBearingX = tightWidth > 0 ? screenX1 + minX : rawBearingX;
    const actualBearingY = tightHeight > 0 ? -(screenY1 + minY) : rawBearingY;

    const header: GlyphHeaderV3 = {
      bearingX: clampInt16(actualBearingX),
      bearingY: clampInt16(actualBearingY),
      width: clampUint16(tightWidth),
      height: clampUint16(tightHeight),
      advance: clampUint16(rawAdvance),
    };

    return { unicode, header, pixelData: packedPixels };
  }

  /**
   * Render a glyph to a grayscale bitmap using opentype.js with 4x supersampling
   */
  private renderGlyphToBitmap(
    glyph: opentype.Glyph,
    fontSize: number,
    unitsPerEm: number
  ): { pixels: Uint8Array; width: number; height: number } {
    const bbox = glyph.getBoundingBox();

    if (bbox.x1 === 0 && bbox.y1 === 0 && bbox.x2 === 0 && bbox.y2 === 0) {
      return { pixels: new Uint8Array(0), width: 0, height: 0 };
    }

    const scale = fontSize / unitsPerEm;

    const x1 = Math.floor(bbox.x1 * scale);
    const x2 = Math.ceil(bbox.x2 * scale);
    const screenY1 = Math.floor(-bbox.y2 * scale);
    const screenY2 = Math.ceil(-bbox.y1 * scale);

    const width = Math.max(1, x2 - x1);
    const height = Math.max(1, screenY2 - screenY1);

    if (width <= 0 || height <= 0) {
      return { pixels: new Uint8Array(0), width: 0, height: 0 };
    }

    const ssScale = 4;
    const ssWidth = width * ssScale;
    const ssHeight = height * ssScale;
    const ssFontSize = fontSize * ssScale;

    const ssPixels = new Uint8Array(ssWidth * ssHeight);
    const path = glyph.getPath(0, 0, ssFontSize);

    this.rasterizePath(path, ssPixels, ssWidth, ssHeight, -x1 * ssScale, -screenY1 * ssScale);

    const pixels = this.downsampleBitmap(ssPixels, ssWidth, ssHeight, width, height, ssScale);

    return { pixels, width, height };
  }

  /**
   * Downsample a bitmap using box filter (averaging)
   */
  private downsampleBitmap(
    src: Uint8Array,
    srcWidth: number,
    srcHeight: number,
    dstWidth: number,
    dstHeight: number,
    scale: number
  ): Uint8Array {
    const dst = new Uint8Array(dstWidth * dstHeight);
    const scaleSquared = scale * scale;

    for (let dstY = 0; dstY < dstHeight; dstY++) {
      for (let dstX = 0; dstX < dstWidth; dstX++) {
        let sum = 0;
        const srcStartX = dstX * scale;
        const srcStartY = dstY * scale;

        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const srcX = srcStartX + sx;
            const srcY = srcStartY + sy;
            if (srcX < srcWidth && srcY < srcHeight) {
              sum += src[srcY * srcWidth + srcX];
            }
          }
        }

        dst[dstY * dstWidth + dstX] = Math.round(sum / scaleSquared);
      }
    }

    return dst;
  }

  /**
   * Scanline path rasterization using even-odd fill rule
   */
  private rasterizePath(
    path: opentype.Path,
    pixels: Uint8Array,
    width: number,
    height: number,
    offsetX: number,
    offsetY: number
  ): void {
    const contours: Array<Array<{ x: number; y: number }>> = [];
    let currentContour: Array<{ x: number; y: number }> = [];
    let currentX = 0;
    let currentY = 0;

    for (const cmd of path.commands) {
      switch (cmd.type) {
        case 'M':
          if (currentContour.length > 0) {
            contours.push(currentContour);
            currentContour = [];
          }
          currentX = cmd.x + offsetX;
          currentY = cmd.y + offsetY;
          currentContour.push({ x: currentX, y: currentY });
          break;

        case 'L':
          currentX = cmd.x + offsetX;
          currentY = cmd.y + offsetY;
          currentContour.push({ x: currentX, y: currentY });
          break;

        case 'Q': {
          const x0 = currentX;
          const y0 = currentY;
          const x1 = cmd.x1 + offsetX;
          const y1 = cmd.y1 + offsetY;
          const x2 = cmd.x + offsetX;
          const y2 = cmd.y + offsetY;

          const steps = 10;
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const mt = 1 - t;
            const x = mt * mt * x0 + 2 * mt * t * x1 + t * t * x2;
            const y = mt * mt * y0 + 2 * mt * t * y1 + t * t * y2;
            currentContour.push({ x, y });
          }
          currentX = x2;
          currentY = y2;
          break;
        }

        case 'C': {
          const x0 = currentX;
          const y0 = currentY;
          const x1 = cmd.x1 + offsetX;
          const y1 = cmd.y1 + offsetY;
          const x2 = cmd.x2 + offsetX;
          const y2 = cmd.y2 + offsetY;
          const x3 = cmd.x + offsetX;
          const y3 = cmd.y + offsetY;

          const steps = 10;
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const mt = 1 - t;
            const mt2 = mt * mt;
            const mt3 = mt2 * mt;
            const t2 = t * t;
            const t3 = t2 * t;

            const x = mt3 * x0 + 3 * mt2 * t * x1 + 3 * mt * t2 * x2 + t3 * x3;
            const y = mt3 * y0 + 3 * mt2 * t * y1 + 3 * mt * t2 * y2 + t3 * y3;
            currentContour.push({ x, y });
          }
          currentX = x3;
          currentY = y3;
          break;
        }

        case 'Z':
          if (currentContour.length > 0) {
            contours.push(currentContour);
            currentContour = [];
          }
          break;
      }
    }

    if (currentContour.length > 0) {
      contours.push(currentContour);
    }

    // Scanline fill
    for (let y = 0; y < height; y++) {
      const intersections: number[] = [];

      for (const contour of contours) {
        for (let i = 0; i < contour.length; i++) {
          const p1 = contour[i];
          const p2 = contour[(i + 1) % contour.length];

          if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
            const t = (y - p1.y) / (p2.y - p1.y);
            const x = p1.x + t * (p2.x - p1.x);
            intersections.push(x);
          }
        }
      }

      intersections.sort((a, b) => a - b);

      for (let i = 0; i < intersections.length - 1; i += 2) {
        const xStart = Math.max(0, Math.ceil(intersections[i]));
        const xEnd = Math.min(width - 1, Math.floor(intersections[i + 1]));

        for (let x = xStart; x <= xEnd; x++) {
          pixels[y * width + x] = 255;
        }
      }
    }
  }

  /**
   * Create the bitmap font header (always V3)
   */
  private createHeader(): BitmapFontHeader {
    const config: BitmapFontHeaderConfig = {
      fontName: this.getFontName(),
      size: this.config.fontSize,
      fontSize: this.config.fontSize,
      renderMode: this.config.renderMode,
      bold: this.config.bold,
      italic: this.config.italic,
      indexMethod: this.config.indexMethod,
      crop: true, // V3 always crop
      characterCount: this.glyphs.size,
      rvd: this.config.rvd || false,
    };

    if (this.parsedFont) {
      const { ascent, descent, lineGap, unitsPerEm } = this.parsedFont.metrics;
      config.ascender = ascent;
      config.descender = descent;
      config.lineGap = lineGap;
      config.unitsPerEm = unitsPerEm;
    }

    return new BitmapFontHeader(config);
  }

  /**
   * Create the index array based on index method
   *
   * V3 always has crop=true, so only two modes:
   * 1. indexMethod=ADDRESS: 65536 × 4 bytes (file offsets)
   * 2. indexMethod=OFFSET: N × 6 bytes (unicode 2B + file offset 4B)
   */
  private createIndexArray(): IndexEntry[] {
    const entries: IndexEntry[] = [];

    if (this.config.indexMethod === IndexMethod.OFFSET) {
      for (const unicode of this.characters) {
        if (this.glyphs.has(unicode)) {
          entries.push({ unicode, value: BINARY_FORMAT.UNUSED_INDEX_32 });
        }
      }
    } else {
      // Address mode: 65536 × 4 bytes
      for (let i = 0; i < BINARY_FORMAT.MAX_INDEX_SIZE; i++) {
        entries.push({ unicode: i, value: BINARY_FORMAT.UNUSED_INDEX_32 });
      }
      let charIndex = 0;
      for (const unicode of this.characters) {
        if (this.glyphs.has(unicode)) {
          entries[unicode].value = charIndex;
          charIndex++;
        }
      }
    }

    return entries;
  }

  /**
   * Generate output base name for files
   */
  private generateOutputBaseName(): string {
    const fontName = this.getFontName();
    const size = this.config.fontSize;
    const bits = this.config.renderMode;
    return `${fontName}${FILE_NAMING.SIZE_PREFIX}${size}${FILE_NAMING.BITS_PREFIX}${bits}_bitmap`;
  }

  /**
   * Generate output filename
   */
  generateOutputFilename(): string {
    return this.generateOutputBaseName() + '.bin';
  }

  /**
   * Write the binary font file
   */
  private async writeBinaryFile(
    baseName: string,
    header: BitmapFontHeader,
    indexArray: IndexEntry[]
  ): Promise<void> {
    const filePath = PathUtils.join(this.config.outputPath, baseName + '.bin');

    const headerSize = header.getSize();
    const indexSize = header.indexAreaSize;

    // V3.2: 10-byte header per glyph + variable-size packed pixel data
    let glyphDataSize = 0;
    for (const g of this.glyphs.values()) {
      glyphDataSize += GLYPH_HEADER_V3_SIZE + g.pixelData.length;
    }

    const totalSize = headerSize + indexSize + glyphDataSize;
    const writer = new BinaryWriter(totalSize);

    // Write header
    writer.writeBytes(header.toBytes());

    // Write index array
    const indexStartOffset = writer.getOffset();
    this.writeIndexArray(writer, indexArray);

    // Write glyph data and update index with file offsets
    await this.writeGlyphData(writer, indexArray, indexStartOffset);

    try {
      fs.writeFileSync(filePath, writer.freeze(totalSize));
    } catch (error) {
      throw createFileWriteError(filePath, error as Error);
    }
  }

  /**
   * Write the index array to the binary writer
   */
  private writeIndexArray(writer: BinaryWriter, indexArray: IndexEntry[]): void {
    if (this.config.indexMethod === IndexMethod.OFFSET) {
      // Offset + Crop: N × 6 bytes (unicode 2B + file offset 4B placeholder)
      for (const entry of indexArray) {
        writer.writeUint16LE(entry.unicode);
        writer.writeUint32LE(BINARY_FORMAT.UNUSED_INDEX_32);
      }
    } else {
      // Address + Crop: 65536 × 4 bytes (uint32 file offsets)
      for (let i = 0; i < BINARY_FORMAT.MAX_INDEX_SIZE; i++) {
        writer.writeUint32LE(BINARY_FORMAT.UNUSED_INDEX_32);
      }
    }
  }

  /**
   * Write glyph data and update index array with file offsets
   */
  private async writeGlyphData(
    writer: BinaryWriter,
    indexArray: IndexEntry[],
    indexStartOffset: number
  ): Promise<void> {
    // Build unicode→index mapping for offset mode
    const unicodeToIndexMap = new Map<number, number>();
    if (this.config.indexMethod === IndexMethod.OFFSET) {
      indexArray.forEach((entry, idx) => {
        unicodeToIndexMap.set(entry.unicode, idx);
      });
    }

    const sortedGlyphs = Array.from(this.glyphs.entries()).sort((a, b) => a[0] - b[0]);

    for (const [unicode, g] of sortedGlyphs) {
      const glyphOffset = writer.getOffset();

      // Update index with file offset
      if (this.config.indexMethod === IndexMethod.OFFSET) {
        const idx = unicodeToIndexMap.get(unicode);
        if (idx !== undefined) {
          const offsetPosition = indexStartOffset + idx * 6 + 2;
          writer.writeUint32LEAt(offsetPosition, glyphOffset);
        }
      } else {
        const indexOffset = indexStartOffset + unicode * 4;
        writer.writeUint32LEAt(indexOffset, glyphOffset);
      }

      // Write 10-byte V3.2 glyph header
      writer.writeGlyphHeaderV3(g.header);

      // Write packed tight bbox pixel data
      writer.writeBytes(g.pixelData);
    }
  }

  /**
   * Get the number of successfully rendered glyphs
   */
  getGlyphCount(): number {
    return this.glyphs.size;
  }

  /**
   * Get the base glyph dimensions
   */
  getBaseGlyphDimensions(): { width: number; height: number } {
    return {
      width: this.baseGlyphWidth,
      height: this.baseGlyphHeight,
    };
  }
}
