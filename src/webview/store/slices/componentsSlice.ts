/**
 * Components Slice
 * 组件增删改查、层级/顺序调整、list 同步等
 * 从 store.ts 逐字搬运对应 action，行为保持不变
 */

import type { StateCreator } from 'zustand';
import { Component } from '../../types';
import { generateComponentId } from '../../utils/componentNaming';
import { calculateNewIndex, reorderArray, rebuildComponentsArray, LayerDirection } from '../utils';
import { getVscodeAPI, removeComponentsImpl } from '../shared';
import type { DesignerStore } from '../types';

export const createComponentsSlice: StateCreator<DesignerStore, [], [], Partial<DesignerStore>> = (set, get) => ({
  // Actions
  setComponents: (components) => {
    // 确保至少有一个 entry view
    let newComponents = components;
    const hasEntry = components.some(c => c.type === 'hg_view' && (c.data?.entry === true || c.data?.entry === 'true'));

    if (!hasEntry && components.some(c => c.type === 'hg_view')) {
      const firstViewIndex = components.findIndex(c => c.type === 'hg_view');
      if (firstViewIndex !== -1) {
        newComponents = [...components];
        newComponents[firstViewIndex] = {
          ...newComponents[firstViewIndex],
          data: { ...newComponents[firstViewIndex].data, entry: true }
        };
      }
    }

    set({ components: newComponents });
  },

  addComponent: (component, options?: { save?: boolean }) => {
    const shouldSave = options?.save !== false; // 默认为true
    set((state) => {
      const newComponents = [...state.components];

      // 检查是否已存在相同ID的组件
      if (newComponents.some(c => c.id === component.id)) {
        return state;
      }

      // 如果是 hg_view，检查是否是第一个，设置 entry 属性
      if (component.type === 'hg_view') {
        const existingViews = newComponents.filter(c => c.type === 'hg_view');
        if (existingViews.length === 0) {
          // 第一个 hg_view，设置 entry="true"
          component.data = { ...component.data, entry: true };
        }
      }

      // 如果组件有父组件引用，需要将其添加到父组件的children数组中
      if (component.parent && typeof component.parent === 'string') {
        const parentIndex = newComponents.findIndex(comp => comp.id === component.parent);

        if (parentIndex !== -1) {
          const parentChildren = newComponents[parentIndex].children || [];
          // 使用不可变方式更新父组件的 children 数组
          if (!parentChildren.includes(component.id)) {
            newComponents[parentIndex] = {
              ...newComponents[parentIndex],
              children: [...parentChildren, component.id],
            };
          }
        }
      }

      // 添加新组件到components数组
      newComponents.push(component);

      return { components: newComponents };
    });

    // 如果是 list 控件，自动初始化 list_item 子组件
    if (component.type === 'hg_list') {
      // 使用 setTimeout 确保组件已经添加到 state 中
      setTimeout(() => {
        get().syncListItems(component.id);
      }, 0);
    }

    // 根据选项决定是否保存
    if (shouldSave) {
      get().saveToFile();
    }
  },

  updateComponent: (id, updates, options) => {
    const state = get();
    const before = state.components.find(c => c.id === id);
    if (!before) return;

    // 对于 list 控件，验证属性值
    let finalUpdates = { ...updates };

    // hg_view entry 互斥逻辑
    if (before.type === 'hg_view' && finalUpdates.data && 'entry' in finalUpdates.data) {
      const newEntry = finalUpdates.data.entry;
      if (newEntry === true || newEntry === 'true') {
        // 勾选新 entry 时，自动取消其他 hg_view 的 entry
        const updatedComponents = state.components.map(c => {
          if (c.id !== id && c.type === 'hg_view' && (c.data?.entry === true || c.data?.entry === 'true')) {
            return { ...c, data: { ...c.data, entry: false } };
          }
          return c;
        });
        set({ components: updatedComponents });
      } else if (newEntry === false || newEntry === 'false') {
        // 防止取消唯一的 entry
        const hasOtherEntry = state.components.some(c => c.id !== id && c.type === 'hg_view' && (c.data?.entry === true || c.data?.entry === 'true'));
        if (!hasOtherEntry) {
          if (getVscodeAPI()) {
            getVscodeAPI()!.postMessage({ command: 'showError', text: '必须至少保留一个入口视图(Entry View)' });
          }
          finalUpdates.data = { ...finalUpdates.data, entry: true };
        }
      }
    }

    if (before.type === 'hg_list') {
      // 验证 data 属性
      if (updates.data) {
        const validatedData = { ...updates.data };

        // 验证 noteNum >= 1
        if ('noteNum' in validatedData) {
          const noteNum = validatedData.noteNum as number;
          if (noteNum < 1) {
            validatedData.noteNum = 1;
            if (getVscodeAPI()) {
              getVscodeAPI()!.postMessage({
                command: 'showError',
                text: '项数量必须大于等于 1'
              });
            }
          }
        }

        finalUpdates.data = validatedData;
      }

      // 验证 style 属性
      if (updates.style) {
        const validatedStyle = { ...updates.style };

        // 验证 itemWidth >= 1
        if ('itemWidth' in validatedStyle) {
          const itemWidth = validatedStyle.itemWidth as number;
          if (itemWidth < 1) {
            validatedStyle.itemWidth = 1;
            if (getVscodeAPI()) {
              getVscodeAPI()!.postMessage({
                command: 'showError',
                text: '项宽度必须大于等于 1'
              });
            }
          }
        }

        // 验证 itemHeight >= 1
        if ('itemHeight' in validatedStyle) {
          const itemHeight = validatedStyle.itemHeight as number;
          if (itemHeight < 1) {
            validatedStyle.itemHeight = 1;
            if (getVscodeAPI()) {
              getVscodeAPI()!.postMessage({
                command: 'showError',
                text: '项高度必须大于等于 1'
              });
            }
          }
        }

        // 验证 space >= 0
        if ('space' in validatedStyle) {
          const space = validatedStyle.space as number;
          if (space < 0) {
            validatedStyle.space = 0;
            if (getVscodeAPI()) {
              getVscodeAPI()!.postMessage({
                command: 'showError',
                text: '项间距必须大于等于 0'
              });
            }
          }
        }

        finalUpdates.style = validatedStyle;
      }
    }

    // 对于几何控件，如果修改了半径或线宽，自动调整 width 和 height
    if (before.type === 'hg_arc' && updates.style) {
      const currentStyle = before.style || {};
      const newStyle = { ...currentStyle, ...updates.style };
      const radius = newStyle.radius ?? 40;
      const strokeWidth = newStyle.strokeWidth ?? 8;

      // 自动调整尺寸：width = height = 2 * (radius + strokeWidth)
      const newSize = 2 * (radius + strokeWidth);

      finalUpdates.position = {
        ...before.position,
        ...finalUpdates.position,
        width: newSize,
        height: newSize,
      };
    }

    if (before.type === 'hg_circle' && updates.style) {
      const currentStyle = before.style || {};
      const newStyle = { ...currentStyle, ...updates.style };
      const radius = newStyle.radius ?? 40;

      // 自动调整尺寸：width = height = 2 * radius
      const newSize = 2 * radius;

      finalUpdates.position = {
        ...before.position,
        ...finalUpdates.position,
        width: newSize,
        height: newSize,
      };
    }

    // 对于 hg_view，如果设置 entry=true，需要将其他 hg_view 的 entry 设为 false
    if (before.type === 'hg_view' && (finalUpdates.data?.entry === true || finalUpdates.data?.entry === 'true')) {
      set((state) => ({
        components: state.components.map((comp) => {
          if (comp.id === id) {
            return { ...comp, ...finalUpdates };
          }
          // 其他 hg_view 的 entry 设为 false
          if (comp.type === 'hg_view' && (comp.data?.entry === true || comp.data?.entry === 'true')) {
            return { ...comp, data: { ...comp.data, entry: false } };
          }
          return comp;
        }),
      }));
      // 通知后端清除其他 HML 文件中的 entry 标记（跨文件互斥）
      if (getVscodeAPI()) {
        getVscodeAPI()!.postMessage({
          command: 'setEntryView',
          viewId: id
        });
      }
      get().saveToFile();
      return;
    }

    set((state) => ({
      components: state.components.map((comp) =>
        comp.id === id ? { ...comp, ...finalUpdates } : comp
      ),
    }));

    if (options?.save !== false) {
      get().saveToFile();
    }
  },

  renameComponent: (oldId, newId) => {
    const state = get();

    // 检查新 ID 是否已存在
    if (state.components.some(c => c.id === newId)) {
      return false;
    }

    // 获取被重命名的组件
    const targetComponent = state.components.find(c => c.id === oldId);

    // 如果是 hg_list 组件，需要同步重命名其子 hg_list_item
    const listItemRenames: Map<string, string> = new Map();
    if (targetComponent?.type === 'hg_list') {
      // 找到所有子 hg_list_item
      const listItems = state.components.filter(
        c => c.type === 'hg_list_item' && c.parent === oldId
      );

      // 为每个 list_item 生成新的 ID
      listItems.forEach(item => {
        // 从旧 ID 中提取 item 后缀（如 _item_1）
        const oldItemId = item.id;
        const itemSuffix = oldItemId.replace(oldId, '');
        const newItemId = newId + itemSuffix;

        // 检查新 ID 是否已存在
        if (!state.components.some(c => c.id === newItemId)) {
          listItemRenames.set(oldItemId, newItemId);
        }
      });
    }

    // 更新组件 ID 和所有引用
    set((state) => ({
      // 更新选中状态
      selectedComponent: state.selectedComponent === oldId ? newId :
        (listItemRenames.has(state.selectedComponent || '') ? listItemRenames.get(state.selectedComponent!)! : state.selectedComponent),
      selectedComponents: state.selectedComponents.map(id => {
        if (id === oldId) return newId;
        if (listItemRenames.has(id)) return listItemRenames.get(id)!;
        return id;
      }),
      // 更新组件列表
      components: state.components.map((comp) => {
        let updated = comp;

        // 更新组件自身的 id 和 name
        if (comp.id === oldId) {
          updated = { ...updated, id: newId, name: newId };
        } else if (listItemRenames.has(comp.id)) {
          // 更新 list_item 的 id 和 name
          const newItemId = listItemRenames.get(comp.id)!;
          updated = { ...updated, id: newItemId, name: newItemId };
        }

        // 更新子组件的 parent 引用
        if (comp.parent === oldId) {
          updated = { ...updated, parent: newId };
        } else if (listItemRenames.has(comp.parent || '')) {
          updated = { ...updated, parent: listItemRenames.get(comp.parent!)! };
        }

        // 更新父组件的 children 数组
        if (comp.children) {
          let childrenUpdated = false;
          const newChildren = comp.children.map(c => {
            if (c === oldId) {
              childrenUpdated = true;
              return newId;
            }
            if (listItemRenames.has(c)) {
              childrenUpdated = true;
              return listItemRenames.get(c)!;
            }
            return c;
          });
          if (childrenUpdated) {
            updated = { ...updated, children: newChildren };
          }
        }

        // 更新事件配置中的 target 引用
        if (comp.eventConfigs) {
          const updatedConfigs = comp.eventConfigs.map(ec => ({
            ...ec,
            actions: ec.actions.map(action => {
              let updatedAction = action;
              // 同步 switchView target
              if (updatedAction.target === oldId) {
                updatedAction = { ...updatedAction, target: newId };
              } else if (listItemRenames.has(updatedAction.target || '')) {
                updatedAction = { ...updatedAction, target: listItemRenames.get(updatedAction.target!)! };
              }
              // 同步 controlTimer timerTargets 中的 componentId
              if (updatedAction.timerTargets) {
                let targetsChanged = false;
                const newTargets = updatedAction.timerTargets.map(tt => {
                  if (tt.componentId === oldId) {
                    targetsChanged = true;
                    return { ...tt, componentId: newId };
                  }
                  if (listItemRenames.has(tt.componentId)) {
                    targetsChanged = true;
                    return { ...tt, componentId: listItemRenames.get(tt.componentId)! };
                  }
                  return tt;
                });
                if (targetsChanged) {
                  updatedAction = { ...updatedAction, timerTargets: newTargets };
                }
              }
              return updatedAction;
            })
          }));
          updated = { ...updated, eventConfigs: updatedConfigs };
        }

        // 更新定时动画中的 target 引用（switchView 动作）
        if (comp.data?.timers && Array.isArray(comp.data.timers)) {
          let timersChanged = false;
          const newTimers = comp.data.timers.map((timer: any) => {
            if (!timer.segments || !Array.isArray(timer.segments)) return timer;
            let segmentsChanged = false;
            const newSegments = timer.segments.map((seg: any) => {
              if (!seg.actions || !Array.isArray(seg.actions)) return seg;
              let actionsChanged = false;
              const newActions = seg.actions.map((act: any) => {
                if (act.type === 'switchView' && act.target) {
                  if (act.target === oldId) {
                    actionsChanged = true;
                    return { ...act, target: newId };
                  }
                  if (listItemRenames.has(act.target)) {
                    actionsChanged = true;
                    return { ...act, target: listItemRenames.get(act.target)! };
                  }
                }
                return act;
              });
              if (actionsChanged) {
                segmentsChanged = true;
                return { ...seg, actions: newActions };
              }
              return seg;
            });
            if (segmentsChanged) {
              timersChanged = true;
              return { ...timer, segments: newSegments };
            }
            return timer;
          });
          if (timersChanged) {
            updated = { ...updated, data: { ...updated.data, timers: newTimers } };
          }
        }

        return updated;
      }),
    }));
    get().saveToFile();
    return true;
  },

  removeComponent: (id, fromListSync = false) => {
    const state = get();
    const component = state.components.find((c) => c.id === id);
    if (!component) return;

    // 禁止删除默认主视图 mainView 或入口视图
    const isEntryView = component.type === 'hg_view' && (component.data?.entry === true || component.data?.entry === 'true');
    if (id === 'mainView' || isEntryView) {
      if (getVscodeAPI()) {
        getVscodeAPI()!.postMessage({ command: 'notify', text: '主视图(Entry View)不可删除' });
      }
      return;
    }

    // 禁止删除列表项（除非是从 list 控件内部同步调用）
    if (component.type === 'hg_list_item' && !fromListSync) {
      if (getVscodeAPI()) {
        getVscodeAPI()!.postMessage({
          command: 'showInfo',
          text: '列表项由 list 控件自动管理，请修改 noteNum 属性来调整数量'
        });
      }
      return;
    }

    const result = removeComponentsImpl(set, get, [id]);

    if (getVscodeAPI() && result) {
      let message = `删除控件: ${id}`;
      if (result.cleanedCount > 0) {
        message += `，已清理 ${result.cleanedCount} 个视图切换引用`;
      }
      if (result.brokenRefs.length > 0) {
        message += `\n⚠ 以下控件存在断裂的事件引用: ${result.brokenRefs.join(', ')}`;
        console.warn(`[事件引用] 删除 ${id} 后产生断裂引用，受影响控件:`, result.brokenRefs);
      }
      getVscodeAPI()!.postMessage({ command: 'notify', text: message });
    }
    get().saveToFile();
  },

  removeComponents: (ids) => {
    if (!ids || ids.length === 0) return;

    // 过滤掉 mainView 和入口视图，不允许删除
    const state = get();
    const filteredIds = ids.filter(id => {
      const comp = state.components.find(c => c.id === id);
      const isEntry = comp?.type === 'hg_view' && (comp.data?.entry === true || comp.data?.entry === 'true');
      return id !== 'mainView' && !isEntry;
    });

    if (filteredIds.length === 0) {
      if (getVscodeAPI()) {
        getVscodeAPI()!.postMessage({ command: 'notify', text: '主视图(Entry View)不可删除' });
      }
      return;
    }

    const result = removeComponentsImpl(set, get, filteredIds);

    if (getVscodeAPI() && result) {
      let message: string;
      if (filteredIds.length < ids.length) {
        message = '根视图已跳过，其他组件已删除';
      } else {
        message = `批量删除控件: ${filteredIds.length} 个`;
      }
      if (result.cleanedCount > 0) {
        message += `，已清理 ${result.cleanedCount} 个视图切换引用`;
      }
      if (result.brokenRefs.length > 0) {
        message += `\n⚠ 以下控件存在断裂的事件引用: ${result.brokenRefs.join(', ')}`;
        console.warn(`[事件引用] 批量删除后产生断裂引用，受影响控件:`, result.brokenRefs);
      }
      getVscodeAPI()!.postMessage({ command: 'notify', text: message });
    }
    get().saveToFile();
  },

  // Utility methods
  duplicateComponent: (id) => {
    const state = get();
    const component = state.components.find((c) => c.id === id);
    if (!component) return;

    const newId = generateComponentId(component.type, state.components, state.otherFileComponentIds);
    const newComponent: Component = {
      ...component,
      id: newId,
      name: newId,
      children: [],
      position: {
        x: component.position.x + 20,
        y: component.position.y + 20,
        width: component.position.width,
        height: component.position.height,
      },
    };

    get().addComponent(newComponent);
  },

  moveComponent: (id, newParent) => {
    const state = get();
    const component = state.components.find((c) => c.id === id);
    if (!component) return;

    // 验证规则
    // 1. hg_view 不能移动（只能是根组件）
    if (component.type === 'hg_view') {
      if (getVscodeAPI()) {
        getVscodeAPI()!.postMessage({
          command: 'showInfo',
          text: 'hg_view 只能作为根组件，无法移动'
        });
      }
      return;
    }

    // 2. hg_list_item 只能在 hg_list 中
    if (component.type === 'hg_list_item') {
      const newParentComp = newParent ? state.components.find(c => c.id === newParent) : null;
      if (!newParentComp || newParentComp.type !== 'hg_list') {
        if (getVscodeAPI()) {
          getVscodeAPI()!.postMessage({
            command: 'showInfo',
            text: 'list_item 只能在 hg_list 控件中'
          });
        }
        return;
      }
    }

    // 3. 非 hg_list_item 不能移动到 hg_list 中
    if (component.type !== 'hg_list_item' && newParent) {
      const newParentComp = state.components.find(c => c.id === newParent);
      if (newParentComp && newParentComp.type === 'hg_list') {
        if (getVscodeAPI()) {
          getVscodeAPI()!.postMessage({
            command: 'showInfo',
            text: 'hg_list 只能包含 list_item 子组件'
          });
        }
        return;
      }
    }

    // 4. 不能移动到自己的子组件中（避免循环引用）
    const isDescendant = (parentId: string | null | undefined, targetId: string): boolean => {
      if (!parentId) return false;
      if (parentId === targetId) return true;
      const parent = state.components.find(c => c.id === parentId);
      return parent ? isDescendant(parent.parent, targetId) : false;
    };

    if (newParent && isDescendant(newParent, id)) {
      if (getVscodeAPI()) {
        getVscodeAPI()!.postMessage({
          command: 'showInfo',
          text: '不能将组件移动到自己的子组件中'
        });
      }
      return;
    }

    // 5. 只有容器控件（hg_view, hg_window）可以作为父组件
    if (newParent) {
      const newParentComp = state.components.find(c => c.id === newParent);
      if (newParentComp &&
          newParentComp.type !== 'hg_view' &&
          newParentComp.type !== 'hg_window' &&
          newParentComp.type !== 'hg_list' &&
          newParentComp.type !== 'hg_list_item') {
        if (getVscodeAPI()) {
          getVscodeAPI()!.postMessage({
            command: 'showInfo',
            text: '只有容器控件（hg_view, hg_window）可以包含子组件'
          });
        }
        return;
      }
    }

    set((state) => {
      const component = state.components.find((c) => c.id === id);
      if (!component) return state;

      // 计算新父容器下现有子组件数量，用于设置正确的 zIndex
      const newSiblingCount = state.components.filter(c => c.parent === newParent).length;

      return {
        components: state.components.map((comp) => {
          if (comp.id === id) {
            return { ...comp, parent: newParent, zIndex: newSiblingCount };
          }
          // Update old parent's children
          if (comp.id === component.parent) {
            return {
              ...comp,
              children: comp.children?.filter((childId) => childId !== id),
            };
          }
          // Update new parent's children
          if (comp.id === newParent) {
            return {
              ...comp,
              children: [...(comp.children || []), id],
            };
          }
          return comp;
        }),
      };
    });
    get().saveToFile();
  },

  reorderComponent: (id, newIndex) => {
    // Implement reorder logic
    get().saveToFile();
  },

  // 重新排序同级组件
  reorderSiblings: (componentId: string, parentId: string | null | undefined, newIndex: number) => {
    set((state) => {
      // 获取同级组件（按 zIndex 排序以确保与视觉顺序一致）
      const siblings = state.components.filter(c => c.parent === parentId)
        .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
      const currentIndex = siblings.findIndex(c => c.id === componentId);

      if (currentIndex === -1 || currentIndex === newIndex) {
        return state;
      }

      // 重新排列同级组件
      const reordered = [...siblings];
      const [moved] = reordered.splice(currentIndex, 1);
      reordered.splice(newIndex, 0, moved);

      // 更新重排后的同级组件的 zIndex（按新顺序分配 zIndex）
      const reorderedWithZIndex = reordered.map((sibling, index) => ({
        ...sibling,
        zIndex: index
      }));

      // 如果是 hg_list_item，交换子组件树而不是交换位置
      // 保持每个 item 的位置、index 不变，交换 children 内容，并按位置重命名 item id
      const isListItem = reordered.length > 0 && reordered[0].type === 'hg_list_item';
      if (isListItem && parentId) {
        // siblings[i] = 位置 i 的 item（位置/index 不变）
        // reordered[i] = 新顺序第 i 位，即位置 i 应该显示的内容来源
        // 目标：
        //   1. siblings[i] 的 children = reordered[i] 的原始 children
        //   2. 子控件的 parent 更新为新的 item id
        //   3. item id 按位置重命名为 ${listId}_item_${i}

        // 第一步：确定每个位置的新 item id（按位置顺序重命名）
        // 用临时 id 避免重命名冲突
        const tempPrefix = `__tmp_reorder_${Date.now()}_`;
        const finalIds = siblings.map((_, i) => `${parentId}_item_${i}`);
        const tempIds = siblings.map((_, i) => `${tempPrefix}${i}`);

        // 建立映射：旧 item id → 临时 id → 最终 id
        const oldToTemp = new Map<string, string>();
        const tempToFinal = new Map<string, string>();
        siblings.forEach((item, i) => {
          oldToTemp.set(item.id, tempIds[i]);
          tempToFinal.set(tempIds[i], finalIds[i]);
        });

        // 建立内容映射：位置 i 的 item（siblings[i]）应该显示 reordered[i] 的 children
        // 子控件的新 parent = 位置 i 的最终 id（finalIds[i]）
        const itemNewChildren = new Map<string, string[]>(); // 旧 item id → new children ids
        const childNewParent = new Map<string, string>();    // child id → new parent final id
        siblings.forEach((posItem, i) => {
          const contentSource = reordered[i];
          const originalChildren = contentSource.children || [];
          itemNewChildren.set(posItem.id, originalChildren);
          originalChildren.forEach(childId => {
            childNewParent.set(childId, finalIds[i]);
          });
        });

        // 第二步：一次性更新所有组件
        const newComponents = state.components.map(comp => {
          // 更新 list_item 本身：新 id + 新 children
          const tempId = oldToTemp.get(comp.id);
          if (tempId !== undefined) {
            const finalId = tempToFinal.get(tempId)!;
            return {
              ...comp,
              id: finalId,
              name: finalId,
              children: itemNewChildren.get(comp.id) || [],
            };
          }
          // 更新子控件的 parent 引用
          if (childNewParent.has(comp.id)) {
            return { ...comp, parent: childNewParent.get(comp.id)! };
          }
          // 更新父 list 的 children 数组（按位置顺序，使用最终 id）
          if (comp.id === parentId) {
            return { ...comp, children: finalIds };
          }
          return comp;
        });

        return { components: newComponents };
      }

      // 重建整个 components 数组，保持新的顺序
      const siblingIds = new Set(siblings.map(s => s.id));
      const newComponents: typeof state.components = [];
      let siblingsInserted = false;

      for (const comp of state.components) {
        if (siblingIds.has(comp.id)) {
          // 遇到第一个同级组件时，插入所有重排后的同级组件（已更新 zIndex）
          if (!siblingsInserted) {
            newComponents.push(...reorderedWithZIndex);
            siblingsInserted = true;
          }
          // 跳过原来的同级组件（已在上面插入）
        } else {
          // 如果是父组件，更新其 children 数组
          if (comp.id === parentId) {
            newComponents.push({
              ...comp,
              children: reorderedWithZIndex.map(c => c.id)
            });
          } else {
            newComponents.push(comp);
          }
        }
      }

      return { components: newComponents };
    });
    get().saveToFile();
  },

  // 移动组件到指定位置（改变父组件并插入到指定位置）
  moveComponentToPosition: (componentId: string, newParentId: string | null | undefined, targetId: string, position: 'before' | 'after') => {
    const state = get();
    const component = state.components.find(c => c.id === componentId);
    const targetComp = state.components.find(c => c.id === targetId);

    if (!component || !targetComp) return;

    // 先移动到新父组件
    set((state) => {
      const oldParentId = component.parent;

      return {
        components: state.components.map((comp) => {
          // 更新组件的父引用（设置高 zIndex 确保在排序后位于末尾）
          if (comp.id === componentId) {
            return { ...comp, parent: newParentId, zIndex: 99999 };
          }
          // 从旧父组件的 children 中移除
          if (comp.id === oldParentId) {
            return {
              ...comp,
              children: comp.children?.filter((childId) => childId !== componentId),
            };
          }
          // 添加到新父组件的 children（先添加到末尾，后面会调整顺序）
          if (comp.id === newParentId) {
            return {
              ...comp,
              children: [...(comp.children || []), componentId],
            };
          }
          return comp;
        }),
      };
    });

    // 然后调整顺序（使用更新后的状态）
    const updatedState = get();
    const siblings = updatedState.components.filter(c => c.parent === newParentId)
      .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    const targetIndex = siblings.findIndex(c => c.id === targetId);
    const newIndex = position === 'before' ? targetIndex : targetIndex + 1;

    get().reorderSiblings(componentId, newParentId, newIndex);
  },

  getSelectedComponent: () => {
    const state = get();
    return state.components.find((c) => c.id === state.selectedComponent);
  },

  getSelectedComponents: () => {
    const state = get();
    return state.components.filter((c) => state.selectedComponents.includes(c.id));
  },

  getComponentById: (id) => {
    return get().components.find((c) => c.id === id);
  },

  // ============ List Item 管理 ============

  /**
   * 同步 list 控件的 list_item 子组件数量
   * 只负责数量增减，不复制子控件，不修改已有 item 的内容
   * @param listId list 控件的 ID
   */
  syncListItems: (listId: string) => {
    set((state) => {
      const listComponent = state.components.find(c => c.id === listId);
      if (!listComponent || listComponent.type !== 'hg_list') {
        return state;
      }

      // 获取 noteNum 属性（默认为 5）
      const noteNum = (listComponent.data?.noteNum as number) || 5;

      // 双重过滤：parent 字段匹配 OR 在 list 的 children 数组中
      // 防止 HML 加载后 parent 字段不一致导致漏算
      const listChildrenSet = new Set(listComponent.children || []);
      const currentItems = state.components
        .filter(c => c.type === 'hg_list_item' && (c.parent === listId || listChildrenSet.has(c.id)))
        .sort((a, b) => {
          const indexA = (a.data?.index as number) ?? 0;
          const indexB = (b.data?.index as number) ?? 0;
          return indexA - indexB;
        });
      const currentCount = currentItems.length;

      console.log(`[syncListItems] listId=${listId}, noteNum=${noteNum}, currentCount=${currentCount}`);

      // 如果数量已经匹配，不需要调整
      if (currentCount === noteNum) {
        return state;
      }

      // 获取布局属性，用于计算新 item 的位置
      const itemWidth = parseInt(String(listComponent.style?.itemWidth)) || 100;
      const itemHeight = parseInt(String(listComponent.style?.itemHeight)) || 100;
      const space = parseInt(String(listComponent.style?.space)) || 0;
      const direction = (listComponent.style?.direction as string) || 'VERTICAL';
      const isVertical = direction === 'VERTICAL';

      let newComponents = [...state.components];

      if (noteNum > currentCount) {
        // 以当前最大 index + 1 作为新 item 的起始 index
        const maxExistingIndex = currentItems.length > 0
          ? Math.max(...currentItems.map(c => (c.data?.index as number) ?? 0))
          : -1;

        for (let i = 0; i < noteNum - currentCount; i++) {
          const newIndex = maxExistingIndex + 1 + i;
          // 生成唯一 id，避免与已有组件冲突
          let newItemId = `${listId}_item_${newIndex}`;
          let idSuffix = newIndex;
          while (newComponents.some(c => c.id === newItemId)) {
            idSuffix++;
            newItemId = `${listId}_item_${idSuffix}`;
          }

          // 根据布局属性计算正确的位置
          const newPosition = {
            x: isVertical ? 0 : newIndex * (itemWidth + space),
            y: isVertical ? newIndex * (itemHeight + space) : 0,
            width: itemWidth,
            height: itemHeight,
          };

          // 新增空的 hg_list_item，不复制已有 item 的子控件
          const newItem: Component = {
            id: newItemId,
            name: newItemId,
            type: 'hg_list_item',
            parent: listId,
            position: newPosition,
            data: { index: newIndex },
            children: [],
            visible: true,
            enabled: true,
            locked: false,
            zIndex: newIndex,
          };

          newComponents.push(newItem);

          // 更新 list 组件的 children 数组
          const listIndex = newComponents.findIndex(c => c.id === listId);
          if (listIndex !== -1) {
            const updatedList = { ...newComponents[listIndex] };
            updatedList.children = updatedList.children ? [...updatedList.children] : [];
            if (!updatedList.children.includes(newItemId)) {
              updatedList.children.push(newItemId);
            }
            newComponents[listIndex] = updatedList;
          }
        }
      } else if (noteNum < currentCount) {
        // 需要删除多余的 list_item（删除末尾的）
        const itemsToRemove = currentItems.slice(noteNum);
        const idsToRemove = new Set<string>();

        // 收集要删除的 list_item 及其所有子组件的 ID
        itemsToRemove.forEach(item => {
          idsToRemove.add(item.id);
          const collectChildIds = (parentId: string) => {
            newComponents.filter(c => c.parent === parentId).forEach(child => {
              idsToRemove.add(child.id);
              collectChildIds(child.id);
            });
          };
          collectChildIds(item.id);
        });

        // 过滤掉要删除的组件
        newComponents = newComponents.filter(c => !idsToRemove.has(c.id));

        // 更新 list 组件的 children 数组
        const listIndex = newComponents.findIndex(c => c.id === listId);
        if (listIndex !== -1) {
          const updatedList = { ...newComponents[listIndex] };
          updatedList.children = (updatedList.children || []).filter(
            childId => !idsToRemove.has(childId)
          );
          newComponents[listIndex] = updatedList;
        }
      }

      // 最后，确保 list 的 children 数组按 index 排序（list_item 在前，其他子组件在后）
      const finalListIndex = newComponents.findIndex(c => c.id === listId);
      if (finalListIndex !== -1) {
        const finalList = { ...newComponents[finalListIndex] };
        if (finalList.children && finalList.children.length > 0) {
          const listItems = finalList.children
            .map(childId => newComponents.find(c => c.id === childId))
            .filter(child => child !== undefined && child.type === 'hg_list_item') as Component[];

          listItems.sort((a, b) => ((a.data?.index as number) ?? 0) - ((b.data?.index as number) ?? 0));

          const otherChildren = finalList.children.filter(childId => {
            const child = newComponents.find(c => c.id === childId);
            return child && child.type !== 'hg_list_item';
          });

          finalList.children = [...listItems.map(c => c.id), ...otherChildren];
          newComponents[finalListIndex] = finalList;
        }
      }

      return { components: newComponents };
    });

    get().saveToFile();
  },

  // 调整组件层级
  moveComponentLayer: (componentId: string, direction: LayerDirection) => {
    set((state) => {
      const comp = state.components.find(c => c.id === componentId);
      if (!comp) return state;

      // 找到同级组件（按 zIndex 排序以确保与视觉顺序一致）
      const siblings = state.components.filter(c => c.parent === comp.parent)
        .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
      if (siblings.length <= 1) return state;

      const currentIndex = siblings.findIndex(c => c.id === componentId);
      const newIndex = calculateNewIndex(currentIndex, direction, siblings.length - 1);
      if (newIndex === currentIndex) return state;

      // 重新排列同级组件并重建数组
      const reorderedSiblings = reorderArray(siblings, currentIndex, newIndex);
      const newComponents = rebuildComponentsArray(state.components, reorderedSiblings, comp.parent);

      return { components: newComponents };
    });

    // 在 set 完成后立即保存到文件
    get().saveToFile();
  },
});
