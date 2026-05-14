/**
 * FFmpegBuilder - FFmpeg command construction
 * 
 * Builds FFmpeg commands for different output formats:
 * - MJPEG frames extraction
 * - AVI-MJPEG conversion
 * - H264 conversion
 */

import * as path from 'path';
import { ScaleOptions } from './models';

export class FFmpegBuilder {
  /**
   * H264 encoding parameters (same as Python version)
   * Contains x264 encoder settings with {crf} placeholder for quality control
   */
  private static readonly H264_X264_PARAMS =
    'cabac=0:ref=3:deblock=1:0:0:analyse=0x1:0x111:me=hex:subme=7:' +
    'psy=1:psy_rd=1.0:0.0:mixed_ref=1:me_range=16:chroma_me=1:' +
    'trellis=1:8x8dct=0:deadzone-inter=21:deadzone-intra=11:' +
    'fast_pskip=1:chroma_qp_offset=-2:threads=11:lookahead_threads=1:' +
    'sliced_threads=0:nr=0:decimate=1:interlaced=0:bluray_compat=0:' +
    'constrained_intra=0:bframes=0:weightp=0:keyint=40:min-keyint=4:' +
    'scenecut=40:intra_refresh=0:rc_lookahead=40:mbtree=1:' +
    'crf={crf}:qcomp=0.60:qpmin=0:qpmax=69:qpstep=4:ipratio=1.40:' +
    'aq-mode=1:aq-strength=1.00';

  /**
   * Build video scaling (resize) command
   *
   * Scales the input video to the specified dimensions using the FFmpeg `scale`
   * video filter. When only one dimension is specified, the other is computed
   * automatically to preserve the original aspect ratio (result is always an
   * even number, required by most codecs).
   *
   * Command format (example — both dimensions):
   *   ffmpeg -i input.mp4 -vf "scale=1280:720" -c:v libx264 -crf 18 -preset fast output.mp4
   *
   * @param inputPath - Input video file path
   * @param outputPath - Output file path (use `.mp4` extension for best compatibility)
   * @param options - Scale options (width and/or height in pixels)
   * @returns FFmpeg command arguments array
   */
  buildScaleCmd(
    inputPath: string,
    outputPath: string,
    options: ScaleOptions
  ): string[] {
    const { width, height } = options;

    // Build scale expression: use -2 for auto-calculated dimension (keeps aspect
    // ratio and ensures result is divisible by 2, required by most video codecs)
    let scaleExpr: string;
    if (width !== undefined && height !== undefined) {
      scaleExpr = `${width}:${height}`;
    } else if (width !== undefined) {
      scaleExpr = `${width}:-2`;
    } else {
      scaleExpr = `-2:${height}`;
    }

    return [
      'ffmpeg', '-i', inputPath,
      '-vf', `scale=${scaleExpr}`,
      '-c:v', 'libx264',
      '-crf', '18',
      '-preset', 'fast',
      outputPath,
    ];
  }

  /**
   * 
   * Command format:
   * ffmpeg -i input.mp4 -r 24 -vf "format=yuvj420p" -q:v 5 output/frame_%04d.jpg
   * 
   * @param inputPath - Input video file path
   * @param outputDir - Output directory path
   * @param frameRate - Target frame rate, undefined to keep original
   * @param quality - JPEG quality (1-31, 1 is highest), defaults to 5
   * @returns FFmpeg command arguments array
   */
  buildMjpegFramesCmd(
    inputPath: string,
    outputDir: string,
    frameRate?: number,
    quality: number = 5
  ): string[] {
    const cmd: string[] = ['ffmpeg', '-i', inputPath];

    // Add frame rate parameter if specified
    if (frameRate !== undefined) {
      cmd.push('-r', String(frameRate));
    }

    // Add video filter and quality parameters
    cmd.push('-vf', 'format=yuvj420p');
    // Quality parameter: 1 highest quality, 31 lowest quality
    cmd.push('-q:v', String(quality));

    // Output path pattern using path.join for cross-platform compatibility
    const outputPattern = path.join(outputDir, 'frame_%04d.jpg');
    cmd.push(outputPattern);

    return cmd;
  }

  /**
   * Build AVI-MJPEG conversion command
   * 
   * Command format:
   * ffmpeg -i input.mp4 -an -r 25 -vcodec mjpeg -pix_fmt yuvj420p -q:v 5 output.avi
   * 
   * @param inputPath - Input video file path
   * @param outputPath - Output file path
   * @param frameRate - Target frame rate, undefined to keep original
   * @param quality - JPEG quality (1-31, 1 is highest), defaults to 5
   * @returns FFmpeg command arguments array
   */
  buildAviCmd(
    inputPath: string,
    outputPath: string,
    frameRate?: number,
    quality: number = 5
  ): string[] {
    const cmd: string[] = ['ffmpeg', '-i', inputPath];

    // No audio
    cmd.push('-an');

    // Add frame rate parameter if specified
    if (frameRate !== undefined) {
      cmd.push('-r', String(frameRate));
    }

    // Video codec and pixel format
    cmd.push('-vcodec', 'mjpeg');
    cmd.push('-pix_fmt', 'yuvj420p');

    // Quality parameter
    cmd.push('-q:v', String(quality));

    // Output path
    cmd.push(outputPath);

    return cmd;
  }

  /**
   * Build H264 conversion command
   * 
   * Command format:
   * ffmpeg -r 30 -i input.mp4 -c:v libx264 -x264-params "..." -an -f rawvideo output.h264
   * 
   * @param inputPath - Input video file path
   * @param outputPath - Output file path
   * @param frameRate - Input frame rate, undefined to keep original
   * @param crf - CRF value for quality control, defaults to 23
   * @returns FFmpeg command arguments array
   */
  buildH264Cmd(
    inputPath: string,
    outputPath: string,
    frameRate?: number,
    crf: number = 23
  ): string[] {
    const cmd: string[] = ['ffmpeg'];

    // Add frame rate parameter if specified - for H264, frame rate comes before input
    if (frameRate !== undefined) {
      cmd.push('-r', String(frameRate));
    }

    // Input file
    cmd.push('-i', inputPath);

    // H264 encoder
    cmd.push('-c:v', 'libx264');

    // x264 parameters (with CRF value substituted)
    const x264Params = FFmpegBuilder.H264_X264_PARAMS.replace('{crf}', String(crf));
    cmd.push('-x264-params', x264Params);

    // No audio
    cmd.push('-an');

    // Output format as raw video
    cmd.push('-f', 'rawvideo');

    // Output path
    cmd.push(outputPath);

    return cmd;
  }
}
