/**
 * Text opacity contract: HoneyGUI carries opacity on the text color alpha,
 * while LVGL uses text_opa. Default opacity must leave generated code unchanged.
 */
import { Component } from '../../hml/types';
import { LabelGenerator } from '../../codegen/honeygui/components/LabelGenerator';
import { TimeLabelGenerator } from '../../codegen/honeygui/components/TimeLabelGenerator';
import { LvglLabelGenerator } from '../../codegen/lvgl/components/LvglLabelGenerator';

function makeLabel(
  style: Record<string, any>,
  data: Record<string, any> = {},
  type = 'hg_label'
): Component {
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

const honeyContext = {
  componentMap: new Map(),
  getParentRef: () => 'parent',
} as any;

const lvglContext = {
  componentMap: new Map(),
  getParentRef: () => 'parent',
  getBuiltinFontVar: () => null,
} as any;

describe('HoneyGUI label opacity', () => {
  it('keeps gui_rgb when opacity is at its default', () => {
    const code = new LabelGenerator().generatePropertySetters(
      makeLabel({ color: '#ff0000' }), 1, honeyContext);
    expect(code).toContain('gui_rgb(255, 0, 0)');
    expect(code).not.toContain('gui_rgba(');
  });

  it('carries opacity through the text color alpha', () => {
    const code = new LabelGenerator().generatePropertySetters(
      makeLabel({ color: '#ff0000', opacity: 128 }), 1, honeyContext);
    expect(code).toContain('gui_rgba(255, 0, 0, 128)');
  });

  it('multiplies an explicit color alpha by the opacity', () => {
    const code = new LabelGenerator().generatePropertySetters(
      makeLabel({ color: '#ff000080', opacity: 128 }), 1, honeyContext);
    expect(code).toContain('gui_rgba(255, 0, 0, 64)');
  });

  it('clamps out-of-range opacity', () => {
    const code = new LabelGenerator().generatePropertySetters(
      makeLabel({ color: '#ff0000', opacity: 999 }), 1, honeyContext);
    expect(code).toContain('gui_rgb(255, 0, 0)');

    const transparent = new LabelGenerator().generatePropertySetters(
      makeLabel({ color: '#ff0000', opacity: -10 }), 1, honeyContext);
    expect(transparent).toContain('gui_rgba(255, 0, 0, 0)');
  });

  it('applies to time labels too', () => {
    const code = new TimeLabelGenerator().generatePropertySetters(
      makeLabel({ color: '#00ff00', opacity: 100 }, {}, 'hg_time_label'), 1, honeyContext);
    expect(code).toContain('gui_rgba(0, 255, 0, 100)');
  });
});

describe('LVGL label opacity', () => {
  it('emits text_opa only when translucent', () => {
    const translucent = new LvglLabelGenerator().generateCreation(
      makeLabel({ color: '#ffffff', opacity: 128 }), 'parent', lvglContext);
    expect(translucent).toContain('lv_obj_set_style_text_opa(lbl, 128, LV_PART_MAIN);');

    const opaque = new LvglLabelGenerator().generateCreation(
      makeLabel({ color: '#ffffff' }), 'parent', lvglContext);
    expect(opaque).not.toContain('lv_obj_set_style_text_opa');
  });
});
