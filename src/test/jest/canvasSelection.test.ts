/**
 * Canvas click-target contract.
 *
 * Reproduces the real watch-face project (D:\UI_designer\...\V202SMain.hml), where
 * every arc has a 1x1 fully-transparent "hot zone" image sitting on top of it, and a
 * full-bleed background image (c1_bg) covers the entire dial underneath everything.
 * Getting this wrong shows up as "I selected the red arc but dragging moves the
 * background".
 */
import { Component } from '../../webview/types';
import { resolveClickTarget } from '../../webview/utils/canvasSelection';

function comp(overrides: Partial<Component> & Pick<Component, 'id' | 'type'>): Component {
  return {
    name: overrides.id,
    position: { x: 0, y: 0, width: 100, height: 100 },
    style: {},
    data: {},
    visible: true,
    enabled: true,
    locked: false,
    zIndex: 0,
    parent: null,
    children: [],
    ...overrides,
  } as unknown as Component;
}

/** 表盘：360x360 背景 + 红弧(22,192,92x92) + 盖在红弧上的透明热区(26,204,87x76) */
const BACKGROUND = comp({
  id: 'c1_bg',
  type: 'hg_image',
  position: { x: 0, y: 0, width: 360, height: 360 },
});
const HR_ARC = comp({
  id: 'c1_hr_arc',
  type: 'hg_arc',
  position: { x: 22, y: 192, width: 92, height: 92 },
  style: { radius: 38, strokeWidth: 10 },
});
const HR_HOT = comp({
  id: 'c1_hr_hot',
  type: 'hg_image',
  position: { x: 26, y: 204, width: 87, height: 76 },
});

const ALL = [BACKGROUND, HR_ARC, HR_HOT];

/** 弧内空心处：按在热区上（热区层级更高），背景也算命中 */
const INSIDE_ARC_HOLLOW = { x: 68, y: 238 };

function resolve(overrides: {
  eventComponentId: string;
  hitStack: string[];
  selectedIds: string[];
  point?: { x: number; y: number } | null;
  repeating?: boolean;
  repeatIndex?: number;
  hasModifier?: boolean;
}) {
  return resolveClickTarget({
    components: ALL,
    point: INSIDE_ARC_HOLLOW,
    repeating: false,
    repeatIndex: 0,
    hasModifier: false,
    ...overrides,
  });
}

describe('dragging the selected arc while a transparent hot zone covers it', () => {
  it('keeps dragging the arc when the press lands on the covering hot zone', () => {
    // 热区盖住弧，DOM 顺序让热区在最上层
    const result = resolve({
      eventComponentId: 'c1_hr_hot',
      hitStack: ['c1_hr_hot', 'c1_bg'],
      selectedIds: ['c1_hr_arc'],
    });
    expect(result.targetId).toBe('c1_hr_arc');
  });

  it('does not hand the selection over to the background on release', () => {
    // 回归：之前这里会返回一个“松开时改选 c1_bg”的待办，
    // 导致下一次拖动移动的是铺满画布的背景图。
    const result = resolve({
      eventComponentId: 'c1_hr_hot',
      hitStack: ['c1_hr_hot', 'c1_bg'],
      selectedIds: ['c1_hr_arc'],
    });
    expect(result).not.toHaveProperty('clickSelectId');
    expect(result.penetrateId).toBeNull();
  });

  it('keeps the arc when the press lands directly on the arc', () => {
    const result = resolve({
      eventComponentId: 'c1_hr_arc',
      hitStack: ['c1_hr_arc', 'c1_bg'],
      selectedIds: ['c1_hr_arc'],
    });
    expect(result.targetId).toBe('c1_hr_arc');
  });
});

describe('selecting something new', () => {
  it('selects the top-most control when nothing is selected yet', () => {
    const result = resolve({
      eventComponentId: 'c1_hr_hot',
      hitStack: ['c1_hr_hot', 'c1_bg'],
      selectedIds: [],
    });
    expect(result.targetId).toBe('c1_hr_hot');
  });

  it('switches selection when the press is outside the currently selected arc', () => {
    const result = resolve({
      eventComponentId: 'c1_bg',
      hitStack: ['c1_bg'],
      selectedIds: ['c1_hr_arc'],
      point: { x: 10, y: 10 },
    });
    expect(result.targetId).toBe('c1_bg');
  });
});

describe('penetrating to lower layers', () => {
  const STACK = ['c1_hr_arc', 'c1_hr_hot', 'c1_bg'];

  it('does not penetrate on the first press', () => {
    const result = resolve({
      eventComponentId: 'c1_hr_hot',
      hitStack: STACK,
      selectedIds: ['c1_hr_arc'],
    });
    expect(result.targetId).toBe('c1_hr_arc');
    expect(result.penetrateId).toBeNull();
  });

  it('keeps dragging the selected arc when pressing again at the same spot', () => {
    // 回归：「点一下选中绿弧，再原地按住拖动」也是同位置重复按下，
    // 之前按下即穿透，拖动的变成了弧下面的 c1_step_hot 热区。
    const result = resolve({
      eventComponentId: 'c1_hr_hot',
      hitStack: STACK,
      selectedIds: ['c1_hr_arc'],
      repeating: true,
      repeatIndex: 1,
    });
    expect(result.targetId).toBe('c1_hr_arc');
    // 只有松开且没拖动时才切到下一层
    expect(result.penetrateId).toBe('c1_hr_hot');
  });

  it('offers the next layer down as the release-time penetration candidate', () => {
    const result = resolve({
      eventComponentId: 'c1_hr_hot',
      hitStack: STACK,
      selectedIds: ['c1_hr_hot'],
      repeating: true,
      repeatIndex: 2,
    });
    expect(result.targetId).toBe('c1_hr_hot');
    expect(result.penetrateId).toBe('c1_bg');
  });

  it('never penetrates while a modifier key is held', () => {
    const result = resolve({
      eventComponentId: 'c1_hr_hot',
      hitStack: STACK,
      selectedIds: ['c1_hr_arc'],
      repeating: true,
      repeatIndex: 1,
      hasModifier: true,
    });
    expect(result.penetrateId).toBeNull();
  });
});

describe('containers never get dragged by proximity', () => {
  it('does not keep a selected view when pressing inside it', () => {
    const view = comp({
      id: 'clock1st_view',
      type: 'hg_view',
      position: { x: 0, y: 0, width: 360, height: 360 },
    });
    const result = resolveClickTarget({
      eventComponentId: 'c1_hr_hot',
      hitStack: ['c1_hr_hot'],
      components: [view, ...ALL],
      selectedIds: ['clock1st_view'],
      point: INSIDE_ARC_HOLLOW,
      repeating: false,
      repeatIndex: 0,
      hasModifier: false,
    });
    expect(result.targetId).toBe('c1_hr_hot');
  });
});

describe('modifier keys defer to the top-most control', () => {
  it('lets ctrl+click reach the top-most control for multi-select', () => {
    const result = resolve({
      eventComponentId: 'c1_hr_hot',
      hitStack: ['c1_hr_hot', 'c1_bg'],
      selectedIds: ['c1_hr_arc'],
      hasModifier: true,
    });
    expect(result.targetId).toBe('c1_hr_hot');
  });
});
