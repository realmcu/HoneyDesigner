/**
 * Bitmap Font Header Serialization
 *
 * This module provides the BitmapFontHeader class for creating and serializing
 * bitmap font headers in the packed binary format matching C++ implementation.
 *
 * Requirements: 5.1, 5.2, 5.4, 5.5, 5.6
 */

import { BinaryWriter } from './binary-writer';
import { FileFlag, RenderMode, IndexMethod } from './types';
import { VERSION, BINARY_FORMAT } from './constants';

/**
 * Calculate standard rendering and canvas dimensions for V2 font output.
 *
 * @param fontSize - User-specified em-size (must be > 0)
 * @param unitsPerEm - Font design units per em
 * @param ascender - Font ascender in font units (positive)
 * @param descender - Font descender in font units (negative)
 * @returns renderSize (= fontSize, no scaling) and backSize (canvas height)
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4
 */
export function calculateStandardDimensions(
  fontSize: number,
  unitsPerEm: number,
  ascender: number,
  descender: number
): { renderSize: number; backSize: number } {
  if (fontSize <= 0) {
    throw new Error(`fontSize must be positive, got ${fontSize}`);
  }

  const renderSize = fontSize;
  let backSize = Math.ceil((fontSize * (ascender - descender)) / unitsPerEm);

  if (backSize > 255) {
    console.warn(`backSize ${backSize} exceeds 255 for fontSize=${fontSize}, clamping to 255`);
    backSize = 255;
  }

  return { renderSize, backSize };
}

/**
 * Configuration for BitmapFontHeader
 */
export interface BitmapFontHeaderConfig {
  /** Font name (without extension) */
  fontName: string;

  /** Recalculated font size */
  size: number;

  /** Original font size (backSize) */
  fontSize: number;

  /** Render mode (1, 2, 4, or 8 bits per pixel) */
  renderMode: RenderMode;

  /** Bold flag */
  bold: boolean;

  /** Italic flag */
  italic: boolean;

  /** Index method (ADDRESS or OFFSET) */
  indexMethod: IndexMethod;

  /** Crop flag */
  crop: boolean;

  /** Number of characters in the font */
  characterCount: number;

  /** RVD flag (render at original size) */
  rvd?: boolean;

  /** Font ascender in font units (V2 only, positive) */
  ascender?: number;

  /** Font descender in font units (V2 only, negative) */
  descender?: number;

  /** Font lineGap in font units (V2 only) */
  lineGap?: number;

  /** Font unitsPerEm (V2 only) */
  unitsPerEm?: number;
}

/**
 * BitmapFontHeader class for creating and serializing bitmap font headers
 *
 * Binary layout (packed, little-endian):
 * - length (1 byte): Total header length
 * - BitmapFontHeadConfig (13 bytes):
 *   - fileFlag (1 byte): 1 for bitmap
 *   - version_major (1 byte): 1
 *   - version_minor (1 byte): 0
 *   - version_revision (1 byte): 2
 *   - size (1 byte): Recalculated font size
 *   - fontSize (1 byte): backSize value
 *   - renderMode (1 byte): 1/2/4/8
 *   - bitfield (1 byte): bold, italic, rvd, indexMethod, crop, reserved
 *   - indexAreaSize (4 bytes, int32): Size of index array in bytes
 * - fontNameLength (1 byte): Length of font name including null terminator
 * - fontName (variable): Null-terminated font name
 */
export class BitmapFontHeader {
  /** Total header length in bytes */
  public readonly length: number;

  /** File flag (always BITMAP = 1) */
  public readonly fileFlag: FileFlag = FileFlag.BITMAP;

  /** Version major */
  public readonly versionMajor: number;

  /** Version minor */
  public readonly versionMinor: number;

  /** Version revision */
  public readonly versionRevision: number;

  /** Version build number (4th version byte, added for V2) */
  public readonly versionBuildnum: number;

  /** Recalculated font size */
  public readonly size: number;

  /** Original font size (backSize in V1, em-size in V2) */
  public readonly fontSize: number;

  /** Render mode */
  public readonly renderMode: RenderMode;

  /** Bold flag */
  public readonly bold: boolean;

  /** Italic flag */
  public readonly italic: boolean;

  /** Reserved flag (rvd mode) */
  public readonly rvd: boolean;

  /** Index method */
  public readonly indexMethod: IndexMethod;

  /** Crop flag */
  public readonly crop: boolean;

  /** Reserved bits (always 0) */
  public readonly rsvd: number = 0;

  /** Index area size in bytes */
  public readonly indexAreaSize: number;

  /** Font name length including null terminator */
  public readonly fontNameLength: number;

  /** Font name (without extension) */
  public readonly fontName: string;

  /** Whether this is a V2 header */
  public readonly isV2: boolean;

  /** V2 typography metrics */
  public readonly ascender?: number;
  public readonly descender?: number;
  public readonly lineGap?: number;
  public readonly unitsPerEm?: number;

  /**
   * Size of BitmapFontHeadConfig structure in bytes.
   * file_type(1) + version(4) + font_size(1) + render_mode(1) + bitfield(1) + index_area_size(4) = 12
   */
  private static readonly CONFIG_SIZE = 12;

  /** Size of V2 extension fields (ascender + descender + lineGap + unitsPerEm) */
  private static readonly V2_EXTENSION_SIZE = 8;

  /**
   * Creates a new BitmapFontHeader
   *
   * @param config - Header configuration
   */
  constructor(config: BitmapFontHeaderConfig) {
    this.fontName = config.fontName;
    this.fontNameLength = config.fontName.length + 1; // +1 for null terminator
    this.size = config.size;
    this.renderMode = config.renderMode;
    this.bold = config.bold;
    this.italic = config.italic;
    this.rvd = config.rvd || false;
    this.indexMethod = config.indexMethod;

    // Detect V2 mode: all three typography fields must be provided
    this.isV2 = config.ascender != null && config.descender != null && config.unitsPerEm != null;

    if (this.isV2) {
      // V2 validation
      if (config.ascender! <= 0) {
        throw new Error(`V2 ascender must be positive, got ${config.ascender}`);
      }
      if (config.descender! >= 0) {
        throw new Error(`V2 descender must be negative, got ${config.descender}`);
      }

      // V2: version from package.json, crop always true, fontSize = em-size
      this.versionMajor = VERSION.BITMAP.MAJOR;
      this.versionMinor = VERSION.BITMAP.MINOR;
      this.versionRevision = VERSION.BITMAP.REVISION;
      this.versionBuildnum = VERSION.BITMAP.BUILD;
      this.crop = true;
      this.fontSize = config.fontSize;
      this.ascender = config.ascender;
      this.descender = config.descender;
      this.lineGap = config.lineGap ?? 0;
      this.unitsPerEm = config.unitsPerEm;
    } else {
      // V1: version from package.json
      this.versionMajor = VERSION.BITMAP.MAJOR;
      this.versionMinor = VERSION.BITMAP.MINOR;
      this.versionRevision = VERSION.BITMAP.REVISION;
      this.versionBuildnum = VERSION.BITMAP.BUILD;
      this.crop = config.crop;
      this.fontSize = config.fontSize;
    }

    // Calculate index area size based on indexMethod and crop
    this.indexAreaSize = this.calculateIndexAreaSize(
      config.indexMethod,
      this.crop,
      config.characterCount
    );

    // Calculate total header length:
    // CONFIG_SIZE (13) + 2 (length + fontNameLength) + fontNameLength [+ 8 for V2 extension]
    this.length =
      BitmapFontHeader.CONFIG_SIZE +
      2 +
      this.fontNameLength +
      (this.isV2 ? BitmapFontHeader.V2_EXTENSION_SIZE : 0);
  }

  /**
   * Calculates the index area size based on index method and crop settings
   *
   * Index modes:
   * 1. crop=true, indexMethod=ADDRESS: 65536 × 4 bytes (file offsets)
   * 2. crop=true, indexMethod=OFFSET: N × 6 bytes (unicode 2B + file offset 4B)
   * 3. crop=false, indexMethod=ADDRESS: 65536 × 2 bytes (character indices)
   * 4. crop=false, indexMethod=OFFSET: N × 2 bytes (unicode only, NO char index!)
   *
   * C++ Reference (fontDictionary_o.cpp line 448-462):
   *   addrSize = crop ? 4 : 2
   *   if (indexMethod == OFFSET) indexAreaSize = cstNum * addrSize
   *   else indexAreaSize = 65536 * addrSize
   *
   * NEW: Offset + Crop mode stores unicode (2B) + file offset (4B) = 6 bytes per entry
   * This provides significant space savings for embedded devices.
   *
   * @param indexMethod - Index method (ADDRESS or OFFSET)
   * @param crop - Crop flag
   * @param characterCount - Number of characters
   * @returns Index area size in bytes
   */
  private calculateIndexAreaSize(
    indexMethod: IndexMethod,
    crop: boolean,
    characterCount: number
  ): number {
    if (indexMethod === IndexMethod.OFFSET) {
      if (crop) {
        // Offset + Crop mode: N entries × 6 bytes (unicode 2B + file offset 4B)
        return characterCount * 6;
      } else {
        // Offset mode (non-crop): N entries × 2 bytes (unicode only)
        return characterCount * 2;
      }
    } else {
      // Address mode: 65536 entries × (4 bytes if crop, 2 bytes otherwise)
      const addrSize = crop ? 4 : 2;
      return BINARY_FORMAT.MAX_INDEX_SIZE * addrSize;
    }
  }

  /**
   * Serializes the header to a Buffer
   *
   * @returns Buffer containing the serialized header
   */
  toBytes(): Buffer {
    const writer = new BinaryWriter(this.length);

    // Write length (1 byte)
    writer.writeUint8(this.length);

    // Write BitmapFontHeadConfig
    writer.writeUint8(this.fileFlag); // fileFlag (1 byte)
    writer.writeUint8(this.versionMajor); // version_major (1 byte)
    writer.writeUint8(this.versionMinor); // version_minor (1 byte)
    writer.writeUint8(this.versionRevision); // version_revision (1 byte)
    writer.writeUint8(this.versionBuildnum); // version_buildnum (1 byte) — new 4th byte
    writer.writeUint8(this.fontSize); // fontSize (1 byte) — C side: font_size
    writer.writeUint8(this.renderMode); // renderMode (1 byte)

    // Write bitfield (1 byte)
    writer.writeBitmapFontBitfield(this.bold, this.italic, this.rvd, this.indexMethod, this.crop);

    // Write indexAreaSize (4 bytes, int32, little-endian)
    writer.writeInt32LE(this.indexAreaSize);

    // Write fontNameLength (1 byte)
    writer.writeUint8(this.fontNameLength);

    // Write fontName (null-terminated)
    writer.writeNullTerminatedString(this.fontName);

    // V2 extension: 8 bytes after font_name
    if (this.isV2) {
      writer.writeInt16LE(this.ascender!); // ascender (int16 LE)
      writer.writeInt16LE(this.descender!); // descender (int16 LE)
      writer.writeInt16LE(this.lineGap!); // line_gap (int16 LE)
      writer.writeUint16LE(this.unitsPerEm!); // units_per_em (uint16 LE)
    }

    return writer.getBuffer();
  }

  /**
   * Gets the total size of the header in bytes
   *
   * @returns Header size in bytes
   */
  getSize(): number {
    return this.length;
  }

  /**
   * Creates a BitmapFontHeader from raw binary data
   *
   * @param data - Buffer containing header data
   * @returns Parsed BitmapFontHeader
   */
  static fromBytes(data: Buffer): BitmapFontHeader {
    let offset = 0;

    // Read length
    const _length = data.readUInt8(offset++);

    // Read BitmapFontHeadConfig
    const _fileFlag = data.readUInt8(offset++) as FileFlag;
    const versionMajor = data.readUInt8(offset++);
    const _versionMinor = data.readUInt8(offset++);
    const _versionRevision = data.readUInt8(offset++);
    const _versionBuildnum = data.readUInt8(offset++); // 4th version byte
    const fontSize = data.readUInt8(offset++);
    const renderMode = data.readUInt8(offset++) as RenderMode;

    // Read bitfield
    const bitfield = data.readUInt8(offset++);
    const bold = (bitfield & 0x01) !== 0;
    const italic = (bitfield & 0x02) !== 0;
    const rvd = (bitfield & 0x04) !== 0;
    const indexMethod = (bitfield & 0x08) !== 0 ? IndexMethod.OFFSET : IndexMethod.ADDRESS;
    const crop = (bitfield & 0x10) !== 0;

    // Read indexAreaSize (4 bytes, little-endian)
    const indexAreaSize = data.readInt32LE(offset);
    offset += 4;

    // Read fontNameLength
    const fontNameLength = data.readUInt8(offset++);

    // Read fontName (excluding null terminator)
    const fontName = data.toString('utf8', offset, offset + fontNameLength - 1);
    offset += fontNameLength;

    // V2 detection: parse extension fields if versionMajor >= 2
    let ascender: number | undefined;
    let descender: number | undefined;
    let lineGap: number | undefined;
    let unitsPerEm: number | undefined;

    if (versionMajor >= 2 && offset + BitmapFontHeader.V2_EXTENSION_SIZE <= data.length) {
      ascender = data.readInt16LE(offset);
      offset += 2;
      descender = data.readInt16LE(offset);
      offset += 2;
      lineGap = data.readInt16LE(offset);
      offset += 2;
      unitsPerEm = data.readUInt16LE(offset);
      offset += 2;
    }

    // Calculate character count from indexAreaSize
    let characterCount = 0;
    if (crop) {
      characterCount = 0; // Will be determined from actual data
    } else if (indexMethod === IndexMethod.ADDRESS) {
      characterCount = 0; // Will be determined from actual data
    } else {
      // Offset mode: each entry is 2 bytes (unicode only)
      characterCount = indexAreaSize / 2;
    }

    return new BitmapFontHeader({
      fontName,
      size: fontSize,
      fontSize,
      renderMode,
      bold,
      italic,
      indexMethod,
      crop,
      characterCount,
      rvd,
      ascender,
      descender,
      lineGap,
      unitsPerEm,
    });
  }
}
