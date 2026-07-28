/**
 * DesignerStore 接口定义
 * 从 store.ts 逐字搬运（原第 139-306 行）
 */

import { Component, DesignerState, VSCodeAPI, AssetFile, ConversionConfig, ItemSettings, NavLayoutMap, NavEditRequestPayload } from '../types';
import type { I18nCatalog, LocaleCode } from '../../project-i18n/types';
import type { ProjectI18nIndex } from '../../project-i18n/projectIndex';
import type { ViewState } from './utils';

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
  alignSelectedComponents: (type: import('../utils/alignmentUtils').AlignType) => void;
  distributeSelectedComponents: (type: import('../utils/alignmentUtils').DistributeType) => void;
  resizeSelectedComponents: (type: import('../utils/alignmentUtils').ResizeType) => void;

  // Selection
  getSelectedComponent: () => Component | undefined;
  getSelectedComponents: () => Component[];
  getComponentById: (id: string) => Component | undefined;

  // List Item management
  syncListItems: (listId: string) => void;

  // Project configuration
  setProjectConfig: (config: any) => void;
  initializeWithProjectConfig: (config: any) => void;

  // Project config presets (根目录 config/ 下的多个备选 project.json)
  projectConfigs: string[];
  activeProjectConfig: string | null;
  setProjectConfigs: (payload: { configs: string[]; active: string | null }) => void;

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
