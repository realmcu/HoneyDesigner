/**
 * Unit tests for the preset timer normalization layer.
 *
 * These are pure-function tests on purpose: they lock the input contract of the
 * HoneyGUI preset animation generator without asserting any generated C text.
 */
import { Component } from '../../hml/types';
import {
  DEFAULT_SEGMENT_DURATION_MS,
  MAX_TIMELINE_MS,
  buildPresetTimeline,
  componentHasPresetTimer,
  isBoundaryAction,
  normalizeLegacyTimerSegments,
  normalizeTimerConfigSegments,
  sanitizeDurationMs,
} from '../../codegen/honeygui/PresetTimerModel';

function makeComponent(data: Record<string, any>): Component {
  return {
    id: 'needle',
    type: 'hg_image',
    name: 'needle',
    position: { x: 0, y: 0, width: 10, height: 10 },
    data,
    visible: true,
    enabled: true,
    locked: false,
    zIndex: 0,
  };
}

const ROTATION_ACTION = { type: 'rotation', angleOrigin: -120, angleTarget: 120 };

describe('normalizeLegacyTimerSegments', () => {
  it('maps timerActions/timerDuration to a single segment', () => {
    const component = makeComponent({
      timerEnabled: true,
      timerMode: 'preset',
      timerDuration: 2000,
      timerActions: [ROTATION_ACTION],
    });

    expect(normalizeLegacyTimerSegments(component)).toEqual([
      { duration: 2000, actions: [ROTATION_ACTION] },
    ]);
  });

  it('falls back to the default duration when timerDuration is missing', () => {
    const component = makeComponent({
      timerEnabled: true,
      timerMode: 'preset',
      timerActions: [ROTATION_ACTION],
    });

    expect(normalizeLegacyTimerSegments(component)[0].duration).toBe(DEFAULT_SEGMENT_DURATION_MS);
  });
});

describe('normalizeTimerConfigSegments', () => {
  it('maps actions/duration to a single segment', () => {
    const segments = normalizeTimerConfigSegments({
      id: 'tick',
      mode: 'preset',
      duration: 1500,
      actions: [ROTATION_ACTION],
    });

    expect(segments).toEqual([{ duration: 1500, actions: [ROTATION_ACTION] }]);
  });

  it('degrades delayStart into a leading empty wait segment', () => {
    const segments = normalizeTimerConfigSegments({
      id: 'tick',
      mode: 'preset',
      duration: 800,
      delayStart: 300,
      actions: [ROTATION_ACTION],
    });

    expect(segments).toEqual([
      { duration: 300, actions: [] },
      { duration: 800, actions: [ROTATION_ACTION] },
    ]);
  });

  it('passes an explicit segments list through unchanged', () => {
    const segments = normalizeTimerConfigSegments({
      id: 'tick',
      mode: 'preset',
      segments: [
        { duration: 1000, actions: [ROTATION_ACTION] },
        { duration: 1000, actions: [] },
      ],
    });

    expect(segments).toEqual([
      { duration: 1000, actions: [ROTATION_ACTION] },
      { duration: 1000, actions: [] },
    ]);
  });

  it('ignores delayStart once an explicit segments list is present', () => {
    const segments = normalizeTimerConfigSegments({
      id: 'tick',
      mode: 'preset',
      delayStart: 500,
      segments: [{ duration: 1000, actions: [ROTATION_ACTION] }],
    });

    expect(segments).toEqual([{ duration: 1000, actions: [ROTATION_ACTION] }]);
  });

  it('keeps a configured 0 ms segment and defaults missing actions to an empty list', () => {
    const segments = normalizeTimerConfigSegments({
      id: 'tick',
      mode: 'preset',
      segments: [{ duration: 0 }, { duration: 500, actions: [ROTATION_ACTION] }],
    });

    expect(segments).toEqual([
      { duration: 0, actions: [] },
      { duration: 500, actions: [ROTATION_ACTION] },
    ]);
  });

  it('returns an empty list for a missing timer config', () => {
    expect(normalizeTimerConfigSegments(undefined)).toEqual([]);
  });
});

describe('sanitizeDurationMs', () => {
  it('keeps a configured zero', () => {
    expect(sanitizeDurationMs(0)).toBe(0);
  });

  it('replaces invalid input with the fallback', () => {
    expect(sanitizeDurationMs(undefined, 1000)).toBe(1000);
    expect(sanitizeDurationMs(NaN, 1000)).toBe(1000);
    expect(sanitizeDurationMs(Infinity, 1000)).toBe(1000);
    expect(sanitizeDurationMs(-50, 1000)).toBe(1000);
    expect(sanitizeDurationMs('oops', 1000)).toBe(1000);
  });

  it('truncates fractional milliseconds', () => {
    expect(sanitizeDurationMs(16.9)).toBe(16);
  });
});

describe('buildPresetTimeline', () => {
  it('accumulates millisecond boundaries', () => {
    const timeline = buildPresetTimeline([
      { duration: 1000, actions: [] },
      { duration: 1000, actions: [] },
    ]);

    expect(timeline.starts).toEqual([0, 1000]);
    expect(timeline.ends).toEqual([1000, 2000]);
    expect(timeline.totalDuration).toBe(2000);
  });

  it('reports a zero total for an all-zero timeline', () => {
    const timeline = buildPresetTimeline([{ duration: 0, actions: [] }]);
    expect(timeline.totalDuration).toBe(0);
  });

  it('reports a zero total for an empty timeline', () => {
    expect(buildPresetTimeline([]).totalDuration).toBe(0);
  });

  it('clamps accumulation to the uint32_t range', () => {
    const timeline = buildPresetTimeline([
      { duration: MAX_TIMELINE_MS, actions: [] },
      { duration: 5000, actions: [] },
    ]);

    expect(timeline.totalDuration).toBe(MAX_TIMELINE_MS);
    expect(timeline.segments[1].duration).toBe(0);
  });
});

describe('componentHasPresetTimer', () => {
  it('is true for a preset timers entry', () => {
    const component = makeComponent({
      timers: [{ id: 'tick', mode: 'preset', segments: [{ duration: 1000, actions: [] }] }],
    });
    expect(componentHasPresetTimer(component)).toBe(true);
  });

  it('is false when the component only has custom timers', () => {
    const component = makeComponent({
      timers: [{ id: 'tick', mode: 'custom', callback: 'my_cb' }],
    });
    expect(componentHasPresetTimer(component)).toBe(false);
  });

  it('is true for the legacy preset format', () => {
    const component = makeComponent({
      timerEnabled: true,
      timerMode: 'preset',
      timerActions: [ROTATION_ACTION],
    });
    expect(componentHasPresetTimer(component)).toBe(true);
  });

  it('is false for the legacy custom format', () => {
    const component = makeComponent({
      timerEnabled: true,
      timerMode: 'custom',
      timerCallback: 'my_cb',
    });
    expect(componentHasPresetTimer(component)).toBe(false);
  });

  it('is false when no timer is configured', () => {
    expect(componentHasPresetTimer(makeComponent({}))).toBe(false);
  });
});

describe('isBoundaryAction', () => {
  it('classifies one-shot side effects as boundary actions', () => {
    ['visibility', 'changeImage', 'switchView', 'switchTimer', 'setFocus'].forEach(type => {
      expect(isBoundaryAction({ type })).toBe(true);
    });
  });

  it('classifies interpolated actions as sampled', () => {
    ['position', 'size', 'opacity', 'rotation', 'scale', 'imageSequence'].forEach(type => {
      expect(isBoundaryAction({ type })).toBe(false);
    });
  });

  it('treats colour actions as boundary only when they have no start value', () => {
    expect(isBoundaryAction({ type: 'fgColor', fgColorTo: '0xFF000000' })).toBe(true);
    expect(isBoundaryAction({ type: 'fgColor', fgColorFrom: '0xFFFFFFFF', fgColorTo: '0xFF000000' })).toBe(false);
    expect(isBoundaryAction({ type: 'bgColor', bgColorTo: '0xFF000000' })).toBe(true);
    expect(isBoundaryAction({ type: 'bgColor', bgColorFrom: '0xFFFFFFFF', bgColorTo: '0xFF000000' })).toBe(false);
  });
});
