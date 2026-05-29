import React from 'react';
import { Component } from '../../types';

/**
 * 控件组件的通用 Props
 */
export interface WidgetProps {
  component: Component;
  style: React.CSSProperties;
  handlers: {
    onMouseDown: (e: React.MouseEvent) => void;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onContextMenu?: (e: React.MouseEvent) => void;
  };
  children?: React.ReactNode;
}

/**
 * 自定义 React.memo 包装器
 *
 * 避免 widget 在无关状态变化时（如其他组件的移动、选中状态变化等）重新渲染。
 * 比较器检查影响视觉输出的关键字段：
 *   - component.id / position / visible / locked
 *   - 影响渲染的关键 data 字段（text, src）
 *   - style 中的 border/opacity（反映选中/悬浮状态变化）
 *
 * 忽略始终是新引用的 handlers 对象和大部分 style 属性，
 * 因为它们的实际值变化已被上述字段覆盖。
 */
export function widgetMemo<P extends WidgetProps>(Wrapped: React.ComponentType<P>): React.MemoExoticComponent<React.ComponentType<P>> {
  return React.memo(Wrapped, (prev, next) => {
    const pc = prev.component;
    const nc = next.component;

    // 组件身份不同 → 必须重新渲染
    if (pc.id !== nc.id) return false;

    // 位置变化 → 必须重新渲染
    if (pc.position.x !== nc.position.x) return false;
    if (pc.position.y !== nc.position.y) return false;
    if (pc.position.width !== nc.position.width) return false;
    if (pc.position.height !== nc.position.height) return false;

    // 可见性和交互状态变化 → 必须重新渲染
    if (pc.visible !== nc.visible) return false;
    if (pc.locked !== nc.locked) return false;
    if (pc.showOverflow !== nc.showOverflow) return false;
    if ((pc.zIndex ?? 0) !== (nc.zIndex ?? 0)) return false;

    // 名称变化（影响标题显示）
    if (pc.name !== nc.name) return false;

    // 组件样式变化
    if (pc.style?.opacity !== nc.style?.opacity) return false;
    if (pc.style?.borderRadius !== nc.style?.borderRadius) return false;

    // 关键数据字段变化
    if (pc.data?.text !== nc.data?.text) return false;
    if (pc.data?.src !== nc.data?.src) return false;
    if (pc.data?.fontFile !== nc.data?.fontFile) return false;

    // style prop 变化（反映选中/悬浮状态）
    if (prev.style.border !== next.style.border) return false;
    if (prev.style.opacity !== next.style.opacity) return false;
    if (prev.style.backgroundColor !== next.style.backgroundColor) return false;
    if (prev.style.transform !== next.style.transform) return false;

    // children 变化（容器组件需要重新渲染子组件）
    if (prev.children !== next.children) return false;

    // 以上均无变化 → 跳过重新渲染
    return true;
  });
}

// @note 如果 widget 依赖其他 data 字段（如 iconImages、modelPath），
// 需要在此比较器中添加对应检查，或在该 widget 组件内自行实现 memo。
