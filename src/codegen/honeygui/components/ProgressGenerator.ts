import type { Component } from '../../../hml/types';
import { activeSegmentCount, progressConfig, progressCornerRadius, segmentBounds } from '../../../shared/progressConfig';
import { convertColorWithOpacity } from '../utils';
import type { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';

export class ProgressGenerator implements ComponentCodeGenerator {
  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const config = progressConfig(component.data, component.style);
    const active = activeSegmentCount(config);
    const { x, y } = component.position;
    const width = Math.max(1, Math.round(component.position.width));
    const height = Math.max(1, Math.round(component.position.height));
    const pad = '    '.repeat(indent);
    let code = `${pad}${component.id} = gui_win_create(${context.getParentRef(component)}, "${component.id}", ${x}, ${y}, ${width}, ${height});\n`;
    if (config.mode === 'linear') {
      const radius = progressCornerRadius(config, width, height);
      code += `${pad}${component.id}_track = gui_rect_create((gui_obj_t *)${component.id}, "${component.id}_track", 0, 0, ${width}, ${height}, ${radius}, ${convertColorWithOpacity(config.inactiveColor, config.inactiveOpacity)});\n`;
      code += `${pad}${component.id}_fill = gui_rect_create((gui_obj_t *)${component.id}, "${component.id}_fill", 0, 0, 1, 1, 0, ${convertColorWithOpacity(config.activeColor, config.activeOpacity)});\n`;
      code += `${pad}${component.id}_set_value(${config.value});\n`;
    } else {
      for (let index = 0; index < config.count; index++) {
        const bounds = segmentBounds(config, width, height, index);
        const radius = progressCornerRadius(config, bounds.width, bounds.height);
        const color = index < active
          ? convertColorWithOpacity(config.activeColor, config.activeOpacity)
          : convertColorWithOpacity(config.inactiveColor, config.inactiveOpacity);
        code += `${pad}${component.id}_segments[${index}] = gui_rect_create((gui_obj_t *)${component.id}, "${component.id}_seg_${index}", ${bounds.x}, ${bounds.y}, ${bounds.width}, ${bounds.height}, ${radius}, ${color});\n`;
      }
    }
    return code;
  }

  generatePropertySetters(component: Component, indent: number): string {
    return component.visible === false
      ? `${'    '.repeat(indent)}gui_obj_hidden((gui_obj_t *)${component.id}, true);\n`
      : '';
  }

  generateValueSetter(component: Component): string {
    const config = progressConfig(component.data, component.style);
    const { id } = component;
    const active = convertColorWithOpacity(config.activeColor, config.activeOpacity);
    const inactive = convertColorWithOpacity(config.inactiveColor, config.inactiveOpacity);
    if (config.mode === 'linear') {
      const width = Math.max(1, Math.round(component.position.width));
      const height = Math.max(1, Math.round(component.position.height));
      const extent = config.vertical ? height : width;
      return `
gui_rounded_rect_t *${id}_track = NULL;
gui_rounded_rect_t *${id}_fill = NULL;

void ${id}_set_value(int32_t value)
{
    if (${id}_fill == NULL) return;
    if (value < ${config.min}) value = ${config.min};
    if (value > ${config.max}) value = ${config.max};
    int32_t length = (int32_t)((((int64_t)value - (int64_t)${config.min}) * ${extent} + ${Math.floor((config.max - config.min) / 2)}) / ${config.max - config.min});
    if (length == 0) {
        gui_obj_hidden((gui_obj_t *)${id}_fill, true);
        return;
    }
    gui_rect_set_size(${id}_fill, ${config.vertical ? width : 'length'}, ${config.vertical ? 'length' : height});
    gui_rect_set_position(${id}_fill, ${config.fillStart === 'right' ? `${width} - length` : '0'}, ${config.fillStart === 'bottom' ? `${height} - length` : '0'});
    int32_t radius = ${config.cornerRadius};
    if (radius > ${config.vertical ? width : 'length'} / 2) radius = ${config.vertical ? width : 'length'} / 2;
    if (radius > ${config.vertical ? 'length' : height} / 2) radius = ${config.vertical ? 'length' : height} / 2;
    gui_rect_set_radius(${id}_fill, radius);
    gui_obj_hidden((gui_obj_t *)${id}_fill, false);
}
`;
    }
    return `
gui_rounded_rect_t *${id}_segments[${config.count}] = {0};

void ${id}_set_value(int32_t value)
{
    if (value < ${config.min}) value = ${config.min};
    if (value > ${config.max}) value = ${config.max};
    int32_t count = (int32_t)((((int64_t)value - (int64_t)${config.min}) * ${config.count} + ${config.max - config.min - 1}) / ${config.max - config.min});
    for (int32_t i = 0; i < ${config.count}; ++i) {
        if (${id}_segments[i] != NULL) {
            gui_rect_set_color(${id}_segments[i], i < count ? ${active} : ${inactive});
        }
    }
}
`;
  }
}
