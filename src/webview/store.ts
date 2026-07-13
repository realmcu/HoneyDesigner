/**
 * Zustand Store for HoneyGUI Designer
 * 管理设计器的状态和逻辑
 */

import { create } from 'zustand';
import { Component, ComponentType, DesignerState, VSCodeAPI, AssetFile, ConversionConfig, ItemSettings, ViewInfo, NavLayoutMap, ViewControlInfo, NavEditRequestPayload } from './types';
import {
  alignComponents,
  distributeComponents,
  resizeComponents,
  AlignType,
  DistributeType,
  ResizeType
} from './utils/alignmentUtils';
import { generateComponentId } from './utils/componentNaming';
import { findComponentsWithBrokenRefs, isDropTargetType } from './utils/componentUtils';
import { setVSCodeAPIInstance } from './store/vscodeAPI';
import { createEmptyCatalog } from '../project-i18n/catalog';
import type { ProjectI18nIndex } from '../project-i18n/projectIndex';
import type { I18nCatalog, LocaleCode } from '../project-i18n/types';

// ============ 层级调整辅助函数 ============

type LayerDirection = 'up' | 'down' | 'top' | 'bottom';

/**
 * 计算组件在同级中的新索引
 */
function calculateNewIndex(currentIndex: number, direction: LayerDirection, maxIndex: number): number {
  switch (direction) {
    case 'up':    return Math.min(currentIndex + 1, maxIndex);
    case 'down':  return Math.max(currentIndex - 1, 0);
    case 'top':   return maxIndex;
    case 'bottom': return 0;
  }
}

/**
 * 重新排列数组中的元素
 */
function reorderArray<T>(arr: T[], fromIndex: number, toIndex: number): T[] {
  const result = [...arr];
  const [moved] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, moved);
  return result;
}

/**
 * 重建 components 数组，应用新的同级组件顺序
 */
function rebuildComponentsArray(
  components: Component[],
  reorderedSiblings: Component[],
  parentId: string | null | undefined
): Component[] {
  const siblingIds = new Set(reorderedSiblings.map(s => s.id));
  const newChildrenOrder = reorderedSiblings.map(s => s.id);

  // 更新重排后的同级组件的 zIndex（按新顺序分配 zIndex）
  const reorderedSiblingsWithZIndex = reorderedSiblings.map((sibling, index) => ({
    ...sibling,
    zIndex: index
  }));

  const result: Component[] = [];
  let siblingsInserted = false;

  for (const comp of components) {
    if (siblingIds.has(comp.id)) {
      // 遇到第一个同级组件时，插入所有重排后的同级组件（已更新 zIndex）
      if (!siblingsInserted) {
        result.push(...reorderedSiblingsWithZIndex);
        siblingsInserted = true;
      }
      // 跳过原来的同级组件（已在上面插入）
    } else if (parentId && comp.id === parentId) {
      // 更新父组件的 children 数组顺序
      result.push({ ...comp, children: newChildrenOrder });
    } else {
      result.push(comp);
    }
  }

  return result;
}

// ============ 辅助函数：深度克隆组件 ============

/**
 * 递归收集组件树中所有组件
 */
function collectTree(components: Component[], root: Component): Component[] {
  const result: Component[] = [root];
  if (root.children) {
    for (const childId of root.children) {
      const child = components.find(c => c.id === childId);
      if (child) {
        result.push(...collectTree(components, child));
      }
    }
  }
  return result;
}

/**
 * 递归克隆组件树（包括所有子组件）
 * 使用 ID 映射方式生成新的缩写+编号 ID
 * @param components 所有组件数组
 * @param rootComponent 要克隆的根组件
 * @param allComponents 当前所有组件（用于生成唯一ID）
 * @param extraIds 其他文件中的组件ID（跨文件去重）
 * @returns 克隆后的组件数组（包括根组件和所有子组件）
 */
function cloneComponentTree(components: Component[], rootComponent: Component, allComponents: Component[], extraIds?: string[]): Component[] {
  const toClone = collectTree(components, rootComponent);

  // 第一步：为所有组件生成新 ID，并建立映射
  const idMap = new Map<string, string>();
  let trackingComponents = [...allComponents];
  for (const comp of toClone) {
    const newId = generateComponentId(comp.type, trackingComponents, extraIds);
    idMap.set(comp.id, newId);
    trackingComponents.push({ ...comp, id: newId } as Component);
  }

  // 第二步：用映射后的 ID 创建克隆组件
  return toClone.map(comp => ({
    ...comp,
    id: idMap.get(comp.id)!,
    name: idMap.get(comp.id)!,
    children: comp.children?.map(childId => idMap.get(childId) || childId),
    parent: comp.parent ? (idMap.get(comp.parent) || comp.parent) : comp.parent,
  }));
}

// ============ Store 定义 ============

export interface DesignerStore extends DesignerState {
  // Actions
  setComponents: (components: Component[]) => void;
  addComponent: (component: Component, options?: { save?: boolean }) => void;
  updateComponent: (id: string, updates: Partial<Component>, options?: { save?: boolean }) => void;
  renameComponent: (oldId: string, newId: string) => boolean;
  removeComponent: (id: string, fromListSync?: boolean) => void;
  removeComponents: (ids: string[]) => void;
  selectComponent: (id: string | null) => void;
  setSelectedComponents: (ids: string[]) => void;
  addToSelection: (id: string) => void;
  removeFromSelection: (id: string) => void;
  clearSelection: () => void;
  setHoveredComponent: (id: string | null) => void;
  setDraggedComponent: (id: string | null) => void;

  // Canvas operations
  setZoom: (zoom: number) => void;
  setCanvasOffset: (offset: { x: number; y: number }) => void;
  setEditingMode: (mode: 'select' | 'move' | 'resize') => void;
  setCanvasBackgroundColor: (color: string) => void;
  centerViewOnCanvas: (componentId: string) => void;
  fitContentToView: () => void;
  saveViewState: (uiState?: { leftPanelTab?: 'components' | 'assets' | 'tree'; leftPanelVisible?: boolean; rightPanelVisible?: boolean; leftPanelWidth?: number; rightPanelWidth?: number }) => void;
  flushSaveViewState: () => void;
  restoreViewState: (filePath: string) => { restored: boolean; state?: ViewState };

  // View connections
  showViewConnections: boolean;
  setShowViewConnections: (show: boolean) => void;
  showViewRelationModal: boolean;
  setShowViewRelationModal: (show: boolean) => void;
  /** 请求宿主重扫导航图（allViews），结果经 updateAllViews 消息回推 */
  refreshNavGraph: () => void;
  /** 请求宿主读取导航图布局（.honeygui/nav-layout.json），结果经 navLayoutLoaded 消息回推 */
  requestNavLayout: () => void;
  /** 拖动结束后防抖调用：只发被拖动过的 key，宿主按 key 合并写入 */
  saveNavLayout: (patch: NavLayoutMap) => void;
  /** 清除布局写入失败提示（用户关闭提示条时调用） */
  clearNavLayoutSaveError: () => void;
  /** 请求宿主枚举某 view 下可交互控件（T9），结果经 viewControlsLoaded 消息回推 */
  requestViewControls: (viewKey: string) => void;
  /** 清除控件枚举结果/失败提示（关闭新建跳转选择器时调用） */
  clearViewControls: () => void;
  /** 导航写事务（T11）：经宿主 applyNavEdit 执行，回执经 navEditResult 消息回推 */
  applyNavEdit: (payload: NavEditRequestPayload) => void;
  /** 清除已消费的 navEditResult 回执（ViewRelationModal 处理完后调用） */
  clearNavEditResult: () => void;
  /** 当前可撤销的导航编辑条数（宿主回执/查询回推维护） */
  navUndoCount: number;
  /** 撤销最近一次导航编辑（回执经 navEditResult 消息回推，op='undo'） */
  undoNavEdit: (requestId: string) => void;
  /** 弹窗打开时查询可撤销条数（结果经 navUndoState 消息回推） */
  requestNavUndoState: () => void;
  /** 把 webview 前端日志/错误转发到宿主输出通道（Output → HoneyGUI） */
  hostLog: (level: 'info' | 'warn' | 'error', message: string) => void;
  /** 打开输出面板的 HoneyGUI 日志通道 */
  showHostLog: () => void;
  /** 切文件后待选中的组件 id（loadHml 应用完成时消费，导航图"打开所在页面"用） */
  pendingSelectComponentId: string | null;
  setPendingSelectComponent: (id: string | null) => void;
  /** 在当前设计器面板打开另一个 HML 文件，加载完成后可选中指定组件 */
  openFileInDesigner: (filePath: string, selectComponentId?: string) => void;

  // Alignment guides
  showAlignmentGuides: boolean;
  setShowAlignmentGuides: (show: boolean) => void;

  // Simulation status
  setSimulationRunning: (running: boolean) => void;
  setOperationInProgress: (op: 'codegen' | 'simulate' | 'clean' | 'download' | 'convert' | null) => void;
  // 仿真流程配置（可独立勾选 convert / codegen / simulate，默认全部启用）
  simulationFlow: { convert: boolean; codegen: boolean; simulate: boolean };
  setSimulationFlow: (flow: Partial<{ convert: boolean; codegen: boolean; simulate: boolean }>) => void;

  // Assets
  setAssetCategory: (category: 'all' | 'images' | 'svgs' | 'videos' | 'models' | 'fonts' | 'glass' | 'lottie' | 'trmap') => void;

  // Drag and drop
  startDrag: (componentId: string, mousePos: { x: number; y: number }) => void;
  drag: (mousePos: { x: number; y: number }) => void;
  endDrag: () => void;

  // Undo/Redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  getUndoLabel: () => string | null;
  getRedoLabel: () => string | null;

  // VSCode communication
  vscodeAPI: VSCodeAPI | null;
  setVSCodeAPI: (api: VSCodeAPI) => void;
  saveToFile: () => void;

  // 未保存改动（脏状态）跟踪：markDirty 由 components 变化订阅自动触发；
  // resetDirty 在应用宿主推送内容（loadHml）后调用；两者变化时向宿主发 dirtyStateChanged
  markDirty: () => void;
  resetDirty: () => void;
  // 发出 save 消息后立即乐观复位本地 isDirty（不通知宿主）——保存窗口内的
  // 新编辑才能再次触发 false→true 的 dirtyStateChanged（宿主 dirty 序号递增，
  // clearWebviewDirtyIfUnchanged 因 seq 不等而不清缓存）。所有发 save 消息的
  // 入口（saveToFile / Ctrl+S / 工具栏）都必须调用
  markSaveRequested: () => void;
  setProjectI18nCatalog: (catalog: I18nCatalog) => void;
  setPreviewLocale: (locale: LocaleCode) => void;
  setProjectI18nIndex: (index?: ProjectI18nIndex, errors?: Array<{ filePath: string; message: string }>) => void;
  setProjectI18nManagerOpen: (open: boolean) => void;
  loadProjectI18nIndex: () => void;
  updateProjectI18nCatalog: (catalog: I18nCatalog, options?: { save?: boolean; immediate?: boolean }) => void;
  saveProjectI18nCatalog: (catalog?: I18nCatalog, options?: { immediate?: boolean }) => void;
  deleteProjectI18nKey: (key: string) => void;
  renameProjectI18nKey: (oldKey: string, newKey: string) => void;

  // Component management
  duplicateComponent: (id: string) => void;
  moveComponent: (id: string, newParent: string | null) => void;
  reorderComponent: (id: string, newIndex: number) => void;
  reorderSiblings: (componentId: string, parentId: string | null | undefined, newIndex: number) => void;
  moveComponentToPosition: (componentId: string, newParentId: string | null | undefined, targetId: string, position: 'before' | 'after') => void;
  moveComponentLayer: (id: string, direction: 'up' | 'down' | 'top' | 'bottom') => void;

  // Clipboard operations
  clipboard: Component | null;
  clipboardMultiple: Component[];
  copyComponent: (id: string) => void;
  cutComponent: (id: string) => void;
  pasteComponent: (position?: { x: number; y: number }) => void;
  copySelectedComponents: () => void;
  cutSelectedComponents: () => void;

  // Alignment operations
  alignSelectedComponents: (type: import('./utils/alignmentUtils').AlignType) => void;
  distributeSelectedComponents: (type: import('./utils/alignmentUtils').DistributeType) => void;
  resizeSelectedComponents: (type: import('./utils/alignmentUtils').ResizeType) => void;

  // Selection
  getSelectedComponent: () => Component | undefined;
  getSelectedComponents: () => Component[];
  getComponentById: (id: string) => Component | undefined;

  // List Item management
  syncListItems: (listId: string) => void;

  // Project configuration
  setProjectConfig: (config: any) => void;
  initializeWithProjectConfig: (config: any) => void;

  // Conversion config (资源转换配置)
  selectedAsset: AssetFile | null;
  conversionConfig: ConversionConfig | null;
  setSelectedAsset: (asset: AssetFile | null) => void;
  setConversionConfig: (config: ConversionConfig | null) => void;
  /**
   * 更新资源配置
   * @param path 资源路径（相对于 assets 目录）
   * @param settings 配置设置
   * @param changedField 变更的字段名（可选，用于触发特定行为如代码生成）
   */
  updateAssetConfig: (path: string, settings: ItemSettings, changedField?: string) => void;

}

let vscodeAPI: VSCodeAPI | null = null;
let saveProjectI18nCatalogTimer: ReturnType<typeof setTimeout> | null = null;

// 解析分辨率字符串
const parseResolutionStr = (res?: string): { width: number; height: number } => {
  if (!res) return { width: 800, height: 480 };
  const parts = res.split('X');
  return {
    width: parseInt(parts[0]) || 800,
    height: parseInt(parts[1]) || 480,
  };
};

// 视图状态存储（按文件路径保存）
interface ViewState {
  zoom: number;
  canvasOffset: { x: number; y: number };
  selectedComponent: string | null;  // 选中的组件
  leftPanelTab: 'components' | 'assets' | 'tree';  // 左侧面板 Tab
  leftPanelVisible: boolean;  // 左侧面板是否可见
  rightPanelVisible: boolean;  // 右侧面板是否可见
  leftPanelWidth?: number;  // 左侧面板宽度
  rightPanelWidth?: number;  // 右侧面板宽度
}

// 使用 localStorage 持久化视图状态
const VIEW_STATE_STORAGE_KEY = 'honeygui-designer-view-states';

const viewStateStorage = {
  get: (filePath: string): ViewState | undefined => {
    try {
      const stored = localStorage.getItem(VIEW_STATE_STORAGE_KEY);
      if (!stored) return undefined;
      const allStates = JSON.parse(stored) as Record<string, ViewState>;
      return allStates[filePath];
    } catch (e) {
      console.error('[ViewState] 读取失败:', e);
      return undefined;
    }
  },
  set: (filePath: string, state: ViewState): void => {
    try {
      const stored = localStorage.getItem(VIEW_STATE_STORAGE_KEY);
      const allStates = stored ? JSON.parse(stored) : {};
      allStates[filePath] = state;
      localStorage.setItem(VIEW_STATE_STORAGE_KEY, JSON.stringify(allStates));
    } catch (e) {
      console.error('[ViewState] 保存失败:', e);
    }
  }
};

/**
 * RAF 防抖工具函数
 * 将高频调用合并到下一个 requestAnimationFrame 回调中执行
 * 用于缩放/平移时延迟写入 localStorage 等非关键操作
 */
function createRafDebouncer() {
  let rafId: number | null = null;
  let pendingFn: (() => void) | null = null;
  return {
    call: (fn: () => void) => {
      pendingFn = fn;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        pendingFn?.();
        pendingFn = null;
      });
    },
    flush: () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
        pendingFn?.();
        pendingFn = null;
      }
    },
  };
}

export const useDesignerStore = create<DesignerStore>((set, get, api) => {
  // 用于缩放/平移时的防抖保存，避免高频操作反复写入 localStorage
  const debounceSaveViewState = createRafDebouncer();

  // ============ 共享的组件删除逻辑 ============

  /**
   * 内部共享删除实现：执行实际的组件删除、清理和消息发送
   */
  const removeComponentsImpl = (ids: string[]) => {
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

    set((state) => ({
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

    if (vscodeAPI) {
      vscodeAPI.postMessage({ command: 'delete', content: { ids, components: get().components } });
    }

    // 检测断裂的事件引用并返回统计信息
    const allViewIds = new Set((get().allViews || []).map(v => v.id));
    const brokenRefs = findComponentsWithBrokenRefs(get().components, allViewIds);

    return { ids, cleanedCount, brokenRefs: brokenRefs.size > 0 ? Array.from(brokenRefs) : [] as string[] };
  };

  return {
  // State
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
          if (vscodeAPI) {
            vscodeAPI.postMessage({ command: 'showError', text: '必须至少保留一个入口视图(Entry View)' });
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
            if (vscodeAPI) {
              vscodeAPI.postMessage({
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
            if (vscodeAPI) {
              vscodeAPI.postMessage({
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
            if (vscodeAPI) {
              vscodeAPI.postMessage({
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
            if (vscodeAPI) {
              vscodeAPI.postMessage({
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
      if (vscodeAPI) {
        vscodeAPI.postMessage({
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
      if (vscodeAPI) {
        vscodeAPI.postMessage({ command: 'notify', text: '主视图(Entry View)不可删除' });
      }
      return;
    }

    // 禁止删除列表项（除非是从 list 控件内部同步调用）
    if (component.type === 'hg_list_item' && !fromListSync) {
      if (vscodeAPI) {
        vscodeAPI.postMessage({
          command: 'showInfo',
          text: '列表项由 list 控件自动管理，请修改 noteNum 属性来调整数量'
        });
      }
      return;
    }

    const result = removeComponentsImpl([id]);

    if (vscodeAPI && result) {
      let message = `删除控件: ${id}`;
      if (result.cleanedCount > 0) {
        message += `，已清理 ${result.cleanedCount} 个视图切换引用`;
      }
      if (result.brokenRefs.length > 0) {
        message += `\n⚠ 以下控件存在断裂的事件引用: ${result.brokenRefs.join(', ')}`;
        console.warn(`[事件引用] 删除 ${id} 后产生断裂引用，受影响控件:`, result.brokenRefs);
      }
      vscodeAPI.postMessage({ command: 'notify', text: message });
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
      if (vscodeAPI) {
        vscodeAPI.postMessage({ command: 'notify', text: '主视图(Entry View)不可删除' });
      }
      return;
    }

    const result = removeComponentsImpl(filteredIds);

    if (vscodeAPI && result) {
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
      vscodeAPI.postMessage({ command: 'notify', text: message });
    }
    get().saveToFile();
  },

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

  // Canvas operations
  setZoom: (zoom) => {
    set({ zoom });
    // 使用防抖保存视图状态，避免滚轮缩放时频繁写入 localStorage
    debounceSaveViewState.call(() => get().saveViewState());
  },
  setCanvasOffset: (offset) => {
    set({ canvasOffset: offset });
    // 使用防抖保存视图状态，避免平移时频繁写入 localStorage
    debounceSaveViewState.call(() => get().saveViewState());
  },
  setEditingMode: (mode) => set({ editingMode: mode }),
  setCanvasBackgroundColor: (color) => set({ canvasBackgroundColor: color }),
  setShowViewConnections: (show) => set({ showViewConnections: show }),
  setShowViewRelationModal: (show) => set({ showViewRelationModal: show }),
  refreshNavGraph: () => {
    if (vscodeAPI) {
      vscodeAPI.postMessage({ command: 'refreshNavGraph' });
    }
  },
  requestNavLayout: () => {
    if (vscodeAPI) {
      vscodeAPI.postMessage({ command: 'getNavLayout' });
    }
  },
  saveNavLayout: (patch) => {
    if (vscodeAPI && patch && Object.keys(patch).length > 0) {
      vscodeAPI.postMessage({ command: 'saveNavLayout', layout: patch });
    }
  },
  clearNavLayoutSaveError: () => set({ navLayoutSaveError: null }),
  requestViewControls: (viewKey) => {
    if (vscodeAPI && viewKey) {
      vscodeAPI.postMessage({ command: 'getViewControls', viewKey });
    }
  },
  clearViewControls: () => set({ viewControls: null, viewControlsForKey: null, viewControlsError: null }),
  applyNavEdit: (payload) => {
    if (vscodeAPI && payload?.requestId && payload.op) {
      set({ navEditPending: true, navEditResult: null });
      vscodeAPI.postMessage({ command: 'applyNavEdit', ...payload });
    }
  },
  clearNavEditResult: () => set({ navEditResult: null }),
  undoNavEdit: (requestId) => {
    if (vscodeAPI && requestId) {
      set({ navEditPending: true, navEditResult: null });
      vscodeAPI.postMessage({ command: 'navEditUndo', requestId });
    }
  },
  requestNavUndoState: () => {
    if (vscodeAPI) {
      vscodeAPI.postMessage({ command: 'getNavUndoState' });
    }
  },
  hostLog: (level, message) => {
    if (vscodeAPI) {
      vscodeAPI.postMessage({ command: 'webviewLog', level, message });
    }
  },
  showHostLog: () => {
    if (vscodeAPI) {
      vscodeAPI.postMessage({ command: 'showHostLog' });
    }
  },
  setPendingSelectComponent: (id) => set({ pendingSelectComponentId: id }),
  openFileInDesigner: (filePath, selectComponentId) => {
    if (vscodeAPI && filePath) {
      set({ pendingSelectComponentId: selectComponentId ?? null });
      vscodeAPI.postMessage({ command: 'switchFile', filePath });
    }
  },
  setShowAlignmentGuides: (show) => set({ showAlignmentGuides: show }),
  setAssetCategory: (category) => set({ assetCategory: category }),
  setSimulationRunning: (running) => set({ isSimulationRunning: running }),
  setOperationInProgress: (op) => set({ operationInProgress: op }),
  setSimulationFlow: (flow) => set((state) => ({ simulationFlow: { ...state.simulationFlow, ...flow } })),

  // 保存当前视图状态
  saveViewState: (uiState) => {
    const state = get();
    if (state.currentFilePath) {
      const viewState: ViewState = {
        zoom: state.zoom,
        canvasOffset: state.canvasOffset,
        selectedComponent: state.selectedComponent,
        leftPanelTab: uiState?.leftPanelTab || 'components',
        leftPanelVisible: uiState?.leftPanelVisible ?? true,
        rightPanelVisible: uiState?.rightPanelVisible ?? true,
        leftPanelWidth: uiState?.leftPanelWidth,
        rightPanelWidth: uiState?.rightPanelWidth,
      };
      viewStateStorage.set(state.currentFilePath, viewState);
      console.log('[ViewState] 保存视图状态:', state.currentFilePath, viewState);
    }
  },

  // 立即执行防抖中的待处理保存（切换文件前调用，确保视图状态已写入 localStorage）
  flushSaveViewState: () => {
    debounceSaveViewState.flush();
  },

  // 恢复视图状态
  restoreViewState: (filePath: string) => {
    const savedState = viewStateStorage.get(filePath);
    console.log('[ViewState] 尝试恢复视图状态:', filePath, savedState);
    if (savedState) {
      // 【修复闪烁】不在这里直接 set，而是返回状态让调用者批量更新
      // set({
      //   zoom: savedState.zoom,
      //   canvasOffset: savedState.canvasOffset,
      //   selectedComponent: savedState.selectedComponent,
      // });
      console.log('[ViewState] 已找到保存的视图状态:', savedState);
      return { restored: true, state: savedState };
    } else {
      // 如果没有保存的状态，不重置（保持当前状态）
      console.log('[ViewState] 无保存状态，保持当前视图');
      return { restored: false };
    }
  },

  // 将指定组件居中显示在画布上
  centerViewOnCanvas: (componentId) => {
    const state = get();
    const component = state.components.find(c => c.id === componentId);
    if (!component || !component.position) {
      console.log('[centerViewOnCanvas] Component not found or no position:', componentId);
      return;
    }

    // 获取画布可视区域的尺寸（使用容器而不是画布本身）
    const containerElement = document.querySelector('.designer-canvas-container');
    if (!containerElement) {
      console.log('[centerViewOnCanvas] Canvas container not found');
      return;
    }

    const rect = containerElement.getBoundingClientRect();
    const viewportWidth = rect.width;
    const viewportHeight = rect.height;

    // 实际缩放比例（与 DesignerCanvas 中的 transform 一致）
    const effectiveZoom = state.zoom / (window.devicePixelRatio || 1);

    // 计算组件的绝对位置（累加所有父组件的偏移）
    let absX = component.position.x;
    let absY = component.position.y;
    let parentId = component.parent;
    while (parentId) {
      const parent = state.components.find(c => c.id === parentId);
      if (parent && parent.position) {
        absX += parent.position.x;
        absY += parent.position.y;
      }
      parentId = parent?.parent || null;
    }

    // 计算组件中心点（在画布坐标系中）
    const compCenterX = absX + component.position.width / 2;
    const compCenterY = absY + component.position.height / 2;

    // 计算需要的偏移量，使组件中心对齐视口中心
    // 公式：视口中心 = 组件中心 * effectiveZoom + offset
    // 所以：offset = 视口中心 - 组件中心 * effectiveZoom
    const offsetX = viewportWidth / 2 - compCenterX * effectiveZoom;
    const offsetY = viewportHeight / 2 - compCenterY * effectiveZoom;

    console.log('[centerViewOnCanvas]', {
      componentId,
      absPos: { x: absX, y: absY },
      compCenter: { x: compCenterX, y: compCenterY },
      viewport: { width: viewportWidth, height: viewportHeight },
      zoom: state.zoom,
      effectiveZoom,
      offset: { x: offsetX, y: offsetY }
    });

    set({ canvasOffset: { x: offsetX, y: offsetY } });
  },

  // 自适应居中：计算所有顶层组件的包围盒，自动缩放并居中显示
  fitContentToView: () => {
    const state = get();
    const topLevelComponents = state.components.filter(c => c.parent === null);
    if (topLevelComponents.length === 0) return;

    // 计算所有顶层组件的包围盒
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const comp of topLevelComponents) {
      minX = Math.min(minX, comp.position.x);
      minY = Math.min(minY, comp.position.y);
      maxX = Math.max(maxX, comp.position.x + comp.position.width);
      maxY = Math.max(maxY, comp.position.y + comp.position.height);
    }

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    if (contentWidth <= 0 || contentHeight <= 0) return;

    const contentCenterX = (minX + maxX) / 2;
    const contentCenterY = (minY + maxY) / 2;

    // 获取视口尺寸
    const containerElement = document.querySelector('.designer-canvas-container');
    if (!containerElement) return;
    const rect = containerElement.getBoundingClientRect();
    const viewportWidth = rect.width;
    const viewportHeight = rect.height;
    if (viewportWidth <= 0 || viewportHeight <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const padding = 0.85; // 留 15% 边距

    // 计算适合的 effectiveZoom（实际渲染缩放 = zoom / dpr）
    const fitEffectiveZoom = Math.min(
      (viewportWidth * padding) / contentWidth,
      (viewportHeight * padding) / contentHeight
    );

    // 转换为 store 中的 zoom 值，并限制范围
    const fitZoom = Math.max(0.1, Math.min(5, fitEffectiveZoom * dpr));
    const effectiveZoom = fitZoom / dpr;

    // 计算居中偏移
    const offsetX = viewportWidth / 2 - contentCenterX * effectiveZoom;
    const offsetY = viewportHeight / 2 - contentCenterY * effectiveZoom;

    console.log('[fitContentToView]', {
      content: { minX, minY, maxX, maxY, width: contentWidth, height: contentHeight },
      viewport: { width: viewportWidth, height: viewportHeight },
      fitZoom, effectiveZoom,
      offset: { x: offsetX, y: offsetY }
    });

    set({ zoom: fitZoom, canvasOffset: { x: offsetX, y: offsetY } });

    // 重置滚动位置，避免滚轮滚动后再次居中时偏移
    if (containerElement instanceof HTMLElement) {
      containerElement.scrollLeft = 0;
      containerElement.scrollTop = 0;
    }
  },

  // Drag and drop
  startDrag: (componentId, mousePos) => {
    set({ draggedComponent: componentId });
  },

  drag: (mousePos) => {
    const state = get();
    if (!state.draggedComponent) return;

    const component = state.components.find((c) => c.id === state.draggedComponent);
    if (!component) return;

    const x = mousePos.x - state.canvasOffset.x;
    const y = mousePos.y - state.canvasOffset.y;

    get().updateComponent(component.id, {
      position: { ...component.position, x, y },
    });
  },

  endDrag: () => {
    set({ draggedComponent: null });
  },

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
    vscodeAPI = api;
    setVSCodeAPIInstance(api);
    set({ vscodeAPI: api });
  },

  saveToFile: () => {
    const state = get();
    if (!vscodeAPI) return;

    vscodeAPI.postMessage({
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
    vscodeAPI?.postMessage({ command: 'dirtyStateChanged', dirty: true });
  },

  resetDirty: () => {
    if (get().isDirty) {
      set({ isDirty: false });
    }
    // 无条件通知宿主，保证宿主缓存与 webview 同步（如宿主重载后陈旧的 true）
    vscodeAPI?.postMessage({ command: 'dirtyStateChanged', dirty: false });
  },

  // 乐观复位（只动本地标记，不发消息）：宿主缓存的清除仍由保存结果驱动
  // （成功且 seq 未变 → clearWebviewDirtyIfUnchanged；失败 → 保持 dirty）
  markSaveRequested: () => {
    if (get().isDirty) {
      set({ isDirty: false });
    }
  },

  setProjectI18nCatalog: (catalog) => {
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
    vscodeAPI?.postMessage({ command: 'getProjectI18nIndex' });
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
    vscodeAPI?.postMessage({ command: 'deleteProjectI18nKey', key: cleanKey });
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
    vscodeAPI?.postMessage({ command: 'renameProjectI18nKey', oldKey: from, newKey: to });
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
      if (!vscodeAPI) return;
      // activeLocale 已经是 catalogToSave 的字段，不需要再单独带一份 previewLocale。
      vscodeAPI.postMessage({
        command: 'saveProjectI18nCatalog',
        catalog: catalogToSave,
      });
    };

    if (saveProjectI18nCatalogTimer) {
      clearTimeout(saveProjectI18nCatalogTimer);
      saveProjectI18nCatalogTimer = null;
    }

    if (options?.immediate) {
      postSaveMessage();
      return;
    }

    saveProjectI18nCatalogTimer = setTimeout(() => {
      saveProjectI18nCatalogTimer = null;
      postSaveMessage();
    }, 400);
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

  // Clipboard operations
  copyComponent: (id) => {
    const { components } = get();
    const component = components.find((c) => c.id === id);
    if (!component) return;

    // 禁止复制列表项
    if (component.type === 'hg_list_item') {
      if (vscodeAPI) {
        vscodeAPI.postMessage({
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
      if (vscodeAPI) {
        vscodeAPI.postMessage({
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
      if (vscodeAPI) {
        vscodeAPI.postMessage({
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
      if (vscodeAPI) {
        vscodeAPI.postMessage({
          command: 'showInfo',
          text: '列表项不支持复制或剪切操作'
        });
      }
      return;
    }

    get().copySelectedComponents();
    componentsToCut.forEach((c) => get().removeComponent(c.id));
  },

  // ============ 对齐操作 ============

  alignSelectedComponents: (type: AlignType) => {
    const { selectedComponents, components, updateComponent } = get();

    if (selectedComponents.length < 2) {
      if (vscodeAPI) {
        vscodeAPI.postMessage({
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
        .filter(p => p !== undefined) as Component[];

      const allParentsAreListItems = parentComponents.every(p => p.type === 'hg_list_item');

      if (allParentsAreListItems) {
        // 检查所有 list_item 是否属于同一个 list
        const listParents = new Set(parentComponents.map(p => p.parent));
        if (listParents.size !== 1) {
          if (vscodeAPI) {
            vscodeAPI.postMessage({
              command: 'showInfo',
              text: '只能对齐同一 list 控件内的组件'
            });
          }
          return;
        }
        // 属于同一个 list，允许对齐
      } else {
        // 不是 list_item 的情况，必须在同一父容器
        if (vscodeAPI) {
          vscodeAPI.postMessage({
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
      if (vscodeAPI) {
        vscodeAPI.postMessage({
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
      if (vscodeAPI) {
        vscodeAPI.postMessage({
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
      if (vscodeAPI) {
        vscodeAPI.postMessage({
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

  moveComponent: (id, newParent) => {
    const state = get();
    const component = state.components.find((c) => c.id === id);
    if (!component) return;

    // 验证规则
    // 1. hg_view 不能移动（只能是根组件）
    if (component.type === 'hg_view') {
      if (vscodeAPI) {
        vscodeAPI.postMessage({
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
        if (vscodeAPI) {
          vscodeAPI.postMessage({
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
        if (vscodeAPI) {
          vscodeAPI.postMessage({
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
      if (vscodeAPI) {
        vscodeAPI.postMessage({
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
        if (vscodeAPI) {
          vscodeAPI.postMessage({
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
      if (vscodeAPI) {
        vscodeAPI.postMessage({
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
    if (vscodeAPI) {
      vscodeAPI.postMessage({
        command: 'saveConversionConfig',
        config: newConfig,
        changedPath: path,
        changedField: changedField
      });
    }
  },

};
});

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
