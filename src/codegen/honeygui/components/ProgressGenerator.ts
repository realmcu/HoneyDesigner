import type { Component } from '../../../hml/types';
import { activeSegmentCount, arcDotPosition, arcGeometry, arcSegmentAngles, isIndeterminateProgressMode, progressConfig, progressCornerRadius, progressLabelText, segmentActiveColor, segmentBounds, slideFillWidth } from '../../../shared/progressConfig';
import { convertColorWithOpacity } from '../utils';
import type { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';
import { LabelGenerator } from './LabelGenerator';

const cFloat = (value: number) => `${Number.isInteger(value) ? `${value}.0` : value}f`;

export class ProgressGenerator extends LabelGenerator implements ComponentCodeGenerator {
  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const config = progressConfig(component.data, component.style);
    const active = activeSegmentCount(config);
    const { x, y } = component.position;
    const width = Math.max(1, Math.round(component.position.width));
    const height = Math.max(1, Math.round(component.position.height));
    const pad = '    '.repeat(indent);
    let code = `${pad}${component.id} = gui_win_create(${context.getParentRef(component)}, "${component.id}", ${x}, ${y}, ${width}, ${height});\n`;
    if (config.mode === 'loading') {
      const { cx, cy, radius, stroke } = arcGeometry(config, width, height);
      const parent = `(gui_obj_t *)${component.id}`;
      if (config.showTrack) {
        code += `${pad}${component.id}_track = gui_arc_create(${parent}, "${component.id}_track", ${Math.round(cx)}, ${Math.round(cy)}, ${radius}, -90, 270, ${stroke}, ${convertColorWithOpacity(config.inactiveColor, config.inactiveOpacity)});\n`;
      }
      const start = config.arcStartAngle - (config.arcDirection === 'counterclockwise' ? config.spinArcLen : 0);
      code += `${pad}${component.id}_spin = gui_arc_create(${parent}, "${component.id}_spin", ${Math.round(cx)}, ${Math.round(cy)}, ${radius}, ${start}, ${start + config.spinArcLen}, ${stroke}, ${convertColorWithOpacity(config.activeColor, config.activeOpacity)});\n`;
      code += `${pad}gui_obj_create_timer((gui_obj_t *)${component.id}_spin, 33, true, ${component.id}_spin_cb);\n`;
      if (config.spinAutostart) code += `${pad}${component.id}_start();\n`;
    } else if (config.mode === 'loading-slide') {
      const parent = `(gui_obj_t *)${component.id}`;
      const fillWidth = slideFillWidth(config, width);
      code += `${pad}${component.id}_track = gui_rect_create(${parent}, "${component.id}_track", 0, 0, ${width}, ${height}, ${progressCornerRadius(config, width, height)}, ${convertColorWithOpacity(config.inactiveColor, config.inactiveOpacity)});\n`;
      code += `${pad}${component.id}_slide = gui_rect_create(${parent}, "${component.id}_slide", 0, 0, ${fillWidth}, ${height}, ${progressCornerRadius(config, fillWidth, height)}, ${convertColorWithOpacity(config.activeColor, config.activeOpacity)});\n`;
      code += `${pad}gui_obj_create_timer((gui_obj_t *)${component.id}_slide, 33, true, ${component.id}_slide_cb);\n`;
      if (config.spinAutostart) code += `${pad}${component.id}_start();\n`;
    } else if (config.mode.startsWith('arc')) {
      const { cx, cy, radius, stroke } = arcGeometry(config, width, height);
      const centerX = Math.round(cx);
      const centerY = Math.round(cy);
      const parent = `(gui_obj_t *)${component.id}`;
      if (config.mode === 'arc' || config.mode === 'arc-gauge') {
        const end = config.arcStartAngle + (config.arcDirection === 'clockwise' ? 1 : -1) * config.arcSweepAngle;
        code += `${pad}${component.id}_track = gui_arc_create(${parent}, "${component.id}_track", ${centerX}, ${centerY}, ${radius}, ${Math.min(config.arcStartAngle, end)}, ${Math.max(config.arcStartAngle, end)}, ${stroke}, ${convertColorWithOpacity(config.inactiveColor, config.inactiveOpacity)});\n`;
        code += `${pad}${component.id}_fill = gui_arc_create(${parent}, "${component.id}_fill", ${centerX}, ${centerY}, ${radius}, ${config.arcDirection === 'clockwise' ? config.arcStartAngle : config.arcStartAngle - 1}, ${config.arcDirection === 'clockwise' ? config.arcStartAngle + 1 : config.arcStartAngle}, ${stroke}, ${convertColorWithOpacity(config.activeColor, config.activeOpacity)});\n`;
      } else if (config.mode === 'arc-dots') {
        for (let index = 0; index < config.count; index++) {
          const dot = arcDotPosition(config, width, height, index);
          const color = index < active
            ? convertColorWithOpacity(segmentActiveColor(config, index), config.activeOpacity)
            : convertColorWithOpacity(config.inactiveColor, config.inactiveOpacity);
          code += `${pad}${component.id}_dots[${index}] = gui_circle_create(${parent}, "${component.id}_dot_${index}", ${dot.x}, ${dot.y}, ${dot.radius}, ${color});\n`;
        }
      } else {
        for (let index = 0; index < config.count; index++) {
          const { start, end } = arcSegmentAngles(config, width, height, index);
          const color = index < active
            ? convertColorWithOpacity(segmentActiveColor(config, index), config.activeOpacity)
            : convertColorWithOpacity(config.inactiveColor, config.inactiveOpacity);
          code += `${pad}${component.id}_arcs[${index}] = gui_arc_create(${parent}, "${component.id}_arc_${index}", ${centerX}, ${centerY}, ${radius}, ${Math.min(start, end)}, ${Math.max(start, end)}, ${stroke}, ${color});\n`;
        }
      }
    } else if (config.mode === 'linear') {
      const radius = progressCornerRadius(config, width, height);
      code += `${pad}${component.id}_track = gui_rect_create((gui_obj_t *)${component.id}, "${component.id}_track", 0, 0, ${width}, ${height}, ${radius}, ${convertColorWithOpacity(config.inactiveColor, config.inactiveOpacity)});\n`;
      code += `${pad}${component.id}_fill = gui_rect_create((gui_obj_t *)${component.id}, "${component.id}_fill", 0, 0, 1, 1, 0, ${convertColorWithOpacity(config.activeColor, config.activeOpacity)});\n`;
    } else {
      for (let index = 0; index < config.count; index++) {
        const bounds = segmentBounds(config, width, height, index);
        const radius = progressCornerRadius(config, bounds.width, bounds.height);
        const color = index < active
          ? convertColorWithOpacity(segmentActiveColor(config, index), config.activeOpacity)
          : convertColorWithOpacity(config.inactiveColor, config.inactiveOpacity);
        code += `${pad}${component.id}_segments[${index}] = gui_rect_create((gui_obj_t *)${component.id}, "${component.id}_seg_${index}", ${bounds.x}, ${bounds.y}, ${bounds.width}, ${bounds.height}, ${radius}, ${color});\n`;
      }
    }
    if (!isIndeterminateProgressMode(config.mode) && config.showValueLabel) {
      const label = `${component.id}_label`;
      code += `${pad}${label} = gui_text_create((gui_obj_t *)${component.id}, "${label}", ${config.valueLabelOffsetX}, ${config.valueLabelOffsetY}, ${width}, ${height});\n`;
      code += `${pad}gui_text_set(${label}, ${component.id}_label_text, ${this.getFontType(component)}, ${convertColorWithOpacity(config.valueLabelColor, 255)}, ${progressLabelText(config).length}, ${config.valueLabelFontSize});\n`;
      if (component.data?.fontFile) {
        code += `${pad}gui_text_type_set(${label}, "${this.getConvertedFontFileName(component)}", ${this.getFontMode()});\n`;
      }
      code += `${pad}gui_text_mode_set(${label}, LEFT);\n`;
    }
    if (config.mode === 'linear' || config.mode === 'arc' || config.mode === 'arc-gauge' || (!isIndeterminateProgressMode(config.mode) && config.showValueLabel)) {
      code += `${pad}${component.id}_set_value(${config.value});\n`;
    }
    if (!isIndeterminateProgressMode(config.mode) && config.showValueLabel) {
      code += `${pad}gui_obj_create_timer((gui_obj_t *)${component.id}_label, 50, false, ${component.id}_center_label);\n`;
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
    if (config.mode === 'loading') {
      const start = config.arcDirection === 'clockwise'
        ? `angle` : `angle - ${cFloat(config.spinArcLen)}`;
      return `
${config.showTrack ? `gui_arc_t *${id}_track = NULL;\n` : ''}gui_arc_t *${id}_spin = NULL;
static uint32_t ${id}_spin_elapsed = 0;
static uint32_t ${id}_spin_started = 0;
static bool ${id}_spin_running = false;

static void ${id}_spin_cb(void *obj)
{
    (void)obj;
    if (!${id}_spin_running || ${id}_spin == NULL) return;
    uint32_t elapsed = (${id}_spin_elapsed + (uint32_t)(gui_ms_get() - ${id}_spin_started) % ${config.spinPeriod}) % ${config.spinPeriod};
    float phase = (float)elapsed * (360.0f / ${cFloat(config.spinPeriod)});
    float angle = ${cFloat(config.arcStartAngle)} ${config.arcDirection === 'clockwise' ? '+' : '-'} phase;
    gui_arc_set_start_angle(${id}_spin, ${start});
    gui_arc_set_end_angle(${id}_spin, ${start} + ${cFloat(config.spinArcLen)});
}

void ${id}_start(void)
{
    if (${id}_spin == NULL || ${id}_spin_running) return;
    ${id}_spin_started = gui_ms_get();
    ${id}_spin_running = true;
}

void ${id}_stop(void)
{
    if (!${id}_spin_running) return;
    ${id}_spin_cb(${id}_spin);
    ${id}_spin_elapsed = (${id}_spin_elapsed + (uint32_t)(gui_ms_get() - ${id}_spin_started) % ${config.spinPeriod}) % ${config.spinPeriod};
    ${id}_spin_running = false;
}
`;
    }
    if (config.mode === 'loading-slide') {
      const width = Math.max(1, Math.round(component.position.width));
      const fillWidth = slideFillWidth(config, width);
      return `
gui_rounded_rect_t *${id}_track = NULL;
gui_rounded_rect_t *${id}_slide = NULL;
static uint32_t ${id}_slide_elapsed = 0;
static uint32_t ${id}_slide_started = 0;
static bool ${id}_slide_running = false;

static void ${id}_slide_cb(void *obj)
{
    (void)obj;
    if (!${id}_slide_running || ${id}_slide == NULL) return;
    uint32_t elapsed = (${id}_slide_elapsed + (uint32_t)(gui_ms_get() - ${id}_slide_started) % ${config.spinPeriod}) % ${config.spinPeriod};
    float phase = (float)elapsed / ${cFloat(config.spinPeriod)};
    float half = phase < 0.5f ? phase * 2.0f : (1.0f - phase) * 2.0f;
    float eased = half * half * (3.0f - 2.0f * half);
    int32_t x = (int32_t)((${width - fillWidth}) * eased + 0.5f);
    gui_rect_set_position(${id}_slide, x, 0);
}

void ${id}_start(void)
{
    if (${id}_slide == NULL || ${id}_slide_running) return;
    ${id}_slide_started = gui_ms_get();
    ${id}_slide_running = true;
}

void ${id}_stop(void)
{
    if (!${id}_slide_running) return;
    ${id}_slide_cb(${id}_slide);
    ${id}_slide_elapsed = (${id}_slide_elapsed + (uint32_t)(gui_ms_get() - ${id}_slide_started) % ${config.spinPeriod}) % ${config.spinPeriod};
    ${id}_slide_running = false;
}
`;
    }
    const active = convertColorWithOpacity(config.activeColor, config.activeOpacity);
    const inactive = convertColorWithOpacity(config.inactiveColor, config.inactiveOpacity);
    const lowColor = convertColorWithOpacity(config.zoneLowColor, config.activeOpacity);
    const midColor = convertColorWithOpacity(config.zoneMidColor, config.activeOpacity);
    const highColor = convertColorWithOpacity(config.zoneHighColor, config.activeOpacity);
    const zoneColor = config.colorMode === 'positional'
      ? `(i * 100 < ${config.thresholdLow * config.count} ? ${lowColor} : i * 100 < ${config.thresholdHigh * config.count} ? ${midColor} : ${highColor})`
      : config.colorMode === 'state' ? 'zone_color' : active;
    const stateColor = config.colorMode === 'state'
      ? `    int64_t progress = (int64_t)value - (int64_t)${config.min};
    gui_color_t zone_color = progress * 100 < (int64_t)${config.thresholdLow} * ${config.max - config.min}
        ? ${lowColor}
        : progress * 100 < (int64_t)${config.thresholdHigh} * ${config.max - config.min}
            ? ${midColor} : ${highColor};
`
      : '';
    const labelState = config.showValueLabel
      ? `gui_text_t *${id}_label = NULL;
static char ${id}_label_text[24] = "${progressLabelText(config)}";

static void ${id}_center_label(void *obj)
{
    gui_text_t *label = (gui_text_t *)obj;
    if (label == NULL) return;
    if (label->char_width_sum <= 0 || label->char_height_sum <= 0) {
        gui_text_layout_measure(label);
    }
    // An unconverted bitmap font may not provide metrics during creation.
    int32_t label_width = label->char_width_sum;
    if (label_width <= 0) {
        label_width = 0;
        for (const char *ch = ${id}_label_text; *ch != '\\0'; ++ch) {
            label_width += ${config.valueLabelFontSize} * (*ch == '1' ? 45 : *ch == '%' ? 80 : *ch == '-' ? 40 : 60) / 100;
        }
    }
    int32_t label_height = label->char_height_sum;
    if (label_height <= 0) label_height = ${config.valueLabelFontSize};
    gui_text_move(label,
                  ${config.valueLabelOffsetX} + (${Math.max(1, Math.round(component.position.width))} - label_width) / 2,
                  ${config.valueLabelOffsetY} + (${Math.max(1, Math.round(component.position.height))} - label_height) / 2);
}
`
      : '';
    const labelUpdate = config.showValueLabel
      ? `    if (${id}_label != NULL) {
        snprintf(${id}_label_text, sizeof(${id}_label_text), ${config.valueLabelFormat === 'percent'
          ? `"%ld%%", (long)((((int64_t)value - (int64_t)${config.min}) * 100 + ${Math.floor((config.max - config.min) / 2)}) / ${config.max - config.min})`
          : '"%ld", (long)value'});
        gui_text_content_set(${id}_label, ${id}_label_text, (uint16_t)strlen(${id}_label_text));
        ${id}_center_label(${id}_label);
    }
`
      : '';
    if (config.mode === 'arc' || config.mode === 'arc-gauge') {
      return `
gui_arc_t *${id}_track = NULL;
gui_arc_t *${id}_fill = NULL;
${labelState}

void ${id}_set_value(int32_t value)
{
    if (${id}_fill == NULL) return;
    if (value < ${config.min}) value = ${config.min};
    if (value > ${config.max}) value = ${config.max};
${labelUpdate}
    if (value == ${config.min}) {
        gui_obj_hidden((gui_obj_t *)${id}_fill, true);
        return;
    }
    gui_arc_set_${config.arcDirection === 'clockwise' ? 'end' : 'start'}_angle(${id}_fill, ${cFloat(config.arcStartAngle)} ${config.arcDirection === 'clockwise' ? '+' : '-'} ${cFloat(config.arcSweepAngle)} * (float)((int64_t)value - (int64_t)${config.min}) / ${config.max - config.min});
    gui_obj_hidden((gui_obj_t *)${id}_fill, false);
}
`;
    }
    if (config.mode === 'arc-segmented' || config.mode === 'arc-dots') {
      const isDots = config.mode === 'arc-dots';
      return `
${isDots ? 'gui_circle_t' : 'gui_arc_t'} *${id}_${isDots ? 'dots' : 'arcs'}[${config.count}] = {0};
${labelState}

void ${id}_set_value(int32_t value)
{
    if (value < ${config.min}) value = ${config.min};
    if (value > ${config.max}) value = ${config.max};
${labelUpdate}
    int32_t count = (int32_t)((((int64_t)value - (int64_t)${config.min}) * ${config.count} + ${config.max - config.min - 1}) / ${config.max - config.min});
${stateColor}
    for (int32_t i = 0; i < ${config.count}; ++i) {
        if (${id}_${isDots ? 'dots' : 'arcs'}[i] != NULL) {
            ${isDots ? 'gui_circle_set_color' : 'gui_arc_set_color'}(${id}_${isDots ? 'dots' : 'arcs'}[i], i < count ? ${zoneColor} : ${inactive});
        }
    }
}
`;
    }
    if (config.mode === 'linear') {
      const width = Math.max(1, Math.round(component.position.width));
      const height = Math.max(1, Math.round(component.position.height));
      const extent = config.vertical ? height : width;
      return `
gui_rounded_rect_t *${id}_track = NULL;
gui_rounded_rect_t *${id}_fill = NULL;
${labelState}

void ${id}_set_value(int32_t value)
{
    if (${id}_fill == NULL) return;
    if (value < ${config.min}) value = ${config.min};
    if (value > ${config.max}) value = ${config.max};
${labelUpdate}
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
${labelState}

void ${id}_set_value(int32_t value)
{
    if (value < ${config.min}) value = ${config.min};
    if (value > ${config.max}) value = ${config.max};
${labelUpdate}
    int32_t count = (int32_t)((((int64_t)value - (int64_t)${config.min}) * ${config.count} + ${config.max - config.min - 1}) / ${config.max - config.min});
${stateColor}
    for (int32_t i = 0; i < ${config.count}; ++i) {
        if (${id}_segments[i] != NULL) {
            gui_rect_set_color(${id}_segments[i], i < count ? ${zoneColor} : ${inactive});
        }
    }
}
`;
  }
}
