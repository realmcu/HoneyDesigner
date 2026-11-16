/**
 * hg_view 页面入场动画（entranceAnim）的 LVGL 代码
 *
 * 运行方式：
 * - LV_EVENT_SCREEN_LOAD_START：把运动对象放到起点并设为全透明（切屏动画期间页面是空的）。
 * - LV_EVENT_SCREEN_LOADED：每个对象一个 lv_anim，值为组内经过的毫秒数，
 *   exec_cb 查表插值后设置 translate、绕卡片中心的 transform_rotation / transform_scale 和 opa。
 *   列表的每一项单独弹入。
 * 入口页在 create 时已经是活动屏幕，收不到这两个事件，create 末尾直接播放。
 */
import { Component } from '../../hml/types';
import {
  ViewEntrance,
  computeViewEntrance,
  emitEntranceSample,
  emitEntranceTables,
  entrancePrefix,
} from '../entranceCodegen';
import { ENTRANCE_FIXED_SHIFT, ENTRANCE_SCALE_UNIT } from '../../shared/entranceAnimation';

function baseOpacityOf(component: Component): number {
  if (component.type === 'hg_image' || component.type === 'hg_gif' || component.type === 'hg_svg') {
    const n = Number(component.style?.transform?.opacity);
    if (Number.isFinite(n)) {
      return Math.max(0, Math.min(255, Math.round(n)));
    }
  }
  return 255;
}

export function computeLvglViewEntrance(view: Component, componentMap: Map<string, Component>): ViewEntrance | null {
  // LVGL 的列表项是常驻的 lv_obj，每项单独弹入
  return computeViewEntrance(view, componentMap, { expandList: () => true });
}

/** create 函数之前的静态表与回调 */
export function generateLvglEntranceHelpers(view: Component, componentMap: Map<string, Component>): string {
  const entrance = computeLvglViewEntrance(view, componentMap);
  if (!entrance) {
    return '';
  }
  const p = entrancePrefix(view.id);
  const members = entrance.members;
  const n = members.length;
  const fade = entrance.options.fade;
  const div = 1 << ENTRANCE_FIXED_SHIFT;

  let code = `\n` + emitEntranceTables(p, entrance, {
    objGroups: members.map(m => m.group),
    objOpacity: members.map(m => baseOpacityOf(m.component)),
    objPivots: members.map(m => [m.pivotX, m.pivotY]),
    durations: true,
  });
  code += `static lv_obj_t * ${p}_objs[${n}];\n\n`;

  // 表里的旋转单位（0.1 度）与 LVGL 相同；缩放从 (s - 1) * 4096 换成 LVGL 的 256 = 1.0
  code += `static void ${p}_apply(lv_obj_t * obj, const int32_t * v, lv_opa_t opa)\n{\n`;
  code += `    lv_obj_set_style_translate_x(obj, v[0] / ${div}, 0);\n`;
  code += `    lv_obj_set_style_translate_y(obj, v[1] / ${div}, 0);\n`;
  code += `    lv_obj_set_style_transform_rotation(obj, v[2], 0);\n`;
  code += `    lv_obj_set_style_transform_scale(obj, LV_SCALE_NONE + v[3] * LV_SCALE_NONE / ${ENTRANCE_SCALE_UNIT}, 0);\n`;
  code += `    lv_obj_set_style_opa(obj, opa, 0);\n`;
  code += `}\n\n`;

  code += `static void ${p}_exec_cb(void * var, int32_t v)\n{\n`;
  code += `    lv_obj_t * obj = (lv_obj_t *)var;\n`;
  code += `    uint16_t i = 0;\n`;
  code += `    while (i < ${n} && ${p}_objs[i] != obj)\n    {\n        i++;\n    }\n`;
  code += `    if (i >= ${n})\n    {\n        return;\n    }\n`;
  code += `    uint16_t g = ${p}_obj_group[i];\n`;
  code += `    uint32_t t = (uint32_t)(v < 0 ? 0 : v);\n`;
  code += emitEntranceSample(p, '    ', fade);
  code += `    LV_UNUSED(done);\n`;
  code += fade
    ? `    ${p}_apply(obj, v, (lv_opa_t)(${p}_obj_opacity[i] * fade / 255U));\n`
    : `    ${p}_apply(obj, v, ${p}_obj_opacity[i]);\n`;
  code += `}\n\n`;

  code += `static void ${p}_prepare(void)\n{\n`;
  members.forEach((m, i) => {
    code += `    ${p}_objs[${i}] = ${m.component.id};\n`;
  });
  code += `    for (uint16_t i = 0; i < ${n}; i++)\n    {\n`;
  code += `        lv_obj_t * obj = ${p}_objs[i];\n`;
  code += `        const int16_t * first = ${p}_tracks[${p}_obj_group[i]][0];\n`;
  code += `        int32_t v[4] = { first[0], first[1], first[2], first[3] };\n`;
  code += `        lv_anim_delete(obj, ${p}_exec_cb);\n`;
  code += `        // Tilt and scale around the card centre\n`;
  code += `        lv_obj_set_style_transform_pivot_x(obj, ${p}_obj_pivot[i][0], 0);\n`;
  code += `        lv_obj_set_style_transform_pivot_y(obj, ${p}_obj_pivot[i][1], 0);\n`;
  code += `        ${p}_apply(obj, v, LV_OPA_TRANSP);\n`;
  code += `    }\n}\n\n`;

  code += `static void ${p}_play(void)\n{\n`;
  code += `    for (uint16_t i = 0; i < ${n}; i++)\n    {\n`;
  code += `        uint16_t g = ${p}_obj_group[i];\n`;
  code += `        lv_anim_t a;\n`;
  code += `        lv_anim_init(&a);\n`;
  code += `        lv_anim_set_var(&a, ${p}_objs[i]);\n`;
  code += `        lv_anim_set_exec_cb(&a, ${p}_exec_cb);\n`;
  code += `        lv_anim_set_values(&a, 0, ${p}_durations[g]);\n`;
  code += `        lv_anim_set_duration(&a, ${p}_durations[g]);\n`;
  code += `        lv_anim_set_delay(&a, ${p}_delays[g]);\n`;
  code += `        lv_anim_set_path_cb(&a, lv_anim_path_linear);\n`;
  code += `        lv_anim_set_early_apply(&a, false);\n`;
  code += `        lv_anim_start(&a);\n`;
  code += `    }\n}\n\n`;

  code += `static void ${p}_event_cb(lv_event_t * e)\n{\n`;
  code += `    lv_event_code_t code = lv_event_get_code(e);\n`;
  code += `    if (code == LV_EVENT_SCREEN_LOAD_START)\n    {\n        ${p}_prepare();\n    }\n`;
  code += `    else if (code == LV_EVENT_SCREEN_LOADED)\n    {\n        ${p}_play();\n    }\n`;
  code += `}\n`;
  return code;
}

/** create 函数末尾：注册屏幕加载事件；已是活动屏幕（入口页）时直接播放 */
export function generateLvglEntranceRegistration(view: Component, componentMap: Map<string, Component>): string {
  const entrance = computeLvglViewEntrance(view, componentMap);
  if (!entrance) {
    return '';
  }
  const p = entrancePrefix(view.id);
  let code = `    // Page entrance animation: ${entrance.options.direction}\n`;
  code += `    lv_obj_add_event_cb(${view.id}, ${p}_event_cb, LV_EVENT_SCREEN_LOAD_START, NULL);\n`;
  code += `    lv_obj_add_event_cb(${view.id}, ${p}_event_cb, LV_EVENT_SCREEN_LOADED, NULL);\n`;
  code += `    if (lv_screen_active() == ${view.id})\n    {\n`;
  code += `        ${p}_prepare();\n`;
  code += `        ${p}_play();\n`;
  code += `    }\n`;
  return code;
}
