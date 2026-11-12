/**
 * Shared Styles Slice
 *
 * 工程级共享样式（styles.json）的读写。样式本身由宿主落盘，这里只维护内存副本并
 * 转发给宿主；改样式后宿主重新解析 HML 并下发新组件，设计器无需自己合并属性。
 */
import type { StateCreator } from 'zustand';
import type { SharedStyleLibrary } from '../../../shared/sharedStyles';
import { getVscodeAPI, getSaveSharedStylesTimer, setSaveSharedStylesTimer } from '../shared';
import type { DesignerStore } from '../types';

export const createSharedStylesSlice: StateCreator<DesignerStore, [], [], Partial<DesignerStore>> = (set, get) => ({
  setSharedStyles: (library, options) => {
    set({
      sharedStyles: library,
      ...(options?.exists !== undefined ? { sharedStylesFileExists: options.exists } : {}),
      ...(options?.errors ? { sharedStylesErrors: options.errors } : {}),
      ...(options?.errors ? {} : { sharedStylesErrors: [] }),
    });
  },

  setSharedStylesManagerOpen: (open) => {
    set({ isSharedStylesManagerOpen: open });
  },

  saveSharedStyles: (library, options) => {
    set({ sharedStyles: library, sharedStylesFileExists: true });

    const timer = getSaveSharedStylesTimer();
    if (timer) {
      clearTimeout(timer);
      setSaveSharedStylesTimer(null);
    }

    const post = () => {
      getVscodeAPI()?.postMessage({ command: 'saveSharedStyles', styles: library });
    };
    if (options?.immediate) {
      post();
      return;
    }
    setSaveSharedStylesTimer(setTimeout(() => {
      setSaveSharedStylesTimer(null);
      post();
    }, 400));
  },
});
