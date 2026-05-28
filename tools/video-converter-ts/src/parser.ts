/**
 * VideoParser - Video metadata parsing using ffprobe
 * 
 * This module provides functionality to parse video files and extract metadata
 * using the ffprobe command-line tool (part of FFmpeg).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

import { VideoInfo } from './models';
import { VideoFormatError, FFmpegNotFoundError, FFmpegError } from './errors';

const execFileAsync = promisify(execFile);

/**
 * ffprobe JSON output types
 */
interface FfprobeStream {
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  nb_frames?: string;
  duration?: string;
}

interface FfprobeFormat {
  duration?: string;
}

interface FfprobeOutput {
  streams: FfprobeStream[];
  format: FfprobeFormat;
}

/**
 * VideoParser - Parses video file metadata using ffprobe
 * 
 * Usage:
 * ```typescript
 * const parser = new VideoParser();
 * const info = await parser.parse('/path/to/video.mp4');
 * console.log(info.width, info.height, info.frameRate);
 * ```
 */
export class VideoParser {
  private ffprobeCmd: string;

  constructor() {
    // Use platform-specific command name
    this.ffprobeCmd = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  }

  /**
   * Check if ffprobe is available in the system PATH
   * 
   * @returns Promise<boolean> - true if ffprobe is available, false otherwise
   */
  private async checkFfprobeAvailable(): Promise<boolean> {
    try {
      await execFileAsync(this.ffprobeCmd, ['-version'], { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure ffprobe is available, throw error if not
   * 
   * @throws FFmpegNotFoundError if ffprobe is not installed or not in PATH
   */
  private async ensureFfprobeAvailable(): Promise<void> {
    if (!(await this.checkFfprobeAvailable())) {
      throw new FFmpegNotFoundError(
        'ffprobe 未安装或不在系统 PATH 中。' +
        '请安装 ffmpeg（包含 ffprobe）并确保其在系统 PATH 中可访问。'
      );
    }
  }

  /**
   * Run ffprobe command and return JSON output
   * 
   * @param inputPath - Path to the input video file
   * @returns Promise<FfprobeOutput> - Parsed JSON output from ffprobe
   * @throws FFmpegNotFoundError if ffprobe is not installed
   * @throws FFmpegError if ffprobe execution times out
   * @throws VideoFormatError if the video format is unsupported or cannot be parsed
   */
  private async runFfprobe(inputPath: string): Promise<FfprobeOutput> {
    const cmd = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      inputPath
    ];

    try {
      const { stdout, stderr } = await execFileAsync(this.ffprobeCmd, cmd, { timeout: 30000 });
      
      // Parse JSON output
      try {
        const data = JSON.parse(stdout) as FfprobeOutput;
        return data;
      } catch (e) {
        throw new VideoFormatError(`无法解析 ffprobe 输出: ${e}`);
      }
    } catch (error: unknown) {
      // Handle specific error types
      if (error instanceof VideoFormatError) {
        throw error;
      }
      
      const err = error as NodeJS.ErrnoException & { killed?: boolean };
      
      if (err.code === 'ENOENT') {
        throw new FFmpegNotFoundError(
          'ffprobe 未安装或不在系统 PATH 中。' +
          '请安装 ffmpeg（包含 ffprobe）并确保其在系统 PATH 中可访问。'
        );
      }
      
      if (err.killed) {
        throw new FFmpegError(`ffprobe 执行超时: ${inputPath}`);
      }
      
      // For other errors (including non-zero exit code), treat as format error
      throw new VideoFormatError(`不支持的视频格式或无法解析: ${inputPath}`);
    }
  }

  /**
   * Find video stream from ffprobe output
   * 
   * @param data - ffprobe JSON output
   * @returns FfprobeStream - The video stream information
   * @throws VideoFormatError if no video stream is found
   */
  private findVideoStream(data: FfprobeOutput): FfprobeStream {
    const streams = data.streams || [];
    
    for (const stream of streams) {
      if (stream.codec_type === 'video') {
        return stream;
      }
    }
    
    throw new VideoFormatError('文件中未找到视频流');
  }

  /**
   * Parse frame rate from stream information
   * Supports both fraction format (e.g., "30000/1001") and decimal format (e.g., "29.97")
   * 
   * @param stream - Video stream information
   * @returns number - Frame rate in FPS
   */
  private parseFrameRate(stream: FfprobeStream): number {
    // Prefer avg_frame_rate
    let frameRateStr = stream.avg_frame_rate || '0/1';
    
    // If avg_frame_rate is invalid, try r_frame_rate
    if (frameRateStr === '0/0' || frameRateStr === '0/1') {
      frameRateStr = stream.r_frame_rate || '0/1';
    }
    
    // Parse fraction format (e.g., "30/1" or "30000/1001")
    try {
      if (frameRateStr.includes('/')) {
        const parts = frameRateStr.split('/');
        const numStr = parts[0];
        const denStr = parts[1];
        if (numStr && denStr) {
          const num = parseFloat(numStr);
          const den = parseFloat(denStr);
          if (den > 0) {
            return num / den;
          }
        }
      } else {
        return parseFloat(frameRateStr);
      }
    } catch {
      // Fall through to return 0
    }
    
    return 0.0;
  }

  /**
   * Parse frame count from stream and format information
   * Uses nb_frames if available, otherwise calculates from duration * frame_rate
   * 
   * @param stream - Video stream information
   * @param format - Format information
   * @param frameRate - Frame rate in FPS
   * @param duration - Duration in seconds
   * @returns number - Frame count
   */
  private parseFrameCount(
    stream: FfprobeStream,
    format: FfprobeFormat,
    frameRate: number,
    duration: number
  ): number {
    // Prefer nb_frames
    const nbFrames = stream.nb_frames;
    if (nbFrames !== undefined && nbFrames !== null) {
      try {
        const count = parseInt(nbFrames, 10);
        if (count > 0) {
          return count;
        }
      } catch {
        // Fall through to calculation
      }
    }
    
    // If no nb_frames, calculate from duration and frame rate
    if (frameRate > 0 && duration > 0) {
      return Math.floor(frameRate * duration);
    }
    
    return 0;
  }

  /**
   * Parse video file and return video information
   * 
   * Uses ffprobe command:
   * ffprobe -v quiet -print_format json -show_streams -show_format <input>
   * 
   * @param inputPath - Path to the input video file
   * @returns Promise<VideoInfo> - Video metadata including width, height, frame rate, etc.
   * @throws FileNotFoundError if the file does not exist
   * @throws VideoFormatError if the video format is unsupported or cannot be parsed
   * @throws FFmpegNotFoundError if ffprobe is not installed or not in PATH
   */
  async parse(inputPath: string): Promise<VideoInfo> {
    // Check if file exists
    if (!fs.existsSync(inputPath)) {
      const error = new Error(`文件不存在: ${inputPath}`) as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    }
    
    // Ensure ffprobe is available
    await this.ensureFfprobeAvailable();
    
    // Run ffprobe
    const data = await this.runFfprobe(inputPath);
    
    // Check if we have valid data
    if (!data || (!data.streams && !data.format)) {
      throw new VideoFormatError(`不支持的视频格式或无法解析: ${inputPath}`);
    }
    
    // Find video stream
    const videoStream = this.findVideoStream(data);
    const formatInfo = data.format || {};
    
    // Extract video properties
    const width = videoStream.width || 0;
    const height = videoStream.height || 0;
    const codec = videoStream.codec_name || 'unknown';
    
    // Parse duration first — needed by the GIF frame-rate fallback below
    let duration = 0.0;
    const durationStr = videoStream.duration || formatInfo.duration;
    if (durationStr) {
      try {
        duration = parseFloat(durationStr);
      } catch {
        // Keep duration as 0
      }
    }

    // Parse frame rate
    let frameRate = this.parseFrameRate(videoStream);

    // GIF-specific correction: avg_frame_rate is often "0/0" and r_frame_rate
    // is typically "100/1" — a bogus value derived from GIF centisecond timing.
    // When avg_frame_rate is absent or invalid, derive the real frame rate from
    // nb_frames / duration instead of relying on the misleading r_frame_rate.
    if (codec === 'gif') {
      const avgFr = videoStream.avg_frame_rate ?? '';
      const avgFrIsValid = avgFr !== '' && avgFr !== '0/0' && avgFr !== '0/1';
      if (!avgFrIsValid) {
        const nbFramesRaw = videoStream.nb_frames;
        const nbFramesNum = nbFramesRaw ? parseInt(nbFramesRaw, 10) : 0;
        if (nbFramesNum > 0 && duration > 0) {
          frameRate = nbFramesNum / duration;
        }
      }
    }
    
    // Parse frame count
    const frameCount = this.parseFrameCount(videoStream, formatInfo, frameRate, duration);
    
    // Validate data
    if (width <= 0 || height <= 0) {
      throw new VideoFormatError(`无效的视频尺寸: ${width}x${height}`);
    }
    
    if (frameRate <= 0) {
      throw new VideoFormatError(`无效的帧率: ${frameRate}`);
    }
    
    if (frameCount <= 0) {
      throw new VideoFormatError(`无效的帧数: ${frameCount}`);
    }
    
    return {
      width,
      height,
      frameRate,
      frameCount,
      duration,
      codec,
      filePath: path.resolve(inputPath)
    };
  }
}
