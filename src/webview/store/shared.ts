/**
 * Store 模块级共享闭包/变量
 * 将原本在 create() 回调内的共享闭包提升为模块级，供各 slice 共享
 */

import { VSCodeAPI } from '../types';
import { findComponentsWithBrokenRefs } from '../utils/componentUtils';
import { createRafDebouncer } from './utils';
import type { DesignerStore } from './types';

// 共享的 vscodeAPI 实例（原 store.ts 第 308 行的模块级 let 变量）
let vscodeAPI: VSCodeAPI | null = null;

export function getVscodeAPI(): VSCodeAPI | null {
  return vscodeAPI;
}

export function setVscodeAPI(api: VSCodeAPI | null): void {
  vscodeAPI = api;
}

// i18n catalog 防抖保存定时器（原 store.ts 第 309 行的模块级 let 变量）
export let saveProjectI18nCatalogTimer: ReturnType<typeof setTimeout> | null = null;

export function getSaveProjectI18nCatalogTimer(): ReturnType<typeof setTimeout> | null {
  return saveProjectI18nCatalogTimer;
}

export function setSaveProjectI18nCatalogTimer(timer: ReturnType<typeof setTimeout> | null): void {
  saveProjectI18nCatalogTimer = timer;
}

// 用于缩放/平移时的防抖保存，避免高频操作反复写入 localStorage
// （原 store.ts create 回调内的 createRafDebouncer() 产物）
export const debounceSaveViewState = createRafDebouncer();

// ============ 共享的组件删除逻辑 ============

/**
 * 内部共享删除实现：执行实际的组件删除、清理和消息发送
 */
export const removeComponentsImpl = (
  set: (partial: any) => void,
  get: () => DesignerStore,
  ids: string[]
) => {
  if (!ids || ids.length === 0) return;

  const state = get();

  // 统计被删除视图中 switchView 引用的清理数量
  let cleanedCount = 0;
  const deletedViews = state.components.filter(c => ids.includes(c.id) && c.type === 'hg_view');
  const deletedViewIds = deletedViews.map(v => v.id);

  if (deletedViews.length > 0) {
    state.components.forEach(c => {
      if (c.eventConfigs) {
        c.eventConfigs.forEach(eventConfig => {
          eventConfig.actions.forEach(action => {
            if (action.type === 'switchView' && action.target && deletedViewIds.includes(action.target)) {
              cleanedCount++;
            }
          });
        });
      }
    });
  }

  // 收集所有被删除的 ID（包含直接子组件）
  const removedIds = new Set<string>();
  ids.forEach(fid => {
    removedIds.add(fid);
    state.components.forEach(c => {
      if (c.parent === fid) removedIds.add(c.id);
    });
  });

  set((state: DesignerStore) => ({
    components: state.components
      .filter((c) => !removedIds.has(c.id))
      .map(c => {
        // 清理父组件的 children 数组中被删除的引用
        if (c.children && c.children.some(childId => removedIds.has(childId))) {
          c = { ...c, children: c.children.filter(childId => !removedIds.has(childId)) };
        }
        // 清理 eventConfigs 中的 switchView 引用
        if (c.eventConfigs && deletedViews.length > 0) {
          const newEventConfigs = c.eventConfigs.map(eventConfig => ({
            ...eventConfig,
            actions: eventConfig.actions.filter(action =>
              !(action.type === 'switchView' && action.target && deletedViewIds.includes(action.target))
            )
          })).filter(eventConfig => eventConfig.actions.length > 0);

          return {
            ...c,
            eventConfigs: newEventConfigs.length > 0 ? newEventConfigs : undefined
          };
        }
        return c;
      })
  }));

  if (getVscodeAPI()) {
    getVscodeAPI()!.postMessage({ command: 'delete', content: { ids, components: get().components } });
  }

  // 检测断裂的事件引用并返回统计信息
  const allViewIds = new Set((get().allViews || []).map(v => v.id));
  const brokenRefs = findComponentsWithBrokenRefs(get().components, allViewIds);

  return { ids, cleanedCount, brokenRefs: brokenRefs.size > 0 ? Array.from(brokenRefs) : [] as string[] };
};
