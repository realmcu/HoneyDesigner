/**
 * Zustand Store for HoneyGUI Designer
 * 管理设计器的状态和逻辑
 *
 * 本文件按 Zustand slice 模式拆分：
 * - 模块级共享闭包/变量见 ./store/shared
 * - 纯辅助函数见 ./store/utils
 * - DesignerStore 接口见 ./store/types
 * - 各领域 action 见 ./store/slices/*
 * 主文件负责：初始 state + create() 组合所有 slice + 末尾脏状态订阅/工具导出
 */

import { create } from 'zustand';
import { ViewInfo } from './types';
import { createEmptyCatalog } from '../project-i18n/catalog';
import type { DesignerStore } from './store/types';
import { createComponentsSlice } from './store/slices/componentsSlice';
import { createCanvasSlice } from './store/slices/canvasSlice';
import { createSelectionSlice } from './store/slices/selectionSlice';
import { createClipboardSlice } from './store/slices/clipboardSlice';
import { createAlignmentSlice } from './store/slices/alignmentSlice';
import { createNavSlice } from './store/slices/navSlice';
import { createI18nSlice } from './store/slices/i18nSlice';
import { createSystemSlice } from './store/slices/systemSlice';

export type { DesignerStore } from './store/types';

export const useDesignerStore = create<DesignerStore>((set, get, api) => ({
  // State（初始 state + 各 slice 组合，整体构成完整 DesignerStore；
  // 各 slice 返回 Partial<DesignerStore> 便于拆分，故此处断言为 DesignerStore）
  components: [],
  projectConfig: null as any, // 项目配置（分辨率等）
  projectI18nCatalog: createEmptyCatalog('en-US'),
  projectI18nIndex: undefined,
  projectI18nIndexErrors: [],
  isProjectI18nManagerOpen: false,
  previewLocale: 'en-US',
  allViews: [] as ViewInfo[], // 项目中所有 view（含跳转关系，含控件级/定时器边）
  navLayout: null, // 导航图持久化布局；null = 尚未从宿主读取（T7）
  navLayoutSaveError: null, // 布局写入失败提示（不阻塞）
  viewControls: null, // getViewControls 回推的控件列表（T9）
  viewControlsForKey: null, // viewControls 对应的 viewKey
  viewControlsError: null, // getViewControls 失败提示（不阻塞）
  navEditPending: false, // 导航写事务进行中（T11）
  navEditResult: null, // 最近一次 navEditResult 回执（T11）
  navUndoCount: 0, // 可撤销的导航编辑条数
  pendingSelectComponentId: null, // 切文件后待选中的组件（导航图跳转编辑用）
  isDirty: false, // store 内容相对磁盘是否有未保存改动
  allHmlFiles: [] as Array<{path: string, name: string, relativePath: string}>, // 项目中所有 HML 文件
  otherFileComponentIds: [] as string[], // 其他 HML 文件中的组件 ID（跨文件命名去重）
  currentFilePath: '' as string, // 当前打开的文件路径
  selectedComponent: null,
  selectedComponents: [],
  hoveredComponent: null,
  draggedComponent: null,
  zoom: 1,
  canvasOffset: { x: 0, y: 0 },
  canvasSize: { width: 800, height: 480 }, // 默认画布尺寸
  canvasBackgroundColor: '#3c3c3c', // 默认画布背景色为深灰色
  editingMode: 'select',
  showViewConnections: true, // 默认显示视图连接
  showViewRelationModal: false,
  showAlignmentGuides: true, // 默认显示智能辅助线
  undoStack: [],
  redoStack: [],
  vscodeAPI: null,
  assetCategory: 'all' as 'all' | 'images' | 'svgs' | 'videos' | 'models' | 'fonts' | 'glass' | 'lottie' | 'trmap', // 资源面板分类
  clipboard: null, // 剪贴板
  clipboardMultiple: [], // 多选剪贴板
  isSimulationRunning: false, // 仿真运行状态
  operationInProgress: null, // 当前正在执行的操作
  simulationFlow: { convert: true, codegen: true, simulate: true }, // 仿真流程配置，默认全部启用
  guiVersion: null, // GUI 库版本信息
  selectedAsset: null, // 选中的资源（文件夹或图片）
  conversionConfig: null, // 转换配置
  projectConfigs: [], // 可选工程配置列表（config/ 下的备选 project.json）
  activeProjectConfig: null, // 当前激活的工程配置名（按内容匹配，无匹配为 null）

  // Actions（按 slice 组合）
  ...createComponentsSlice(set, get, api),
  ...createCanvasSlice(set, get, api),
  ...createSelectionSlice(set, get, api),
  ...createClipboardSlice(set, get, api),
  ...createAlignmentSlice(set, get, api),
  ...createNavSlice(set, get, api),
  ...createI18nSlice(set, get, api),
  ...createSystemSlice(set, get, api),
}) as DesignerStore);

// ============ 脏状态跟踪 ============

// 应用宿主推送内容（loadHml 等）期间置位，抑制脏状态订阅误判为用户编辑
let suppressDirtyTracking = false;

/**
 * 在回调内应用宿主推送的组件内容（loadHml 等），期间 components 变化
 * 不会被记为「未保存改动」。仅供消息处理入口（App.tsx）使用。
 */
export function applyHostComponents<T>(fn: () => T): T {
  suppressDirtyTracking = true;
  try {
    return fn();
  } finally {
    suppressDirtyTracking = false;
  }
}

// 集中订阅 components 引用变化 → 标脏。
// 好处：无需在每个会改动组件的 action 里逐一埋点（现有 20+ 处 set 组件的
// action，逐一埋点必漏）；宿主推送经 applyHostComponents 包裹不触发。
// markDirty 内部 set() 会重入本订阅，但那次 components 引用未变，不会递归。
useDesignerStore.subscribe((state, prevState) => {
  if (suppressDirtyTracking) return;
  if (state.components !== prevState.components) {
    useDesignerStore.getState().markDirty();
  }
});

// Helper function to generate unique ID
export const generateId = (): string => {
  return `component_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};
