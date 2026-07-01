/**
 * hg_label component LVGL code generator
 * Supports: text, color, font, alignment, spacing, scroll mode, timer mode
 */
import { Component } from '../../../hml/types';
import { LvglGeneratorContext } from '../LvglComponentGenerator';
import { parseColorHex, escapeCString, getLvglFontBySize } from '../LvglUtils';
import { LvglBaseGenerator } from './LvglBaseGenerator';

export class LvglLabelGenerator extends LvglBaseGenerator {
  generateCreation(component: Component, parentRef: string, ctx: LvglGeneratorContext): string {
    const { x, y } = this.resolvePosition(component);
    const { width, height } = this.resolveSize(component);

    const text = this.resolveCodegenText(component, ctx);
    const color = parseColorHex(component.style?.color || component.data?.color || '#000000');
    const fontSize = Number(component.style?.fontSize || component.data?.fontSize || 16);
    const fontFile = component.data?.fontFile;
    const isTimerLabel = component.data?.isTimerLabel === true;
    const wordWrap = component.style?.wordWrap === true
      || component.data?.wordWrap === true;
    const hAlign = String(component.style?.hAlign || component.data?.hAlign || 'LEFT');
    const vAlign = String(component.style?.vAlign || component.data?.vAlign || 'TOP');

    let code = `    ${component.id} = lv_label_create(${parentRef});\n`;
    code += `    lv_obj_set_pos(${component.id}, ${x}, ${y});\n`;

    // --- Text ---
    if (isTimerLabel) {
      const format = String(component.data?.timerFormat || 'HH:MM:SS');
      code += `    lv_label_set_text(${component.id}, "${this.getTimerPlaceholder(format)}");\n`;
    } else {
      code += `    lv_label_set_text(${component.id}, "${escapeCString(String(text))}");\n`;
    }

    // --- Color ---
    code += `    lv_obj_set_style_text_color(${component.id}, lv_color_hex(0x${color}), LV_PART_MAIN);\n`;

    // --- Font ---
    const bpp = Number((component.data as any)?.renderMode || 4);
    const pixelOrder = (component.data as any)?.pixelOrder === 'MSB' ? 'MSB' : 'LSB';
    const customFontVar = fontFile ? ctx.getBuiltinFontVar(String(fontFile), fontSize, bpp, pixelOrder) : null;
    if (customFontVar) {
      code += `    lv_obj_set_style_text_font(${component.id}, &${customFontVar}, LV_PART_MAIN);\n`;
    } else {
      const fontName = getLvglFontBySize(fontSize);
      code += `    lv_obj_set_style_text_font(${component.id}, &${fontName}, LV_PART_MAIN);\n`;
    }

    // --- Horizontal alignment ---
    if (hAlign === 'CENTER') {
      code += `    lv_obj_set_style_text_align(${component.id}, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);\n`;
    } else if (hAlign === 'RIGHT') {
      code += `    lv_obj_set_style_text_align(${component.id}, LV_TEXT_ALIGN_RIGHT, LV_PART_MAIN);\n`;
    }

    // --- Vertical alignment ---
    // MID: set explicit size and use flex/align to center vertically
    if (vAlign === 'MID') {
      code += `    lv_obj_set_size(${component.id}, ${width}, ${height});\n`;
      code += `    lv_obj_set_style_pad_top(${component.id}, (${height} - lv_font_get_line_height(lv_obj_get_style_text_font(${component.id}, LV_PART_MAIN))) / 2, LV_PART_MAIN);\n`;
    }

    // --- Letter spacing ---
    const letterSpacing = Number(component.style?.letterSpacing || component.data?.letterSpacing || 0);
    if (letterSpacing !== 0) {
      code += `    lv_obj_set_style_text_letter_space(${component.id}, ${letterSpacing}, LV_PART_MAIN);\n`;
    }

    // --- Line spacing ---
    const lineSpacing = Number(component.style?.lineSpacing || component.data?.lineSpacing || 0);
    if (lineSpacing !== 0) {
      code += `    lv_obj_set_style_text_line_space(${component.id}, ${lineSpacing}, LV_PART_MAIN);\n`;
    }

    // --- Word wrap / long mode ---
    if (wordWrap) {
      code += `    lv_obj_set_size(${component.id}, ${width}, LV_SIZE_CONTENT);\n`;
      code += `    lv_label_set_long_mode(${component.id}, LV_LABEL_LONG_MODE_WRAP);\n`;
    } else {
      // No wrap: clip text at label boundary
      code += `    lv_obj_set_size(${component.id}, ${width}, ${height});\n`;
      code += `    lv_label_set_long_mode(${component.id}, LV_LABEL_LONG_MODE_CLIP);\n`;
    }

    // --- Scroll mode (only when not timer and not word wrap) ---
    if (!isTimerLabel && !wordWrap && component.data?.scrollDirection) {
      const scrollInterval = Number(component.data?.scrollInterval || 3000);
      // Override the CLIP size/mode set above with scroll mode
      code += `    lv_label_set_long_mode(${component.id}, LV_LABEL_LONG_MODE_SCROLL_CIRCULAR);\n`;
      if (scrollInterval > 0) {
        code += `    lv_obj_set_style_anim_duration(${component.id}, ${scrollInterval}, LV_PART_MAIN);\n`;
      }
    }

    // --- Timer mode ---
    if (isTimerLabel) {
      const timerType = String(component.data?.timerType || 'stopwatch');
      const period = timerType === 'countdown' ? 1000 : 100;
      const autoStart = component.data?.timerAutoStart !== false;
      const timerVar = `${component.id}_timer`;
      code += `    lv_timer_t * ${timerVar} = lv_timer_create(${component.id}_timer_cb, ${period}, ${component.id});\n`;
      if (!autoStart) {
        code += `    lv_timer_pause(${timerVar});\n`;
      }
    }

    return code;
  }

  /**
   * Resolve static codegen text from default-locale catalog text.
   * Runtime locale switching is intentionally out of scope for C1.
   */
  private resolveCodegenText(component: Component, ctx: LvglGeneratorContext): string {
    const fallbackText = String(component.data?.text || '');
    const key = typeof component.data?.i18nKey === 'string'
      ? component.data.i18nKey.trim()
      : '';
    const catalog = ctx.projectI18nCatalog;

    if (!catalog || !key) {
      return fallbackText;
    }

    const defaultText = catalog.strings[key]?.[catalog.defaultLocale];
    return typeof defaultText === 'string' && defaultText.length > 0
      ? defaultText
      : fallbackText;
  }

  /**
   * Generate timer callback functions for all timer-mode labels
   */
  generateGlobalDefinitions(components: Component[]): string {
    let code = '';
    const timerLabels = components.filter(c => c.type === 'hg_label' && c.data?.isTimerLabel === true);
    if (timerLabels.length === 0) { return code; }

    code += `// Timer label callback functions\n`;
    for (const comp of timerLabels) {
      const timerType = String(comp.data?.timerType || 'stopwatch');
      const format = String(comp.data?.timerFormat || 'HH:MM:SS');
      const initialValue = Number(comp.data?.timerInitialValue || 0);
      const period = timerType === 'countdown' ? 1000 : 100;

      code += `static uint32_t ${comp.id}_elapsed_ms = ${initialValue};\n`;
      code += `static void ${comp.id}_timer_cb(lv_timer_t * timer)\n`;
      code += `{\n`;
      code += `    lv_obj_t * label = (lv_obj_t *)lv_timer_get_user_data(timer);\n`;

      if (timerType === 'countdown') {
        code += `    if(${comp.id}_elapsed_ms >= ${period}) {\n`;
        code += `        ${comp.id}_elapsed_ms -= ${period};\n`;
        code += `    } else {\n`;
        code += `        ${comp.id}_elapsed_ms = 0;\n`;
        code += `    }\n`;
      } else {
        code += `    ${comp.id}_elapsed_ms += ${period};\n`;
      }

      code += `    uint32_t total_s = ${comp.id}_elapsed_ms / 1000;\n`;
      code += `    uint32_t h = total_s / 3600;\n`;
      code += `    uint32_t m = (total_s % 3600) / 60;\n`;
      code += `    uint32_t s = total_s % 60;\n`;
      code += `    uint32_t ms = (${comp.id}_elapsed_ms % 1000) / 10;\n`;
      code += this.getTimerFormatCode(format, 'label');
      code += `}\n\n`;
    }

    return code;
  }

  /** Get placeholder text for timer display format */
  private getTimerPlaceholder(format: string): string {
    switch (format) {
      case 'HH:MM:SS': return '00:00:00';
      case 'MM:SS': return '00:00';
      case 'MM:SS:MS': return '00:00:00';
      case 'SS': return '00';
      default: return '00:00:00';
    }
  }

  /** Generate snprintf code for timer format */
  private getTimerFormatCode(format: string, labelVar: string): string {
    let code = `    char buf[16];\n`;
    switch (format) {
      case 'HH:MM:SS':
        code += `    lv_snprintf(buf, sizeof(buf), "%02d:%02d:%02d", (int)h, (int)m, (int)s);\n`;
        break;
      case 'MM:SS':
        code += `    lv_snprintf(buf, sizeof(buf), "%02d:%02d", (int)m, (int)s);\n`;
        break;
      case 'MM:SS:MS':
        code += `    lv_snprintf(buf, sizeof(buf), "%02d:%02d:%02d", (int)m, (int)s, (int)ms);\n`;
        break;
      case 'SS':
        code += `    lv_snprintf(buf, sizeof(buf), "%02d", (int)s);\n`;
        break;
      default:
        code += `    lv_snprintf(buf, sizeof(buf), "%02d:%02d:%02d", (int)h, (int)m, (int)s);\n`;
        break;
    }
    code += `    lv_label_set_text(${labelVar}, buf);\n`;
    return code;
  }
}
