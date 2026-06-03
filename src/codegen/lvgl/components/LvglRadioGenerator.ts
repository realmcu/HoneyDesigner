/**
 * hg_radio component LVGL code generator
 *
 * Radio buttons are implemented using lv_checkbox with circular indicator styles
 * and mutual exclusion logic, following the official LVGL example (lv_example_checkbox_2).
 *
 * Key points:
 * - Each radio is a lv_checkbox with LV_RADIUS_CIRCLE style on the indicator
 * - LV_OBJ_FLAG_EVENT_BUBBLE is set so clicks bubble to the parent container
 * - The parent container handles LV_EVENT_CLICKED to enforce mutual exclusion
 * - A static active_index variable per radio group tracks the selected radio
 */
import { Component } from '../../../hml/types';
import { LvglGeneratorContext } from '../LvglComponentGenerator';
import { parseColorHex, escapeCString, getLvglFontBySize, getContrastTextColor } from '../LvglUtils';
import { LvglBaseGenerator } from './LvglBaseGenerator';

export class LvglRadioGenerator extends LvglBaseGenerator {
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

    // Apply circular radio styles
    code += `    radio_style_init();\n`;
    code += `    lv_obj_add_style(${component.id}, &style_radio, LV_PART_INDICATOR);\n`;
    code += `    lv_obj_add_style(${component.id}, &style_radio_chk, LV_PART_INDICATOR | LV_STATE_CHECKED);\n`;

    // Enable event bubbling so the parent container can handle mutual exclusion
    code += `    lv_obj_add_flag(${component.id}, LV_OBJ_FLAG_EVENT_BUBBLE);\n`;

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

  generateGlobalDefinitions(components: Component[]): string {
    const radios = components.filter(c => c.type === 'hg_radio');
    if (radios.length === 0) { return ''; }

    // Collect unique parent IDs that contain radio buttons for mutual exclusion
    const parentIds = new Set<string>();
    for (const radio of radios) {
      if (radio.parent) {
        parentIds.add(radio.parent);
      }
    }

    let code = `// Radio button styles (circular indicator)\n`;
    code += `static lv_style_t style_radio;\n`;
    code += `static lv_style_t style_radio_chk;\n`;
    code += `static bool style_radio_initialized = false;\n\n`;

    // One active_index per radio group (parent container)
    for (const parentId of parentIds) {
      // Find the initially checked radio index within this parent
      const siblings = radios.filter(r => r.parent === parentId);
      const checkedIndex = siblings.findIndex(r => 
        r.data?.checked === true || r.data?.checked === 'true' 
        || r.data?.value === true || r.data?.value === 'true');
      code += `static int32_t ${parentId}_radio_active_index = ${checkedIndex >= 0 ? checkedIndex : 0};\n`;
    }
    code += `\n`;

    code += `static void radio_style_init(void)\n`;
    code += `{\n`;
    code += `    if(style_radio_initialized) return;\n`;
    code += `    style_radio_initialized = true;\n\n`;
    code += `    lv_style_init(&style_radio);\n`;
    code += `    lv_style_set_radius(&style_radio, LV_RADIUS_CIRCLE);\n\n`;
    code += `    lv_style_init(&style_radio_chk);\n`;
    code += `    lv_style_set_bg_image_src(&style_radio_chk, NULL);\n`;
    code += `}\n\n`;

    // Generate mutual exclusion event handler
    code += `static void radio_event_handler(lv_event_t * e)\n`;
    code += `{\n`;
    code += `    int32_t * active_id = (int32_t *)lv_event_get_user_data(e);\n`;
    code += `    lv_obj_t * cont = (lv_obj_t *)lv_event_get_current_target(e);\n`;
    code += `    lv_obj_t * act_cb = lv_event_get_target_obj(e);\n`;
    code += `    lv_obj_t * old_cb = lv_obj_get_child(cont, *active_id);\n\n`;
    code += `    /* Do nothing if the container was clicked */\n`;
    code += `    if(act_cb == cont) return;\n\n`;
    code += `    lv_obj_remove_state(old_cb, LV_STATE_CHECKED);  /* Uncheck the previous radio button */\n`;
    code += `    lv_obj_add_state(act_cb, LV_STATE_CHECKED);     /* Check the current radio button */\n\n`;
    code += `    *active_id = lv_obj_get_index(act_cb);\n`;
    code += `}\n\n`;

    return code;
  }
}
