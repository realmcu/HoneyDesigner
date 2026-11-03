import { Component } from '../types';
import { t, LocaleKey } from '../i18n';

/**
 * 菜单项定义
 */
export interface MenuItem {
  id: string;
  /** 字符串为 i18n key；函数返回已翻译文本 */
  label: LocaleKey | ((component: Component) => string);
  icon?: string;
  danger?: boolean;
  dividerAfter?: boolean;
}

/**
 * 通用菜单项
 */
const commonMenuItems: MenuItem[] = [
  { id: 'gotoSlot', label: 'Go to Slot Function', dividerAfter: true },
  { id: 'copyForAI', label: 'Copy for AI', dividerAfter: true },
  { id: 'bringToFront', label: 'Bring to Front' },
  { id: 'sendToBack', label: 'Send to Back' },
  { id: 'bringForward', label: 'Bring Forward' },
  { id: 'sendBackward', label: 'Send Backward', dividerAfter: true },
  { id: 'lock', label: (c) => c.locked ? t('Unlock') : t('Lock') },
  { id: 'delete', label: 'Delete', danger: true },
  { id: 'deleteSelected', label: 'Delete Selected Components', danger: true },
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
 * 字符串 label 是 i18n key，函数 label 自行返回已翻译文本
 */
export function getMenuItemLabel(item: MenuItem, component: Component): string {
  return typeof item.label === 'function' ? item.label(component) : t(item.label);
}
