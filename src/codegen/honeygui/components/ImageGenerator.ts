/**
 * hg_image component code generator
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';
import * as path from 'path';
import * as fs from 'fs';

export class ImageGenerator implements ComponentCodeGenerator {

  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width, height } = component.position;

    const src = component.data?.src || '';
    // Replace image extension with .bin
    let binSrc = src.replace(/\.(png|jpe?g|bmp|tiff?|webp)$/i, '.bin');
    // Strip assets/ prefix
    binSrc = binSrc.replace(/^assets\//, '');
    // Ensure path starts with /
    if (!binSrc.startsWith('/')) {
      binSrc = '/' + binSrc;
    }

    return `${indentStr}${component.id} = gui_img_create_from_fs(${parentRef}, "${component.name}", "${binSrc}", ${x}, ${y}, ${width}, ${height});\n`;
  }

  generatePropertySetters(component: Component, indent: number, context: GeneratorContext): string {
    let code = '';
    const indentStr = '    '.repeat(indent);

    // 1. Blend mode setting
    const blendMode = component.data?.blendMode;
    if (blendMode && blendMode !== 'IMG_FILTER_BLACK') {
      code += `${indentStr}gui_img_set_mode((gui_img_t *)${component.id}, ${blendMode});\n`;
    }

    // 2. A8 image color setting
    if (blendMode === 'IMG_2D_SW_FIX_A8_FG' || blendMode === 'IMG_2D_SW_FIX_A8_BGFG') {
      const fgColor = component.data?.fgColor || '0xFFFFFFFF';
      code += `${indentStr}gui_img_a8_recolor((gui_img_t *)${component.id}, ${fgColor});\n`;
      
      if (blendMode === 'IMG_2D_SW_FIX_A8_BGFG') {
        const bgColor = component.data?.bgColor || '0xFFFFFFFF';
        code += `${indentStr}gui_img_a8_fix_bg((gui_img_t *)${component.id}, ${bgColor});\n`;
      }
    }

    // 3. High quality rendering
    if (component.data?.highQuality === true) {
      code += `${indentStr}gui_img_set_quality((gui_img_t *)${component.id}, true);\n`;
    }

    // 4. Clip setting
    if (component.data?.needClip === true) {
      code += `${indentStr}((gui_img_t *)${component.id})->need_clip = true;\n`;
    }

    // Get transform configuration
    const transform = component.style?.transform;
    
    // Check for explicit transforms
    const hasRotation = transform?.rotation !== undefined && transform.rotation !== 0;
    const hasExplicitScale = (transform?.scaleX !== undefined && transform.scaleX !== 1.0) || 
                             (transform?.scaleY !== undefined && transform.scaleY !== 1.0);
    const hasExplicitFocus = transform?.focusX !== undefined || transform?.focusY !== undefined;
    
    // Check if auto-scaling is needed (display size differs from original image size)
    let autoScaleX: number | undefined;
    let autoScaleY: number | undefined;
    const { width, height } = component.position;
    const imageSize = this.getImageSize(component, context);
    if (imageSize && (width !== imageSize.width || height !== imageSize.height)) {
      autoScaleX = width / imageSize.width;
      autoScaleY = height / imageSize.height;
    }
    
    const needScale = hasExplicitScale || (autoScaleX !== undefined && autoScaleY !== undefined);
    
    // Apply transform if rotation, scale, or explicit focus is set
    if (hasRotation || needScale || hasExplicitFocus) {
      // 1. Translation
      // Translate = focus point + explicit offset (when both are set)
      const tx = transform?.translateX ?? 0;
      const ty = transform?.translateY ?? 0;

      if (hasExplicitFocus) {
        const focusX = transform.focusX ?? 0;
        const focusY = transform.focusY ?? 0;
        const totalX = focusX + tx;
        const totalY = focusY + ty;
        code += `${indentStr}gui_img_translate((gui_img_t *)${component.id}, ${totalX.toFixed(1)}f, ${totalY.toFixed(1)}f);\n`;
      } else if (hasRotation) {
        // No explicit focus, translate to image center + explicit offset
        if (tx !== 0 || ty !== 0) {
          code += `${indentStr}gui_img_translate((gui_img_t *)${component.id}, gui_img_get_width((gui_img_t *)${component.id}) / 2.0f + ${tx.toFixed(1)}f, gui_img_get_height((gui_img_t *)${component.id}) / 2.0f + ${ty.toFixed(1)}f);\n`;
        } else {
          code += `${indentStr}gui_img_translate((gui_img_t *)${component.id}, gui_img_get_width((gui_img_t *)${component.id}) / 2.0f, gui_img_get_height((gui_img_t *)${component.id}) / 2.0f);\n`;
        }
      } else if (tx !== 0 || ty !== 0) {
        // Translation only, no focus or rotation
        code += `${indentStr}gui_img_translate((gui_img_t *)${component.id}, ${tx.toFixed(1)}f, ${ty.toFixed(1)}f);\n`;
      }

      // 2. Transform center point (focus)
      // Use explicit focusX/focusY if set
      // Otherwise, auto-set to image center on rotation
      
      if (hasExplicitFocus) {
        // Use user-set focus values (default to 0 for unset dimensions)
        const focusX = (transform.focusX ?? 0).toFixed(1);
        const focusY = (transform.focusY ?? 0).toFixed(1);
        code += `${indentStr}gui_img_set_focus((gui_img_t *)${component.id}, ${focusX}f, ${focusY}f);\n`;
      } else if (hasRotation) {
        // Rotation without explicit focus, auto-set to image center
        code += `${indentStr}gui_img_set_focus((gui_img_t *)${component.id}, gui_img_get_width((gui_img_t *)${component.id}) / 2.0f, gui_img_get_height((gui_img_t *)${component.id}) / 2.0f);\n`;
      }

      // 3. Rotation
      if (hasRotation) {
        code += `${indentStr}gui_img_rotation((gui_img_t *)${component.id}, ${transform!.rotation!.toFixed(1)}f);\n`;
      }

      // 4. Scale
      if (needScale) {
        const scaleX = transform?.scaleX ?? autoScaleX ?? 1.0;
        const scaleY = transform?.scaleY ?? autoScaleY ?? 1.0;
        if (scaleX !== 1.0 || scaleY !== 1.0) {
          code += `${indentStr}gui_img_scale((gui_img_t *)${component.id}, ${scaleX.toFixed(6)}f, ${scaleY.toFixed(6)}f);\n`;
        }
      }
    } else if (transform?.translateX !== undefined || transform?.translateY !== undefined) {
      // Translation only, no rotation or scale (generate only for non-zero values)
      const tx = transform.translateX ?? 0;
      const ty = transform.translateY ?? 0;
      if (tx !== 0 || ty !== 0) {
        code += `${indentStr}gui_img_translate((gui_img_t *)${component.id}, ${tx.toFixed(1)}f, ${ty.toFixed(1)}f);\n`;
      }
    }

    // 5. Opacity
    if (transform?.opacity !== undefined && transform.opacity !== 255) {
      code += `${indentStr}gui_img_set_opacity((gui_img_t *)${component.id}, ${Math.round(transform.opacity)});\n`;
    }

    // Visibility
    if (component.visible === false) {
      code += `${indentStr}gui_obj_hidden((gui_obj_t *)${component.id}, true);\n`;
    }

    return code;
  }

  /**
   * Generate button effect event bindings
   */
  generateEventBinding(component: Component, indent: number): string {
    const buttonMode = component.data?.buttonMode;
    if (!buttonMode || buttonMode === 'none') {
      return '';
    }

    const indentStr = '    '.repeat(indent);
    
    if (buttonMode === 'dual-state') {
      return `${indentStr}gui_obj_add_event_cb((gui_obj_t *)${component.id}, ${component.id}_button_cb, GUI_EVENT_TOUCH_CLICKED, NULL);\n`;
    } else if (buttonMode === 'blink') {
      let code = '';
      code += `${indentStr}gui_obj_add_event_cb((gui_obj_t *)${component.id}, ${component.id}_button_press_cb, GUI_EVENT_TOUCH_PRESSED, NULL);\n`;
      code += `${indentStr}gui_obj_add_event_cb((gui_obj_t *)${component.id}, ${component.id}_button_release_cb, GUI_EVENT_TOUCH_RELEASED, NULL);\n`;
      return code;
    }

    return '';
  }

  /**
   * Generate button effect callback functions
   */
  generateButtonCallback(component: Component): string {
    const buttonMode = component.data?.buttonMode;
    if (!buttonMode || buttonMode === 'none') {
      return '';
    }

    if (buttonMode === 'dual-state') {
      return this.generateDualStateCallback(component);
    } else if (buttonMode === 'blink') {
      return this.generateBlinkCallback(component);
    }

    return '';
  }

  private generateDualStateCallback(component: Component): string {
    const onImage = component.data?.buttonStateOnImage || '';
    const offImage = component.data?.buttonStateOffImage || '';
    const initialState = component.data?.buttonInitialState === 'on';

    const binOn = this.convertToBinPath(onImage);
    const binOff = this.convertToBinPath(offImage);

    return `
// ${component.id} dual-state button callback
static bool ${component.id}_state = ${initialState ? 'true' : 'false'};

void ${component.id}_button_cb(void *obj, gui_event_t *e)
{
    GUI_UNUSED(obj);
    GUI_UNUSED(e);
    
    ${component.id}_state = !${component.id}_state;
    
    if (${component.id}_state) {
        gui_img_set_src((gui_img_t *)${component.id}, (const uint8_t *)"${binOn}", IMG_SRC_FILESYS);
    } else {
        gui_img_set_src((gui_img_t *)${component.id}, (const uint8_t *)"${binOff}", IMG_SRC_FILESYS);
    }
}

bool ${component.id}_get_state(void) { return ${component.id}_state; }
void ${component.id}_set_state(bool state) {
    if (${component.id}_state != state) {
        ${component.id}_state = state;
        gui_img_set_src((gui_img_t *)${component.id}, (const uint8_t *)(state ? "${binOn}" : "${binOff}"), IMG_SRC_FILESYS);
    }
}
`;
  }

  private generateBlinkCallback(component: Component): string {
    const minOpacity = component.data?.buttonBlinkOpacityMin || 50;
    const maxOpacity = component.data?.buttonBlinkOpacityMax || 255;

    return `
// ${component.id} blink button callback

void ${component.id}_button_press_cb(void *obj, gui_event_t *e)
{
    GUI_UNUSED(obj);
    GUI_UNUSED(e);
    
    gui_img_set_opacity((gui_img_t *)${component.id}, ${minOpacity});
}

void ${component.id}_button_release_cb(void *obj, gui_event_t *e)
{
    GUI_UNUSED(obj);
    GUI_UNUSED(e);
    
    gui_img_set_opacity((gui_img_t *)${component.id}, ${maxOpacity});
}
`;
  }

  /**
   * Convert image path to .bin format
   */
  private convertToBinPath(src: string): string {
    if (!src) return '';
    
    // Replace image extension with .bin
    let binSrc = src.replace(/\.(png|jpe?g|bmp|tiff?|webp)$/i, '.bin');
    // Strip assets/ prefix
    binSrc = binSrc.replace(/^assets\//, '');
    // Ensure path starts with /
    if (!binSrc.startsWith('/')) {
      binSrc = '/' + binSrc;
    }
    
    return binSrc;
  }

  /**
   * Get original image dimensions
   */
  private getImageSize(component: Component, context: GeneratorContext): { width: number; height: number } | null {
    const src = component.data?.src;
    if (!src) {
      return null;
    }

    // Get project root from context
    let projectRoot = context.projectRoot;
    if (!projectRoot) {
      return null;
    }

    // If projectRoot is .preview directory, go up one level to find actual project root
    if (projectRoot.endsWith('.preview')) {
      projectRoot = path.dirname(projectRoot);
    }

    // Build full image path
    const imagePath = path.join(projectRoot, src);
    
    // Check if file exists
    if (!fs.existsSync(imagePath)) {
      return null;
    }

    try {
      // Read image file header to get dimensions
      const buffer = fs.readFileSync(imagePath);
      return this.parseImageSize(buffer, src);
    } catch (err) {
      console.error(`Failed to read image size for ${src}:`, err);
      return null;
    }
  }

  /**
   * Parse image dimensions (supports PNG, JPEG, BMP)
   */
  private parseImageSize(buffer: Buffer, filename: string): { width: number; height: number } | null {
    const ext = path.extname(filename).toLowerCase();

    if (ext === '.png') {
      // PNG: read IHDR chunk
      if (buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);
        return { width, height };
      }
    } else if (ext === '.jpg' || ext === '.jpeg') {
      // JPEG: find SOF0 marker
      let offset = 2;
      while (offset < buffer.length - 9) {
        if (buffer[offset] === 0xFF) {
          const marker = buffer[offset + 1];
          if (marker >= 0xC0 && marker <= 0xC3) {
            const height = buffer.readUInt16BE(offset + 5);
            const width = buffer.readUInt16BE(offset + 7);
            return { width, height };
          }
          offset += 2 + buffer.readUInt16BE(offset + 2);
        } else {
          offset++;
        }
      }
    } else if (ext === '.bmp') {
      // BMP: read DIB header
      if (buffer.length >= 26 && buffer.toString('ascii', 0, 2) === 'BM') {
        const width = buffer.readInt32LE(18);
        const height = Math.abs(buffer.readInt32LE(22));
        return { width, height };
      }
    }

    return null;
  }
}
