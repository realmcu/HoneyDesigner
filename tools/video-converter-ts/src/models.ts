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
   * Scale (resize) the input video before conversion.
   * Scaling is performed as a pre-processing step, independent of the conversion.
   * When both width and height are specified, the video is scaled to the exact
   * dimensions (may change aspect ratio).
   * When only one is specified, the other is auto-calculated to preserve aspect ratio.
   */
  scale?: ScaleOptions;
}
