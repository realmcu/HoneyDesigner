import { Component } from '../types';
import { t } from '../i18n';

/**
 * 菜单动作处理器类型
 */
export type MenuActionHandler = (
  component: Component,
  helpers: MenuActionHelpers
) => void;

/**
 * 菜单动作辅助函数
 */
export interface MenuActionHelpers {
  updateComponent: (id: string, updates: Partial<Component>) => void;
  removeComponent: (id: string) => void;
  removeComponents: (ids: string[]) => void;
  selectComponent: (id: string | null) => void;
  moveComponentLayer: (id: string, direction: 'up' | 'down' | 'top' | 'bottom') => void;
  copyComponent: (id: string) => void;
  cutComponent: (id: string) => void;
  pasteComponent: (position?: { x: number; y: number }) => void;
  duplicateComponent: (id: string) => void;
  copySelectedComponents: () => void;
  cutSelectedComponents: () => void;
  alignSelectedComponents: (type: 'left' | 'right' | 'top' | 'bottom' | 'centerH' | 'centerV') => void;
  postMessage: (message: any) => void;
  selectedComponents: string[];
}

/**
 * 菜单动作处理器映射
 */
const actionHandlers: Record<string, MenuActionHandler> = {
  gotoSlot: (component, { postMessage }) => {
    postMessage({
      command: 'gotoSlot',
      componentId: component.id,
      componentType: component.type,
      componentName: component.name || component.id,
    });
  },

  delete: (component, { removeComponent, selectComponent, postMessage }) => {
    // 禁止删除列表项
    if (component.type === 'hg_list_item') {
      postMessage({
        command: 'showInfo',
        text: t('List items are managed by the parent list; adjust its Item Count property')
      });
      return;
    }
    
    removeComponent(component.id);
    selectComponent(null);
  },

  copy: (component, { copyComponent }) => {
    copyComponent(component.id);
  },

  cut: (component, { cutComponent }) => {
    cutComponent(component.id);
  },

  paste: (component, { pasteComponent }) => {
    pasteComponent();
  },

  duplicate: (component, { duplicateComponent }) => {
    duplicateComponent(component.id);
  },

  lock: (component, { updateComponent }) => {
    updateComponent(component.id, { locked: !component.locked });
  },

  bringToFront: (component, { moveComponentLayer }) => {
    moveComponentLayer(component.id, 'top');
  },

  sendToBack: (component, { moveComponentLayer }) => {
    moveComponentLayer(component.id, 'bottom');
  },

  bringForward: (component, { moveComponentLayer }) => {
    moveComponentLayer(component.id, 'up');
  },

  sendBackward: (component, { moveComponentLayer }) => {
    moveComponentLayer(component.id, 'down');
  },

  // 对齐操作
  alignLeft: (_, { alignSelectedComponents }) => {
    alignSelectedComponents('left');
  },

  alignRight: (_, { alignSelectedComponents }) => {
    alignSelectedComponents('right');
  },

  alignTop: (_, { alignSelectedComponents }) => {
    alignSelectedComponents('top');
  },

  alignBottom: (_, { alignSelectedComponents }) => {
    alignSelectedComponents('bottom');
  },

  alignCenterH: (_, { alignSelectedComponents }) => {
    alignSelectedComponents('centerH');
  },

  alignCenterV: (_, { alignSelectedComponents }) => {
    alignSelectedComponents('centerV');
  },

  // 删除选中的多个组件
  deleteSelected: (_, { removeComponents, selectComponent, selectedComponents }) => {
    if (selectedComponents.length > 0) {
      removeComponents(selectedComponents);
      selectComponent(null);
    }
  },
};

/**
 * 执行菜单动作
 */
export function executeMenuAction(
  actionId: string,
  component: Component,
  helpers: MenuActionHelpers
): void {
  const handler = actionHandlers[actionId];
  if (handler) {
    handler(component, helpers);
  } else {
    console.warn(`Unknown menu action: ${actionId}`);
  }
}
