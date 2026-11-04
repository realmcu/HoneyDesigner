import React from 'react';
import { Component } from '../types';
import { getAbsolutePosition } from '../utils/componentUtils';
import { ResizeHandles, ResizeDirection } from './ResizeHandles';

/** 画布上可直接拖拽手柄修改尺寸的组件类型，与 DesignerCanvas 保持一致 */
const RESIZABLE_TYPES: Component['type'][] = ['hg_label', 'hg_rect', 'hg_circle', 'hg_arc', 'hg_progress'];
/** 圆形/弧形只能等比缩放，仅显示四角手柄 */
const CORNER_DIRECTIONS: ResizeDirection[] = ['nw', 'ne', 'sw', 'se'];
const RADIUS_SIZED_TYPES: Component['type'][] = ['hg_circle', 'hg_arc'];

interface SelectionOverlayProps {
  components: Component[];
  /** 当前选中的组件 id（单选） */
  selectedId: string | null;
  /** 多选集合 */
  selectedIds: string[];
  /** 正在拖拽/缩放时隐藏选中框，避免和实时反馈打架 */
  dragging: boolean;
  onResizeStart: (e: React.MouseEvent, direction: ResizeDirection, componentId: string, component: Component) => void;
}

/**
 * 选中框覆盖层
 *
 * 之前选中框（outline）和尺寸手柄都画在控件自身内部，有两个问题：
 *   1. 被上层控件盖住 —— 看不出选中的是哪个，只有拖动时临时抬高 z-index 才露出来；
 *   2. 被父容器 overflow:hidden 裁掉 —— 子控件贴着容器边缘时只剩一条边。
 *
 * 这里把选中框和尺寸手柄提到组件层旁边单独一层（与控件同一套画布坐标，
 * 但不嵌在控件内部），因此不受兄弟控件的 z-index 和父容器裁剪影响。
 * 覆盖层本身 pointer-events: none，只有尺寸手柄单独接收鼠标事件。
 */
export const SelectionOverlay: React.FC<SelectionOverlayProps> = ({
  components,
  selectedId,
  selectedIds,
  dragging,
  onResizeStart,
}) => {
  if (dragging) {
    return null;
  }

  const ids = Array.from(new Set([...(selectedId ? [selectedId] : []), ...selectedIds]));
  if (ids.length === 0) {
    return null;
  }

  // 多选时只有主选中项显示尺寸手柄，其余只画框
  const handleOwnerId = selectedId && ids.includes(selectedId) ? selectedId : ids[0];

  return (
    <div className="selection-overlay">
      {ids.map((id) => {
        const comp = components.find((c) => c.id === id);
        if (!comp || comp.visible === false) {
          return null;
        }

        const abs = getAbsolutePosition(comp, components);
        const isPrimary = id === handleOwnerId;
        const showHandles = isPrimary
          && RESIZABLE_TYPES.includes(comp.type)
          && !comp.locked;

        return (
          <React.Fragment key={id}>
            <div
              className={`selection-overlay-box${comp.locked ? ' locked' : ''}${isPrimary ? '' : ' secondary'}`}
              style={{
                left: abs.x,
                top: abs.y,
                width: comp.position.width,
                height: comp.position.height,
              }}
            />
            {showHandles && (
              <div
                className="selection-overlay-handles"
                style={{
                  left: abs.x,
                  top: abs.y,
                  width: comp.position.width,
                  height: comp.position.height,
                }}
              >
                <ResizeHandles
                  componentId={comp.id}
                  width={comp.position.width}
                  height={comp.position.height}
                  directions={RADIUS_SIZED_TYPES.includes(comp.type) ? CORNER_DIRECTIONS : undefined}
                  onResizeStart={(e, direction, componentId) =>
                    onResizeStart(e, direction, componentId, comp)
                  }
                />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default SelectionOverlay;
