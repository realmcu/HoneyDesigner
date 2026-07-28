/**
 * Selection Slice
 * 组件选中/多选/悬停/拖拽标记
 * 从 store.ts 逐字搬运对应 action，行为保持不变
 */

import type { StateCreator } from 'zustand';
import type { DesignerStore } from '../types';

export const createSelectionSlice: StateCreator<DesignerStore, [], [], Partial<DesignerStore>> = (set, get) => ({
  selectComponent: (id) => {
    set({ selectedComponent: id, selectedComponents: id ? [id] : [], selectedAsset: id ? null : get().selectedAsset });
    // 保存选中状态
    get().saveViewState();
  },
  setSelectedComponents: (ids) => set({ selectedComponents: ids, selectedComponent: ids.length ? ids[0] : null, selectedAsset: ids.length ? null : get().selectedAsset }),
  addToSelection: (id) => {
    const current = get().selectedComponents;
    if (!current.includes(id)) set({ selectedComponents: [...current, id] });
  },
  removeFromSelection: (id) => {
    const current = get().selectedComponents;
    set({ selectedComponents: current.filter(i => i !== id) });
  },
  clearSelection: () => set({ selectedComponents: [], selectedComponent: null }),
  setHoveredComponent: (id) => set({ hoveredComponent: id }),
  setDraggedComponent: (id) => set({ draggedComponent: id }),
});
