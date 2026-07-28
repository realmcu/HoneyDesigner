/**
 * Alignment Slice
 * 对齐/分布/统一尺寸
 * 从 store.ts 逐字搬运对应 action，行为保持不变
 */

import type { StateCreator } from 'zustand';
import {
  alignComponents,
  distributeComponents,
  resizeComponents,
  AlignType,
  DistributeType,
  ResizeType
} from '../../utils/alignmentUtils';
import { getVscodeAPI } from '../shared';
import type { DesignerStore } from '../types';

export const createAlignmentSlice: StateCreator<DesignerStore, [], [], Partial<DesignerStore>> = (set, get) => ({
  // ============ 对齐操作 ============

  alignSelectedComponents: (type: AlignType) => {
    const { selectedComponents, components, updateComponent } = get();

    if (selectedComponents.length < 2) {
      if (getVscodeAPI()) {
        getVscodeAPI()!.postMessage({
          command: 'showInfo',
          text: '请至少选择 2 个组件进行对齐'
        });
      }
      return;
    }

    const selected = components.filter((c) => selectedComponents.includes(c.id));

    // 检查是否所有组件都在同一父容器
    // 特殊处理：如果父容器都是 list_item，检查它们是否属于同一个 list
    const parents = selected.map((c) => c.parent);
    const uniqueParents = new Set(parents);

    if (uniqueParents.size > 1) {
      // 检查是否所有父容器都是 list_item，且属于同一个 list
      const parentComponents = parents
        .map(parentId => components.find(c => c.id === parentId))
        .filter(p => p !== undefined) as import('../../types').Component[];

      const allParentsAreListItems = parentComponents.every(p => p.type === 'hg_list_item');

      if (allParentsAreListItems) {
        // 检查所有 list_item 是否属于同一个 list
        const listParents = new Set(parentComponents.map(p => p.parent));
        if (listParents.size !== 1) {
          if (getVscodeAPI()) {
            getVscodeAPI()!.postMessage({
              command: 'showInfo',
              text: '只能对齐同一 list 控件内的组件'
            });
          }
          return;
        }
        // 属于同一个 list，允许对齐
      } else {
        // 不是 list_item 的情况，必须在同一父容器
        if (getVscodeAPI()) {
          getVscodeAPI()!.postMessage({
            command: 'showInfo',
            text: '只能对齐同一容器内的组件'
          });
        }
        return;
      }
    }

    // 重新排序：将最后选中的组件放在第一位（作为参考）
    const lastSelectedId = selectedComponents[selectedComponents.length - 1];
    const reordered = [
      ...selected.filter(c => c.id === lastSelectedId),
      ...selected.filter(c => c.id !== lastSelectedId)
    ];

    const updates = alignComponents(reordered, type);

    // 直接批量更新组件位置，避免触发几何控件的尺寸自动调整
    set((state) => {
      const newComponents = state.components.map((comp) => {
        const update = updates.find(u => u.id === comp.id);
        if (update && Object.keys(update.position).length > 0) {
          return {
            ...comp,
            position: { ...comp.position, ...update.position }
          };
        }
        return comp;
      });
      return { components: newComponents };
    });

    // 保存到文件
    get().saveToFile();
  },

  distributeSelectedComponents: (type: DistributeType) => {
    const { selectedComponents, components, updateComponent } = get();
    if (selectedComponents.length < 3) {
      if (getVscodeAPI()) {
        getVscodeAPI()!.postMessage({
          command: 'showInfo',
          text: '请至少选择 3 个组件进行分布'
        });
      }
      return;
    }

    const selected = components.filter((c) => selectedComponents.includes(c.id));

    // 检查是否所有组件都在同一父容器
    const parents = new Set(selected.map((c) => c.parent));
    if (parents.size > 1) {
      if (getVscodeAPI()) {
        getVscodeAPI()!.postMessage({
          command: 'showInfo',
          text: '只能分布同一容器内的组件'
        });
      }
      return;
    }

    const updates = distributeComponents(selected, type);

    updates.forEach(({ id, position }) => {
      if (Object.keys(position).length > 0) {
        const comp = components.find((c) => c.id === id);
        if (comp) {
          updateComponent(id, {
            position: { ...comp.position, ...position }
          });
        }
      }
    });
  },

  resizeSelectedComponents: (type: ResizeType) => {
    const { selectedComponents, components, updateComponent } = get();
    if (selectedComponents.length < 2) {
      if (getVscodeAPI()) {
        getVscodeAPI()!.postMessage({
          command: 'showInfo',
          text: '请至少选择 2 个组件进行尺寸调整'
        });
      }
      return;
    }

    const selected = components.filter((c) => selectedComponents.includes(c.id));

    // 尺寸调整不需要同一父容器限制
    const updates = resizeComponents(selected, type, 'first');

    updates.forEach(({ id, position }) => {
      if (Object.keys(position).length > 0) {
        const comp = components.find((c) => c.id === id);
        if (comp) {
          updateComponent(id, {
            position: { ...comp.position, ...position }
          });
        }
      }
    });
  },
});
