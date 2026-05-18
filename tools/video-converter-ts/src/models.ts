/**
 * Data models for the video converter
 * 
 * This module defines all the data types used throughout the video converter:
 * - OutputFormat: Enum for supported output formats
 * - VideoInfo: Interface for video metadata
 * - ConversionResult: Interface for conversion operation results
 * - ProgressCallback: Type for progress reporting
 * - ConversionOptions: Interface for conversion parameters
 */

/**
 * Supported output formats for video conversion
 */
export enum OutputFormat {
  /** MJPEG stream - concatenated JPEG frames */
  MJPEG = 'mjpeg',
  /** AVI container with MJPEG codec */
  AVI_MJPEG = 'avi_mjpeg',
  /** H264 raw stream with custom header */
  H264 = 'h264'
}

/**
 * Video metadata information obtained from ffprobe
 */
export interface VideoInfo {
  /** Video width in pixels */
  width: number;
  /** Video height in pixels */
  height: number;
  /** Frame rate in frames per second */
  frameRate: number;
  /** Total number of frames in the video */
  frameCount: number;
  /** Duration in seconds */
  duration: number;
  /** Video codec name (e.g., 'h264', 'mjpeg') */
  codec: string;
  /** Path to the video file */
  filePath: string;
}

/**
 * Result of a video conversion operation
 */
export interface ConversionResult {
  /** Whether the conversion was successful */
  success: boolean;
  /** Path to the input video file */
  inputPath: string;
  /** Path to the output file */
  outputPath: string;
  /** Output format used for conversion */
  outputFormat: OutputFormat;
  /** Number of frames in the output */
  frameCount: number;
  /** Frame rate of the output */
  frameRate: number;
  /** Quality setting used (1-31 for MJPEG/AVI, CRF for H264) */
  quality: number;
  /** Error message if conversion failed */
  errorMessage?: string;
}

/**
 * Callback function for reporting conversion progress
 * @param current - Current frame number being processed
 * @param total - Total number of frames to process
 */
export type ProgressCallback = (current: number, total: number) => void;

/**
 * Options for scaling (resizing) a video before conversion.
 * At least one dimension must be provided.
 * When only one dimension is specified, the other is calculated automatically
 * to maintain the original aspect ratio (rounded to the nearest even number).
 */
export interface ScaleOptions {
  /** Target width in pixels (must be a positive integer) */
  width?: number;
  /** Target height in pixels (must be a positive integer) */
  height?: number;
}

/**
 * Options for cropping a video before conversion.
 * Both width and height are required; x and y are optional (default to center).
 */
export interface CropOptions {
  /** Crop region width in pixels (must be a positive integer) */
  width: number;
  /** Crop region height in pixels (must be a positive integer) */
  height: number;
  /**
   * X offset of the top-left crop corner in pixels (non-negative integer).
   * Defaults to `(source_width - width) / 2` (horizontally centered).
   */
  x?: number;
  /**
   * Y offset of the top-left crop corner in pixels (non-negative integer).
   * Defaults to `(source_height - height) / 2` (vertically centered).
   */
  y?: number;
}

/**
 * A single pre-processing step in the ordered preprocess pipeline.
 *
 * Steps are executed in array order before the main conversion.
 * The output of each step is the input for the next.
 */
export type PreprocessStep =
  | { type: 'scale'; options: ScaleOptions }
  | { type: 'crop';  options: CropOptions  };

/**
 * Options for video conversion
 */
export interface ConversionOptions {
  /** Target frame rate (optional, uses source frame rate if not specified) */
  frameRate?: number;
  /** Quality setting (1-31 for MJPEG/AVI, CRF for H264) */
  quality?: number;
  /** Debug mode - keep intermediate files for inspection */
  debug?: boolean;
  /**
   * Ordered pre-processing pipeline executed before the main conversion.
   * Each step receives the output of the previous step as its input.
   * When this field is set, the `scale` shorthand is ignored.
   *
   * @example
   * // Crop first, then scale the cropped region
   * preprocess: [
   *   { type: 'crop',  options: { width: 640, height: 360 } },
   *   { type: 'scale', options: { width: 1280 } },
   * ]
   */
  preprocess?: PreprocessStep[];
  /**
   * Convenience shorthand: scale the input video before conversion.
   * Equivalent to `preprocess: [{ type: 'scale', options: <value> }]`.
   * Ignored when `preprocess` is set.
   */
  scale?: ScaleOptions;
}
