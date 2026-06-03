/**
 * hg_time_label component LVGL code generator
 * Displays current system time, updated by lv_timer
 *
 * Supported timeFormat:
 *   HH:mm:ss, HH:mm, HH, mm, HH:mm-split, YYYY-MM-DD,
 *   YYYY-MM-DD HH:mm:ss, MM-DD HH:mm
 */
import { Component } from '../../../hml/types';
import { LvglGeneratorContext } from '../LvglComponentGenerator';
import { parseColorHex, getLvglFontBySize } from '../LvglUtils';
import { LvglBaseGenerator } from './LvglBaseGenerator';

export class LvglTimeLabelGenerator extends LvglBaseGenerator {
  generateCreation(component: Component, parentRef: string, ctx: LvglGeneratorContext): string {
    const { x, y } = this.resolvePosition(component);
    const { width, height } = this.resolveSize(component);

    const color = parseColorHex(component.style?.color || component.data?.color || '#ffffff');
    const fontSize = Number(component.style?.fontSize || component.data?.fontSize || 16);
    const fontFile = component.data?.fontFile;
    const timeFormat = String(component.data?.timeFormat || 'HH:mm:ss');
    const hAlign = String(component.data?.hAlign || 'LEFT');
    const vAlign = String(component.data?.vAlign || 'TOP');

    let code = `    ${component.id} = lv_label_create(${parentRef});\n`;
    code += `    lv_obj_set_pos(${component.id}, ${x}, ${y});\n`;
    code += `    lv_label_set_text(${component.id}, "${this.getPlaceholder(timeFormat)}");\n`;
    code += `    lv_obj_set_style_text_color(${component.id}, lv_color_hex(0x${color}), LV_PART_MAIN);\n`;

    // Font
    const bpp = Number((component.data as any)?.renderMode || 4);
    const pixelOrder = (component.data as any)?.pixelOrder === 'MSB' ? 'MSB' : 'LSB';
    const customFontVar = fontFile ? ctx.getBuiltinFontVar(String(fontFile), fontSize, bpp, pixelOrder) : null;
    if (customFontVar) {
      code += `    lv_obj_set_style_text_font(${component.id}, &${customFontVar}, LV_PART_MAIN);\n`;
    } else {
      code += `    lv_obj_set_style_text_font(${component.id}, &${getLvglFontBySize(fontSize)}, LV_PART_MAIN);\n`;
    }

    // Alignment
    if (hAlign === 'CENTER') {
      code += `    lv_obj_set_style_text_align(${component.id}, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);\n`;
    } else if (hAlign === 'RIGHT') {
      code += `    lv_obj_set_style_text_align(${component.id}, LV_TEXT_ALIGN_RIGHT, LV_PART_MAIN);\n`;
    }

    if (vAlign === 'MID') {
      code += `    lv_obj_set_size(${component.id}, ${width}, ${height});\n`;
      code += `    lv_obj_set_style_pad_top(${component.id}, (${height} - lv_font_get_line_height(lv_obj_get_style_text_font(${component.id}, LV_PART_MAIN))) / 2, LV_PART_MAIN);\n`;
    }

    // Spacing
    const letterSpacing = Number(component.data?.letterSpacing || 0);
    if (letterSpacing !== 0) {
      code += `    lv_obj_set_style_text_letter_space(${component.id}, ${letterSpacing}, LV_PART_MAIN);\n`;
    }
    const lineSpacing = Number(component.data?.lineSpacing || 0);
    if (lineSpacing !== 0) {
      code += `    lv_obj_set_style_text_line_space(${component.id}, ${lineSpacing}, LV_PART_MAIN);\n`;
    }

    // Create timer (1 second period for time display)
    code += `    lv_timer_create(${component.id}_timer_cb, 1000, ${component.id});\n`;

    return code;
  }

  /**
   * Generate time update callback functions
   */
  generateGlobalDefinitions(components: Component[]): string {
    const timeLabels = components.filter(c => c.type === 'hg_time_label');
    if (timeLabels.length === 0) { return ''; }

    let code = `// Time label callback functions\n`;
    code += `#include <time.h>\n\n`;

    for (const comp of timeLabels) {
      const timeFormat = String(comp.data?.timeFormat || 'HH:mm:ss');

      code += `static void ${comp.id}_timer_cb(lv_timer_t * timer)\n`;
      code += `{\n`;
      code += `    lv_obj_t * label = (lv_obj_t *)lv_timer_get_user_data(timer);\n`;
      code += `    time_t now = time(NULL);\n`;
      code += `    struct tm * t = localtime(&now);\n`;
      code += `    char buf[32];\n`;
      code += this.getFormatCode(timeFormat);
      code += `    lv_label_set_text(label, buf);\n`;
      code += `}\n\n`;
    }

    return code;
  }

  private getPlaceholder(format: string): string {
    switch (format) {
      case 'HH:mm:ss': return '00:00:00';
      case 'HH:mm': return '00:00';
      case 'HH': return '00';
      case 'mm': return '00';
      case 'HH:mm-split': return '00:00';
      case 'YYYY-MM-DD': return '2025-01-01';
      case 'YYYY-MM-DD HH:mm:ss': return '2025-01-01 00:00:00';
      case 'MM-DD HH:mm': return '01-01 00:00';
      default: return '00:00:00';
    }
  }

  private getFormatCode(format: string): string {
    switch (format) {
      case 'HH:mm:ss':
        return `    lv_snprintf(buf, sizeof(buf), "%02d:%02d:%02d", t->tm_hour, t->tm_min, t->tm_sec);\n`;
      case 'HH:mm':
        return `    lv_snprintf(buf, sizeof(buf), "%02d:%02d", t->tm_hour, t->tm_min);\n`;
      case 'HH':
        return `    lv_snprintf(buf, sizeof(buf), "%02d", t->tm_hour);\n`;
      case 'mm':
        return `    lv_snprintf(buf, sizeof(buf), "%02d", t->tm_min);\n`;
      case 'HH:mm-split':
        return `    lv_snprintf(buf, sizeof(buf), "%02d:%02d", t->tm_hour, t->tm_min);\n`;
      case 'YYYY-MM-DD':
        return `    lv_snprintf(buf, sizeof(buf), "%04d-%02d-%02d", (t->tm_year + 1900) % 10000, t->tm_mon + 1, t->tm_mday);\n`;
      case 'YYYY-MM-DD HH:mm:ss':
        return `    lv_snprintf(buf, sizeof(buf), "%04d-%02d-%02d %02d:%02d:%02d", (t->tm_year + 1900) % 10000, t->tm_mon + 1, t->tm_mday, t->tm_hour, t->tm_min, t->tm_sec);\n`;
      case 'MM-DD HH:mm':
        return `    lv_snprintf(buf, sizeof(buf), "%02d-%02d %02d:%02d", t->tm_mon + 1, t->tm_mday, t->tm_hour, t->tm_min);\n`;
      default:
        return `    lv_snprintf(buf, sizeof(buf), "%02d:%02d:%02d", t->tm_hour, t->tm_min, t->tm_sec);\n`;
    }
  }
}
