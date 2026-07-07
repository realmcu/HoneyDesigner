/**
 * hg_video component code generator
 */
import * as path from 'path';
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';
import { ConversionConfigService, VideoFormat } from '../../../services/ConversionConfigService';

export class VideoGenerator implements ComponentCodeGenerator {

  /**
   * Resolve video format configuration (with inheritance)
   * @param assetPath Asset path (may include assets/ prefix)
   * @param projectRoot Project root directory
   * @returns Resolved video format
   */
  private resolveVideoFormat(
    assetPath: string, 
    projectRoot: string
  ): 'mjpeg' | 'avi' | 'h264' | 'avi_msv1' | 'avi_cinepak' {
    const configService = ConversionConfigService.getInstance();
    const config = configService.loadConfig(projectRoot);
    
    // Normalize path: strip assets/ prefix, use / as separator
    let normalizedPath = assetPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (normalizedPath.startsWith('assets/')) {
      normalizedPath = normalizedPath.substring(7); // Strip 'assets/'
    }
    
    const itemSettings = config.items[normalizedPath];
    
    // Use explicit config if not set to inherit
    if (itemSettings?.videoFormat && itemSettings.videoFormat !== 'inherit') {
      const fmt = itemSettings.videoFormat.toLowerCase();
      if (fmt === 'msv1') { return 'avi_msv1'; }
      if (fmt === 'cinepak') { return 'avi_cinepak'; }
      return fmt as 'mjpeg' | 'avi' | 'h264';
    }
    
    // Inherit: look up parent directory config
    const pathParts = normalizedPath.split('/');
    for (let i = pathParts.length - 1; i >= 0; i--) {
      const parentPath = pathParts.slice(0, i).join('/');
      const parentSettings = config.items[parentPath];
      
      if (parentSettings?.videoFormat && parentSettings.videoFormat !== 'inherit') {
        const fmt = parentSettings.videoFormat.toLowerCase();
        if (fmt === 'msv1') { return 'avi_msv1'; }
        if (fmt === 'cinepak') { return 'avi_cinepak'; }
        return fmt as 'mjpeg' | 'avi' | 'h264';
      }
    }
    
    // Default to mjpeg
    return 'mjpeg';
  }

  /**
   * Get video output file extension
   */
  private getVideoOutputExtension(format: 'mjpeg' | 'avi' | 'h264' | 'avi_msv1' | 'avi_cinepak'): string {
    switch (format) {
      case 'mjpeg': return '.mjpeg';
      case 'avi':
      case 'avi_msv1':
      case 'avi_cinepak': return '.avi';
      case 'h264': return '.h264';
      default: return '.mjpeg';
    }
  }

  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width, height } = component.position;

    const src = component.data?.src || '';
    const frameRate = component.data?.frameRate || 30;
    const autoPlay = component.data?.autoPlay !== false && component.data?.autoPlay !== 'false';
    const loop = component.data?.loop === true;
    const useMsv1 = component.data?.useMsv1 === true || component.data?.useMsv1 === 'true';

    // Read video format from conversion.json (with inheritance)
    const format = context.projectRoot 
      ? this.resolveVideoFormat(src, context.projectRoot)
      : 'mjpeg';

    // useMsv1=true: use gui_lite_video widget (handles MSV1 and Cinepak automatically)
    // If conversion.json specifies avi_cinepak, keep it; otherwise default to avi_msv1
    let effectiveFormat = format;
    if (useMsv1) {
      if (format !== 'avi_cinepak') {
        effectiveFormat = 'avi_msv1';
      }
    }

    // Replace extension based on format
    const outputExt = this.getVideoOutputExtension(effectiveFormat);
    let videoSrc = src.replace(/\.[^.]+$/i, outputExt);

    // Strip assets/ prefix, ensure path starts with /
    videoSrc = videoSrc.replace(/^assets\//, '');
    if (!videoSrc.startsWith('/')) {
      videoSrc = '/' + videoSrc;
    }

    let code: string;
    if (useMsv1) {
      // Lite Video API (auto-detects MSV1 or Cinepak codec from AVI header)
      code = `${indentStr}${component.id} = gui_lite_video_create_from_fs(${parentRef}, "${component.name}", "${videoSrc}", ${x}, ${y}, ${width}, ${height});\n`;
      code += `${indentStr}gui_lite_video_set_frame_rate((gui_lite_video_t *)${component.id}, ${frameRate}.f);\n`;

      if (loop) {
        code += `${indentStr}gui_lite_video_set_repeat_count((gui_lite_video_t *)${component.id}, GUI_VIDEO_REPEAT_INFINITE);\n`;
      }

      if (autoPlay) {
        code += `${indentStr}gui_lite_video_set_state((gui_lite_video_t *)${component.id}, GUI_VIDEO_STATE_PLAYING);\n`;
      } else {
        code += `${indentStr}gui_lite_video_set_state((gui_lite_video_t *)${component.id}, GUI_VIDEO_STATE_INIT);\n`;
      }
    } else {
      // Standard video API
      code = `${indentStr}${component.id} = gui_video_create_from_fs(${parentRef}, "${component.name}", "${videoSrc}", ${x}, ${y}, ${width}, ${height});\n`;
      code += `${indentStr}gui_video_set_frame_rate((gui_video_t *)${component.id}, ${frameRate}.f);\n`;

      if (loop) {
        code += `${indentStr}gui_video_set_repeat_count((gui_video_t *)${component.id}, GUI_VIDEO_REPEAT_INFINITE);\n`;
      }

      if (autoPlay) {
        code += `${indentStr}gui_video_set_state((gui_video_t *)${component.id}, GUI_VIDEO_STATE_PLAYING);\n`;
      } else {
        code += `${indentStr}gui_video_set_state((gui_video_t *)${component.id}, GUI_VIDEO_STATE_INIT);\n`;
      }
    }

    return code;
  }

  generatePropertySetters(component: Component, indent: number, context: GeneratorContext): string {
    let code = '';
    const indentStr = '    '.repeat(indent);

    if (component.visible === false) {
      code += `${indentStr}gui_obj_hidden((gui_obj_t *)${component.id}, true);\n`;
    }

    return code;
  }
}
