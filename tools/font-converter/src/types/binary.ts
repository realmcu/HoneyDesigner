import { FileFlag, RenderMode, IndexMethod } from './enums';

/**
 * Bitmap font header structure (packed binary format)
 * Matches C++ BitmapFontHeader with #pragma pack(push,1)
 * Note: Named with "Raw" suffix to avoid conflict with the BitmapFontHeader class
 */
export interface RawBitmapFontHeader {
  length: number; // 1 byte - header length
  fileFlag: FileFlag; // 1 byte - BITMAP = 1
  versionMajor: number; // 1 byte - version 1
  versionMinor: number; // 1 byte - version 0
  versionRevision: number; // 1 byte - version 2
  size: number; // 1 byte - recalculated font size
  fontSize: number; // 1 byte - backSize value
  renderMode: RenderMode; // 1 byte - 1/2/4/8 bits per pixel
  bold: boolean; // bitfield bit 0
  italic: boolean; // bitfield bit 1
  rvd: boolean; // bitfield bit 2 (reserved)
  indexMethod: IndexMethod; // bitfield bit 3
  crop: boolean; // bitfield bit 4
  rsvd: number; // bitfield bits 5-7 (reserved, must be 0)
  indexAreaSize: number; // 4 bytes (int32) - size of index array
  fontNameLength: number; // 1 byte - length of font name
  fontName: string; // variable length, null-terminated
}

/**
 * Vector font header structure (packed binary format)
 * Matches C++ VectorFontHeader with #pragma pack(push,1)
 * Note: Named with "Raw" suffix to avoid conflict with the VectorFontHeader class
 */
export interface RawVectorFontHeader {
  length: number; // 1 byte - header length
  fileFlag: FileFlag; // 1 byte - VECTOR = 2
  versionMajor: number; // 1 byte - version 1
  versionMinor: number; // 1 byte - version 0
  versionRevision: number; // 1 byte - version 2
  versionBuildnum: number; // 1 byte - build number
  fontSize: number; // 1 byte - font size
  renderMode: number; // 1 byte - render mode (unused for vector)
  bold: boolean; // bitfield bit 0
  italic: boolean; // bitfield bit 1
  rvd: boolean; // bitfield bit 2 (reserved)
  indexMethod: IndexMethod; // bitfield bit 3
  rsvd: number; // bitfield bits 4-7 (reserved, must be 0)
  indexAreaSize: number; // 4 bytes (int32) - size of index array
  fontNameLength: number; // 1 byte - length of font name
  ascent: number; // 2 bytes (int16) - font ascent
  descent: number; // 2 bytes (int16) - font descent
  lineGap: number; // 2 bytes (int16) - line gap
  fontName: string; // variable length, null-terminated
}

/**
 * Glyph entry for index array
 */
export interface GlyphEntry {
  unicode: number; // Unicode value
  offset: number; // File offset or character index
}

/**
 * Crop information for bitmap glyphs (used by ImageProcessor.cropCharacter)
 */
export interface CropInfo {
  topSkip: number; // 1 byte - pixels to skip from top
  leftSkip: number; // 1 byte - pixels to skip from left
  validWidth: number; // 1 byte - valid width after cropping
  validHeight: number; // 1 byte - valid height after cropping
}

/**
 * Per-glyph header (bearing-based, 10 bytes, all little-endian).
 *
 * 16-bit fields match the uint16 font_size: an 8-bit layout truncated the
 * metrics for large fonts and skewed the rendered glyph.
 */
export interface GlyphHeaderV3 {
  bearingX: number; // int16: horizontal bearing (pixels)
  bearingY: number; // int16: vertical bearing from baseline (pixels)
  width: number; // uint16: tight bbox width (pixels)
  height: number; // uint16: tight bbox height (pixels)
  advance: number; // uint16: horizontal advance (pixels)
}

/**
 * Vector glyph data
 */
export interface VectorGlyphData {
  sx0: number; // 2 bytes (int16) - bounding box min x
  sy0: number; // 2 bytes (int16) - bounding box min y
  sx1: number; // 2 bytes (int16) - bounding box max x
  sy1: number; // 2 bytes (int16) - bounding box max y
  advance: number; // 2 bytes (uint16) - advance width
  windingCount: number; // 2 bytes (uint16) - number of windings
  windingLengths: number[]; // 2 bytes each - points per winding
  windings: number[]; // 4 bytes each (x, y as int16) - contour points
}
