import { Component } from '../types';
import { t } from '../i18n';

/**
 * 菜单项定义
 */
export interface MenuItem {
  id: string;
  label: string | ((component: Component) => string);
  icon?: string;
  danger?: boolean;
  dividerAfter?: boolean;
}

/**
 * 通用菜单项
 */
const commonMenuItems: MenuItem[] = [
  { id: 'gotoSlot', label: '跳转到槽函数', dividerAfter: true },
  { id: 'copyForAI', label: '复制给 AI', dividerAfter: true },
  { id: 'bringToFront', label: '置于顶层' },
  { id: 'sendToBack', label: '置于底层' },
  { id: 'bringForward', label: '上移一层' },
  { id: 'sendBackward', label: '下移一层', dividerAfter: true },
  { id: 'lock', label: (c) => c.locked ? '解锁' : '锁定' },
  { id: 'delete', label: '删除', danger: true },
  { id: 'deleteSelected', label: '删除选中的组件', danger: true },
];

/**
 * 菜单项配置（按组件类型）
 * 如果没有特定配置，使用通用菜单
 */
const menuItemsByType: Record<string, MenuItem[]> = {
  // 所有组件使用通用菜单
};

/**
 * 获取组件的菜单项
 */
export function getMenuItems(
  componentType: string, 
  _hasClipboard: boolean = false,
  multiSelectCount: number = 1
): MenuItem[] {
  const items = menuItemsByType[componentType] || commonMenuItems;
  
  // 如果是多选，将"删除"改为"deleteSelected"以便触发批量删除逻辑
  if (multiSelectCount > 1) {
    return items.map(item => {
      if (item.id === 'delete') {
        return { ...item, id: 'deleteSelected' };
      }
      return item;
    }).filter(item => item.id !== 'deleteSelected' || multiSelectCount > 1);
  }
  
  // 单选时，隐藏"deleteSelected"菜单项
  return items.filter(item => item.id !== 'deleteSelected');
}

/**
 * 获取菜单项的显示文本
 */
export function getMenuItemLabel(item: MenuItem, component: Component): string {
  return typeof item.label === 'function' ? item.label(component) : item.label;
}
