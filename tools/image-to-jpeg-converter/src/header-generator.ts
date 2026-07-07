/**
 * Binary header generator module for the Image to JPEG Converter.
 * 
 * Generates custom binary headers for JPEG files used in embedded display systems.
 * Implements RGB data header (8 bytes) and JPEG file header structures with
 * proper bit field packing and little-endian encoding.
 * 
 * @module header-generator
 * @see Requirements 4.1-4.8, 5.1-5.6, 9.1-9.5
 */

import { ConversionConfig, RgbDataHeader, JpegFileHeader } from './types.js';

/**
 * Error information for header generation failures.
 */
export interface HeaderGenerationError {
  /** Error message describing what went wrong */
  message: string;
  /** Additional error details */
  details?: unknown;
}

/**
 * Header generator for creating binary header structures.
 * 
 * Generates RGB data headers and JPEG file headers with proper binary encoding:
 * - Bit field packing for configuration flags
 * - Little-endian encoding for multi-byte fields
 * - Proper structure alignment (no padding bytes)
 * 
 * RGB Data Header (8 bytes):
 * - Byte 0: Bit fields (scan, align, resize, compress, jpeg, idu, rsvd)
 * - Byte 1: Type (12 for JPEG)
 * - Bytes 2-3: Width (uint16, little-endian)
 * - Bytes 4-5: Height (uint16, little-endian)
 * - Byte 6: Version
 * - Byte 7: Reserved (rsvd2)
 * 
 * JPEG File Header:
 * - Bytes 0-7: RGB data header
 * - Bytes 8-11: JPEG size (uint32, little-endian, from 0xFFD8)
 * - Bytes 12-15: Dummy field (uint32, set to 0)
 * - Bytes 16+: JPEG data (starting with 0xFFD8)
 * 
 * @see Requirements 4.1-4.8, 5.1-5.6, 9.1-9.5
 */
export class HeaderGenerator {
  /**
   * Generates an RGB data header structure.
   * 
   * Creates an 8-byte header with image metadata and configuration flags.
   * All bit fields are initialized to 0 by default, except:
   * - resize: Set based on config.resize option (0-3)
   * - compress: Set to 1 if config.compress is true
   * 
   * @param width - Image width in pixels (uint16)
   * @param height - Image height in pixels (uint16)
   * @param config - Conversion configuration with resize and compress options
   * @returns RgbDataHeader structure
   * 
   * @example
   * ```typescript
   * const generator = new HeaderGenerator();
   * const header = generator.generateRgbHeader(640, 480, config);
   * // header.type === 12 (JPEG)
   * // header.w === 640
   * // header.h === 480
   * ```
   * 
   * @see Requirements 4.1-4.8
   */
  generateRgbHeader(
    width: number,
    height: number,
    _config: ConversionConfig  // 使用 _ 前缀表示未使用的参数
  ): RgbDataHeader {
    // 根据 spec_v4.txt 要求：gui_rgb_data_head_t 填充 type、w 和 h，其余为 0
    // 严格按照规范，所有位字段都设为 0
    const scan = 0;
    const align = 0;
    const resize = 0;      // 强制为 0，忽略用户配置
    const compress = 0;    // 强制为 0，忽略用户配置
    const jpeg = 0;
    const idu = 0;
    const rsvd = 0;

    // 只填充 type、w、h 三个字段 (spec_v4.txt 要求)
    const type = 12;       // JPEG = 12
    const w = width;       // 图片宽度
    const h = height;      // 图片高度

    // version 和 rsvd2 也设为 0 (spec_v4.txt 要求)
    const version = 0;     // 强制为 0，忽略用户配置
    const rsvd2 = 0;

    return {
      scan,
      align,
      resize,
      compress,
      jpeg,
      idu,
      rsvd,
      type,
      w,
      h,
      version,
      rsvd2,
    };
  }

  /**
   * Generates a JPEG file header structure.
   * 
   * Creates a complete header structure that includes:
   * - RGB data header (8 bytes)
   * - JPEG size field (4 bytes, calculated from 0xFFD8 marker)
   * - Dummy field (4 bytes, set to 0)
   * - JPEG data (variable length)
   * 
   * Validates that JPEG data starts with 0xFFD8 SOI marker.
   * 
   * @param rgbHeader - RGB data header structure
   * @param jpegData - JPEG data buffer (must start with 0xFFD8)
   * @returns JpegFileHeader structure
   * @throws HeaderGenerationError if JPEG data is invalid
   * 
   * @example
   * ```typescript
   * const generator = new HeaderGenerator();
   * const rgbHeader = generator.generateRgbHeader(640, 480, config);
   * const jpegHeader = generator.generateJpegHeader(rgbHeader, jpegData);
   * ```
   * 
   * @see Requirements 5.1-5.5, 6.3
   */
  generateJpegHeader(
    rgbHeader: RgbDataHeader,
    jpegData: Buffer
  ): JpegFileHeader {
    // Validate JPEG data starts with 0xFFD8 (Requirement 5.5)
    if (jpegData.length < 2 || jpegData[0] !== 0xff || jpegData[1] !== 0xd8) {
      throw {
        message: 'Invalid JPEG data: must start with 0xFFD8 SOI marker',
        details: {
          length: jpegData.length,
          firstBytes: jpegData.length >= 2 ? [jpegData[0], jpegData[1]] : [],
        },
      } as HeaderGenerationError;
    }

    // Calculate size field from 0xFFD8 marker (Requirement 5.2)
    // Size is the byte count of JPEG data, excluding header bytes (Requirement 5.3)
    const size = jpegData.length;

    // Set dummy field to 0 (Requirement 5.4)
    const dummy = 0;

    // Include RgbDataHeader as first component (Requirement 5.1)
    return {
      img_header: rgbHeader,
      size,
      dummy,
      jpeg: jpegData,
    };
  }

  /**
   * Encodes a JPEG file header to a binary Buffer.
   * 
   * Packs the header structure into a binary format with:
   * - Little-endian byte order for multi-byte fields (Requirement 9.1)
   * - No padding bytes between fields (Requirement 9.5)
   * - Proper field sizes: width/height (2 bytes), size (4 bytes) (Requirements 9.2, 9.3)
   * 
   * Binary layout (16 bytes total):
   * - Bytes 0-7: RGB data header (8 bytes)
   * - Bytes 8-11: JPEG size (uint32, little-endian)
   * - Bytes 12-15: Dummy field (uint32, little-endian)
   *
   * The JPEG payload is NOT part of this buffer. FileAssembler appends the JPEG
   * data exactly once when writing the file (see file-assembler.ts), keeping a
   * single owner for concatenation so the payload is never duplicated.
   *
   * @param header - JPEG file header structure to encode
   * @returns 16-byte Buffer containing only the binary header (no JPEG data)
   * 
   * @example
   * ```typescript
   * const generator = new HeaderGenerator();
   * const headerBytes = generator.encodeToBytes(jpegHeader);
   * // headerBytes[0] contains bit fields
   * // headerBytes[1] === 12 (type)
   * // headerBytes[2-3] contain width (little-endian)
   * // headerBytes[4-5] contain height (little-endian)
   * ```
   * 
   * @see Requirements 9.1-9.5
   */
  encodeToBytes(header: JpegFileHeader): Buffer {
    // The custom header is exactly 16 bytes: 8 (RGB header) + 4 (size) + 4 (dummy).
    // The JPEG payload is intentionally NOT included here — FileAssembler appends
    // the JPEG data exactly once when writing the output file. Copying it here as
    // well would duplicate the entire JPEG in the final file.
    const buffer = Buffer.alloc(16);

    let offset = 0;

    // Encode RGB Data Header (8 bytes)
    offset = this.encodeRgbHeader(buffer, offset, header.img_header);

    // Encode size field (4 bytes, uint32, little-endian) (Requirements 9.1, 9.2)
    buffer.writeUInt32LE(header.size, offset);
    offset += 4;

    // Encode dummy field (4 bytes, uint32, little-endian)
    buffer.writeUInt32LE(header.dummy, offset);

    return buffer;
  }

  /**
   * Encodes an RGB data header to a buffer at the specified offset.
   * 
   * Packs the 8-byte RGB data header with proper bit field packing and
   * little-endian encoding for multi-byte fields.
   * 
   * Byte 0 bit layout (LSB to MSB):
   * - Bit 0: scan
   * - Bit 1: align
   * - Bits 2-3: resize (2 bits)
   * - Bit 4: compress
   * - Bit 5: jpeg
   * - Bit 6: idu
   * - Bit 7: rsvd
   * 
   * @param buffer - Target buffer to write to
   * @param offset - Starting offset in the buffer
   * @param header - RGB data header structure
   * @returns New offset after writing (offset + 8)
   * 
   * @see Requirements 4.1-4.8, 9.1-9.5
   */
  private encodeRgbHeader(
    buffer: Buffer,
    offset: number,
    header: RgbDataHeader
  ): number {
    // Byte 0: Pack bit fields (LSB to MSB)
    // Bit 0: scan (1 bit)
    // Bit 1: align (1 bit)
    // Bits 2-3: resize (2 bits)
    // Bit 4: compress (1 bit)
    // Bit 5: jpeg (1 bit)
    // Bit 6: idu (1 bit)
    // Bit 7: rsvd (1 bit)
    const byte0 =
      (header.scan & 0x01) |        // Bit 0
      ((header.align & 0x01) << 1) | // Bit 1
      ((header.resize & 0x03) << 2) | // Bits 2-3 (2 bits)
      ((header.compress & 0x01) << 4) | // Bit 4
      ((header.jpeg & 0x01) << 5) |  // Bit 5
      ((header.idu & 0x01) << 6) |   // Bit 6
      ((header.rsvd & 0x01) << 7);   // Bit 7

    buffer.writeUInt8(byte0, offset);
    offset += 1;

    // Byte 1: Type (uint8)
    buffer.writeUInt8(header.type, offset);
    offset += 1;

    // Bytes 2-3: Width (uint16, little-endian) (Requirements 9.1, 9.3)
    buffer.writeUInt16LE(header.w, offset);
    offset += 2;

    // Bytes 4-5: Height (uint16, little-endian) (Requirements 9.1, 9.3)
    buffer.writeUInt16LE(header.h, offset);
    offset += 2;

    // Byte 6: Version (uint8)
    buffer.writeUInt8(header.version, offset);
    offset += 1;

    // Byte 7: Reserved (uint8)
    buffer.writeUInt8(header.rsvd2, offset);
    offset += 1;

    return offset;
  }

  /**
   * Extracts image dimensions from JPEG data.
   * 
   * Parses JPEG markers to find the Start of Frame (SOF) marker and extract
   * the image width and height. Supports baseline JPEG (SOF0, 0xFFC0).
   * 
   * @param jpegData - JPEG data buffer
   * @returns Object with width and height, or null if dimensions cannot be extracted
   * 
   * @example
   * ```typescript
   * const generator = new HeaderGenerator();
   * const dimensions = generator.extractDimensions(jpegData);
   * if (dimensions) {
   *   console.log(`Image size: ${dimensions.width}x${dimensions.height}`);
   * }
   * ```
   */
  extractDimensions(jpegData: Buffer): { width: number; height: number } | null {
    // Verify JPEG starts with SOI marker (0xFFD8)
    if (jpegData.length < 2 || jpegData[0] !== 0xff || jpegData[1] !== 0xd8) {
      return null;
    }

    let offset = 2; // Start after SOI marker

    // Scan for SOF0 marker (0xFFC0) - Start of Frame (Baseline DCT)
    while (offset < jpegData.length - 1) {
      // Look for marker (0xFF followed by non-0xFF)
      if (jpegData[offset] !== 0xff) {
        offset++;
        continue;
      }

      const marker = jpegData[offset + 1];

      // Skip padding bytes (0xFF 0xFF)
      if (marker === 0xff) {
        offset++;
        continue;
      }

      // Check if this is SOF0 (0xC0) - Baseline DCT
      if (marker === 0xc0) {
        // SOF0 structure:
        // - 2 bytes: marker (0xFFC0)
        // - 2 bytes: length
        // - 1 byte: precision
        // - 2 bytes: height
        // - 2 bytes: width
        // - ...

        if (offset + 9 > jpegData.length) {
          return null; // Not enough data
        }

        // Read height (bytes 5-6 after marker, big-endian)
        const heightByte1 = jpegData[offset + 5];
        const heightByte2 = jpegData[offset + 6];
        if (heightByte1 === undefined || heightByte2 === undefined) {
          return null;
        }
        const height = (heightByte1 << 8) | heightByte2;

        // Read width (bytes 7-8 after marker, big-endian)
        const widthByte1 = jpegData[offset + 7];
        const widthByte2 = jpegData[offset + 8];
        if (widthByte1 === undefined || widthByte2 === undefined) {
          return null;
        }
        const width = (widthByte1 << 8) | widthByte2;

        return { width, height };
      }

      // Skip this marker segment
      // Read segment length (2 bytes, big-endian, includes length bytes)
      if (offset + 3 >= jpegData.length) {
        break; // Not enough data
      }

      const lengthByte1 = jpegData[offset + 2];
      const lengthByte2 = jpegData[offset + 3];
      if (lengthByte1 === undefined || lengthByte2 === undefined) {
        break;
      }
      const segmentLength = (lengthByte1 << 8) | lengthByte2;
      offset += 2 + segmentLength; // Skip marker (2 bytes) + segment data
    }

    return null; // SOF0 marker not found
  }
}
