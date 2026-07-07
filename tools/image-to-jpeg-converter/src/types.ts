/**
 * Type definitions for the Image to JPEG Converter library.
 * 
 * This module provides TypeScript interfaces, enums, and types for converting
 * images to JPEG format with custom binary headers for embedded display systems.
 * 
 * @module types
 */

/**
 * Chroma subsampling factor for JPEG encoding.
 * 
 * Controls the color quality and file size trade-off:
 * - 400: Grayscale (no chroma subsampling, Y channel only)
 * - 420: 4:2:0 subsampling (most common, good compression)
 * - 422: 4:2:2 subsampling (better quality, moderate compression)
 * - 444: 4:4:4 subsampling (best quality, least compression)
 * 
 * Maps to FFmpeg pixel formats:
 * - 400 → gray
 * - 420 → yuvj420p
 * - 422 → yuvj422p
 * - 444 → yuvj444p
 * 
 * @see Requirements 2.1-2.5
 */
export enum SamplingFactor {
  /** Grayscale (Y channel only) */
  Grayscale = 400,
  /** 4:2:0 chroma subsampling */
  YUV420 = 420,
  /** 4:2:2 chroma subsampling */
  YUV422 = 422,
  /** 4:4:4 chroma subsampling (no subsampling) */
  YUV444 = 444,
}

/**
 * Resize option for image scaling.
 * 
 * Specifies the target size as a percentage of the original dimensions.
 * The value is stored in the resize field (2 bits) of the RGB data header.
 * 
 * @see Requirements 4.6
 */
export enum ResizeOption {
  /** No resizing (100%) */
  None = 0,
  /** Resize to 50% of original dimensions */
  Fifty = 1,
  /** Resize to 70% of original dimensions */
  Seventy = 2,
  /** Resize to 80% of original dimensions */
  Eighty = 3,
}

/**
 * Configuration parameters for image to JPEG conversion.
 * 
 * 注意：根据 spec_v4.txt 要求，gui_rgb_data_head_t 只填充 type、w、h，
 * 其余字段强制为 0。因此 resize、compress、version 等参数仅保留
 * 用于 API 兼容性，但不会影响实际的头部生成。
 * 
 * @see Requirements 11.5
 */
export interface ConversionConfig {
  /** Path to the input image file (any format supported by FFmpeg) */
  inputPath: string;

  /** Path where the output JPEG file with custom header will be written */
  outputPath: string;

  /** Chroma subsampling factor (400, 420, 422, or 444) */
  samplingFactor: SamplingFactor;

  /**
   * JPEG encoding quality (1-31, lower is higher quality).
   * If not specified, a default value appropriate for the sampling factor will be used.
   * 
   * @see Requirements 3.1-3.3
   */
  quality?: number;

  /**
   * Resize option for scaling the image.
   * 注意：此参数保留用于 API 兼容性，但根据 spec_v4.txt 要求，
   * 头部中的 resize 字段将强制为 0。
   * 
   * @deprecated 根据 spec_v4.txt，头部 resize 字段强制为 0
   * @see Requirements 4.6
   */
  resize?: ResizeOption;

  /**
   * Enable compression flag in the header.
   * 注意：此参数保留用于 API 兼容性，但根据 spec_v4.txt 要求，
   * 头部中的 compress 字段将强制为 0。
   * 
   * @deprecated 根据 spec_v4.txt，头部 compress 字段强制为 0
   * @see Requirements 4.7
   */
  compress?: boolean;

  /**
   * Version field for the RGB data header.
   * 注意：此参数保留用于 API 兼容性，但根据 spec_v4.txt 要求，
   * 头部中的 version 字段将强制为 0。
   * 
   * @deprecated 根据 spec_v4.txt，头部 version 字段强制为 0
   * @see Requirements 4.8
   */
  version?: number;

  /**
   * Background color for transparent images.
   * When processing images with transparency (PNG, etc.), this color
   * will be used as the background. Defaults to 'black'.
   * 
   * Supported values: 'black', 'white', or hex color like '#FF0000'
   *
   * @see spec_v4.txt transparency handling
   */
  backgroundColor?: string;

  /**
   * Align the JPEG SOF (coded) dimensions to the MCU grid.
   *
   * JPEG ALWAYS encodes in whole MCU blocks (420→16×16, 422→16×8, 444/400→8×8)
   * — that physical size is invariant. This flag controls ONLY the width/height
   * written into the JPEG SOF marker:
   * - `true`  → the frame is padded on the right/bottom so the SOF reports the
   *   MCU-aligned size (e.g. 686 → 688). Targets hardware decoders that consume
   *   whole MCU blocks and cannot crop back to a non-MCU stored size.
   * - `false` → the SOF reports the exact content size (which may be non-MCU,
   *   e.g. 686 or a `minWidth` of 50); the encoder still pads to a whole MCU
   *   internally, but the decoder crops that away.
   *
   * The custom GUI header (`gui_rgb_data_head_t`) always reports the ORIGINAL
   * input dimensions, and all of its bit fields (including `align`) remain 0 per
   * spec_v4.txt. Requires `ffprobe` (ships with FFmpeg) to read the original
   * input size.
   *
   * Defaults to false. With no `min` either, no padding happens and both the
   * GUI header and the JPEG SOF report the original size (unchanged behavior).
   */
  align?: boolean;

  /**
   * Minimum CONTENT width in pixels.
   *
   * When the original input is narrower than this, the frame is padded on the
   * right up to this width before encoding (black fill), so the content — and
   * therefore the JPEG SOF width — is `>= minWidth`. The value is always raised
   * to at least one MCU ("不应小于 mcu"); a value below the MCU is clamped up.
   *
   * `min` sets the content size only; whether the resulting SOF value is then
   * rounded up to the MCU grid is decided independently by `align`:
   * - `align` off → SOF width = `max(original, minWidth)` (exact, may be non-MCU)
   * - `align` on  → SOF width = `roundUpToMCU(max(original, minWidth))`
   *
   * The GUI header still reports the ORIGINAL input width. Setting this (or
   * `minHeight`) enables the padding path even when `align` is false, and
   * requires `ffprobe` to read the original size.
   *
   * Defaults to the MCU width for the sampling factor (a no-op for any image
   * already wider than the MCU).
   */
  minWidth?: number;

  /**
   * Minimum CONTENT height in pixels.
   *
   * The vertical counterpart of {@link ConversionConfig.minWidth}: pads on the
   * bottom up to this height (clamped to at least one MCU). Whether the SOF
   * height is then MCU-rounded is controlled by `align` (off → exact
   * `max(original, minHeight)`; on → rounded up to the MCU grid). The GUI header
   * keeps the ORIGINAL input height.
   *
   * Defaults to the MCU height for the sampling factor.
   */
  minHeight?: number;
}

/**
 * Result of a successful image conversion.
 * 
 * Contains metadata about the converted image and output file.
 * 
 * @see Requirements 11.5
 */
export interface ConversionResult {
  /** Indicates successful conversion */
  success: true;

  /** Path to the output file that was created */
  outputPath: string;

  /** Size of the JPEG data in bytes (excluding custom header) */
  jpegSize: number;

  /**
   * Logical dimensions of the image, as written to the GUI header.
   *
   * This is the ORIGINAL input size. When `align` and/or `min` padding is in
   * effect it may differ from the size actually written to the JPEG SOF marker
   * (see `encodedDimensions`).
   */
  dimensions: {
    /** Image width in pixels */
    width: number;
    /** Image height in pixels */
    height: number;
  };

  /**
   * Dimensions written to the JPEG SOF marker (the coded/logical size).
   *
   * Present only when padding actually changed the size — i.e. `align` was on
   * and/or a `min` raised the content above the original. The value is
   * MCU-aligned when `align` was on, or the exact content size (possibly
   * non-MCU) when only `min` padding applied. When no padding occurred this is
   * omitted and the encoded size equals `dimensions`.
   */
  encodedDimensions?: {
    /** SOF width in pixels (MCU-aligned iff `align` was on) */
    width: number;
    /** SOF height in pixels (MCU-aligned iff `align` was on) */
    height: number;
  };
}

/**
 * Error category for conversion failures.
 * 
 * Categorizes different types of errors that can occur during conversion.
 * 
 * @see Requirements 10.4
 */
export type ConversionErrorType = 
  | 'validation'  // Input validation failed
  | 'ffmpeg'      // FFmpeg execution failed
  | 'io'          // File I/O operation failed
  | 'header';     // Header generation failed

/**
 * Error information for failed conversions.
 * 
 * Provides detailed information about what went wrong during conversion.
 * 
 * @see Requirements 10.4, 11.6
 */
export interface ConversionError {
  /** Indicates failed conversion */
  success: false;

  /** Category of error that occurred */
  type: ConversionErrorType;

  /** Human-readable error message with context */
  message: string;

  /**
   * Additional error details (e.g., FFmpeg stderr, exit code, file paths).
   * The structure depends on the error type.
   */
  details?: unknown;
}

/**
 * RGB data header structure (8 bytes).
 * 
 * Contains image metadata and configuration flags for embedded display systems.
 * This structure is prepended to the JPEG data in the output file.
 * 
 * Binary layout:
 * - Byte 0: Bit fields (scan, align, resize, compress, jpeg, idu, rsvd)
 * - Byte 1: Type (12 for JPEG)
 * - Bytes 2-3: Width (uint16, little-endian)
 * - Bytes 4-5: Height (uint16, little-endian)
 * - Byte 6: Version
 * - Byte 7: Reserved (rsvd2)
 * 
 * @see Requirements 4.1-4.8, 9.1-9.5
 */
export interface RgbDataHeader {
  /** Scan mode flag (1 bit, default 0) */
  scan: number;

  /** Alignment flag (1 bit, default 0) */
  align: number;

  /** Resize option (2 bits: 0=none, 1=50%, 2=70%, 3=80%) */
  resize: number;

  /** Compression flag (1 bit: 0=disabled, 1=enabled) */
  compress: number;

  /** JPEG flag (1 bit, default 0) */
  jpeg: number;

  /** IDU flag (1 bit, default 0) */
  idu: number;

  /** Reserved bit field (1 bit, default 0) */
  rsvd: number;

  /** Image type (8 for JPEG images) */
  type: number;

  /** Image width in pixels (uint16) */
  w: number;

  /** Image height in pixels (uint16) */
  h: number;

  /** Version field (default 0) */
  version: number;

  /** Reserved field (default 0) */
  rsvd2: number;
}

/**
 * Complete JPEG file header structure.
 * 
 * Combines the RGB data header with JPEG size information and the actual JPEG data.
 * This is the complete structure written to the output file.
 * 
 * Binary layout:
 * - Bytes 0-7: RGB data header (img_header)
 * - Bytes 8-11: JPEG data size (uint32, little-endian, from 0xFFD8 marker)
 * - Bytes 12-15: Dummy field for alignment (uint32, set to 0)
 * - Bytes 16+: JPEG data (starting with 0xFFD8 SOI marker)
 * 
 * @see Requirements 5.1-5.5, 6.1-6.3
 */
export interface JpegFileHeader {
  /** RGB data header (8 bytes) */
  img_header: RgbDataHeader;

  /**
   * Size of JPEG data in bytes, calculated from the 0xFFD8 marker.
   * Excludes the custom header bytes (first 16 bytes).
   */
  size: number;

  /** Dummy field for alignment (always 0) */
  dummy: number;

  /** JPEG data buffer (must start with 0xFFD8 SOI marker) */
  jpeg: Buffer;
}
