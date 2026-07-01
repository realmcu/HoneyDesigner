import html2canvas from 'html2canvas';
import { getAbsolutePosition } from './componentUtils';
import { Component } from '../types';

/**
 * 把设计器画布渲染成 PNG dataURL；在克隆 DOM 上给选中组件叠加带 id 标签的红框，
 * 不影响用户当前画布。
 */
export async function captureDesignPng(
  canvasEl: HTMLElement,
  components: Component[],
  selectedIds: string[],
): Promise<string> {
  const canvas = await html2canvas(canvasEl, {
    backgroundColor: null,
    logging: false,
    scale: 1,
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
        const abs = getAbsolutePosition(comp, components);
        const box = clonedDoc.createElement('div');
        box.style.cssText =
          `position:absolute;left:${abs.x}px;top:${abs.y}px;` +
          `width:${comp.position.width}px;height:${comp.position.height}px;` +
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
