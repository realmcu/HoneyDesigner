/**
 * Clipboard Slice
 * 复制/剪切/粘贴（单选与多选）
 * 从 store.ts 逐字搬运对应 action，行为保持不变
 */

import type { StateCreator } from 'zustand';
import { Component } from '../../types';
import { generateComponentId } from '../../utils/componentNaming';
import { isDropTargetType } from '../../utils/componentUtils';
import { getVscodeAPI } from '../shared';
import type { DesignerStore } from '../types';

export const createClipboardSlice: StateCreator<DesignerStore, [], [], Partial<DesignerStore>> = (set, get) => ({
  // Clipboard operations
  copyComponent: (id) => {
    const { components } = get();
    const component = components.find((c) => c.id === id);
    if (!component) return;

    // 禁止复制列表项
    if (component.type === 'hg_list_item') {
      if (getVscodeAPI()) {
        getVscodeAPI()!.postMessage({
          command: 'showInfo',
          text: '列表项不支持复制或剪切操作'
        });
      }
      return;
    }

    // 递归获取所有子组件
    const getAllChildren = (parentId: string): Component[] => {
      const children = components.filter(c => c.parent === parentId);
      const result: Component[] = [...children];
      children.forEach(child => {
        result.push(...getAllChildren(child.id));
      });
      return result;
    };

    // 收集组件及其所有子组件
    const allComponents = [component, ...getAllChildren(component.id)];

    // 如果有子组件，使用 clipboardMultiple；否则使用 clipboard
    if (allComponents.length > 1) {
      set({ clipboardMultiple: allComponents, clipboard: null });
    } else {
      set({ clipboard: component, clipboardMultiple: [] });
    }
  },

  cutComponent: (id) => {
    const component = get().components.find((c) => c.id === id);
    if (!component) return;

    // 禁止剪切列表项
    if (component.type === 'hg_list_item') {
      if (getVscodeAPI()) {
        getVscodeAPI()!.postMessage({
          command: 'showInfo',
          text: '列表项不支持复制或剪切操作'
        });
      }
      return;
    }

    get().copyComponent(id);
    get().removeComponent(id);
  },

  pasteComponent: (position) => {
    const { clipboard, clipboardMultiple, components, selectedComponent } = get();

    // 根据当前选中组件确定粘贴目标父容器
    const resolveTargetParent = (): string | null => {
      // 如果粘贴的是 view，强制放到画布根级别
      const topLevelClipboard = clipboardMultiple.length > 0
        ? clipboardMultiple.find(c => !c.parent || !clipboardMultiple.some(p => p.id === c.parent))
        : clipboard;
      if (topLevelClipboard && topLevelClipboard.type === 'hg_view') return null;

      if (!selectedComponent) return null;
      const selected = components.find(c => c.id === selectedComponent);
      if (!selected) return null;
      // 选中的是容器 → 粘贴为其子组件
      if (isDropTargetType(selected.type)) return selected.id;
      // 选中的不是容器 → 粘贴到其父组件下
      return selected.parent || null;
    };
    const targetParent = resolveTargetParent();

    // 多选粘贴
    if (clipboardMultiple.length > 0) {
      const newIds: string[] = [];

      // 创建旧ID到新ID的映射表（两阶段：先非 list_item，再 list_item）
      const idMap = new Map<string, string>();
      let trackingComponents = [...components];

      // 阶段1：为非 list_item 组件生成新 ID
      clipboardMultiple.forEach((comp) => {
        if (comp.type === 'hg_list_item') return;
        const newId = generateComponentId(comp.type, trackingComponents, get().otherFileComponentIds);
        idMap.set(comp.id, newId);
        trackingComponents.push({ ...comp, id: newId } as Component);
      });

      // 阶段2：为 list_item 组件生成 {newListId}_item_{index} 格式的 ID
      clipboardMultiple.forEach((comp) => {
        if (comp.type !== 'hg_list_item') return;
        const newParentId = comp.parent ? (idMap.get(comp.parent) || comp.parent) : '';
        const itemIndex = comp.data?.index ?? 0;
        let newItemId = `${newParentId}_item_${itemIndex}`;
        let suffix = itemIndex as number;
        while (trackingComponents.some(c => c.id === newItemId)) {
          suffix++;
          newItemId = `${newParentId}_item_${suffix}`;
        }
        idMap.set(comp.id, newItemId);
        trackingComponents.push({ ...comp, id: newItemId } as Component);
      });

      // 找出所有顶层组件（没有父组件或父组件不在复制列表中）
      const topLevelComponents = clipboardMultiple.filter(comp =>
        !comp.parent || !idMap.has(comp.parent)
      );

      // 计算顶层组件的边界框
      const minX = Math.min(...topLevelComponents.map(c => c.position.x));
      const minY = Math.min(...topLevelComponents.map(c => c.position.y));

      clipboardMultiple.forEach((comp, index) => {
        const newId = idMap.get(comp.id)!;
        const isTopLevel = !comp.parent || !idMap.has(comp.parent);

        // 确定父组件
        let newParent: string | null = null;
        if (comp.parent) {
          if (idMap.has(comp.parent)) {
            // 父组件在复制列表中，使用新 ID
            newParent = idMap.get(comp.parent)!;
          } else if (isTopLevel) {
            // 顶层组件：使用目标父容器
            newParent = targetParent;
          }
        } else if (isTopLevel) {
          newParent = targetParent;
        }

        // 不预设 children，由 addComponent 在添加子组件时自动构建

        // 计算新位置
        let newPosition;
        if (!isTopLevel) {
          // 子组件：保持相对于父组件的原始位置
          newPosition = {
            x: comp.position.x,
            y: comp.position.y,
            width: comp.position.width,
            height: comp.position.height,
          };
        } else {
          // 顶层组件：应用偏移量
          const offsetX = comp.position.x - minX;
          const offsetY = comp.position.y - minY;

          newPosition = position ? {
            x: position.x + offsetX,
            y: position.y + offsetY,
            width: comp.position.width,
            height: comp.position.height,
          } : {
            x: 20 + offsetX,
            y: 20 + offsetY,
            width: comp.position.width,
            height: comp.position.height,
          };
        }

        const newComponent: Component = {
          ...comp,
          id: newId,
          name: newId,
          parent: newParent,
          children: [],
          position: newPosition,
        };

        get().addComponent(newComponent);
        newIds.push(newComponent.id);
      });

      get().setSelectedComponents(newIds);
      return;
    }

    // 单选粘贴
    if (!clipboard) return;

    const newId = generateComponentId(clipboard.type, components, get().otherFileComponentIds);
    const newComponent: Component = {
      ...clipboard,
      id: newId,
      name: newId,
      parent: targetParent,
      children: [],
      position: position ? {
        x: position.x,
        y: position.y,
        width: clipboard.position.width,
        height: clipboard.position.height,
      } : {
        x: 20,
        y: 20,
        width: clipboard.position.width,
        height: clipboard.position.height,
      },
    };

    get().addComponent(newComponent);
    get().selectComponent(newComponent.id);
  },

  copySelectedComponents: () => {
    const { selectedComponents, components } = get();
    if (!selectedComponents.length) return;

    // 获取所有选中的组件（排除列表项）
    const directlySelected = components.filter((c) =>
      selectedComponents.includes(c.id) && c.type !== 'hg_list_item'
    );

    if (directlySelected.length === 0) {
      if (getVscodeAPI()) {
        getVscodeAPI()!.postMessage({
          command: 'showInfo',
          text: '列表项不支持复制或剪切操作'
        });
      }
      return;
    }

    // 递归获取所有子组件
    const getAllChildren = (parentId: string): Component[] => {
      const children = components.filter(c => c.parent === parentId);
      const result: Component[] = [...children];
      children.forEach(child => {
        result.push(...getAllChildren(child.id));
      });
      return result;
    };

    // 收集所有需要复制的组件（包括子组件）
    const componentsToCopy = new Set<Component>(directlySelected);
    directlySelected.forEach(comp => {
      const children = getAllChildren(comp.id);
      children.forEach(child => componentsToCopy.add(child));
    });

    // 按照层级顺序排序（父组件在前，子组件在后）
    const sortedComponents = Array.from(componentsToCopy).sort((a, b) => {
      // 如果 a 是 b 的祖先，a 应该在前
      let current: Component | undefined = b;
      while (current) {
        if (current.parent === a.id) return -1;
        current = components.find(c => c.id === current!.parent);
      }
      // 如果 b 是 a 的祖先，b 应该在前
      current = a;
      while (current) {
        if (current.parent === b.id) return 1;
        current = components.find(c => c.id === current!.parent);
      }
      return 0;
    });

    set({ clipboardMultiple: sortedComponents, clipboard: null });
  },

  cutSelectedComponents: () => {
    const { selectedComponents, components } = get();
    if (!selectedComponents.length) return;

    const componentsToCut = components.filter((c) =>
      selectedComponents.includes(c.id) && c.type !== 'hg_list_item'
    );

    if (componentsToCut.length === 0) {
      if (getVscodeAPI()) {
        getVscodeAPI()!.postMessage({
          command: 'showInfo',
          text: '列表项不支持复制或剪切操作'
        });
      }
      return;
    }

    get().copySelectedComponents();
    componentsToCut.forEach((c) => get().removeComponent(c.id));
  },
});
