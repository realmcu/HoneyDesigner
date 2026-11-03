/**
 * 对齐和分布工具类
 * 
 * 提供组件对齐、分布、尺寸调整等布局功能
 * 设计原则：
 * 1. 纯函数，无副作用
 * 2. 返回新的位置数据，不直接修改组件
 * 3. 支持扩展新的对齐方式
 */

import { Component, ComponentPosition } from '../types';
import type { LocaleKey } from '../i18n';

/**
 * 对齐类型
 */
export type AlignType = 
  | 'left'      // 左对齐
  | 'right'     // 右对齐
  | 'top'       // 顶对齐
  | 'bottom'    // 底对齐
  | 'centerH'   // 水平居中
  | 'centerV';  // 垂直居中

/**
 * 分布类型
 */
export type DistributeType = 
  | 'horizontal'  // 水平均匀分布
  | 'vertical';   // 垂直均匀分布

/**
 * 尺寸调整类型
 */
export type ResizeType = 
  | 'sameWidth'   // 等宽
  | 'sameHeight'  // 等高
  | 'sameSize';   // 等大小

/**
 * 位置更新结果
 */
export interface PositionUpdate {
  id: string;
  position: Partial<ComponentPosition>;
}

/**
 * 边界框
 */
interface BoundingBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

/**
 * 计算组件的边界框
 */
function getBoundingBox(component: Component): BoundingBox {
  const { x, y, width, height } = component.position;
  
  // 使用矩形框中心作为对齐参考点
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  
  return {
    left: x,
    right: x + width,
    top: y,
    bottom: y + height,
    centerX,
    centerY,
    width,
    height,
  };
}

/**
 * 对齐组件
 * 
 * @param components 要对齐的组件列表（至少2个）
 * @param type 对齐类型
 * @returns 位置更新列表
 */
export function alignComponents(
  components: Component[],
  type: AlignType
): PositionUpdate[] {
  if (components.length < 2) {
    return [];
  }

  // 使用第一个组件作为对齐参考
  const refComp = components[0];
  const referenceBox = getBoundingBox(refComp);
  
  return components.map((component, index) => {
    // 第一个组件不动
    if (index === 0) {
      return { id: component.id, position: {} };
    }
    
    const box = getBoundingBox(component);
    const oldX = component.position.x;
    const oldY = component.position.y;
    let newX = oldX;
    let newY = oldY;

    switch (type) {
      case 'left':
        newX = referenceBox.left;
        break;
      case 'right':
        newX = referenceBox.right - box.width;
        break;
      case 'top':
        newY = referenceBox.top;
        break;
      case 'bottom':
        newY = referenceBox.bottom - box.height;
        break;
      case 'centerH':
        // 对齐到参考组件的中心 X
        newX = referenceBox.centerX - box.width / 2;
        break;
      case 'centerV':
        // 对齐到参考组件的中心 Y
        newY = referenceBox.centerY - box.height / 2;
        break;
    }

    // 只返回需要修改的属性
    const position: Partial<ComponentPosition> = {};
    if (Math.round(newX) !== oldX) {
      position.x = Math.round(newX);
    }
    if (Math.round(newY) !== oldY) {
      position.y = Math.round(newY);
    }
    
    return {
      id: component.id,
      position,
    };
  }).filter(update => Object.keys(update.position).length > 0);
}

/**
 * 分布组件
 * 
 * @param components 要分布的组件列表（至少3个）
 * @param type 分布类型
 * @returns 位置更新列表
 */
export function distributeComponents(
  components: Component[],
  type: DistributeType
): PositionUpdate[] {
  if (components.length < 3) {
    return [];
  }

  const isHorizontal = type === 'horizontal';
  
  // 按位置排序
  const sorted = [...components].sort((a, b) => {
    return isHorizontal 
      ? a.position.x - b.position.x 
      : a.position.y - b.position.y;
  });

  // 计算总空间和组件总尺寸
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  
  const totalSpace = isHorizontal
    ? (last.position.x + last.position.width) - first.position.x
    : (last.position.y + last.position.height) - first.position.y;
  
  const totalComponentSize = sorted.reduce((sum, c) => {
    return sum + (isHorizontal ? c.position.width : c.position.height);
  }, 0);

  // 计算间距
  const gap = (totalSpace - totalComponentSize) / (sorted.length - 1);

  // 计算新位置（首尾不动）
  let currentPos = isHorizontal ? first.position.x : first.position.y;
  
  return sorted.map((component, index) => {
    const size = isHorizontal ? component.position.width : component.position.height;
    
    if (index === 0) {
      currentPos += size + gap;
      return { id: component.id, position: {} }; // 首个不动
    }
    
    if (index === sorted.length - 1) {
      return { id: component.id, position: {} }; // 末个不动
    }

    const newPos = Math.round(currentPos);
    currentPos += size + gap;

    return {
      id: component.id,
      position: isHorizontal ? { x: newPos } : { y: newPos },
    };
  }).filter(update => Object.keys(update.position).length > 0);
}

/**
 * 调整组件尺寸
 * 
 * @param components 要调整的组件列表（至少2个）
 * @param type 调整类型
 * @param reference 参考方式：'first' 以第一个为准，'max' 以最大为准，'min' 以最小为准
 * @returns 位置更新列表
 */
export function resizeComponents(
  components: Component[],
  type: ResizeType,
  reference: 'first' | 'max' | 'min' = 'first'
): PositionUpdate[] {
  if (components.length < 2) {
    return [];
  }

  // 确定参考尺寸
  let refWidth: number;
  let refHeight: number;

  if (reference === 'first') {
    refWidth = components[0].position.width;
    refHeight = components[0].position.height;
  } else if (reference === 'max') {
    refWidth = Math.max(...components.map(c => c.position.width));
    refHeight = Math.max(...components.map(c => c.position.height));
  } else {
    refWidth = Math.min(...components.map(c => c.position.width));
    refHeight = Math.min(...components.map(c => c.position.height));
  }

  return components.map(component => {
    const updates: Partial<ComponentPosition> = {};

    if (type === 'sameWidth' || type === 'sameSize') {
      updates.width = refWidth;
    }
    if (type === 'sameHeight' || type === 'sameSize') {
      updates.height = refHeight;
    }

    return { id: component.id, position: updates };
  });
}

/**
 * 对齐功能配置
 */
export interface AlignmentConfig {
  type: AlignType | DistributeType | ResizeType;
  labelKey: LocaleKey;
  icon?: string;
  shortcut?: string;
  minComponents: number;
  category: 'align' | 'distribute' | 'resize';
}

/**
 * 所有对齐功能的配置
 */
export const ALIGNMENT_CONFIGS: AlignmentConfig[] = [
  // 对齐
  { type: 'left', labelKey: 'Align Left', shortcut: 'Ctrl+Shift+L', minComponents: 2, category: 'align' },
  { type: 'right', labelKey: 'Align Right', shortcut: 'Ctrl+Shift+R', minComponents: 2, category: 'align' },
  { type: 'top', labelKey: 'Align Top', shortcut: 'Ctrl+Shift+T', minComponents: 2, category: 'align' },
  { type: 'bottom', labelKey: 'Align Bottom', shortcut: 'Ctrl+Shift+B', minComponents: 2, category: 'align' },
  { type: 'centerH', labelKey: 'Align Center', shortcut: 'Ctrl+Shift+H', minComponents: 2, category: 'align' },
  { type: 'centerV', labelKey: 'Align Middle', shortcut: 'Ctrl+Shift+V', minComponents: 2, category: 'align' },
  // 分布
  { type: 'horizontal', labelKey: 'Distribute Horizontally', shortcut: 'Ctrl+Shift+D', minComponents: 3, category: 'distribute' },
  { type: 'vertical', labelKey: 'Distribute Vertically', shortcut: 'Ctrl+Alt+D', minComponents: 3, category: 'distribute' },
  // 尺寸
  { type: 'sameWidth', labelKey: 'Same Width', minComponents: 2, category: 'resize' },
  { type: 'sameHeight', labelKey: 'Same Height', minComponents: 2, category: 'resize' },
  { type: 'sameSize', labelKey: 'Same Size', minComponents: 2, category: 'resize' },
];

/**
 * 根据类型获取配置
 */
export function getAlignmentConfig(type: string): AlignmentConfig | undefined {
  return ALIGNMENT_CONFIGS.find(c => c.type === type);
}

/**
 * 获取某分类的所有配置
 */
export function getAlignmentConfigsByCategory(category: 'align' | 'distribute' | 'resize'): AlignmentConfig[] {
  return ALIGNMENT_CONFIGS.filter(c => c.category === category);
}
