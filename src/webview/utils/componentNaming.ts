import { Component } from '../types';

/**
 * 控件类型缩写映射表
 */
const TYPE_ABBREVIATIONS: Record<string, string> = {
  hg_button: 'btn',
  hg_label: 'lbl',
  hg_time_label: 'tm_lbl',
  hg_timer_label: 'tmr_lbl',
  hg_input: 'inp',
  hg_image: 'img',
  hg_checkbox: 'chk',
  hg_radio: 'rdo',
  hg_view: 'view',
  hg_window: 'win',
  hg_canvas: 'cvs',
  hg_list: 'lst',
  hg_list_item: 'li',
  hg_video: 'vid',
  hg_gif: 'gif',
  hg_3d: 'l3d',
  hg_arc: 'arc',
  hg_circle: 'cir',
  hg_rect: 'rect',
  hg_svg: 'svg',
  hg_lottie: 'lot',
  hg_glass: 'gls',
  hg_particle: 'ptcl',
  hg_menu_cellular: 'menu_cell',
};

/**
 * 获取控件类型的缩写
 */
export function getTypeAbbreviation(type: string): string {
  return TYPE_ABBREVIATIONS[type] || type.replace('hg_', '');
}

/**
 * 在给定值列表中，找到 `缩写_N` 模式的最大编号并返回下一个
 */
function nextNumber(abbr: string, values: string[]): number {
  const pattern = new RegExp(`^${abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)$`);
  let maxNum = 0;
  for (const v of values) {
    const match = v.match(pattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) {
        maxNum = num;
      }
    }
  }
  return maxNum + 1;
}

/**
 * 根据控件类型和已有控件列表，生成递增编号的控件名称
 * 例如：btn_1, btn_2, img_1, view_1
 * @param extraNames 其他 HML 文件中已使用的名称列表（跨文件去重）
 */
export function generateComponentName(type: string, components: Component[], extraNames?: string[]): string {
  const abbr = getTypeAbbreviation(type);
  const allNames = components.map(c => c.name);
  if (extraNames) {
    allNames.push(...extraNames);
  }
  return `${abbr}_${nextNumber(abbr, allNames)}`;
}

/**
 * 根据控件类型和已有控件列表，生成递增编号的控件 ID
 * 例如：btn_1, btn_2, img_1, view_1
 * @param extraIds 其他 HML 文件中已使用的 ID 列表（跨文件去重）
 */
export function generateComponentId(type: string, components: Component[], extraIds?: string[]): string {
  const abbr = getTypeAbbreviation(type);
  const allIds = components.map(c => c.id);
  if (extraIds) {
    allIds.push(...extraIds);
  }
  return `${abbr}_${nextNumber(abbr, allIds)}`;
}
