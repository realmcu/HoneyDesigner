/**
 * 按下反馈（组件属性 pressEffect）的 HoneyGUI 代码
 *
 * 开关在组件上：给某个图标、形状单独打开，按住它就放大淡出（pop）或轻微按下（press），
 * 抬起还原。做法是把该对象的 obj_cb 包一层，在原回调之前按按住状态改写 obj->matrix
 * 与 opacity_value；对象里的子对象跟着一起动。
 *
 *
 * 动画是按时间推的一次性状态机（按下 → 按住 → 回落），不是每帧比较「是否按住」：
 * gui_rect_prepare 之类的 prepare 每帧都会重新入队触摸事件，用边沿判断才不会在
 * 按下/抬起事件重复出现时让图标来回放大缩小。
 *
 * 按下、抬起事件由这里自己注册，所以纯图形的组件也能有反馈。
 *
 * 与入场动画同时存在时，这个包装装得更早——入场动画在外层，落位后还原的正是这一层。
 * 列表项里的组件在 note_design 里才创建，创建时没有全局句柄，这里不处理。
 */
import { Component } from '../../../hml/types';
import {
  PressFeedbackOptions,
  collectPressTargets,
  readPressFeedback,
} from '../../../shared/pressFeedback';
import { entrancePrefix } from '../../entranceCodegen';
import { isUnsupportedChild } from './ViewEntranceGenerator';

export interface HoneyGuiPressFeedbackCode {
  /** switch_in 之前的静态表与回调 */
  helpers: string;
  /** switch_in 里、入场动画启动之前的安装代码（已缩进到函数体内） */
  setup: string;
}

export function computeHoneyGuiPressFeedback(
  view: Component,
  componentMap: Map<string, Component>,
): { options: PressFeedbackOptions; targets: Array<{ id: string; pivot: [number, number]; raise: string[]; options: PressFeedbackOptions }> } | null {
  const targets = collectPressTargets(view, componentMap.values(), {
    skip: isUnsupportedChild,
    skipInsideListItems: true,
  }).map(t => ({
    id: t.component.id,
    pivot: t.pivot,
    raise: t.raise,
    options: readPressFeedback(t.component.data)!,
  }));
  if (targets.length === 0) {
    return null;
  }
  // 同一页里参数可能不同（pop / press 混用），按对象各存一份
  return { options: targets[0].options, targets };
}

export function generateHoneyGuiPressFeedback(
  view: Component,
  componentMap: Map<string, Component>,
  indentStr: string,
): HoneyGuiPressFeedbackCode | null {
  const computed = computeHoneyGuiPressFeedback(view, componentMap);
  if (!computed) {
    return null;
  }
  const { targets } = computed;
  const p = `${entrancePrefix(view.name || view.id)}_press`;
  const n = targets.length;
  // 每个点击目标按下时要一起提层的组件（自己 + 落在它里面的同层文字/角标），摊平成一维表。
  // 引擎不支持的组件不会生成句柄，别塞进组里
  const groups = targets.map(t =>
    t.raise.filter(id => {
      const member = componentMap.get(id);
      return member !== undefined && !isUnsupportedChild(member);
    }),
  );
  const groupStart: number[] = [];
  const group: string[] = [];
  for (const members of groups) {
    groupStart.push(group.length);
    group.push(...members);
  }
  groupStart.push(group.length);
  const gn = group.length;

  let helpers = `/* Press feedback: the tapped object pops out and fades (or sinks) while held.\n`;
  let minDown = Infinity;
  let minUp = Infinity;
  for (const t of targets) {
    minDown = Math.min(minDown, t.options.downMs);
    minUp = Math.min(minUp, t.options.upMs);
  }
  helpers += ` * ${minDown} ms down, ${minUp} ms up, ease-out. */\n`;
  helpers += `static const int16_t ${p}_pivot[][2] = { ${targets.map(t => `{${t.pivot[0]}, ${t.pivot[1]}}`).join(', ')} };\n`;
  helpers += `static const float ${p}_scale[] = { ${targets.map(t => `${t.options.scale.toFixed(4)}f`).join(', ')} };\n`;
  helpers += `static const float ${p}_opa[] = { ${targets.map(t => `${(t.options.opacity / 255).toFixed(4)}f`).join(', ')} };\n`;
  helpers += `static const uint16_t ${p}_down[] = { ${targets.map(t => t.options.downMs).join(', ')} };\n`;
  helpers += `static const uint16_t ${p}_up[] = { ${targets.map(t => t.options.upMs).join(', ')} };\n`;
  helpers += `static gui_obj_t *${p}_objs[${n}];\n`;
  helpers += `static void (*${p}_orig_cb[${n}])(gui_obj_t *obj, T_OBJ_CB_TYPE cb_type);\n`;
  helpers += `static bool ${p}_orig_pre[${n}];\n`;
  helpers += `static bool ${p}_orig_destroy[${n}];\n`;
  // 0 = 静止，1 = 按下中，2 = 按住，3 = 抬起回落
  helpers += `static uint8_t ${p}_state[${n}];\n`;
  helpers += `static uint8_t ${p}_released[${n}];\n`;
  // 1 = 这一段触摸还没用掉过按下，防止重复进队的 PRESSED 反复触发
  helpers += `static uint8_t ${p}_armed[${n}];\n`;
  helpers += `static uint8_t ${p}_progress[${n}];\n`;
  helpers += `static uint32_t ${p}_t0[${n}];\n`;
  helpers += `static uint8_t ${p}_opa0[${n}];\n`;
  helpers += `static uint8_t ${p}_faded[${n}];\n`;
  // 提层的成员（自己 + 落在它里面的同层组件）摊平成一维：group_start[i] 到 group_start[i+1]
  helpers += `static gui_obj_t *${p}_group[${gn}];\n`;
  helpers += `static const uint16_t ${p}_group_start[${n + 1}] = { ${groupStart.join(', ')} };\n`;
  helpers += `static gui_node_list_t *${p}_raised[${gn}];\n\n`;

  // 按下时要压住邻居：HoneyGUI 按子节点顺序绘制，把一组组件的 brother_list 依次挪到队尾
  // （最后画 = 最上层），抬手再按原顺序放回原位。整组一起提，压在图标上的文字才不会被
  // 只提上来的背景盖掉。只能在触摸事件回调里动链表——事件派发在整帧绘制之后
  // （gui_fb.c 末尾），不会打断 gui_list_for_each 的遍历。
  helpers += `static void ${p}_raise(uint16_t i)\n{\n`;
  helpers += `    for (uint16_t k = ${p}_group_start[i]; k < ${p}_group_start[i + 1]; k++)\n    {\n`;
  helpers += `        gui_obj_t *obj = ${p}_group[k];\n`;
  helpers += `        if (obj == NULL || obj->parent == NULL || ${p}_raised[k] != NULL)\n        {\n            continue;\n        }\n`;
  helpers += `        ${p}_raised[k] = obj->brother_list.next;\n`;
  helpers += `        gui_list_remove(&obj->brother_list);\n`;
  helpers += `        gui_list_insert_before(&obj->parent->child_list, &obj->brother_list);\n    }\n}\n\n`;
  helpers += `static void ${p}_unraise(uint16_t i)\n{\n`;
  // 倒序放回，组内的相对层叠顺序才能还原
  helpers += `    for (uint16_t k = ${p}_group_start[i + 1]; k > ${p}_group_start[i]; k--)\n    {\n`;
  helpers += `        gui_obj_t *obj = ${p}_group[k - 1];\n`;
  helpers += `        if (obj == NULL || ${p}_raised[k - 1] == NULL)\n        {\n            continue;\n        }\n`;
  helpers += `        gui_list_remove(&obj->brother_list);\n`;
  helpers += `        gui_list_insert_before(${p}_raised[k - 1], &obj->brother_list);\n`;
  helpers += `        ${p}_raised[k - 1] = NULL;\n    }\n}\n\n`;


  // 图形控件（rect/circle/img）把透明度放在自己的字段里，画图时用的是
  // parent->opacity_value * 自己的 opacity_value，改 obj->opacity_value 不影响它们自己
  helpers += `static uint8_t ${p}_get_opa(gui_obj_t *obj)\n{\n`;
  helpers += `    if (obj->type == MACRO_ROUNDED_RECT)\n    {\n        return ((gui_rounded_rect_t *)obj)->opacity_value;\n    }\n`;
  helpers += `    if (obj->type == MACRO_CIRCLE)\n    {\n        return ((gui_circle_t *)obj)->opacity_value;\n    }\n`;
  helpers += `    if (obj->type == IMAGE || obj->type == IMAGE_FROM_MEM)\n    {\n        return ((gui_img_t *)obj)->opacity_value;\n    }\n`;
  helpers += `    return obj->opacity_value;\n}\n\n`;
  helpers += `static void ${p}_set_opa(gui_obj_t *obj, uint8_t opa)\n{\n`;
  helpers += `    if (obj->type == MACRO_ROUNDED_RECT)\n    {\n        ((gui_rounded_rect_t *)obj)->opacity_value = opa;\n    }\n`;
  helpers += `    else if (obj->type == MACRO_CIRCLE)\n    {\n        ((gui_circle_t *)obj)->opacity_value = opa;\n    }\n`;
  helpers += `    else if (obj->type == IMAGE || obj->type == IMAGE_FROM_MEM)\n    {\n        ((gui_img_t *)obj)->opacity_value = opa;\n    }\n`;
  helpers += `    else\n    {\n        obj->opacity_value = opa;\n    }\n}\n\n`;

  helpers += `static void ${p}_touch_cb(void *obj, gui_event_t *e)\n{\n`;
  helpers += `    if (e == NULL)\n    {\n        return;\n    }\n`;
  helpers += `    for (uint16_t i = 0; i < ${n}; i++)\n    {\n`;
  helpers += `        if (${p}_objs[i] != (gui_obj_t *)obj)\n        {\n            continue;\n        }\n`;
  helpers += `        if (e->code == GUI_EVENT_TOUCH_PRESSED)\n        {\n`;
  helpers += `            // 只认一次按下：绘制裁剪区变化时触摸事件会重复进队，\n`;
  helpers += `            // 边沿判断才不会跟着来回跳\n`;
  helpers += `            if (${p}_state[i] == 0U && ${p}_armed[i])\n            {\n`;
  helpers += `                ${p}_armed[i] = 0U;\n`;
  helpers += `                ${p}_state[i] = 1U;\n`;
  helpers += `                ${p}_released[i] = 0U;\n`;
  helpers += `                ${p}_t0[i] = gui_ms_get();\n`;
  helpers += `                ${p}_raise(i);\n`;
  helpers += `            }\n        }\n`;
  helpers += `        else if (e->code == GUI_EVENT_TOUCH_RELEASED || e->code == GUI_EVENT_TOUCH_CLICKED)\n        {\n`;
  helpers += `            ${p}_armed[i] = 1U;\n`;
  helpers += `            ${p}_unraise(i);\n`;
  helpers += `            if (${p}_state[i] != 0U)\n            {\n                ${p}_released[i] = 1U;\n            }\n        }\n`;
  helpers += `        return;\n    }\n}\n\n`;

  helpers += `static void ${p}_obj_cb(gui_obj_t *obj, T_OBJ_CB_TYPE cb_type)\n{\n`;
  helpers += `    uint16_t i = 0;\n`;
  helpers += `    while (i < ${n} && ${p}_objs[i] != obj)\n    {\n        i++;\n    }\n`;
  helpers += `    if (i >= ${n})\n    {\n        return;\n    }\n`;
  helpers += `    void (*orig)(gui_obj_t *obj, T_OBJ_CB_TYPE cb_type) = ${p}_orig_cb[i];\n`;
  helpers += `    if (cb_type == OBJ_DESTROY)\n    {\n`;
  helpers += `        ${p}_objs[i] = NULL;\n`;
  helpers += `        for (uint16_t k = ${p}_group_start[i]; k < ${p}_group_start[i + 1]; k++)\n        {\n`;
  helpers += `            ${p}_group[k] = NULL;\n`;
  helpers += `            ${p}_raised[k] = NULL;\n        }\n`;
  helpers += `        if (${p}_orig_destroy[i] && orig != NULL)\n        {\n            orig(obj, cb_type);\n        }\n`;
  helpers += `        return;\n    }\n`;
  helpers += `    if (cb_type != OBJ_PRE_PROCESS)\n    {\n`;
  helpers += `        if (orig != NULL)\n        {\n            orig(obj, cb_type);\n        }\n`;
  helpers += `        return;\n    }\n`;
  helpers += `    // 时间驱动的一次性状态机：按下升到位，抬手后回落；\n`;
  helpers += `    // 抬手抬起得早也先把这一下「变化」放完，不会只抖一半\n`;
  helpers += `    uint32_t now = gui_ms_get();\n`;
  helpers += `    uint8_t prev = ${p}_progress[i];\n`;
  helpers += `    if (${p}_state[i] == 1U)\n    {\n`;
  helpers += `        uint32_t t = now - ${p}_t0[i];\n`;
  helpers += `        if (t >= ${p}_down[i])\n        {\n`;
  helpers += `            ${p}_progress[i] = 255U;\n`;
  helpers += `            if (${p}_released[i])\n            {\n                ${p}_state[i] = 3U;\n                ${p}_t0[i] = now;\n            }\n`;
  helpers += `            else\n            {\n                ${p}_state[i] = 2U;\n            }\n        }\n`;
  helpers += `        else\n        {\n            ${p}_progress[i] = (uint8_t)(t * 255U / ${p}_down[i]);\n        }\n    }\n`;
  helpers += `    else if (${p}_state[i] == 2U)\n    {\n`;
  helpers += `        ${p}_progress[i] = 255U;\n`;
  helpers += `        if (${p}_released[i])\n        {\n            ${p}_state[i] = 3U;\n            ${p}_t0[i] = now;\n        }\n    }\n`;
  helpers += `    else if (${p}_state[i] == 3U)\n    {\n`;
  helpers += `        uint32_t t = now - ${p}_t0[i];\n`;
  helpers += `        if (t >= ${p}_up[i])\n        {\n`;
  helpers += `            ${p}_progress[i] = 0U;\n`;
  helpers += `            ${p}_state[i] = 0U;\n`;
  helpers += `            ${p}_released[i] = 0U;\n        }\n`;
  helpers += `        else\n        {\n            ${p}_progress[i] = (uint8_t)(255U - t * 255U / ${p}_up[i]);\n        }\n    }\n`;
  helpers += `    if (${p}_progress[i] != prev)\n    {\n        gui_fb_change();\n    }\n`;
  helpers += `    if (${p}_progress[i] != 0U)\n    {\n`;
  helpers += `        float t = (float)${p}_progress[i] / 255.0f;\n`;
  helpers += `        t = 1.0f - (1.0f - t) * (1.0f - t);\n`;
  helpers += `        float s = 1.0f + (${p}_scale[i] - 1.0f) * t;\n`;
  helpers += `        float px = (float)${p}_pivot[i][0];\n`;
  helpers += `        float py = (float)${p}_pivot[i][1];\n`;
  helpers += `        matrix_translate(px, py, obj->matrix);\n`;
  helpers += `        matrix_scale(s, s, obj->matrix);\n`;
  helpers += `        matrix_translate(-px, -py, obj->matrix);\n`;
  helpers += `        float opa = 1.0f + (${p}_opa[i] - 1.0f) * t;\n`;
  helpers += `        // 图形控件自己不看 obj->opacity_value，得写回它自己的字段，否则只有缩放没有变淡\n`;
  helpers += `        ${p}_set_opa(obj, (uint8_t)((float)${p}_opa0[i] * opa));\n`;
  helpers += `        ${p}_faded[i] = 1U;\n`;
  helpers += `        obj->opacity_value = (uint8_t)((float)obj->opacity_value * opa);\n`;
  helpers += `    }\n`;
  helpers += `    else if (${p}_faded[i])\n    {\n`;
  helpers += `        ${p}_set_opa(obj, ${p}_opa0[i]);\n`;
  helpers += `        ${p}_faded[i] = 0U;\n    }\n`;
  helpers += `    if (${p}_orig_pre[i] && orig != NULL)\n    {\n        orig(obj, cb_type);\n    }\n`;
  helpers += `}\n\n`;

  helpers += `static void ${p}_wrap(uint16_t i, gui_obj_t *obj)\n{\n`;
  helpers += `    if (${p}_objs[i] != NULL)\n    {\n`;
  helpers += `        ${p}_unraise(i);\n`;
  helpers += `        if (${p}_faded[i])\n        {\n`;
  helpers += `            ${p}_set_opa(${p}_objs[i], ${p}_opa0[i]);\n`;
  helpers += `            ${p}_faded[i] = 0U;\n        }\n    }\n`;
  helpers += `    ${p}_objs[i] = obj;\n`;
  helpers += `    ${p}_opa0[i] = ${p}_get_opa(obj);\n`;
  helpers += `    if (obj->obj_cb != ${p}_obj_cb)\n    {\n`;
  helpers += `        ${p}_orig_cb[i] = obj->obj_cb;\n`;
  helpers += `        ${p}_orig_pre[i] = obj->has_pre_process_cb;\n`;
  helpers += `        ${p}_orig_destroy[i] = obj->has_destroy_cb;\n`;
  helpers += `        obj->obj_cb = ${p}_obj_cb;\n`;
  helpers += `        obj->has_pre_process_cb = true;\n`;
  helpers += `        obj->has_destroy_cb = true;\n`;
  helpers += `    }\n}\n\n`;

  const i1 = indentStr + '    ';
  let setup = `\n${i1}// Press feedback\n`;
  targets.forEach((target, i) => {
    const ref = `GUI_BASE(${target.id})`;
    // 切走再切回来时回到静止状态，否则按住后切页会留着一个放大的图标
    setup += `${i1}${p}_state[${i}] = 0;\n`;
    setup += `${i1}${p}_released[${i}] = 0;\n`;
    setup += `${i1}${p}_armed[${i}] = 1;\n`;
    setup += `${i1}${p}_progress[${i}] = 0;\n`;
    // 重新进这个页面时旧对象已经销毁，清掉指针再绑，避免 _wrap 去动野指针
    setup += `${i1}${p}_objs[${i}] = NULL;\n`;
    setup += `${i1}${p}_faded[${i}] = 0;\n`;
    groups[i].forEach((memberId, k) => {
      const slot = groupStart[i] + k;
      setup += `${i1}${p}_group[${slot}] = GUI_BASE(${memberId});\n`;
      setup += `${i1}${p}_raised[${slot}] = NULL;\n`;
    });
    setup += `${i1}${p}_wrap(${i}, ${ref});\n`;
    setup += `${i1}gui_obj_add_event_cb(${ref}, (gui_event_cb_t)${p}_touch_cb, GUI_EVENT_TOUCH_PRESSED, NULL);\n`;
    setup += `${i1}gui_obj_add_event_cb(${ref}, (gui_event_cb_t)${p}_touch_cb, GUI_EVENT_TOUCH_RELEASED, NULL);\n`;
    setup += `${i1}gui_obj_add_event_cb(${ref}, (gui_event_cb_t)${p}_touch_cb, GUI_EVENT_TOUCH_CLICKED, NULL);\n`;
  });

  return { helpers, setup };
}
