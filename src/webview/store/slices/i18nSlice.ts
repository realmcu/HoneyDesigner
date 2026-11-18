/**
 * I18n Slice
 * 项目文本国际化 catalog / 索引 / 预览语言管理
 * 从 store.ts 逐字搬运对应 action，行为保持不变
 */

import type { StateCreator } from 'zustand';
import type { I18nCatalog } from '../../../project-i18n/types';
import { getVscodeAPI, getSaveProjectI18nCatalogTimer, setSaveProjectI18nCatalogTimer } from '../shared';
import type { DesignerStore } from '../types';

export const createI18nSlice: StateCreator<DesignerStore, [], [], Partial<DesignerStore>> = (set, get) => ({
  setProjectI18nCatalog: (catalog, baseRevision) => {
    // catalog.activeLocale 是持久化的权威"当前语言"来源，优先采用；
    // 缺失/非法时保留当前 previewLocale（仍合法则不跳变），否则回退 defaultLocale。
    const currentPreviewLocale = get().previewLocale;
    const previewLocale = catalog.locales.includes(catalog.activeLocale as string)
      ? (catalog.activeLocale as string)
      : catalog.locales.includes(currentPreviewLocale)
        ? currentPreviewLocale
        : catalog.defaultLocale;

    set({
      projectI18nCatalog: catalog,
      previewLocale,
      // 本地编辑传入的 catalog 不带版本：保留上次宿主下发的版本作为保存时的合并基准
      projectI18nCatalogRevision: baseRevision ?? get().projectI18nCatalogRevision,
    });
  },

  setPreviewLocale: (locale) => {
    const catalog = get().projectI18nCatalog;
    const previewLocale = catalog.locales.includes(locale) ? locale : catalog.defaultLocale;
    const nextCatalog: I18nCatalog = { ...catalog, activeLocale: previewLocale };
    set({ previewLocale, projectI18nCatalog: nextCatalog });

    try {
      const saved = window.vscodeAPI?.getState?.() || {};
      window.vscodeAPI?.setState?.({ ...saved, projectPreviewLocale: previewLocale });
    } catch (error) {
      console.warn('[HoneyGUI] Failed to save project preview locale:', error);
    }

    // 立即（非 debounce）落盘：避免"切换语言后立刻点生成代码"读到磁盘上还没落地的旧 activeLocale。
    get().saveProjectI18nCatalog(nextCatalog, { immediate: true });
  },

  setProjectI18nIndex: (index, errors) => {
    set({ projectI18nIndex: index, projectI18nIndexErrors: errors || [] });
  },

  setProjectI18nManagerOpen: (open) => {
    set({ isProjectI18nManagerOpen: open });
  },

  loadProjectI18nIndex: () => {
    getVscodeAPI()?.postMessage({ command: 'getProjectI18nIndex' });
  },

  deleteProjectI18nKey: (key) => {
    const cleanKey = key.trim();
    if (!cleanKey) {
      return;
    }

    // 乐观更新本地 catalog（Extension 回发会再覆盖为权威值）
    const nextCatalog = JSON.parse(JSON.stringify(get().projectI18nCatalog)) as I18nCatalog;
    if (nextCatalog.strings[cleanKey]) {
      delete nextCatalog.strings[cleanKey];
      set({ projectI18nCatalog: nextCatalog });
    }

    // 交给 Extension：删除 catalog 条目 + 解绑全项目所有引用组件（含未打开文件）
    getVscodeAPI()?.postMessage({ command: 'deleteProjectI18nKey', key: cleanKey });
  },

  renameProjectI18nKey: (oldKey, newKey) => {
    const from = oldKey.trim();
    const to = newKey.trim();
    if (!from || !to || from === to) {
      return;
    }

    // 乐观更新本地 catalog（Extension 回发会再覆盖为权威值）；目标已存在则不覆盖
    const nextCatalog = JSON.parse(JSON.stringify(get().projectI18nCatalog)) as I18nCatalog;
    if (nextCatalog.strings[from] && !nextCatalog.strings[to]) {
      nextCatalog.strings[to] = nextCatalog.strings[from];
      delete nextCatalog.strings[from];
      set({ projectI18nCatalog: nextCatalog });
    }

    // 交给 Extension：改 catalog 键名 + 改写全项目所有引用组件的 i18nKey（含未打开文件）
    getVscodeAPI()?.postMessage({ command: 'renameProjectI18nKey', oldKey: from, newKey: to });
  },

  updateProjectI18nCatalog: (catalog, options) => {
    get().setProjectI18nCatalog(catalog);
    if (options?.save !== false) {
      get().saveProjectI18nCatalog(catalog, { immediate: options?.immediate });
    }
  },

  saveProjectI18nCatalog: (catalog, options) => {
    const catalogToSave = catalog || get().projectI18nCatalog;
    const postSaveMessage = () => {
      if (!getVscodeAPI()) return;
      // activeLocale 已经是 catalogToSave 的字段，不需要再单独带一份 previewLocale。
      getVscodeAPI()!.postMessage({
        command: 'saveProjectI18nCatalog',
        catalog: catalogToSave,
        // 宿主据此判断磁盘在这份快照之后是否被外部改过，必要时做三方合并
        baseRevision: get().projectI18nCatalogRevision,
      });
    };

    if (getSaveProjectI18nCatalogTimer()) {
      clearTimeout(getSaveProjectI18nCatalogTimer()!);
      setSaveProjectI18nCatalogTimer(null);
    }

    if (options?.immediate) {
      postSaveMessage();
      return;
    }

    setSaveProjectI18nCatalogTimer(setTimeout(() => {
      setSaveProjectI18nCatalogTimer(null);
      postSaveMessage();
    }, 400));
  },
});
