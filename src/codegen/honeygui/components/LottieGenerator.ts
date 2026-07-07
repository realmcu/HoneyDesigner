/**
 * hg_lottie component code generator
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';

export class LottieGenerator implements ComponentCodeGenerator {
  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width, height } = component.position;
    
    const src = component.data?.src || '';

    return `${indentStr}${component.id} = gui_lottie_create_from_file(${parentRef}, "${component.name}", "${src}", ${x}, ${y}, ${width}, ${height});\n`;
  }

  generatePropertySetters(component: Component, indent: number, _context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    let code = '';

    // Auto-play
    if (component.data?.autoplay) {
      code += `${indentStr}${component.id}->playing = 1;\n`;
    }

    // Loop playback
    if (component.data?.loop) {
      code += `${indentStr}${component.id}->loop = 1;\n`;
    }

    // Opacity
    if (component.style?.opacity !== undefined) {
      code += `${indentStr}${component.id}->opacity_value = ${component.style.opacity};\n`;
    }

    // Visibility
    if (component.visible === false) {
      code += `${indentStr}gui_obj_hidden((gui_obj_t *)${component.id}, true);\n`;
    }

    return code;
  }
}
