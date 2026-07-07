/**
 * hg_canvas component code generator
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';

export class CanvasGenerator implements ComponentCodeGenerator {
  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width, height } = component.position;

    return `${indentStr}${component.id} = gui_canvas_create(${parentRef}, "${component.name}", NULL, ${x}, ${y}, ${width}, ${height});\n`;
  }

  generatePropertySetters(component: Component, indent: number, _context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    let code = '';

    // Canvas requires a callback function to draw content
    // Generate a comment to remind the user to set the callback
    code += `${indentStr}// TODO: gui_canvas_set_canvas_cb(${component.id}, your_canvas_callback);\n`;

    // Visibility
    if (component.visible === false) {
      code += `${indentStr}gui_obj_hidden((gui_obj_t *)${component.id}, true);\n`;
    }

    return code;
  }
}
