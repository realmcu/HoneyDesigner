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
 *   - component.id / position / visible / locked / zIndex / name
 *   - component.data / component.style 引用（任意字段变化都会触发重渲染）
 *   - style prop 中的 border/opacity/transform（反映选中/悬浮/启用状态变化）
 *
 * 忽略始终是新引用的 handlers 对象和大部分 style prop 属性，
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

    // 组件 data / style 任意字段变化 → 重新渲染。
    // 按引用比较：updateComponent 仅在该组件自身被编辑时替换 data / style 引用
    // （位置拖拽、其他组件更新都不会改变本组件的引用），
    // 故能精确捕获 value / min / max、颜色、方向等所有影响视觉的字段，
    // 又不会因无关变化而误触发重渲染。
    if (pc.data !== nc.data) return false;
    if (pc.style !== nc.style) return false;

    // style prop 变化（反映选中/悬浮/启用状态）
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

// @note data / style 已按引用整体比较，新增依赖字段无需再改本比较器。
// 仅当 widget 依赖 component 上 data/style/position 之外的新顶层字段时，
// 才需要在此补充对应检查，或在该 widget 组件内自行实现 memo。
