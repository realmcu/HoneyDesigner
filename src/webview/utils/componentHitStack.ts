/**
 * 画布命中测试：把「某一点下的控件」按真实堆叠顺序展开。
 *
 * 浏览器的命中测试只会把 mousedown 交给最上层元素，多个控件互相覆盖时
 * 就拿不到被压在下面的那些。这里用 document.elementsFromPoint 取回该点下的
 * 完整元素栈，映射回组件 id，再按控件形状过滤（弧形/圆形只在实际绘制的图形上
 * 响应，透明包围盒不抢点击），得到自顶向下的候选控件栈。
 */
import { Component } from '../types';
import { getAbsolutePosition } from './componentUtils';

/** 承载组件 id 的 DOM 属性，由 createComponentHandlers 写到控件根节点上 */
export const COMPONENT_ID_ATTRIBUTE = 'data-component-id';

/** 形状命中容差（设计坐标 px），用于圆角端点与抗锯齿边缘 */
const SHAPE_HIT_TOLERANCE = 1;

/** 弧形/圆形按实际图形而非包围盒命中 */
export function usesShapeHitTest(type: Component['type']): boolean {
  return type === 'hg_arc' || type === 'hg_circle';
}

/**
 * 判断点是否落在控件的实际图形上（控件使用绝对画布坐标判断，point 为画布坐标）。
 *
 * 只有 hg_arc / hg_circle 需要形状判断，其余控件仍按包围盒命中，返回 true。
 * 几何参数与 ArcWidget / CircleWidget 的绘制保持一致：
 * 圆心在包围盒中心，半径取 style.radius（默认 40），线宽取 style.strokeWidth
 * （弧形默认 8，圆形默认 0）。
 */
export function isPointOnComponentShape(
  comp: Component,
  components: Component[],
  point: { x: number; y: number }
): boolean {
  if (!usesShapeHitTest(comp.type)) {
    return true;
  }

  const { width, height } = comp.position;
  if (width <= 0 || height <= 0) {
    return false;
  }

  const style = comp.style || {};
  const isArc = comp.type === 'hg_arc';
  const radius = Number(style.radius ?? 40);
  const strokeWidth = Math.max(0, Number(style.strokeWidth ?? (isArc ? 8 : 0)) || 0);
  // 线宽为 0 的弧形什么都画不出来，不参与命中
  if (isArc && strokeWidth <= 0) {
    return false;
  }
  if (radius <= 0) {
    return false;
  }

  const abs = getAbsolutePosition(comp, components);
  const localX = point.x - abs.x;
  const localY = point.y - abs.y;
  const cx = width / 2;
  const cy = height / 2;
  const distance = Math.hypot(localX - cx, localY - cy);
  const halfStroke = strokeWidth / 2;

  if (!isArc) {
    return distance <= radius + halfStroke + SHAPE_HIT_TOLERANCE;
  }

  // 弧形：只在圆环（半径 ± 半线宽）上响应
  if (distance > radius + halfStroke + SHAPE_HIT_TOLERANCE
    || distance < radius - halfStroke - SHAPE_HIT_TOLERANCE) {
    return false;
  }

  const startAngle = Number(style.startAngle ?? 0);
  const endAngle = Number(style.endAngle ?? 270);
  let span = endAngle - startAngle;
  if (span <= 0) {
    span += 360;
  }
  if (span >= 360 - 0.01) {
    return true;
  }

  // 与 ArcWidget 的绘制坐标一致：0° 指向 +x，角度沿 +y（屏幕向下）增长
  const angle = (Math.atan2(localY - cy, localX - cx) * 180) / Math.PI;
  const fromStart = (((angle - startAngle) % 360) + 360) % 360;
  // 圆角端点（strokeLinecap: round）会略微越过起始/结束角度，按半线宽换算成角度容差
  const capTolerance = (Math.asin(Math.min(1, (halfStroke + SHAPE_HIT_TOLERANCE) / radius)) * 180) / Math.PI;

  return fromStart <= span + capTolerance || fromStart >= 360 - capTolerance;
}

/**
 * 取回视口坐标下该点的控件 id 栈，最上层在前。
 *
 * 祖先容器会被剔除：子控件的元素本身就在父容器的元素里，元素栈天然会把父容器
 * 一起带出来；把它们留在候选里会让穿透循环在「子控件 → 父容器 → 子控件」之间空转。
 * 父容器仍可通过点击容器空白处或 Alt+点击选中。
 *
 * @param clientX 事件的 clientX
 * @param clientY 事件的 clientY
 * @param components 当前画布的全部控件
 * @param canvasPoint 该点的画布坐标（用于形状命中；为 null 时放弃计算）
 */
export function getComponentStackAt(
  clientX: number,
  clientY: number,
  components: Component[],
  canvasPoint: { x: number; y: number } | null
): string[] {
  if (!canvasPoint) {
    return [];
  }
  if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') {
    return [];
  }

  const hits: string[] = [];
  const seen = new Set<string>();

  for (const element of document.elementsFromPoint(clientX, clientY)) {
    // SVG 元素同样支持 closest，isPointOnComponentShape 已按图形形状过滤几何控件
    const host = element.closest(`[${COMPONENT_ID_ATTRIBUTE}]`) as HTMLElement | null;
    if (!host) {
      continue;
    }
    const id = host.getAttribute(COMPONENT_ID_ATTRIBUTE);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);

    const comp = components.find((c) => c.id === id);
    if (!comp || comp.visible === false) {
      continue;
    }
    if (!isPointOnComponentShape(comp, components, canvasPoint)) {
      continue;
    }
    hits.push(id);
  }

  if (hits.length <= 1) {
    return hits;
  }

  // 收集所有命中项的祖先容器 id
  const ancestors = new Set<string>();
  for (const id of hits) {
    let parent = components.find((c) => c.id === id)?.parent ?? null;
    while (parent && !ancestors.has(parent)) {
      ancestors.add(parent);
      parent = components.find((c) => c.id === parent)?.parent ?? null;
    }
  }

  const remaining = hits.filter((id) => !ancestors.has(id));

  // 精确命中（弧形/圆形，指针真的落在描边上）排在纯包围盒命中之前。
  //
  // 这类设计里弧上面常压着同样大小的 1x1 全透明「点击热区」图片
  // （本工程 c1_hr_hot / c1_step_hot / c1_dist_hot），热区在整个包围盒内都算命中，
  // 按 DOM 顺序（热区在后、层级更高）会把真正的弧挤到后面，导致「想选弧却选了热区」。
  // 弧的命中要求指针落在描边上，是更强的意图信号，所以优先。
  // 热区仍然排在后面，同位置重复单击可以穿透到它。
  const precise: string[] = [];
  const loose: string[] = [];
  for (const id of remaining) {
    const comp = components.find((c) => c.id === id);
    if (comp && usesShapeHitTest(comp.type)) {
      precise.push(id);
    } else {
      loose.push(id);
    }
  }

  return [...precise, ...loose];
}
