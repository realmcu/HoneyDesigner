/**
 * hg_glass component code generator
 * Glass effect component, created via gui_glass_create_from_fs
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';

export class GlassGenerator implements ComponentCodeGenerator {

  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y } = component.position;

    const src = component.data?.src || '';
    // Replace .glass extension with .bin
    let binSrc = src.replace(/\.glass$/i, '.bin');
    // Strip assets/ prefix
    binSrc = binSrc.replace(/^assets\//, '');
    // Ensure path starts with /
    if (!binSrc.startsWith('/')) {
      binSrc = '/' + binSrc;
    }

    // gui_glass_create_from_fs(parent, "name", "file_path", x, y, 0, 0)
    return `${indentStr}${component.id} = gui_glass_create_from_fs(${parentRef}, "${component.name}", "${binSrc}", ${x}, ${y}, 0, 0);\n`;
  }

  generatePropertySetters(component: Component, indent: number, context: GeneratorContext): string {
    let code = '';
    const indentStr = '    '.repeat(indent);

    // Movable - enable press event
    if (component.data?.movable) {
      code += `${indentStr}gui_glass_enable_pressing_envent((gui_glass_t *)${component.id});\n`;
    }

    // Click - enable click event
    if (component.data?.click) {
      code += `${indentStr}gui_glass_enable_click_event((gui_glass_t *)${component.id});\n`;
    }

    // Visibility
    if (component.visible === false) {
      code += `${indentStr}gui_obj_hidden((gui_obj_t *)${component.id}, true);\n`;
    }

    return code;
  }
}
