/**
 * 按下反馈（组件属性 pressEffect）的 LVGL 代码
 *
 * LVGL 自带状态过渡：把 pressed 状态下的 transform_scale / opa 写好，挂一个
 * lv_style_transition_dsc_t，按下、抬起就自动补间，不需要动画回调。
 * 缩放以组件中心为轴心；放大要加 OVERFLOW_VISIBLE，否则会被父容器裁掉。
 */
import { Component } from '../../hml/types';
import { PressFeedbackOptions, collectPressTargets, readPressFeedback } from '../../shared/pressFeedback';
import { entrancePrefix } from '../entranceCodegen';

/** LVGL 的缩放单位：256 = 1.0 */
const LV_SCALE_ONE = 256;
/** LVGL 只有一档过渡时长（按下、抬起相同），取按下 80 ms 与抬起 180 ms 的中间值 */
const LV_TRANSITION_MS = 120;

export interface LvglPressTarget {
  id: string;
  pivot: [number, number];
  options: PressFeedbackOptions;
}

export function computeLvglPressFeedback(view: Component, componentMap: Map<string, Component>): LvglPressTarget[] {
  return collectPressTargets(view, componentMap.values()).map(t => ({
    id: t.component.id,
    pivot: t.pivot,
    options: readPressFeedback(t.component.data)!,
  }));
}

/** create 函数之前：过渡描述 */
export function generateLvglPressFeedbackHelpers(view: Component, componentMap: Map<string, Component>): string {
  if (computeLvglPressFeedback(view, componentMap).length === 0) {
    return '';
  }
  const p = `${entrancePrefix(view.id)}_press`;
  let code = `\nstatic lv_style_transition_dsc_t ${p}_tr;\n`;
  code += `static bool ${p}_tr_init = false;\n`;
  code += `static const lv_style_prop_t ${p}_props[] = { LV_STYLE_TRANSFORM_SCALE, LV_STYLE_OPA, 0 };\n`;
  return code;
}

/** create 函数末尾：给每个开关了的组件写好按下状态的样式 */
export function generateLvglPressFeedbackRegistration(view: Component, componentMap: Map<string, Component>): string {
  const targets = computeLvglPressFeedback(view, componentMap);
  if (targets.length === 0) {
    return '';
  }
  const p = `${entrancePrefix(view.id)}_press`;

  let code = `    // Press feedback\n`;
  code += `    if (!${p}_tr_init)\n    {\n`;
  code += `        lv_style_transition_dsc_init(&${p}_tr, ${p}_props, lv_anim_path_ease_out, ${LV_TRANSITION_MS}, 0, NULL);\n`;
  code += `        ${p}_tr_init = true;\n    }\n`;
  for (const target of targets) {
    const ref = target.id;
    code += `    lv_obj_set_style_transform_pivot_x(${ref}, ${target.pivot[0]}, 0);\n`;
    code += `    lv_obj_set_style_transform_pivot_y(${ref}, ${target.pivot[1]}, 0);\n`;
    code += `    lv_obj_set_style_transform_scale(${ref}, ${Math.round(target.options.scale * LV_SCALE_ONE)}, LV_STATE_PRESSED);\n`;
    if (target.options.opacity < 255) {
      code += `    lv_obj_set_style_opa(${ref}, ${target.options.opacity}, LV_STATE_PRESSED);\n`;
    }
    code += `    lv_obj_set_style_transition(${ref}, &${p}_tr, LV_STATE_DEFAULT);\n`;
    code += `    lv_obj_set_style_transition(${ref}, &${p}_tr, LV_STATE_PRESSED);\n`;
    if (target.options.scale > 1) {
      // 放大后会超出父容器，不加这个会被裁掉
      code += `    lv_obj_add_flag(${ref}, LV_OBJ_FLAG_OVERFLOW_VISIBLE);\n`;
    }
  }
  return code;
}
