/**
 * Callback file generator
 * Generates callbacks.h and callbacks.c files
 */
import { Component } from '../../../hml/types';
import { EventGeneratorFactory } from '../events';
import { getMessageCallbackName, generateEventCallbackName } from '../events/EventCodeGenerator';
import {
  NormalizedSegment,
  buildPresetTimeline,
  componentHasAnyTimer,
  componentHasPresetTimer,
  isBoundaryAction,
  isPresetTimerConfig,
  normalizeLegacyTimerSegments,
  normalizeTimerConfigSegments,
  presetTimerStateNames,
} from '../PresetTimerModel';

/** Name of the generated file-local helper used for segment entry detection. */
const BOUNDARY_HELPER_NAME = 'preset_anim_boundary_crossed';

export class CallbackFileGenerator {
  private components: Component[];
  private componentMap: Map<string, Component>;
  private allComponents: Component[]; // Flat array containing all nested components
  /** Set while emitting preset callbacks that need the segment entry helper. */
  private needsBoundaryHelper = false;

  constructor(components: Component[]) {
    this.components = components;
    this.componentMap = new Map(components.map(c => [c.id, c]));
    // Recursively collect all components (including nested ones)
    this.allComponents = this.flattenComponents(components);
  }

  /**
   * Recursively flatten all components (including children nested in containers)
   * Handles list_item specially: includes the list_item itself and all its children
   */
  private flattenComponents(components: Component[]): Component[] {
    const visited = new Set<string>();
    const result: Component[] = [];
    
    const traverse = (comp: Component) => {
      // Prevent duplicate visits
      if (visited.has(comp.id)) return;
      visited.add(comp.id);
      
      result.push(comp);
      
      // Recursively process children (including list_item children)
      if (comp.children && comp.children.length > 0) {
        comp.children.forEach(childId => {
          const child = this.componentMap.get(childId);
          if (child) {
            traverse(child);
          }
        });
      }
    };
    
    components.forEach(comp => traverse(comp));
    return result;
  }

  /**
   * Generate callback header file
   * @param baseName Design name
   * @param existingCallbacksC Existing callbacks.c content (optional), used to extract custom function declarations
   */
  generateHeader(baseName: string, existingCallbacksC?: string): string {
    const guardName = `${baseName.toUpperCase()}_CALLBACKS_H`;
    let code = `#ifndef ${guardName}
#define ${guardName}

#include "gui_api.h"
#include "gui_text.h"
#include "gui_obj_focus.h"

`;

    // Add extern declarations for split time components
    const splitTimeLabels = this.allComponents.filter(c => 
      c.type === 'hg_time_label' && c.data?.timeFormat === 'HH:mm-split'
    );
    
    if (splitTimeLabels.length > 0) {
      code += `// Split time component global variables (defined in UI file)\n`;
      splitTimeLabels.forEach(label => {
        code += `extern gui_text_t *${label.id}_hour;\n`;
        code += `extern gui_text_t *${label.id}_colon;\n`;
        code += `extern gui_text_t *${label.id}_min;\n`;
      });
      code += `\n`;
    }

    // Public preset animation control API. The elapsed-time clock itself stays
    // file-local so user code depends on behaviour rather than implementation.
    const presetComponents = this.allComponents.filter(c => componentHasPresetTimer(c));

    if (presetComponents.length > 0) {
      code += `// Stable preset animation control API\n`;
      code += `// Call before creating or starting the object timer to replay from the beginning.\n`;
      presetComponents.forEach(comp => {
        code += `void ${presetTimerStateNames(comp.id).resetFn}(void);\n`;
      });
      code += `\n`;
    }

    // Deprecated animation counters remain externally visible during the
    // migration window because generated user/ files are never overwritten.
    const timerComponents = this.allComponents.filter(c => componentHasAnyTimer(c));

    if (timerComponents.length > 0) {
      code += `// Deprecated compatibility API; scheduled for removal in the next major version.\n`;
      code += `// For preset animations, assigning 0 requests a restart. Custom timer state is user-owned.\n`;
      code += `#if defined(${guardName}_IMPLEMENTATION)\n`;
      code += `#define HONEYGUI_DESIGN_DEPRECATED(message)\n`;
      code += `#elif defined(__clang__) || defined(__GNUC__)\n`;
      code += `#define HONEYGUI_DESIGN_DEPRECATED(message) __attribute__((deprecated(message)))\n`;
      code += `#elif defined(_MSC_VER)\n`;
      code += `#define HONEYGUI_DESIGN_DEPRECATED(message) __declspec(deprecated(message))\n`;
      code += `#else\n`;
      code += `#define HONEYGUI_DESIGN_DEPRECATED(message)\n`;
      code += `#endif\n`;
      timerComponents.forEach(comp => {
        const state = presetTimerStateNames(comp.id);
        const message = componentHasPresetTimer(comp)
          ? `use ${state.resetFn}() instead`
          : 'remove direct use; custom timer state is user-owned';
        code += `HONEYGUI_DESIGN_DEPRECATED("${message}") extern uint16_t ${state.legacyCount};\n`;
      });
      code += `#undef HONEYGUI_DESIGN_DEPRECATED\n\n`;
    }

    code += `// Event callback function declarations\n`;

    const callbackFunctions = this.collectCallbackFunctions();
    const msgCallbackNames = new Set(this.collectMessageCallbackNames());
    
    callbackFunctions.forEach(funcName => {
      if (msgCallbackNames.has(funcName)) {
        // onMessage callback has a different signature
        code += `void ${funcName}(gui_obj_t *obj, const char *topic, void *data, uint16_t len);\n`;
      } else {
        code += `void ${funcName}(void *obj, gui_event_t *e);\n`;
      }
    });

    // Add time update callback declarations
    const timeUpdateFuncNames = this.collectTimeUpdateCallbackNames();
    timeUpdateFuncNames.forEach(funcName => {
      code += `void ${funcName}(void *p);\n`;
    });

    // Add user-configured timer callback declarations
    const timerCallbackNames = this.collectTimerCallbackNames();
    if (timerCallbackNames.length > 0) {
      code += `\n// User-configured timer callback function declarations\n`;
      timerCallbackNames.forEach(funcName => {
        code += `void ${funcName}(void *obj);\n`;
      });
    }

    // Add toggle button state callback declarations
    const toggleButtonCallbacks = this.collectToggleButtonCallbackNames();
    if (toggleButtonCallbacks.length > 0) {
      code += `\n// Toggle button state callback function declarations\n`;
      toggleButtonCallbacks.forEach(({ onCallback, offCallback }) => {
        code += `void ${onCallback}(void);\n`;
        code += `void ${offCallback}(void);\n`;
      });
    }

    // Extract custom functions from callbacks.c protected area and generate declarations
    if (existingCallbacksC) {
      const customFunctions = this.extractCustomFunctionDeclarations(existingCallbacksC);
      if (customFunctions.length > 0) {
        code += `\n// Custom function declarations (auto-extracted from callbacks.c protected area)\n`;
        customFunctions.forEach(declaration => {
          code += `${declaration};\n`;
        });
      }
    }

    code += `
#endif // ${guardName}
`;

    return code;
  }

  /**
   * Generate callback implementation file
   * @param baseName Design name
   * @param existingContent Existing file content (optional), used to check for existing functions
   */
  generateImplementation(baseName: string, existingContent?: string): string {
    // Collect all time labels and timer labels (using allComponents)
    const timeLabels = this.allComponents.filter(c => c.type === 'hg_time_label');
    const timerLabels = this.allComponents.filter(c => c.type === 'hg_label' && c.data?.isTimerLabel === true);
    
    // Extract function names from the custom_functions protected area in existing file
    const existingFunctions = existingContent ? this.extractFunctionNamesFromProtectedArea(existingContent) : new Set<string>();
    
    // Check if tp_algo.h is needed (for touch release area detection)
    const needsTpAlgo = this.checkNeedsTpAlgo();
    
    let code = `#define ${baseName.toUpperCase()}_CALLBACKS_H_IMPLEMENTATION
#include "${baseName}_callbacks.h"
#undef ${baseName.toUpperCase()}_CALLBACKS_H_IMPLEMENTATION
#include "../ui/${baseName}_ui.h"
#include "../user/${baseName}_user.h"
#include <stdio.h>
#include <string.h>
#include <time.h>
`;

    // Add tp_algo.h if touch release area detection is needed
    if (needsTpAlgo) {
      code += `#include "tp_algo.h"\n`;
    }

    code += `\n`;

    // Declare extern global variables for each time label (defined in UI file)
    if (timeLabels.length > 0) {
      code += `// Time string global variables (defined in UI file)\n`;
      timeLabels.forEach(label => {
        const bufferSize = this.getTimeBufferSize(label.data?.timeFormat);
        code += `extern char ${label.id}_time_str[${bufferSize}];\n`;
      });
      code += `\n`;
    }

    // Declare extern global variables for each timer label (defined in UI file)
    if (timerLabels.length > 0) {
      code += `// Timer string global variables (defined in UI file)\n`;
      timerLabels.forEach(label => {
        const bufferSize = this.getTimerBufferSize(label.data?.timerFormat);
        code += `extern char ${label.id}_timer_str[${bufferSize}];\n`;
        code += `extern int ${label.id}_timer_value;\n`;
      });
      code += `\n`;
    }

    // Generate the preset timer callbacks up front: emitting them tells us
    // whether the segment entry helper below is actually referenced.
    this.needsBoundaryHelper = false;
    const timerCallbackImpls = this.collectTimerCallbackImpls(existingFunctions);

    // Define the preset animation clock state and its reset entry point
    const presetComponents = this.allComponents.filter(c => componentHasPresetTimer(c));

    if (presetComponents.length > 0) {
      code += `// Internal preset animation clock state (real elapsed time, not callback counts)\n`;
      presetComponents.forEach(comp => {
        const state = presetTimerStateNames(comp.id);
        code += `static uint32_t ${state.startMs} = 0;\n`;
        code += `static bool ${state.started} = false;\n`;
        code += `static uint32_t ${state.prevElapsedMs} = 0;\n`;
      });
      code += `\n`;
      presetComponents.forEach(comp => {
        const state = presetTimerStateNames(comp.id);
        code += `void ${state.resetFn}(void)\n`;
        code += `{\n`;
        code += `    ${state.startMs} = 0;\n`;
        code += `    ${state.started} = false;\n`;
        code += `    ${state.prevElapsedMs} = 0;\n`;
        code += `}\n\n`;
      });
    }

    // Deprecated animation counter, kept so existing user/ code keeps compiling.
    // Shipped templates rewind a preset animation by assigning 0 to it from
    // user/ code, which the preset callbacks honour as a restart request.
    const timerComponents = this.allComponents.filter(c => componentHasAnyTimer(c));

    if (timerComponents.length > 0) {
      code += `// Deprecated animation counter (restart request flag, not a frame counter)\n`;
      timerComponents.forEach(comp => {
        code += `uint16_t ${presetTimerStateNames(comp.id).legacyCount} = 0;\n`;
      });
      code += `\n`;
    }

    if (this.needsBoundaryHelper) {
      code += this.generateBoundaryHelper();
    }

    code += `// Event callback function implementations\n\n`;

    // Collect unified event callback implementations (all events except onMessage)
    const eventCallbackImpls = this.collectEventCallbackImpls(existingFunctions);
    eventCallbackImpls.forEach(impl => {
      code += impl + '\n\n';
    });

    // Collect onMessage callback implementations (skip existing ones)
    const messageImpls = this.collectMessageCallbackImpls(existingFunctions);
    messageImpls.forEach(impl => {
      code += impl + '\n\n';
    });

    // Generate time update callbacks
    const timeUpdateImpls = this.collectTimeUpdateCallbackImpls();
    timeUpdateImpls.forEach(impl => {
      code += impl + '\n\n';
    });

    // Emit the preset timer callback implementations collected above
    if (timerCallbackImpls.length > 0) {
      code += `// Preset timer callback functions\n\n`;
      timerCallbackImpls.forEach(impl => {
        code += impl + '\n\n';
      });
    }

    // Generate toggle button state callbacks
    const toggleButtonImpls = this.collectToggleButtonCallbackImpls();
    if (toggleButtonImpls.length > 0) {
      code += `// Toggle button state callback functions\n\n`;
      toggleButtonImpls.forEach(impl => {
        code += impl + '\n';
      });
    }

    code += `/* @protected start custom_functions */
// Custom functions
/* @protected end custom_functions */
`;

    return code;
  }

  /**
   * Extract existing function names from the custom_functions protected area
   */
  private extractFunctionNamesFromProtectedArea(content: string): Set<string> {
    const functionNames = new Set<string>();
    
    // Extract custom_functions protected area content
    const regex = /\/\* @protected start custom_functions \*\/([\s\S]*?)\/\* @protected end custom_functions \*\//;
    const match = content.match(regex);
    
    if (match && match[1]) {
      const protectedContent = match[1];
      
      // Match function definitions: void function_name(...) or static void function_name(...)
      const funcRegex = /(?:static\s+)?void\s+(\w+)\s*\(/g;
      let funcMatch;
      
      while ((funcMatch = funcRegex.exec(protectedContent)) !== null) {
        functionNames.add(funcMatch[1]);
      }
    }
    
    return functionNames;
  }

  /**
   * Extract custom function declarations from the custom_functions protected area in callbacks.c
   * Returns an array of function declarations (without function bodies)
   */
  private extractCustomFunctionDeclarations(content: string): string[] {
    const declarations: string[] = [];
    
    // Extract custom_functions protected area content
    const regex = /\/\* @protected start custom_functions \*\/([\s\S]*?)\/\* @protected end custom_functions \*\//;
    const match = content.match(regex);
    
    if (!match || !match[1]) {
      return declarations;
    }
    
    const protectedContent = match[1];
    
    // Match function definitions (including static)
    // Support multiple return types: void, int, char*, gui_obj_t*, etc.
    const funcRegex = /((?:static\s+)?(?:void|int|char\s*\*|gui_obj_t\s*\*|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|bool)\s+\w+\s*\([^)]*\))/g;
    let funcMatch;
    
    while ((funcMatch = funcRegex.exec(protectedContent)) !== null) {
      const declaration = funcMatch[1].trim();
      
      // Skip static functions (no header declaration needed)
      if (declaration.startsWith('static ')) {
        continue;
      }
      
      declarations.push(declaration);
    }
    
    return declarations;
  }

  /**
   * Collect all callback function names to be generated
   */
  collectCallbackFunctions(): string[] {
    const functions = new Set<string>();

    // Use allComponents instead of components to include all nested components
    this.allComponents.forEach(component => {
      const generator = EventGeneratorFactory.getGenerator(component.type);
      generator.collectCallbackFunctions(component).forEach(fn => functions.add(fn));
    });

    return Array.from(functions).sort();
  }

  /**
   * Collect all unified event callback implementations (all events except onMessage)
   * @param existingFunctions Set of existing function names (extracted from custom_functions protected area)
   */
  private collectEventCallbackImpls(existingFunctions: Set<string> = new Set()): string[] {
    const impls = new Map<string, string>(); // Use Map for deduplication, keyed by function name

    this.allComponents.forEach(component => {
      const generator = EventGeneratorFactory.getGenerator(component.type);
      
      // Collect regular event callback implementations
      if (generator.getEventCallbackImpl) {
        generator.getEventCallbackImpl(component, this.componentMap).forEach(impl => {
          // Extract function name as key
          const match = impl.match(/void\s+(\w+)\s*\(/);
          if (match) {
            const funcName = match[1];
            // Skip functions already in the custom_functions protected area
            if (!existingFunctions.has(funcName)) {
              impls.set(funcName, impl);
            }
          }
        });
      }
      
      // Collect key event callback implementations
      if (generator.getKeyEventCallbackImpl) {
        generator.getKeyEventCallbackImpl(component, this.componentMap).forEach(impl => {
          // Extract function name as key
          const match = impl.match(/void\s+(\w+)\s*\(/);
          if (match) {
            const funcName = match[1];
            // Skip functions already in the custom_functions protected area
            if (!existingFunctions.has(funcName)) {
              impls.set(funcName, impl);
            }
          }
        });
      }
    });

    return Array.from(impls.values());
  }

  /**
   * Collect all onMessage callback implementations
   * @param existingFunctions Set of existing function names (extracted from custom_functions protected area)
   */
  private collectMessageCallbackImpls(existingFunctions: Set<string> = new Set()): string[] {
    const impls = new Map<string, string>(); // Use Map for deduplication, keyed by function name

    this.allComponents.forEach(component => {
      const generator = EventGeneratorFactory.getGenerator(component.type);
      if (generator.getMessageCallbackImpl) {
        generator.getMessageCallbackImpl(component, this.componentMap).forEach(impl => {
          // Extract function name as key
          const match = impl.match(/void\s+(\w+)\s*\(/);
          if (match) {
            const funcName = match[1];
            // Skip functions already in the custom_functions protected area
            if (!existingFunctions.has(funcName)) {
              impls.set(funcName, impl);
            }
          }
        });
      }
    });

    return Array.from(impls.values());
  }

  /**
   * Collect all onMessage callback function names
   */
  private collectMessageCallbackNames(): string[] {
    const names: string[] = [];

    this.allComponents.forEach(component => {
      if (!component.eventConfigs) return;
      let msgIndex = 0;
      component.eventConfigs.forEach(eventConfig => {
        if (eventConfig.type === 'onMessage' && eventConfig.message) {
          names.push(getMessageCallbackName(component, eventConfig, msgIndex));
          msgIndex++;
        }
      });
    });

    return names;
  }

  /**
   * Collect all time update callback implementations
   */
  private collectTimeUpdateCallbackImpls(): string[] {
    const impls = new Map<string, string>(); // Use Map for deduplication, keyed by function name

    // Time label update callbacks
    this.allComponents.forEach(component => {
      if (component.type === 'hg_time_label') {
        const timeFormat = component.data?.timeFormat || 'HH:mm:ss';
        const funcName = `${component.id}_time_update_cb`;
        const impl = this.generateTimeUpdateCallback(component.id, timeFormat);
        impls.set(funcName, impl);
      }
    });

    // Timer label update callbacks
    this.allComponents.forEach(component => {
      if (component.type === 'hg_label' && component.data?.isTimerLabel === true) {
        const timerFormat = component.data?.timerFormat || 'HH:MM:SS';
        const timerType = component.data?.timerType || 'stopwatch';
        const funcName = `${component.id}_timer_update_cb`;
        const impl = this.generateTimerUpdateCallback(component.id, timerFormat, timerType);
        impls.set(funcName, impl);
      }
    });

    return Array.from(impls.values());
  }

  /**
   * Collect all time update callback function names
   */
  private collectTimeUpdateCallbackNames(): string[] {
    const names: string[] = [];

    this.allComponents.forEach(component => {
      if (component.type === 'hg_time_label') {
        names.push(`${component.id}_time_update_cb`);
      }
      // Timer label update callbacks
      if (component.type === 'hg_label' && component.data?.isTimerLabel === true) {
        names.push(`${component.id}_timer_update_cb`);
      }
    });

    return names;
  }

  /**
   * Collect all user-configured timer callback function names
   */
  private collectTimerCallbackNames(): string[] {
    const names = new Set<string>();

    this.allComponents.forEach(component => {
      // Support new timers array format
      if (component.data?.timers && Array.isArray(component.data.timers)) {
        component.data.timers.forEach((timer: any) => {
          // Preset action mode: supports segments (multi-segment) or actions (single-segment)
          if (timer.mode === 'preset' && ((timer.segments && timer.segments.length > 0) || (timer.actions && timer.actions.length > 0))) {
            // Preset action mode: generate callback name using timer ID
            names.add(`${component.id}_${timer.id}_cb`);
          } else if (timer.mode === 'custom' && timer.callback) {
            // Custom function mode
            names.add(timer.callback);
          }
        });
      }
      // Backward compatible with legacy single timer format
      else if (component.data?.timerEnabled === true) {
        const timerMode = component.data.timerMode || 'custom';
        
        if (timerMode === 'preset' && component.data.timerActions && component.data.timerActions.length > 0) {
          // Preset action mode: use auto-generated callback name
          names.add(`${component.id}_preset_timer_cb`);
        } else if (timerMode === 'custom' && component.data.timerCallback) {
          // Custom function mode
          names.add(component.data.timerCallback);
        }
      }
    });

    return Array.from(names);
  }

  /**
   * Collect all user-configured timer callback implementations
   * @param existingFunctions Set of existing function names (extracted from custom_functions protected area)
   */
  private collectTimerCallbackImpls(existingFunctions: Set<string> = new Set()): string[] {
    const impls = new Map<string, string>();

    this.allComponents.forEach(component => {
      // Support new timers array format
      if (component.data?.timers && Array.isArray(component.data.timers)) {
        component.data.timers.forEach((timer: any) => {
          // Preset action mode: supports segments (multi-segment) or actions (single-segment)
          if (timer.mode === 'preset' && ((timer.segments && timer.segments.length > 0) || (timer.actions && timer.actions.length > 0))) {
            // Preset action mode: generate auto-implemented callback function
            const callback = `${component.id}_${timer.id}_cb`;
            if (!impls.has(callback)) {
              const impl = this.generatePresetTimerCallbackFromConfig(component, timer);
              impls.set(callback, impl);
            }
          } else if (timer.mode === 'custom' && timer.callback) {
            // Custom function mode: generate callback invoking protected area implementation
            const callback = timer.callback;
            // Skip functions already in the custom_functions protected area
            if (!impls.has(callback) && !existingFunctions.has(callback)) {
              const timerName = timer.name || timer.id;
              const implFuncName = `${callback}_impl`;
              const impl = `/**
 * ${timerName}
 * Component: ${component.id}
 */
void ${callback}(void *obj)
{
    GUI_UNUSED(obj);
    // Call the implementation function in protected area (if exists)
    // Define ${implFuncName}() in custom_functions protected area for custom logic
#ifdef __cplusplus
    extern "C" {
#endif
    extern void ${implFuncName}(void) __attribute__((weak));
#ifdef __cplusplus
    }
#endif
    
    if (${implFuncName}) {
        ${implFuncName}();
    } else {
        // TODO: Implement timer callback logic
        // Or define ${implFuncName}() in custom_functions protected area
    }
}`;
              impls.set(callback, impl);
            }
          }
        });
      }
      // Backward compatible with legacy single timer format
      else if (component.data?.timerEnabled === true) {
        const timerMode = component.data.timerMode || 'custom';
        
        if (timerMode === 'preset' && component.data.timerActions && component.data.timerActions.length > 0) {
          // Preset action mode: generate auto-implemented callback function
          const callback = `${component.id}_preset_timer_cb`;
          if (!impls.has(callback)) {
            const impl = this.generatePresetTimerCallback(component);
            impls.set(callback, impl);
          }
        } else if (timerMode === 'custom' && component.data.timerCallback) {
          // Custom function mode: generate callback invoking protected area implementation
          const callback = component.data.timerCallback;
          // Skip functions already in the custom_functions protected area
          if (!impls.has(callback) && !existingFunctions.has(callback)) {
            const implFuncName = `${callback}_impl`;
            const impl = `void ${callback}(void *obj)
{
    GUI_UNUSED(obj);
    // Call the implementation function in protected area (if exists)
    // Define ${implFuncName}() in custom_functions protected area for custom logic
#ifdef __cplusplus
    extern "C" {
#endif
    extern void ${implFuncName}(void) __attribute__((weak));
#ifdef __cplusplus
    }
#endif
    
    if (${implFuncName}) {
        ${implFuncName}();
    } else {
        // TODO: Implement timer callback logic
        // Or define ${implFuncName}() in custom_functions protected area
    }
}`;
            impls.set(callback, impl);
          }
        }
      }
    });

    return Array.from(impls.values());
  }

  /**
   * Generate the preset callback for the legacy `timerActions` / `timerDuration` format
   */
  private generatePresetTimerCallback(component: Component): string {
    return this.emitPresetTimerCallback(
      component,
      `${component.id}_preset_timer_cb`,
      undefined,
      normalizeLegacyTimerSegments(component),
      component.data?.timerStopOnComplete !== false,
      false
    );
  }

  /**
   * Generate the preset callback for a `TimerConfig` (single or multi-segment)
   */
  private generatePresetTimerCallbackFromConfig(component: Component, timer: any): string {
    return this.emitPresetTimerCallback(
      component,
      `${component.id}_${timer.id}_cb`,
      timer.name || timer.id,
      normalizeTimerConfigSegments(timer),
      timer.stopOnComplete !== false,
      timer.enableLog === true
    );
  }

  /**
   * Generate the file-local segment entry helper.
   *
   * A boundary counts as crossed when it lies inside the half-open interval
   * (prev_ms, now_ms]. Both ends are phases within a single cycle, so boundaries
   * from earlier cycles cannot be replayed; `cycle_skipped` covers the case where
   * one callback gap swallowed one or more whole cycles.
   */
  private generateBoundaryHelper(): string {
    return `// Was the segment boundary at at_ms crossed within (prev_ms, now_ms]?
static bool ${BOUNDARY_HELPER_NAME}(uint32_t at_ms, uint32_t prev_ms, uint32_t now_ms, bool cycle_wrapped, bool cycle_skipped)
{
    if (cycle_skipped)
    {
        // At least one whole cycle elapsed since the previous sample
        return true;
    }
    if (cycle_wrapped)
    {
        return (at_ms > prev_ms) || (at_ms <= now_ms);
    }
    return (at_ms > prev_ms) && (at_ms <= now_ms);
}

`;
  }

  /**
   * Emit a preset animation callback driven by real elapsed time.
   *
   * `gui_obj_timer_handler()` only promises an upper bound on callback frequency,
   * so animation state is sampled from `gui_ms_get()` instead of accumulated per
   * callback. A dropped callback then only lowers the visual sampling density:
   * every callback recomputes the state as a pure function of elapsed time, so the
   * animation still reaches its endpoint at the configured wall-clock time.
   */
  private emitPresetTimerCallback(
    component: Component,
    callback: string,
    timerName: string | undefined,
    rawSegments: NormalizedSegment[],
    stopOnComplete: boolean,
    enableLog: boolean
  ): string {
    const state = presetTimerStateNames(component.id);
    const { segments, starts, ends, totalDuration } = buildPresetTimeline(rawSegments);

    let doc = `/**\n`;
    if (timerName) {
      doc += ` * ${timerName}\n`;
    }
    doc += ` * Component: ${component.id}\n`;
    doc += ` * Mode: Preset actions, driven by real elapsed time (gui_ms_get)\n`;
    doc += ` * Timeline: ${segments.length} segment(s), ${totalDuration} ms total, ${stopOnComplete ? 'one-shot' : 'looping'}\n`;
    doc += ` */\n`;

    // Degenerate timeline: there is no duration to interpolate over. Apply the
    // final state once and stop, so no generated expression divides or mods by 0.
    if (totalDuration === 0) {
      let code = doc;
      code += `void ${callback}(void *obj)\n{\n`;
      code += `    gui_obj_t *target = (gui_obj_t *)obj;\n`;
      code += `    \n`;
      code += `    // Total duration is 0 ms: apply the final state once, then stop\n`;
      code += `    ${state.started} = true;\n`;
      code += `    ${state.startMs} = gui_ms_get();\n`;
      code += `    ${state.prevElapsedMs} = 0;\n`;
      code += `    \n`;
      segments.forEach(segment => {
        segment.actions.forEach(action => {
          code += this.generateActionCode(action, '1.0f', component);
        });
      });
      code += `    gui_obj_stop_timer(target);\n`;
      code += `}\n`;
      return code;
    }

    const classified = segments.map((segment, idx) => {
      // A 0 ms segment is an instantaneous boundary: everything it carries,
      // including otherwise interpolated actions, applies at its endpoint value.
      const instantaneous = segment.duration === 0;
      return {
        idx,
        duration: segment.duration,
        start: starts[idx],
        end: ends[idx],
        boundaryActions: instantaneous ? segment.actions : segment.actions.filter(a => isBoundaryAction(a)),
        sampledActions: instantaneous ? [] : segment.actions.filter(a => !isBoundaryAction(a)),
      };
    });

    const boundarySegments = classified.filter(s => s.boundaryActions.length > 0);
    // Every segment with a real duration stays in the locator chain, even when it
    // has no sampled action, so the branches remain mutually exclusive.
    const chain = classified.filter(s => s.duration > 0);
    const chainHasWork = chain.some(s => s.sampledActions.length > 0);
    const needsBoundary = boundarySegments.length > 0;
    const needsFirstSample = boundarySegments.some(s => s.start === 0);
    const needsTimeline = needsBoundary || chainHasWork || enableLog;

    if (needsBoundary) {
      this.needsBoundaryHelper = true;
    }

    // ---- timeline setup ---------------------------------------------------
    let statements = '';
    // Deprecated compatibility: user/ code (including shipped templates) rewinds
    // an animation by assigning 0 to the old counter. Honour that here, before the
    // time origin is established, so the animation replays from its start.
    statements += `    // Deprecated: <id>_timer_cnt = 0 from user code requests a restart\n`;
    statements += `    if (${state.legacyCount} == 0)\n`;
    statements += `    {\n`;
    statements += `        ${state.resetFn}();\n`;
    statements += `    }\n`;
    statements += `    ${state.legacyCount} = 1;\n`;
    statements += `    \n`;
    statements += `    uint32_t now_ms = gui_ms_get();\n`;
    if (needsFirstSample) {
      statements += `    bool first_sample = false;\n`;
    }
    statements += `    \n`;
    statements += `    // The time origin is established by the first callback of a run\n`;
    statements += `    if (!${state.started})\n`;
    statements += `    {\n`;
    statements += `        ${state.started} = true;\n`;
    statements += `        ${state.startMs} = now_ms;\n`;
    statements += `        ${state.prevElapsedMs} = 0;\n`;
    if (needsFirstSample) {
      statements += `        first_sample = true;\n`;
    }
    statements += `    }\n`;
    statements += `    \n`;
    statements += `    // Unsigned subtraction stays correct across uint32_t clock wrap\n`;
    statements += `    uint32_t total_elapsed_ms = now_ms - ${state.startMs};\n`;
    if (needsBoundary) {
      statements += `    uint32_t prev_elapsed_ms = ${state.prevElapsedMs};\n`;
    }
    // Publish the new sample before running actions: switchTimer returns early.
    statements += `    ${state.prevElapsedMs} = total_elapsed_ms;\n`;
    statements += `    \n`;

    if (stopOnComplete) {
      statements += `    // One-shot: clamp the timeline so the last sample lands on the endpoint\n`;
      statements += `    bool finished = (total_elapsed_ms >= total_duration_ms);\n`;
      if (needsTimeline) {
        statements += `    uint32_t timeline_ms = finished ? total_duration_ms : total_elapsed_ms;\n`;
      }
    } else if (needsTimeline) {
      statements += `    // Loop against the original origin so frame error cannot accumulate\n`;
      statements += `    uint32_t timeline_ms = total_elapsed_ms % total_duration_ms;\n`;
    }

    if (needsBoundary) {
      if (stopOnComplete) {
        statements += `    uint32_t prev_timeline_ms = (prev_elapsed_ms > total_duration_ms) ? total_duration_ms : prev_elapsed_ms;\n`;
      } else {
        statements += `    uint32_t prev_timeline_ms = prev_elapsed_ms % total_duration_ms;\n`;
        statements += `    bool cycle_skipped = (total_elapsed_ms - prev_elapsed_ms) >= total_duration_ms;\n`;
        statements += `    bool cycle_wrapped = cycle_skipped || (timeline_ms < prev_timeline_ms);\n`;
      }
    }

    if (enableLog) {
      statements += `    gui_log("${callback}: elapsed=%u timeline=%u\\n", (unsigned int)total_elapsed_ms, (unsigned int)timeline_ms);\n`;
    }
    statements += `    \n`;

    // ---- segment entry actions -------------------------------------------
    if (needsBoundary) {
      const wrappedArg = stopOnComplete ? 'false' : 'cycle_wrapped';
      const skippedArg = stopOnComplete ? 'false' : 'cycle_skipped';
      statements += `    // Segment entry actions: fire once per entry, not once per frame\n`;
      boundarySegments.forEach(segment => {
        const crossed = `${BOUNDARY_HELPER_NAME}(seg${segment.idx}_start_ms, prev_timeline_ms, timeline_ms, ${wrappedArg}, ${skippedArg})`;
        // A boundary at offset 0 never falls inside (prev, now]; the first sample
        // of a run has to trigger it explicitly.
        const condition = segment.start === 0 ? `first_sample || ${crossed}` : crossed;
        statements += `    if (${condition})\n`;
        statements += `    {\n`;
        statements += `        // Segment ${segment.idx + 1}${segment.duration === 0 ? ' (0 ms boundary)' : ''}\n`;
        segment.boundaryActions.forEach(action => {
          statements += CallbackFileGenerator.indentBlock(this.generateActionCode(action, '1.0f', component), 4);
        });
        statements += `    }\n`;
        statements += `    \n`;
      });
    }

    // ---- sampled state of the current segment ----------------------------
    if (chainHasWork) {
      statements += `    // Sampled state of the segment the timeline is currently inside\n`;
      if (chain.length === 1) {
        const segment = chain[0];
        statements += `    // Segment ${segment.idx + 1}: ${segment.duration} ms\n`;
        statements += this.generateProgressCode(segment.idx, 4, true);
        segment.sampledActions.forEach(action => {
          statements += this.generateActionCode(action, 'progress', component);
        });
      } else {
        chain.forEach((segment, chainIdx) => {
          const isLast = chainIdx === chain.length - 1;
          if (chainIdx === 0) {
            statements += `    if (timeline_ms < seg${segment.idx}_end_ms)\n`;
          } else if (isLast) {
            statements += `    else\n`;
          } else {
            statements += `    else if (timeline_ms < seg${segment.idx}_end_ms)\n`;
          }
          statements += `    {\n`;
          statements += `        // Segment ${segment.idx + 1}: ${segment.duration} ms\n`;
          if (segment.sampledActions.length === 0) {
            statements += `        // No sampled action, this segment only takes time\n`;
          } else {
            statements += this.generateProgressCode(segment.idx, 8, isLast);
            segment.sampledActions.forEach(action => {
              statements += CallbackFileGenerator.indentBlock(this.generateActionCode(action, 'progress', component), 4);
            });
          }
          statements += `    }\n`;
        });
      }
      statements += `    \n`;
    }

    if (stopOnComplete) {
      statements += `    if (finished)\n`;
      statements += `    {\n`;
      statements += `        gui_obj_stop_timer(target);\n`;
      statements += `    }\n`;
    }

    // ---- assemble ---------------------------------------------------------
    // Only declare boundary constants that the body actually reads: the
    // simulation build compiles generated code with -Werror=unused-variable.
    const constCandidates: Array<[string, number]> = [['total_duration_ms', totalDuration]];
    classified.forEach(segment => {
      constCandidates.push([`seg${segment.idx}_start_ms`, segment.start]);
      constCandidates.push([`seg${segment.idx}_end_ms`, segment.end]);
    });

    let constBlock = '';
    constCandidates.forEach(([name, value]) => {
      if (new RegExp(`\\b${name}\\b`).test(statements)) {
        constBlock += `    const uint32_t ${name} = ${value}u;\n`;
      }
    });
    if (constBlock) {
      constBlock = `    // Timeline boundaries in real milliseconds\n${constBlock}    \n`;
    }

    let code = doc;
    code += `void ${callback}(void *obj)\n{\n`;
    code += /\btarget\b/.test(statements)
      ? `    gui_obj_t *target = (gui_obj_t *)obj;\n`
      : `    GUI_UNUSED(obj);\n`;
    code += `    \n`;
    code += constBlock;
    code += statements;
    code += `}\n`;

    return code;
  }

  /**
   * Generate the normalized progress of one segment from the current timeline
   * position. `clamp` is needed wherever the timeline can land exactly on the
   * segment end, which happens on the final sample of a one-shot animation.
   */
  private generateProgressCode(segmentIdx: number, indent: number, clamp: boolean): string {
    const pad = ' '.repeat(indent);
    const start = `seg${segmentIdx}_start_ms`;
    const end = `seg${segmentIdx}_end_ms`;
    let code = `${pad}float progress = (float)(timeline_ms - ${start}) / (float)(${end} - ${start});\n`;
    if (clamp) {
      code += `${pad}if (progress > 1.0f)\n`;
      code += `${pad}{\n`;
      code += `${pad}    progress = 1.0f;\n`;
      code += `${pad}}\n`;
    }
    return code;
  }

  /**
   * Add `extra` spaces of indentation to every non-empty line of a code block
   */
  private static indentBlock(code: string, extra: number): string {
    if (extra <= 0) {
      return code;
    }
    const pad = ' '.repeat(extra);
    return code.split('\n').map(line => (line.trim() ? pad + line : line)).join('\n');
  }

  /**
   * Generate code for a single action
   * @param progressExpr Normalized progress in [0, 1] as a C float expression
   */
  private generateActionCode(action: any, progressExpr: string, component?: Component): string {
    let code = '';

    if (action.type === 'visibility') {
      // Set visibility action
      const visible = action.visible !== false; // Defaults to true
      code += `    // Set visibility: ${visible ? 'show' : 'hide'}\n`;
      code += `    gui_obj_hidden(target, ${visible ? 'false' : 'true'});\n`;
      code += `    \n`;
    } else if (action.type === 'changeImage') {
      // Change image action (hg_image only)
      let imagePath = action.imagePath || '';
      // Strip assets/ prefix, keep remaining path
      if (imagePath.startsWith('assets/')) {
        imagePath = imagePath.substring(6); // Remove 'assets/' prefix
      }
      // Change file extension to .bin
      if (imagePath && !imagePath.endsWith('.bin')) {
        imagePath = imagePath.replace(/\.[^.]+$/, '.bin');
      }
      code += `    // Change image: ${imagePath}\n`;
      code += `    gui_img_set_src((gui_img_t *)target, (const uint8_t *)"${imagePath}", IMG_SRC_FILESYS);\n`;
      code += `    gui_img_refresh_size((gui_img_t *)target);\n`;
      code += `    \n`;
    } else if (action.type === 'imageSequence') {
      // Image sequence action (hg_image only)
      const imageSequence = action.imageSequence || [];
      if (imageSequence.length > 0) {
        // Process image paths: strip assets/ prefix, change extension to .bin
        const processedPaths = imageSequence.map((path: string) => {
          let processed = path;
          if (processed.startsWith('assets/')) {
            processed = processed.substring(6);
          }
          if (processed && !processed.endsWith('.bin')) {
            processed = processed.replace(/\.[^.]+$/, '.bin');
          }
          return processed;
        });
        
        code += `    // Image sequence animation: ${processedPaths.length} images\n`;
        code += `    const void *img_data_array[${processedPaths.length}] = {\n`;
        processedPaths.forEach((path: string, idx: number) => {
          code += `        "${path}"${idx < processedPaths.length - 1 ? ',' : ''}\n`;
        });
        code += `    };\n`;
        code += `    uint16_t index = (uint16_t)((${processedPaths.length} - 1) * ${progressExpr});\n`;
        code += `    if (index >= ${processedPaths.length})\n`;
        code += `    {\n`;
        code += `        index = ${processedPaths.length} - 1;\n`;
        code += `    }\n`;
        code += `    gui_img_set_src((gui_img_t *)target, (const uint8_t *)img_data_array[index], IMG_SRC_FILESYS);\n`;
        code += `    gui_img_refresh_size((gui_img_t *)target);\n`;
        code += `    \n`;
      }
    } else if (action.type === 'switchView') {
      // Switch view action
      const targetName = action.target || 'unknown_view';
      const switchOutStyle = action.switchOutStyle || 'SWITCH_OUT_TO_LEFT_USE_TRANSLATION';
      const switchInStyle = action.switchInStyle || 'SWITCH_IN_FROM_RIGHT_USE_TRANSLATION';
      code += `    // Switch view: ${targetName}\n`;
      code += `    gui_view_switch_direct(gui_view_get_current(), "${targetName}", ${switchOutStyle}, ${switchInStyle});\n`;
      code += `    \n`;
    } else if (action.type === 'switchTimer') {
      // Timer toggle action (new: supports multiple timer controls)
      const timerTargets = action.timerTargets || [];
      
      // Backward compatible: convert timerId to timerTargets format if needed
      if (timerTargets.length === 0 && action.timerId) {
        timerTargets.push({
          timerId: action.timerId,
          action: 'start'
        });
      }
      
      if (timerTargets.length === 0) {
        code += `    // Warning: No timer control specified\n`;
        return code;
      }
      
      code += `    // Timer control\n`;
      
      for (const target of timerTargets) {
        const timerId = target.timerId;
        const timerAction = target.action;
        
        // Find target timer configuration
        const targetTimer = component?.data?.timers?.find((t: any) => t.id === timerId);
        if (!targetTimer) {
          code += `    // Warning: Timer animation ${timerId} not found\n`;
          continue;
        }
        
        const timerName = targetTimer.name || targetTimer.id;
        
        if (timerAction === 'start') {
          // Start timer
          // Generate callback function name
          let callback: string;
          if (targetTimer.mode === 'preset') {
            callback = `${component?.id}_${targetTimer.id}_cb`;
          } else if (targetTimer.mode === 'custom' && targetTimer.callback) {
            callback = targetTimer.callback;
          } else {
            code += `    // Warning: Timer animation ${timerId} configuration invalid\n`;
            continue;
          }
          
          const isPreset = targetTimer.mode === 'preset';
          code += `    // Start timer animation: ${timerName}\n`;
          if (isPreset) {
            // Restart from the beginning of the animation timeline
            code += `    ${presetTimerStateNames(component!.id).resetFn}();\n`;
          }
          // A preset animation needs many callbacks to finish, so the underlying
          // timer always reloads; stopOnComplete decides one-shot vs looping.
          const reload = isPreset ? 'true' : (targetTimer.reload !== false ? 'true' : 'false');
          code += `    gui_obj_create_timer(target, ${targetTimer.interval}, ${reload}, ${callback});\n`;
          // Call gui_obj_start_timer if the target timer is not set to run immediately
          if (!targetTimer.runImmediately) {
            code += `    gui_obj_start_timer(target);\n`;
          }
        } else if (timerAction === 'stop') {
          // Stop timer
          code += `    // Stop timer animation: ${timerName}\n`;
          code += `    gui_obj_stop_timer(target);\n`;
        }
      }
      
      code += `    return; // Return immediately after timer control\n`;
      code += `    \n`;
    } else if (action.type === 'position') {
      // Position adjustment action
      code += `    // Adjust position: (${action.fromX}, ${action.fromY}) -> (${action.toX}, ${action.toY})\n`;
      code += `    const int16_t x_origin = ${action.fromX};\n`;
      code += `    const int16_t y_origin = ${action.fromY};\n`;
      code += `    const int16_t x_target = ${action.toX};\n`;
      code += `    const int16_t y_target = ${action.toY};\n`;
      code += `    int16_t x_cur = (int16_t)(x_origin + (x_target - x_origin) * ${progressExpr});\n`;
      code += `    int16_t y_cur = (int16_t)(y_origin + (y_target - y_origin) * ${progressExpr});\n`;
      code += `    gui_obj_move(target, x_cur, y_cur);\n`;
      code += `    \n`;
    } else if (action.type === 'size') {
      // Size adjustment action (hg_window only)
      code += `    // Adjust size: (${action.fromW}, ${action.fromH}) -> (${action.toW}, ${action.toH})\n`;
      code += `    const int16_t w_origin = ${action.fromW};\n`;
      code += `    const int16_t h_origin = ${action.fromH};\n`;
      code += `    const int16_t w_target = ${action.toW};\n`;
      code += `    const int16_t h_target = ${action.toH};\n`;
      code += `    int16_t w_cur = (int16_t)(w_origin + (w_target - w_origin) * ${progressExpr});\n`;
      code += `    int16_t h_cur = (int16_t)(h_origin + (h_target - h_origin) * ${progressExpr});\n`;
      code += `    target->w = w_cur;\n`;
      code += `    target->h = h_cur;\n`;
      code += `    \n`;
    } else if (action.type === 'opacity') {
      // Opacity adjustment action
      code += `    // Adjust opacity: ${action.from} -> ${action.to}\n`;
      code += `    const uint8_t opacity_origin = ${action.from};\n`;
      code += `    const uint8_t opacity_target = ${action.to};\n`;
      code += `    int16_t opacity_cur = (int16_t)(opacity_origin + (opacity_target - opacity_origin) * ${progressExpr});\n`;
      // hg_image uses gui_img_set_opacity, other components use target->opacity_value
      if (component?.type === 'hg_image') {
        code += `    gui_img_set_opacity((gui_img_t *)target, opacity_cur);\n`;
      } else {
        code += `    target->opacity_value = opacity_cur;\n`;
      }
      code += `    \n`;
    } else if (action.type === 'rotation') {
      // Rotation adjustment action (hg_image only)
      code += `    // Adjust rotation: ${action.angleOrigin}° -> ${action.angleTarget}°\n`;
      code += `    const float angle_origin = ${action.angleOrigin};\n`;
      code += `    const float angle_target = ${action.angleTarget};\n`;
      code += `    float angle_cur = angle_origin + (angle_target - angle_origin) * ${progressExpr};\n`;
      code += `    gui_img_rotation((gui_img_t *)target, angle_cur);\n`;
      code += `    \n`;
    } else if (action.type === 'scale') {
      // Scale adjustment action (hg_image only)
      code += `    // Adjust scale: (${action.zoomXOrigin}, ${action.zoomYOrigin}) -> (${action.zoomXTarget}, ${action.zoomYTarget})\n`;
      code += `    const float zoom_x_origin = ${action.zoomXOrigin};\n`;
      code += `    const float zoom_x_target = ${action.zoomXTarget};\n`;
      code += `    const float zoom_y_origin = ${action.zoomYOrigin};\n`;
      code += `    const float zoom_y_target = ${action.zoomYTarget};\n`;
      code += `    float zoom_x_cur = zoom_x_origin + (zoom_x_target - zoom_x_origin) * ${progressExpr};\n`;
      code += `    float zoom_y_cur = zoom_y_origin + (zoom_y_target - zoom_y_origin) * ${progressExpr};\n`;
      code += `    gui_img_scale((gui_img_t *)target, zoom_x_cur, zoom_y_cur);\n`;
      code += `    \n`;
    } else if (action.type === 'fgColor') {
      // Foreground color adjustment action (hg_image only)
      if (action.fgColorFrom) {
        // Has initial value, calculate interpolation
        code += `    // Adjust foreground color: ${action.fgColorFrom} -> ${action.fgColorTo}\n`;
        code += `    const uint32_t fg_color_from = ${action.fgColorFrom};\n`;
        code += `    const uint32_t fg_color_to = ${action.fgColorTo};\n`;
        code += `    // Separate ARGB channels\n`;
        code += `    uint8_t a_from = (fg_color_from >> 24) & 0xFF;\n`;
        code += `    uint8_t r_from = (fg_color_from >> 16) & 0xFF;\n`;
        code += `    uint8_t g_from = (fg_color_from >> 8) & 0xFF;\n`;
        code += `    uint8_t b_from = fg_color_from & 0xFF;\n`;
        code += `    uint8_t a_to = (fg_color_to >> 24) & 0xFF;\n`;
        code += `    uint8_t r_to = (fg_color_to >> 16) & 0xFF;\n`;
        code += `    uint8_t g_to = (fg_color_to >> 8) & 0xFF;\n`;
        code += `    uint8_t b_to = fg_color_to & 0xFF;\n`;
        code += `    // Calculate current color\n`;
        code += `    uint8_t a_cur = (uint8_t)(a_from + (a_to - a_from) * ${progressExpr});\n`;
        code += `    uint8_t r_cur = (uint8_t)(r_from + (r_to - r_from) * ${progressExpr});\n`;
        code += `    uint8_t g_cur = (uint8_t)(g_from + (g_to - g_from) * ${progressExpr});\n`;
        code += `    uint8_t b_cur = (uint8_t)(b_from + (b_to - b_from) * ${progressExpr});\n`;
        code += `    uint32_t fg_color_cur = ((uint32_t)a_cur << 24) | ((uint32_t)r_cur << 16) | ((uint32_t)g_cur << 8) | b_cur;\n`;
        code += `    gui_img_a8_recolor((gui_img_t *)target, fg_color_cur);\n`;
      } else {
        // No initial value, set target value directly
        code += `    // Set foreground color: ${action.fgColorTo}\n`;
        code += `    gui_img_a8_recolor((gui_img_t *)target, ${action.fgColorTo});\n`;
      }
      code += `    \n`;
    } else if (action.type === 'bgColor') {
      // Background color adjustment action (hg_image only)
      if (action.bgColorFrom) {
        // Has initial value, calculate interpolation
        code += `    // Adjust background color: ${action.bgColorFrom} -> ${action.bgColorTo}\n`;
        code += `    const uint32_t bg_color_from = ${action.bgColorFrom};\n`;
        code += `    const uint32_t bg_color_to = ${action.bgColorTo};\n`;
        code += `    // Separate ARGB channels\n`;
        code += `    uint8_t a_from = (bg_color_from >> 24) & 0xFF;\n`;
        code += `    uint8_t r_from = (bg_color_from >> 16) & 0xFF;\n`;
        code += `    uint8_t g_from = (bg_color_from >> 8) & 0xFF;\n`;
        code += `    uint8_t b_from = bg_color_from & 0xFF;\n`;
        code += `    uint8_t a_to = (bg_color_to >> 24) & 0xFF;\n`;
        code += `    uint8_t r_to = (bg_color_to >> 16) & 0xFF;\n`;
        code += `    uint8_t g_to = (bg_color_to >> 8) & 0xFF;\n`;
        code += `    uint8_t b_to = bg_color_to & 0xFF;\n`;
        code += `    // Calculate current color\n`;
        code += `    uint8_t a_cur = (uint8_t)(a_from + (a_to - a_from) * ${progressExpr});\n`;
        code += `    uint8_t r_cur = (uint8_t)(r_from + (r_to - r_from) * ${progressExpr});\n`;
        code += `    uint8_t g_cur = (uint8_t)(g_from + (g_to - g_from) * ${progressExpr});\n`;
        code += `    uint8_t b_cur = (uint8_t)(b_from + (b_to - b_from) * ${progressExpr});\n`;
        code += `    uint32_t bg_color_cur = ((uint32_t)a_cur << 24) | ((uint32_t)r_cur << 16) | ((uint32_t)g_cur << 8) | b_cur;\n`;
        code += `    gui_img_a8_fix_bg((gui_img_t *)target, bg_color_cur);\n`;
      } else {
        // No initial value, set target value directly
        code += `    // Set background color: ${action.bgColorTo}\n`;
        code += `    gui_img_a8_fix_bg((gui_img_t *)target, ${action.bgColorTo});\n`;
      }
      code += `    \n`;
    } else if (action.type === 'setFocus') {
      // Set focus action (applies to all components)
      code += `    // Set focus\n`;
      code += `    gui_obj_focus_set(target);\n`;
      code += `    \n`;
    }
    
    return code;
  }

  /**
   * Check if tp_algo.h is needed (for touch release area detection)
   */
  private checkNeedsTpAlgo(): boolean {
    return this.allComponents.some(component => {
      if (!component.eventConfigs) return false;
      return component.eventConfigs.some(eventConfig => 
        eventConfig.type === 'onTouchUp' && eventConfig.checkReleaseArea === true
      );
    });
  }

  /**
   * Get buffer size for the specified time format
   */
  private getTimeBufferSize(timeFormat?: string): number {
    switch (timeFormat) {
      case 'HH:mm:ss': return 10;  // "HH:MM:SS\0" = 9
      case 'HH:mm': return 10;      // "HH:MM\0" = 6，with extra margin
      case 'HH': return 4;           // "HH\0" = 3，with extra margin
      case 'mm': return 4;           // "mm\0" = 3，with extra margin
      case 'HH:mm-split': return 10; // Split time format, same as HH:mm, needs access to str+3
      case 'YYYY-MM-DD': return 16; // "YYYY-MM-DD\0" = 11, extra margin for -Werror=format-overflow
      case 'YYYY-MM-DD HH:mm:ss': return 32; // "YYYY-MM-DD HH:MM:SS\0" = 20, extra margin for -Werror=format-overflow
      case 'MM-DD HH:mm': return 16; // "MM-DD HH:MM\0" = 13
      default: return 10;
    }
  }

  /**
   * Get buffer size for the specified timer format
   */
  private getTimerBufferSize(timerFormat?: string): number {
    switch (timerFormat) {
      case 'HH:MM:SS': return 10;  // "HH:MM:SS\0" = 9 + 1
      case 'MM:SS': return 6;      // "MM:SS\0" = 5 + 1
      case 'MM:SS:MS': return 10;  // "MM:SS:MS\0" = 9 + 1
      case 'SS': return 4;         // "SS\0" = 2 + 1
      default: return 10;
    }
  }

  /**
   * Generate time update callback function
   * Uses global variables to store time strings (consistent with SDK)
   */
  private generateTimeUpdateCallback(componentId: string, timeFormat: string): string {
    let formatStr = '';

    switch (timeFormat) {
      case 'HH:mm:ss':
        formatStr = '%02d:%02d:%02d';
        break;
      case 'HH:mm':
      case 'HH:mm-split':  // Split time format uses the same format string
        formatStr = '%02d:%02d';
        break;
      case 'HH':
        formatStr = '%02d';
        break;
      case 'mm':
        formatStr = '%02d';
        break;
      case 'YYYY-MM-DD':
        formatStr = '%04d-%02d-%02d';
        break;
      case 'YYYY-MM-DD HH:mm:ss':
        formatStr = '%04d-%02d-%02d %02d:%02d:%02d';
        break;
      case 'MM-DD HH:mm':
        formatStr = '%02d-%02d %02d:%02d';
        break;
      default:
        formatStr = '%02d:%02d:%02d';
    }

    let code = `void ${componentId}_time_update_cb(void *p)\n`;
    code += `{\n`;
    
    // Split time format requires special handling
    if (timeFormat === 'HH:mm-split') {
      code += `    GUI_UNUSED(p);\n`;
      code += `    \n`;
      code += `    time_t now = time(NULL);\n`;
      code += `    struct tm *t = localtime(&now);\n`;
      code += `    if (t == NULL)\n`;
      code += `    {\n`;
      code += `        return;\n`;
      code += `    }\n`;
      code += `    \n`;
      code += `    // Update time string\n`;
      code += `    snprintf(${componentId}_time_str, sizeof(${componentId}_time_str), "${formatStr}", t->tm_hour, t->tm_min);\n`;
      code += `    \n`;
      code += `    // Update hour component (first 2 characters)\n`;
      code += `    if (${componentId}_hour) {\n`;
      code += `        gui_text_content_set(${componentId}_hour, ${componentId}_time_str, 2);\n`;
      code += `    }\n`;
      code += `    \n`;
      code += `    // Update minute component (last 2 characters, skip colon)\n`;
      code += `    if (${componentId}_min) {\n`;
      code += `        gui_text_content_set(${componentId}_min, ${componentId}_time_str + 3, 2);\n`;
      code += `    }\n`;
    } else {
      // Standard time format handling
      code += `    GUI_UNUSED(p);\n`;
      code += `    \n`;
      code += `    time_t now = time(NULL);\n`;
      code += `    struct tm *t = localtime(&now);\n`;
      code += `    if (t == NULL)\n`;
      code += `    {\n`;
      code += `        return;\n`;
      code += `    }\n`;
      code += `    \n`;

      // Generate different snprintf calls based on format
      if (timeFormat === 'HH:mm:ss') {
        code += `    snprintf(${componentId}_time_str, sizeof(${componentId}_time_str), "${formatStr}", t->tm_hour, t->tm_min, t->tm_sec);\n`;
      } else if (timeFormat === 'HH:mm') {
        code += `    snprintf(${componentId}_time_str, sizeof(${componentId}_time_str), "${formatStr}", t->tm_hour, t->tm_min);\n`;
      } else if (timeFormat === 'HH') {
        code += `    snprintf(${componentId}_time_str, sizeof(${componentId}_time_str), "${formatStr}", t->tm_hour);\n`;
      } else if (timeFormat === 'mm') {
        code += `    snprintf(${componentId}_time_str, sizeof(${componentId}_time_str), "${formatStr}", t->tm_min);\n`;
      } else if (timeFormat === 'YYYY-MM-DD') {
        code += `    snprintf(${componentId}_time_str, sizeof(${componentId}_time_str), "${formatStr}", (t->tm_year + 1900) % 10000, t->tm_mon + 1, t->tm_mday);\n`;
      } else if (timeFormat === 'YYYY-MM-DD HH:mm:ss') {
        code += `    snprintf(${componentId}_time_str, sizeof(${componentId}_time_str), "${formatStr}", (t->tm_year + 1900) % 10000, t->tm_mon + 1, t->tm_mday, t->tm_hour, t->tm_min, t->tm_sec);\n`;
      } else if (timeFormat === 'MM-DD HH:mm') {
        code += `    snprintf(${componentId}_time_str, sizeof(${componentId}_time_str), "${formatStr}", t->tm_mon + 1, t->tm_mday, t->tm_hour, t->tm_min);\n`;
      }

      code += `    \n`;
      code += `    gui_text_content_set((gui_text_t *)${componentId}, ${componentId}_time_str, strlen(${componentId}_time_str));\n`;
    }
    
    code += `}`;

    return code;
  }

  /**
   * Generate timer update callback function
   * Used for stopwatch/countdown functionality
   * Based on stopwatch implementation, using millisecond-level counting
   */
  private generateTimerUpdateCallback(componentId: string, timerFormat: string, timerType: string): string {
    let formatStr = '';
    let formatLogic = '';

    // Generate formatting logic based on format (using millisecond counting)
    switch (timerFormat) {
      case 'HH:MM:SS':
        formatStr = '%02u:%02u:%02u';
        formatLogic = `sprintf(${componentId}_timer_str, "${formatStr}", 
           (${componentId}_timer_value / 3600000),
           (${componentId}_timer_value % 3600000) / 60000,
           (${componentId}_timer_value % 60000) / 1000);`;
        break;
      case 'MM:SS':
        formatStr = '%02u:%02u';
        formatLogic = `sprintf(${componentId}_timer_str, "${formatStr}", 
           (${componentId}_timer_value / 60000),
           (${componentId}_timer_value % 60000) / 1000);`;
        break;
      case 'MM:SS:MS':
        formatStr = '%02u:%02u:%02u';
        formatLogic = `sprintf(${componentId}_timer_str, "${formatStr}", 
           (${componentId}_timer_value / 60000),
           (${componentId}_timer_value % 60000) / 1000,
           (${componentId}_timer_value % 1000) / 10);`;
        break;
      case 'SS':
        formatStr = '%02u';
        formatLogic = `sprintf(${componentId}_timer_str, "${formatStr}", 
           (${componentId}_timer_value / 1000));`;
        break;
      default:
        formatStr = '%02u:%02u:%02u';
        formatLogic = `sprintf(${componentId}_timer_str, "${formatStr}", 
           (${componentId}_timer_value / 3600000),
           (${componentId}_timer_value % 3600000) / 60000,
           (${componentId}_timer_value % 60000) / 1000);`;
    }

    let code = `/**\n`;
    code += ` * Timer update callback function\n`;
    code += ` * Type: ${timerType === 'stopwatch' ? 'Stopwatch (count up)' : 'Countdown (count down)'}\n`;
    code += ` * Format: ${timerFormat}\n`;
    code += ` * Note: timer_value is in milliseconds, timer interval should be set to 10-100ms\n`;
    code += ` */\n`;
    code += `void ${componentId}_timer_update_cb(void *p)\n`;
    code += `{\n`;
    code += `    GUI_UNUSED(p);\n`;
    code += `    \n`;
    
    if (timerType === 'stopwatch') {
      // Stopwatch: based on stopwatch implementation
      code += `    // Stopwatch: increment time on each call (assuming timer interval is 10ms)\n`;
      code += `    ${componentId}_timer_value += 10;\n`;
    } else {
      // Countdown: decrement time on each call
      code += `    // Countdown: decrement time on each call (assuming timer interval is 10ms)\n`;
      code += `    if (${componentId}_timer_value > 10) {\n`;
      code += `        ${componentId}_timer_value -= 10;\n`;
      code += `    } else {\n`;
      code += `        ${componentId}_timer_value = 0;\n`;
      code += `        // Countdown finished, you can stop the timer here\n`;
      code += `        // gui_obj_stop_timer((gui_obj_t *)${componentId});\n`;
      code += `    }\n`;
    }
    
    code += `    \n`;
    code += `    // Format timer string\n`;
    code += `    ${formatLogic}\n`;
    code += `    \n`;
    code += `    // Update display\n`;
    code += `    gui_text_content_set((gui_text_t *)${componentId}, ${componentId}_timer_str, strlen(${componentId}_timer_str));\n`;
    code += `}`;

    return code;
  }

  /**
   * Collect all toggle button callback function names
   */
  private collectToggleButtonCallbackNames(): Array<{ onCallback: string; offCallback: string }> {
    const callbacks: Array<{ onCallback: string; offCallback: string }> = [];

    this.allComponents.forEach(component => {
      if (component.type === 'hg_button') {
        const toggleMode = component.data?.toggleMode === true || component.data?.toggleMode === 'true';
        if (toggleMode) {
          callbacks.push({
            onCallback: `${component.id}_on_callback`,
            offCallback: `${component.id}_off_callback`
          });
        }
      }
    });

    return callbacks;
  }

  /**
   * Collect all toggle button callback implementations
   */
  private collectToggleButtonCallbackImpls(): string[] {
    const impls: string[] = [];

    this.allComponents.forEach(component => {
      if (component.type === 'hg_button') {
        const toggleMode = component.data?.toggleMode === true || component.data?.toggleMode === 'true';
        if (toggleMode) {
          // Check if a control target is specified
          const controlTarget = component.data?.controlTarget;
          
          let onCallbackBody = '';
          let offCallbackBody = '';
          
          if (controlTarget) {
            // If control target specified, generate callbacks based on target type
            const targetComp = this.componentMap.get(controlTarget);
            
            if (targetComp) {
              // Determine target type and generate corresponding control code
              if (targetComp.type === 'hg_timer_label') {
                // Timer label: use generated control functions
                onCallbackBody = `    // Start timer\n    ${targetComp.id}_start();`;
                offCallbackBody = `    // Stop timer\n    ${targetComp.id}_stop();`;
              } else if (targetComp.type === 'hg_label' && targetComp.data?.isTimerLabel === true) {
                // Legacy timer label (backward compatible): start/stop timer
                onCallbackBody = `    // Start timer\n    gui_obj_start_timer((void *)${targetComp.id});`;
                offCallbackBody = `    // Stop timer\n    if (GUI_BASE(${targetComp.id})->timer) {\n        gui_obj_stop_timer((void *)${targetComp.id});\n    }`;
              } else if (targetComp.type === 'hg_video') {
                // Video player: play/pause
                onCallbackBody = `    // Play video\n    // TODO: Implement video play logic\n    // gui_video_play(${targetComp.id});`;
                offCallbackBody = `    // Pause video\n    // TODO: Implement video pause logic\n    // gui_video_pause(${targetComp.id});`;
              } else {
                // Other components: show/hide control
                onCallbackBody = `    // Show target component\n    gui_obj_hidden((gui_obj_t *)${targetComp.id}, false);`;
                offCallbackBody = `    // Hide target component\n    gui_obj_hidden((gui_obj_t *)${targetComp.id}, true);`;
              }
            } else {
              // Target component does not exist
              onCallbackBody = `    // Warning: Control target "${controlTarget}" does not exist\n    // TODO: Please check if controlTarget property is correct`;
              offCallbackBody = `    // Warning: Control target "${controlTarget}" does not exist\n    // TODO: Please check if controlTarget property is correct`;
            }
          } else {
            // If no control target specified, find all timer labels with timerAutoStart=false in the same view
            const parentView = this.findParentView(component);
            const timerLabels = parentView ? this.findTimerLabelsInView(parentView) : [];
            
            if (timerLabels.length > 0) {
              // Found timer labels, generate timer control code
              onCallbackBody = timerLabels.map(label => {
                if (label.type === 'hg_timer_label') {
                  return `    // Start timer\n    ${label.id}_start();`;
                } else {
                  return `    // Start timer\n    gui_obj_start_timer((void *)${label.id});`;
                }
              }).join('\n');
              offCallbackBody = timerLabels.map(label => {
                if (label.type === 'hg_timer_label') {
                  return `    // Stop timer\n    ${label.id}_stop();`;
                } else {
                  return `    // Stop timer\n    if (GUI_BASE(${label.id})->timer) {\n        gui_obj_stop_timer((void *)${label.id});\n    }`;
                }
              }).join('\n');
            } else {
              // No control targets found, generate generic template
              onCallbackBody = `    // TODO: Implement ON state business logic\n    // Hint: Set "Control Target" in button properties to specify control target\n    // Example: music_player_play();`;
              offCallbackBody = `    // TODO: Implement OFF state business logic\n    // Hint: Set "Control Target" in button properties to specify control target\n    // Example: music_player_pause();`;
            }
          }
          
          const impl = `/* USER CODE BEGIN ${component.id}_on_callback */
/**
 * ${component.id} ON state callback
 * Called when button switches to ON state
 */
void ${component.id}_on_callback(void)
{
${onCallbackBody}
}
/* USER CODE END ${component.id}_on_callback */

/* USER CODE BEGIN ${component.id}_off_callback */
/**
 * ${component.id} OFF state callback
 * Called when button switches to OFF state
 */
void ${component.id}_off_callback(void)
{
${offCallbackBody}
}
/* USER CODE END ${component.id}_off_callback */
`;
          impls.push(impl);
        }
      }
    });

    return impls;
  }

  /**
   * Find the parent view containing the component
   */
  private findParentView(component: Component): Component | null {
    // Iterate all components to find the view containing this component
    for (const comp of this.allComponents) {
      if ((comp.type === 'hg_view' || comp.type === 'hg_window') && 
          comp.children && comp.children.includes(component.id)) {
        return comp;
      }
    }
    return null;
  }

  /**
   * Find all timer labels with timerAutoStart=false in the view
   */
  private findTimerLabelsInView(view: Component): Component[] {
    const timerLabels: Component[] = [];
    
    if (!view.children) return timerLabels;
    
    // Iterate all children of the view
    view.children.forEach(childId => {
      const child = this.componentMap.get(childId);
      if (child) {
        // Support new hg_timer_label and legacy hg_label (isTimerLabel=true)
        const isTimerLabel = child.type === 'hg_timer_label' || 
                            (child.type === 'hg_label' && child.data?.isTimerLabel === true);
        const autoStart = child.data?.timerAutoStart !== false; // Auto-start by default
        
        if (isTimerLabel && !autoStart) {
          timerLabels.push(child);
        }
      }
    });
    
    return timerLabels;
  }
}
