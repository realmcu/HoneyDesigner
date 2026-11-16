/**
 * hg_view 页面入场动画（entranceAnim）的 HoneyGUI 代码
 *
 * 运行方式：
 * - 每个运动对象的 obj_cb 换成入场回调，原回调记下来照常转发。HoneyGUI 每帧在 OBJ_PRE_PROCESS
 *   之前用「父矩阵 × 自身位置」重建 obj->matrix，入场回调在这里追加平移、绕卡片中心的旋转与缩放，
 *   子对象拷贝父矩阵，所以整张卡片（底板、图标、文字）一起倾斜、缩放、回弹。
 *   位图字体的文字只跟着平移，不旋转缩放（HoneyGUI 的位图文字不支持矩阵变换）。
 * - 叶子控件自己的 prepare 会在矩阵上继续叠加它的变换，所以入场变换在原回调之前加；
 *   列表项（note）的 prepare 会按列表样式重排矩阵，所以入场变换在原回调之后加。
 * - 列表项是滚到可视区时才创建的：note_design 末尾调 *_note_created，入场还没结束就包上回调。
 * - 等 gui_view_get_current() 就是本页（切页过渡结束）才开始计时；没轮到的对象不透明度为 0。
 *   每个对象落位后把回调、透明度还原，之后就和没有入场动画时完全一样。
 *
 * 只支持单独移动有全局句柄的组件：arc group 成员、hg_3d（局部变量）不参与。
 * 常驻内存的页面再次进入不会重建，入场动画只在第一次创建时播放。
 */
import { Component } from '../../../hml/types';
import {
  ViewEntrance,
  computeViewEntrance,
  emitEntranceSample,
  emitEntranceTables,
  entrancePrefix,
} from '../../entranceCodegen';
import {
  ENTRANCE_FIXED_SHIFT,
  ENTRANCE_ROT_UNIT,
  ENTRANCE_SCALE_UNIT,
} from '../../../shared/entranceAnimation';

/** 运行时每帧调整的对象（一个组件可能对应多个对象，如拆分时间标签） */
interface EntranceObject {
  /** C 表达式：gui_obj_t *；列表项为 undefined（运行时才创建） */
  ref?: string;
  group: number;
  pivot: [number, number];
  /** 列表项：所在列表的 C 句柄与 note 序号 */
  noteList?: string;
  noteIndex?: number;
  /** 淡入用的设置函数调用（opacity 占位为 $O），不支持单独透明度的组件为 undefined */
  setOpacity?: string;
  /** 落位后的不透明度 */
  baseOpacity: number;
}

function opacityOf(value: unknown, fallback = 255): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(255, Math.round(n))) : fallback;
}

/** 页面直接子组件对应的运动对象 */
function objectsFor(component: Component, group: number, pivot: [number, number]): EntranceObject[] {
  const id = component.id;
  const base = { group, pivot };
  switch (component.type) {
    case 'hg_time_label':
      if (component.data?.timeFormat === 'HH:mm-split') {
        return ['hour', 'colon', 'min'].map(part => ({ ...base, ref: `GUI_BASE(${id}_${part})`, baseOpacity: 255 }));
      }
      break;
    case 'hg_image':
      return [{ ...base, ref: `GUI_BASE(${id})`, baseOpacity: opacityOf(component.style?.transform?.opacity), setOpacity: `gui_img_set_opacity((gui_img_t *)${id}, $O)` }];
    case 'hg_gif':
      return [{ ...base, ref: `GUI_BASE(${id})`, baseOpacity: opacityOf(component.style?.transform?.opacity), setOpacity: `gui_gif_set_opacity((gui_gif_t *)${id}, $O)` }];
    case 'hg_svg':
      return [{ ...base, ref: `GUI_BASE(${id})`, baseOpacity: opacityOf(component.style?.opacity), setOpacity: `gui_svg_set_opacity((gui_svg_t *)${id}, $O)` }];
    // 矩形、圆形、圆弧的透明度已烘进颜色（gui_rgba），对象自身透明度基准是 255
    case 'hg_rect':
      return [{ ...base, ref: `GUI_BASE(${id})`, baseOpacity: 255, setOpacity: `gui_rect_set_opacity((gui_rounded_rect_t *)${id}, $O)` }];
    case 'hg_circle':
      return [{ ...base, ref: `GUI_BASE(${id})`, baseOpacity: 255, setOpacity: `gui_circle_set_opacity((gui_circle_t *)${id}, $O)` }];
    case 'hg_arc':
      return [{ ...base, ref: `GUI_BASE(${id})`, baseOpacity: 255, setOpacity: `gui_arc_set_opacity((gui_arc_t *)${id}, $O)` }];
    default:
      break;
  }
  return [{ ...base, ref: `GUI_BASE(${id})`, baseOpacity: 255 }];
}

/** HoneyGUI 下无法单独移动的子组件 */
function isUnsupportedChild(child: Component): boolean {
  return child.type === 'hg_3d' || child.type === 'hg_list_item' || (child.type === 'hg_arc' && !!child.data?.arcGroup);
}

/** 用户自己写 note_design 的列表没法挂入场钩子，整个列表作为一张卡片 */
function usesGeneratedNoteDesign(list: Component): boolean {
  const userFunc = list.data?.userNoteDesignFunc as string | undefined;
  return !(list.data?.useUserNoteDesign === true && userFunc && userFunc.trim() !== '');
}

export interface HoneyGuiViewEntranceCode {
  /** switch_in 之前的静态表和回调 */
  helpers: string;
  /** switch_in 末尾的启动代码（已缩进到函数体内） */
  setup: string;
}

export function computeHoneyGuiViewEntrance(view: Component, componentMap: Map<string, Component>): ViewEntrance | null {
  return computeViewEntrance(view, componentMap, { skip: isUnsupportedChild, expandList: usesGeneratedNoteDesign });
}

function noteCreatedName(view: Component): string {
  return `${entrancePrefix(view.name || view.id)}_note_created`;
}

/**
 * 列表的 note_design 末尾要调用的入场钩子；列表项不参与入场时返回 null。
 * 钩子定义在页面代码里（note_design 之后），调用方需要先声明。
 */
export function honeyGuiNoteEntranceHook(list: Component, componentMap: Map<string, Component>): string | null {
  const view = list.parent ? componentMap.get(list.parent) : undefined;
  if (!view || view.type !== 'hg_view') {
    return null;
  }
  const entrance = computeHoneyGuiViewEntrance(view, componentMap);
  if (!entrance?.members.some(m => m.list?.id === list.id)) {
    return null;
  }
  return noteCreatedName(view);
}

export function generateHoneyGuiViewEntrance(
  view: Component,
  componentMap: Map<string, Component>,
  indentStr: string,
): HoneyGuiViewEntranceCode | null {
  const entrance = computeHoneyGuiViewEntrance(view, componentMap);
  if (!entrance) {
    return null;
  }

  const p = entrancePrefix(view.name || view.id);
  const objects: EntranceObject[] = entrance.members.flatMap(m => {
    const pivot: [number, number] = [m.pivotX, m.pivotY];
    if (m.list) {
      return [{ group: m.group, pivot, noteList: `GUI_BASE(${m.list.id})`, noteIndex: m.listIndex ?? 0, baseOpacity: 255 }];
    }
    return objectsFor(m.component, m.group, pivot);
  });
  const n = objects.length;
  const hasNotes = objects.some(o => o.noteList);
  const fade = entrance.options.fade;
  const leafFade = fade && objects.some(o => o.setOpacity);
  const totalMs = entrance.plan.totalMs;

  let helpers = emitEntranceTables(p, entrance, {
    objGroups: objects.map(o => o.group),
    objOpacity: leafFade ? objects.map(o => o.baseOpacity) : undefined,
    objPivots: objects.map(o => o.pivot),
  });
  if (hasNotes) {
    helpers += `static const int16_t ${p}_note_index[] = { ${objects.map(o => o.noteList ? o.noteIndex : -1).join(', ')} };\n`;
    helpers += `static gui_obj_t *${p}_note_list[${n}];\n`;
  }
  helpers += `static gui_view_t *${p}_view = NULL;\n`;
  helpers += `static gui_obj_t *${p}_objs[${n}];\n`;
  helpers += `static void (*${p}_orig_cb[${n}])(gui_obj_t *obj, T_OBJ_CB_TYPE cb_type);\n`;
  helpers += `static bool ${p}_orig_pre[${n}];\n`;
  helpers += `static bool ${p}_orig_destroy[${n}];\n`;
  helpers += `static uint32_t ${p}_start = 0;\n`;
  helpers += `static bool ${p}_started = false;\n\n`;

  if (leafFade) {
    helpers += `static void ${p}_set_opacity(uint16_t i, uint8_t opacity)\n{\n`;
    helpers += `    switch (i)\n    {\n`;
    objects.forEach((o, i) => {
      if (o.setOpacity) {
        helpers += `    case ${i}:\n        ${o.setOpacity.replace('$O', 'opacity')};\n        break;\n`;
      }
    });
    helpers += `    default:\n        GUI_UNUSED(opacity);\n        break;\n    }\n}\n\n`;
  }

  // 每帧给对象 i 追加入场变换；落位后还原回调
  // 还没轮到的对象挪到屏幕外并把不透明度置 0（子对象继承）。
  // 不用 gui_obj_hidden：隐藏的对象不再走 PRE_PROCESS，回调就再也恢复不了它
  const conceal = `            matrix_translate(0.0f, -8192.0f, obj->matrix);\n` +
    `            obj->opacity_value = 0;\n${leafFade ? `            ${p}_set_opacity(i, 0);\n` : ''}            return;\n`;
  helpers += `static void ${p}_animate(uint16_t i, gui_obj_t *obj)\n{\n`;
  helpers += `    uint16_t g = ${p}_obj_group[i];\n`;
  helpers += `    if (!${p}_started)\n    {\n`;
  helpers += `        // Wait until the view switch transition has finished\n`;
  helpers += `        if (gui_view_get_current() != ${p}_view)\n        {\n`;
  helpers += conceal;
  helpers += `        }\n`;
  helpers += `        ${p}_started = true;\n`;
  helpers += `        ${p}_start = gui_ms_get();\n`;
  helpers += `    }\n`;
  helpers += `    uint32_t elapsed = gui_ms_get() - ${p}_start;\n`;
  helpers += `    gui_fb_change();\n`;
  helpers += `    if (elapsed < ${p}_delays[g])\n    {\n`;
  helpers += conceal.replace(/^ {4}/gm, '');
  helpers += `    }\n`;
  helpers += `    uint32_t t = elapsed - ${p}_delays[g];\n`;
  helpers += emitEntranceSample(p, '    ', fade);
  helpers += `    if (done)\n    {\n`;
  helpers += `        obj->obj_cb = ${p}_orig_cb[i];\n`;
  helpers += `        obj->has_pre_process_cb = ${p}_orig_pre[i];\n`;
  helpers += `        obj->has_destroy_cb = ${p}_orig_destroy[i];\n`;
  helpers += `        ${p}_objs[i] = NULL;\n`;
  if (leafFade) {
    helpers += `        ${p}_set_opacity(i, ${p}_obj_opacity[i]);\n`;
  }
  helpers += `        return;\n    }\n`;
  helpers += `    float px = (float)${p}_obj_pivot[i][0];\n`;
  helpers += `    float py = (float)${p}_obj_pivot[i][1];\n`;
  helpers += `    float s = 1.0f + (float)v[3] / ${ENTRANCE_SCALE_UNIT}.0f;\n`;
  helpers += `    matrix_translate((float)v[0] / ${1 << ENTRANCE_FIXED_SHIFT}.0f + px, (float)v[1] / ${1 << ENTRANCE_FIXED_SHIFT}.0f + py, obj->matrix);\n`;
  helpers += `    matrix_rotate((float)v[2] / ${ENTRANCE_ROT_UNIT}.0f, obj->matrix);\n`;
  helpers += `    matrix_scale(s, s, obj->matrix);\n`;
  helpers += `    matrix_translate(-px, -py, obj->matrix);\n`;
  if (fade) {
    helpers += `    // Children copy the parent's opacity, so this fades a whole card\n`;
    helpers += `    obj->opacity_value = (uint8_t)(obj->opacity_value * fade / 255U);\n`;
  }
  if (leafFade) {
    helpers += `    ${p}_set_opacity(i, (uint8_t)(${p}_obj_opacity[i] * fade / 255U));\n`;
  }
  helpers += `}\n\n`;

  helpers += `static void ${p}_obj_cb(gui_obj_t *obj, T_OBJ_CB_TYPE cb_type)\n{\n`;
  helpers += `    uint16_t i = 0;\n`;
  helpers += `    while (i < ${n} && ${p}_objs[i] != obj)\n    {\n        i++;\n    }\n`;
  helpers += `    if (i >= ${n})\n    {\n        return;\n    }\n`;
  helpers += `    void (*orig)(gui_obj_t *obj, T_OBJ_CB_TYPE cb_type) = ${p}_orig_cb[i];\n`;
  helpers += `    if (cb_type == OBJ_DESTROY)\n    {\n`;
  helpers += `        ${p}_objs[i] = NULL;\n`;
  helpers += `        if (${p}_orig_destroy[i] && orig != NULL)\n        {\n            orig(obj, cb_type);\n        }\n`;
  helpers += `        return;\n    }\n`;
  helpers += `    if (cb_type != OBJ_PRE_PROCESS)\n    {\n`;
  helpers += `        if (orig != NULL)\n        {\n            orig(obj, cb_type);\n        }\n`;
  helpers += `        return;\n    }\n`;
  helpers += `    bool run_orig = ${p}_orig_pre[i] && orig != NULL;\n`;
  if (hasNotes) {
    helpers += `    if (${p}_note_list[i] != NULL)\n    {\n`;
    helpers += `        // List notes lay out their matrix in prepare: add the entrance on top of it\n`;
    helpers += `        if (run_orig)\n        {\n            orig(obj, cb_type);\n        }\n`;
    helpers += `        ${p}_animate(i, obj);\n`;
    helpers += `        return;\n    }\n`;
  }
  helpers += `    // Widgets append their own transform in prepare: put the entrance underneath\n`;
  helpers += `    ${p}_animate(i, obj);\n`;
  helpers += `    if (run_orig)\n    {\n        orig(obj, cb_type);\n    }\n`;
  helpers += `}\n\n`;

  helpers += `static void ${p}_wrap(uint16_t i, gui_obj_t *obj)\n{\n`;
  helpers += `    ${p}_objs[i] = obj;\n`;
  helpers += `    if (obj->obj_cb != ${p}_obj_cb)\n    {\n`;
  helpers += `        ${p}_orig_cb[i] = obj->obj_cb;\n`;
  helpers += `        ${p}_orig_pre[i] = obj->has_pre_process_cb;\n`;
  helpers += `        ${p}_orig_destroy[i] = obj->has_destroy_cb;\n`;
  helpers += `        obj->obj_cb = ${p}_obj_cb;\n`;
  helpers += `        obj->has_pre_process_cb = true;\n`;
  helpers += `        obj->has_destroy_cb = true;\n`;
  helpers += `    }\n`;
  helpers += `}\n\n`;

  if (hasNotes) {
    helpers += `// Called at the end of note_design: notes are created as they scroll into view\n`;
    helpers += `static void ${noteCreatedName(view)}(gui_obj_t *obj)\n{\n`;
    helpers += `    if (${p}_view == NULL || (${p}_started && gui_ms_get() - ${p}_start >= ${totalMs}U))\n    {\n        return;\n    }\n`;
    helpers += `    int16_t index = ((gui_list_note_t *)obj)->index;\n`;
    helpers += `    for (uint16_t i = 0; i < ${n}; i++)\n    {\n`;
    helpers += `        if (${p}_note_list[i] == obj->parent && ${p}_note_index[i] == index)\n        {\n`;
    helpers += `            ${p}_wrap(i, obj);\n            return;\n        }\n`;
    helpers += `    }\n}\n\n`;
  }

  const i1 = indentStr + '    ';
  let setup = `\n${i1}// Page entrance animation: ${entrance.options.direction}\n`;
  setup += `${i1}${p}_view = view;\n`;
  setup += `${i1}${p}_started = false;\n`;
  objects.forEach((o, i) => {
    if (o.noteList) {
      setup += `${i1}${p}_note_list[${i}] = ${o.noteList};\n`;
      setup += `${i1}${p}_objs[${i}] = NULL;\n`;
    } else {
      if (hasNotes) {
        setup += `${i1}${p}_note_list[${i}] = NULL;\n`;
      }
      setup += `${i1}${p}_wrap(${i}, ${o.ref});\n`;
    }
  });
  // gui_list_create 时可视区的 note 已经建好（那时入场还没初始化），这里补挂一次
  const noteLists = [...new Set(objects.filter(o => o.noteList).map(o => o.noteList!))];
  noteLists.forEach(list => {
    setup += `${i1}{\n`;
    setup += `${i1}    gui_node_list_t *node = NULL;\n`;
    setup += `${i1}    gui_list_for_each(node, &${list}->child_list)\n${i1}    {\n`;
    setup += `${i1}        gui_obj_t *note = gui_list_entry(node, gui_obj_t, brother_list);\n`;
    setup += `${i1}        if (note->type == LIST_NOTE)\n${i1}        {\n`;
    setup += `${i1}            ${noteCreatedName(view)}(note);\n`;
    setup += `${i1}        }\n${i1}    }\n${i1}}\n`;
  });

  return { helpers, setup };
}
