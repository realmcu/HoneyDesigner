/**
 * HoneyGUI 引擎自带切换样式（SWITCH_IN_* / SWITCH_OUT_*）的逐帧画面，供画布上的转场预览用
 *
 * 公式照搬引擎的 gui_view_transition / gui_view_animation：
 * - 代码直接切换时，当前页每帧把切换距离 release 加一个 animate_step，到页面高度为止；
 * - 平移 / 缩小 / 旋转 / 立方体按 release 算偏移，动画类按 release / 高度 算进度；
 * - 旋转、立方体是 3D 投影，这里用 CSS 透视近似；模糊用 CSS blur 近似。
 */

/** 一页在某一帧的样子（相对页面原位） */
export interface PageFrame {
  tx: number;
  ty: number;
  scale: number;
  /** 缩放中心：0 = 左 / 上，0.5 = 中，1 = 右 */
  originX: number;
  originY: number;
  rotateX: number;
  rotateY: number;
  /** 立方体半径（绕立方体中心转），0 = 绕页面自身 */
  depth: number;
  opacity: number;
  blur: number;
}

export const REST_FRAME: PageFrame = {
  tx: 0, ty: 0, scale: 1, originX: 0.5, originY: 0.5, rotateX: 0, rotateY: 0, depth: 0, opacity: 1, blur: 0,
};

/** 引擎帧率按 30 帧/秒估算 */
export const ENGINE_FRAME_MS = 1000 / 30;

const DEFAULT_SWITCH_OUT = 'SWITCH_OUT_TO_LEFT_USE_TRANSLATION';
const DEFAULT_SWITCH_IN = 'SWITCH_IN_FROM_RIGHT_USE_TRANSLATION';

function clamp01(t: number): number {
  return t < 0 ? 0 : (t > 1 ? 1 : t);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function bounceEaseOut(t: number): number {
  if (t < 1 / 2.75) {
    return 7.5625 * t * t;
  }
  if (t < 2 / 2.75) {
    t -= 1.5 / 2.75;
    return 7.5625 * t * t + 0.75;
  }
  if (t < 2.5 / 2.75) {
    t -= 2.25 / 2.75;
    return 7.5625 * t * t + 0.9375;
  }
  t -= 2.625 / 2.75;
  return 7.5625 * t * t + 0.984375;
}

/** 平移类样式的方向偏移（gui_view_direction_offset） */
function directionOffset(style: string, release: number, w: number, h: number): { ox: number; oy: number } {
  const m = /^SWITCH_(IN_FROM|OUT_TO)_(LEFT|RIGHT|TOP|BOTTOM)_USE_/.exec(style);
  if (!m) {
    return { ox: 0, oy: 0 };
  }
  const entering = m[1] === 'IN_FROM';
  switch (m[2]) {
    case 'LEFT': return { ox: entering ? release - w : -release, oy: 0 };
    case 'RIGHT': return { ox: entering ? w - release : release, oy: 0 };
    case 'TOP': return { ox: 0, oy: entering ? release - h : -release };
    default: return { ox: 0, oy: entering ? h - release : release };
  }
}

/** 动画类样式（SWITCH_*_ANIMATION_*）在进度 p 时的画面 */
function animationFrame(style: string, p: number, w: number): PageFrame | null {
  const t = clamp01(p);
  const e = easeInOut(t);
  const frame = { ...REST_FRAME };
  switch (style) {
    case 'SWITCH_OUT_NONE_ANIMATION':
      return null;
    case 'SWITCH_IN_ANIMATION_ZOOM':
      return { ...frame, scale: 0.5 + 0.5 * e, opacity: e };
    case 'SWITCH_IN_ANIMATION_MOVE_FADE':
      return { ...frame, scale: 1 + 0.5 * (1 - e), opacity: e, tx: 100 * (1 - e) };
    case 'SWITCH_IN_ANIMATION_MOVE_FROM_RIGHT':
      return { ...frame, tx: w * (1 - e) };
    case 'SWITCH_IN_ANIMATION_MOVE_FROM_LEFT':
      return { ...frame, tx: -w * (1 - e) };
    case 'SWITCH_IN_ANIMATION_BOUNCE_FROM_RIGHT':
      return { ...frame, tx: w * (1 - bounceEaseOut(t)) };
    case 'SWITCH_IN_ANIMATION_FADE':
      return { ...frame, opacity: e };
    case 'SWITCH_OUT_ANIMATION_ZOOM':
      return { ...frame, scale: 1 - 0.5 * e, opacity: 1 - e };
    case 'SWITCH_OUT_ANIMATION_MOVE_TO_RIGHT':
      return { ...frame, tx: w * e };
    case 'SWITCH_OUT_ANIMATION_MOVE_TO_LEFT':
      return { ...frame, tx: -w * e };
    case 'SWITCH_OUT_ANIMATION_FADE':
      return { ...frame, opacity: 1 - e };
    case 'SWITCH_IN_ANIMATION_ZOOM_FROM_TOP_LEFT':
      return { ...frame, scale: 0.3 + 0.7 * e, opacity: e, originX: 0, originY: 0 };
    case 'SWITCH_IN_ANIMATION_ZOOM_FROM_TOP_RIGHT':
      return { ...frame, scale: 0.3 + 0.7 * e, opacity: e, originX: 1, originY: 0 };
    case 'SWITCH_OUT_ANIMATION_ZOOM_TO_TOP_LEFT':
      return { ...frame, scale: 1 - e, opacity: 1 - e, originX: 0, originY: 0 };
    case 'SWITCH_OUT_ANIMATION_ZOOM_TO_TOP_RIGHT':
      return { ...frame, scale: 1 - 0.7 * e, opacity: 1 - e, originX: 1, originY: 0 };
    default:
      return frame;
  }
}

/** 引擎模糊强度：比例 ≤ 0.1 不模糊，≥ 0.5 最强 */
function blurAmount(ratio: number): number {
  const MAX_BLUR_PX = 8;
  return ratio <= 0.1 ? 0 : MAX_BLUR_PX * Math.min(1, (ratio - 0.1) / 0.4);
}

/**
 * 一页按某个引擎样式、在切换距离 release 时的画面；null = 这一帧看不见
 */
export function engineStyleFrame(style: string | undefined, release: number, w: number, h: number): PageFrame | null {
  if (!style || style === 'SWITCH_INIT_STATE') {
    return { ...REST_FRAME };
  }
  if (style.endsWith('_ANIMATION') || style.includes('_ANIMATION_')) {
    return animationFrame(style, release / h, w);
  }
  if (style.endsWith('_STILL_USE_BLUR')) {
    // 原地不动：离场页逐渐模糊，进场页由模糊变清晰
    const ratio = clamp01(release / w);
    return { ...REST_FRAME, blur: blurAmount(style.startsWith('SWITCH_OUT_') ? ratio : 1 - ratio) };
  }

  const { ox, oy } = directionOffset(style, release, w, h);
  if (style.endsWith('_USE_TRANSLATION')) {
    return { ...REST_FRAME, tx: ox, ty: oy };
  }
  if (style.endsWith('_USE_REDUCTION')) {
    const sx = Math.abs(ox) % w;
    const sy = Math.abs(oy) % h;
    const s = sx ? 1 - sx / w : 1 - sy / h;
    return { ...REST_FRAME, tx: ox, ty: oy, scale: Math.min(1, Math.max(0.2, s)) };
  }
  if (style.endsWith('_USE_ROTATE')) {
    const ry = 90 * ox / (w / 2);
    const rx = -90 * oy / (h / 2);
    // 转过 90° 背面朝外，引擎把它挪出屏幕
    if (Math.abs(rx) > 90 || Math.abs(ry) > 90) {
      return null;
    }
    return { ...REST_FRAME, rotateX: rx, rotateY: ry };
  }
  if (style.endsWith('_USE_CUBE')) {
    const ry = 90 * ox / w;
    const rx = -90 * oy / h;
    if (Math.abs(rx) > 70 || Math.abs(ry) > 70) {
      return null;
    }
    // 引擎顶点按两倍页面尺寸取、外推 (w + h) / 2，折回页面尺寸约是半个页宽
    return { ...REST_FRAME, rotateX: rx, rotateY: ry, depth: (w + h) / 4 };
  }
  return { ...REST_FRAME };
}

export interface EngineSwitchTimeline {
  durationMs: number;
  /** 均匀采样的各帧；最后一帧是切换完成后的样子 */
  from: (PageFrame | null)[];
  to: (PageFrame | null)[];
}

/**
 * 代码直接切换（gui_view_switch_direct）的整段画面，按 fps 均匀采样。
 * 切换距离从 0 线性走到页面高度，共 高度 / animateStep 帧；走满即切换完成：旧页消失，新页归位。
 */
export function engineSwitchTimeline(
  switchOutStyle: string | undefined,
  switchInStyle: string | undefined,
  w: number,
  h: number,
  animateStep: number,
  fps = 60,
): EngineSwitchTimeline {
  const outStyle = switchOutStyle || DEFAULT_SWITCH_OUT;
  const inStyle = switchInStyle || DEFAULT_SWITCH_IN;
  const step = Math.min(h, Math.max(1, animateStep));
  const engineFrames = Math.ceil(h / step);
  const durationMs = engineFrames * ENGINE_FRAME_MS;
  const samples = Math.max(2, Math.round(durationMs * fps / 1000) + 1);

  const from: (PageFrame | null)[] = [];
  const to: (PageFrame | null)[] = [];
  for (let i = 0; i < samples - 1; i++) {
    const release = h * i / (samples - 1);
    from.push(engineStyleFrame(outStyle, release, w, h));
    to.push(engineStyleFrame(inStyle, release, w, h));
  }
  from.push(null);
  to.push({ ...REST_FRAME });
  return { durationMs, from, to };
}
