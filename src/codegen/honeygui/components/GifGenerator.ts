/**
 * hg_gif component code generator
 * GIF animation control, created via gui_gif_create_from_fs
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';

export class GifGenerator implements ComponentCodeGenerator {

  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width, height } = component.position;

    const src = component.data?.src || '';
    // GIF files are converted to .bin format
    let binPath = src.replace(/\.gif$/i, '.bin');
    // Strip assets/ prefix
    binPath = binPath.replace(/^assets\//, '');
    // Ensure path starts with /
    if (!binPath.startsWith('/')) {
      binPath = '/' + binPath;
    }

    return `${indentStr}${component.id} = gui_gif_create_from_fs(${parentRef}, "${component.name}", "${binPath}", ${x}, ${y}, ${width}, ${height});\n`;
  }

  generatePropertySetters(component: Component, indent: number, context: GeneratorContext): string {
    let code = '';
    const indentStr = '    '.repeat(indent);

    // 1. High quality rendering
    if (component.data?.highQuality === true) {
      code += `${indentStr}gui_gif_set_quality((gui_gif_t *)${component.id}, true);\n`;
    }

    // 2. Transform properties
    const transform = component.style?.transform;
    
    // Check for explicit transforms
    const hasRotation = transform?.rotation !== undefined && transform.rotation !== 0;
    const hasExplicitScale = (transform?.scaleX !== undefined && transform.scaleX !== 1.0) || 
                             (transform?.scaleY !== undefined && transform.scaleY !== 1.0);
    const hasExplicitFocus = transform?.focusX !== undefined || transform?.focusY !== undefined;
    
    // Check if auto-scaling is needed (display size differs from original)
    // GIF does not support auto-scaling as original size cannot be determined
    const needScale = hasExplicitScale;
    
    // Apply transform if rotation, scale, or explicit focus is set
    if (hasRotation || needScale || hasExplicitFocus) {
      // 1. Translation
      // Use explicit non-zero translateX/translateY if set
      // Otherwise, auto-compensate for focus point offset on rotation/focus
      const tx = transform?.translateX ?? 0;
      const ty = transform?.translateY ?? 0;
      const hasNonZeroTranslate = tx !== 0 || ty !== 0;
      
      if (hasNonZeroTranslate) {
        // Non-zero translation values set by user
        code += `${indentStr}gui_gif_translate((gui_gif_t *)${component.id}, ${tx.toFixed(1)}f, ${ty.toFixed(1)}f);\n`;
      } else if (hasRotation || hasExplicitFocus) {
        // Auto-translate to compensate for focus point on rotation/focus
        if (hasExplicitFocus) {
          // Focus set by user, translate to focus point
          const focusX = transform.focusX ?? 0;
          const focusY = transform.focusY ?? 0;
          if (needScale) {
            const scaleX = transform?.scaleX ?? 1.0;
            const scaleY = transform?.scaleY ?? 1.0;
            code += `${indentStr}gui_gif_translate((gui_gif_t *)${component.id}, ${focusX.toFixed(1)}f * ${scaleX.toFixed(6)}f, ${focusY.toFixed(1)}f * ${scaleY.toFixed(6)}f);\n`;
          } else {
            code += `${indentStr}gui_gif_translate((gui_gif_t *)${component.id}, ${focusX.toFixed(1)}f, ${focusY.toFixed(1)}f);\n`;
          }
        } else {
          // No focus set, translate to image center
          if (needScale) {
            const scaleX = transform?.scaleX ?? 1.0;
            const scaleY = transform?.scaleY ?? 1.0;
            code += `${indentStr}gui_gif_translate((gui_gif_t *)${component.id}, gui_gif_get_width((gui_gif_t *)${component.id}) / 2.0f * ${scaleX.toFixed(6)}f, gui_gif_get_height((gui_gif_t *)${component.id}) / 2.0f * ${scaleY.toFixed(6)}f);\n`;
          } else {
            code += `${indentStr}gui_gif_translate((gui_gif_t *)${component.id}, gui_gif_get_width((gui_gif_t *)${component.id}) / 2.0f, gui_gif_get_height((gui_gif_t *)${component.id}) / 2.0f);\n`;
          }
        }
      }

      // 2. Transform center point (focus)
      // Use explicit focusX/focusY if set
      // Otherwise, auto-set to image center on rotation
      
      if (hasExplicitFocus) {
        // Use user-set focus values (default to 0 for unset dimensions)
        const focusX = (transform.focusX ?? 0).toFixed(1);
        const focusY = (transform.focusY ?? 0).toFixed(1);
        code += `${indentStr}gui_gif_set_focus((gui_gif_t *)${component.id}, ${focusX}f, ${focusY}f);\n`;
      } else if (hasRotation) {
        // Rotation without explicit focus, auto-set to image center
        code += `${indentStr}gui_gif_set_focus((gui_gif_t *)${component.id}, gui_gif_get_width((gui_gif_t *)${component.id}) / 2.0f, gui_gif_get_height((gui_gif_t *)${component.id}) / 2.0f);\n`;
      }

      // 3. Rotation
      if (hasRotation) {
        code += `${indentStr}gui_gif_rotation((gui_gif_t *)${component.id}, ${transform!.rotation!.toFixed(1)}f);\n`;
      }

      // 4. Scale
      if (needScale) {
        const scaleX = transform?.scaleX ?? 1.0;
        const scaleY = transform?.scaleY ?? 1.0;
        if (scaleX !== 1.0 || scaleY !== 1.0) {
          code += `${indentStr}gui_gif_scale((gui_gif_t *)${component.id}, ${scaleX.toFixed(6)}f, ${scaleY.toFixed(6)}f);\n`;
        }
      }
    } else if (transform?.translateX !== undefined || transform?.translateY !== undefined) {
      // Translation only, no rotation or scale (generate only for non-zero values)
      const tx = transform.translateX ?? 0;
      const ty = transform.translateY ?? 0;
      if (tx !== 0 || ty !== 0) {
        code += `${indentStr}gui_gif_translate((gui_gif_t *)${component.id}, ${tx.toFixed(1)}f, ${ty.toFixed(1)}f);\n`;
      }
    }

    // 3. Opacity
    if (transform?.opacity !== undefined && transform.opacity !== 255) {
      code += `${indentStr}gui_gif_set_opacity((gui_gif_t *)${component.id}, ${Math.round(transform.opacity)});\n`;
    }

    // 4. Blend mode
    const blendMode = component.data?.blendMode;
    if (blendMode && blendMode !== 'IMG_FILTER_BLACK') {
      code += `${indentStr}gui_gif_set_mode((gui_gif_t *)${component.id}, ${blendMode});\n`;
    }

    // 5. Visibility
    if (component.visible === false) {
      code += `${indentStr}gui_obj_hidden((gui_obj_t *)${component.id}, true);\n`;
    }

    return code;
  }
}
