/**
 * LVGL animation code generator
 *
 * Consumes the platform-agnostic `component.data.timers` (TimerConfig[]) produced
 * by the designer frontend and translates them into native LVGL code.
 *
 * Action routing (design principle: split by action, not by timer):
 * - Interpolatable actions (position / size / opacity / rotation / scale) map to
 *   the native `lv_anim` engine: a single-segment timer becomes self-starting
 *   `lv_anim_t` blocks; a multi-segment timer becomes an `lv_anim_timeline`.
 * - Discrete actions (visibility / setFocus / changeImage / imageSequence /
 *   fgColor / bgColor / switchTimer) map to a frame-driven `lv_timer` callback
 *   that mirrors HoneyGUI's counting model. The callback body is emitted into
 *   `{design}_lvgl_callbacks.c` inside a protected area so users can edit it.
 *
 * switchTimer (on-demand upgrade): a timer referenced by any switchTimer action
 * is "controlled". Its anim build code is lifted into `_anim_start_*` /
 * `_anim_stop_*` helper functions (defined in *_ui.c) instead of being inlined,
 * so other callbacks can start/stop it. Stopping a plain anim uses
 * `lv_anim_delete(obj, exec_cb)`; a timeline uses `lv_anim_timeline_pause`; a
 * discrete `lv_timer` uses `lv_timer_resume` / `lv_timer_pause`. Uncontrolled
 * timers keep their original inline output unchanged.
 *
 * Cross-file linkage: discrete callbacks live in callbacks.c but reference
 * symbols defined in *_ui.c. Plain `lv_timer` handles are non-static and
 * forward-declared at the top of callbacks.c; anim start/stop is reached only
 * through the (non-static) helper functions, so exec_cb wrappers and timeline
 * handles can stay static in *_ui.c.
 */
import { Component, TimerConfig, TimerAction } from '../../hml/types';
import { LvglGeneratorContext } from './LvglComponentGenerator';
import { toFiniteNumber, escapeCString, normalizeLvglImageSource } from './LvglUtils';

/** A discrete-action callback implementation for callbacks.c. */
export interface TimerCallbackImpl {
  name: string;
  signature: string;
  body: string;
}

/** Animatable property keys, each backed by a generated wrapper exec_cb. */
type HelperKey = 'x' | 'y' | 'width' | 'height' | 'opa' | 'rotation' | 'scale_x' | 'scale_y' | 'bar_value' | 'slider_value';

/** Normalized animation segment (duration in ms + action list). */
interface Segment {
  duration: number;
  actions: TimerAction[];
}

/**
 * Wrapper exec_cb definitions. LVGL's `lv_anim_exec_xcb_t` is `void(*)(void*, int32_t)`,
 * so 3-parameter v9 style setters must be wrapped. Even the 2-parameter setters
 * (set_x/y/width/height) are wrapped here to match LVGL's own examples and avoid
 * function-pointer-cast warnings / UB.
 */
const HELPER_DEFS: Record<HelperKey, { cb: string; def: string }> = {
  x: {
    cb: '_hg_anim_x_cb',
    def: 'static void _hg_anim_x_cb(void * var, int32_t v) { lv_obj_set_x((lv_obj_t *)var, v); }',
  },
  y: {
    cb: '_hg_anim_y_cb',
    def: 'static void _hg_anim_y_cb(void * var, int32_t v) { lv_obj_set_y((lv_obj_t *)var, v); }',
  },
  width: {
    cb: '_hg_anim_width_cb',
    def: 'static void _hg_anim_width_cb(void * var, int32_t v) { lv_obj_set_width((lv_obj_t *)var, v); }',
  },
  height: {
    cb: '_hg_anim_height_cb',
    def: 'static void _hg_anim_height_cb(void * var, int32_t v) { lv_obj_set_height((lv_obj_t *)var, v); }',
  },
  opa: {
    cb: '_hg_anim_opa_cb',
    def: 'static void _hg_anim_opa_cb(void * var, int32_t v) { lv_obj_set_style_opa((lv_obj_t *)var, (lv_opa_t)v, LV_PART_MAIN); }',
  },
  rotation: {
    cb: '_hg_anim_rotation_cb',
    def: 'static void _hg_anim_rotation_cb(void * var, int32_t v) { lv_obj_set_style_transform_rotation((lv_obj_t *)var, v, LV_PART_MAIN); }',
  },
  scale_x: {
    cb: '_hg_anim_scale_x_cb',
    def: 'static void _hg_anim_scale_x_cb(void * var, int32_t v) { lv_obj_set_style_transform_scale_x((lv_obj_t *)var, v, LV_PART_MAIN); }',
  },
  scale_y: {
    cb: '_hg_anim_scale_y_cb',
    def: 'static void _hg_anim_scale_y_cb(void * var, int32_t v) { lv_obj_set_style_transform_scale_y((lv_obj_t *)var, v, LV_PART_MAIN); }',
  },
  bar_value: {
    cb: '_hg_anim_bar_value_cb',
    def: 'static void _hg_anim_bar_value_cb(void * var, int32_t v) { lv_bar_set_value((lv_obj_t *)var, v, LV_ANIM_OFF); }',
  },
  slider_value: {
    cb: '_hg_anim_slider_value_cb',
    def: 'static void _hg_anim_slider_value_cb(void * var, int32_t v) { lv_slider_set_value((lv_obj_t *)var, v, LV_ANIM_OFF); }',
  },
};

/** Interpolatable action types -> native lv_anim. */
const INTERP_TYPES = new Set<TimerAction['type']>(['position', 'size', 'opacity', 'rotation', 'scale', 'value']);
/** Discrete action types -> frame-driven lv_timer callback. */
const DISCRETE_TYPES = new Set<TimerAction['type']>([
  'visibility', 'setFocus', 'changeImage', 'imageSequence', 'fgColor', 'bgColor', 'switchTimer',
]);
/** Discrete actions that fire once on segment entry rather than every frame. */
const ONESHOT_TYPES = new Set<TimerAction['type']>(['visibility', 'setFocus', 'changeImage', 'switchTimer']);

export class LvglAnimationGenerator {
  /** Wrapper exec_cb's actually referenced, collected across all components for dedup. */
  private neededHelpers = new Set<HelperKey>();
  /** File-static timeline handle var names (declared in *_ui.c). */
  private neededTimelines = new Set<string>();
  /** Non-static lv_timer handle var names (declared in *_ui.c, extern in callbacks.c). */
  private neededTimerHandles = new Set<string>();
  /** `_anim_start_*` / `_anim_stop_*` helper function definitions (emitted in *_ui.c). */
  private startHelperDefs: string[] = [];
  /** Forward/extern declarations callbacks.c needs to reach *_ui.c symbols. */
  private callbackExterns = new Set<string>();
  /** `extern const lv_image_dsc_t` declarations needed by discrete callbacks. */
  private callbackImageExterns = new Set<string>();
  /** Discrete-action timer callback implementations for callbacks.c. */
  private timerCallbacks: TimerCallbackImpl[] = [];

  /**
   * Generate the in-`create_view()` code for a single component (anim init,
   * lv_timer creation, controlled-timer start calls). Side effects populate the
   * collections queried by the getters below. Returns '' when there is nothing.
   */
  generate(component: Component, ctx: LvglGeneratorContext): string {
    const timers = component.data?.timers;
    if (!Array.isArray(timers) || timers.length === 0) {
      return '';
    }

    const idToIndex = new Map<string, number>();
    timers.forEach((t, i) => { if (t.id) { idToIndex.set(t.id, i); } });
    const controlled = this.collectControlledIds(timers);

    let code = '';
    timers.forEach((timer, index) => {
      code += this.generateOneTimer(component, timer, index, idToIndex, controlled, ctx);
    });
    return code;
  }

  /** C definitions of every wrapper exec_cb referenced so far (deduped, stable order). */
  getHelperDefinitions(): string {
    if (this.neededHelpers.size === 0) {
      return '';
    }
    let code = '// Animation exec_cb helpers (auto-generated)\n';
    (Object.keys(HELPER_DEFS) as HelperKey[]).forEach(key => {
      if (this.neededHelpers.has(key)) {
        code += HELPER_DEFS[key].def + '\n';
      }
    });
    return code + '\n';
  }

  /** File-static declarations for every timeline handle referenced so far. */
  getTimelineDeclarations(): string {
    if (this.neededTimelines.size === 0) {
      return '';
    }
    let code = '// Animation timeline handles (auto-generated)\n';
    this.neededTimelines.forEach(name => {
      code += `static lv_anim_timeline_t * ${name} = NULL;\n`;
    });
    return code + '\n';
  }

  /** Non-static declarations for lv_timer handles controlled via switchTimer. */
  getTimerHandleDeclarations(): string {
    if (this.neededTimerHandles.size === 0) {
      return '';
    }
    let code = '// Discrete-animation timer handles (auto-generated, referenced by switchTimer)\n';
    this.neededTimerHandles.forEach(name => {
      code += `lv_timer_t * ${name} = NULL;\n`;
    });
    return code + '\n';
  }

  /** `_anim_start_*` / `_anim_stop_*` helper function definitions for *_ui.c. */
  getStartHelperDefinitions(): string {
    if (this.startHelperDefs.length === 0) {
      return '';
    }
    return '// Controllable animation start/stop helpers (auto-generated)\n' +
      this.startHelperDefs.join('\n') + '\n\n';
  }

  /** Discrete-action timer callback implementations to merge into callbacks.c. */
  getTimerCallbackImpls(): TimerCallbackImpl[] {
    return this.timerCallbacks;
  }

  /** Forward/extern declaration block callbacks.c must place after its includes. */
  getCallbackExternDeclarations(): string {
    if (this.callbackExterns.size === 0 && this.callbackImageExterns.size === 0) {
      return '';
    }
    let code = '/* Forward declarations for symbols defined in the UI source (auto-generated) */\n';
    this.callbackImageExterns.forEach(name => { code += `extern const lv_image_dsc_t ${name};\n`; });
    this.callbackExterns.forEach(decl => { code += decl + '\n'; });
    return code + '\n';
  }

  // ---------------------------------------------------------------------------
  // Per-timer dispatch
  // ---------------------------------------------------------------------------

  /** Collect the set of timer ids targeted by any switchTimer action. */
  private collectControlledIds(timers: TimerConfig[]): Set<string> {
    const ids = new Set<string>();
    const scan = (actions: TimerAction[] | undefined) => {
      (actions ?? []).forEach(a => {
        if (a.type !== 'switchTimer') { return; }
        (a.timerTargets ?? []).forEach(t => { if (t.timerId) { ids.add(t.timerId); } });
        if (a.timerId) { ids.add(a.timerId); }
      });
    };
    timers.forEach(timer => {
      scan(timer.actions);
      (timer.segments ?? []).forEach(seg => scan(seg.actions));
    });
    return ids;
  }

  /** Normalize a timer into a list of segments (legacy single-segment included). */
  private normalizeSegments(timer: TimerConfig): Segment[] {
    if (Array.isArray(timer.segments) && timer.segments.length > 0) {
      return timer.segments.map(seg => ({
        duration: toFiniteNumber(seg.duration, 0),
        actions: Array.isArray(seg.actions) ? seg.actions : [],
      }));
    }
    return [{
      duration: toFiniteNumber(timer.duration, 0) || 1000,
      actions: Array.isArray(timer.actions) ? timer.actions : [],
    }];
  }

  /** Translate one timer into create-view code, routing actions by bucket. */
  private generateOneTimer(
    component: Component,
    timer: TimerConfig,
    index: number,
    idToIndex: Map<string, number>,
    controlled: Set<string>,
    ctx: LvglGeneratorContext
  ): string {
    if (timer.mode && timer.mode !== 'preset') {
      return '';
    }

    const isEnabled = timer.enabled !== false;
    const isControlled = !!timer.id && controlled.has(timer.id);
    // A disabled timer that nobody starts produces no code (matches phase 1-2).
    if (!isEnabled && !isControlled) {
      return '';
    }

    const segments = this.normalizeSegments(timer);
    const hasInterp = segments.some(s => s.actions.some(a => INTERP_TYPES.has(a.type)));
    const hasDiscrete = segments.some(s => s.actions.some(a => DISCRETE_TYPES.has(a.type)));
    if (!hasInterp && !hasDiscrete) {
      return '';
    }

    const objId = component.id;
    const isMulti = segments.length > 1;
    let code = '';

    // --- Interpolatable bucket -> lv_anim ---
    if (hasInterp) {
      if (isControlled) {
        this.registerAnimHelpers(objId, timer, index, segments, isMulti, component.type);
        if (isEnabled) {
          code += `    _anim_start_${objId}_t${index}(${objId});\n`;
        }
      } else if (isMulti) {
        code += this.generateTimelineTimer(component, timer, index, segments);
      } else {
        code += this.generateInlineSingleAnim(component, timer, index, segments[0]);
      }
    }

    // --- Discrete bucket -> lv_timer callback ---
    if (hasDiscrete) {
      const cbName = `${objId}_t${index}_timer_cb`;
      const interval = Math.max(1, Math.round(toFiniteNumber(timer.interval, 30)));
      this.registerTimerCallback(component, timer, index, segments, interval, idToIndex, controlled, ctx, cbName);

      if (isControlled) {
        const handle = `tmr_${objId}_t${index}`;
        this.neededTimerHandles.add(handle);
        this.callbackExterns.add(`extern lv_timer_t * ${handle};`);
        // Guard against double-registration if create_view() is called more than once.
        code += `    if (${handle} != NULL) { lv_timer_del(${handle}); }\n`;
        code += `    ${handle} = lv_timer_create(${cbName}, ${interval}, ${objId});\n`;
        if (!isEnabled) {
          code += `    lv_timer_pause(${handle});\n`;
        }
      } else {
        code += `    lv_timer_create(${cbName}, ${interval}, ${objId});\n`;
      }
    }

    return code;
  }

  // ---------------------------------------------------------------------------
  // Interpolatable bucket (lv_anim)
  // ---------------------------------------------------------------------------

  /**
   * Map a single action to its lv_anim scalar specs. position / size / scale each
   * expand to two anims (x+y / w+h / scale_x+scale_y); opacity / rotation to one.
   * Unit conversions: rotation degrees -> 0.1deg (x10), scale 1.0 -> 256 (100%).
   */
  private actionToAnimSpecs(
    action: TimerAction,
    prefix: string,
    componentType = ''
  ): Array<{ name: string; helper: HelperKey; from: number; to: number }> {
    switch (action.type) {
      case 'position':
        return [
          { name: `${prefix}_x`, helper: 'x', from: toFiniteNumber(action.fromX, 0), to: toFiniteNumber(action.toX, 0) },
          { name: `${prefix}_y`, helper: 'y', from: toFiniteNumber(action.fromY, 0), to: toFiniteNumber(action.toY, 0) },
        ];
      case 'size':
        return [
          { name: `${prefix}_w`, helper: 'width', from: toFiniteNumber(action.fromW, 0), to: toFiniteNumber(action.toW, 0) },
          { name: `${prefix}_h`, helper: 'height', from: toFiniteNumber(action.fromH, 0), to: toFiniteNumber(action.toH, 0) },
        ];
      case 'opacity':
        return [
          {
            name: `${prefix}_opa`,
            helper: 'opa',
            from: this.clampOpa(toFiniteNumber(action.from, 255)),
            to: this.clampOpa(toFiniteNumber(action.to, 255)),
          },
        ];
      case 'rotation':
        return [
          {
            name: `${prefix}_rot`,
            helper: 'rotation',
            from: Math.round(toFiniteNumber(action.angleOrigin, 0) * 10),
            to: Math.round(toFiniteNumber(action.angleTarget, 0) * 10),
          },
        ];
      case 'scale': {
        const toScale = (v: unknown) => Math.round(toFiniteNumber(v, 1) * 256);
        return [
          { name: `${prefix}_scalex`, helper: 'scale_x', from: toScale(action.zoomXOrigin), to: toScale(action.zoomXTarget) },
          { name: `${prefix}_scaley`, helper: 'scale_y', from: toScale(action.zoomYOrigin), to: toScale(action.zoomYTarget) },
        ];
      }
      case 'value': {
        const helper: HelperKey = componentType === 'hg_slider' ? 'slider_value' : 'bar_value';
        return [
          { name: `${prefix}_val`, helper, from: toFiniteNumber(action.fromValue, 0), to: toFiniteNumber(action.toValue, 100) },
        ];
      }
      default:
        return [];
    }
  }

  /** Emit inline self-starting lv_anim blocks for a single-segment timer. */
  private generateInlineSingleAnim(component: Component, timer: TimerConfig, index: number, segment: Segment): string {
    const supported = segment.actions.filter(a => INTERP_TYPES.has(a.type));
    if (supported.length === 0) {
      return '';
    }
    const objId = component.id;
    const rawDuration = toFiniteNumber(segment.duration, 0);
    const duration = rawDuration > 0 ? rawDuration : 1000;
    const repeat = timer.reload === false ? '1' : 'LV_ANIM_REPEAT_INFINITE';
    const label = timer.name || timer.id || `timer${index}`;

    let code = `    /* Timer "${this.escapeComment(label)}": ${duration}ms, repeat ${repeat === '1' ? 'once' : 'infinite'} */\n`;
    code += this.emitPivotIfNeeded(objId, supported);
    supported.forEach((action, actionIdx) => {
      const prefix = `a_${objId}_t${index}_${actionIdx}`;
      this.actionToAnimSpecs(action, prefix, component.type).forEach(s => {
        code += this.buildAnim(s.name, objId, s.helper, s.from, s.to, duration,
          `    lv_anim_set_repeat_count(&${s.name}, ${repeat});\n    lv_anim_start(&${s.name});\n`);
      });
    });
    return code;
  }

  /**
   * Translate a multi-segment timer into an lv_anim_timeline: each segment's
   * actions become anims added at the accumulated start_time. Empty-action
   * segments act as pure waits that only advance the offset.
   */
  private generateTimelineTimer(component: Component, timer: TimerConfig, index: number, segments: Segment[]): string {
    const objId = component.id;
    const tlVar = `tl_${objId}_t${index}`;
    this.neededTimelines.add(tlVar);

    const label = timer.name || timer.id || `timer${index}`;
    let code = `    /* Timer "${this.escapeComment(label)}": ${segments.length} segments (timeline) */\n`;
    code += this.emitPivotIfNeeded(objId, segments.flatMap(s => s.actions));
    code += `    ${tlVar} = lv_anim_timeline_create();\n`;
    code += this.emitTimelineAdds(objId, index, segments, tlVar, component.type);
    if (timer.reload !== false) {
      code += `    lv_anim_timeline_set_repeat_count(${tlVar}, LV_ANIM_REPEAT_INFINITE);\n`;
    }
    code += `    lv_anim_timeline_start(${tlVar});\n`;
    return code;
  }

  /**
   * Shared timeline-add emission (used inline and inside start helpers).
   *
   * Each anim gets `early_apply` disabled: LVGL's timeline defaults to applying a
   * descriptor's start_value while act_time is still before its slot (lv_anim
   * early_apply=1). When several segments drive the SAME object property (e.g. a
   * progressbar value going 0->100 then 100->0), a later segment would clobber an
   * earlier one that is still playing, so only the last segment is ever visible.
   * Turning early_apply off makes each segment act strictly within its own slot,
   * which is the correct timeline semantics.
   */
  private emitTimelineAdds(objId: string, index: number, segments: Segment[], tlVar: string, componentType = ''): string {
    let code = '';
    let startTime = 0;
    segments.forEach((seg, segIdx) => {
      const segActions = seg.actions.filter(a => INTERP_TYPES.has(a.type));
      const segDuration = toFiniteNumber(seg.duration, 0);
      const effDuration = segDuration > 0 ? segDuration : segActions.length > 0 ? 1000 : 0;
      segActions.forEach((action, actionIdx) => {
        const prefix = `a_${objId}_t${index}_s${segIdx}_${actionIdx}`;
        this.actionToAnimSpecs(action, prefix, componentType).forEach(s => {
          code += this.buildAnim(s.name, objId, s.helper, s.from, s.to, effDuration,
            `    lv_anim_set_early_apply(&${s.name}, false);\n` +
            `    lv_anim_timeline_add(${tlVar}, ${startTime}, &${s.name});\n`);
        });
      });
      startTime += effDuration;
    });
    return code;
  }

  /**
   * Build _anim_start_* / _anim_stop_* helpers for a controlled timer so other
   * callbacks (switchTimer) can start/stop it. Single-segment timers self-start
   * inside the helper and stop via lv_anim_delete; multi-segment timers build a
   * (lazily created) timeline and start/pause it.
   */
  private registerAnimHelpers(objId: string, timer: TimerConfig, index: number, segments: Segment[], isMulti: boolean, componentType = ''): void {
    const startName = `_anim_start_${objId}_t${index}`;
    const stopName = `_anim_stop_${objId}_t${index}`;
    this.callbackExterns.add(`void ${startName}(lv_obj_t * obj);`);
    this.callbackExterns.add(`void ${stopName}(lv_obj_t * obj);`);

    const repeat = timer.reload === false ? '1' : 'LV_ANIM_REPEAT_INFINITE';

    if (isMulti) {
      const tlVar = `tl_${objId}_t${index}`;
      this.neededTimelines.add(tlVar);

      let start = `void ${startName}(lv_obj_t * obj)\n{\n`;
      start += this.emitPivotIfNeeded('obj', segments.flatMap(s => s.actions));
      start += `    if (${tlVar} == NULL) {\n`;
      start += `        ${tlVar} = lv_anim_timeline_create();\n`;
      // Indent the shared timeline-add block by one extra level.
      start += this.indent(this.emitTimelineAdds('obj', index, segments, tlVar, componentType), 4);
      if (timer.reload !== false) {
        start += `        lv_anim_timeline_set_repeat_count(${tlVar}, LV_ANIM_REPEAT_INFINITE);\n`;
      }
      start += `    }\n`;
      start += `    lv_anim_timeline_start(${tlVar});\n}\n`;

      const stop = `void ${stopName}(lv_obj_t * obj)\n{\n    (void)obj;\n    if (${tlVar}) { lv_anim_timeline_pause(${tlVar}); }\n}\n`;
      this.startHelperDefs.push(start, stop);
      return;
    }

    // Single-segment: self-start inside helper, stop via lv_anim_delete(obj, cb).
    const supported = segments[0].actions.filter(a => INTERP_TYPES.has(a.type));
    const rawDuration = toFiniteNumber(segments[0].duration, 0);
    const duration = rawDuration > 0 ? rawDuration : 1000;

    let start = `void ${startName}(lv_obj_t * obj)\n{\n`;
    start += this.emitPivotIfNeeded('obj', supported);
    const stopCbs = new Set<HelperKey>();
    supported.forEach((action, actionIdx) => {
      const prefix = `a_${objId}_t${index}_${actionIdx}`;
      this.actionToAnimSpecs(action, prefix, componentType).forEach(s => {
        stopCbs.add(s.helper);
        start += this.buildAnim(s.name, 'obj', s.helper, s.from, s.to, duration,
          `    lv_anim_set_repeat_count(&${s.name}, ${repeat});\n    lv_anim_start(&${s.name});\n`);
      });
    });
    start += `}\n`;

    let stop = `void ${stopName}(lv_obj_t * obj)\n{\n`;
    stopCbs.forEach(helper => {
      this.neededHelpers.add(helper);
      stop += `    lv_anim_delete(obj, ${HELPER_DEFS[helper].cb});\n`;
    });
    stop += `}\n`;
    this.startHelperDefs.push(start, stop);
  }

  /** Emit pivot-to-center setters once if any action rotates or scales. */
  private emitPivotIfNeeded(objVar: string, actions: TimerAction[]): string {
    const needs = actions.some(a => a.type === 'rotation' || a.type === 'scale');
    if (!needs) {
      return '';
    }
    return `    lv_obj_set_style_transform_pivot_x(${objVar}, lv_pct(50), LV_PART_MAIN);\n` +
      `    lv_obj_set_style_transform_pivot_y(${objVar}, lv_pct(50), LV_PART_MAIN);\n`;
  }

  /**
   * Build the shared lv_anim_t init block (var/values/duration/exec_cb/path) and
   * append the caller-supplied tail (start, or timeline_add). The descriptor is
   * copied by lv_anim_start / lv_anim_timeline_add, so the stack-local is safe.
   */
  private buildAnim(
    varName: string,
    objVar: string,
    helper: HelperKey,
    from: number,
    to: number,
    duration: number,
    tail: string
  ): string {
    this.neededHelpers.add(helper);
    const cb = HELPER_DEFS[helper].cb;
    let code = '';
    code += `    lv_anim_t ${varName};\n`;
    code += `    lv_anim_init(&${varName});\n`;
    code += `    lv_anim_set_var(&${varName}, ${objVar});\n`;
    code += `    lv_anim_set_values(&${varName}, ${from}, ${to});\n`;
    code += `    lv_anim_set_duration(&${varName}, ${duration});\n`;
    code += `    lv_anim_set_exec_cb(&${varName}, ${cb});\n`;
    code += `    lv_anim_set_path_cb(&${varName}, lv_anim_path_linear);\n`;
    code += tail;
    return code;
  }

  // ---------------------------------------------------------------------------
  // Discrete bucket (lv_timer callback)
  // ---------------------------------------------------------------------------

  /**
   * Build a frame-driven lv_timer callback for the discrete actions of a timer,
   * mirroring HoneyGUI's segment-boundary counting model. The body is collected
   * for emission into callbacks.c (the caller adds braces + protected markers).
   */
  private registerTimerCallback(
    component: Component,
    timer: TimerConfig,
    index: number,
    segments: Segment[],
    interval: number,
    idToIndex: Map<string, number>,
    controlled: Set<string>,
    ctx: LvglGeneratorContext,
    cbName: string
  ): void {
    const segCntMax = segments.map(seg => Math.max(1, Math.ceil((toFiniteNumber(seg.duration, 0) || interval) / interval)));
    const total = segCntMax.reduce((a, b) => a + b, 0);

    let body = `    lv_obj_t * target = (lv_obj_t *)lv_timer_get_user_data(t);\n`;
    body += `    static uint32_t cnt = 0;\n`;
    body += `    const uint32_t total_max = ${total};\n`;
    body += `    cnt++;\n`;

    let start = 0;
    segments.forEach((seg, segIdx) => {
      const end = start + segCntMax[segIdx];
      const discrete = seg.actions.filter(a => DISCRETE_TYPES.has(a.type));
      body += `\n    // Segment ${segIdx + 1}: ${toFiniteNumber(seg.duration, 0)}ms\n`;
      body += `    if (cnt > ${start} && cnt <= ${end}) {\n`;
      if (discrete.length > 0) {
        body += `        uint32_t seg_cnt = cnt - ${start};\n`;
        body += `        uint32_t seg_cnt_max = ${end - start};\n`;
        body += `        (void)seg_cnt; (void)seg_cnt_max;\n`;

        const oneShot = discrete.filter(a => ONESHOT_TYPES.has(a.type));
        const continuous = discrete.filter(a => !ONESHOT_TYPES.has(a.type));

        if (oneShot.length > 0) {
          body += `        if (seg_cnt == 1) {\n`;
          oneShot.forEach(a => {
            body += this.indent(this.discreteActionCode(a, component, idToIndex, controlled, ctx), 12);
          });
          body += `        }\n`;
        }
        continuous.forEach(a => {
          body += this.indent(this.discreteActionCode(a, component, idToIndex, controlled, ctx), 8);
        });
      } else {
        body += `        // wait\n`;
      }
      body += `    }\n`;
      start = end;
    });

    body += `\n    if (cnt >= total_max) {\n`;
    body += `        cnt = 0;\n`;
    if (timer.reload === false) {
      body += `        lv_timer_pause(t);\n`;
    }
    body += `    }\n`;

    this.timerCallbacks.push({
      name: cbName,
      signature: `void ${cbName}(lv_timer_t * t)`,
      body,
    });
  }

  /** Generate C for a single discrete action (already inside the segment branch). */
  private discreteActionCode(
    action: TimerAction,
    component: Component,
    idToIndex: Map<string, number>,
    controlled: Set<string>,
    ctx: LvglGeneratorContext
  ): string {
    switch (action.type) {
      case 'visibility': {
        const visible = action.visible !== false;
        return visible
          ? `lv_obj_remove_flag(target, LV_OBJ_FLAG_HIDDEN);\n`
          : `lv_obj_add_flag(target, LV_OBJ_FLAG_HIDDEN);\n`;
      }
      case 'setFocus':
        return `lv_group_focus_obj(target);\n`;
      case 'changeImage': {
        const src = this.resolveImageSrc(action.imagePath, ctx);
        return src ? `lv_image_set_src(target, ${src});\n` : `// changeImage: missing imagePath\n`;
      }
      case 'imageSequence':
        return this.imageSequenceCode(action, ctx);
      case 'fgColor':
        return this.recolorCode(action.fgColorFrom, action.fgColorTo, 'fg');
      case 'bgColor':
        return this.recolorCode(action.bgColorFrom, action.bgColorTo, 'bg');
      case 'switchTimer':
        return this.switchTimerCode(action, component, idToIndex, controlled);
      default:
        return '';
    }
  }

  /** Resolve an image path to a `&dsc` reference (preferred) or a quoted FS path. */
  private resolveImageSrc(imagePath: string | undefined, ctx: LvglGeneratorContext): string | null {
    const raw = (imagePath || '').trim();
    if (!raw) {
      return null;
    }
    const ref = ctx.resources?.getImageRef?.(raw);
    if (ref?.name) {
      this.callbackImageExterns.add(ref.name);
      return `&${ref.name}`;
    }
    return `"${escapeCString(normalizeLvglImageSource(raw))}"`;
  }

  /** Image-sequence frame switch: index = (n-1) * progress. */
  private imageSequenceCode(action: TimerAction, ctx: LvglGeneratorContext): string {
    const paths = Array.isArray(action.imageSequence) ? action.imageSequence : [];
    const srcs = paths.map(p => this.resolveImageSrc(p, ctx)).filter((s): s is string => !!s);
    if (srcs.length === 0) {
      return `// imageSequence: no images\n`;
    }
    let code = `{\n`;
    code += `    static const void * _seq[${srcs.length}] = { ${srcs.join(', ')} };\n`;
    code += `    uint32_t _i = (uint32_t)((${srcs.length} - 1) * seg_cnt / seg_cnt_max);\n`;
    code += `    if (_i >= ${srcs.length}) { _i = ${srcs.length} - 1; }\n`;
    code += `    lv_image_set_src(target, _seq[_i]);\n`;
    code += `}\n`;
    return code;
  }

  /**
   * Recolor (fgColor -> image_recolor) or background (bgColor -> bg_color) code.
   * With a "from" value the channels are interpolated by progress; otherwise the
   * target value is applied directly.
   */
  private recolorCode(from: string | undefined, to: string | undefined, kind: 'fg' | 'bg'): string {
    const toArgb = this.parseArgb(to);
    if (!toArgb) {
      return `// ${kind}Color: missing target color\n`;
    }
    const setColor = kind === 'fg'
      ? (expr: string) => `    lv_obj_set_style_image_recolor(target, ${expr}, LV_PART_MAIN);\n`
      : (expr: string) => `    lv_obj_set_style_bg_color(target, ${expr}, LV_PART_MAIN);\n`;
    const setOpa = kind === 'fg'
      ? (expr: string) => `    lv_obj_set_style_image_recolor_opa(target, ${expr}, LV_PART_MAIN);\n`
      : (expr: string) => `    lv_obj_set_style_bg_opa(target, ${expr}, LV_PART_MAIN);\n`;

    const fromArgb = this.parseArgb(from);
    if (!fromArgb) {
      // No from-color: apply once on segment entry to avoid redundant style invalidations.
      let code = `if (seg_cnt == 1) {\n`;
      code += setColor(`lv_color_hex(0x${this.rgbHex(toArgb)})`);
      code += setOpa(`${toArgb.a}`);
      code += `}\n`;
      return code;
    }

    // Interpolate ARGB channels by progress (multiply before divide for integers).
    let code = `{\n`;
    code += `    int32_t _p = (int32_t)seg_cnt, _pm = (int32_t)seg_cnt_max;\n`;
    code += `    uint8_t _a = (uint8_t)(${fromArgb.a} + (${toArgb.a} - ${fromArgb.a}) * _p / _pm);\n`;
    code += `    uint8_t _r = (uint8_t)(${fromArgb.r} + (${toArgb.r} - ${fromArgb.r}) * _p / _pm);\n`;
    code += `    uint8_t _g = (uint8_t)(${fromArgb.g} + (${toArgb.g} - ${fromArgb.g}) * _p / _pm);\n`;
    code += `    uint8_t _b = (uint8_t)(${fromArgb.b} + (${toArgb.b} - ${fromArgb.b}) * _p / _pm);\n`;
    code += setColor(`lv_color_make(_r, _g, _b)`);
    code += setOpa(`_a`);
    code += `}\n`;
    return code;
  }

  /**
   * switchTimer: start/stop sibling timers on the same component via the helpers
   * and handles generated for controlled timers. Targets resolved by timer id.
   */
  private switchTimerCode(
    action: TimerAction,
    component: Component,
    idToIndex: Map<string, number>,
    controlled: Set<string>
  ): string {
    const targets = [...(action.timerTargets ?? [])];
    if (targets.length === 0 && action.timerId) {
      targets.push({ timerId: action.timerId, action: 'start' });
    }
    if (targets.length === 0) {
      return `// switchTimer: no target specified\n`;
    }

    const timers = component.data?.timers ?? [];
    const objId = component.id;
    let code = '';
    for (const tgt of targets) {
      const idx = tgt.timerId ? idToIndex.get(tgt.timerId) : undefined;
      if (idx === undefined || !timers[idx]) {
        code += `// switchTimer: target "${this.escapeComment(String(tgt.timerId))}" not found\n`;
        continue;
      }
      if (!controlled.has(tgt.timerId)) {
        // Should not happen (collectControlledIds saw it), defensive only.
        code += `// switchTimer: target "${this.escapeComment(tgt.timerId)}" is not controllable\n`;
        continue;
      }
      const target = timers[idx];
      const segs = this.normalizeSegments(target);
      const tgtInterp = segs.some(s => s.actions.some(a => INTERP_TYPES.has(a.type)));
      const tgtDiscrete = segs.some(s => s.actions.some(a => DISCRETE_TYPES.has(a.type)));
      const verb = tgt.action === 'stop' ? 'stop' : 'start';

      code += `// switchTimer: ${verb} "${this.escapeComment(target.name || tgt.timerId)}"\n`;
      if (tgtInterp) {
        code += verb === 'stop'
          ? `_anim_stop_${objId}_t${idx}(target);\n`
          : `_anim_start_${objId}_t${idx}(target);\n`;
      }
      if (tgtDiscrete) {
        code += verb === 'stop'
          ? `lv_timer_pause(tmr_${objId}_t${idx});\n`
          : `lv_timer_resume(tmr_${objId}_t${idx});\n`;
      }
    }
    return code;
  }

  // ---------------------------------------------------------------------------
  // Small utilities
  // ---------------------------------------------------------------------------

  /** Parse "0xAARRGGBB" / "#RRGGBB" / "RRGGBB" into ARGB byte components. */
  private parseArgb(value: string | undefined): { a: number; r: number; g: number; b: number } | null {
    if (!value) {
      return null;
    }
    const hex = value.trim().replace(/^0x/i, '').replace(/^#/, '');
    if (hex.length === 8) {
      return {
        a: parseInt(hex.slice(0, 2), 16),
        r: parseInt(hex.slice(2, 4), 16),
        g: parseInt(hex.slice(4, 6), 16),
        b: parseInt(hex.slice(6, 8), 16),
      };
    }
    if (hex.length === 6) {
      return {
        a: 255,
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
    return null;
  }

  /** Six-digit RRGGBB string for lv_color_hex. */
  private rgbHex(argb: { r: number; g: number; b: number }): string {
    const h = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
    return `${h(argb.r)}${h(argb.g)}${h(argb.b)}`;
  }

  /** Indent every non-empty line of a block by `spaces` spaces. */
  private indent(code: string, spaces: number): string {
    const pad = ' '.repeat(spaces);
    return code
      .split('\n')
      .map(line => (line.length > 0 ? pad + line : line))
      .join('\n');
  }

  private clampOpa(v: number): number {
    return Math.max(0, Math.min(255, Math.round(v)));
  }

  private escapeComment(text: string): string {
    return text.replace(/\*\//g, '* /').replace(/[\r\n]+/g, ' ');
  }
}
