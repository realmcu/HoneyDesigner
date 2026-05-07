/**
 * hg_image component LVGL code generator
 */
import { Component } from '../../../hml/types';
import { LvglGeneratorContext } from '../LvglComponentGenerator';
import { escapeCString, normalizeLvglImageSource } from '../LvglUtils';
import { LvglBaseGenerator } from './LvglBaseGenerator';

export class LvglImageGenerator extends LvglBaseGenerator {
  generateCreation(component: Component, parentRef: string, ctx: LvglGeneratorContext): string {
    const isGif = this.isGifComponent(component);
    const hasBuiltinVar = ctx.getBuiltinImageVar(String(component.data?.src || ''));
    const useImageCreate = !isGif || hasBuiltinVar;

    let code = `    ${component.id} = ${useImageCreate ? 'lv_image_create' : 'lv_gif_create'}(${parentRef});\n`;
    code += this.generateSetters(component, isGif && !hasBuiltinVar, ctx);
    return code;
  }

  private generateSetters(component: Component, isGif: boolean, ctx: LvglGeneratorContext): string {
    const transform = component.style?.transform;
    const src = component.data?.src;

    const { x, y } = this.resolvePosition(component);
    const { width, height } = this.resolveSize(component);

    let code = `    lv_obj_set_pos(${component.id}, ${x}, ${y});\n`;
    code += `    lv_obj_set_size(${component.id}, ${width}, ${height});\n`;

    if (src) {
      // Use unified getImageRef to support both c-array and external-bin modes
      const imageRef = ctx.resources.getImageRef(String(src));
      if (imageRef) {
        // Both c-array and external-bin use the same syntax: &name
        code += `    lv_image_set_src(${component.id}, &${imageRef.name});\n`;
      } else if (!isGif) {
        // Fallback to file path for unconverted images (e.g., GIF)
        const lvglImageSrc = normalizeLvglImageSource(String(src));
        code += `    lv_image_set_src(${component.id}, "${escapeCString(lvglImageSrc)}");\n`;
      } else {
        const lvglImageSrc = normalizeLvglImageSource(String(src));
        code += `    lv_gif_set_src(${component.id}, "${escapeCString(lvglImageSrc)}");\n`;
      }
    }

    if (!isGif && (transform?.focusX !== undefined || transform?.focusY !== undefined)) {
      const focusX = Math.round(Number(transform.focusX ?? width / 2));
      const focusY = Math.round(Number(transform.focusY ?? height / 2));
      code += `    lv_image_set_pivot(${component.id}, ${focusX}, ${focusY});\n`;
    }

    if (!isGif && transform?.rotation !== undefined && Number(transform.rotation) !== 0) {
      const angle = Math.round(Number(transform.rotation) * 10);
      code += `    lv_image_set_rotation(${component.id}, ${angle});\n`;
    }

    const scaleX = transform?.scaleX !== undefined ? Number(transform.scaleX) : 1;
    const scaleY = transform?.scaleY !== undefined ? Number(transform.scaleY) : 1;
    if (!isGif && Number.isFinite(scaleX) && Number.isFinite(scaleY) && (scaleX !== 1 || scaleY !== 1)) {
      const zoomX = Math.max(1, Math.round(scaleX * 256));
      const zoomY = Math.max(1, Math.round(scaleY * 256));
      if (zoomX === zoomY) {
        code += `    lv_image_set_scale(${component.id}, ${zoomX});\n`;
      } else {
        code += `    lv_image_set_scale_x(${component.id}, ${zoomX});\n`;
        code += `    lv_image_set_scale_y(${component.id}, ${zoomY});\n`;
      }
    }

    if (transform?.opacity !== undefined) {
      const opacity = Math.max(0, Math.min(255, Math.round(Number(transform.opacity))));
      code += `    lv_obj_set_style_opa(${component.id}, ${opacity}, LV_PART_MAIN);\n`;
    }

    if (component.data?.blendMode) {
      code += `    /* TODO(lvgl): blendMode=${escapeCString(String(component.data.blendMode))} not yet mapped */\n`;
    }
    if (component.data?.highQuality !== undefined) {
      code += `    /* TODO(lvgl): highQuality not yet mapped */\n`;
    }
    if (component.data?.needClip !== undefined) {
      code += `    /* TODO(lvgl): needClip not yet mapped */\n`;
    }
    if (transform?.skewX !== undefined || transform?.skewY !== undefined) {
      code += `    /* TODO(lvgl): skewX/skewY not yet mapped */\n`;
    }
    if (component.data?.buttonMode) {
      code += `    /* TODO(lvgl): buttonMode=${escapeCString(String(component.data.buttonMode))} not yet mapped */\n`;
    }

    return code;
  }

  private isGifComponent(component: Component): boolean {
    const src = component.data?.src;
    if (!src) { return false; }
    return normalizeLvglImageSource(String(src)).toLowerCase().endsWith('.gif');
  }
}
