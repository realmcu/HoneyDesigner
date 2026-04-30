/**
 * hg_gif component LVGL code generator
 * Generates lv_gif_create / lv_gif_set_src calls for GIF animation components.
 * GIF files are loaded at runtime (not converted to C arrays).
 */
import { Component } from '../../../hml/types';
import { LvglGeneratorContext } from '../LvglComponentGenerator';
import { escapeCString, normalizeLvglImageSource } from '../LvglUtils';
import { LvglBaseGenerator } from './LvglBaseGenerator';

export class LvglGifGenerator extends LvglBaseGenerator {
  generateCreation(component: Component, parentRef: string, ctx: LvglGeneratorContext): string {
    const { x, y } = this.resolvePosition(component);
    const { width, height } = this.resolveSize(component);

    let code = `    ${component.id} = lv_gif_create(${parentRef});\n`;
    code += `    lv_obj_set_pos(${component.id}, ${x}, ${y});\n`;
    code += `    lv_obj_set_size(${component.id}, ${width}, ${height});\n`;

    const src = component.data?.src;
    if (src) {
      const lvglSrc = normalizeLvglImageSource(String(src));
      code += `    lv_gif_set_src(${component.id}, "${escapeCString(lvglSrc)}");\n`;
    }

    if (component.style?.transform?.opacity !== undefined) {
      const opacity = Math.max(0, Math.min(255, Math.round(Number(component.style.transform.opacity))));
      code += `    lv_obj_set_style_opa(${component.id}, ${opacity}, LV_PART_MAIN);\n`;
    }

    return code;
  }
}
