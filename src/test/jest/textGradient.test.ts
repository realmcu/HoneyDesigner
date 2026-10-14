/**
 * Text gradient contract: the canvas CSS preview must sample the same stop
 * position as HoneyGUI's per-pixel formula, and codegen must emit the SDK calls
 * only for vector fonts, with set_gradient before set_gradient_box.
 */
import { Component } from '../../hml/types';
import { LabelGenerator } from '../../codegen/honeygui/components/LabelGenerator';
import { TimeLabelGenerator } from '../../codegen/honeygui/components/TimeLabelGenerator';
import {
  GradientRect,
  TEXT_GRADIENT_PRESET_HANDLES,
  TextGradientConfig,
  TextGradientDirection,
  buildTextGradientCss,
  normalizeTextGradientStops,
  resolveTextGradient,
} from '../../shared/textGradient';

/** HoneyGUI: t = ((u-u0)·du + (v-v0)·dv) / |d|², (u, v) normalized to the box */
function sdkT(dir: TextGradientDirection, box: GradientRect, x: number, y: number): number {
  const [x0, y0, x1, y1] = TEXT_GRADIENT_PRESET_HANDLES[dir];
  const du = x1 - x0;
  const dv = y1 - y0;
  const u = (x - box.x) / box.width;
  const v = (y - box.y) / box.height;
  return ((u - x0) * du + (v - y0) * dv) / (du * du + dv * dv);
}

/** Evaluate a 0→1 two-stop CSS linear-gradient(<deg>, c0 <s0>px, c1 <s1>px) at (x, y) */
function cssT(css: string, w: number, h: number, x: number, y: number): number {
  const m = /linear-gradient\((-?[\d.]+)deg, \S+ (-?[\d.]+)px, \S+ (-?[\d.]+)px\)/.exec(css);
  if (!m) {
    throw new Error(`unexpected css: ${css}`);
  }
  const theta = Number(m[1]) * Math.PI / 180;
  const s0 = Number(m[2]);
  const s1 = Number(m[3]);
  const len = Math.abs(w * Math.sin(theta)) + Math.abs(h * Math.cos(theta));
  const s = (x - w / 2) * Math.sin(theta) - (y - h / 2) * Math.cos(theta) + len / 2;
  return (s - s0) / (s1 - s0);
}

function makeLabel(type: string, style: Record<string, any>, data: Record<string, any>): Component {
  return {
    id: 'lbl',
    type: type as any,
    name: 'lbl',
    position: { x: 0, y: 0, width: 200, height: 40 },
    style,
    data: { text: 'Hello', fontSize: 24, ...data },
    visible: true,
    enabled: true,
    locked: false,
    zIndex: 0,
  };
}

const context = { componentMap: new Map(), getParentRef: () => 'parent' } as any;

const twoStops = [
  { position: 0, color: '#ff0000' },
  { position: 1, color: '#0000ff' },
];

describe('buildTextGradientCss', () => {
  const directions: TextGradientDirection[] = ['horizontal', 'vertical', 'diagonal_tl_br', 'diagonal_tr_bl'];
  const boxes: GradientRect[] = [
    { x: 0, y: 0, width: 200, height: 40 },
    { x: 37.5, y: 12, width: 81, height: 27 },
    { x: -15, y: 5, width: 300, height: 10 },
  ];

  for (const dir of directions) {
  it(`matches the SDK stop position for ${dir}`, () => {
    const config: TextGradientConfig = { direction: dir, box: 'layout', stops: twoStops };
    for (const box of boxes) {
      const w = 220;
      const h = 64;
      const css = buildTextGradientCss(config, box, w, h);
      for (const [x, y] of [[0, 0], [w, h], [box.x, box.y], [box.x + box.width, box.y + box.height], [53, 21]]) {
        expect(cssT(css, w, h, x, y)).toBeCloseTo(sdkT(dir, box, x, y), 4);
      }
    }
  });
  }
});

describe('normalizeTextGradientStops', () => {
  it('truncates to 8 stops before sorting, like the SDK', () => {
    const raw = Array.from({ length: 9 }, (_, i) => ({ position: i === 8 ? 0 : 1 - i / 10, color: '#112233' }));
    const stops = normalizeTextGradientStops(raw);
    expect(stops).toHaveLength(8);
    expect(stops[0].position).toBeCloseTo(0.3);
  });

  it('drops invalid entries and clamps positions', () => {
    const stops = normalizeTextGradientStops([
      { position: -1, color: '#000000' },
      { position: 'x', color: '#000000' },
      { position: 2, color: 'red' },
      { position: 2, color: '#ffffff' },
    ]);
    expect(stops).toEqual([
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ]);
  });

  it('defaults the box to layout', () => {
    expect(resolveTextGradient({ useGradient: true }, { gradientStops: twoStops })?.box).toBe('layout');
  });
});

describe('LabelGenerator text gradient', () => {
  const style = { useGradient: true, gradientDirection: 'vertical', gradientBox: 'widget' };

  it('emits gradient setters for vector fonts in SDK call order', () => {
    const code = new LabelGenerator().generatePropertySetters(
      makeLabel('hg_label', style, { fontType: 'vector', gradientStops: twoStops }), 1, context);
    expect(code).toContain('{0.0f, {.color.argb_full = 0xFFFF0000}}');
    expect(code).toContain('{1.0f, {.color.argb_full = 0xFF0000FF}}');
    expect(code).toContain('gui_text_set_gradient((gui_text_t *)lbl, GUI_TEXT_GRADIENT_VERTICAL, stops, 2);');
    expect(code.indexOf('gui_text_set_gradient(')).toBeLessThan(code.indexOf('gui_text_set_gradient_box('));
    expect(code).toContain('gui_text_set_gradient_box((gui_text_t *)lbl, GUI_TEXT_GRADIENT_BOX_WIDGET);');
  });

  it('emits nothing for bitmap fonts', () => {
    const code = new LabelGenerator().generatePropertySetters(
      makeLabel('hg_label', style, { fontType: 'bitmap', gradientStops: twoStops }), 1, context);
    expect(code).not.toContain('gradient');
  });

  it('applies the gradient to each split time segment', () => {
    const component = makeLabel('hg_time_label', style, {
      fontType: 'vector', gradientStops: twoStops, timeFormat: 'HH:mm-split',
    });
    const code = new TimeLabelGenerator().generateCreation(component, 1, context);
    for (const part of ['hour', 'colon', 'min']) {
      expect(code).toContain(`gui_text_set_gradient(lbl_${part}, GUI_TEXT_GRADIENT_VERTICAL, stops, 2);`);
    }
  });
});
