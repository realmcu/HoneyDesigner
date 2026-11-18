/**
 * 页面入场动画的 C 代码公共部分（HoneyGUI 与 LVGL 共用）
 *
 * 曲线在 src/shared/entranceAnimation.ts 里算好，这里只负责：
 * - 找出页面里参与入场的组件并分组（列表按引擎规则拆成一项一项）
 * - 把每组的 60 fps 表（位移 / 旋转 / 缩放）写成 const 数组
 * - 生成两套引擎共用的「按时间查表插值」C 片段
 */
import { Component } from '../hml/types';
import {
  EntranceCollectRules,
  EntranceOptions,
  EntrancePlan,
  ENTRANCE_FIXED_SHIFT,
  ENTRANCE_FPS,
  ENTRANCE_ROT_UNIT,
  ENTRANCE_SCALE_UNIT,
  collectEntrancePieces,
  planEntrance,
  readEntranceOptions,
  toFixedOffset,
  toFixedRotation,
  toFixedScale,
} from '../shared/entranceAnimation';

export interface EntranceMember {
  component: Component;
  group: number;
  /** 列表项所在的列表；页面直接子组件为 undefined */
  list?: Component;
  /** 列表项在列表里的序号（与 HoneyGUI note->index 对应） */
  listIndex?: number;
  /** 旋转、缩放的中心，相对组件自身左上角（像素） */
  pivotX: number;
  pivotY: number;
}

export interface ViewEntrance {
  options: EntranceOptions;
  plan: EntrancePlan;
  members: EntranceMember[];
}

/**
 * 计算一个 hg_view 的入场方案；未开启或没有可动的组件时返回 null。
 * @param rules 引擎规则：哪些子组件不能单独移动、哪些列表拆成列表项
 */
export function computeViewEntrance(
  view: Component,
  componentMap: Map<string, Component>,
  rules: EntranceCollectRules<Component> = {},
): ViewEntrance | null {
  const options = readEntranceOptions(view.data);
  if (!options) {
    return null;
  }

  const lookup = (id: string) => componentMap.get(id);
  const collected = collectEntrancePieces(view, lookup, rules);
  if (collected.length === 0) {
    return null;
  }

  const plan = planEntrance(
    Number(view.position.width) || 0,
    Number(view.position.height) || 0,
    collected.map(c => c.piece),
    options,
  );

  const groupOf = new Map<string, number>();
  plan.groups.forEach((g, index) => g.ids.forEach(id => groupOf.set(id, index)));
  const members = collected.map(({ piece, component, list }) => {
    const group = groupOf.get(component.id) ?? 0;
    const g = plan.groups[group];
    return {
      component,
      group,
      list,
      listIndex: list ? sortedIndexInList(list, component, componentMap) : undefined,
      pivotX: Math.round(g.cx - piece.x),
      pivotY: Math.round(g.cy - piece.y),
    };
  });

  return { options, plan, members };
}

function sortedIndexInList(list: Component, item: Component, componentMap: Map<string, Component>): number {
  const items = (list.children ?? [])
    .map(id => componentMap.get(id))
    .filter((c): c is Component => c !== undefined && c.type === 'hg_list_item')
    .sort((a, b) => (Number(a.data?.index) || 0) - (Number(b.data?.index) || 0));
  return items.findIndex(c => c.id === item.id);
}

/** 组内播放时长（毫秒）：向上取整，保证最后一个值一定落到最后一帧 */
export function groupDurationMs(frameCount: number): number {
  return Math.ceil((frameCount - 1) * 1000 / ENTRANCE_FPS);
}

/** C 标识符前缀（view 名或 id 里可能有连字符等字符） */
export function entrancePrefix(name: string): string {
  return `${name.replace(/[^A-Za-z0-9_]/g, '_')}_entrance`;
}

export interface EntranceTableOptions {
  /** 每个运动对象所在组（顺序即 C 里的对象下标） */
  objGroups: number[];
  /** 每个运动对象落位后的不透明度（0~255）；不淡入时不传，避免生成未使用的数组 */
  objOpacity?: number[];
  /** 每个运动对象的旋转 / 缩放中心（相对对象自身，像素） */
  objPivots?: Array<[number, number]>;
  /** 是否输出每组时长 */
  durations?: boolean;
}

/**
 * 每组的表、帧数、延时，以及每个运动对象所在组（可选：时长、基础不透明度、中心点）。
 * 只输出调用方会用到的数组：工程常开 -Werror，未使用的 static const 会报错。
 */
export function emitEntranceTables(prefix: string, entrance: ViewEntrance, tables: EntranceTableOptions): string {
  const { plan, options } = entrance;
  let code = `/* Page entrance animation (${options.direction}): ${plan.groups.length} group(s), ${plan.totalMs} ms.\n`;
  code += ` * Each row is {dx, dy, rotation, scale} at ${ENTRANCE_FPS} fps: offsets in 1/${1 << ENTRANCE_FIXED_SHIFT} px,\n`;
  code += ` * rotation in 1/${ENTRANCE_ROT_UNIT} degree, scale as (scale - 1) * ${ENTRANCE_SCALE_UNIT}. Baked by HoneyGUI Designer. */\n`;

  plan.groups.forEach((group, g) => {
    const rows: string[] = [];
    for (let f = 0; f < group.dx.length; f++) {
      rows.push(`{${toFixedOffset(group.dx[f])}, ${toFixedOffset(group.dy[f])}, ${toFixedRotation(group.rot[f])}, ${toFixedScale(group.scale[f])}}`);
    }
    code += `static const int16_t ${prefix}_track${g}[][4] =\n{\n`;
    for (let i = 0; i < rows.length; i += 4) {
      code += `    ${rows.slice(i, i + 4).join(', ')},\n`;
    }
    code += `};\n`;
  });

  const list = (values: Array<string | number>) => values.join(', ');
  code += `static const int16_t (*const ${prefix}_tracks[])[4] = { ${list(plan.groups.map((_, g) => `${prefix}_track${g}`))} };\n`;
  code += `static const uint16_t ${prefix}_frames[] = { ${list(plan.groups.map(g => g.dx.length))} };\n`;
  code += `static const uint16_t ${prefix}_delays[] = { ${list(plan.groups.map(g => g.delay))} };\n`;
  if (tables.durations) {
    code += `static const uint16_t ${prefix}_durations[] = { ${list(plan.groups.map(g => groupDurationMs(g.dx.length)))} };\n`;
  }
  code += `static const uint16_t ${prefix}_obj_group[] = { ${list(tables.objGroups)} };\n`;
  if (tables.objOpacity) {
    code += `static const uint8_t ${prefix}_obj_opacity[] = { ${list(tables.objOpacity.map(o => Math.max(0, Math.min(255, Math.round(Number(o) || 0)))))} };\n`;
  }
  if (tables.objPivots) {
    code += `static const int16_t ${prefix}_obj_pivot[][2] = { ${list(tables.objPivots.map(([x, y]) => `{${x}, ${y}}`))} };\n`;
  }
  return code;
}

/**
 * C 片段：按组内已播放时间 t（毫秒）查表插值。
 * 调用处需已定义 uint16_t g、uint32_t t；片段会定义 int32_t v[4]（表的定点单位，
 * 依次是 dx、dy、旋转、缩放），bool done，以及 fade 为 true 时的 uint32_t fade（0~255）。
 */
export function emitEntranceSample(prefix: string, indent: string, fadeFrames: number): string {
  const fadeEnd = fadeFrames * 1000;
  let code = '';
  code += `${indent}uint32_t t60 = t * ${ENTRANCE_FPS}U;\n`;
  code += `${indent}uint32_t f = t60 / 1000U;\n`;
  code += `${indent}int32_t v[4] = {0, 0, 0, 0};\n`;
  code += `${indent}bool done = (f + 1U >= ${prefix}_frames[g]);\n`;
  code += `${indent}if (!done)\n`;
  code += `${indent}{\n`;
  code += `${indent}    const int16_t (*track)[4] = ${prefix}_tracks[g];\n`;
  code += `${indent}    int32_t frac = (int32_t)(t60 % 1000U);\n`;
  code += `${indent}    for (uint16_t c = 0; c < 4U; c++)\n`;
  code += `${indent}    {\n`;
  code += `${indent}        v[c] = track[f][c] + (track[f + 1U][c] - track[f][c]) * frac / 1000;\n`;
  code += `${indent}    }\n`;
  code += `${indent}}\n`;
  if (fadeFrames > 0) {
    code += `${indent}uint32_t fade = (done || t60 >= ${fadeEnd}U) ? 255U : t60 * 255U / ${fadeEnd}U;\n`;
  }
  return code;
}
