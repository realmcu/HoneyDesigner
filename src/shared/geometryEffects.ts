/**
 * 发光与阴影模型（共享层）
 *
 * 对应 HoneyGUI 的 gui_rect_* / gui_circle_* 的 glow / shadow API：
 *   gui_rect_set_glow()、gui_rect_set_shadow() 及 shadow 的 color / blur / spread / direction 系列。
 * 代码生成、属性面板和画布预览共用这里的规整规则，保证三处对同一份 HML 的理解一致。
 *
 * 关键语义（与 SDK 头文件保持一致）：
 * - 颜色 alpha 即强度，alpha 为 0 等同于关闭；
 * - glow blur 为 0 视为关闭；shadow 需要先 set_shadow() 才会绘制；
 * - blur / spread / distance 的上限来自 GUI_GEOMETRY_GLOW_MAX_BLUR 等宏。
 */

/** 与 GUI_GEOMETRY_GLOW_MAX_BLUR / GUI_GEOMETRY_SHADOW_MAX_BLUR 一致 */
export const GEOMETRY_EFFECT_MAX_BLUR = 32;
/** 与 GUI_GEOMETRY_SHADOW_MAX_SPREAD 一致 */
export const GEOMETRY_SHADOW_MAX_SPREAD = 32;
/** 与 GUI_GEOMETRY_SHADOW_MAX_DISTANCE 一致 */
export const GEOMETRY_SHADOW_MAX_DISTANCE = 64;

/** 与 gui_shadow_dir_t 的九宫格预设一一对应 */
export type GeometryShadowDirection =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right';

export const GEOMETRY_SHADOW_DIRECTIONS: GeometryShadowDirection[] = [
  'top-left', 'top', 'top-right',
  'left', 'center', 'right',
  'bottom-left', 'bottom', 'bottom-right',
];

/** HML 取值 → i18n key（属性面板下拉标签，复用已有的方向文案） */
export const SHADOW_DIRECTION_LABEL_KEYS: Record<GeometryShadowDirection, string> = {
  'top-left': 'Top-Left',
  'top': 'Top-Center',
  'top-right': 'Top-Right',
  'left': 'Left-Center',
  'center': 'Center',
  'right': 'Right-Center',
  'bottom-left': 'Bottom-Left',
  'bottom': 'Bottom-Center',
  'bottom-right': 'Bottom-Right',
};

/** HML 取值 → GUI_SHADOW_DIR_* 枚举名 */
export const SHADOW_DIRECTION_ENUMS: Record<GeometryShadowDirection, string> = {
  'top-left': 'GUI_SHADOW_DIR_TOP_LEFT',
  'top': 'GUI_SHADOW_DIR_TOP',
  'top-right': 'GUI_SHADOW_DIR_TOP_RIGHT',
  'left': 'GUI_SHADOW_DIR_LEFT',
  'center': 'GUI_SHADOW_DIR_CENTER',
  'right': 'GUI_SHADOW_DIR_RIGHT',
  'bottom-left': 'GUI_SHADOW_DIR_BOTTOM_LEFT',
  'bottom': 'GUI_SHADOW_DIR_BOTTOM',
  'bottom-right': 'GUI_SHADOW_DIR_BOTTOM_RIGHT',
};

export interface GlowConfig {
  /** #RRGGBB */
  color: string;
  /** 强度，即颜色 alpha，0-255 */
  opacity: number;
  /** 模糊半径，1-32 像素 */
  blur: number;
}

export interface ShadowConfig {
  /** #RRGGBB */
  color: string;
  /** 强度，即颜色 alpha，0-255 */
  opacity: number;
  /** 模糊半径，1-32 像素 */
  blur: number;
  /** 每边向外扩张的像素数，0-32 */
  spread: number;
  /** 投射方向 */
  direction: GeometryShadowDirection;
  /** 偏移长度，0-64 像素 */
  distance: number;
}

export const DEFAULT_GLOW: GlowConfig = { color: '#FFFFFF', opacity: 128, blur: 12 };
export const DEFAULT_SHADOW: ShadowConfig = {
  color: '#000000',
  opacity: 128,
  blur: 12,
  spread: 0,
  direction: 'bottom-right',
  distance: 4,
};

/** 参与发光/阴影的样式属性名，序列化为 HML 属性、属性面板统一渲染 */
export const GEOMETRY_EFFECT_PROPERTIES = [
  'glowEnabled', 'glowColor', 'glowOpacity', 'glowBlur',
  'shadowEnabled', 'shadowColor', 'shadowOpacity', 'shadowBlur',
  'shadowSpread', 'shadowDirection', 'shadowDistance',
] as const;

/** 只有 HoneyGUI 引擎生成发光/阴影代码，LVGL 不展示这些属性 */
export function isGeometryEffectProperty(name: string): boolean {
  return (GEOMETRY_EFFECT_PROPERTIES as readonly string[]).includes(name);
}

type StyleBag = Record<string, any> | undefined;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

/** 颜色只接受 #RRGGBB，#RRGGBBAA 与 3 位简写都会规整为 6 位；无效值返回 fallback */
export function normalizeEffectColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const hex = value.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(hex)) return fallback;
  if (hex.length === 3) {
    return ('#' + hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]).toUpperCase();
  }
  if (hex.length === 6 || hex.length === 8) {
    return '#' + hex.slice(0, 6).toUpperCase();
  }
  return fallback;
}

/** 归一化后的发光配置；未启用（或 alpha/blur 为 0）时返回 null，表示不生成任何代码 */
export function resolveGlow(style: StyleBag): GlowConfig | null {
  if (style?.glowEnabled !== true) return null;

  const opacity = clampInt(style.glowOpacity, 0, 255, DEFAULT_GLOW.opacity);
  if (opacity === 0) return null;

  const blur = clampInt(style.glowBlur, 0, GEOMETRY_EFFECT_MAX_BLUR, DEFAULT_GLOW.blur);
  if (blur === 0) return null;

  return {
    color: normalizeEffectColor(style.glowColor, DEFAULT_GLOW.color),
    opacity,
    blur,
  };
}

/** 归一化后的阴影配置；未启用（或 alpha/blur 为 0）时返回 null */
export function resolveShadow(style: StyleBag): ShadowConfig | null {
  if (style?.shadowEnabled !== true) return null;

  const opacity = clampInt(style.shadowOpacity, 0, 255, DEFAULT_SHADOW.opacity);
  if (opacity === 0) return null;

  const blur = clampInt(style.shadowBlur, 0, GEOMETRY_EFFECT_MAX_BLUR, DEFAULT_SHADOW.blur);
  if (blur === 0) return null;

  const direction = GEOMETRY_SHADOW_DIRECTIONS.includes(style.shadowDirection)
    ? style.shadowDirection as GeometryShadowDirection
    : DEFAULT_SHADOW.direction;

  return {
    color: normalizeEffectColor(style.shadowColor, DEFAULT_SHADOW.color),
    opacity,
    blur,
    spread: clampInt(style.shadowSpread, 0, GEOMETRY_SHADOW_MAX_SPREAD, DEFAULT_SHADOW.spread),
    direction,
    distance: clampInt(style.shadowDistance, 0, GEOMETRY_SHADOW_MAX_DISTANCE, DEFAULT_SHADOW.distance),
  };
}

/**
 * 方向 + 距离 → 本地整数偏移，供画布预览使用。
 *
 * 与 SDK 的 gui_shadow_set_direction() 同样的处理：对角方向按整数取整，
 * 避免出现小数偏移；codegen 直接调用 SDK 函数，不依赖这里的算法。
 */
export function shadowOffset(direction: GeometryShadowDirection, distance: number): { dx: number; dy: number } {
  const d = clampInt(distance, 0, GEOMETRY_SHADOW_MAX_DISTANCE, 0);
  const diagonal = Math.round(d / Math.SQRT2);

  switch (direction) {
    case 'top-left': return { dx: -diagonal, dy: -diagonal };
    case 'top': return { dx: 0, dy: -d };
    case 'top-right': return { dx: diagonal, dy: -diagonal };
    case 'left': return { dx: -d, dy: 0 };
    case 'center': return { dx: 0, dy: 0 };
    case 'right': return { dx: d, dy: 0 };
    case 'bottom-left': return { dx: -diagonal, dy: diagonal };
    case 'bottom': return { dx: 0, dy: d };
    case 'bottom-right':
    default: return { dx: diagonal, dy: diagonal };
  }
}

/** #RRGGBB + alpha → CSS rgba()，供画布预览 */
export function toCssRgba(color: string, opacity: number): string {
  const hex = color.replace(/^#/, '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const alpha = Math.max(0, Math.min(255, Math.round(opacity))) / 255;
  return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`;
}

/** 发光 + 阴影 → CSS box-shadow 值（阴影在下、发光在上），未启用时返回 undefined */
export function toCssBoxShadow(style: StyleBag): string | undefined {
  const parts: string[] = [];

  const shadow = resolveShadow(style);
  if (shadow) {
    const { dx, dy } = shadowOffset(shadow.direction, shadow.distance);
    parts.push(`${dx}px ${dy}px ${shadow.blur}px ${shadow.spread}px ${toCssRgba(shadow.color, shadow.opacity)}`);
  }

  const glow = resolveGlow(style);
  if (glow) {
    parts.push(`0 0 ${glow.blur}px ${toCssRgba(glow.color, glow.opacity)}`);
  }

  return parts.length > 0 ? parts.join(', ') : undefined;
}
