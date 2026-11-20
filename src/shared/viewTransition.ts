/**
 * 自定义页面转场（switchView 的 switchInStyle 取值）
 *
 * 引擎自带的切换样式（平移、立方体、缩放……）只能二选一地动「旧页」或「新页」，做不出
 * 系统级的层次感。这里补三种设计器预设，旧页、新页一起编排：
 * - 纵深缩放 SWITCH_IN_DEPTH_ZOOM：旧页缩小变暗退到后面，新页从略大缩回原样并淡入（进入详情页）。
 * - 底部弹层 SWITCH_IN_SHEET_UP：新页从底部弹起、带一点回弹，旧页轻微缩小变暗（设置面板、弹出菜单）。
 * - 圆形揭示 SWITCH_IN_CIRCLE_REVEAL：从点击位置扩出一个新页底色的圆铺满屏幕，再淡入新页内容（打开应用）。
 *
 * 预设同时决定旧页的动作，所以选了预设之后 switchOutStyle 不再起作用。
 * HoneyGUI 下由生成的 hg_view_transition_switch() 播放（旧页、新页都按 SWITCH_INIT_STATE 切换，
 * 再按时间改写两页的 matrix / 透明度）；LVGL 与滑动手势触发时降级为最接近的引擎样式。
 *
 * 纯函数、无 vscode 依赖，插件代码生成与 webview 预览共用。
 */

export type ViewTransitionPreset =
  | 'SWITCH_IN_DEPTH_ZOOM'
  | 'SWITCH_IN_SHEET_UP'
  | 'SWITCH_IN_CIRCLE_REVEAL';

export const VIEW_TRANSITION_PRESETS: readonly ViewTransitionPreset[] = [
  'SWITCH_IN_DEPTH_ZOOM',
  'SWITCH_IN_SHEET_UP',
  'SWITCH_IN_CIRCLE_REVEAL',
];

/** 早期列表、文档里的「中心缩放淡入」引擎并不支持，按纵深缩放处理 */
const PRESET_ALIASES: Record<string, ViewTransitionPreset> = {
  SWITCH_IN_CENTER_ZOOM_FADE: 'SWITCH_IN_DEPTH_ZOOM',
  SWITCH_IN_ANIMATION_CENTER_ZOOM_FADE: 'SWITCH_IN_DEPTH_ZOOM',
};

/** 所有会被当成预设的取值（含别名） */
export const VIEW_TRANSITION_NAMES: readonly string[] = [...VIEW_TRANSITION_PRESETS, ...Object.keys(PRESET_ALIASES)];

export type TransitionCurve = 'easeOut' | 'easeOutBack' | 'spring';

/** 轻弹簧：只过冲一次（峰值约 8%），到 t=1 时正好落回原位 */
export const SPRING_OMEGA = 3.5;

export interface ViewTransitionProfile {
  /** 生成的 C 代码里的编号（hg_view_transition_switch 的第二个参数） */
  id: number;
  durationMs: number;
  /** 旧页的动作曲线，保持单调，别回弹 */
  curve: TransitionCurve;
  /** 新页进场的曲线，不给就用 curve；弹簧只加在这里 */
  toCurve?: TransitionCurve;
  /** 旧页最终的缩放与不透明度（0~1）；起点是原样 */
  fromScale: number;
  fromOpacity: number;
  /** 新页起始的缩放、不透明度（0~1）、竖直偏移（占屏高的比例）；终点是原样 */
  toScale: number;
  toOpacity: number;
  toOffsetY: number;
  /** 新页淡入所占的时间段（总时长的比例） */
  toFade: [number, number];
  /**
   * 新页里的子控件逐个进场（不是整页一起动）：起点、每个之间的间隔、单个的时长、
   * 上滑距离（px）。不给就整页一起动
   */
  stagger?: { start: number; step: number; window: number; slide: number };
  /** 圆形揭示：圆从 0 扩到铺满所占的时间段；不揭示为 null */
  circle: [number, number] | null;
}

export const VIEW_TRANSITION_PROFILES: Record<ViewTransitionPreset, ViewTransitionProfile> = {
  SWITCH_IN_DEPTH_ZOOM: {
    id: 1,
    durationMs: 380,
    curve: 'easeOut',
    toCurve: 'spring',
    fromScale: 0.92,
    fromOpacity: 0.55,
    toScale: 1.08,
    toOpacity: 0,
    toOffsetY: 0,
    toFade: [0, 0.7],
    stagger: { start: 0.1, step: 0.055, window: 0.5, slide: 12 },
    circle: null,
  },
  SWITCH_IN_SHEET_UP: {
    id: 2,
    durationMs: 420,
    curve: 'easeOut',
    toCurve: 'spring',
    fromScale: 0.94,
    fromOpacity: 0.6,
    toScale: 1,
    toOpacity: 1,
    toOffsetY: 1,
    toFade: [0, 1],
    stagger: { start: 0.12, step: 0.06, window: 0.5, slide: 16 },
    circle: null,
  },
  SWITCH_IN_CIRCLE_REVEAL: {
    id: 3,
    durationMs: 420,
    curve: 'easeOut',
    fromScale: 1,
    fromOpacity: 1,
    toScale: 1,
    toOpacity: 0,
    toOffsetY: 0,
    toFade: [0.55, 1],
    stagger: { start: 0.5, step: 0.05, window: 0.45, slide: 12 },
    circle: [0, 0.75],
  },
};

/** 回弹曲线的过冲力度：比常见的 1.70158 小，弹层只冒出一点点，底边不会露出太多旧页 */
export const EASE_OUT_BACK_OVERSHOOT = 1.2;

/**
 * 滑动手势（gui_view_switch_on_event）和 LVGL 不走自定义播放，降级为最接近的引擎样式
 */
const ENGINE_FALLBACK: Record<ViewTransitionPreset, { out: string; in: string }> = {
  SWITCH_IN_DEPTH_ZOOM: { out: 'SWITCH_INIT_STATE', in: 'SWITCH_IN_ANIMATION_ZOOM' },
  SWITCH_IN_SHEET_UP: { out: 'SWITCH_INIT_STATE', in: 'SWITCH_IN_FROM_BOTTOM_USE_TRANSLATION' },
  SWITCH_IN_CIRCLE_REVEAL: { out: 'SWITCH_INIT_STATE', in: 'SWITCH_IN_ANIMATION_FADE' },
};

/** 把 switchInStyle 解析成预设；引擎样式返回 null */
export function readViewTransition(switchInStyle: unknown): ViewTransitionPreset | null {
  if (typeof switchInStyle !== 'string') {
    return null;
  }
  if ((VIEW_TRANSITION_PRESETS as readonly string[]).includes(switchInStyle)) {
    return switchInStyle as ViewTransitionPreset;
  }
  return PRESET_ALIASES[switchInStyle] ?? null;
}

export function isCustomViewTransition(switchInStyle: unknown): boolean {
  return readViewTransition(switchInStyle) !== null;
}

/** 下拉框里显示用：别名显示成它对应的预设 */
export function normalizeSwitchInStyle(switchInStyle: string | undefined): string | undefined {
  return readViewTransition(switchInStyle) ?? switchInStyle;
}

/** 引擎能直接识别的 (out, in)：预设换成降级样式，其它原样返回 */
export function engineSwitchStyles(switchOutStyle: string, switchInStyle: string): { out: string; in: string } {
  const preset = readViewTransition(switchInStyle);
  return preset ? ENGINE_FALLBACK[preset] : { out: switchOutStyle, in: switchInStyle };
}

export function transitionCurveAt(curve: TransitionCurve, t: number): number {
  const p = Math.max(0, Math.min(1, t));
  if (curve === 'spring') {
    // 衰减余弦：0 出发、越过 1 约 8%、t=1 时归位；只用 cos，C 里一样好算
    const q = 1 - p;
    return 1 - q * q * Math.cos(SPRING_OMEGA * p);
  }
  if (curve === 'easeOutBack') {
    const c1 = EASE_OUT_BACK_OVERSHOOT;
    const c3 = c1 + 1;
    const q = p - 1;
    return 1 + c3 * q * q * q + c1 * q * q;
  }
  const q = 1 - p;
  return 1 - q * q * q;
}

/** t 在 [start, end] 里线性走 0→1，之外夹住 */
export function windowProgress(t: number, window: [number, number]): number {
  const [start, end] = window;
  if (end <= start) {
    return t >= end ? 1 : 0;
  }
  return Math.max(0, Math.min(1, (t - start) / (end - start)));
}

export interface ViewTransitionFrame {
  fromScale: number;
  fromOpacity: number;
  toScale: number;
  toOpacity: number;
  /** 新页竖直偏移（占屏高的比例） */
  toOffsetY: number;
  /** 揭示圆半径（占「点击点到最远角距离」的比例）；不揭示为 0 */
  circle: number;
}

/** t 为 0~1 的时间进度时两页的样子；C 代码按同一套公式逐帧计算 */
export function viewTransitionFrameAt(profile: ViewTransitionProfile, t: number): ViewTransitionFrame {
  const e = transitionCurveAt(profile.curve, t);
  const eTo = transitionCurveAt(profile.toCurve ?? profile.curve, t);
  const fade = transitionCurveAt('easeOut', windowProgress(t, profile.toFade));
  return {
    fromScale: 1 + (profile.fromScale - 1) * e,
    fromOpacity: 1 + (profile.fromOpacity - 1) * e,
    toScale: profile.toScale + (1 - profile.toScale) * eTo,
    toOpacity: profile.toOpacity + (1 - profile.toOpacity) * fade,
    toOffsetY: profile.toOffsetY * (1 - eTo),
    circle: profile.circle ? transitionCurveAt('easeOut', windowProgress(t, profile.circle)) : 0,
  };
}
