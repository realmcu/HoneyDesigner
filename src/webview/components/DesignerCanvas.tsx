import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useDesignerStore } from '../store';
import { Component, ComponentType } from '../types';
import { useCanvasZoom } from '../hooks/useCanvasZoom';
import { useCanvasDrag } from '../hooks/useCanvasDrag';
import { useContextMenu } from '../hooks/useContextMenu';
import { useComponentResize } from '../hooks/useComponentResize';
import { calculateComponentStyle, createComponentHandlers } from '../utils/componentRenderer';
import { widgetRegistry } from './widgets';
import { ContextMenu } from './ContextMenu';
import { executeMenuAction, MenuActionHelpers } from '../services/contextMenuActions';
import { ViewConnectionLayer } from './ViewConnectionLayer';
import { AlignmentGuides, AlignmentLine } from './AlignmentGuides';
import { ResizeHandles, ResizeDirection } from './ResizeHandles';
import { MoveHandle } from './MoveHandle';
import { calculateAlignment } from '../utils/dragAlignmentGuides';
import { getAbsolutePosition, findComponentAtPosition, isContainerType } from '../utils/componentUtils';
import { fromCanvasEvent, getCanvasCoordinates } from '../utils/canvasCoordinates';
import { t } from '../i18n';
import { captureDesignPng } from '../utils/captureDesign';
import './DesignerCanvas.css';

interface DesignerCanvasProps {
  onComponentSelect: (id: string | null) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onCanvasDoubleClick?: (componentId: string) => void;
}

const DesignerCanvas: React.FC<DesignerCanvasProps> = ({ onComponentSelect, onDrop, onDragOver, onCanvasDoubleClick }) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [pendingDragComponent, setPendingDragComponent] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 }); // 组件拖拽起始位置
  const [alignmentLines, setAlignmentLines] = useState<AlignmentLine[]>([]); // 对齐辅助线
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 }); // 最后鼠标位置（画布坐标）
  const [multiDragOffsets, setMultiDragOffsets] = useState<Map<string, { x: number; y: number }>>(new Map()); // 多选拖拽偏移量
  
  // 框选功能状态
  const [isBoxSelecting, setIsBoxSelecting] = useState(false); // 是否正在框选
  const [boxSelectStart, setBoxSelectStart] = useState({ x: 0, y: 0 }); // 框选起始位置（画布坐标）
  const [boxSelectEnd, setBoxSelectEnd] = useState({ x: 0, y: 0 }); // 框选结束位置（画布坐标）
  const [boxSelectTimer, setBoxSelectTimer] = useState<NodeJS.Timeout | null>(null); // 长按定时器
  
  // 标记是否是框选后的移动（框选移动不触发跨容器拖拽）
  const [isBoxSelectMove, setIsBoxSelectMove] = useState(false);

  const {
    components,
    selectedComponent,
    selectedComponents,
    setHoveredComponent,
    draggedComponent,
    setDraggedComponent,
    zoom,
    setZoom,
    canvasOffset,
    setCanvasOffset,
    setComponents,
    updateComponent,
    removeComponent,
    removeComponents,
    editingMode,
    canvasSize,
    canvasBackgroundColor,
    addToSelection,
    setSelectedComponents,
    showViewConnections,
    showAlignmentGuides,
    projectConfig,
    allViews,
    moveComponent,
  } = useDesignerStore();
  
  // 使用画布缩放 Hook
  const { handleWheel, showZoomHint } = useCanvasZoom(zoom, setZoom, canvasOffset, setCanvasOffset);
  
  // 使用画布拖拽 Hook
  const {
    isDragging,
    isSpacePressed,
    handleCanvasMouseDown,
    handleCanvasMouseMove,
    handleCanvasMouseUp
  } = useCanvasDrag(canvasOffset, setCanvasOffset);
  
  // 使用右键菜单 Hook
  const { menuState, showMenu, hideMenu } = useContextMenu();
  
  // 画布空白处右键菜单状态
  const [canvasMenuState, setCanvasMenuState] = useState<{ visible: boolean; x: number; y: number }>({ visible: false, x: 0, y: 0 });
  
  // 画布菜单点击外部关闭
  useEffect(() => {
    if (!canvasMenuState.visible) return;
    const close = () => setCanvasMenuState(prev => ({ ...prev, visible: false }));
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', handleKey);
    };
  }, [canvasMenuState.visible]);

  // 使用组件调整大小 Hook
  const {
    isResizing,
    resizingComponentId,
    handleResizeStart,
    handleResizeMove,
    handleResizeEnd,
  } = useComponentResize({
    zoom,
    canvasOffset,
    updateComponent,
  });
  
  // 菜单动作辅助函数
  const menuActionHelpers: MenuActionHelpers = {
    updateComponent,
    removeComponent,
    removeComponents,
    selectComponent: onComponentSelect,
    moveComponentLayer: useDesignerStore.getState().moveComponentLayer,
    copyComponent: useDesignerStore.getState().copyComponent,
    cutComponent: useDesignerStore.getState().cutComponent,
    pasteComponent: useDesignerStore.getState().pasteComponent,
    duplicateComponent: useDesignerStore.getState().duplicateComponent,
    copySelectedComponents: useDesignerStore.getState().copySelectedComponents,
    cutSelectedComponents: useDesignerStore.getState().cutSelectedComponents,
    alignSelectedComponents: useDesignerStore.getState().alignSelectedComponents,
    postMessage: (msg) => window.vscodeAPI?.postMessage(msg),
    selectedComponents,
  };
  
  // 处理菜单动作
  const handleMenuAction = useCallback((actionId: string, component: Component) => {
    // 多选时的特殊处理
    if (selectedComponents.length > 1) {
      if (actionId === 'copy') {
        menuActionHelpers.copySelectedComponents();
        hideMenu();
        return;
      }
      if (actionId === 'cut') {
        menuActionHelpers.cutSelectedComponents();
        hideMenu();
        return;
      }
    }
    if (actionId === 'copyForAI') {
      const ids = selectedComponents.length > 1 ? selectedComponents : [component.id];
      const el = canvasRef.current;
      if (el) {
        captureDesignPng(el, components, ids, { zoom, offset: canvasOffset })
          .then((imageDataUrl) => {
            window.vscodeAPI?.postMessage({ command: 'copyForAI', imageDataUrl, selectedIds: ids });
          })
          .catch((err) => {
            window.vscodeAPI?.postMessage({ command: 'error', text: `Copy for AI failed: ${String(err)}` });
          });
      }
      hideMenu();
      return;
    }
    executeMenuAction(actionId, component, menuActionHelpers);
    hideMenu();
  }, [hideMenu, updateComponent, removeComponent, onComponentSelect, selectedComponents, components, zoom, canvasOffset]);
  
  // 处理组件右键菜单
  const handleComponentContextMenu = useCallback((e: React.MouseEvent, componentId: string) => {
    const component = components.find(c => c.id === componentId);
    if (component) {
      showMenu(e, component);
    }
  }, [components, showMenu]);
  
  // 监听来自ComponentTree的右键菜单事件
  useEffect(() => {
    const handleCustomContextMenu = (event: any) => {
      const { mouseEvent, componentId } = event.detail;
      const component = components.find(c => c.id === componentId);
      if (component) {
        // 创建一个模拟的MouseEvent用于showMenu
        const syntheticEvent = {
          ...mouseEvent,
          clientX: mouseEvent.clientX,
          clientY: mouseEvent.clientY,
          preventDefault: () => {},
          stopPropagation: () => {},
        } as React.MouseEvent;
        showMenu(syntheticEvent, component);
      }
    };
    
    window.addEventListener('component-context-menu', handleCustomContextMenu);
    return () => window.removeEventListener('component-context-menu', handleCustomContextMenu);
  }, [components, showMenu]);

  // 移动手柄拖拽开始：直接启动拖拽，不触发复杂的选中逻辑
  const handleMoveStart = (e: React.MouseEvent, componentId: string) => {
    const component = components.find(c => c.id === componentId);
    if (!component || component.locked) return;

    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const coords = getCanvasCoordinates(e.clientX, e.clientY, rect, zoom, canvasOffset, false);
      const mouseX = coords.x;
      const mouseY = coords.y;

      setDragOffset({
        x: mouseX - component.position.x,
        y: mouseY - component.position.y,
      });

      // 多选拖拽偏移量
      if (selectedComponents.length > 1 && selectedComponents.includes(componentId)) {
        const offsets = new Map<string, { x: number; y: number }>();
        selectedComponents.forEach(id => {
          const comp = components.find(c => c.id === id);
          if (comp && !comp.locked) {
            const absPos = getAbsolutePosition(comp, components);
            offsets.set(id, {
              x: mouseX - absPos.x,
              y: mouseY - absPos.y,
            });
          }
        });
        setMultiDragOffsets(offsets);
      } else {
        setMultiDragOffsets(new Map());
      }
    }

    setPendingDragComponent(componentId);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleComponentMouseDown = (e: React.MouseEvent, componentId: string) => {
    e.stopPropagation();
    
    let component = components.find(c => c.id === componentId);
    if (!component) return;
    
    // 如果点击的是容器组件，启动框选定时器
    if (isContainerType(component.type)) {
      const coords = fromCanvasEvent(e.clientX, e.clientY, canvasRef.current, zoom, canvasOffset, false);
      if (coords) {
        const timer = setTimeout(() => {
          setIsBoxSelecting(true);
          setBoxSelectStart({ x: coords.x, y: coords.y });
          setBoxSelectEnd({ x: coords.x, y: coords.y });
          setSelectedComponents([]); // 清空之前的选择
        }, 300);
        
        setBoxSelectTimer(timer);
      }
    } else {
      // 如果点击的是非容器组件，清除框选定时器
      if (boxSelectTimer) {
        clearTimeout(boxSelectTimer);
        setBoxSelectTimer(null);
      }
    }
    
    // Ctrl + 点击：穿透选中内层控件（只在同级组件之间循环，不包括父容器）
    if (e.ctrlKey && !e.shiftKey && !e.metaKey) {
      // 获取鼠标在画布中的位置
      const coords = fromCanvasEvent(e.clientX, e.clientY, canvasRef.current, zoom, canvasOffset, false);
      if (coords) {
        // 查找当前点击位置的所有同级组件（不包括父容器）
        const clickedComponents: Component[] = [];
        const currentParent = component.parent;
        
        // 获取同级组件列表
        const siblings = components.filter(c => c.parent === currentParent);
        
        // 检查每个同级组件是否在点击位置
        siblings.forEach(sibling => {
          // 计算组件的绝对位置
          let absX = sibling.position.x;
          let absY = sibling.position.y;
          
          // 如果有父容器，需要加上父容器的位置
          if (currentParent) {
            const parent = components.find(c => c.id === currentParent);
            if (parent) {
              absX += parent.position.x;
              absY += parent.position.y;
            }
          }
          
          const compLeft = absX;
          const compTop = absY;
          const compRight = compLeft + sibling.position.width;
          const compBottom = compTop + sibling.position.height;
          
          if (coords.x >= compLeft && coords.x <= compRight && coords.y >= compTop && coords.y <= compBottom) {
            clickedComponents.push(sibling);
          }
        });
        
        // 如果找到多个同级组件，选择下一个（循环选择）
        if (clickedComponents.length > 1) {
          const currentIndex = clickedComponents.findIndex(c => c.id === selectedComponent);
          const nextIndex = (currentIndex + 1) % clickedComponents.length;
          component = clickedComponents[nextIndex];
          componentId = component.id;
        }
      }
    }
    
    // Alt + 点击：选中父容器
    if (e.altKey && component.parent) {
      const parentComponent = components.find(c => c.id === component!.parent);
      if (parentComponent) {
        component = parentComponent;
        componentId = parentComponent.id;
      }
    }
    
    // 选中当前组件（允许选中 locked 组件）
    const multi = (e.ctrlKey || e.metaKey || e.shiftKey) && !e.altKey;
    if (multi) {
      addToSelection(componentId);
    } else {
      onComponentSelect(componentId);
    }

    // hg_list_item（note）位置由 list 自动管理，不允许在画布上拖动
    if (component.type === 'hg_list_item') {
      return;
    }

    // 查找可拖拽的组件（如果当前组件被锁定，向上查找父组件）
    let draggableComponent: Component | undefined = component;
    while (draggableComponent && draggableComponent.locked && draggableComponent.parent) {
      draggableComponent = components.find(c => c.id === draggableComponent!.parent);
    }
    
    // 如果没有可拖拽的组件，则不记录拖拽信息
    if (!draggableComponent || draggableComponent.locked) {
      return;
    }

    // 计算鼠标相对于可拖拽组件的偏移量
    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const coords = getCanvasCoordinates(e.clientX, e.clientY, rect, zoom, canvasOffset, false);
      const mouseX = coords.x;
      const mouseY = coords.y;
      
      setDragOffset({
        x: mouseX - draggableComponent.position.x,
        y: mouseY - draggableComponent.position.y,
      });
      
      // 多选拖拽：记录所有选中组件的偏移量（使用绝对坐标）
      if (selectedComponents.length > 1 && selectedComponents.includes(componentId)) {
        const offsets = new Map<string, { x: number; y: number }>();
        selectedComponents.forEach(id => {
          const comp = components.find(c => c.id === id);
          if (comp && !comp.locked) {
            // 使用绝对坐标计算偏移量
            const absPos = getAbsolutePosition(comp, components);
            offsets.set(id, {
              x: mouseX - absPos.x,
              y: mouseY - absPos.y,
            });
          }
        });
        setMultiDragOffsets(offsets);
      } else {
        setMultiDragOffsets(new Map());
      }
    }

    // 记录待拖动的组件（是可拖拽的父组件，不是选中的组件）
    setPendingDragComponent(draggableComponent.id);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleComponentMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    // 先处理画布拖动
    handleCanvasMouseMove(e);
    
    // 如果正在拖动画布，不处理组件拖动
    if (isDragging) return;
    
    // 如果正在框选，更新框选区域
    if (isBoxSelecting) {
      const coords = fromCanvasEvent(e.clientX, e.clientY, canvasRef.current, zoom, canvasOffset, false);
      if (!coords) return;
      const mouseX = coords.x;
      const mouseY = coords.y;
      setBoxSelectEnd({ x: mouseX, y: mouseY });
      
      // 计算框选区域
      const minX = Math.min(boxSelectStart.x, mouseX);
      const maxX = Math.max(boxSelectStart.x, mouseX);
      const minY = Math.min(boxSelectStart.y, mouseY);
      const maxY = Math.max(boxSelectStart.y, mouseY);
      
      // 查找完全在框选区域内的组件（排除容器组件）
      const selectedIds: string[] = [];
      components.forEach(comp => {
        // 排除容器组件（view、window）
        if (isContainerType(comp.type)) {
          return;
        }
        
        const absPos = getAbsolutePosition(comp, components);
        const compLeft = absPos.x;
        const compTop = absPos.y;
        const compRight = compLeft + comp.position.width;
        const compBottom = compTop + comp.position.height;
        
        // 检查组件是否完全在框选区域内
        if (compLeft >= minX && compRight <= maxX && compTop >= minY && compBottom <= maxY) {
          selectedIds.push(comp.id);
        }
      });
      
      // 更新选中的组件
      setSelectedComponents(selectedIds);
      
      // 标记为框选移动
      setIsBoxSelectMove(true);
      return;
    }
    
    // 如果正在调整大小，处理 resize
    if (isResizing) {
      handleResizeMove(e.nativeEvent, e.shiftKey);
      return;
    }
    
    // 如果有待拖动的组件，检查是否移动了足够距离
    if (pendingDragComponent && !draggedComponent) {
      const deltaX = Math.abs(e.clientX - dragStart.x);
      const deltaY = Math.abs(e.clientY - dragStart.y);
      const threshold = 3; // 移动超过3px才开始拖动
      
      if (deltaX > threshold || deltaY > threshold) {
        // 开始拖拽，取消框选
        if (boxSelectTimer) {
          clearTimeout(boxSelectTimer);
          setBoxSelectTimer(null);
        }
        setIsBoxSelecting(false);
        
        setDraggedComponent(pendingDragComponent);
        setPendingDragComponent(null);
      }
    }
    
    if (draggedComponent) {
      const coords = fromCanvasEvent(e.clientX, e.clientY, canvasRef.current, zoom, canvasOffset, false);
      if (!coords) return;
      const mouseX = coords.x;
      const mouseY = coords.y;

      // 记录最后鼠标位置（用于 mouseUp 时判断目标容器）
      setLastMousePos({ x: mouseX, y: mouseY });
      
      // 多选拖拽
      if (multiDragOffsets.size > 1) {
        multiDragOffsets.forEach((offset, id) => {
          const comp = components.find(c => c.id === id);
          if (comp) {
            // 计算新的绝对位置
            const newAbsX = Math.round(mouseX - offset.x);
            const newAbsY = Math.round(mouseY - offset.y);
            
            // 转换为相对于父组件的坐标
            let newX = newAbsX;
            let newY = newAbsY;
            if (comp.parent) {
              const parent = components.find(c => c.id === comp.parent);
              if (parent) {
                const parentAbsPos = getAbsolutePosition(parent, components);
                newX = newAbsX - parentAbsPos.x;
                newY = newAbsY - parentAbsPos.y;
              }
            }
            
            updateComponent(id, {
              position: { ...comp.position, x: newX, y: newY },
            }, { save: false });
          }
        });
        setAlignmentLines([]); // 多选时不显示辅助线
        return;
      }
      
      // 单选拖拽
      const x = mouseX - dragOffset.x;
      const y = mouseY - dragOffset.y;

      const component = components.find(c => c.id === draggedComponent);
      if (component) {
        // 实时检测目标容器（用于跨容器拖拽时的辅助线计算）
        const targetContainer = findComponentAtPosition(mouseX, mouseY, components);
        const effectiveParent = (targetContainer && targetContainer.id !== component.id) 
          ? targetContainer.id 
          : component.parent;
        
        // 如果目标容器与当前父容器不同，需要转换坐标到目标容器的相对坐标系
        let relativeX = x;
        let relativeY = y;
        if (effectiveParent !== component.parent && targetContainer) {
          const targetAbsPos = getAbsolutePosition(targetContainer, components);
          const componentAbsPos = getAbsolutePosition(component, components);
          relativeX = (componentAbsPos.x - targetAbsPos.x) + (x - component.position.x);
          relativeY = (componentAbsPos.y - targetAbsPos.y) + (y - component.position.y);
        }
        
        // 创建临时组件用于辅助线计算
        const tempComponent = effectiveParent !== component.parent
          ? { ...component, parent: effectiveParent }
          : component;
        
        // 计算对齐辅助线和吸附位置
        const alignment = calculateAlignment(
          tempComponent,
          effectiveParent !== component.parent ? relativeX : x,
          effectiveParent !== component.parent ? relativeY : y,
          components,
          canvasSize
        );
        
        setAlignmentLines(alignment.lines);
        
        // 使用吸附后的位置
        if (effectiveParent !== component.parent && targetContainer) {
          const targetAbsPos = getAbsolutePosition(targetContainer, components);
          const parentAbsPos = component.parent 
            ? getAbsolutePosition(components.find(c => c.id === component.parent)!, components)
            : { x: 0, y: 0 };
          const snappedAbsX = targetAbsPos.x + alignment.x;
          const snappedAbsY = targetAbsPos.y + alignment.y;
          updateComponent(component.id, {
            position: { ...component.position, x: snappedAbsX - parentAbsPos.x, y: snappedAbsY - parentAbsPos.y },
          }, { save: false });
        } else {
          updateComponent(component.id, {
            position: { ...component.position, x: alignment.x, y: alignment.y },
          }, { save: false });
        }
      }
    }
  };

  const handleComponentMouseUp = () => {
    // 清除框选定时器
    if (boxSelectTimer) {
      clearTimeout(boxSelectTimer);
      setBoxSelectTimer(null);
    }
    
    // 结束框选
    if (isBoxSelecting) {
      setIsBoxSelecting(false);
      return;
    }
    
    // 如果正在调整大小，结束 resize
    if (isResizing) {
      handleResizeEnd();
      return;
    }
    
    // 记录是否有拖拽操作
    const hadDragOperation = !!draggedComponent;
    
    // 处理跨容器拖拽（框选移动不触发跨容器拖拽）
    // 注意：禁用自动跨容器移动，避免误操作
    // 用户可以通过属性面板手动修改父容器
    /* 跨容器拖拽逻辑已禁用（参见 git 历史） */

    handleCanvasMouseUp();
    setPendingDragComponent(null);
    setDraggedComponent(null);
    setAlignmentLines([]);
    setMultiDragOffsets(new Map());
    setIsBoxSelectMove(false); // 重置框选移动标志
    
    // 如果有拖拽操作，保存最终状态（触发一次 undo 快照 + 文件保存）
    if (hadDragOperation) {
      const saveToFile = useDesignerStore.getState().saveToFile;
      saveToFile();
    }
  };

  // 处理键盘事件，特别是delete键删除选中组件和方向键移动组件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 如果焦点在输入框、文本域或可编辑元素中，不处理快捷键
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // 方向键移动组件
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const ids = selectedComponents && selectedComponents.length > 0 
          ? selectedComponents 
          : (selectedComponent ? [selectedComponent] : []);
        
        if (ids.length === 0) return;
        
        e.preventDefault();
        
        // 计算移动距离（按住 Shift 键时移动 10px，否则移动 1px）
        const step = e.shiftKey ? 10 : 1;
        let deltaX = 0;
        let deltaY = 0;
        
        switch (e.key) {
          case 'ArrowUp':
            deltaY = -step;
            break;
          case 'ArrowDown':
            deltaY = step;
            break;
          case 'ArrowLeft':
            deltaX = -step;
            break;
          case 'ArrowRight':
            deltaX = step;
            break;
        }
        
        // 移动所有选中的组件（不触发保存），跳过 hg_list_item（位置由 list 自动管理）
        ids.forEach(id => {
          const comp = components.find(c => c.id === id);
          if (comp && !comp.locked && comp.type !== 'hg_list_item') {
            updateComponent(id, {
              position: {
                ...comp.position,
                x: comp.position.x + deltaX,
                y: comp.position.y + deltaY,
              },
            }, { save: false });
          }
        });
        
        // 移动完成后统一保存一次
        const saveToFile = useDesignerStore.getState().saveToFile;
        saveToFile();
        
        return;
      }

      // 当按下delete或backspace键，并且有选中的组件时，删除该组件
      if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedComponent || (selectedComponents && selectedComponents.length > 0))) {
        e.preventDefault();
        const ids = selectedComponents && selectedComponents.length ? selectedComponents : [selectedComponent!];
        const confirmMsg = ids.length > 1 
          ? t('Confirm delete N components').replace('{n}', String(ids.length))
          : t('Confirm delete selected component');
        const shouldDelete = window.confirm ? window.confirm(confirmMsg) : true;
        if (shouldDelete) {
          if (ids.length > 1) {
            removeComponents(ids);
          } else {
            removeComponent(ids[0]);
          }
          onComponentSelect(null);
          setSelectedComponents([]);
        }
      }
    };

    // 添加键盘事件监听器
    window.addEventListener('keydown', handleKeyDown);
    
    // 清理函数，移除事件监听器
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedComponent, selectedComponents, removeComponent, removeComponents, onComponentSelect, setSelectedComponents, components, updateComponent]);

  const renderComponent = (component: Component, componentList: Component[] = components) => {
    const isSelected = selectedComponent === component.id;
    const isMultiSelected = selectedComponents?.includes(component.id);
    const isHovered = !draggedComponent && useDesignerStore.getState().hoveredComponent === component.id;

    // 检查是否为列表项
    const isListItem = component.type === 'hg_list_item';

    const style = calculateComponentStyle(
      component,
      zoom,
      isSelected,
      isMultiSelected,
      isHovered,
      editingMode,
      isListItem,
      projectConfig,
      components,
      draggedComponent
    );

    const handleMouseEnter = () => {
      if (!draggedComponent) {
        setHoveredComponent(component.id);
      }
    };

    const handleMouseLeave = () => {
      if (!draggedComponent) {
        setHoveredComponent(null);
      }
    };

    // 双击处理：仅对 hg_canvas 组件触发编辑器
    const handleDoubleClick = (e: React.MouseEvent, id: string) => {
      if (component.type === 'hg_canvas' && onCanvasDoubleClick) {
        onCanvasDoubleClick(id);
      }
    };

    const handlers = createComponentHandlers(
      component.id,
      handleComponentMouseDown,
      handleMouseEnter,
      handleMouseLeave,
      handleComponentContextMenu,
      handleDoubleClick
    );

    // 使用控件注册表
    const Widget = widgetRegistry[component.type];
    
    if (!Widget) {
      // 未知组件类型，显示占位符
      return (
        <div key={component.id} style={style} {...handlers}>
          ⚠️ {component.type}
        </div>
      );
    }

    // 是否显示 resize handles（仅对 hg_label 类型，选中且未锁定的组件）
    const showResizeHandles = component.type === 'hg_label' && (isSelected || isMultiSelected) && !component.locked && !isResizing;

    // 处理 resize 开始
    const onResizeStartHandler = (e: React.MouseEvent, direction: ResizeDirection, compId: string) => {
      handleResizeStart(e, direction, compId, component);
    };

    // 容器组件需要渲染子组件
    const isContainer = isContainerType(component.type);
    
    if (isContainer) {
      // 正常渲染所有子组件
      const children = component.children?.map((childId) => {
        const child = componentList.find((c) => c.id === childId);
        return child ? renderComponent(child, componentList) : null;
      });

      return (
        <Widget key={component.id} component={component} style={style} handlers={handlers}>
          {children}
          {showResizeHandles && (
            <ResizeHandles
              componentId={component.id}
              width={component.position.width}
              height={component.position.height}
              onResizeStart={onResizeStartHandler}
            />
          )}
        </Widget>
      );
    }

    return (
      <Widget key={component.id} component={component} style={style} handlers={handlers}>
        {showResizeHandles && (
          <ResizeHandles
            componentId={component.id}
            width={component.position.width}
            height={component.position.height}
            onResizeStart={onResizeStartHandler}
          />
        )}
      </Widget>
    );
  };

  // 处理设计区域的滚动
  const handleContainerWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    // Ctrl + 滚轮：缩放（已有功能）
    if (e.ctrlKey) {
      e.preventDefault();
      handleWheel(e);
      return;
    }
    
    // Shift + 滚轮：左右滚动
    if (e.shiftKey) {
      e.preventDefault();
      const container = e.currentTarget;
      container.scrollLeft += e.deltaY;
      return;
    }
    
    // 普通滚轮：上下滚动（浏览器默认行为，不需要处理）
  }, [handleWheel]);

  // 扩展画布区域，使其成为可滚动的大型画布
  return (
    <div 
      className="designer-canvas-container"
      onWheel={handleContainerWheel}
    >
      {/* 可扩展的画布区域 */}
      <div
        ref={canvasRef}
        className="designer-canvas"
        style={{
            backgroundColor: canvasBackgroundColor,
            position: 'relative',
            minWidth: '100%',
            minHeight: '100%',
            cursor: isDragging ? 'grabbing' : isSpacePressed ? 'grab' : 'default',
            touchAction: 'none',
            WebkitUserSelect: 'none',
            msUserSelect: 'none',
            userSelect: 'none',
          }}
        onMouseDown={(e) => {
          // 先处理画布拖拽
          handleCanvasMouseDown(e);
          
          // 如果不是画布拖拽（Ctrl+左键或中键），则检测框选
          // 允许在任何地方（包括容器内部）触发框选
          if (e.button === 0 && !e.ctrlKey && !e.metaKey) {
            const coords = fromCanvasEvent(e.clientX, e.clientY, canvasRef.current, zoom, canvasOffset, false);
            if (!coords) return;
            const mouseX = coords.x;
            const mouseY = coords.y;

            // 检查是否点击在某个组件上
            const clickedComponent = findComponentAtPosition(mouseX, mouseY, components);
            
            // 如果点击在容器组件上（或空白区域），设置长按定时器
            if (!clickedComponent || isContainerType(clickedComponent.type)) {
              const timer = setTimeout(() => {
                setIsBoxSelecting(true);
                setBoxSelectStart({ x: mouseX, y: mouseY });
                setBoxSelectEnd({ x: mouseX, y: mouseY });
                setSelectedComponents([]); // 清空之前的选择
              }, 300);
              
              setBoxSelectTimer(timer);
            }
          }
        }}
        onMouseMove={handleComponentMouseMove}
        onMouseUp={handleComponentMouseUp}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onMouseLeave={handleCanvasMouseUp}
        onContextMenu={(e) => {
          e.preventDefault();

          // 检查右键点击位置是否在组件上
          const coords = fromCanvasEvent(e.clientX, e.clientY, canvasRef.current, zoom, canvasOffset, false);
          if (coords) {
            const clickedComp = findComponentAtPosition(coords.x, coords.y, components);
            
            // 点击在空白区域：显示画布菜单
            if (!clickedComp) {
              setCanvasMenuState({ visible: true, x: e.clientX, y: e.clientY });
              return;
            }
          }
          
          const ids = selectedComponents && selectedComponents.length ? selectedComponents : (selectedComponent ? [selectedComponent] : []);
          if (ids.length === 0) return;
          const label = ids.length > 1 
            ? t('Delete N components').replace('{n}', String(ids.length))
            : t('Delete selected component');
          const ok = window.confirm(label + '?');
          if (ok) {
            if (ids.length > 1) {
              removeComponents(ids);
            } else {
              removeComponent(ids[0]);
            }
            setSelectedComponents([]);
          }
        }}
      >
          {/* 缩放提示 */}
          {showZoomHint && (
            <div className="zoom-hint" style={{
              position: 'absolute',
              top: '10px',
              right: '10px',
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              color: 'white',
              padding: '5px 10px',
              borderRadius: '4px',
              fontSize: '12px',
              pointerEvents: 'none',
              zIndex: 1000
            }}>
              {t('Ctrl+Scroll to zoom')} ({Math.round(zoom * 100)}%)
            </div>
          )}
          
        <div
          style={{
            position: 'absolute',
            left: canvasOffset.x,
            top: canvasOffset.y,
            transform: `scale(${zoom / (window.devicePixelRatio || 1)})`,
            transformOrigin: '0 0',
            // 移除固定尺寸限制，允许组件放置在任意位置
          }}
        >
          {/* 渲染所有顶级组件，并递归渲染其子组件 */}
          {components
            .filter((c) => c.parent === null)
            .map((component) => renderComponent(component))}

          {/* 移动手柄覆盖层 - 独立于组件层，不受 overflow:hidden 影响 */}
          {(() => {
            // 收集所有需要显示移动手柄的选中组件
            const selectedIds = selectedComponent ? [selectedComponent, ...selectedComponents.filter(id => id !== selectedComponent)] : [...selectedComponents];
            const uniqueIds = [...new Set(selectedIds)];
            
            return uniqueIds.map(id => {
              const comp = components.find(c => c.id === id);
              if (!comp || comp.locked || comp.type === 'hg_list_item' || draggedComponent) return null;
              const absPos = getAbsolutePosition(comp, components);
              return (
                <MoveHandle
                  key={`move-${comp.id}`}
                  componentId={comp.id}
                  absX={absPos.x}
                  absY={absPos.y}
                  width={comp.position.width}
                  onMoveStart={handleMoveStart}
                />
              );
            });
          })()}
        </div>

        {/* 视图连接层 - 独立于组件层 */}
        <ViewConnectionLayer
          components={components}
          allViews={allViews || []}
          zoom={zoom / (window.devicePixelRatio || 1)}
          offset={canvasOffset}
          visible={showViewConnections}
        />

        {/* 对齐辅助线 */}
        {showAlignmentGuides && (
          <AlignmentGuides
            lines={alignmentLines}
            zoom={zoom / (window.devicePixelRatio || 1)}
            offset={canvasOffset}
          />
        )}

        {/* 框选区域 */}
        {isBoxSelecting && (
          <div
            style={{
              position: 'absolute',
              left: canvasOffset.x + Math.min(boxSelectStart.x, boxSelectEnd.x) * (zoom / (window.devicePixelRatio || 1)),
              top: canvasOffset.y + Math.min(boxSelectStart.y, boxSelectEnd.y) * (zoom / (window.devicePixelRatio || 1)),
              width: Math.abs(boxSelectEnd.x - boxSelectStart.x) * (zoom / (window.devicePixelRatio || 1)),
              height: Math.abs(boxSelectEnd.y - boxSelectStart.y) * (zoom / (window.devicePixelRatio || 1)),
              border: '2px dashed var(--vscode-focusBorder)',
              backgroundColor: 'rgba(0, 122, 204, 0.1)',
              pointerEvents: 'none',
              zIndex: 9999,
            }}
          />
        )}

        {/* Zoom indicator */}
        <div className="zoom-indicator">
          {Math.round(zoom * 100)}%
        </div>
      </div>

      {/* 右键菜单 */}
      <ContextMenu
        visible={menuState.visible}
        x={menuState.x}
        y={menuState.y}
        component={menuState.component}
        hasClipboard={!!useDesignerStore.getState().clipboard || useDesignerStore.getState().clipboardMultiple.length > 0}
        multiSelectCount={selectedComponents.length}
        onAction={handleMenuAction}
      />
      
      {/* 画布空白处右键菜单 */}
      {canvasMenuState.visible && (
        <div
          style={{
            position: 'fixed',
            left: canvasMenuState.x,
            top: canvasMenuState.y,
            zIndex: 10000,
            background: 'var(--vscode-menu-background, #252526)',
            border: '1px solid var(--vscode-menu-border, #454545)',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            padding: '4px 0',
            minWidth: 160,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              padding: '6px 24px',
              cursor: 'pointer',
              color: 'var(--vscode-menu-foreground, #ccc)',
              fontSize: 13,
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--vscode-menu-selectionBackground, #04395e)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={() => {
              setCanvasMenuState({ visible: false, x: 0, y: 0 });
              useDesignerStore.getState().fitContentToView();
            }}
          >
            {t('Fit All Content')}
          </div>
        </div>
      )}
    </div>
  );
};

export default DesignerCanvas;
