/**
 * Image Processor Module
 *
 * Provides image processing operations for bitmap font rendering including:
 * - Bitmap rendering from glyph data
 * - Gamma correction
 * - Style application (bold, italic)
 * - Rotation transforms (0°, 90°, 180°, 270°)
 * - Cropping to remove whitespace
 * - Pixel packing (1-bit, 2-bit, 4-bit, 8-bit)
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 5.9, 6.5
 */

import { RenderMode, Rotation } from './types';
import { CropInfo } from './types/binary';
import { BINARY_FORMAT } from './constants';

/**
 * Rendered glyph bitmap data
 */
export interface RenderedGlyph {
  /** Bitmap pixel data (grayscale 0-255) */
  pixels: Uint8Array;
  /** Bitmap width in pixels */
  width: number;
  /** Bitmap height in pixels */
  height: number;
  /** Horizontal bearing (left side bearing) */
  bearingX: number;
  /** Vertical bearing (top side bearing) */
  bearingY: number;
  /** Advance width */
  advance: number;
}

/**
 * Image Processor class for bitmap font operations
 */
export class ImageProcessor {
  /**
   * Apply gamma correction to a grayscale image
   *
   * Uses the formula: output = 255 * (input/255)^gamma
   *
   * @param pixels - Input pixel data (grayscale 0-255)
   * @param width - Image width
   * @param height - Image height
   * @param gamma - Gamma correction value (typically 0.1 to 5.0)
   * @returns Gamma-corrected pixel data
   *
   * Requirements: 2.2
   */
  static applyGamma(pixels: Uint8Array, width: number, height: number, gamma: number): Uint8Array {
    if (gamma === 1.0) {
      // No correction needed
      return new Uint8Array(pixels);
    }

    const result = new Uint8Array(pixels.length);

    // Pre-compute gamma lookup table for efficiency
    const gammaLUT = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      const normalized = i / 255.0;
      const corrected = Math.pow(normalized, gamma);
      gammaLUT[i] = Math.round(corrected * 255);
    }

    // Apply gamma using lookup table
    for (let i = 0; i < pixels.length; i++) {
      result[i] = gammaLUT[pixels[i]];
    }

    return result;
  }

  /**
   * Apply bold effect to a bitmap
   *
   * Simulates bold by dilating the bitmap horizontally.
   *
   * @param pixels - Input pixel data
   * @param width - Image width
   * @param height - Image height
   * @returns Object with new pixels, width, and height
   *
   * Requirements: 2.3
   */
  static applyBold(
    pixels: Uint8Array,
    width: number,
    height: number
  ): { pixels: Uint8Array; width: number; height: number } {
    if (width === 0 || height === 0) {
      return { pixels: new Uint8Array(0), width: 0, height: 0 };
    }

    // Create a slightly wider bitmap
    const boldWidth = width + 1;
    const boldPixels = new Uint8Array(height * boldWidth);

    // Copy original bitmap and add shifted copy for bold effect
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = y * width + x;
        const dstIdx = y * boldWidth + x;

        // Copy original pixel
        boldPixels[dstIdx] = pixels[srcIdx];

        // Add shifted copy (take maximum)
        if (x + 1 < boldWidth) {
          const nextIdx = y * boldWidth + x + 1;
          boldPixels[nextIdx] = Math.max(boldPixels[nextIdx], pixels[srcIdx]);
        }
      }
    }

    return { pixels: boldPixels, width: boldWidth, height };
  }

  /**
   * Apply italic effect to a bitmap
   *
   * Applies a shear transformation to create an italic effect.
   * The shear is approximately 12 degrees (tan(12°) ≈ 0.21).
   *
   * @param pixels - Input pixel data
   * @param width - Image width
   * @param height - Image height
   * @returns Object with new pixels, width, and height
   *
   * Requirements: 2.4
   */
  static applyItalic(
    pixels: Uint8Array,
    width: number,
    height: number
  ): { pixels: Uint8Array; width: number; height: number } {
    if (width === 0 || height === 0) {
      return { pixels: new Uint8Array(0), width: 0, height: 0 };
    }

    // Calculate shear amount (12 degrees)
    const shear = 0.21;
    const maxShift = Math.floor(height * shear) + 1;

    // Create output bitmap with extra width for shear
    const italicWidth = width + maxShift;
    const italicPixels = new Uint8Array(height * italicWidth);

    // Apply shear transformation
    for (let y = 0; y < height; y++) {
      // Calculate horizontal shift for this row
      // Shift decreases from top to bottom
      const shift = Math.floor((height - y - 1) * shear);

      // Copy row with shift
      for (let x = 0; x < width; x++) {
        const srcIdx = y * width + x;
        const dstIdx = y * italicWidth + (x + shift);
        italicPixels[dstIdx] = pixels[srcIdx];
      }
    }

    return { pixels: italicPixels, width: italicWidth, height };
  }

  /**
   * Rotate an image by the specified rotation value
   *
   * @param pixels - Input pixel data
   * @param width - Image width
   * @param height - Image height
   * @param rotation - Rotation value (0=0°, 1=90°CW, 2=270°CW, 3=180°)
   * @returns Object with rotated pixels, new width, and new height
   *
   * Requirements: 2.5
   */
  static rotateImage(
    pixels: Uint8Array,
    width: number,
    height: number,
    rotation: Rotation
  ): { pixels: Uint8Array; width: number; height: number } {
    if (width === 0 || height === 0) {
      return { pixels: new Uint8Array(0), width: 0, height: 0 };
    }

    switch (rotation) {
      case Rotation.ROTATE_0:
        // No rotation
        return { pixels: new Uint8Array(pixels), width, height };

      case Rotation.ROTATE_90: {
        // 90° clockwise: transpose then flip horizontally
        const newWidth = height;
        const newHeight = width;
        const rotated = new Uint8Array(newWidth * newHeight);

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const srcIdx = y * width + x;
            // After transpose: (x, y) -> (y, x)
            // After horizontal flip: (y, x) -> (height - 1 - y, x)
            const dstX = height - 1 - y;
            const dstY = x;
            const dstIdx = dstY * newWidth + dstX;
            rotated[dstIdx] = pixels[srcIdx];
          }
        }

        return { pixels: rotated, width: newWidth, height: newHeight };
      }

      case Rotation.ROTATE_270: {
        // 270° clockwise (90° counter-clockwise): transpose then flip vertically
        const newWidth = height;
        const newHeight = width;
        const rotated = new Uint8Array(newWidth * newHeight);

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const srcIdx = y * width + x;
            // After transpose: (x, y) -> (y, x)
            // After vertical flip: (y, x) -> (y, width - 1 - x)
            const dstX = y;
            const dstY = width - 1 - x;
            const dstIdx = dstY * newWidth + dstX;
            rotated[dstIdx] = pixels[srcIdx];
          }
        }

        return { pixels: rotated, width: newWidth, height: newHeight };
      }

      case Rotation.ROTATE_180: {
        // 180°: flip both horizontally and vertically
        const rotated = new Uint8Array(width * height);

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const srcIdx = y * width + x;
            const dstX = width - 1 - x;
            const dstY = height - 1 - y;
            const dstIdx = dstY * width + dstX;
            rotated[dstIdx] = pixels[srcIdx];
          }
        }

        return { pixels: rotated, width, height };
      }

      default:
        throw new Error(`Invalid rotation value: ${rotation}. Must be 0, 1, 2, or 3.`);
    }
  }

  /**
   * Adjust bitmap dimensions to ensure byte alignment
   *
   * Dimensions are adjusted to be multiples of 8 to ensure proper
   * byte alignment for bit-packed data.
   *
   * @param width - Original width
   * @param height - Original height
   * @returns Tuple of [alignedWidth, alignedHeight], both multiples of 8
   *
   * Requirements: 5.9
   */
  static adjustDimensionsForAlignment(width: number, height: number): [number, number] {
    const alignment = BINARY_FORMAT.BITMAP_ALIGNMENT;
    const alignedWidth = Math.ceil(width / alignment) * alignment;
    const alignedHeight = Math.ceil(height / alignment) * alignment;
    return [alignedWidth, alignedHeight];
  }

  /**
   * Pad an image to ensure dimensions are multiples of 8
   *
   * @param pixels - Input pixel data
   * @param width - Original width
   * @param height - Original height
   * @returns Object with padded pixels and new dimensions
   *
   * Requirements: 5.9
   */
  static padImageForAlignment(
    pixels: Uint8Array,
    width: number,
    height: number
  ): { pixels: Uint8Array; width: number; height: number } {
    const [alignedWidth, alignedHeight] = this.adjustDimensionsForAlignment(width, height);

    // If already aligned, return copy
    if (width === alignedWidth && height === alignedHeight) {
      return { pixels: new Uint8Array(pixels), width, height };
    }

    // Create padded image filled with zeros (black)
    const padded = new Uint8Array(alignedWidth * alignedHeight);

    // Copy original image into top-left corner
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = y * width + x;
        const dstIdx = y * alignedWidth + x;
        padded[dstIdx] = pixels[srcIdx];
      }
    }

    return { pixels: padded, width: alignedWidth, height: alignedHeight };
  }

  /**
   * Crop character to remove leading and trailing whitespace
   *
   * Detects the valid pixel boundary and removes:
   * - Leading empty rows from the top
   * - Trailing empty rows from the bottom
   * - Leading empty columns from the left
   * - Trailing empty columns from the right
   *
   * @param pixels - Input pixel data
   * @param width - Image width
   * @param height - Image height
   * @returns Object with cropped pixels and crop info
   *
   * Requirements: 2.6
   */
  static cropCharacter(
    pixels: Uint8Array,
    width: number,
    height: number
  ): { pixels: Uint8Array; cropInfo: CropInfo } {
    if (width === 0 || height === 0) {
      return {
        pixels: new Uint8Array(0),
        cropInfo: {
          topSkip: 0,
          leftSkip: 0,
          validWidth: 0,
          validHeight: 0,
        },
      };
    }

    // Find first non-zero row (top boundary)
    let topSkip = 0;
    let foundTop = false;
    for (let y = 0; y < height && !foundTop; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[y * width + x] > 0) {
          topSkip = y;
          foundTop = true;
          break;
        }
      }
    }

    // If all pixels are zero - empty character
    if (!foundTop) {
      return {
        pixels: new Uint8Array(0),
        cropInfo: {
          topSkip: height,
          leftSkip: 0,
          validWidth: 0,
          validHeight: 0,
        },
      };
    }

    // Find last non-zero row (bottom boundary)
    let bottom = height - 1;
    for (let y = height - 1; y >= 0; y--) {
      let hasPixel = false;
      for (let x = 0; x < width; x++) {
        if (pixels[y * width + x] > 0) {
          hasPixel = true;
          break;
        }
      }
      if (hasPixel) {
        bottom = y;
        break;
      }
    }

    // Find first non-zero column (left boundary)
    let leftSkip = 0;
    let foundLeft = false;
    for (let x = 0; x < width && !foundLeft; x++) {
      for (let y = 0; y < height; y++) {
        if (pixels[y * width + x] > 0) {
          leftSkip = x;
          foundLeft = true;
          break;
        }
      }
    }

    // Find last non-zero column (right boundary)
    let right = width - 1;
    for (let x = width - 1; x >= 0; x--) {
      let hasPixel = false;
      for (let y = 0; y < height; y++) {
        if (pixels[y * width + x] > 0) {
          hasPixel = true;
          break;
        }
      }
      if (hasPixel) {
        right = x;
        break;
      }
    }

    // Calculate valid dimensions
    const validHeight = bottom - topSkip + 1;
    const validWidth = right - leftSkip + 1;

    // Crop the image
    const cropped = new Uint8Array(validWidth * validHeight);
    for (let y = 0; y < validHeight; y++) {
      for (let x = 0; x < validWidth; x++) {
        const srcIdx = (y + topSkip) * width + (x + leftSkip);
        const dstIdx = y * validWidth + x;
        cropped[dstIdx] = pixels[srcIdx];
      }
    }

    return {
      pixels: cropped,
      cropInfo: {
        topSkip,
        leftSkip,
        validWidth,
        validHeight,
      },
    };
  }

  /**
   * Pack image to 1-bit format (monochrome)
   *
   * Each byte contains 8 pixels. Pixels >= 128 are considered white (1),
   * pixels < 128 are considered black (0).
   *
   * Bit order matches C++ implementation:
   * - Pixel 0 at bit 0 (LSB)
   * - Pixel 7 at bit 7 (MSB)
   *
   * @param pixels - Input pixel data (grayscale 0-255)
   * @param width - Image width
   * @param height - Image height
   * @returns Packed bytes with 8 pixels per byte
   *
   * Requirements: 2.1, 2.8
   */
  static packTo1Bit(pixels: Uint8Array, width: number, height: number): Uint8Array {
    const bytesPerRow = Math.ceil(width / 8);
    const packed = new Uint8Array(height * bytesPerRow);

    for (let y = 0; y < height; y++) {
      for (let byteIdx = 0; byteIdx < bytesPerRow; byteIdx++) {
        let byteVal = 0;
        const colStart = byteIdx * 8;

        for (let bitPos = 0; bitPos < 8; bitPos++) {
          const col = colStart + bitPos;
          if (col < width) {
            const pixelVal = pixels[y * width + col];
            // Threshold: >= 128 is white (1), < 128 is black (0)
            if (pixelVal >= 128) {
              // C++ uses: data[pos/8] |= (value << (pos%8))
              // So pixel 0 is at LSB, pixel 7 is at MSB
              byteVal |= 1 << bitPos;
            }
          }
        }

        packed[y * bytesPerRow + byteIdx] = byteVal;
      }
    }

    return packed;
  }

  /**
   * Pack image to 2-bit format (4 gray levels)
   *
   * Each byte contains 4 pixels. Pixel values are quantized to 4 levels:
   * 0-63 -> 0, 64-127 -> 1, 128-191 -> 2, 192-255 -> 3
   *
   * Bit order matches C++ implementation:
   * - Pixel 0 at bits 0-1 (LSB)
   * - Pixel 1 at bits 2-3
   * - Pixel 2 at bits 4-5
   * - Pixel 3 at bits 6-7 (MSB)
   *
   * @param pixels - Input pixel data (grayscale 0-255)
   * @param width - Image width
   * @param height - Image height
   * @returns Packed bytes with 4 pixels per byte
   *
   * Requirements: 2.1, 2.8
   */
  static packTo2Bit(pixels: Uint8Array, width: number, height: number): Uint8Array {
    const bytesPerRow = Math.ceil(width / 4);
    const packed = new Uint8Array(height * bytesPerRow);

    for (let y = 0; y < height; y++) {
      for (let byteIdx = 0; byteIdx < bytesPerRow; byteIdx++) {
        let byteVal = 0;
        const colStart = byteIdx * 4;

        for (let pixelPos = 0; pixelPos < 4; pixelPos++) {
          const col = colStart + pixelPos;
          if (col < width) {
            // Quantize to 4 levels (2 bits): divide by 64
            const pixelVal = pixels[y * width + col] >> 6;
            // C++ uses: data[pos/4] |= (value << ((pos%4) * 2))
            byteVal |= pixelVal << (pixelPos * 2);
          }
        }

        packed[y * bytesPerRow + byteIdx] = byteVal;
      }
    }

    return packed;
  }

  /**
   * Pack image to 4-bit format (16 gray levels)
   *
   * Each byte contains 2 pixels. Pixel values are quantized to 16 levels:
   * 0-15 -> 0, 16-31 -> 1, ..., 240-255 -> 15
   *
   * Bit order matches C++ implementation:
   * - Pixel 0 at bits 0-3 (low nibble)
   * - Pixel 1 at bits 4-7 (high nibble)
   *
   * @param pixels - Input pixel data (grayscale 0-255)
   * @param width - Image width
   * @param height - Image height
   * @returns Packed bytes with 2 pixels per byte
   *
   * Requirements: 2.1, 2.8
   */
  static packTo4Bit(pixels: Uint8Array, width: number, height: number): Uint8Array {
    const bytesPerRow = Math.ceil(width / 2);
    const packed = new Uint8Array(height * bytesPerRow);

    for (let y = 0; y < height; y++) {
      for (let byteIdx = 0; byteIdx < bytesPerRow; byteIdx++) {
        let byteVal = 0;
        const colStart = byteIdx * 2;

        // First pixel in low nibble
        if (colStart < width) {
          const pixelVal = pixels[y * width + colStart] >> 4;
          byteVal |= pixelVal;
        }

        // Second pixel in high nibble
        if (colStart + 1 < width) {
          const pixelVal = pixels[y * width + colStart + 1] >> 4;
          byteVal |= pixelVal << 4;
        }

        packed[y * bytesPerRow + byteIdx] = byteVal;
      }
    }

    return packed;
  }

  /**
   * Pack image to 8-bit format (256 gray levels)
   *
   * Each byte contains 1 pixel. No quantization is performed.
   *
   * @param pixels - Input pixel data (grayscale 0-255)
   * @param width - Image width
   * @param height - Image height
   * @returns Packed bytes with 1 pixel per byte
   *
   * Requirements: 2.1, 2.8
   */
  static packTo8Bit(pixels: Uint8Array, _width: number, _height: number): Uint8Array {
    // Simply return a copy of the pixel data
    return new Uint8Array(pixels);
  }

  /**
   * Get the minimum pixel value that will be visible after packing for a given render mode.
   *
   * This threshold determines which pixels are "visible" in the final output:
   * - 1-bit: pixels >= 128 become 1, others become 0
   * - 2-bit: pixels >= 64 become non-zero (quantized by >> 6)
   * - 4-bit: pixels >= 16 become non-zero (quantized by >> 4)
   * - 8-bit: pixels >= 1 are visible (no quantization loss)
   *
   * Used by the bitmap generator to compute tight bounding boxes that match
   * the actual visible content after packing, preventing "ghost rows" where
   * anti-aliased pixels below the threshold inflate the bbox.
   *
   * @param renderMode - Render mode (1, 2, 4, or 8 bits per pixel)
   * @returns Minimum pixel value that will be visible after packing
   */
  static getVisibilityThreshold(renderMode: RenderMode): number {
    switch (renderMode) {
      case RenderMode.BIT_1:
        return 128; // >= 128 becomes 1
      case RenderMode.BIT_2:
        return 64; // >> 6 gives non-zero for >= 64
      case RenderMode.BIT_4:
        return 16; // >> 4 gives non-zero for >= 16
      case RenderMode.BIT_8:
        return 1; // any non-zero pixel is visible
      default:
        return 1;
    }
  }

  /**
   * Pack image according to render mode
   *
   * @param pixels - Input pixel data (grayscale 0-255)
   * @param width - Image width
   * @param height - Image height
   * @param renderMode - Render mode (1, 2, 4, or 8 bits per pixel)
   * @returns Packed pixel data
   *
   * Requirements: 2.1, 2.8
   */
  static packPixels(
    pixels: Uint8Array,
    width: number,
    height: number,
    renderMode: RenderMode
  ): Uint8Array {
    switch (renderMode) {
      case RenderMode.BIT_1:
        return this.packTo1Bit(pixels, width, height);
      case RenderMode.BIT_2:
        return this.packTo2Bit(pixels, width, height);
      case RenderMode.BIT_4:
        return this.packTo4Bit(pixels, width, height);
      case RenderMode.BIT_8:
        return this.packTo8Bit(pixels, width, height);
      default:
        throw new Error(`Invalid render mode: ${renderMode}. Must be 1, 2, 4, or 8.`);
    }
  }

  /**
   * Calculate the packed byte size for a given image and render mode
   *
   * @param width - Image width
   * @param height - Image height
   * @param renderMode - Render mode (1, 2, 4, or 8 bits per pixel)
   * @returns Number of bytes needed for packed data
   *
   * Requirements: 2.1, 2.8
   */
  static calculatePackedSize(width: number, height: number, renderMode: RenderMode): number {
    const pixelsPerByte = 8 / renderMode;
    const bytesPerRow = Math.ceil(width / pixelsPerByte);
    return height * bytesPerRow;
  }
}
