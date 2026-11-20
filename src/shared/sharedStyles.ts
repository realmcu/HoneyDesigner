/**
 * 项目级共享样式（styles.json）
 *
 * 工程根目录下的 styles.json 保存「样式名 → 一组视觉属性」。组件的 styleName
 * 指向其中一条，解析时把这条的属性合并进组件自身样式。
 *
 * 视觉属性与宽高可以进入样式；位置（x/y）、图片路径、文本、定时器、事件不允许，
 * 否则改一条样式会把所有引用它的组件挪到同一个地方。合并规则是「样式打底，组件自身属性覆盖」，
 * 所以单个组件仍可局部微调。
 *
 * 本文件是纯函数 + 无 vscode 依赖，桌面版（插件）与浏览器版共用：
 * - 插件：HmlParser 解析时展开，代码生成、快速预览、设计器看到的是同一份已解析属性。
 * - 浏览器版：styles.json 随工程文件一起读入。
 */

import { convertAttributeValue } from './componentPropertyTypes';

/** 允许出现在共享样式里的属性（白名单） */
export const SHARED_STYLE_PROPERTIES: readonly string[] = [
  // 颜色
  'color', 'backgroundColor', 'fillColor', 'strokeColor',
  // 文字
  'fontWeight', 'hAlign', 'vAlign', 'letterSpacing', 'lineSpacing', 'wordWrap', 'wordBreak',
  // 边框与形状
  'border', 'borderRadius', 'padding', 'margin', 'overflow',
  'radius', 'startAngle', 'endAngle', 'strokeWidth',
  // 透明度
  'opacity',
  // 渐变
  'useGradient', 'gradientType', 'gradientDirection', 'gradientBox', 'gradientStops',
  // 发光与阴影（hg_rect / hg_circle）
  'glowEnabled', 'glowColor', 'glowOpacity', 'glowBlur',
  'shadowEnabled', 'shadowColor', 'shadowOpacity', 'shadowBlur', 'shadowSpread',
  'shadowDirection', 'shadowDistance',
];

/**
 * 字体也属于视觉属性，但字体文件与字号同时决定生成的字体资源，换字号会换资源文件；
 * 放进样式后所有引用它的组件共用同一份字体，这正是「标题文字」这类样式想要的，
 * 所以一并允许。
 */
export const SHARED_STYLE_FONT_PROPERTIES: readonly string[] = ['fontFile', 'fontSize', 'fontType', 'renderMode'];

/**
 * 尺寸：一组同样大小的卡片、按钮是最常见的复用场景。宽高落在 component.position，
 * 位置（x/y）不允许进样式。
 */
export const SHARED_STYLE_SIZE_PROPERTIES: readonly string[] = ['width', 'height'];

/**
 * 尺寸由别的属性或父容器决定的组件不接收样式里的宽高：页面跟随屏幕、列表项由列表排布、
 * 圆形和圆弧的宽高由半径算出。
 */
const SIZE_DERIVED_TYPES = new Set(['hg_view', 'hg_list_item', 'hg_circle', 'hg_arc']);

export function acceptsSharedSize(componentType: string | undefined): boolean {
  return !!componentType && !SIZE_DERIVED_TYPES.has(componentType);
}

const ALLOWED = new Set([...SHARED_STYLE_PROPERTIES, ...SHARED_STYLE_FONT_PROPERTIES, ...SHARED_STYLE_SIZE_PROPERTIES]);

/**
 * 解析后属性落在哪里，与 HmlParser 的归类一致：字体类与渐变色标在 component.data，
 * 宽高在 component.position，其余在 component.style。
 */
const DATA_BUCKET = new Set([...SHARED_STYLE_FONT_PROPERTIES, 'gradientStops']);
const POSITION_BUCKET = new Set(SHARED_STYLE_SIZE_PROPERTIES);

export type SharedStyleBucket = 'style' | 'data' | 'position';

export function sharedStyleBucket(property: string): SharedStyleBucket {
  if (POSITION_BUCKET.has(property)) {
    return 'position';
  }
  return DATA_BUCKET.has(property) ? 'data' : 'style';
}

interface StyledComponentLike {
  type?: string;
  style?: Record<string, any>;
  data?: Record<string, any>;
  position?: { width?: number; height?: number };
}

/** 组件解析后该样式属性的值（styles 展开与「是否覆盖」判断共用） */
export function readComponentStyleValue(component: StyledComponentLike, property: string): unknown {
  const bucket = sharedStyleBucket(property);
  if (bucket === 'position') {
    return (component.position as Record<string, unknown> | undefined)?.[property];
  }
  return (bucket === 'data' ? component.data : component.style)?.[property];
}

/**
 * HML 属性解析后不全是字符串：数字、开关、渐变色标数组都已转换。
 * 设计器套用样式时按同样规则转换，否则画布拿到 "18" 这样的字符串，圆角等直接失效。
 * 规则与 HmlParser._categorizeAttributes 保持一致。
 */
const NUMERIC_STYLE_PROPERTIES = new Set([
  'borderRadius', 'padding', 'margin', 'radius', 'startAngle', 'endAngle', 'strokeWidth', 'opacity',
  'glowOpacity', 'glowBlur', 'shadowOpacity', 'shadowBlur', 'shadowSpread', 'shadowDistance',
]);

export function parseSharedStyleValue(componentType: string, property: string, raw: string): unknown {
  if (POSITION_BUCKET.has(property)) {
    const size = parseInt(raw, 10);
    return Number.isNaN(size) ? undefined : size;
  }
  if (property === 'gradientStops') {
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const value = convertAttributeValue(componentType, property, raw);
  if (typeof value === 'string' && NUMERIC_STYLE_PROPERTIES.has(property)) {
    const num = parseFloat(value);
    return Number.isNaN(num) ? value : num;
  }
  return value;
}

/**
 * 组件上的该属性是否就是样式给的值（用于序列化时不把展开结果写回 HML）。
 * 解析后的 number / boolean 与样式里的字符串按文本比较；数组等结构按 JSON 比较。
 */
export function matchesStyleValue(style: SharedStyle | undefined, property: string, value: unknown): boolean {
  if (!style || value === undefined || value === null) {
    return false;
  }
  const raw = style.props[property];
  if (raw === undefined) {
    return false;
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(JSON.parse(raw)) === JSON.stringify(value);
    } catch {
      return false;
    }
  }
  return String(value) === raw.trim();
}

/** styles.json 里的一条样式 */
export interface SharedStyle {
  /** 唯一 id，组件用 styleName 引用；只允许字母、数字、下划线、连字符 */
  id: string;
  /** 列表里显示的名字，缺省时用 id */
  name?: string;
  /** 属性名 → 值（字符串形式，与 HML 属性写法一致） */
  props: Record<string, string>;
}

export interface SharedStyleLibrary {
  version: 1;
  styles: SharedStyle[];
}

/** styles.json 相对工程根目录的路径 */
export const SHARED_STYLES_RELATIVE_PATH = 'styles.json';

export const STYLE_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function createEmptyStyleLibrary(): SharedStyleLibrary {
  return { version: 1, styles: [] };
}

/** 属性是否允许写进共享样式（属性面板据此决定是否显示「应用到样式」） */
export function isShareableStyleProperty(property: string): boolean {
  return ALLOWED.has(property);
}

/**
 * 规范化 styles.json 内容：丢弃非法 id、重复 id、白名单之外的属性以及空值。
 * 解析失败时返回空库并给出提示信息，不抛异常——样式文件坏了不应该让工程打不开。
 */
export function normalizeStyleLibrary(raw: unknown): { library: SharedStyleLibrary; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { library: createEmptyStyleLibrary(), errors: ['styles.json is not an object'] };
  }

  const rawStyles = Array.isArray((raw as any).styles) ? (raw as any).styles : [];
  const seen = new Set<string>();
  const styles: SharedStyle[] = [];

  for (const item of rawStyles) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!STYLE_ID_PATTERN.test(id)) {
      errors.push(`Invalid style id: ${JSON.stringify(item.id)}`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`Duplicate style id: ${id}`);
      continue;
    }
    seen.add(id);

    const props: Record<string, string> = {};
    const rawProps = item.props && typeof item.props === 'object' ? item.props : {};
    for (const [key, value] of Object.entries(rawProps)) {
      if (!ALLOWED.has(key)) {
        errors.push(`Style ${id}: "${key}" is not a shareable style property`);
        continue;
      }
      if (value === undefined || value === null || value === '') {
        continue;
      }
      props[key] = typeof value === 'string' ? value : String(value);
    }

    styles.push({
      id,
      ...(typeof item.name === 'string' && item.name.trim() ? { name: item.name.trim() } : {}),
      props,
    });
  }

  return { library: { version: 1, styles }, errors };
}

/** 找一条样式；不存在返回 undefined */
export function findSharedStyle(library: SharedStyleLibrary | undefined, id: string | undefined): SharedStyle | undefined {
  if (!library || !id) {
    return undefined;
  }
  return library.styles.find(style => style.id === id);
}

/**
 * 「主色」在不同组件上的属性名：文字、圆弧等用 color，矩形和圆形的主色是填充色 fillColor。
 * 颜色样式通常就是想统一主色，所以样式里的 color 用在矩形/圆形上时按 fillColor 处理；
 * 样式同时写了 fillColor 时以 fillColor 为准。
 */
const PRIMARY_COLOR_PROPERTY: Record<string, string> = {
  hg_rect: 'fillColor',
  hg_circle: 'fillColor',
};

/**
 * 样式落到某种组件上的实际属性：处理主色别名，去掉该组件不接收的宽高。
 * 解析展开、序列化比较、预览展开、设计器套用都要用它，否则同一条样式在几处的理解不一致。
 */
export function resolveSharedStyle(style: SharedStyle | undefined, componentType: string): SharedStyle | undefined {
  if (!style) {
    return style;
  }
  let props = style.props;
  const target = PRIMARY_COLOR_PROPERTY[componentType];
  if (target && props.color !== undefined && props[target] === undefined) {
    const { color, ...rest } = props;
    props = { ...rest, [target]: color };
  }
  if (!acceptsSharedSize(componentType) && SHARED_STYLE_SIZE_PROPERTIES.some(property => property in props)) {
    props = Object.fromEntries(Object.entries(props).filter(([property]) => !POSITION_BUCKET.has(property)));
  }
  return props === style.props ? style : { ...style, props };
}

/**
 * 把共享样式合并进一个标签的属性（HML 解析前一步）。
 *
 * 规则：样式打底，标签上已有的属性覆盖样式（局部微调优先）。合并成属性再走解析器原有的
 * 归类与类型转换，样式给的值与手写在标签上的值得到完全相同的类型和存放位置。
 *
 * @returns 新对象；样式为空时返回原对象
 */
export function mergeSharedStyleAttributes<T extends Record<string, any>>(attributes: T, style: SharedStyle | undefined): T {
  if (!style || Object.keys(style.props).length === 0) {
    return attributes;
  }
  const merged: Record<string, any> = { ...attributes };
  for (const [property, raw] of Object.entries(style.props)) {
    if (merged[property] === undefined || merged[property] === '') {
      merged[property] = raw;
    }
  }
  return merged as T;
}
