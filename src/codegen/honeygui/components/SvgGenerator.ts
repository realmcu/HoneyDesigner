/**
 * hg_svg component code generator
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';

export class SvgGenerator implements ComponentCodeGenerator {
  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y } = component.position;
    
    let src = component.data?.src || '';
    // Strip assets/ prefix
    src = src.replace(/^assets\//, '');
    // Ensure path starts with /
    if (!src.startsWith('/')) {
      src = '/' + src;
    }

    // Create SVG using gui_svg_create_from_file
    return `${indentStr}${component.id} = gui_svg_create_from_file(${parentRef}, "${component.name}", "${src}", ${x}, ${y});\n`;
  }

  generatePropertySetters(component: Component, indent: number, _context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    let code = '';

    // Scale
    if (component.style?.scale !== undefined) {
      code += `${indentStr}gui_svg_set_scale((gui_svg_t *)${component.id}, ${component.style.scale}f);\n`;
    }

    // Opacity
    if (component.style?.opacity !== undefined) {
      code += `${indentStr}gui_svg_set_opacity((gui_svg_t *)${component.id}, ${component.style.opacity});\n`;
    }

    // Visibility
    if (component.visible === false) {
      code += `${indentStr}gui_obj_hidden((gui_obj_t *)${component.id}, true);\n`;
    }

    return code;
  }
}
