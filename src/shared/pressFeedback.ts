/**
 * 按下反馈（组件属性 pressEffect）
 *
 * 手指按住某个图标/图形时给一点反馈，抬起再还原：
 * - pop  ：放大到 1.5 倍同时淡到 60%（应用宫格、拨号键盘、琴键）——手指按住时图标「鼓」出来。
 * - press：轻微缩小到 0.96（列表卡片、主要按钮），几乎察觉不到，但按下去有实感。
 * 按下 80 ms、抬起 180 ms，都用 ease-out。
 *
 * 开关挂在每个组件自己身上（图片、几何图形、标签……），不是整页的开关：同一页里只有
 * 勾了 pressEffect 的组件才有反馈。容器（view/window/list）整体变换没有意义，跳过。
 *
 * 纯函数、无 vscode 依赖，插件代码生成与 webview 预览共用。
 */

export type PressEffectMode = 'pop' | 'press';

export const PRESS_EFFECT_MODES: readonly PressEffectMode[] = ['pop', 'press'];

export interface PressFeedbackOptions {
  mode: PressEffectMode;
  /** 按下后的缩放 */
  scale: number;
  /** 按下后的不透明度（0~255） */
  opacity: number;
  /** 按下用时（毫秒） */
  downMs: number;
  /** 抬起用时（毫秒） */
  upMs: number;
}

/** 两档参数 */
const PROFILES: Record<PressEffectMode, Pick<PressFeedbackOptions, 'scale' | 'opacity'>> = {
  pop: { scale: 1.5, opacity: 153 },
  press: { scale: 0.96, opacity: 255 },
};

/** 按下快、抬起慢 */
export const PRESS_DOWN_MS = 80;
export const PRESS_UP_MS = 180;

export function isPressEffectMode(value: unknown): value is PressEffectMode {
  return typeof value === 'string' && (PRESS_EFFECT_MODES as readonly string[]).includes(value);
}

/** 从组件 data 读出按下反馈；未开启返回 null */
export function readPressFeedback(data: Record<string, any> | undefined): PressFeedbackOptions | null {
  const mode = data?.pressEffect;
  if (!isPressEffectMode(mode)) {
    return null;
  }
  return { mode, ...PROFILES[mode], downMs: PRESS_DOWN_MS, upMs: PRESS_UP_MS };
}

/**
 * 卡片当前缩放：progress 为 0（原样）~255（按住），ease-out。
 */
export function pressScaleAt(options: PressFeedbackOptions, progress: number): number {
  const t = clampProgress(progress);
  const eased = 1 - (1 - t) * (1 - t);
  return 1 + (options.scale - 1) * eased;
}

/** 卡片当前不透明度（0~255）：卡片原本的不透明度乘上按下的淡化 */
export function pressOpacityAt(options: PressFeedbackOptions, progress: number, base = 255): number {
  const t = clampProgress(progress);
  const eased = 1 - (1 - t) * (1 - t);
  return Math.round(base * (1 + (options.opacity / 255 - 1) * eased));
}

function clampProgress(progress: number): number {
  return Math.max(0, Math.min(1, progress / 255));
}

/** 容器整体按下没有意义，不生成反馈 */
export const PRESS_CONTAINER_TYPES = ['hg_view', 'hg_window', 'hg_list'];

export interface PressSource {
  id: string;
  type: string;
  parent?: string | null;
  visible?: boolean;
  position: { x: number; y: number; width: number; height: number };
  data?: Record<string, any>;
}

export interface PressTarget<T extends PressSource> {
  component: T;
  /** 缩放、淡出绕这个点（相对组件自身左上角） */
  pivot: [number, number];
}

export interface PressCollectRules<T extends PressSource = PressSource> {
  /** 引擎无法单独变换的组件 */
  skip?: (component: T) => boolean;
  /** 列表项里的组件要等滚动时才创建，创建时没有句柄可用 */
  skipInsideListItems?: boolean;
}

/**
 * 找出页面里开启了按下反馈的组件（组件级开关，不是整页开关）。
 * 只收本页的后代：列表项里的组件在 note_design 里才创建，HoneyGUI 下用 rules 排除。
 */
export function collectPressTargets<T extends PressSource>(
  view: { id: string },
  components: Iterable<T>,
  rules: PressCollectRules<T> = {},
): Array<PressTarget<T>> {
  const byId = new Map<string, T>();
  for (const component of components) {
    byId.set(component.id, component);
  }

  const insideListItem = (component: T): boolean => {
    let parent = component.parent;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const ancestor = byId.get(parent);
      if (!ancestor) {
        return false;
      }
      if (ancestor.type === 'hg_list_item') {
        return true;
      }
      parent = ancestor.parent;
    }
    return false;
  };

  const belongsToView = (component: T): boolean => {
    let parent = component.parent;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      if (parent === view.id) {
        return true;
      }
      seen.add(parent);
      parent = byId.get(parent)?.parent;
    }
    return false;
  };

  const targets: Array<PressTarget<T>> = [];
  for (const component of byId.values()) {
    if (!readPressFeedback(component.data) || component.visible === false) {
      continue;
    }
    if (PRESS_CONTAINER_TYPES.includes(component.type) || rules.skip?.(component)) {
      continue;
    }
    if (!belongsToView(component)) {
      continue;
    }
    if (rules.skipInsideListItems && insideListItem(component)) {
      continue;
    }
    targets.push({
      component,
      pivot: [Math.round(Number(component.position.width) / 2), Math.round(Number(component.position.height) / 2)],
    });
  }
  return targets;
}
