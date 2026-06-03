/**
 * hg_checkbox component LVGL code generator
 */
import { Component } from '../../../hml/types';
import { LvglGeneratorContext } from '../LvglComponentGenerator';
import { parseColorHex, escapeCString, getLvglFontBySize, getContrastTextColor } from '../LvglUtils';
import { LvglBaseGenerator } from './LvglBaseGenerator';

export class LvglCheckboxGenerator extends LvglBaseGenerator {
  generateCreation(component: Component, parentRef: string, ctx: LvglGeneratorContext): string {
    const { x, y } = this.resolvePosition(component);

    const text = component.data?.text || component.data?.label || '';
    const checked = component.data?.checked === true || component.data?.checked === 'true' 
      || component.data?.value === true || component.data?.value === 'true';
    const color = component.style?.color || component.data?.color;
    const fontSize = Number(component.style?.fontSize || component.data?.fontSize || 16);
    const fontFile = component.data?.fontFile;

    let code = `    ${component.id} = lv_checkbox_create(${parentRef});\n`;
    code += `    lv_obj_set_pos(${component.id}, ${x}, ${y});\n`;

    if (text) {
      code += `    lv_checkbox_set_text(${component.id}, "${escapeCString(String(text))}");\n`;
    } else {
      code += `    lv_checkbox_set_text(${component.id}, "");\n`;
    }

    if (checked) {
      code += `    lv_obj_add_state(${component.id}, LV_STATE_CHECKED);\n`;
    }

    if (color) {
      const colorHex = parseColorHex(String(color));
      code += `    lv_obj_set_style_text_color(${component.id}, lv_color_hex(0x${colorHex}), LV_PART_MAIN);\n`;
    } else {
      const parentBgColor = ctx.getAncestorBackgroundColor(component);
      if (parentBgColor) {
        const contrastColor = getContrastTextColor(parentBgColor);
        code += `    lv_obj_set_style_text_color(${component.id}, lv_color_hex(0x${contrastColor}), LV_PART_MAIN);\n`;
      }
    }

    const bpp = Number((component.data as any)?.renderMode || 4);
    const pixelOrder = (component.data as any)?.pixelOrder === 'MSB' ? 'MSB' : 'LSB';
    const customFontVar = fontFile ? ctx.getBuiltinFontVar(String(fontFile), fontSize, bpp, pixelOrder) : null;
    if (customFontVar) {
      code += `    lv_obj_set_style_text_font(${component.id}, &${customFontVar}, LV_PART_MAIN);\n`;
    } else if (fontSize !== 16) {
      const fontName = getLvglFontBySize(fontSize);
      code += `    lv_obj_set_style_text_font(${component.id}, &${fontName}, LV_PART_MAIN);\n`;
    }

    return code;
  }
}
