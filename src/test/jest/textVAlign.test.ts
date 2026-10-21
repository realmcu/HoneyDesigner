/**
 * Text vertical alignment contract: the canvas preview offset must match the
 * line-box model HoneyGUI uses for TEXT_MODE, and codegen must emit the BOT_* /
 * MULTI_BOT_* modes for vAlign="BOTTOM".
 */
import { Component } from '../../hml/types';
import { computeVerticalAlignment } from '../../webview/hooks/useTextLayout';
import { LabelGenerator } from '../../codegen/honeygui/components/LabelGenerator';

function makeLabel(style: Record<string, any>, data: Record<string, any> = {}): Component {
  return {
    id: 'lbl',
    type: 'hg_label' as any,
    name: 'lbl',
    position: { x: 0, y: 0, width: 200, height: 100 },
    style,
    data: { text: 'Hello', fontSize: 24, ...data },
    visible: true,
    enabled: true,
    locked: false,
    zIndex: 0,
  };
}

const context = { componentMap: new Map(), getParentRef: () => 'parent' } as any;

function textModeOf(style: Record<string, any>): string {
  const code = new LabelGenerator().generatePropertySetters(makeLabel(style), 1, context);
  const match = /gui_text_mode_set\(\(gui_text_t \*\)lbl, (\w+)\);/.exec(code);
  if (!match) {
    throw new Error(`no gui_text_mode_set in: ${code}`);
  }
  return match[1];
}

describe('computeVerticalAlignment', () => {
  it('leaves TOP text at the container top', () => {
    expect(computeVerticalAlignment('TOP', false, 100, 30)).toEqual({
      singleLineOffset: 0, useFlex: false, flexJustify: undefined,
    });
  });

  it('centers MID on the line box', () => {
    expect(computeVerticalAlignment('MID', false, 100, 30).singleLineOffset).toBe(35);
  });

  it('anchors BOTTOM to the bottom edge', () => {
    expect(computeVerticalAlignment('BOTTOM', false, 100, 30).singleLineOffset).toBe(70);
  });

  it('pushes overflow above the container for BOTTOM', () => {
    // Content taller than the box: offset goes negative, the container clips the top.
    expect(computeVerticalAlignment('BOTTOM', false, 40, 30).singleLineOffset).toBe(10);
    expect(computeVerticalAlignment('BOTTOM', false, 20, 30).singleLineOffset).toBe(-10);
  });

  it('uses flex alignment for wrapped MID and BOTTOM', () => {
    expect(computeVerticalAlignment('MID', true, 100, 30).flexJustify).toBe('center');
    expect(computeVerticalAlignment('BOTTOM', true, 100, 30).flexJustify).toBe('flex-end');
    expect(computeVerticalAlignment('TOP', true, 100, 30).useFlex).toBe(false);
  });
});

describe('LabelGenerator TEXT_MODE for vAlign', () => {
  it('maps single-line vAlign to the plain modes', () => {
    expect(textModeOf({ hAlign: 'LEFT', vAlign: 'TOP' })).toBe('LEFT');
    expect(textModeOf({ hAlign: 'CENTER', vAlign: 'MID' })).toBe('MID_CENTER');
    expect(textModeOf({ hAlign: 'RIGHT', vAlign: 'BOTTOM' })).toBe('BOT_RIGHT');
  });

  it('maps wrapped vAlign to the MULTI_ modes', () => {
    expect(textModeOf({ hAlign: 'LEFT', vAlign: 'TOP', wordWrap: true })).toBe('MULTI_LEFT');
    expect(textModeOf({ hAlign: 'CENTER', vAlign: 'MID', wordWrap: true })).toBe('MULTI_MID_CENTER');
    expect(textModeOf({ hAlign: 'RIGHT', vAlign: 'BOTTOM', wordWrap: true })).toBe('MULTI_BOT_RIGHT');
  });

  it('falls back to LEFT for an unknown hAlign', () => {
    expect(textModeOf({ hAlign: 'JUSTIFY', vAlign: 'BOTTOM' })).toBe('BOT_LEFT');
  });
});

describe('LabelGenerator scroll mode with BOTTOM', () => {
  // SCROLL_* only has top and mid variants, so BOTTOM degrades to top instead of
  // emitting an unknown mode. The canvas preview mirrors this.
  function scrollModeOf(style: Record<string, any>): string {
    const component = makeLabel(style, { enableScroll: true });
    const code = new LabelGenerator().generatePropertySetters(component, 1, context);
    const match = /gui_scroll_text_scroll_set\(\(gui_scroll_text_t \*\)lbl, (\w+),/.exec(code);
    if (!match) {
      throw new Error(`no gui_scroll_text_scroll_set in: ${code}`);
    }
    return match[1];
  }

  it('degrades BOTTOM to the top-aligned scroll mode', () => {
    expect(scrollModeOf({ vAlign: 'TOP' })).toBe('SCROLL_X');
    expect(scrollModeOf({ vAlign: 'MID' })).toBe('SCROLL_X_MID');
    expect(scrollModeOf({ vAlign: 'BOTTOM' })).toBe('SCROLL_X');
  });

  it('emits no gui_text_mode_set for scroll text', () => {
    const code = new LabelGenerator().generatePropertySetters(
      makeLabel({ vAlign: 'BOTTOM' }, { enableScroll: true }), 1, context);
    expect(code).not.toContain('gui_text_mode_set');
  });
});
