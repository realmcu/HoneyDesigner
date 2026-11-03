import { Component } from '../types';
import { AlignmentLine } from '../components/AlignmentGuides';
import { t } from '../i18n';

const SNAP_THRESHOLD = 8; // 吸附阈值（像素）

export interface AlignmentResult {
  x: number;
  y: number;
  lines: AlignmentLine[];
}

/**
 * 计算组件的绝对位置（递归计算所有父容器的位置）
 */
function getAbsolutePosition(component: Component, allComponents: Component[]): { x: number; y: number } {
  let absX = component.position.x;
  let absY = component.position.y;
  
  let current = component;
  while (current.parent) {
    const parent = allComponents.find(c => c.id === current.parent);
    if (!parent) break;
    absX += parent.position.x;
    absY += parent.position.y;
    current = parent;
  }
  
  return { x: absX, y: absY };
}

/**
 * 计算对齐辅助线和吸附位置
 */
export function calculateAlignment(
  draggedComponent: Component,
  newX: number,
  newY: number,
  allComponents: Component[],
  canvasSize: { width: number; height: number }
): AlignmentResult {
  const lines: AlignmentLine[] = [];
  let snappedX = newX;
  let snappedY = newY;

  // 获取拖拽组件的尺寸
  const draggedWidth = draggedComponent.position.width || 0;
  const draggedHeight = draggedComponent.position.height || 0;
  const draggedCenterX = newX + draggedWidth / 2;
  const draggedCenterY = newY + draggedHeight / 2;
  const draggedRight = newX + draggedWidth;
  const draggedBottom = newY + draggedHeight;

  // 找到父容器
  const parent = draggedComponent.parent
    ? allComponents.find(c => c.id === draggedComponent.parent)
    : null;

  // 计算父容器的绝对位置（用于渲染辅助线）
  const parentAbsPos = parent ? getAbsolutePosition(parent, allComponents) : { x: 0, y: 0 };

  // 如果有父容器，子组件坐标是相对于父容器的
  // 所以容器的"中心"应该是相对坐标系的中心
  const containerX = 0; // 相对坐标系，父容器左边界为 0
  const containerY = 0; // 相对坐标系，父容器顶边界为 0
  const containerWidth = parent?.position.width || canvasSize.width;
  const containerHeight = parent?.position.height || canvasSize.height;
  const containerCenterX = containerWidth / 2; // 相对中心 X
  const containerCenterY = containerHeight / 2; // 相对中心 Y
  
  // 绝对坐标的容器中心（用于渲染辅助线）
  const absCenterX = parentAbsPos.x + containerCenterX;
  const absCenterY = parentAbsPos.y + containerCenterY;

  // 获取同级组件（排除自己）
  const siblings = allComponents.filter(
    c => c.id !== draggedComponent.id && c.parent === draggedComponent.parent
  );

  // 始终显示容器中心线（半透明），方便用户参考
  lines.push({
    type: 'vertical',
    position: absCenterX, // 使用绝对坐标
    color: 'rgba(0, 255, 0, 0.3)', // 半透明绿色
  });
  lines.push({
    type: 'horizontal',
    position: absCenterY, // 使用绝对坐标
    color: 'rgba(0, 255, 0, 0.3)', // 半透明绿色
  });

  // 1. 检查与容器中心对齐（以控件中心为目标）
  if (Math.abs(draggedCenterX - containerCenterX) < SNAP_THRESHOLD) {
    snappedX = containerCenterX - draggedWidth / 2;
    lines.push({
      type: 'vertical',
      position: absCenterX, // 使用绝对坐标
      label: t('Align Center'),
      color: '#00ff00', // 亮绿色高亮
    });
  }

  if (Math.abs(draggedCenterY - containerCenterY) < SNAP_THRESHOLD) {
    snappedY = containerCenterY - draggedHeight / 2;
    lines.push({
      type: 'horizontal',
      position: absCenterY, // 使用绝对坐标
      label: t('Align Middle'),
      color: '#00ff00', // 亮绿色高亮
    });
  }

  // 2. 检查与容器边缘对齐（以控件边界为目标）
  // 左边缘对齐
  if (Math.abs(newX - containerX) < SNAP_THRESHOLD) {
    snappedX = containerX;
    lines.push({
      type: 'vertical',
      position: parentAbsPos.x + containerX, // 使用绝对坐标
      label: t('Align Left'),
      color: '#ff00ff',
    });
  }

  // 顶边缘对齐
  if (Math.abs(newY - containerY) < SNAP_THRESHOLD) {
    snappedY = containerY;
    lines.push({
      type: 'horizontal',
      position: parentAbsPos.y + containerY, // 使用绝对坐标
      label: t('Align Top'),
      color: '#ff00ff',
    });
  }

  // 右边缘对齐
  if (Math.abs(draggedRight - (containerX + containerWidth)) < SNAP_THRESHOLD) {
    snappedX = containerX + containerWidth - draggedWidth;
    lines.push({
      type: 'vertical',
      position: parentAbsPos.x + containerX + containerWidth, // 使用绝对坐标
      label: t('Align Right'),
      color: '#ff00ff',
    });
  }

  // 底边缘对齐
  if (Math.abs(draggedBottom - (containerY + containerHeight)) < SNAP_THRESHOLD) {
    snappedY = containerY + containerHeight - draggedHeight;
    lines.push({
      type: 'horizontal',
      position: parentAbsPos.y + containerY + containerHeight, // 使用绝对坐标
      label: t('Align Bottom'),
      color: '#ff00ff',
    });
  }

  // 3. 检查与同级组件对齐
  for (const sibling of siblings) {
    const siblingX = sibling.position.x;
    const siblingY = sibling.position.y;
    const siblingWidth = sibling.position.width || 0;
    const siblingHeight = sibling.position.height || 0;
    const siblingCenterX = siblingX + siblingWidth / 2;
    const siblingCenterY = siblingY + siblingHeight / 2;
    const siblingRight = siblingX + siblingWidth;
    const siblingBottom = siblingY + siblingHeight;

    // 左边缘对齐（以边界为目标）
    if (Math.abs(newX - siblingX) < SNAP_THRESHOLD) {
      snappedX = siblingX;
      lines.push({
        type: 'vertical',
        position: parentAbsPos.x + siblingX, // 使用绝对坐标
        color: '#00ffff',
      });
    }

    // 右边缘对齐（以边界为目标）
    if (Math.abs(draggedRight - siblingRight) < SNAP_THRESHOLD) {
      snappedX = siblingRight - draggedWidth;
      lines.push({
        type: 'vertical',
        position: parentAbsPos.x + siblingRight, // 使用绝对坐标
        color: '#00ffff',
      });
    }

    // 水平中心对齐（以中心为目标）
    if (Math.abs(draggedCenterX - siblingCenterX) < SNAP_THRESHOLD) {
      snappedX = siblingCenterX - draggedWidth / 2;
      lines.push({
        type: 'vertical',
        position: parentAbsPos.x + siblingCenterX, // 使用绝对坐标
        color: '#00ffff',
      });
    }

    // 顶边缘对齐（以边界为目标）
    if (Math.abs(newY - siblingY) < SNAP_THRESHOLD) {
      snappedY = siblingY;
      lines.push({
        type: 'horizontal',
        position: parentAbsPos.y + siblingY, // 使用绝对坐标
        color: '#00ffff',
      });
    }

    // 底边缘对齐（以边界为目标）
    if (Math.abs(draggedBottom - siblingBottom) < SNAP_THRESHOLD) {
      snappedY = siblingBottom - draggedHeight;
      lines.push({
        type: 'horizontal',
        position: parentAbsPos.y + siblingBottom, // 使用绝对坐标
        color: '#00ffff',
      });
    }

    // 垂直中心对齐（以中心为目标）
    if (Math.abs(draggedCenterY - siblingCenterY) < SNAP_THRESHOLD) {
      snappedY = siblingCenterY - draggedHeight / 2;
      lines.push({
        type: 'horizontal',
        position: parentAbsPos.y + siblingCenterY, // 使用绝对坐标
        color: '#00ffff',
      });
    }
  }

  // 去重辅助线（相同位置和类型的只保留一条）
  const uniqueLines = lines.filter((line, index, self) =>
    index === self.findIndex(l => l.type === line.type && l.position === line.position)
  );

  return {
    x: Math.round(snappedX),
    y: Math.round(snappedY),
    lines: uniqueLines,
  };
}
