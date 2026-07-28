/**
 * Store 纯辅助函数与视图状态持久化
 * 从 store.ts 逐字搬运，行为保持不变
 */

import { Component } from '../types';
import { generateComponentId } from '../utils/componentNaming';

// ============ 层级调整辅助函数 ============

export type LayerDirection = 'up' | 'down' | 'top' | 'bottom';

/**
 * 计算组件在同级中的新索引
 */
export function calculateNewIndex(currentIndex: number, direction: LayerDirection, maxIndex: number): number {
  switch (direction) {
    case 'up':    return Math.min(currentIndex + 1, maxIndex);
    case 'down':  return Math.max(currentIndex - 1, 0);
    case 'top':   return maxIndex;
    case 'bottom': return 0;
  }
}

/**
 * 重新排列数组中的元素
 */
export function reorderArray<T>(arr: T[], fromIndex: number, toIndex: number): T[] {
  const result = [...arr];
  const [moved] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, moved);
  return result;
}

/**
 * 重建 components 数组，应用新的同级组件顺序
 */
export function rebuildComponentsArray(
  components: Component[],
  reorderedSiblings: Component[],
  parentId: string | null | undefined
): Component[] {
  const siblingIds = new Set(reorderedSiblings.map(s => s.id));
  const newChildrenOrder = reorderedSiblings.map(s => s.id);

  // 更新重排后的同级组件的 zIndex（按新顺序分配 zIndex）
  const reorderedSiblingsWithZIndex = reorderedSiblings.map((sibling, index) => ({
    ...sibling,
    zIndex: index
  }));

  const result: Component[] = [];
  let siblingsInserted = false;

  for (const comp of components) {
    if (siblingIds.has(comp.id)) {
      // 遇到第一个同级组件时，插入所有重排后的同级组件（已更新 zIndex）
      if (!siblingsInserted) {
        result.push(...reorderedSiblingsWithZIndex);
        siblingsInserted = true;
      }
      // 跳过原来的同级组件（已在上面插入）
    } else if (parentId && comp.id === parentId) {
      // 更新父组件的 children 数组顺序
      result.push({ ...comp, children: newChildrenOrder });
    } else {
      result.push(comp);
    }
  }

  return result;
}

// ============ 辅助函数：深度克隆组件 ============

/**
 * 递归收集组件树中所有组件
 */
export function collectTree(components: Component[], root: Component): Component[] {
  const result: Component[] = [root];
  if (root.children) {
    for (const childId of root.children) {
      const child = components.find(c => c.id === childId);
      if (child) {
        result.push(...collectTree(components, child));
      }
    }
  }
  return result;
}

/**
 * 递归克隆组件树（包括所有子组件）
 * 使用 ID 映射方式生成新的缩写+编号 ID
 * @param components 所有组件数组
 * @param rootComponent 要克隆的根组件
 * @param allComponents 当前所有组件（用于生成唯一ID）
 * @param extraIds 其他文件中的组件ID（跨文件去重）
 * @returns 克隆后的组件数组（包括根组件和所有子组件）
 */
export function cloneComponentTree(components: Component[], rootComponent: Component, allComponents: Component[], extraIds?: string[]): Component[] {
  const toClone = collectTree(components, rootComponent);

  // 第一步：为所有组件生成新 ID，并建立映射
  const idMap = new Map<string, string>();
  let trackingComponents = [...allComponents];
  for (const comp of toClone) {
    const newId = generateComponentId(comp.type, trackingComponents, extraIds);
    idMap.set(comp.id, newId);
    trackingComponents.push({ ...comp, id: newId } as Component);
  }

  // 第二步：用映射后的 ID 创建克隆组件
  return toClone.map(comp => ({
    ...comp,
    id: idMap.get(comp.id)!,
    name: idMap.get(comp.id)!,
    children: comp.children?.map(childId => idMap.get(childId) || childId),
    parent: comp.parent ? (idMap.get(comp.parent) || comp.parent) : comp.parent,
  }));
}

// 解析分辨率字符串
export const parseResolutionStr = (res?: string): { width: number; height: number } => {
  if (!res) return { width: 800, height: 480 };
  const parts = res.split('X');
  return {
    width: parseInt(parts[0]) || 800,
    height: parseInt(parts[1]) || 480,
  };
};

// 视图状态存储（按文件路径保存）
export interface ViewState {
  zoom: number;
  canvasOffset: { x: number; y: number };
  selectedComponent: string | null;  // 选中的组件
  leftPanelTab: 'components' | 'assets' | 'tree';  // 左侧面板 Tab
  leftPanelVisible: boolean;  // 左侧面板是否可见
  rightPanelVisible: boolean;  // 右侧面板是否可见
  leftPanelWidth?: number;  // 左侧面板宽度
  rightPanelWidth?: number;  // 右侧面板宽度
}

// 使用 localStorage 持久化视图状态
export const VIEW_STATE_STORAGE_KEY = 'honeygui-designer-view-states';

export const viewStateStorage = {
  get: (filePath: string): ViewState | undefined => {
    try {
      const stored = localStorage.getItem(VIEW_STATE_STORAGE_KEY);
      if (!stored) return undefined;
      const allStates = JSON.parse(stored) as Record<string, ViewState>;
      return allStates[filePath];
    } catch (e) {
      console.error('[ViewState] 读取失败:', e);
      return undefined;
    }
  },
  set: (filePath: string, state: ViewState): void => {
    try {
      const stored = localStorage.getItem(VIEW_STATE_STORAGE_KEY);
      const allStates = stored ? JSON.parse(stored) : {};
      allStates[filePath] = state;
      localStorage.setItem(VIEW_STATE_STORAGE_KEY, JSON.stringify(allStates));
    } catch (e) {
      console.error('[ViewState] 保存失败:', e);
    }
  }
};

/**
 * RAF 防抖工具函数
 * 将高频调用合并到下一个 requestAnimationFrame 回调中执行
 * 用于缩放/平移时延迟写入 localStorage 等非关键操作
 */
export function createRafDebouncer() {
  let rafId: number | null = null;
  let pendingFn: (() => void) | null = null;
  return {
    call: (fn: () => void) => {
      pendingFn = fn;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        pendingFn?.();
        pendingFn = null;
      });
    },
    flush: () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
        pendingFn?.();
        pendingFn = null;
      }
    },
  };
}
