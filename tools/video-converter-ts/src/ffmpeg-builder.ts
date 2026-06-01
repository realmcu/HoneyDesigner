/**
 * FFmpegBuilder - FFmpeg command construction
 * 
 * Builds FFmpeg commands for different output formats:
 * - MJPEG frames extraction
 * - AVI-MJPEG conversion
 * - H264 conversion
 */

import * as path from 'path';
import { ScaleOptions, CropOptions } from './models';

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
   * Build video crop command
   *
   * Crops the input video to the specified region using the FFmpeg `crop` filter.
   * When x and y are omitted the crop region is centered in the source frame.
   *
   * Command format (centered):
   *   ffmpeg -i input.mp4 -vf "crop=640:360" -c:v libx264 -crf 18 -preset fast output.mp4
   *
   * Command format (explicit position):
   *   ffmpeg -i input.mp4 -vf "crop=640:360:100:50" -c:v libx264 -crf 18 -preset fast output.mp4
   *
   * @param inputPath - Input video file path
   * @param outputPath - Output file path (use `.mp4` extension for best compatibility)
   * @param options - Crop options (width, height, and optional x/y offset)
   * @returns FFmpeg command arguments array
   */
  buildCropCmd(
    inputPath: string,
    outputPath: string,
    options: CropOptions
  ): string[] {
    const { width, height, x, y } = options;

    // Build crop expression: omit x/y to let FFmpeg auto-center the region
    let cropExpr: string;
    if (x !== undefined && y !== undefined) {
      cropExpr = `${width}:${height}:${x}:${y}`;
    } else if (x !== undefined) {
      cropExpr = `${width}:${height}:${x}:(in_h-${height})/2`;
    } else if (y !== undefined) {
      cropExpr = `${width}:${height}:(in_w-${width})/2:${y}`;
    } else {
      cropExpr = `${width}:${height}`;
    }

    return [
      'ffmpeg', '-i', inputPath,
      '-vf', `crop=${cropExpr}`,
      '-c:v', 'libx264',
      '-crf', '18',
      '-preset', 'fast',
      outputPath,
    ];
  }

  /**
   * 
   * Command format (no background):
   * ffmpeg -i input.mp4 -r 24 -vf "format=yuvj420p" -q:v 5 output/frame_%04d.jpg
   *
   * Command format (with background color for transparent GIF):
   * ffmpeg -i input.gif -f lavfi -i "color=c=#FFFFFF"
   *   -filter_complex "[1:v][0:v]scale2ref[bg][fg];[bg][fg]overlay=shortest=1:format=auto,format=yuvj420p[out]"
   *   -map "[out]" -r 24 -q:v 5 output/frame_%04d.jpg
   * 
   * @param inputPath - Input video file path
   * @param outputDir - Output directory path
   * @param frameRate - Target frame rate, undefined to keep original
   * @param quality - JPEG quality (1-31, 1 is highest), defaults to 5
   * @param backgroundColor - Optional background color for transparent GIF (FFmpeg color value)
   * @returns FFmpeg command arguments array
   */
  buildMjpegFramesCmd(
    inputPath: string,
    outputDir: string,
    frameRate?: number,
    quality: number = 5,
    backgroundColor?: string
  ): string[] {
    const outputPattern = path.join(outputDir, 'frame_%04d.jpg');

    if (backgroundColor) {
      const cmd: string[] = ['ffmpeg', '-i', inputPath];
      cmd.push('-f', 'lavfi', '-i', `color=c=${backgroundColor}`);
      cmd.push(
        '-filter_complex',
        '[1:v][0:v]scale2ref[bg][fg];[bg][fg]overlay=shortest=1:format=auto,format=yuvj420p[out]'
      );
      cmd.push('-map', '[out]');
      if (frameRate !== undefined) cmd.push('-r', String(frameRate));
      cmd.push('-q:v', String(quality));
      cmd.push(outputPattern);
      return cmd;
    }

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
    cmd.push(outputPattern);

    return cmd;
  }

  /**
   * Build AVI-MJPEG conversion command
   * 
   * Command format (no background):
   * ffmpeg -i input.mp4 -an -r 25 -vcodec mjpeg -pix_fmt yuvj420p -q:v 5 output.avi
   *
   * Command format (with background color for transparent GIF):
   * ffmpeg -i input.gif -f lavfi -i "color=c=#FFFFFF"
   *   -filter_complex "[1:v][0:v]scale2ref[bg][fg];[bg][fg]overlay=shortest=1:format=auto[out]"
   *   -map "[out]" -an -r 25 -vcodec mjpeg -pix_fmt yuvj420p -q:v 5 output.avi
   * 
   * @param inputPath - Input video file path
   * @param outputPath - Output file path
   * @param frameRate - Target frame rate, undefined to keep original
   * @param quality - JPEG quality (1-31, 1 is highest), defaults to 5
   * @param backgroundColor - Optional background color for transparent GIF (FFmpeg color value)
   * @returns FFmpeg command arguments array
   */
  buildAviCmd(
    inputPath: string,
    outputPath: string,
    frameRate?: number,
    quality: number = 5,
    backgroundColor?: string
  ): string[] {
    if (backgroundColor) {
      const cmd: string[] = ['ffmpeg', '-i', inputPath];
      cmd.push('-f', 'lavfi', '-i', `color=c=${backgroundColor}`);
      cmd.push(
        '-filter_complex',
        '[1:v][0:v]scale2ref[bg][fg];[bg][fg]overlay=shortest=1:format=auto[out]'
      );
      cmd.push('-map', '[out]');
      cmd.push('-an');
      if (frameRate !== undefined) cmd.push('-r', String(frameRate));
      cmd.push('-vcodec', 'mjpeg');
      cmd.push('-pix_fmt', 'yuvj420p');
      cmd.push('-q:v', String(quality));
      cmd.push(outputPath);
      return cmd;
    }

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
   * Command format (no background):
   * ffmpeg -r 30 -i input.mp4 -c:v libx264 -x264-params "..." -an -f rawvideo output.h264
   *
   * Command format (with background color for transparent GIF):
   * ffmpeg -r 30 -i input.gif -f lavfi -i "color=c=#FFFFFF"
   *   -filter_complex "[1:v][0:v]scale2ref[bg][fg];[bg][fg]overlay=shortest=1:format=auto[out]"
   *   -map "[out]" -c:v libx264 -x264-params "..." -an -f rawvideo output.h264
   * 
   * @param inputPath - Input video file path
   * @param outputPath - Output file path
   * @param frameRate - Input frame rate, undefined to keep original
   * @param crf - CRF value for quality control, defaults to 23
   * @param backgroundColor - Optional background color for transparent GIF (FFmpeg color value)
   * @returns FFmpeg command arguments array
   */
  buildH264Cmd(
    inputPath: string,
    outputPath: string,
    frameRate?: number,
    crf: number = 23,
    backgroundColor?: string
  ): string[] {
    const cmd: string[] = ['ffmpeg'];

    // Add frame rate parameter if specified - for H264, frame rate comes before input
    if (frameRate !== undefined) {
      cmd.push('-r', String(frameRate));
    }

    // Input file
    cmd.push('-i', inputPath);

    if (backgroundColor) {
      cmd.push('-f', 'lavfi', '-i', `color=c=${backgroundColor}`);
      cmd.push(
        '-filter_complex',
        '[1:v][0:v]scale2ref[bg][fg];[bg][fg]overlay=shortest=1:format=auto[out]'
      );
      cmd.push('-map', '[out]');
    }

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

  /**
   * Build AVI-Cinepak conversion command (Cinepak codec)
   *
   * Cinepak only supports `rgb24` and `gray` pixel formats, and requires
   * width and height to be multiples of 4.
   * No audio (-an). No post-processing required.
   *
   * Command format (no background):
   * ffmpeg -i input.mp4 -an [-r fps] -vf "scale=trunc(iw/4)*4:trunc(ih/4)*4"
   *   -vcodec cinepak -pix_fmt rgb24 -q:v 1 output.avi
   *
   * Command format (with background color for transparent GIF):
   * ffmpeg -i input.gif -f lavfi -i "color=c=white"
   *   -filter_complex "[1:v][0:v]scale2ref[bg][fg];[bg][fg]overlay=shortest=1:format=auto,scale=trunc(iw/4)*4:trunc(ih/4)*4,setsar=1[out]"
   *   -map "[out]" -an [-r fps] -vcodec cinepak -pix_fmt rgb24 -q:v 1 output.avi
   *
   * @param inputPath - Input video file path
   * @param outputPath - Output AVI file path
   * @param frameRate - Target frame rate, undefined to keep original
   * @param quality - Quality (1-31, 1 is highest), defaults to 1
   * @param backgroundColor - Optional background color for transparent GIF (FFmpeg color value)
   * @returns FFmpeg command arguments array
   */
  buildAviCinepakCmd(
    inputPath: string,
    outputPath: string,
    frameRate?: number,
    quality: number = 1,
    backgroundColor?: string
  ): string[] {
    /** Cinepak requires width and height to be multiples of 4 */
    const cinepakScaleAlign = 'scale=trunc(iw/4)*4:trunc(ih/4)*4';

    if (backgroundColor) {
      const cmd: string[] = ['ffmpeg', '-i', inputPath];
      cmd.push('-f', 'lavfi', '-i', `color=c=${backgroundColor}`);
      cmd.push(
        '-filter_complex',
        `[1:v][0:v]scale2ref[bg][fg];[bg][fg]overlay=shortest=1:format=auto,${cinepakScaleAlign},setsar=1[out]`
      );
      cmd.push('-map', '[out]');
      cmd.push('-an');
      if (frameRate !== undefined) cmd.push('-r', String(frameRate));
      cmd.push('-vcodec', 'cinepak');
      cmd.push('-pix_fmt', 'rgb24');
      cmd.push('-q:v', String(quality));
      cmd.push(outputPath);
      return cmd;
    }

    const cmd: string[] = ['ffmpeg', '-i', inputPath];
    cmd.push('-an');
    if (frameRate !== undefined) cmd.push('-r', String(frameRate));
    cmd.push('-vf', cinepakScaleAlign);
    cmd.push('-vcodec', 'cinepak');
    cmd.push('-pix_fmt', 'rgb24');
    cmd.push('-q:v', String(quality));
    cmd.push(outputPath);
    return cmd;
  }

  /**
   * Build AVI-MSV1 conversion command (Microsoft Video 1 / CRAM codec)
   *
   * The msvideo1 encoder only supports rgb555le pixel format.
   * No audio (-an). No post-processing required (unlike AVI-MJPEG which needs
   * JPEG-specific 8-byte alignment via AviAligner).
   *
   * Command format (no background):
   * ffmpeg -i input.mp4 -an [-r fps] -vcodec msvideo1 -pix_fmt rgb555le -q:v 1 output.avi
   *
   * Command format (with background color for transparent GIF):
   * ffmpeg -i input.gif -f lavfi -i "color=c=white"
   *   -filter_complex "[1:v][0:v]scale2ref[bg][fg];[bg][fg]overlay=shortest=1:format=auto[out]"
   *   -map "[out]" -an [-r fps] -vcodec msvideo1 -pix_fmt rgb555le -q:v 1 output.avi
   *
   * @param inputPath - Input video file path
   * @param outputPath - Output AVI file path
   * @param frameRate - Target frame rate, undefined to keep original
   * @param quality - Quality (1-31, 1 is highest), defaults to 1
   * @param backgroundColor - Optional background color for transparent GIF (FFmpeg color value)
   * @returns FFmpeg command arguments array
   */
  buildAviMsv1Cmd(
    inputPath: string,
    outputPath: string,
    frameRate?: number,
    quality: number = 1,
    backgroundColor?: string
  ): string[] {
    /** MSV1 requires width and height to be multiples of 4 */
    const msv1ScaleAlign = 'scale=trunc(iw/4)*4:trunc(ih/4)*4';

    if (backgroundColor) {
      const cmd: string[] = ['ffmpeg', '-i', inputPath];
      cmd.push('-f', 'lavfi', '-i', `color=c=${backgroundColor}`);
      cmd.push(
        '-filter_complex',
        `[1:v][0:v]scale2ref[bg][fg];[bg][fg]overlay=shortest=1:format=auto,${msv1ScaleAlign}[out]`
      );
      cmd.push('-map', '[out]');
      cmd.push('-an');
      if (frameRate !== undefined) cmd.push('-r', String(frameRate));
      cmd.push('-vcodec', 'msvideo1');
      cmd.push('-pix_fmt', 'rgb555le');
      cmd.push('-q:v', String(quality));
      cmd.push(outputPath);
      return cmd;
    }

    const cmd: string[] = ['ffmpeg', '-i', inputPath];
    cmd.push('-an');
    if (frameRate !== undefined) cmd.push('-r', String(frameRate));
    cmd.push('-vf', msv1ScaleAlign);
    cmd.push('-vcodec', 'msvideo1');
    cmd.push('-pix_fmt', 'rgb555le');
    cmd.push('-q:v', String(quality));
    cmd.push(outputPath);
    return cmd;
  }
}
