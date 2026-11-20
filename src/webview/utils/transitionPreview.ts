/**
 * 在设计器画布上预览页面转场（switchView 的退出 / 进入动画）
 *
 * 画布上各页面是并排摆着的，没法真的切过去。这里把当前页、目标页的画布节点各克隆一份，
 * 叠在当前页的位置上，按 60 fps 采样写成 Web Animations 关键帧播放；播完把克隆删掉，不改动组件数据。
 * - 自定义转场（switchInStyle 预设）用与代码生成同一套公式（shared/viewTransition）；
 * - 引擎自带样式按引擎的切换公式（engineSwitchFrames）。
 * 目标页不在当前文件里时没有画布节点可用，不预览。
 */
import type { Component } from '../types';
import {
  readViewTransition,
  transitionCurveAt,
  VIEW_TRANSITION_PROFILES,
  ViewTransitionProfile,
  viewTransitionFrameAt,
  windowProgress,
} from '../../shared/viewTransition';
import { collectSharedElementPairs, orientPair } from '../../shared/sharedElement';
import { COMPONENT_ID_ATTRIBUTE } from './componentHitStack';
import { engineSwitchTimeline, type PageFrame } from './engineSwitchFrames';

const OVERLAY_ATTRIBUTE = 'data-transition-preview';
/** 克隆节点上的组件 id，避免与画布上的真节点混在一起 */
const CLONE_ID_ATTRIBUTE = 'data-clone-component-id';
const FPS = 60;
/** 共享元素飞行占整段动画的比例，与 C 里的 HG_VT_HERO_END 一致 */
const HERO_END = 0.8;
/** 有共享元素时旧页额外变暗的比例，与 C 里的 HG_VT_HERO_DIM 一致 */
const HERO_DIM = 0.35;

function canvasElementOf(id: string): HTMLElement | null {
  const canvas = document.querySelector('.designer-canvas');
  return (canvas?.querySelector(`[${COMPONENT_ID_ATTRIBUTE}="${CSS.escape(id)}"]`) as HTMLElement | null) ?? null;
}

/** 组件所在的页面 */
export function ownerViewOf(component: Component, components: readonly Component[]): Component | null {
  const byId = new Map(components.map(c => [c.id, c]));
  let current: Component | undefined = component;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current.type === 'hg_view') {
      return current;
    }
    seen.add(current.id);
    current = current.parent ? byId.get(current.parent) : undefined;
  }
  return null;
}

/** switchView 的目标页（按 id 或名字） */
export function targetViewOf(target: string | undefined, components: readonly Component[]): Component | null {
  if (!target) {
    return null;
  }
  return components.find(c => c.type === 'hg_view' && (c.id === target || c.name === target)) ?? null;
}

/** 停掉正在播放的转场预览 */
export function stopTransitionPreview(): void {
  document.querySelectorAll(`[${OVERLAY_ATTRIBUTE}]`).forEach(node => node.remove());
}

/** 克隆一页放到预览层里：去掉 id 标记，免得命中测试、按下预览找到克隆 */
function cloneView(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  renameComponentIds(clone);
  clone.style.position = 'absolute';
  clone.style.left = '0px';
  clone.style.top = '0px';
  clone.style.margin = '0';
  clone.style.outline = 'none';
  clone.style.transformOrigin = '50% 50%';
  return clone;
}

/** 克隆里的组件 id 换个属性名：画布上的命中测试、按下预览都不会找到克隆 */
function renameComponentIds(root: HTMLElement): void {
  if (root.hasAttribute(COMPONENT_ID_ATTRIBUTE)) {
    root.setAttribute(CLONE_ID_ATTRIBUTE, root.getAttribute(COMPONENT_ID_ATTRIBUTE) ?? '');
    root.removeAttribute(COMPONENT_ID_ATTRIBUTE);
  }
  root.querySelectorAll(`[${COMPONENT_ID_ATTRIBUTE}]`).forEach(node => {
    node.setAttribute(CLONE_ID_ATTRIBUTE, node.getAttribute(COMPONENT_ID_ATTRIBUTE) ?? '');
    node.removeAttribute(COMPONENT_ID_ATTRIBUTE);
  });
}

/** 节点在页面里的位置（累加 offsetParent 链，和引擎里按父节点坐标累加一致） */
function offsetInPage(root: HTMLElement, node: HTMLElement): { left: number; top: number; width: number; height: number } {
  let left = 0;
  let top = 0;
  let current: HTMLElement | null = node;
  let guard = 0;
  while (current && current !== root && guard++ < 64) {
    left += current.offsetLeft;
    top += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }
  return { left, top, width: node.offsetWidth, height: node.offsetHeight };
}

function findInClone(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector(`[${CLONE_ID_ATTRIBUTE}="${CSS.escape(id)}"]`) as HTMLElement | null;
}

/** 预览层盖在当前页上，大小同当前页，超出部分裁掉（和屏幕一样） */
function createOverlay(fromElement: HTMLElement): HTMLElement {
  const overlay = document.createElement('div');
  overlay.setAttribute(OVERLAY_ATTRIBUTE, '');
  Object.assign(overlay.style, {
    position: 'absolute',
    left: `${fromElement.offsetLeft}px`,
    top: `${fromElement.offsetTop}px`,
    width: `${fromElement.offsetWidth}px`,
    height: `${fromElement.offsetHeight}px`,
    overflow: 'hidden',
    zIndex: '10000',
    pointerEvents: 'none',
    background: '#000',
  });
  return overlay;
}

/** 停在最后一帧看一眼再撤掉 */
function removeWhenDone(animation: Animation, overlay: HTMLElement): void {
  animation.finished.then(() => window.setTimeout(() => overlay.remove(), 400), () => overlay.remove());
}

/** 引擎样式的一帧写成关键帧；null（这一帧看不见）用透明度 0 表示 */
function pageKeyframe(frame: PageFrame | null, width: number, height: number): Keyframe {
  if (!frame) {
    return { opacity: '0' };
  }
  const parts: string[] = [];
  if (frame.rotateX || frame.rotateY) {
    // 引擎的 3D 投影视距约为页面宽高之和的一半，立方体再远一倍
    parts.push(`perspective(${((width + height) / (frame.depth ? 1 : 2)).toFixed(0)}px)`);
  }
  parts.push(`translate(${frame.tx.toFixed(2)}px, ${frame.ty.toFixed(2)}px)`);
  if (frame.depth) {
    parts.push(`translateZ(${(-frame.depth).toFixed(2)}px)`);
  }
  if (frame.rotateX) {
    parts.push(`rotateX(${frame.rotateX.toFixed(2)}deg)`);
  }
  if (frame.rotateY) {
    parts.push(`rotateY(${frame.rotateY.toFixed(2)}deg)`);
  }
  if (frame.depth) {
    parts.push(`translateZ(${frame.depth.toFixed(2)}px)`);
  }
  parts.push(`scale(${frame.scale.toFixed(4)})`);
  return {
    transform: parts.join(' '),
    transformOrigin: `${frame.originX * 100}% ${frame.originY * 100}%`,
    opacity: frame.opacity.toFixed(4),
    filter: `blur(${frame.blur.toFixed(2)}px)`,
  };
}

function playEngineSwitch(
  switchOutStyle: string | undefined,
  switchInStyle: string | undefined,
  fromView: Component,
  fromElement: HTMLElement,
  toElement: HTMLElement,
  host: HTMLElement,
): void {
  const width = fromElement.offsetWidth;
  const height = fromElement.offsetHeight;
  // 切换步长取当前页的（引擎由当前页推进切换），默认页面高度的 1/10
  const animateStep = Number(fromView.data?.animateStep ?? Math.round(fromView.position.height / 10));
  const timeline = engineSwitchTimeline(switchOutStyle, switchInStyle, width, height, animateStep, FPS);

  const overlay = createOverlay(fromElement);
  const fromClone = cloneView(fromElement);
  const toClone = cloneView(toElement);
  // 新页画在旧页上面
  overlay.append(fromClone, toClone);
  host.appendChild(overlay);

  const timing: KeyframeAnimationOptions = { duration: timeline.durationMs, easing: 'linear', fill: 'forwards' };
  fromClone.animate(timeline.from.map(frame => pageKeyframe(frame, width, height)), timing);
  removeWhenDone(toClone.animate(timeline.to.map(frame => pageKeyframe(frame, width, height)), timing), overlay);
}

/** 这一次切换要飞的共享元素（旧页、新页各一个），没有则 null */
function findHeroPair(
  fromView: Component,
  toView: Component,
  components: readonly Component[],
): ReturnType<typeof orientPair> {
  for (const pair of collectSharedElementPairs(components)) {
    const oriented = orientPair(pair, fromView.id);
    if (oriented && oriented.to.view.id === toView.id) {
      return oriented;
    }
  }
  return null;
}

/**
 * 共享元素：把新页那个控件单独克隆一层放在两页之上，跟着页面的缩放/位移走，
 * 本身从旧页控件的位置、大小飞到自己该在的位置（对齐 C 里 hg_vt_hero_* 的做法）
 */
function playSharedElement(
  preset: NonNullable<ReturnType<typeof readViewTransition>>,
  fromView: Component,
  toView: Component,
  components: readonly Component[],
  overlay: HTMLElement,
  fromClone: HTMLElement,
  toClone: HTMLElement,
  width: number,
  height: number,
): Animation | null {
  const pair = findHeroPair(fromView, toView, components);
  if (!pair) {
    return null;
  }
  const src = findInClone(fromClone, pair.from.component.id);
  const dst = findInClone(toClone, pair.to.component.id);
  if (!src || !dst || !dst.offsetWidth || !src.offsetWidth) {
    return null;
  }
  // 旧页那个藏起来，新页那个也藏起来，只有飞行的这一份可见
  src.style.visibility = 'hidden';
  dst.style.visibility = 'hidden';

  const profile = VIEW_TRANSITION_PROFILES[preset];
  const dstRect = offsetInPage(toClone, dst);
  const srcRect = offsetInPage(fromClone, src);
  // 和 C 一致：取宽、高两个比例里较小的一个，保证不会比旧控件更大
  const scale0 = Math.min(srcRect.width / dstRect.width, srcRect.height / dstRect.height);
  // 路径往侧面稍微拐一点，看起来不像直线平移
  // 缩放绕中心，所以起点按中心对齐（和 C 里一致）
  const dx0 = (srcRect.left + srcRect.width / 2) - (dstRect.left + dstRect.width / 2);
  const dy0 = (srcRect.top + srcRect.height / 2) - (dstRect.top + dstRect.height / 2);
  const len = Math.hypot(dx0, dy0);
  const bow = len < 1 ? 0 : Math.min(48, len * 0.22);
  const arcX = len < 1 ? 0 : (-dy0 / len) * bow;
  const arcY = len < 1 ? 0 : (dx0 / len) * bow;

  const layer = document.createElement('div');
  Object.assign(layer.style, {
    position: 'absolute',
    left: '0px',
    top: '0px',
    width: `${width}px`,
    height: `${height}px`,
    transformOrigin: '50% 50%',
  });
  const hero = dst.cloneNode(true) as HTMLElement;
  renameComponentIds(hero);
  Object.assign(hero.style, {
    position: 'absolute',
    left: `${dstRect.left}px`,
    top: `${dstRect.top}px`,
    width: `${dstRect.width}px`,
    height: `${dstRect.height}px`,
    margin: '0',
    transformOrigin: '50% 50%',
    // 克隆源节点刚被藏起来，克隆体要重新显示
    visibility: 'visible',
    pointerEvents: 'none',
  });
  layer.appendChild(hero);
  overlay.appendChild(layer);

  const frames = Math.max(2, Math.round(profile.durationMs * FPS / 1000) + 1);
  const pageKeys: Keyframe[] = [];
  const heroKeys: Keyframe[] = [];
  for (let i = 0; i < frames; i++) {
    const t = i / (frames - 1);
    const frame = viewTransitionFrameAt(profile, t);
    pageKeys.push({
      scale: frame.toScale.toFixed(4),
      translate: `0px ${(frame.toOffsetY * height).toFixed(2)}px`,
    });
    const ePos = transitionCurveAt('easeOut', windowProgress(t, [0, 0.6]));
    const eScale = transitionCurveAt(profile.toCurve ?? profile.curve, windowProgress(t, [0.15, HERO_END]));
    const swing = Math.sin(Math.PI * ePos);
    const scale = scale0 + (1 - scale0) * eScale;
    heroKeys.push({
      transform: `translate(${(dx0 * (1 - ePos) + arcX * swing).toFixed(2)}px, ` +
        `${(dy0 * (1 - ePos) + arcY * swing).toFixed(2)}px) scale(${scale.toFixed(4)})`,
      opacity: '1',
    });
  }
  layer.animate(pageKeys, { duration: profile.durationMs, easing: 'linear', fill: 'forwards' });
  return hero.animate(heroKeys, { duration: profile.durationMs, easing: 'linear', fill: 'forwards' });
}

/** 新页的每个子控件各占一个时间片：依次上浮淡入，不是整页一起动 */
function playStagger(
  profile: ViewTransitionProfile,
  toClone: HTMLElement,
  skipId: string | null,
): void {
  const stagger = profile.stagger;
  if (!stagger || stagger.step <= 0) {
    return;
  }
  const skipped = skipId ? findInClone(toClone, skipId) : null;
  const children = (Array.from(toClone.children) as HTMLElement[])
    .filter(el => el !== skipped && el.offsetWidth > 0);
  const count = children.length;
  if (count === 0) {
    return;
  }
  let step = stagger.step;
  if (count > 1) {
    const room = 1 - stagger.start - stagger.window;
    const fit = room > 0 ? room / (count - 1) : 0;
    step = Math.min(step, fit);
  }
  const frames = Math.max(2, Math.round(profile.durationMs * FPS / 1000) + 1);
  const timing: KeyframeAnimationOptions = { duration: profile.durationMs, easing: 'linear', fill: 'forwards' };
  children.forEach((el, index) => {
    const start = stagger.start + step * index;
    const keys: Keyframe[] = [];
    for (let i = 0; i < frames; i++) {
      const t = i / (frames - 1);
      const e = transitionCurveAt('easeOut', windowProgress(t, [start, start + stagger.window]));
      keys.push({
        opacity: e.toFixed(4),
        transform: `translateY(${(-(1 - e) * stagger.slide).toFixed(2)}px)`,
      });
    }
    el.animate(keys, timing);
  });
}

function playCustomTransition(
  preset: NonNullable<ReturnType<typeof readViewTransition>>,
  fromView: Component,
  toView: Component,
  components: readonly Component[],
  fromElement: HTMLElement,
  toElement: HTMLElement,
  host: HTMLElement,
): void {
  const profile = VIEW_TRANSITION_PROFILES[preset];
  const width = fromElement.offsetWidth;
  const height = fromElement.offsetHeight;

  const overlay = createOverlay(fromElement);
  const fromClone = cloneView(fromElement);
  const toClone = cloneView(toElement);
  overlay.appendChild(fromClone);

  // 圆形揭示：从页面中心扩出一个新页底色的圆，夹在两页之间
  let circle: HTMLElement | null = null;
  if (profile.circle) {
    circle = document.createElement('div');
    Object.assign(circle.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      width: `${width}px`,
      height: `${height}px`,
      background: getComputedStyle(toElement).backgroundColor || '#000',
    });
    overlay.appendChild(circle);
  }
  overlay.appendChild(toClone);
  host.appendChild(overlay);

  const heroPair = findHeroPair(fromView, toView, components);
  // 新页的子控件逐个进场，和 C 里 hg_vt_child_cb 同一套公式
  playStagger(profile, toClone, heroPair ? heroPair.to.component.id : null);
  const frames = Math.max(2, Math.round(profile.durationMs * FPS / 1000) + 1);
  const radius = Math.hypot(width / 2, height / 2) + 1;
  const fromKeys: Keyframe[] = [];
  const toKeys: Keyframe[] = [];
  const circleKeys: Keyframe[] = [];
  for (let i = 0; i < frames; i++) {
    const t = i / (frames - 1);
    const frame = viewTransitionFrameAt(profile, t);
    // 有元素在飞时旧页退得更彻底，注意力留给元素
    const fromOpacity = heroPair
      ? frame.fromOpacity * (1 - HERO_DIM * transitionCurveAt(profile.curve, t))
      : frame.fromOpacity;
    fromKeys.push({ scale: frame.fromScale.toFixed(4), opacity: fromOpacity.toFixed(4) });
    toKeys.push({
      scale: frame.toScale.toFixed(4),
      opacity: frame.toOpacity.toFixed(4),
      translate: `0px ${(frame.toOffsetY * height).toFixed(2)}px`,
    });
    circleKeys.push({ clipPath: `circle(${Math.max(1, radius * frame.circle).toFixed(2)}px at 50% 50%)` });
  }

  const timing: KeyframeAnimationOptions = { duration: profile.durationMs, easing: 'linear', fill: 'forwards' };
  const animation = toClone.animate(toKeys, timing);
  fromClone.animate(fromKeys, timing);
  circle?.animate(circleKeys, timing);
  playSharedElement(preset, fromView, toView, components, overlay, fromClone, toClone, width, height);
  removeWhenDone(animation, overlay);
}

/**
 * 播放预览；任一页面不在画布上时返回 false。
 */
export function playTransitionPreview(
  switchOutStyle: string | undefined,
  switchInStyle: string | undefined,
  fromView: Component | null,
  toView: Component | null,
  components: readonly Component[] = [],
): boolean {
  if (!fromView || !toView || fromView.id === toView.id || typeof Element.prototype.animate !== 'function') {
    return false;
  }
  const fromElement = canvasElementOf(fromView.id);
  const toElement = canvasElementOf(toView.id);
  const host = fromElement?.parentElement;
  if (!fromElement || !toElement || !host) {
    return false;
  }

  stopTransitionPreview();
  const preset = readViewTransition(switchInStyle);
  if (preset) {
    playCustomTransition(preset, fromView, toView, components, fromElement, toElement, host);
  } else {
    playEngineSwitch(switchOutStyle, switchInStyle, fromView, fromElement, toElement, host);
  }
  return true;
}
