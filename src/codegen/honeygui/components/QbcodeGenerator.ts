/**
 * hg_qbcode component code generator
 * Generates gui_qbcode_create() and gui_qbcode_config() C code
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';

export class QbcodeGenerator implements ComponentCodeGenerator {
  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width, height } = component.position;

    const displayType = this.getDisplayType(component);
    const encodeType = this.getEncodeType(component);

    return `${indentStr}${component.id} = gui_qbcode_create(${parentRef}, "${component.name}", ${x}, ${y}, ${width}, ${height}, ${displayType}, ${encodeType});\n`;
  }

  generatePropertySetters(component: Component, indent: number, _context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    let code = '';

    const content = component.data?.codeContent ?? '';
    const borderSize = component.data?.borderSize ?? 2;

    if (content) {
      code += `${indentStr}gui_qbcode_config(${component.id}, (uint8_t *)"${this.escapeString(content)}", strlen("${this.escapeString(content)}"), ${borderSize});\n`;
    } else {
      code += `${indentStr}// gui_qbcode_config(${component.id}, (uint8_t *)"your_data", strlen("your_data"), ${borderSize});\n`;
    }

    if (component.visible === false) {
      code += `${indentStr}gui_obj_show((gui_obj_t *)${component.id}, false);\n`;
    }

    return code;
  }

  generateEventBinding(_component: Component, _indent: number): string {
    return '';
  }

  /**
   * Map codeType + displayMode to T_QBCODE_DISPLAY_TYPE enum value
   */
  private getDisplayType(component: Component): string {
    const codeType = component.data?.codeType ?? 'qrcode';
    const displayMode = component.data?.displayMode ?? 'section';

    if (codeType === 'barcode') {
      return displayMode === 'image' ? 'BARCODE_DISPLAY_IMAGE' : 'BARCODE_DISPLAY_SECTION';
    }
    return displayMode === 'image' ? 'QRCODE_DISPLAY_IMAGE' : 'QRCODE_DISPLAY_SECTION';
  }

  /**
   * Map codeType + encodeMode to T_QBCODE_ENCODE_TYPE enum value
   */
  private getEncodeType(component: Component): string {
    const codeType = component.data?.codeType ?? 'qrcode';
    if (codeType === 'barcode') {
      return 'BARCODE_ENCODE_TEXT';
    }
    const encodeMode = component.data?.encodeMode ?? 'text';
    return encodeMode === 'binary' ? 'QRCODE_ENCODE_BINARY' : 'QRCODE_ENCODE_TEXT';
  }

  private escapeString(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
}
