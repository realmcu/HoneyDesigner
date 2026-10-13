import React from 'react';
import './ResizeHandles.css';

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

interface ResizeHandlesProps {
  componentId: string;
  width: number;
  height: number;
  /** 只显示指定方向的手柄，默认显示全部 8 个 */
  directions?: ResizeDirection[];
  onResizeStart: (e: React.MouseEvent, direction: ResizeDirection, componentId: string) => void;
}

/**
 * 组件调整大小手柄
 * 在选中组件的四角和四边中点显示 8 个拖拽手柄
 */
export const ResizeHandles: React.FC<ResizeHandlesProps> = ({
  componentId,
  width,
  height,
  directions,
  onResizeStart,
}) => {
  const handleSize = 8;
  const halfSize = handleSize / 2;

  // 8 个手柄的位置配置
  const handles: { direction: ResizeDirection; style: React.CSSProperties }[] = [
    // 四角
    { direction: 'nw', style: { top: -halfSize, left: -halfSize, cursor: 'nw-resize' } },
    { direction: 'ne', style: { top: -halfSize, right: -halfSize, cursor: 'ne-resize' } },
    { direction: 'sw', style: { bottom: -halfSize, left: -halfSize, cursor: 'sw-resize' } },
    { direction: 'se', style: { bottom: -halfSize, right: -halfSize, cursor: 'se-resize' } },
    // 四边中点
    { direction: 'n', style: { top: -halfSize, left: width / 2 - halfSize, cursor: 'n-resize' } },
    { direction: 's', style: { bottom: -halfSize, left: width / 2 - halfSize, cursor: 's-resize' } },
    { direction: 'w', style: { top: height / 2 - halfSize, left: -halfSize, cursor: 'w-resize' } },
    { direction: 'e', style: { top: height / 2 - halfSize, right: -halfSize, cursor: 'e-resize' } },
  ];

  const handleMouseDown = (e: React.MouseEvent, direction: ResizeDirection) => {
    e.stopPropagation();
    e.preventDefault();
    onResizeStart(e, direction, componentId);
  };

  return (
    <>
      {handles.filter(({ direction }) => !directions || directions.includes(direction)).map(({ direction, style }) => (
        <div
          key={direction}
          className={`resize-handle resize-handle-${direction}`}
          style={{
            position: 'absolute',
            width: handleSize,
            height: handleSize,
            ...style,
          }}
          onMouseDown={(e) => handleMouseDown(e, direction)}
        />
      ))}
    </>
  );
};

export default ResizeHandles;
