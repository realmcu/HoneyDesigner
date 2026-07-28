/**
 * System Slice
 * VSCode 通信、脏状态跟踪、撤销/重做、仿真状态、工程配置、资源转换配置
 * 从 store.ts 逐字搬运对应 action，行为保持不变
 */

import type { StateCreator } from 'zustand';
import { AssetFile, ConversionConfig, ItemSettings } from '../../types';
import { setVSCodeAPIInstance } from '../vscodeAPI';
import { getVscodeAPI, setVscodeAPI } from '../shared';
import { parseResolutionStr } from '../utils';
import type { DesignerStore } from '../types';

export const createSystemSlice: StateCreator<DesignerStore, [], [], Partial<DesignerStore>> = (set, get) => ({
  setSimulationRunning: (running) => set({ isSimulationRunning: running }),
  setOperationInProgress: (op) => set({ operationInProgress: op }),
  setSimulationFlow: (flow) => set((state) => ({ simulationFlow: { ...state.simulationFlow, ...flow } })),

  // Undo/Redo (由后端管理)
  undo: () => {
    window.vscodeAPI?.postMessage({ command: 'undo' });
  },

  redo: () => {
    window.vscodeAPI?.postMessage({ command: 'redo' });
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,
  getUndoLabel: () => get().canUndo() ? '撤销' : null,
  getRedoLabel: () => get().canRedo() ? '重做' : null,

  // VSCode communication
  setVSCodeAPI: (api) => {
    setVscodeAPI(api);
    setVSCodeAPIInstance(api);
    set({ vscodeAPI: api });
  },

  saveToFile: () => {
    const state = get();
    if (!getVscodeAPI()) return;

    getVscodeAPI()!.postMessage({
      command: 'save',
      content: {
        components: state.components,
      },
    });
    get().markSaveRequested();
  },

  // 脏状态跟踪：只在 false→true 变化时发消息（拖拽等高频改动不会刷消息）。
  // 复位路径有二：①发出 save 消息时乐观复位（markSaveRequested，本地复位、
  // 不通知宿主）——保存期间的新编辑会再次 false→true 发 dirtyStateChanged，
  // 宿主 dirty 序号递增，保存回执的 clearWebviewDirtyIfUnchanged 因 seq 不等
  // 而不清缓存，导航写事务前置校验不会误放行；保存失败宿主回执 hmlSaveFailed，
  // App.tsx 收到后 markDirty 置回。②应用宿主推送内容（loadHml）——调用
  // resetDirty（本地复位 + 通知宿主）
  markDirty: () => {
    if (get().isDirty) return;
    set({ isDirty: true });
    getVscodeAPI()?.postMessage({ command: 'dirtyStateChanged', dirty: true });
  },

  resetDirty: () => {
    if (get().isDirty) {
      set({ isDirty: false });
    }
    // 无条件通知宿主，保证宿主缓存与 webview 同步（如宿主重载后陈旧的 true）
    getVscodeAPI()?.postMessage({ command: 'dirtyStateChanged', dirty: false });
  },

  // 乐观复位（只动本地标记，不发消息）：宿主缓存的清除仍由保存结果驱动
  // （成功且 seq 未变 → clearWebviewDirtyIfUnchanged；失败 → 保持 dirty）
  markSaveRequested: () => {
    if (get().isDirty) {
      set({ isDirty: false });
    }
  },

  setAssetCategory: (category) => set({ assetCategory: category }),

  // Project configuration
  setProjectConfig: (config) => {
    set({ projectConfig: config, canvasSize: parseResolutionStr(config?.resolution) });
  },

  // Initialize with project config
  initializeWithProjectConfig: (config) => {
    set({
      projectConfig: config,
      selectedComponent: null,
      hoveredComponent: null,
      draggedComponent: null,
      zoom: 1,
      canvasOffset: { x: 0, y: 0 },
      canvasSize: parseResolutionStr(config?.resolution),
      canvasBackgroundColor: '#3c3c3c',
      editingMode: 'select',
    });
  },

  // ============ 资源转换配置 ============

  /**
   * 设置选中的资源（文件夹或图片）
   * @param asset 资源对象，null 表示取消选中
   */
  setSelectedAsset: (asset: AssetFile | null) => {
    set({ selectedAsset: asset });
  },

  /**
   * 设置转换配置
   * @param config 转换配置对象
   */
  setConversionConfig: (config: ConversionConfig | null) => {
    set({ conversionConfig: config });
  },

  /**
   * 设置可选工程配置列表及当前激活配置名
   * @param payload configs=可选配置名数组，active=当前激活配置名（无匹配为 null）
   */
  setProjectConfigs: (payload: { configs: string[]; active: string | null }) => {
    set({ projectConfigs: payload.configs, activeProjectConfig: payload.active });
  },

  /**
   * 更新指定资源路径的配置
   * @param path 资源路径（相对于 assets 目录）
   * @param settings 配置设置
   * @param changedField 变更的字段名（可选，用于触发特定行为如代码生成）
   */
  updateAssetConfig: (path: string, settings: ItemSettings, changedField?: string) => {
    const state = get();
    const currentConfig = state.conversionConfig;

    if (!currentConfig) {
      // 如果没有配置，创建新配置
      const newConfig: ConversionConfig = {
        version: '1.0',
        defaultSettings: {
          format: 'adaptive16',
          compression: 'adaptive'
        },
        items: {
          [path]: settings
        }
      };
      set({ conversionConfig: newConfig });

      // 通知后端保存配置
      if (getVscodeAPI()) {
        getVscodeAPI()!.postMessage({
          command: 'saveConversionConfig',
          config: newConfig,
          changedPath: path,
          changedField: changedField
        });
      }
      return;
    }

    // 更新现有配置
    const newConfig: ConversionConfig = {
      ...currentConfig,
      items: {
        ...currentConfig.items,
        [path]: settings
      }
    };

    set({ conversionConfig: newConfig });

    // 通知后端保存配置
    if (getVscodeAPI()) {
      getVscodeAPI()!.postMessage({
        command: 'saveConversionConfig',
        config: newConfig,
        changedPath: path,
        changedField: changedField
      });
    }
  },
});
