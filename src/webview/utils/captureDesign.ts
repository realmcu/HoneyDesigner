import html2canvas from 'html2canvas';
import { getAbsolutePosition } from './componentUtils';
import { Component } from '../types';

export interface CaptureView {
  zoom: number;
  offset: { x: number; y: number };
}

/**
 * 把设计器画布渲染成 PNG dataURL。
 * 关键：真实组件渲染在内层 transform(scale) 的 wrapper 里，所以高亮框必须按
 * 「外层坐标 = offset + design * effectiveZoom」放置（与画布命中测试同一套换算），
 * 并把 html2canvas 裁剪到内容包围盒，避免截到 500% 的空白画布。
 */
export async function captureDesignPng(
  canvasEl: HTMLElement,
  components: Component[],
  selectedIds: string[],
  view: CaptureView,
): Promise<string> {
  const dpr = window.devicePixelRatio || 1;
  const effectiveZoom = view.zoom / dpr;

  const toCanvasRect = (comp: Component) => {
    const abs = getAbsolutePosition(comp, components);
    return {
      left: view.offset.x + abs.x * effectiveZoom,
      top: view.offset.y + abs.y * effectiveZoom,
      width: comp.position.width * effectiveZoom,
      height: comp.position.height * effectiveZoom,
    };
  };

  // 裁剪区域 = 所有组件的包围盒（外层坐标系），加内边距，clamp 到 >=0
  const rects = components.map(toCanvasRect);
  let cropX = 0;
  let cropY = 0;
  let cropW = canvasEl.clientWidth || 1;
  let cropH = canvasEl.clientHeight || 1;
  if (rects.length > 0) {
    const minX = Math.min(...rects.map((r) => r.left));
    const minY = Math.min(...rects.map((r) => r.top));
    const maxX = Math.max(...rects.map((r) => r.left + r.width));
    const maxY = Math.max(...rects.map((r) => r.top + r.height));
    const pad = 8;
    cropX = Math.max(0, minX - pad);
    cropY = Math.max(0, minY - pad);
    cropW = Math.max(1, maxX - minX + pad * 2);
    cropH = Math.max(1, maxY - minY + pad * 2);
  }

  const canvas = await html2canvas(canvasEl, {
    backgroundColor: null,
    logging: false,
    scale: 1,
    x: cropX,
    y: cropY,
    width: cropW,
    height: cropH,
    onclone: (clonedDoc) => {
      const clonedCanvas = clonedDoc.querySelector('.designer-canvas') as HTMLElement | null;
      if (!clonedCanvas) {
        return;
      }
      for (const id of selectedIds) {
        const comp = components.find((c) => c.id === id);
        if (!comp) {
          continue;
        }
        const r = toCanvasRect(comp);
        const box = clonedDoc.createElement('div');
        box.style.cssText =
          `position:absolute;left:${r.left}px;top:${r.top}px;` +
          `width:${r.width}px;height:${r.height}px;` +
          `border:2px solid #ff2d55;box-sizing:border-box;z-index:99999;pointer-events:none;`;
        const label = clonedDoc.createElement('div');
        label.textContent = id;
        label.style.cssText =
          `position:absolute;left:0;top:-16px;background:#ff2d55;color:#fff;` +
          `font:11px/14px sans-serif;padding:0 4px;white-space:nowrap;`;
        box.appendChild(label);
        clonedCanvas.appendChild(box);
      }
    },
  });
  return canvas.toDataURL('image/png');
}
