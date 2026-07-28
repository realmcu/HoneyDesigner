/**
 * 画布坐标转换工具函数
 *
 * 统一处理鼠标/触摸事件坐标到画布设计坐标的换算。
 * 换算公式：
 *   effectiveZoom = zoom / devicePixelRatio
 *   画布坐标 = (屏幕坐标 - 画布容器偏移 - canvasOffset) / effectiveZoom
 *
 * 此模式在 App.tsx、DesignerCanvas.tsx 等多处重复出现，集中于此避免重复。
 */

/**
 * 计算 effectiveZoom（实际渲染缩放）
 * zoom 为存储的缩放值（含 dpr 因子），除以 devicePixelRatio 得到实际 CSS 变换用的 scale。
 */
export function getEffectiveZoom(zoom: number, dpr: number = window.devicePixelRatio || 1): number {
  return zoom / dpr;
}

/**
 * 从 DOM 事件中提取画布容器相对于视口的偏移
 */
export function getCanvasRect(element: HTMLElement | null): DOMRect | null {
  if (!element) return null;
  return element.getBoundingClientRect();
}

/**
 * 统一的画布坐标转换入口
 *
 * @param clientX - 事件的 clientX
 * @param clientY - 事件的 clientY
 * @param rect - 画布容器的 getBoundingClientRect() 结果
 * @param zoom - store 中的 zoom 值
 * @param canvasOffset - store 中的 canvasOffset
 * @param round - 是否对结果取整（默认为 true）
 * @returns 转换后的画布坐标 { x, y }
 */
export function getCanvasCoordinates(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  zoom: number,
  canvasOffset: { x: number; y: number },
  round: boolean = true
): { x: number; y: number } {
  const effectiveZoom = getEffectiveZoom(zoom);
  const x = (clientX - rect.left - canvasOffset.x) / effectiveZoom;
  const y = (clientY - rect.top - canvasOffset.y) / effectiveZoom;
  if (round) {
    return { x: Math.round(x), y: Math.round(y) };
  }
  return { x, y };
}

/**
 * 从 React 鼠标/拖放事件和画布 ref 一步完成坐标转换
 *
 * @param clientX - e.clientX
 * @param clientY - e.clientY
 * @param canvasEl - canvasRef.current
 * @param zoom - store 中的 zoom
 * @param canvasOffset - store 中的 canvasOffset (x, y)
 * @param round - 是否取整
 * @returns 画布坐标或 null（当 canvasEl 为 null 时）
 */
export function fromCanvasEvent(
  clientX: number,
  clientY: number,
  canvasEl: HTMLElement | null,
  zoom: number,
  canvasOffset: { x: number; y: number },
  round: boolean = true
): { x: number; y: number } | null {
  const rect = getCanvasRect(canvasEl);
  if (!rect) return null;
  return getCanvasCoordinates(clientX, clientY, rect, zoom, canvasOffset, round);
}
