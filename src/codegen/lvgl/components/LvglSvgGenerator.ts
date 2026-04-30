/**
 * hg_svg component LVGL code generator
 *
 * LVGL 9.x with LV_USE_SVG enabled supports SVG rendering via ThorVG.
 * SVG files are loaded at runtime through lv_image_set_src() with a file path,
 * no conversion to C array is needed.
 */
import { Component } from '../../../hml/types';
import { LvglGeneratorContext } from '../LvglComponentGenerator';
import { escapeCString, normalizeLvglImageSource } from '../LvglUtils';
import { LvglBaseGenerator } from './LvglBaseGenerator';

export class LvglSvgGenerator extends LvglBaseGenerator {
  generateCreation(component: Component, parentRef: string, _ctx: LvglGeneratorContext): string {
    const { x, y } = this.resolvePosition(component);
    const { width, height } = this.resolveSize(component);

    const srcRaw = component.data?.src || '';
    const src = normalizeLvglImageSource(String(srcRaw));

    let code = `    ${component.id} = lv_image_create(${parentRef});\n`;
    code += `    lv_obj_set_pos(${component.id}, ${x}, ${y});\n`;
    code += `    lv_obj_set_size(${component.id}, ${width}, ${height});\n`;

    if (srcRaw) {
      code += `    lv_image_set_src(${component.id}, "${escapeCString(src)}");\n`;
    } else {
      code += `    /* TODO(lvgl): hg_svg src not set */\n`;
    }

    // Opacity
    const opacity = component.style?.transform?.opacity;
    if (opacity !== undefined) {
      const opa = Math.max(0, Math.min(255, Math.round(Number(opacity))));
      code += `    lv_obj_set_style_opa(${component.id}, ${opa}, LV_PART_MAIN);\n`;
    }

    return code;
  }
}
