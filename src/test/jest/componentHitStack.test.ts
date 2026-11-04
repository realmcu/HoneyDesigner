/**
 * Canvas hit-testing contract: overlapping controls must be reachable, and
 * arc/circle controls must only answer on the shape they actually draw — not on
 * the whole transparent bounding box that used to swallow clicks meant for the
 * control underneath.
 */
import { Component } from '../../webview/types';
import { isPointOnComponentShape } from '../../webview/utils/componentHitStack';

function makeComponent(overrides: Partial<Component> & Pick<Component, 'id' | 'type'>): Component {
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

/** 100x100 包围盒，圆心 (50,50)，半径 40 */
function arc(style: Record<string, any>): Component {
  return makeComponent({ id: 'arc', type: 'hg_arc', style: { radius: 40, strokeWidth: 8, ...style } });
}

function circle(style: Record<string, any>): Component {
  return makeComponent({ id: 'circle', type: 'hg_circle', style: { radius: 40, ...style } });
}

const point = (x: number, y: number) => ({ x, y });

describe('arc hit testing', () => {
  it('ignores the transparent bounding box outside the ring', () => {
    // 默认弧形覆盖 0°→270°（右下、左下、左上），右上角 45° 是缺口
    const comp = arc({});
    expect(isPointOnComponentShape(comp, [comp], point(2, 2))).toBe(false);
  });

  it('hits on the stroke itself', () => {
    const comp = arc({});
    // 0° → 圆心右侧，落在环上
    expect(isPointOnComponentShape(comp, [comp], point(90, 50))).toBe(true);
    // 180° → 圆心左侧
    expect(isPointOnComponentShape(comp, [comp], point(10, 50))).toBe(true);
  });

  it('misses the hole in the middle of the ring', () => {
    const comp = arc({});
    expect(isPointOnComponentShape(comp, [comp], point(50, 50))).toBe(false);
  });

  it('respects the stroke width as hit tolerance', () => {
    const thin = arc({ strokeWidth: 2 });
    // r=40，半线宽 1，再加 1px 抗锯齿容差 → 到圆心 43 就落空、42 仍算命中
    expect(isPointOnComponentShape(thin, [thin], point(93, 50))).toBe(false);
    expect(isPointOnComponentShape(thin, [thin], point(92, 50))).toBe(true);
    const thick = arc({ strokeWidth: 20 });
    expect(isPointOnComponentShape(thick, [thick], point(93, 50))).toBe(true);
  });

  it('treats a full 360° sweep as a complete ring', () => {
    const comp = arc({ startAngle: 0, endAngle: 360 });
    expect(isPointOnComponentShape(comp, [comp], point(50, 90))).toBe(true);
  });

  it('follows a custom start angle', () => {
    // 只画 0°→90°：右下象限
    const comp = arc({ startAngle: 0, endAngle: 90 });
    expect(isPointOnComponentShape(comp, [comp], point(90, 50))).toBe(true);
    expect(isPointOnComponentShape(comp, [comp], point(50, 10))).toBe(false);
  });

  it('never hits when nothing is drawn (zero stroke width)', () => {
    const comp = arc({ strokeWidth: 0 });
    expect(isPointOnComponentShape(comp, [comp], point(90, 50))).toBe(false);
  });

  it('accounts for the container offset of a nested control', () => {
    const parent = makeComponent({
      id: 'view',
      type: 'hg_view',
      position: { x: 200, y: 100, width: 400, height: 400 },
    });
    const nestedArc = makeComponent({
      id: 'nested-arc',
      type: 'hg_arc',
      parent: 'view',
      position: { x: 0, y: 0, width: 100, height: 100 },
      style: { radius: 40, strokeWidth: 8 },
    });
    const components = [parent, nestedArc];
    // 控件绝对左上角在 (200,100)，环右端在 (290,150)
    expect(isPointOnComponentShape(nestedArc, components, point(290, 150))).toBe(true);
    // 同一相对位置但没有父容器偏移时，该点落在环外
    expect(isPointOnComponentShape(nestedArc, [nestedArc], point(290, 150))).toBe(false);
  });
});

describe('circle hit testing', () => {
  it('hits anywhere inside the circle', () => {
    const comp = circle({});
    expect(isPointOnComponentShape(comp, [comp], point(50, 50))).toBe(true);
    expect(isPointOnComponentShape(comp, [comp], point(85, 50))).toBe(true);
  });

  it('misses the corners outside the circle', () => {
    const comp = circle({});
    expect(isPointOnComponentShape(comp, [comp], point(2, 2))).toBe(false);
    expect(isPointOnComponentShape(comp, [comp], point(98, 98))).toBe(false);
  });

  it('includes the stroke thickness', () => {
    const comp = circle({ strokeWidth: 10 });
    expect(isPointOnComponentShape(comp, [comp], point(50, 94))).toBe(true);
  });
});

describe('non-geometry controls keep bounding-box hit testing', () => {
  it('always reports a hit so DOM stacking alone decides', () => {
    const comp = makeComponent({ id: 'label', type: 'hg_label', style: {} });
    expect(isPointOnComponentShape(comp, [comp], point(-500, -500))).toBe(true);
  });
});

describe('degenerate geometry', () => {
  it('rejects zero-sized controls', () => {
    const comp = makeComponent({
      id: 'zero',
      type: 'hg_circle',
      position: { x: 0, y: 0, width: 0, height: 0 },
      style: { radius: 40 },
    });
    expect(isPointOnComponentShape(comp, [comp], point(0, 0))).toBe(false);
  });

  it('rejects zero radius', () => {
    const comp = circle({ radius: 0 });
    expect(isPointOnComponentShape(comp, [comp], point(50, 50))).toBe(false);
  });
});
