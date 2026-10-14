/**
 * 文本渐变填充模型（共享层）
 *
 * 对应 HoneyGUI gui_text_set_gradient() / gui_text_set_gradient_box()。
 * 代码生成与画布预览共用这里的规整规则，保证两边色标顺序、截断和预设一致。
 */

export type TextGradientDirection = 'horizontal' | 'vertical' | 'diagonal_tl_br' | 'diagonal_tr_bl';
export type TextGradientBox = 'layout' | 'ink' | 'widget';

export interface TextGradientStop {
  /** 0.0 - 1.0 */
  position: number;
  /** #RRGGBB 或 #RRGGBBAA */
  color: string;
}

export interface TextGradientConfig {
  direction: TextGradientDirection;
  box: TextGradientBox;
  /** 已截断并按 position 升序排列，至少 2 个 */
  stops: TextGradientStop[];
}

/** 与 GUI_TEXT_GRADIENT_MAX_STOPS 一致 */
export const TEXT_GRADIENT_MAX_STOPS = 8;

export const TEXT_GRADIENT_DIRECTIONS: TextGradientDirection[] = ['horizontal', 'vertical', 'diagonal_tl_br', 'diagonal_tr_bl'];
export const TEXT_GRADIENT_BOXES: TextGradientBox[] = ['layout', 'ink', 'widget'];

export const DEFAULT_TEXT_GRADIENT_BOX: TextGradientBox = 'layout';

/** 方向预设的起止点 [x0, y0, x1, y1]，按参照框归一化，与 SDK gradient_preset_handles 一致 */
export const TEXT_GRADIENT_PRESET_HANDLES: Record<TextGradientDirection, [number, number, number, number]> = {
  horizontal: [0, 0.5, 1, 0.5],
  vertical: [0.5, 0, 0.5, 1],
  diagonal_tl_br: [0, 0, 1, 1],
  diagonal_tr_bl: [1, 0, 0, 1],
};

const COLOR_PATTERN = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function isTruthy(value: unknown): boolean {
  return value === true || value === 'true';
}

/**
 * 规整 HML 中的色标：丢弃非法项，position 截到 0..1。
 * SDK 先截断到前 8 个再排序，这里保持相同顺序，避免超过 8 个时两边取到不同色标。
 */
export function normalizeTextGradientStops(raw: unknown): TextGradientStop[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const valid: TextGradientStop[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const { position, color } = item as { position?: unknown; color?: unknown };
    const pos = Number(position);
    if (!Number.isFinite(pos) || typeof color !== 'string' || !COLOR_PATTERN.test(color)) {
      continue;
    }
    valid.push({ position: Math.min(1, Math.max(0, pos)), color });
  }
  return valid
    .slice(0, TEXT_GRADIENT_MAX_STOPS)
    .map((stop, index) => ({ stop, index }))
    .sort((a, b) => a.stop.position - b.stop.position || a.index - b.index)
    .map(({ stop }) => stop);
}

/**
 * 从组件 style/data 解析生效的文本渐变；未启用或色标不足 2 个时返回 null。
 * 不检查字体类型，调用方按需判断 isVectorTextFont()。
 */
export function resolveTextGradient(
  style: Record<string, unknown> | undefined,
  data: Record<string, unknown> | undefined
): TextGradientConfig | null {
  if (!isTruthy(style?.useGradient)) {
    return null;
  }
  const stops = normalizeTextGradientStops(data?.gradientStops);
  if (stops.length < 2) {
    return null;
  }
  const direction = TEXT_GRADIENT_DIRECTIONS.includes(style?.gradientDirection as TextGradientDirection)
    ? style!.gradientDirection as TextGradientDirection
    : 'horizontal';
  const box = TEXT_GRADIENT_BOXES.includes(style?.gradientBox as TextGradientBox)
    ? style!.gradientBox as TextGradientBox
    : DEFAULT_TEXT_GRADIENT_BOX;
  return { direction, box, stops };
}

/** HoneyGUI 只对 TTF 矢量字体绘制渐变 */
export function isVectorTextFont(data: Record<string, unknown> | undefined): boolean {
  return data?.fontType === 'vector';
}

export interface GradientRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 把 HoneyGUI 的渐变映射换算成 CSS linear-gradient。
 *
 * SDK 中像素 (x, y) 的色标位置 t = ((u-u0)·du + (v-v0)·dv) / |d|²，(u, v) 为按参照框
 * 归一化的坐标。t 是像素坐标的仿射函数，可精确表示为以元素中心为基准的 CSS 渐变线。
 *
 * @param box 参照框，坐标相对于绘制背景的元素
 * @param elementWidth 绘制背景的元素宽度（CSS 渐变线长度据此计算）
 * @param elementHeight 绘制背景的元素高度
 * @returns CSS background-image 值
 */
export function buildTextGradientCss(
  config: TextGradientConfig,
  box: GradientRect,
  elementWidth: number,
  elementHeight: number
): string {
  const [hx0, hy0, hx1, hy1] = TEXT_GRADIENT_PRESET_HANDLES[config.direction];
  const du = hx1 - hx0;
  const dv = hy1 - hy0;
  const len2 = du * du + dv * dv;
  const bw = Math.max(box.width, 1);
  const bh = Math.max(box.height, 1);

  // 起止点距离小于参照框 1/16 时，SDK 整段绘制第一个色标
  if (len2 < 1 / 256) {
    const first = config.stops[0].color;
    return `linear-gradient(${first}, ${first})`;
  }

  // t(X, Y) = a·X + b·Y + c，X/Y 为元素内 CSS 像素坐标
  const a = du / (len2 * bw);
  const b = dv / (len2 * bh);
  const c = -(du * box.x / bw + dv * box.y / bh + hx0 * du + hy0 * dv) / len2;
  const g = Math.hypot(a, b);

  // CSS 角度 θ 的渐变方向为 (sinθ, -cosθ)，渐变线过元素中心，长度 |W·sinθ| + |H·cosθ|
  const angle = Math.atan2(a, -b);
  const lineLength = Math.abs(elementWidth * Math.sin(angle)) + Math.abs(elementHeight * Math.cos(angle));
  const tCenter = a * elementWidth / 2 + b * elementHeight / 2 + c;

  const stops = config.stops
    .map((stop) => `${stop.color} ${round4((stop.position - tCenter) / g + lineLength / 2)}px`)
    .join(', ');
  return `linear-gradient(${round4(angle * 180 / Math.PI)}deg, ${stops})`;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
