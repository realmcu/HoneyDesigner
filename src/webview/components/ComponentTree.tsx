import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useDesignerStore } from '../store';
import { ChevronDown, ChevronRight, Eye, EyeOff, Lock, Unlock, AlertTriangle } from 'lucide-react';
import { componentIconMap } from './ComponentLibrary';
import ComponentIcon from './icons/ComponentIcon';
import { findComponentsWithBrokenRefs } from '../utils/componentUtils';
import { t } from '../i18n';
import './ComponentTree.css';

// 共享展开/折叠状态的 Context
interface TreeExpandContextType {
  collapsedNodes: Set<string>;
  toggleCollapse: (id: string) => void;
}
const TreeExpandContext = React.createContext<TreeExpandContextType>({
  collapsedNodes: new Set(),
  toggleCollapse: () => {},
});

// 断裂引用 Context
const BrokenRefsContext = React.createContext<Set<string>>(new Set());

interface ComponentTreeNodeProps {
  componentId: string;
  level: number;
  onContextMenu?: (e: React.MouseEvent, componentId: string) => void;
}

const ComponentTreeNode: React.FC<ComponentTreeNodeProps> = ({ componentId, level, onContextMenu }) => {
  const {
    components,
    selectedComponent,
    selectedComponents,
    selectComponent,
    setSelectedComponents,
    updateComponent,
    centerViewOnCanvas,
    moveComponent,
    reorderSiblings,
    moveComponentToPosition,
  } = useDesignerStore();

  const [isDragOver, setIsDragOver] = useState(false);
  const [dropPosition, setDropPosition] = useState<'before' | 'after' | 'inside' | null>(null);

  const { collapsedNodes, toggleCollapse } = React.useContext(TreeExpandContext);
  const brokenRefComponents = React.useContext(BrokenRefsContext);
  const hasBrokenRef = brokenRefComponents.has(componentId);
  const isExpanded = !collapsedNodes.has(componentId);

  const component = components.find(c => c.id === componentId);
  if (!component) return null;

  // 获取子组件并按 zIndex 排序（确保组件树显示顺序和层级一致）
  const children = components
    .filter(c => c.parent === componentId)
    .sort((a, b) => {
      const zIndexA = typeof a.zIndex === 'number' ? a.zIndex : 0;
      const zIndexB = typeof b.zIndex === 'number' ? b.zIndex : 0;
      return zIndexA - zIndexB;
    });
  const hasChildren = children.length > 0;

  const clickTimerRef = React.useRef<number | null>(null);

  // 判断是否可以拖拽
  const canDrag = (comp: NonNullable<typeof component>) => {
    return true;
  };

  // 判断是否可以作为拖放目标
  const canDrop = (draggedComp: NonNullable<typeof component>, targetComp: NonNullable<typeof component>) => {
    // 不能拖到自己身上
    if (draggedComp.id === targetComp.id) return false;

    // hg_list_item 只能拖到 hg_list 中
    if (draggedComp.type === 'hg_list_item') {
      return targetComp.type === 'hg_list';
    }

    // 非 hg_list_item 不能拖到 hg_list 中
    if (targetComp.type === 'hg_list') {
      return false; // 前面已经处理了 hg_list_item 的情况
    }

    // 只有顶级容器控件（hg_view, hg_window）和 hg_list_item 可以作为父组件
    // hg_canvas 和 hg_list 虽然可以包含子组件，但它们本身必须在容器内，不能作为顶级容器
    const containerTypes = ['hg_view', 'hg_window', 'hg_list_item', 'hg_canvas', 'hg_list'];
    if (!containerTypes.includes(targetComp.type)) {
      return false;
    }

    // 不能拖到自己的子组件中
    const isDescendant = (parentId: string | null | undefined, targetId: string): boolean => {
      if (!parentId) return false;
      if (parentId === targetId) return true;
      const parent = components.find(c => c.id === parentId);
      return parent ? isDescendant(parent.parent, targetId) : false;
    };

    if (isDescendant(targetComp.id, draggedComp.id)) {
      return false;
    }

    return true;
  };

  const handleSelect = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    // 清除之前的定时器，防止双击时触发单击逻辑
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    
    const multi = e.ctrlKey || e.metaKey || e.shiftKey;
    
    // 延迟执行单击逻辑，给双击事件判断的时间
    clickTimerRef.current = window.setTimeout(() => {
      if (multi) {
        const next = selectedComponents.includes(componentId)
          ? selectedComponents.filter((id: string) => id !== componentId)
          : [...selectedComponents, componentId];
        setSelectedComponents(next);
      } else {
        selectComponent(componentId);
      }
      clickTimerRef.current = null;
    }, 200);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    // 取消单击的延迟执行
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    
    selectComponent(componentId);
    centerViewOnCanvas(componentId);
  };

  const handleToggleVisibility = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateComponent(componentId, { visible: !component.visible });
  };

  const handleToggleLock = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateComponent(componentId, { locked: !component.locked });
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onContextMenu) {
      onContextMenu(e, componentId);
    }
  };

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasChildren) {
      toggleCollapse(componentId);
    }
  };

  // 拖拽事件处理
  const handleDragStart = (e: React.DragEvent) => {
    if (!canDrag(component)) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('componentId', componentId);
    e.stopPropagation();
  };

  const handleDragOver = (e: React.DragEvent) => {
    const draggedId = e.dataTransfer.types.includes('componentid') ? 'temp' : null;
    if (!draggedId) return;

    e.preventDefault();
    e.stopPropagation();

    // 计算鼠标在节点中的相对位置，决定是插入前、插入后还是作为子节点
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;
    
    // 如果是容器控件，支持三种放置方式
    const isContainer = component.type === 'hg_view' || 
                       component.type === 'hg_window' || 
                       component.type === 'hg_list' ||
                       component.type === 'hg_list_item';
    
    if (isContainer && hasChildren && isExpanded) {
      // 容器控件：上 1/4 插入前，中间 1/2 作为子节点，下 1/4 插入后
      if (y < height * 0.25) {
        setDropPosition('before');
      } else if (y > height * 0.75) {
        setDropPosition('after');
      } else {
        setDropPosition('inside');
      }
    } else if (isContainer) {
      // 容器控件但没有子节点或未展开：上 1/3 插入前，中间 1/3 作为子节点，下 1/3 插入后
      if (y < height * 0.33) {
        setDropPosition('before');
      } else if (y > height * 0.67) {
        setDropPosition('after');
      } else {
        setDropPosition('inside');
      }
    } else {
      // 非容器控件：上半部分插入前，下半部分插入后
      if (y < height * 0.5) {
        setDropPosition('before');
      } else {
        setDropPosition('after');
      }
    }
    
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.stopPropagation();
    setIsDragOver(false);
    setDropPosition(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const draggedId = e.dataTransfer.getData('componentId');
    if (!draggedId || draggedId === componentId) {
      setIsDragOver(false);
      setDropPosition(null);
      return;
    }

    const draggedComp = components.find(c => c.id === draggedId);
    if (!draggedComp) {
      setIsDragOver(false);
      setDropPosition(null);
      return;
    }

    const position = dropPosition;
    setIsDragOver(false);
    setDropPosition(null);

    // 根据放置位置执行不同的操作
    if (position === 'inside') {
      // hg_view 只能在顶层排序，不能拖入其他容器
      if (draggedComp.type === 'hg_view') {
        return;
      }
      // hg_list_item 只能通过 before/after 排序，不能拖入容器内部
      if (draggedComp.type === 'hg_list_item') {
        return;
      }
      // 作为子节点
      if (!canDrop(draggedComp, component)) {
        return;
      }
      moveComponent(draggedId, componentId);
    } else if (position === 'before' || position === 'after') {
      // 插入到兄弟位置
      // 验证：拖拽的组件和目标组件必须能有相同的父组件
      const targetParent = component.parent;
      
      // 特殊验证：如果目标是 hg_list_item，拖拽的也必须是 hg_list_item
      if (component.type === 'hg_list_item' && draggedComp.type !== 'hg_list_item') {
        return;
      }
      if (draggedComp.type === 'hg_list_item' && component.type !== 'hg_list_item') {
        return;
      }
      
      // 验证：只有 hg_view 可以放在顶层（parent 为 null）
      // hg_window, hg_list, hg_canvas 等都必须在容器内
      if (!targetParent && draggedComp.type !== 'hg_view') {
        return;
      }
      // hg_view 只能放在顶层，不能放入其他容器
      if (targetParent && draggedComp.type === 'hg_view') {
        return;
      }
      
      // 如果目标父组件存在，验证拖拽组件是否可以放入
      if (targetParent) {
        const parentComp = components.find(c => c.id === targetParent);
        if (parentComp && !canDrop(draggedComp, parentComp)) {
          return;
        }
      }
      
      // 执行插入操作
      insertComponentAt(draggedId, componentId, position);
    }
  };

  // 在指定组件前后插入
  const insertComponentAt = (draggedId: string, targetId: string, position: 'before' | 'after') => {
    const state = useDesignerStore.getState();
    const draggedComp = state.components.find(c => c.id === draggedId);
    const targetComp = state.components.find(c => c.id === targetId);
    
    if (!draggedComp || !targetComp) return;
    
    const targetParent = targetComp.parent;
    
    // 获取同级组件列表（按 zIndex 排序以匹配视觉顺序）
    const siblings = state.components.filter(c => c.parent === targetParent)
      .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    const targetIndex = siblings.findIndex(c => c.id === targetId);
    const draggedIndex = siblings.findIndex(c => c.id === draggedId);
    
    // 如果已经在同一父组件下，只需要调整顺序
    if (draggedComp.parent === targetParent) {
      // 计算新的索引
      let newIndex = targetIndex;
      if (position === 'after') {
        newIndex = targetIndex + 1;
      }
      
      // 如果拖拽组件在目标组件之前，移除后目标索引会前移一位，需要补偿
      if (draggedIndex < targetIndex) {
        newIndex = newIndex - 1;
      }
      
      if (draggedIndex !== newIndex) {
        reorderSiblings(draggedId, targetParent, newIndex);
      }
    } else {
      // 需要改变父组件并插入到指定位置
      moveComponentToPosition(draggedId, targetParent, targetId, position);
    }
  };

  const isSelected = selectedComponent === componentId || selectedComponents.includes(componentId);

  // 获取组件图标名（缺失时由 ComponentIcon 回落到占位图标）
  const getComponentIcon = () => {
    // 使用组件库中定义的图标
    return componentIconMap[component.type];
  };

  // 获取组件显示名称（使用 id，与属性面板 Name 字段一致）
  const getComponentDisplayName = () => {
    return component.id;
  };

  return (
    <div 
      className={`tree-node ${isSelected ? 'selected' : ''} ${isDragOver && dropPosition ? `drag-${dropPosition}` : ''} ${!component.visible ? 'hidden-component' : ''} ${hasBrokenRef ? 'broken-ref' : ''}`}
      draggable={canDrag(component)}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-component-id={componentId}
    >
      <div
        className="tree-node-content"
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleSelect}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        {hasChildren && (
          <div className="tree-expand-icon" onClick={handleToggleExpand}>
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </div>
        )}
        {!hasChildren && <div className="tree-spacer" />}

        <div className="tree-node-icon">
          <ComponentIcon name={getComponentIcon()} size={16} />
        </div>

        <div className="tree-node-label">{getComponentDisplayName()}</div>

        {hasBrokenRef && (
          <div className="tree-warning-icon" title={t('Broken event reference')}>
            <AlertTriangle size={14} />
          </div>
        )}

        <div className="tree-node-actions">
          <div
            className="tree-action-button"
            onClick={handleToggleVisibility}
            title={component.visible ? t('Hide') : t('Show')}
          >
            {component.visible ? <Eye size={14} /> : <EyeOff size={14} />}
          </div>
          <div
            className="tree-action-button"
            onClick={handleToggleLock}
            title={component.locked ? t('Unlock') : t('Lock')}
          >
            {component.locked ? <Lock size={14} /> : <Unlock size={14} />}
          </div>
        </div>
      </div>

      {isExpanded && hasChildren && (
        <div className="tree-children">
          {children.map(child => (
            <ComponentTreeNode
              key={child.id}
              componentId={child.id}
              level={level + 1}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const ComponentTree: React.FC<{ onContextMenu?: (e: React.MouseEvent, componentId: string) => void; isTabActive?: boolean }> = ({ onContextMenu, isTabActive }) => {
  const { components, allHmlFiles, currentFilePath, vscodeAPI, selectedComponent } = useDesignerStore();
  const selectComponent = useDesignerStore((s) => s.selectComponent);
  const treeContentRef = React.useRef<HTMLDivElement>(null);
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedNodes(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const getAncestorIds = useCallback((componentId: string) => {
    const ancestorIds: string[] = [];
    const comp = components.find(c => c.id === componentId);
    let parentId = comp?.parent || null;

    while (parentId) {
      ancestorIds.unshift(parentId);
      const parent = components.find(c => c.id === parentId);
      parentId = parent?.parent || null;
    }

    return ancestorIds;
  }, [components]);

  // 获取根组件并按 zIndex 排序（确保组件树显示顺序和层级一致）
  const rootComponents = components
    .filter(c => c.parent === null)
    .sort((a, b) => {
      const zIndexA = typeof a.zIndex === 'number' ? a.zIndex : 0;
      const zIndexB = typeof b.zIndex === 'number' ? b.zIndex : 0;
      return zIndexA - zIndexB;
    });

  const handleFileChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedPath = e.target.value;
    if (selectedPath && selectedPath !== currentFilePath && vscodeAPI) {
      vscodeAPI.postMessage({
        command: 'switchFile',
        filePath: selectedPath
      });
    }
  };

  // 滚动到选中组件的通用逻辑
  const scrollToSelected = useCallback(() => {
    if (!selectedComponent || !treeContentRef.current) return;
    
    // 展开所有祖先节点
    const ancestorIds: string[] = [];
    const comp = components.find(c => c.id === selectedComponent);
    if (comp) {
      let parentId = comp.parent;
      while (parentId) {
        ancestorIds.push(parentId);
        const parent = components.find(c => c.id === parentId);
        parentId = parent?.parent || null;
      }
    }
    if (ancestorIds.length > 0) {
      setCollapsedNodes(prev => {
        const hasCollapsed = ancestorIds.some(id => prev.has(id));
        if (!hasCollapsed) return prev;
        const next = new Set(prev);
        ancestorIds.forEach(id => next.delete(id));
        return next;
      });
    }

    // 延迟执行，确保 DOM 已更新（祖先展开后子节点才会渲染）
    setTimeout(() => {
      const container = treeContentRef.current;
      const selectedNode = container?.querySelector(`[data-component-id="${selectedComponent}"]`);
      if (selectedNode && container) {
        const nodeContent = selectedNode.querySelector(':scope > .tree-node-content');
        if (nodeContent) {
          const containerRect = container.getBoundingClientRect();
          const nodeRect = nodeContent.getBoundingClientRect();
          
          // 检查节点是否在可视区域内
          if (nodeRect.top < containerRect.top || nodeRect.bottom > containerRect.bottom) {
            nodeContent.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
              inline: 'nearest'
            });
          }
        }
        // 滚动后更新 sticky parents
        setTimeout(() => computeStickyParents(), 350);
      }
    }, 100);
  }, [selectedComponent, components]);

  // 当选中组件变化时，展开祖先节点并滚动到对应的节点
  React.useEffect(() => {
    if (isTabActive) {
      scrollToSelected();
    }
  }, [selectedComponent]);

  // 当切换到控件树面板时，自动滚动到选中的控件
  React.useEffect(() => {
    if (isTabActive && selectedComponent) {
      scrollToSelected();
    }
  }, [isTabActive]);

  const expandContextValue = React.useMemo(() => ({ collapsedNodes, toggleCollapse }), [collapsedNodes, toggleCollapse]);

  // 计算有断裂引用的组件集合（包含跨文件 view 验证）
  const allViews = useDesignerStore((state) => state.allViews);
  const allViewIds = useMemo(() => new Set((allViews || []).map(v => v.id)), [allViews]);
  const brokenRefComponents = useMemo(() => findComponentsWithBrokenRefs(components, allViewIds), [components, allViewIds]);

  // Sticky scroll：滚动时 pin 父节点到顶部
  const [stickyParents, setStickyParents] = useState<string[]>([]);
  const stickyRafRef = useRef<number | null>(null);
  const prevStickyRef = useRef<string>('');

  const computeStickyParents = useCallback(() => {
    const container = treeContentRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    // 计算 sticky header 实际高度，用于偏移视口顶部（因为 sticky header 覆盖在滚动内容上方）
    const stickyHeader = container.parentElement?.querySelector('.tree-sticky-header');
    const stickyHeight = stickyHeader ? stickyHeader.getBoundingClientRect().height : 0;
    const viewportTop = containerRect.top + stickyHeight;

    // 查找 .tree-node-content（28px header）而不是 .tree-node（包含子树）
    const allNodeContents = container.querySelectorAll('.tree-node-content');
    let firstVisibleId: string | null = null;

    for (const nodeContent of allNodeContents) {
      const rect = nodeContent.getBoundingClientRect();
      if (rect.bottom > viewportTop) {
        const treeNode = nodeContent.closest('[data-component-id]');
        firstVisibleId = treeNode?.getAttribute('data-component-id') || null;
        break;
      }
    }

    if (!firstVisibleId) {
      if (prevStickyRef.current !== '') {
        prevStickyRef.current = '';
        setStickyParents([]);
      }
      return;
    }

    const comp = components.find(c => c.id === firstVisibleId);
    if (!comp) {
      if (prevStickyRef.current !== '') {
        prevStickyRef.current = '';
        setStickyParents([]);
      }
      return;
    }

    // 构建父链
    const parentChain: string[] = [];
    let parentId = comp.parent;
    while (parentId) {
      parentChain.unshift(parentId);
      const parent = components.find(c => c.id === parentId);
      parentId = parent?.parent || null;
    }

    // 只 pin header 已滚出视口的父节点
    const pinnedParents: string[] = [];
    for (const pid of parentChain) {
      const parentNode = container.querySelector(`[data-component-id="${pid}"]`);
      if (parentNode) {
        const headerContent = parentNode.querySelector(':scope > .tree-node-content');
        if (headerContent) {
          const rect = headerContent.getBoundingClientRect();
          if (rect.top < viewportTop) {
            pinnedParents.push(pid);
          }
        }
      }
    }

    // 只在内容变化时更新，避免不必要的重渲染
    const key = pinnedParents.join(',');
    if (key !== prevStickyRef.current) {
      prevStickyRef.current = key;
      setStickyParents(pinnedParents);
    }
  }, [components]);

  const alignCollapsedStickyParent = useCallback((componentId: string) => {
    const container = treeContentRef.current;
    if (!container) return;

    const node = container.querySelector(`[data-component-id="${componentId}"]`);
    const nodeContent = node?.querySelector(':scope > .tree-node-content');
    if (!nodeContent) return;

    const containerRect = container.getBoundingClientRect();
    const ancestorCount = getAncestorIds(componentId).length;
    const expectedStickyHeight = ancestorCount > 0 ? ancestorCount * 28 + 1 : 0;
    const targetTop = containerRect.top + expectedStickyHeight;
    const nodeRect = nodeContent.getBoundingClientRect();
    const delta = nodeRect.top - targetTop;

    if (Math.abs(delta) > 1) {
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const nextScrollTop = Math.min(Math.max(container.scrollTop + delta, 0), maxScrollTop);
      container.scrollTop = nextScrollTop;
    }

    requestAnimationFrame(computeStickyParents);
  }, [computeStickyParents, getAncestorIds]);

  useEffect(() => {
    const container = treeContentRef.current;
    if (!container) return;

    const handleScroll = () => {
      // 去重：同一帧内只执行一次
      if (stickyRafRef.current !== null) return;
      stickyRafRef.current = requestAnimationFrame(() => {
        stickyRafRef.current = null;
        computeStickyParents();
      });
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (stickyRafRef.current !== null) {
        cancelAnimationFrame(stickyRafRef.current);
      }
    };
  }, [computeStickyParents]);

  // 拖拽时的自动滚动
  const scrollTimerRef = React.useRef<number | null>(null);
  const isDraggingRef = React.useRef(false);

  // Use capture phase + document-level listeners to detect drag state
  // (child nodes call e.stopPropagation on dragover)
  React.useEffect(() => {
    const container = treeContentRef.current;
    if (!container) return;

    const edgeSize = 60;

    const handleDragOverCapture = (e: DragEvent) => {
      isDraggingRef.current = true;

      const rect = container.getBoundingClientRect();
      const y = e.clientY;

      if (scrollTimerRef.current) {
        cancelAnimationFrame(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }

      // Only auto-scroll if cursor is within the container's horizontal bounds
      if (e.clientX < rect.left || e.clientX > rect.right) return;

      const distFromTop = y - rect.top;
      const distFromBottom = rect.bottom - y;

      if (distFromTop >= 0 && distFromTop < edgeSize) {
        // Speed proportional to proximity: closer to edge = faster (max 6px/frame)
        const speed = Math.max(1, Math.ceil((1 - distFromTop / edgeSize) * 6));
        const tick = () => {
          if (!isDraggingRef.current) return;
          container.scrollTop -= speed;
          scrollTimerRef.current = requestAnimationFrame(tick);
        };
        scrollTimerRef.current = requestAnimationFrame(tick);
      } else if (distFromBottom >= 0 && distFromBottom < edgeSize) {
        const speed = Math.max(1, Math.ceil((1 - distFromBottom / edgeSize) * 6));
        const tick = () => {
          if (!isDraggingRef.current) return;
          container.scrollTop += speed;
          scrollTimerRef.current = requestAnimationFrame(tick);
        };
        scrollTimerRef.current = requestAnimationFrame(tick);
      }
    };

    const handleDragEnd = () => {
      isDraggingRef.current = false;
      if (scrollTimerRef.current) {
        cancelAnimationFrame(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
    };

    const handleDrop = () => {
      handleDragEnd();
    };

    // Capture phase to get events before children stop propagation
    container.addEventListener('dragover', handleDragOverCapture, true);
    document.addEventListener('dragend', handleDragEnd);
    document.addEventListener('drop', handleDrop);

    return () => {
      container.removeEventListener('dragover', handleDragOverCapture, true);
      document.removeEventListener('dragend', handleDragEnd);
      document.removeEventListener('drop', handleDrop);
      if (scrollTimerRef.current) {
        cancelAnimationFrame(scrollTimerRef.current);
      }
    };
  }, []);

  return (
    <TreeExpandContext.Provider value={expandContextValue}>
    <BrokenRefsContext.Provider value={brokenRefComponents}>
    <div className="component-tree">
      {allHmlFiles && allHmlFiles.length > 1 && (
        <div className="tree-file-selector">
          <select 
            value={currentFilePath || ''} 
            onChange={handleFileChange}
            className="file-select"
          >
            {allHmlFiles.map((file: {path: string, name: string, relativePath: string}) => (
              <option key={file.path} value={file.path}>
                {file.relativePath}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="tree-scroll-wrapper">
        {/* Sticky scroll 父节点 - 绝对定位覆盖在滚动区域上方，不影响布局 */}
        {stickyParents.length > 0 && (
          <div className="tree-sticky-header">
            {stickyParents.map((parentId) => {
              const comp = components.find(c => c.id === parentId);
              if (!comp) return null;
              // 计算实际层级
              let level = 0;
              let pid = comp.parent;
              while (pid) {
                level++;
                const p = components.find(c => c.id === pid);
                pid = p?.parent || null;
              }
              const icon = componentIconMap[comp.type];
              return (
                <div
                  key={parentId}
                  className={`tree-sticky-item ${selectedComponent === parentId ? 'selected' : ''}`}
                  style={{ paddingLeft: `${level * 12 + 8}px` }}
                  onClick={() => {
                    selectComponent(parentId);
                  }}
                >
                  <div
                    className="tree-expand-icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapse(parentId);
                      requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                          alignCollapsedStickyParent(parentId);
                        });
                      });
                    }}
                  >
                    <ChevronDown size={14} />
                  </div>
                  <div className="tree-node-icon">
                    <ComponentIcon name={icon} size={16} />
                  </div>
                  <div className="tree-node-label">{comp.id}</div>
                </div>
              );
            })}
          </div>
        )}
        <div className="tree-content" ref={treeContentRef}>
        {rootComponents.length === 0 ? (
          <div className="tree-empty">
            {t('No components')}
            <div className="tree-empty-tip">
              {t('Drag from component library to add')}
            </div>
          </div>
        ) : (
          rootComponents.map(component => (
            <ComponentTreeNode
              key={component.id}
              componentId={component.id}
              level={0}
              onContextMenu={onContextMenu}
            />
          ))
        )}
      </div>
      </div>
    </div>
    </BrokenRefsContext.Provider>
    </TreeExpandContext.Provider>
  );
};

export default ComponentTree;
