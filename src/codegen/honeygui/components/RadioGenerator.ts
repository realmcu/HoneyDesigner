/**
 * hg_radio component code generator
 * TODO: Implement radio button-specific code generation logic
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';

export class RadioGenerator implements ComponentCodeGenerator {
  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width, height } = component.position;

    // TODO: Implement radio button creation logic
    return `${indentStr}// TODO: ${component.id} = gui_radio_create(${parentRef}, "${component.name}", ${x}, ${y}, ${width}, ${height});\n`;
  }

  generatePropertySetters(component: Component, indent: number, _context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    let code = '';

    if (component.data?.value !== undefined) {
      code += `${indentStr}// TODO: gui_radio_set_selected(${component.id}, ${component.data.value});\n`;
    }

    // Visibility
    if (component.visible === false) {
      code += `${indentStr}gui_obj_hidden((gui_obj_t *)${component.id}, true);\n`;
    }

    return code;
  }
}
