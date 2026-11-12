/**
 * 项目级共享样式（styles.json）
 *
 * 工程根目录下的 styles.json 保存「样式名 → 一组视觉属性」。组件的 styleName
 * 指向其中一条，解析时把这条的属性合并进组件自身样式。
 *
 * 只有纯视觉属性可以进入样式：位置尺寸、图片路径、文本、定时器、事件都不允许，
 * 否则改一条样式会连带挪动所有引用它的组件。合并规则是「样式打底，组件自身属性覆盖」，
 * 所以单个组件仍可局部微调。
 *
 * 本文件是纯函数 + 无 vscode 依赖，桌面版（插件）与浏览器版共用：
 * - 插件：HmlController 解析后调用 applySharedStyles 展开，代码生成、快速预览、
 *   设计器看到的是同一份已解析属性。
 * - 浏览器版：styles.json 随工程文件一起读入。
 */

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

const ALLOWED = new Set([...SHARED_STYLE_PROPERTIES, ...SHARED_STYLE_FONT_PROPERTIES]);

/**
 * 字体属性在 HML 解析后落在 component.data（见 HmlParser 的 dataProps），
 * 其余样式属性落在 component.style。合并样式时按同一规则分流，
 * 代码生成读到的位置才与手写属性一致。
 */
const DATA_BUCKET = new Set(SHARED_STYLE_FONT_PROPERTIES);

export function sharedStyleBucket(property: string): 'style' | 'data' {
  return DATA_BUCKET.has(property) ? 'data' : 'style';
}

/**
 * 组件解析后，该属性的值实际落在哪个对象上（styles 展开与「是否覆盖」判断共用）。
 * 这里只描述样式属性：字体类在 data，其余在 style。
 */
export function readComponentStyleValue(
  component: { style?: Record<string, any>; data?: Record<string, any> },
  property: string,
): unknown {
  const bucket = sharedStyleBucket(property) === 'data' ? component.data : component.style;
  return bucket?.[property];
}

/**
 * 组件上的该属性是否就是样式给的值（用于序列化时不把展开结果写回 HML）。
 * 比较字符串形式：解析后的 number / boolean 与样式里的字符串按文本一致即视为同一个值。
 */
export function matchesStyleValue(style: SharedStyle | undefined, property: string, value: unknown): boolean {
  if (!style || value === undefined || value === null) {
    return false;
  }
  const raw = style.props[property];
  if (raw === undefined) {
    return false;
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
 * 样式落到某种组件上的实际属性（处理主色别名）。
 * 解析展开、序列化比较、预览展开、设计器套用都要用它，否则同一条样式在几处的理解不一致。
 */
export function resolveSharedStyle(style: SharedStyle | undefined, componentType: string): SharedStyle | undefined {
  const target = PRIMARY_COLOR_PROPERTY[componentType];
  if (!style || !target || style.props.color === undefined || style.props[target] !== undefined) {
    return style;
  }
  const { color, ...rest } = style.props;
  return { ...style, props: { ...rest, [target]: color } };
}

/**
 * 把共享样式合并进一个组件的 style / data。
 *
 * 规则：样式打底，组件自身已有属性覆盖样式（局部微调优先）。
 * 属性落在 style 还是 data 由调用方的 resolveBucket 决定——HML 解析后每类组件的
 * 两种存储位置不同（例如 fontSize 在 hg_label.data，borderRadius 在 style），
 * 因此这里不猜，交给调用方按现有归类规则判断。
 *
 * @returns 新对象；未引用样式或样式不存在时返回原对象（便于调用方跳过写回）
 */
export function mergeSharedStyle<T extends { style?: Record<string, any>; data?: Record<string, any> }>(
  component: T,
  style: SharedStyle | undefined,
  resolveBucket: (property: string) => 'style' | 'data',
): T {
  if (!style || Object.keys(style.props).length === 0) {
    return component;
  }

  const styleOut = { ...(component.style ?? {}) };
  const dataOut = { ...(component.data ?? {}) };
  let merged = false;

  for (const [property, raw] of Object.entries(style.props)) {
    const bucket = resolveBucket(property) === 'style' ? styleOut : dataOut;
    if (bucket[property] !== undefined && bucket[property] !== '') {
      continue; // 组件自身属性优先
    }
    bucket[property] = raw;
    merged = true;
  }

  if (!merged) {
    return component;
  }
  return { ...component, style: styleOut, data: dataOut } as T;
}
