/**
 * Nav Slice
 * 导航图刷新/布局读写、控件枚举、导航写事务/撤销、宿主日志、跨文件打开
 * 从 store.ts 逐字搬运对应 action，行为保持不变
 */

import type { StateCreator } from 'zustand';
import { getVscodeAPI } from '../shared';
import type { DesignerStore } from '../types';

export const createNavSlice: StateCreator<DesignerStore, [], [], Partial<DesignerStore>> = (set, get) => ({
  refreshNavGraph: () => {
    if (getVscodeAPI()) {
      getVscodeAPI()!.postMessage({ command: 'refreshNavGraph' });
    }
  },
  requestNavLayout: () => {
    if (getVscodeAPI()) {
      getVscodeAPI()!.postMessage({ command: 'getNavLayout' });
    }
  },
  saveNavLayout: (patch) => {
    if (getVscodeAPI() && patch && Object.keys(patch).length > 0) {
      getVscodeAPI()!.postMessage({ command: 'saveNavLayout', layout: patch });
    }
  },
  clearNavLayoutSaveError: () => set({ navLayoutSaveError: null }),
  requestViewControls: (viewKey) => {
    if (getVscodeAPI() && viewKey) {
      getVscodeAPI()!.postMessage({ command: 'getViewControls', viewKey });
    }
  },
  clearViewControls: () => set({ viewControls: null, viewControlsForKey: null, viewControlsError: null }),
  applyNavEdit: (payload) => {
    if (getVscodeAPI() && payload?.requestId && payload.op) {
      set({ navEditPending: true, navEditResult: null });
      getVscodeAPI()!.postMessage({ command: 'applyNavEdit', ...payload });
    }
  },
  clearNavEditResult: () => set({ navEditResult: null }),
  undoNavEdit: (requestId) => {
    if (getVscodeAPI() && requestId) {
      set({ navEditPending: true, navEditResult: null });
      getVscodeAPI()!.postMessage({ command: 'navEditUndo', requestId });
    }
  },
  requestNavUndoState: () => {
    if (getVscodeAPI()) {
      getVscodeAPI()!.postMessage({ command: 'getNavUndoState' });
    }
  },
  hostLog: (level, message) => {
    if (getVscodeAPI()) {
      getVscodeAPI()!.postMessage({ command: 'webviewLog', level, message });
    }
  },
  showHostLog: () => {
    if (getVscodeAPI()) {
      getVscodeAPI()!.postMessage({ command: 'showHostLog' });
    }
  },
  setPendingSelectComponent: (id) => set({ pendingSelectComponentId: id }),
  openFileInDesigner: (filePath, selectComponentId) => {
    if (getVscodeAPI() && filePath) {
      set({ pendingSelectComponentId: selectComponentId ?? null });
      getVscodeAPI()!.postMessage({ command: 'switchFile', filePath });
    }
  },
});
