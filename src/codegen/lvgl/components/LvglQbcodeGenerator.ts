/**
 * hg_qbcode component LVGL code generator
 *
 * Supports QR code (lv_qrcode) and Barcode (lv_barcode) generation.
 * Properties:
 * - codeType: 'qrcode' | 'barcode'
 * - codeContent: string data to encode
 * - borderSize: quiet zone / border size
 * - encodeMode: 'text' | 'binary' (for QR code)
 * - displayMode: 'section' | 'image' (designer hint, not affecting code gen)
 */
import { Component } from '../../../hml/types';
import { LvglGeneratorContext } from '../LvglComponentGenerator';
import { LvglBaseGenerator } from './LvglBaseGenerator';
import { escapeCString } from '../LvglUtils';

export class LvglQbcodeGenerator extends LvglBaseGenerator {
  generateCreation(component: Component, parentRef: string, _ctx: LvglGeneratorContext): string {
    const { x, y } = this.resolvePosition(component);
    const { width, height } = this.resolveSize(component);

    const codeType = String(component.data?.codeType || 'qrcode');
    const codeContent = String(component.data?.codeContent || 'Hello, World!');
    const borderSize = Number(component.data?.borderSize ?? 2);

    const darkColor = '000000';
    const lightColor = 'FFFFFF';

    if (codeType === 'barcode') {
      return this.generateBarcode(component, parentRef, x, y, width, height, codeContent, darkColor, lightColor);
    } else {
      return this.generateQrcode(component, parentRef, x, y, width, height, codeContent, darkColor, lightColor, borderSize);
    }
  }

  private generateQrcode(
    component: Component, parentRef: string,
    x: number, y: number, width: number, height: number,
    content: string, darkColor: string, lightColor: string, borderSize: number
  ): string {
    // QR code uses the smaller dimension as size (it's always square)
    const size = Math.min(width, height);

    let code = `    ${component.id} = lv_qrcode_create(${parentRef});\n`;
    code += `    lv_obj_set_pos(${component.id}, ${x}, ${y});\n`;
    code += `    lv_qrcode_set_size(${component.id}, ${size});\n`;
    code += `    lv_qrcode_set_dark_color(${component.id}, lv_color_hex(0x${darkColor}));\n`;
    code += `    lv_qrcode_set_light_color(${component.id}, lv_color_hex(0x${lightColor}));\n`;

    // Set data
    code += `    lv_qrcode_update(${component.id}, "${escapeCString(content)}", ${content.length});\n`;

    return code;
  }

  private generateBarcode(
    component: Component, parentRef: string,
    x: number, y: number, width: number, height: number,
    content: string, darkColor: string, lightColor: string
  ): string {
    let code = `    ${component.id} = lv_barcode_create(${parentRef});\n`;
    code += `    lv_obj_set_pos(${component.id}, ${x}, ${y});\n`;
    code += `    lv_obj_set_size(${component.id}, ${width}, ${height});\n`;
    code += `    lv_barcode_set_dark_color(${component.id}, lv_color_hex(0x${darkColor}));\n`;
    code += `    lv_barcode_set_light_color(${component.id}, lv_color_hex(0x${lightColor}));\n`;
    code += `    lv_barcode_set_scale(${component.id}, 2);\n`;
    code += `    lv_barcode_update(${component.id}, "${escapeCString(content)}");\n`;

    return code;
  }
}
