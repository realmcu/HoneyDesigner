/**
 * Preset timer animation model (HoneyGUI engine)
 *
 * HoneyGUI object timers are polled during the GUI object prepare walk, so a
 * timer configured with `interval = 10` only gets a callback once per rendered
 * frame. Callback counts are therefore not proportional to milliseconds, and
 * preset animations must derive their progress from real elapsed time.
 *
 * This module normalizes the three historical timer input shapes into a single
 * segment timeline so the callback generator needs only one emitter:
 *
 * | Input                                        | Normalized result                          |
 * | -------------------------------------------- | ------------------------------------------ |
 * | legacy `timerActions` + `timerDuration`      | `[{ duration, actions }]`                  |
 * | `TimerConfig.actions` + `duration`           | `[{ duration, actions }]`                  |
 * | `TimerConfig.delayStart > 0`                 | empty wait segment prepended to the above  |
 * | `TimerConfig.segments`                       | passed through                             |
 */
import { Component } from '../../hml/types';

/** Fallback duration used when a preset timer carries no usable duration. */
export const DEFAULT_SEGMENT_DURATION_MS = 1000;

/** Timelines are emitted as `uint32_t` milliseconds, so this is the hard ceiling. */
export const MAX_TIMELINE_MS = 0xFFFFFFFF;

/** One segment of a preset animation timeline. */
export interface NormalizedSegment {
  /** Real duration of this segment in milliseconds (integer, >= 0). */
  duration: number;
  /** Actions that apply while the timeline is inside this segment. */
  actions: any[];
}

/** A normalized preset animation timeline with precomputed millisecond boundaries. */
export interface PresetTimeline {
  segments: NormalizedSegment[];
  /** Cumulative start offset of each segment, in milliseconds. */
  starts: number[];
  /** Cumulative end offset of each segment, in milliseconds. */
  ends: number[];
  /** Sum of all segment durations, in milliseconds. */
  totalDuration: number;
}

/**
 * Coerce an arbitrary duration input into a non-negative integer millisecond value.
 * Invalid input (NaN, Infinity, negative, non-numeric) degrades to 0 rather than
 * producing a division or modulo by an undefined value in the generated C.
 */
export function sanitizeDurationMs(value: unknown, fallback = 0): number {
  const raw = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  if (raw <= 0) {
    // A configured 0 is meaningful (instantaneous boundary); negatives are not.
    return raw === 0 ? 0 : fallback;
  }
  return Math.min(Math.floor(raw), MAX_TIMELINE_MS);
}

function toActionList(actions: unknown): any[] {
  return Array.isArray(actions) ? actions.filter(action => !!action) : [];
}

/** Whether a timer config is a preset animation with something to generate. */
export function isPresetTimerConfig(timer: any): boolean {
  if (!timer || timer.mode !== 'preset') {
    return false;
  }
  const hasSegments = Array.isArray(timer.segments) && timer.segments.length > 0;
  const hasActions = Array.isArray(timer.actions) && timer.actions.length > 0;
  return hasSegments || hasActions;
}

/** Whether a component uses the legacy single-timer preset format. */
export function isLegacyPresetTimer(component: Component): boolean {
  if (component.data?.timerEnabled !== true) {
    return false;
  }
  const mode = component.data.timerMode || 'custom';
  return mode === 'preset'
    && Array.isArray(component.data.timerActions)
    && component.data.timerActions.length > 0;
}

/**
 * Whether a component owns at least one preset animation, i.e. whether it needs
 * the generated elapsed-time state block. Components that only use custom
 * callbacks must not reference preset state.
 */
export function componentHasPresetTimer(component: Component): boolean {
  const timers = component.data?.timers;
  if (Array.isArray(timers) && timers.length > 0) {
    return timers.some(timer => isPresetTimerConfig(timer));
  }
  return isLegacyPresetTimer(component);
}

/**
 * Whether a component declares any timer at all, in either format.
 *
 * This is the emission rule for the deprecated `<id>_timer_cnt` compatibility
 * symbol: it must cover exactly the set of components the counter used to be
 * generated for, otherwise existing `user/` code stops compiling.
 */
export function componentHasAnyTimer(component: Component): boolean {
  const timers = component.data?.timers;
  if (Array.isArray(timers) && timers.length > 0) {
    return true;
  }
  return component.data?.timerEnabled === true;
}

/** Names of the generated elapsed-time state symbols for a component. */
export function presetTimerStateNames(componentId: string) {
  return {
    startMs: `${componentId}_timer_start_ms`,
    started: `${componentId}_timer_started`,
    prevElapsedMs: `${componentId}_timer_prev_elapsed_ms`,
    resetFn: `${componentId}_timer_reset_state`,
    /**
     * Deprecated animation counter. Shipped project templates rewind a preset
     * animation from `user/` code by assigning 0 to it, so it stays generated as
     * a restart request flag. It is no longer the animation's time source.
     */
    legacyCount: `${componentId}_timer_cnt`,
  };
}

/**
 * Reload argument for `gui_obj_create_timer`.
 *
 * A preset animation needs many callbacks to walk its timeline, so its object
 * timer must always reload; whether the animation plays once or loops is decided
 * by `stopOnComplete` inside the generated callback. Custom callbacks keep their
 * configured reload value.
 */
export function timerReloadArg(isPreset: boolean, customReload: string): string {
  return isPreset ? 'true' : customReload;
}

/**
 * Normalize a `TimerConfig` preset animation into a segment list.
 *
 * `delayStart` is only honoured on the single-segment shape, matching the
 * historical generator: when `segments` is present it already carries its own
 * leading wait segment and `delayStart` is ignored.
 */
export function normalizeTimerConfigSegments(timer: any): NormalizedSegment[] {
  if (!timer) {
    return [];
  }

  if (Array.isArray(timer.segments) && timer.segments.length > 0) {
    return timer.segments.map((segment: any) => ({
      duration: sanitizeDurationMs(segment?.duration, 0),
      actions: toActionList(segment?.actions),
    }));
  }

  const segments: NormalizedSegment[] = [];

  const delayStart = sanitizeDurationMs(timer.delayStart, 0);
  if (delayStart > 0) {
    // Deprecated field: a leading wait segment expresses the same thing.
    segments.push({ duration: delayStart, actions: [] });
  }

  segments.push({
    duration: sanitizeDurationMs(timer.duration, DEFAULT_SEGMENT_DURATION_MS),
    actions: toActionList(timer.actions),
  });

  return segments;
}

/** Normalize the legacy `timerActions` / `timerDuration` shape into a segment list. */
export function normalizeLegacyTimerSegments(component: Component): NormalizedSegment[] {
  return [{
    duration: sanitizeDurationMs(component.data?.timerDuration, DEFAULT_SEGMENT_DURATION_MS),
    actions: toActionList(component.data?.timerActions),
  }];
}

/**
 * Build millisecond timeline boundaries from a normalized segment list.
 * Accumulation is clamped so the emitted constants always fit `uint32_t`.
 */
export function buildPresetTimeline(segments: NormalizedSegment[]): PresetTimeline {
  const starts: number[] = [];
  const ends: number[] = [];
  const clamped: NormalizedSegment[] = [];
  let cursor = 0;

  segments.forEach(segment => {
    const headroom = MAX_TIMELINE_MS - cursor;
    const duration = Math.min(segment.duration, headroom);
    starts.push(cursor);
    cursor += duration;
    ends.push(cursor);
    clamped.push({ duration, actions: segment.actions });
  });

  return { segments: clamped, starts, ends, totalDuration: cursor };
}

/**
 * Whether an action is a one-shot side effect rather than a sampled state.
 *
 * Boundary actions fire once when the timeline enters their segment; sampling
 * them every callback would repeat side effects on every frame. Colour actions
 * without a start value are boundary actions because there is nothing to
 * interpolate from.
 */
export function isBoundaryAction(action: any): boolean {
  switch (action?.type) {
    case 'visibility':
    case 'changeImage':
    case 'switchView':
    case 'switchTimer':
    case 'setFocus':
      return true;
    case 'fgColor':
      return !action.fgColorFrom;
    case 'bgColor':
      return !action.bgColorFrom;
    default:
      return false;
  }
}
