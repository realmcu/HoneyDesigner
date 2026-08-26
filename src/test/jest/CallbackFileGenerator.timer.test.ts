/**
 * Contract tests for HoneyGUI preset timer callback generation.
 *
 * The contract is that `duration` means real wall-clock milliseconds. HoneyGUI
 * object timers only get polled during the GUI frame walk, so callback counts are
 * not proportional to milliseconds and must never drive animation progress.
 */
import { Component } from '../../hml/types';
import { CallbackFileGenerator } from '../../codegen/honeygui/files/CallbackFileGenerator';
import { generateControlTimerCallbackImpl } from '../../codegen/honeygui/events/EventCodeGenerator';
import { timerReloadArg } from '../../codegen/honeygui/PresetTimerModel';

function makeComponent(id: string, data: Record<string, any>): Component {
  return {
    id,
    type: 'hg_image',
    name: id,
    position: { x: 0, y: 0, width: 100, height: 100 },
    data,
    visible: true,
    enabled: true,
    locked: false,
    zIndex: 0,
  };
}

function makeNeedle(timerOverrides: Record<string, any> = {}): Component {
  return makeComponent('needle', {
    timers: [{
      id: 'tick',
      name: 'DashTick',
      enabled: true,
      runImmediately: true,
      interval: 10,
      reload: true,
      mode: 'preset',
      segments: [
        { duration: 1000, actions: [{ type: 'rotation', angleOrigin: -120, angleTarget: 120 }] },
        { duration: 1000, actions: [{ type: 'rotation', angleOrigin: 120, angleTarget: -120 }] },
      ],
      stopOnComplete: false,
      ...timerOverrides,
    }],
  });
}

function generate(component: Component): string {
  return new CallbackFileGenerator([component]).generateImplementation('Main');
}

/** Strip line comments so structural assertions cannot match commentary. */
function withoutComments(code: string): string {
  return code.split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');
}

describe('preset timer callback contract', () => {
  it('emits cumulative millisecond timeline boundaries instead of callback counts', () => {
    const code = generate(makeNeedle());

    expect(code).toContain('const uint32_t total_duration_ms = 2000u;');
    expect(code).toContain('const uint32_t seg0_start_ms = 0u;');
    expect(code).toContain('const uint32_t seg0_end_ms = 1000u;');
    expect(code).toContain('const uint32_t seg1_start_ms = 1000u;');
    expect(code).toContain('const uint32_t seg1_end_ms = 2000u;');

    // Progress must come from gui_ms_get(), not from a callback counter.
    expect(code).toContain('gui_ms_get()');
    expect(code).not.toContain('cnt_max');
    // The old counter survives only as a restart request flag, never as a
    // progress source: no interpolation may read it.
    expect(code).not.toMatch(/\*\s*needle_timer_cnt|needle_timer_cnt\s*\//);
  });

  it('loops by taking the modulo of the original time origin', () => {
    const code = generate(makeNeedle({ stopOnComplete: false }));

    expect(code).toContain('total_elapsed_ms % total_duration_ms');

    // The time origin is established once. Re-seeding it at every cycle end would
    // accumulate one frame of error per cycle.
    const originAssignments = code.match(/needle_timer_start_ms = now_ms;/g) || [];
    expect(originAssignments).toHaveLength(1);
  });

  it('applies the exact endpoint state before stopping a one-shot animation', () => {
    const code = generate(makeNeedle({ stopOnComplete: true }));

    // The timeline is clamped to the total duration so the last frame lands on
    // the exact endpoint even when a callback overshoots it.
    expect(code).toContain('uint32_t timeline_ms = finished ? total_duration_ms : total_elapsed_ms;');
    expect(code).toContain('gui_obj_stop_timer(target);');
    expect(code.indexOf('gui_img_rotation')).toBeLessThan(code.indexOf('gui_obj_stop_timer(target);'));
    expect(code).not.toContain('total_elapsed_ms % total_duration_ms');
  });
});

describe('preset timer input shapes', () => {
  it('drives the legacy timerActions/timerDuration format from real time too', () => {
    const code = generate(makeComponent('dial', {
      timerEnabled: true,
      timerMode: 'preset',
      timerInterval: 10,
      timerDuration: 2000,
      timerActions: [{ type: 'rotation', angleOrigin: 0, angleTarget: 90 }],
      timerStopOnComplete: false,
    }));

    expect(code).toContain('void dial_preset_timer_cb(void *obj)');
    expect(code).toContain('const uint32_t total_duration_ms = 2000u;');
    expect(code).toContain('uint32_t total_elapsed_ms = now_ms - dial_timer_start_ms;');
    expect(code).toContain('total_elapsed_ms % total_duration_ms');
  });

  it('turns delayStart into a leading wait segment on the real timeline', () => {
    const code = generate(makeComponent('dial', {
      timers: [{
        id: 'fade', enabled: true, interval: 10, reload: true, mode: 'preset',
        delayStart: 300,
        duration: 700,
        actions: [{ type: 'opacity', from: 0, to: 255 }],
        stopOnComplete: false,
      }],
    }));

    // 300 ms wait + 700 ms fade, expressed as two ordinary segments
    expect(code).toContain('const uint32_t total_duration_ms = 1000u;');
    expect(code).toContain('const uint32_t seg0_end_ms = 300u;');
    expect(code).toContain('const uint32_t seg1_start_ms = 300u;');
    expect(code).toContain('// No sampled action, this segment only takes time');
    expect(code).not.toContain('cnt_wait');
  });
});

describe('preset timer degenerate durations', () => {
  it('never divides or takes a modulo by zero when a segment is 0 ms', () => {
    const code = generate(makeComponent('dial', {
      timers: [{
        id: 'blink', enabled: true, interval: 10, reload: true, mode: 'preset',
        segments: [
          { duration: 0, actions: [{ type: 'visibility', visible: false }] },
          { duration: 500, actions: [{ type: 'opacity', from: 0, to: 255 }] },
        ],
        stopOnComplete: false,
      }],
    }));

    expect(withoutComments(code)).not.toMatch(/[/%]\s*0\b/);
    // A 0 ms segment is an instantaneous boundary, not a sampled span
    expect(code).toContain('// Segment 1 (0 ms boundary)');
    expect(code).toContain('gui_obj_hidden(target, true);');
  });

  it('applies the final state once and stops when the total duration is 0 ms', () => {
    const code = generate(makeComponent('dial', {
      timers: [{
        id: 'snap', enabled: true, interval: 10, reload: true, mode: 'preset',
        segments: [{ duration: 0, actions: [{ type: 'rotation', angleOrigin: 0, angleTarget: 90 }] }],
        stopOnComplete: false,
      }],
    }));

    expect(withoutComments(code)).not.toMatch(/[/%]\s*0\b/);
    // No timeline to sample: the endpoint value is applied directly
    expect(code).toContain('* 1.0f;');
    expect(code).not.toContain('float progress');
    expect(code).toContain('gui_obj_stop_timer(target);');
  });
});

describe('preset timer reload and restart', () => {
  it('always reloads the underlying timer for preset animations and keeps the configured value for custom ones', () => {
    expect(timerReloadArg(true, 'false')).toBe('true');
    expect(timerReloadArg(false, 'false')).toBe('false');
    expect(timerReloadArg(false, 'true')).toBe('true');
  });

  it('resets the elapsed-time state on switchTimer.start and forces reload', () => {
    const code = generate(makeComponent('dial', {
      timers: [
        {
          id: 'intro', enabled: true, interval: 10, reload: true, mode: 'preset',
          segments: [{
            duration: 100,
            actions: [{ type: 'switchTimer', timerTargets: [{ timerId: 'spin', action: 'start' }] }],
          }],
          stopOnComplete: true,
        },
        {
          id: 'spin', enabled: false, interval: 10, reload: false, mode: 'preset',
          segments: [{ duration: 500, actions: [{ type: 'rotation', angleOrigin: 0, angleTarget: 360 }] }],
          stopOnComplete: false,
        },
      ],
    }));

    expect(code).toContain('dial_timer_reset_state();');
    // reload: false is configured on the target preset timer, but a preset
    // animation needs many callbacks, so the object timer must reload anyway.
    expect(code).toContain('gui_obj_create_timer(target, 10, true, dial_spin_cb);');
  });

  it('resets the elapsed-time state from a controlTimer start event', () => {
    const dial = makeComponent('dial', {
      timers: [{
        id: 'spin', enabled: false, interval: 10, reload: false, mode: 'preset',
        segments: [{ duration: 500, actions: [{ type: 'rotation', angleOrigin: 0, angleTarget: 360 }] }],
        stopOnComplete: true,
      }],
    });
    const button = makeComponent('btn', {});
    button.type = 'hg_button';
    button.eventConfigs = [{
      type: 'onClick',
      actions: [{
        type: 'controlTimer',
        timerTargets: [{ componentId: 'dial', timerIndex: 0, action: 'start' }],
      }],
    }] as any;

    const body = generateControlTimerCallbackImpl(button, new Map([['dial', dial], ['btn', button]])).join('\n');

    expect(body).toContain('dial_timer_reset_state();');
    expect(body).toContain('gui_obj_create_timer(GUI_BASE(dial), 10, true, dial_spin_cb);');
  });

  it('restarts from zero after a stop, because only the reset entry point clears the clock', () => {
    const code = generate(makeNeedle({ stopOnComplete: true }));

    // Completing a one-shot animation stops the timer but keeps the finished
    // state; the clock is only rewound through the reset entry point.
    expect(code).toContain(`void needle_timer_reset_state(void)
{
    needle_timer_start_ms = 0;
    needle_timer_started = false;
    needle_timer_prev_elapsed_ms = 0;
}`);
    expect(code).toContain(`    if (finished)
    {
        gui_obj_stop_timer(target);
    }`);

    // The origin is only re-established while the animation is not running
    expect(code).toContain('if (!needle_timer_started)');
  });

  it('does not emit preset state for a component that only owns custom timers', () => {
    const generator = new CallbackFileGenerator([makeComponent('dial', {
      timers: [{ id: 'tick', enabled: true, interval: 100, reload: true, mode: 'custom', callback: 'dial_tick_cb' }],
    })]);

    expect(generator.generateImplementation('Main')).not.toContain('dial_timer_start_ms');
    expect(generator.generateHeader('Main')).not.toContain('dial_timer_start_ms');
  });
});

describe('deprecated *_timer_cnt compatibility', () => {
  /**
   * Shipped project templates rewind a preset animation from `user/` code with
   * `<id>_timer_cnt = 0;`, so the symbol is a de-facto public API. Generated code
   * never overwrites `user/`, so removing it breaks existing projects at compile
   * time. It stays declared and is honoured as a restart request.
   */
  it('still declares and defines the counter for every component with a timer', () => {
    const generator = new CallbackFileGenerator([
      makeComponent('needle', {
        timers: [{
          id: 'tick', enabled: true, interval: 10, reload: true, mode: 'preset',
          segments: [{ duration: 1000, actions: [{ type: 'rotation', angleOrigin: 0, angleTarget: 90 }] }],
          stopOnComplete: false,
        }],
      }),
      makeComponent('clockLabel', {
        timers: [{ id: 'tick', enabled: true, interval: 100, reload: true, mode: 'custom', callback: 'clock_cb' }],
      }),
    ]);

    const header = generator.generateHeader('Main');
    const impl = generator.generateImplementation('Main');

    // Both preset and custom timer owners had the counter before, so both keep it
    expect(header).toContain('extern uint16_t needle_timer_cnt;');
    expect(header).toContain('extern uint16_t clockLabel_timer_cnt;');
    expect(impl).toContain('uint16_t needle_timer_cnt = 0;');
    expect(impl).toContain('uint16_t clockLabel_timer_cnt = 0;');
  });

  it('treats a zero written by user code as a restart request, before the origin is set', () => {
    const code = generate(makeNeedle({ stopOnComplete: false }));

    expect(code).toContain(`    if (needle_timer_cnt == 0)
    {
        needle_timer_reset_state();
    }
    needle_timer_cnt = 1;`);

    // The restart must be handled before the time origin is established,
    // otherwise the reset would be undone by the same callback.
    expect(code.indexOf('needle_timer_cnt = 1;'))
      .toBeLessThan(code.indexOf('if (!needle_timer_started)'));
  });
});

describe('discrete action boundaries', () => {
  /**
   * Structural assertions: they check that discrete actions are emitted under an
   * entry-boundary guard rather than in the per-frame sampled chain. The runtime
   * behaviour of the emitted predicate is verified in PC simulation.
   */
  function mixedTimerCode(): string {
    return generate(makeComponent('dial', {
      timers: [{
        id: 'mix', enabled: true, interval: 10, reload: true, mode: 'preset',
        segments: [
          { duration: 500, actions: [{ type: 'opacity', from: 0, to: 255 }] },
          { duration: 500, actions: [{ type: 'visibility', visible: false }] },
        ],
        stopOnComplete: false,
      }],
    }));
  }

  it('guards a discrete action by segment entry instead of running it every frame', () => {
    const code = mixedTimerCode();

    const guardIndex = code.indexOf(
      'if (preset_anim_boundary_crossed(seg1_start_ms, prev_timeline_ms, timeline_ms, cycle_wrapped, cycle_skipped))'
    );
    const actionIndex = code.indexOf('gui_obj_hidden(target, true);');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(actionIndex).toBeGreaterThan(guardIndex);

    // Exactly one emission: the discrete action must not also sit in the chain
    expect(code.match(/gui_obj_hidden\(target, true\);/g)).toHaveLength(1);
  });

  it('compares entry boundaries on the phase within one cycle, so past cycles cannot be replayed', () => {
    const code = mixedTimerCode();

    // Both ends of the comparison are phases inside [0, total_duration_ms)
    expect(code).toContain('uint32_t timeline_ms = total_elapsed_ms % total_duration_ms;');
    expect(code).toContain('uint32_t prev_timeline_ms = prev_elapsed_ms % total_duration_ms;');

    // A callback gap that swallowed whole cycles fires each boundary once, not once per cycle
    expect(code).toContain('bool cycle_skipped = (total_elapsed_ms - prev_elapsed_ms) >= total_duration_ms;');
    expect(code).toContain(`    if (cycle_skipped)
    {
        // At least one whole cycle elapsed since the previous sample
        return true;
    }`);
  });
});
