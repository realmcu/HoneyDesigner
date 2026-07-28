/**
 * Canvas Slice
 * 画布缩放/平移/背景、视图状态持久化、拖拽、视图连接/辅助线开关
 * 从 store.ts 逐字搬运对应 action，行为保持不变
 */

import type { StateCreator } from 'zustand';
import { debounceSaveViewState } from '../shared';
import { ViewState, viewStateStorage } from '../utils';
import type { DesignerStore } from '../types';

export const createCanvasSlice: StateCreator<DesignerStore, [], [], Partial<DesignerStore>> = (set, get) => ({
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
  setShowAlignmentGuides: (show) => set({ showAlignmentGuides: show }),

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
});
