/**
 * Default component code generator (generic)
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';
import { HoneyGuiApiMapper } from '../HoneyGuiApiMapper';

export class DefaultGenerator implements ComponentCodeGenerator {
  private apiMapper = new HoneyGuiApiMapper();

  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width, height } = component.position;
    const mapping = this.apiMapper.getMapping(component.type);

    if (!mapping) {
      return `${indentStr}// Warning: no API mapping found for ${component.type}\n`;
    }

    return `${indentStr}${component.id} = ${mapping.createFunction}(${parentRef}, "${component.name}", ${x}, ${y}, ${width}, ${height});\n`;
  }

  generatePropertySetters(component: Component, indent: number, context: GeneratorContext): string {
    let code = '';
    const indentStr = '    '.repeat(indent);
    const mapping = this.apiMapper.getMapping(component.type);

    if (!mapping) return code;

    mapping.propertySetters.forEach(setter => {
      let value = null;

      if (component.style && setter.property in component.style) {
        value = component.style[setter.property];
      } else if (component.data && setter.property in component.data) {
        value = component.data[setter.property];
      }

      if (value !== null && value !== undefined) {
        const transformedValue = setter.valueTransform
          ? setter.valueTransform(value)
          : (typeof value === 'string' ? `"${value}"` : value);

        code += `${indentStr}${setter.apiFunction}(${component.id}, ${transformedValue});\n`;
      }
    });

    // Visibility
    if (component.visible === false) {
      code += `${indentStr}gui_obj_hidden((gui_obj_t *)${component.id}, true);\n`;
    }

    return code;
  }
}
