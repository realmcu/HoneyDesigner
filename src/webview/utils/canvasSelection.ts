/**
 * 画布单击目标决策（纯逻辑，便于单测）。
 *
 * 这里的规则决定了「按下鼠标时到底操作哪个控件」，直接对应用户能感知的行为：
 * 选不选得中、拖不拖得动。抽出成纯函数是因为它被三个互相牵制的需求同时约束：
 *   1. 重叠时能逐层穿透到下层控件；
 *   2. 选中了某个控件就必须拖得动它，哪怕上面盖着别的控件；
 *   3. 点在空白处/其它控件上时要能正常改选，不能把选择锁死。
 */
import { Component } from '../types';
import { getAbsolutePosition, isContainerType } from './componentUtils';

export interface ResolveClickTargetOptions {
  /** 事件来源控件 id（DOM 最上层的那个） */
  eventComponentId: string;
  /** 该点下自顶向下的控件栈（已按形状过滤，已剔除祖先容器） */
  hitStack: string[];
  /** 全部控件 */
  components: Component[];
  /** 当前选中项 */
  selectedIds: string[];
  /** 该点的画布坐标 */
  point: { x: number; y: number } | null;
  /** 是否为同一位置的重复单击（逐层穿透） */
  repeating: boolean;
  /** 重复单击时要穿透到的栈下标 */
  repeatIndex: number;
  /** 是否按下了修饰键（Ctrl/Cmd/Shift/Alt） */
  hasModifier: boolean;
}

export interface ResolveClickTargetResult {
  /** 本次按下应当操作（选中 + 拖动）的控件 id */
  targetId: string;
  /**
   * 重复单击时，松开且没有拖动才切换到的下层控件 id；不穿透时为 null。
   *
   * 穿透不能在按下时生效：「先点一下选中弧、再在同一位置按住拖动」也是同位置重复按下，
   * 按下就穿透会把拖动交给弧下面的热区 / 背景图。
   */
  penetrateId: string | null;
}

/**
 * 判断点是否落在控件的包围盒内（用于「已选中控件仍然可拖」的宽松判定）。
 *
 * 这里刻意用包围盒而不是图形：弧形线宽通常只有 10px 左右，要求像素级点在弧线上
 * 才能拖动太苛刻；而「选中了它、再按下去」本身已经是明确的用户意图。
 */
function isPointInBoundingBox(
  comp: Component,
  components: Component[],
  point: { x: number; y: number }
): boolean {
  const abs = getAbsolutePosition(comp, components);
  return point.x >= abs.x && point.x <= abs.x + comp.position.width
    && point.y >= abs.y && point.y <= abs.y + comp.position.height;
}

export function resolveClickTarget(options: ResolveClickTargetOptions): ResolveClickTargetResult {
  const { eventComponentId, hitStack, repeating, repeatIndex, hasModifier } = options;

  const stack = hitStack.length > 0 ? hitStack : [eventComponentId];
  const targetId = resolvePressTarget(stack, options);

  // 重复单击：按栈顺序逐层穿透，但只作为「松开时没拖动才生效」的候选。
  // 按下这一刻仍然操作原目标，保证「点一下选中、原地按住就拖」拖的是选中的控件。
  let penetrateId: string | null = null;
  if (repeating && !hasModifier) {
    const candidate = stack[repeatIndex] ?? stack[0];
    if (candidate && candidate !== targetId) {
      penetrateId = candidate;
    }
  }

  return { targetId, penetrateId };
}

/** 按下时立即操作（选中 + 准备拖动）的控件 */
function resolvePressTarget(stack: string[], options: ResolveClickTargetOptions): string {
  const { eventComponentId, components, selectedIds, point, hasModifier } = options;
  const topId = stack[0] ?? eventComponentId;

  // 1. 事件来源本身是已选中控件：直接操作它。用户就是按在它上面。
  //
  // 这一条不能靠下面的包围盒判定兜底：选中弧时按在弧的空白内圈，DOM 命中会落到
  // 铺满整个表盘的背景图 c1_bg 上，包围盒判定又会把目标改回弧 —— 表现为「按下去
  // 选中的是弧，鼠标一松却变成了背景图」。
  if (!hasModifier && selectedIds.includes(eventComponentId)) {
    return eventComponentId;
  }

  // 2. 按在已选中控件的包围盒内：操作已选中的那个，即使上面盖着别的控件。
  //
  // 本工程表盘里每条弧上方都压着一张 1x1 全透明的点击热区
  // （c1_hr_hot / c1_step_hot / c1_dist_hot，DOM 里排在弧后面），热区盖住了弧的整个
  // 包围盒。若一律按最上层命中，选中了弧也永远拖不动它 —— 这就是「选不中、拖不动」
  // 的直接原因。容器、列表项不参与，否则选中大 view 后随便一点就会移动整块画面。
  if (!hasModifier && point) {
    const selectedComp = selectedIds
      .map((id) => components.find((c) => c.id === id))
      .find((comp): comp is Component => {
        if (!comp || comp.locked || comp.visible === false) return false;
        if (isContainerType(comp.type) || comp.type === 'hg_list_item') return false;
        return isPointInBoundingBox(comp, components, point);
      });

    if (selectedComp) {
      return selectedComp.id;
    }
  }

  // 3. 默认：这个点上最上层的控件（几何控件已被形状过滤，透明区域不算命中）
  return topId;
}
