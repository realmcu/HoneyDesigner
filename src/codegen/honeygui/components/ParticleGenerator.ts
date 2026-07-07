/**
 * hg_particle particle effect component code generator
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';

export class ParticleGenerator implements ComponentCodeGenerator {
  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width, height } = component.position;
    const effectType = component.data?.particleEffect || 'snow';

    return `${indentStr}${component.id} = effect_${effectType}_create(${parentRef}, "${component.name}", ${x}, ${y}, ${width}, ${height});\n`;
  }

  generatePropertySetters(component: Component, indent: number, _context: GeneratorContext): string {
    let code = '';
    const indentStr = '    '.repeat(indent);

    // Visibility
    if (component.visible === false) {
      code += `${indentStr}gui_obj_hidden((gui_obj_t *)${component.id}, true);\n`;
    }

    return code;
  }
}
