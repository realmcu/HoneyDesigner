/**
 * 在设计器画布上预览 hg_view 的页面入场动画
 *
 * 用与代码生成同一份曲线（shared/entranceAnimation），把每组 60 fps 的位移、旋转、缩放写成
 * Web Animations 关键帧，直接作用在画布里组件的 DOM 节点上；动画结束后自动移除，
 * 不改动组件数据。画布整体做了 scale，所以位移用设计坐标的像素即可。
 */
import type { Component } from '../types';
import {
  ENTRANCE_FPS,
  collectEntrancePieces,
  entranceFadeAt,
  planEntrance,
  readEntranceOptions,
} from '../../shared/entranceAnimation';
import { COMPONENT_ID_ATTRIBUTE } from './componentHitStack';

const PREVIEW_ID = 'hg-entrance-preview';

function canvasElementOf(id: string): HTMLElement | null {
  const canvas = document.querySelector('.designer-canvas');
  return (canvas?.querySelector(`[${COMPONENT_ID_ATTRIBUTE}="${CSS.escape(id)}"]`) as HTMLElement | null) ?? null;
}

/** 停止正在播放的预览 */
export function stopEntrancePreview(): void {
  const canvas = document.querySelector('.designer-canvas') as HTMLElement | null;
  canvas?.getAnimations({ subtree: true }).forEach(a => {
    if (a.id === PREVIEW_ID) {
      a.cancel();
    }
  });
}

/**
 * 播放预览；页面未开启入场动画或没有子组件时返回 false。
 */
export function playEntrancePreview(view: Component, components: Component[]): boolean {
  const options = readEntranceOptions(view.data);
  if (!options || typeof Element.prototype.animate !== 'function') {
    return false;
  }
  const byId = new Map(components.map(c => [c.id, c]));
  const collected = collectEntrancePieces(view, id => byId.get(id), { expandList: () => true });
  if (collected.length === 0) {
    return false;
  }

  stopEntrancePreview();
  const pieces = collected.map(c => c.piece);
  const pieceById = new Map(pieces.map(p => [p.id, p]));
  const plan = planEntrance(view.position.width, view.position.height, pieces, options);

  for (const group of plan.groups) {
    const duration = (group.dx.length - 1) * 1000 / ENTRANCE_FPS;
    for (const id of group.ids) {
      const piece = pieceById.get(id);
      const element = canvasElementOf(id);
      if (!piece || !element) {
        continue;
      }
      // CSS 的 rotate / scale 绕元素自身中心；换算成绕卡片中心：多平移 p - s·R·p（p 为卡片中心相对元素中心）
      const px = group.cx - (piece.x + piece.width / 2);
      const py = group.cy - (piece.y + piece.height / 2);
      const keyframes = group.dx.map((_, f) => {
        const rad = group.rot[f] * Math.PI / 180;
        const s = group.scale[f];
        const tx = group.dx[f] + px - s * (px * Math.cos(rad) - py * Math.sin(rad));
        const ty = group.dy[f] + py - s * (px * Math.sin(rad) + py * Math.cos(rad));
        return {
          translate: `${tx.toFixed(2)}px ${ty.toFixed(2)}px`,
          rotate: `${group.rot[f].toFixed(3)}deg`,
          scale: s.toFixed(4),
          ...(options.fade ? { opacity: entranceFadeAt(f, plan.fadeFrames) } : {}),
        };
      });
      element.animate(keyframes, {
        duration,
        delay: group.delay,
        easing: 'linear',
        fill: 'backwards',
        id: PREVIEW_ID,
      });
    }
  }
  return true;
}
