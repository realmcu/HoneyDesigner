/**
 * hg_input component code generator
 * Implements input functionality using gui_text + gui_text_input_set
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';
import { convertColor } from '../utils';

export class InputGenerator implements ComponentCodeGenerator {
  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width, height } = component.position;
    
    // Get placeholder text (requires C string escaping)
    const placeholder = component.data?.placeholder || 'Input...';
    const escapedPlaceholder = this.escapeCString(placeholder);
    
    // Create text component using gui_text_create
    let code = `${indentStr}${component.id} = gui_text_create(${parentRef}, "${component.name}", ${x}, ${y}, ${width}, ${height});\n`;
    
    // Set placeholder text
    code += `${indentStr}gui_text_set(${component.id}, (void *)"${escapedPlaceholder}", GUI_FONT_SRC_TTF, APP_COLOR_GRAY, strlen("${escapedPlaceholder}"), ${component.style?.fontSize || 16});\n`;
    
    // Enable input functionality
    code += `${indentStr}gui_text_input_set(${component.id}, true);\n`;
    
    return code;
  }

  generatePropertySetters(component: Component, indent: number, _context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    let code = '';

    // Set initial text value if present (requires C string escaping)
    if (component.data?.text) {
      const escapedText = this.escapeCString(component.data.text);
      code += `${indentStr}gui_text_set(${component.id}, (void *)"${escapedText}", GUI_FONT_SRC_TTF, APP_COLOR_BLACK, strlen("${escapedText}"), ${component.style?.fontSize || 16});\n`;
    }
    
    // Text color
    if (component.style?.color) {
      const color = convertColor(component.style.color, 'APP_COLOR_BLACK');
      code += `${indentStr}gui_text_color_set(${component.id}, ${color});\n`;
    }

    // Visibility
    if (component.visible === false) {
      code += `${indentStr}gui_obj_hidden((gui_obj_t *)${component.id}, true);\n`;
    }

    return code;
  }
  
  /**
   * Escape special characters in C strings
   */
  private escapeCString(str: string): string {
    return str
      .replace(/\\/g, '\\\\')   // Backslash must be processed first
      .replace(/"/g, '\\"')     // Double quote
      .replace(/\n/g, '\\n')    // Newline
      .replace(/\r/g, '\\r')    // Carriage return
      .replace(/\t/g, '\\t')    // Tab
      .replace(/\0/g, '\\0');   // Null character
  }

}
