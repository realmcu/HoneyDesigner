/**
 * hg_streaming component code generator
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';

const CODEC_MAP: Record<string, string> = {
  jpeg:    'GUI_STREAM_CODEC_JPEG',
  msv1:    'GUI_STREAM_CODEC_MSV1',
  raw:     'GUI_STREAM_CODEC_RAW',
  h264:    'GUI_STREAM_CODEC_H264',
};

const DROP_MAP: Record<string, string> = {
  none:          'GUI_STREAM_DROP_NONE',
  unconditional: 'GUI_STREAM_DROP_UNCONDITIONAL',
};

export class StreamingGenerator implements ComponentCodeGenerator {

  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width, height } = component.position;

    const codec      = (component.data?.codec as string) || 'jpeg';
    const transporter = (component.data?.transporter as string) || 'NULL';
    const interval   = (component.data?.updateInterval as number) ?? 40;
    const dropMode   = (component.data?.dropMode as string) || 'none';

    const codecMacro = CODEC_MAP[codec] || 'GUI_STREAM_CODEC_JPEG';
    const dropMacro  = DROP_MAP[dropMode] || 'GUI_STREAM_DROP_NONE';

    let code = `${indentStr}${component.id} = gui_stream_create(${parentRef}, "${component.name}", ${codecMacro}, ${transporter}, ${x}, ${y}, ${width}, ${height});\n`;

    if (interval !== 40) {
      code += `${indentStr}gui_stream_set_update_interval((gui_stream_t *)${component.id}, ${interval});\n`;
    }

    if (dropMode !== 'none') {
      code += `${indentStr}gui_stream_set_drop_mode((gui_stream_t *)${component.id}, ${dropMacro});\n`;
    }

    code += `${indentStr}gui_stream_set_state((gui_stream_t *)${component.id}, GUI_VIDEO_STATE_PLAYING);\n`;

    return code;
  }

  generatePropertySetters(component: Component, indent: number, _context: GeneratorContext): string {
    let code = '';
    const indentStr = '    '.repeat(indent);

    if (component.visible !== undefined) {
      code += `${indentStr}gui_obj_show((gui_obj_t *)${component.id}, ${component.visible ? 'true' : 'false'});\n`;
    }

    return code;
  }
}
