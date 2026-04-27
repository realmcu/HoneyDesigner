/**
 * Render mode for bitmap fonts - bits per pixel
 */
export enum RenderMode {
  BIT_1 = 1,
  BIT_2 = 2,
  BIT_4 = 4,
  BIT_8 = 8,
}

/**
 * Rotation angles for glyph rendering
 */
export enum Rotation {
  ROTATE_0 = 0,
  ROTATE_90 = 1,
  ROTATE_270 = 2,
  ROTATE_180 = 3,
}

/**
 * Index method for character lookup
 * ADDRESS: 65536 entries (direct Unicode lookup)
 * OFFSET: N entries (compact storage)
 */
export enum IndexMethod {
  ADDRESS = 0,
  OFFSET = 1,
}

/**
 * File flag indicating font type
 */
export enum FileFlag {
  BITMAP = 1,
  VECTOR = 2,
}
