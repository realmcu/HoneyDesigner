/**
 * 在设计器画布上模拟按下反馈（组件属性 pressEffect）
 *
 */
import type { Component } from '../types';
import { PRESS_CONTAINER_TYPES, PRESS_DOWN_MS, PRESS_UP_MS, readPressFeedback } from '../../shared/pressFeedback';
import { COMPONENT_ID_ATTRIBUTE } from './componentHitStack';

const STYLE_ID = 'hg-press-feedback';
/** 画布节点上的标记属性；与组件 id 分开，避免互相覆盖 */
const PRESS_ATTRIBUTE = 'data-press-effect';
/** 按下期间组内节点临时抬到最上层的标记 */
const RAISED_ATTRIBUTE = 'data-press-raised';
/** 预览动画的名字，方便停掉上一条 */
const PREVIEW_ID = 'hg-press-preview';

const css = `
.designer-canvas [${PRESS_ATTRIBUTE}] {
  transition: scale ${PRESS_UP_MS}ms ease-out, opacity ${PRESS_UP_MS}ms ease-out;
}
.designer-canvas [${PRESS_ATTRIBUTE}]:active {
  transition-duration: ${PRESS_DOWN_MS}ms;
}
.designer-canvas [${RAISED_ATTRIBUTE}] {
  z-index: 9999 !important;
}
.designer-canvas [${PRESS_ATTRIBUTE}="pop"]:active {
  scale: 1.5;
  /* 节点上行内写着 opacity（组件本身的透明度），这里必须 !important 才盖得住 */
  opacity: 0.6 !important;
}
.designer-canvas [${PRESS_ATTRIBUTE}="press"]:active {
  scale: 0.96;
}
`;

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

/**
 * 按下时要一起提层的节点：被按下的组件 + 完全落在它里面的同层组件。
 * 只提背景会把压在它上面的文字盖掉，和生成代码里的分组规则保持一致。
 */
function raiseGroupElements(element: HTMLElement): HTMLElement[] {
  const parent = element.parentElement;
  if (!parent) {
    return [element];
  }
  // 用 layout 尺寸比较：画布上的 scale/透明度预览不能影响包含关系
  const x = element.offsetLeft;
  const y = element.offsetTop;
  const w = element.offsetWidth;
  const h = element.offsetHeight;
  const group = [element];
  for (const child of Array.from(parent.children) as HTMLElement[]) {
    if (child === element || !child.hasAttribute(COMPONENT_ID_ATTRIBUTE)) {
      continue;
    }
    if (child.offsetWidth <= 0 || child.offsetHeight <= 0) {
      continue;
    }
    if (
      child.offsetLeft >= x &&
      child.offsetTop >= y &&
      child.offsetLeft + child.offsetWidth <= x + w &&
      child.offsetTop + child.offsetHeight <= y + h
    ) {
      group.push(child);
    }
  }
  return group;
}

function clearRaised(): void {
  document.querySelectorAll(`.designer-canvas [${RAISED_ATTRIBUTE}]`).forEach(node => {
    node.removeAttribute(RAISED_ATTRIBUTE);
  });
}

let raiseListenerInstalled = false;

/** 装上按下/抬手的提层监听（只装一次） */
function ensureRaiseListener(): void {
  if (raiseListenerInstalled) {
    return;
  }
  raiseListenerInstalled = true;
  // 捕获阶段：画布上的控件会 stopPropagation，冒泡阶段有可能收不到
  document.addEventListener(
    'pointerdown',
    event => {
      clearRaised();
      const target = event.target as Element | null;
      if (!target || typeof target.closest !== 'function') {
        return;
      }
      const element = target.closest(`[${PRESS_ATTRIBUTE}]`) as HTMLElement | null;
      if (!element || !element.closest('.designer-canvas')) {
        return;
      }
      raiseGroupElements(element).forEach(node => node.setAttribute(RAISED_ATTRIBUTE, ''));
    },
    true,
  );
  const release = () => clearRaised();
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);
}

/**
 * 把组件上的 pressEffect 同步到画布节点；只是预览，不改组件数据。
 * 组件列表变化、切换选中时调用。
 */
export function syncPressPreview(components: readonly Component[]): void {
  const canvas = document.querySelector('.designer-canvas');
  if (!canvas) {
    return;
  }
  ensureStyle();
  ensureRaiseListener();

  for (const component of components) {
    const element = canvas.querySelector(
      `[${COMPONENT_ID_ATTRIBUTE}="${CSS.escape(component.id)}"]`,
    ) as HTMLElement | null;
    if (!element) {
      continue;
    }
    // 容器整块缩放没有意义（老工程的 hg_view 上可能还留着 pressEffect），与代码生成保持一致
    const mode = PRESS_CONTAINER_TYPES.includes(component.type)
      ? undefined
      : readPressFeedback(component.data)?.mode;
    if (mode) {
      element.setAttribute(PRESS_ATTRIBUTE, mode);
    } else if (element.hasAttribute(PRESS_ATTRIBUTE)) {
      element.removeAttribute(PRESS_ATTRIBUTE);
    }
  }
}

function canvasElementOf(id: string): HTMLElement | null {
  const canvas = document.querySelector('.designer-canvas');
  return (canvas?.querySelector(`[${COMPONENT_ID_ATTRIBUTE}="${CSS.escape(id)}"]`) as HTMLElement | null) ?? null;
}

/** 停掉正在播放的按下预览 */
export function stopPressPreview(): void {
  const canvas = document.querySelector('.designer-canvas') as HTMLElement | null;
  canvas?.getAnimations({ subtree: true }).forEach(a => {
    if (a.id === PREVIEW_ID) {
      a.cancel();
    }
  });
  clearRaised();
}

/**
 * 面板上的「预览按下效果」：完整放一遍这段变化（按下 80 ms、抬起 180 ms），
 * 和 HoneyGUI 里生成的行为一致——手指抬得早也先把这一下放完再回落，不会只抖一下。
 */
export function playPressPreview(component: Component): boolean {
  const options = readPressFeedback(component.data);
  const element = canvasElementOf(component.id);
  if (!options || !element || typeof Element.prototype.animate !== 'function') {
    return false;
  }

  stopPressPreview();
  // 和真实按下一样，整组一起提到最上层
  const group = raiseGroupElements(element);
  group.forEach(node => node.setAttribute(RAISED_ATTRIBUTE, ''));
  const drop = () => group.forEach(node => node.removeAttribute(RAISED_ATTRIBUTE));
  const total = options.downMs + options.upMs;
  const peak = options.downMs / total;
  // 起点和终点都用元素自己的透明度：组件本身可能是半透明的（画布上是行内 opacity）
  const baseOpacity = getComputedStyle(element).opacity;
  const animation = element.animate(
    [
      { scale: '1', opacity: baseOpacity, offset: 0, easing: 'ease-out' },
      { scale: String(options.scale), opacity: String(Number(baseOpacity) * options.opacity / 255), offset: peak, easing: 'ease-out' },
      { scale: '1', opacity: baseOpacity, offset: 1 },
    ],
    // fill: none —— 播完自动回到元素原本的样式，不用手动清行内样式
    { duration: total, fill: 'none' },
  );
  animation.id = PREVIEW_ID;
  // cancelled 时 finished 会 reject，两种情况都要把提层标记撤掉
  animation.finished.then(drop, drop);
  return true;
}
