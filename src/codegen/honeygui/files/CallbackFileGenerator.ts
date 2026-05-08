/**
 * Callback file generator
 * Generates callbacks.h and callbacks.c files
 */
import { Component } from '../../../hml/types';
import { EventGeneratorFactory } from '../events';
import { getMessageCallbackName, generateEventCallbackName } from '../events/EventCodeGenerator';

export class CallbackFileGenerator {
  private components: Component[];
  private componentMap: Map<string, Component>;
  private allComponents: Component[]; // Flat array containing all nested components

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

    // Collect all components with timers to declare counters
    const componentsWithTimers = this.allComponents.filter(c => {
      // New format: has timers array
      if (c.data?.timers && Array.isArray(c.data.timers) && c.data.timers.length > 0) {
        return true;  // All components with timers need counters
      }
      // Legacy format: has timerEnabled
      if (c.data?.timerEnabled === true) {
        return true;  // All components with timers need counters
      }
      return false;
    });

    if (componentsWithTimers.length > 0) {
      code += `// Timer animation counters (defined in callbacks.c)\n`;
      componentsWithTimers.forEach(comp => {
        code += `extern uint16_t ${comp.id}_timer_cnt;\n`;
      });
      code += `\n`;
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
    
    let code = `#include "${baseName}_callbacks.h"
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

    // Define timer animation counter variables
    const componentsWithTimers = this.allComponents.filter(c => {
      // New format: has timers array
      if (c.data?.timers && Array.isArray(c.data.timers) && c.data.timers.length > 0) {
        return true;  // All components with timers need counters
      }
      // Legacy format: has timerEnabled
      if (c.data?.timerEnabled === true) {
        return true;  // All components with timers need counters
      }
      return false;
    });

    if (componentsWithTimers.length > 0) {
      code += `// Timer animation counters\n`;
      componentsWithTimers.forEach(comp => {
        code += `uint16_t ${comp.id}_timer_cnt = 0;\n`;
      });
      code += `\n`;
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

    // Generate preset timer callback implementations (skip existing ones)
    const timerCallbackImpls = this.collectTimerCallbackImpls(existingFunctions);
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
   * Generate preset action timer callback function
   */
  private generatePresetTimerCallback(component: Component): string {
    const callback = `${component.id}_preset_timer_cb`;
    const actions = component.data?.timerActions || [];
    const duration = component.data?.timerDuration || 1000;
    const interval = component.data?.timerInterval || 1000;
    const stopOnComplete = component.data?.timerStopOnComplete !== false;
    
    // Calculate cnt_max
    const cntMax = Math.ceil(duration / interval);
    
    const cntVarName = `${component.id}_timer_cnt`;
    
    let code = `void ${callback}(void *obj)\n{\n`;
    code += `    gui_obj_t *target = (gui_obj_t *)obj;\n`;
    code += `    const uint16_t cnt_max = ${cntMax};\n`;
    code += `    \n`;
    
    // Generate code for each action
    actions.forEach((action: any) => {
      if (action.type === 'position') {
        // Position adjustment action
        code += `    // Adjust position: (${action.fromX}, ${action.fromY}) -> (${action.toX}, ${action.toY})\n`;
        code += `    const int16_t x_origin = ${action.fromX};\n`;
        code += `    const int16_t y_origin = ${action.fromY};\n`;
        code += `    const int16_t x_target = ${action.toX};\n`;
        code += `    const int16_t y_target = ${action.toY};\n`;
        code += `    int16_t x_cur = x_origin + (x_target - x_origin) * ${cntVarName} / cnt_max;\n`;
        code += `    int16_t y_cur = y_origin + (y_target - y_origin) * ${cntVarName} / cnt_max;\n`;
        code += `    gui_obj_move(target, x_cur, y_cur);\n`;
        code += `    \n`;
      } else if (action.type === 'size') {
        // Size adjustment action (hg_window only)
        code += `    // Adjust size: (${action.fromW}, ${action.fromH}) -> (${action.toW}, ${action.toH})\n`;
        code += `    const int16_t w_origin = ${action.fromW};\n`;
        code += `    const int16_t h_origin = ${action.fromH};\n`;
        code += `    const int16_t w_target = ${action.toW};\n`;
        code += `    const int16_t h_target = ${action.toH};\n`;
        code += `    int16_t w_cur = w_origin + (w_target - w_origin) * ${cntVarName} / cnt_max;\n`;
        code += `    int16_t h_cur = h_origin + (h_target - h_origin) * ${cntVarName} / cnt_max;\n`;
        code += `    target->w = w_cur;\n`;
        code += `    target->h = h_cur;\n`;
        code += `    \n`;
      } else if (action.type === 'opacity') {
        // Opacity adjustment action
        code += `    // Adjust opacity: ${action.from} -> ${action.to}\n`;
        code += `    const uint8_t opacity_origin = ${action.from};\n`;
        code += `    const uint8_t opacity_target = ${action.to};\n`;
        code += `    int16_t opacity_cur = opacity_origin + (opacity_target - opacity_origin) * ${cntVarName} / cnt_max;\n`;
        // hg_image uses gui_img_set_opacity, other components use target->opacity_value
        if (component.type === 'hg_image') {
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
        code += `    float angle_cur = angle_origin + (angle_target - angle_origin) * ${cntVarName} / cnt_max;\n`;
        code += `    gui_img_rotation((gui_img_t *)target, angle_cur);\n`;
        code += `    \n`;
      } else if (action.type === 'scale') {
        // Scale adjustment action (hg_image only)
        code += `    // Adjust scale: (${action.zoomXOrigin}, ${action.zoomYOrigin}) -> (${action.zoomXTarget}, ${action.zoomYTarget})\n`;
        code += `    const float zoom_x_origin = ${action.zoomXOrigin};\n`;
        code += `    const float zoom_x_target = ${action.zoomXTarget};\n`;
        code += `    const float zoom_y_origin = ${action.zoomYOrigin};\n`;
        code += `    const float zoom_y_target = ${action.zoomYTarget};\n`;
        code += `    float zoom_x_cur = zoom_x_origin + (zoom_x_target - zoom_x_origin) * ${cntVarName} / cnt_max;\n`;
        code += `    float zoom_y_cur = zoom_y_origin + (zoom_y_target - zoom_y_origin) * ${cntVarName} / cnt_max;\n`;
        code += `    gui_img_scale((gui_img_t *)target, zoom_x_cur, zoom_y_cur);\n`;
        code += `    \n`;
      } else if (action.type === 'setFocus') {
        // Set focus action (applies to all components)
        code += `    // Set focus\n`;
        code += `    gui_obj_focus_set(target);\n`;
        code += `    \n`;
      }
    });
    
    // Increment counter
    code += `    ${cntVarName}++;\n`;
    
    // Handle completion after reaching total duration
    if (stopOnComplete) {
      code += `    if (${cntVarName} >= cnt_max) {\n`;
      code += `        gui_obj_stop_timer(target);\n`;
      code += `        ${cntVarName} = 0; // Reset counter\n`;
      code += `    }\n`;
    } else {
      code += `    if (${cntVarName} >= cnt_max) {\n`;
      code += `        ${cntVarName} = 0; // Reset counter, continue loop\n`;
      code += `    }\n`;
    }
    
    code += `}\n`;
    
    return code;
  }

  /**
   * Generate preset action timer callback from TimerConfig (supports multi-segment animation)
   */
  private generatePresetTimerCallbackFromConfig(component: Component, timer: any): string {
    const callback = `${component.id}_${timer.id}_cb`;
    const segments = timer.segments || [];
    const interval = timer.interval || 1000;
    const stopOnComplete = timer.stopOnComplete !== false;
    const timerName = timer.name || timer.id;
    
    // If multi-segment animation exists, use multi-segment generation logic
    if (segments.length > 0) {
      return this.generateMultiSegmentTimerCallback(component, timer, callback, timerName, interval, stopOnComplete, segments);
    }
    
    // Otherwise use legacy single-segment animation logic
    const actions = timer.actions || [];
    const duration = timer.duration || 1000;
    const delayStart = timer.delayStart || 0;
    
    // Calculate cnt_max and cnt_wait
    const cntMax = Math.ceil(duration / interval);
    const cntWait = Math.ceil(delayStart / interval);
    
    const cntVarName = `${component.id}_timer_cnt`;
    
    let code = `/**
 * ${timerName}
 * Component: ${component.id}
 * Mode: Preset actions (single segment)
 */
void ${callback}(void *obj)\n{\n`;
    code += `    gui_obj_t *target = (gui_obj_t *)obj;\n`;
    code += `    const uint16_t cnt_max = ${cntMax};\n`;
    
    // Add cnt_wait if delayed start is configured
    if (delayStart > 0) {
      code += `    const uint16_t cnt_wait = ${cntWait}; // Delay start: ${delayStart}ms\n`;
      code += `    \n`;
      code += `    // Delay start check\n`;
      code += `    if (${cntVarName} <= cnt_wait) {\n`;
      code += `        ${cntVarName}++;\n`;
      code += `        return;\n`;
      code += `    }\n`;
      code += `    \n`;
    } else {
      code += `    \n`;
    }
    
    // Generate code for each action
    actions.forEach((action: any) => {
      code += this.generateActionCode(action, delayStart > 0, cntVarName, 'cnt_wait', 'cnt_max', component);
    });
    
    // Increment counter
    code += `    ${cntVarName}++;\n`;
    
    // Add gui_log output if logging is enabled
    if (timer.enableLog) {
      code += `    gui_log("${callback}: cnt=%d\\n", ${cntVarName});\n`;
    }
    
    // Handle completion after reaching total duration
    const totalCnt = delayStart > 0 ? `cnt_wait + cnt_max` : `cnt_max`;
    if (stopOnComplete) {
      code += `    if (${cntVarName} >= ${totalCnt}) {\n`;
      code += `        gui_obj_stop_timer(target);\n`;
      code += `        ${cntVarName} = 0; // Reset counter\n`;
      code += `    }\n`;
    } else {
      code += `    if (${cntVarName} >= ${totalCnt}) {\n`;
      code += `        ${cntVarName} = 0; // Reset counter, continue loop\n`;
      code += `    }\n`;
    }
    
    code += `}\n`;
    
    return code;
  }

  /**
   * Generate multi-segment animation timer callback function
   */
  private generateMultiSegmentTimerCallback(
    component: Component,
    timer: any,
    callback: string,
    timerName: string,
    interval: number,
    stopOnComplete: boolean,
    segments: any[]
  ): string {
    // Calculate cnt_max for each segment
    const segmentCntMaxes = segments.map(seg => Math.ceil(seg.duration / interval));
    const totalCntMax = segmentCntMaxes.reduce((sum, cnt) => sum + cnt, 0);
    
    const cntVarName = `${component.id}_timer_cnt`;
    
    let code = `/**
 * ${timerName}
 * Component: ${component.id}
 * Mode: Preset actions (multi-segment animation)
 * Segments: ${segments.length}
 */
void ${callback}(void *obj)\n{\n`;
    code += `    gui_obj_t *target = (gui_obj_t *)obj;\n`;
    code += `    const uint16_t total_cnt_max = ${totalCntMax};\n`;
    code += `    \n`;
    
    // Generate boundary constants for each segment
    let cumulativeCnt = 0;
    segments.forEach((seg, idx) => {
      const segCntMax = segmentCntMaxes[idx];
      code += `    const uint16_t seg${idx}_start = ${cumulativeCnt};\n`;
      code += `    const uint16_t seg${idx}_end = ${cumulativeCnt + segCntMax};\n`;
      cumulativeCnt += segCntMax;
    });
    code += `    \n`;
    
    // Increment cnt before condition check
    code += `    ${cntVarName}++;\n`;
    
    // Add gui_log output if logging is enabled
    if (timer.enableLog) {
      code += `    gui_log("${callback}: cnt=%d\\n", ${cntVarName});\n`;
    }
    
    code += `    \n`;
    
    // Generate conditional branches for each segment (using if-else for efficiency)
    segments.forEach((seg, idx) => {
      const actions = seg.actions || [];
      const ifKeyword = idx === 0 ? 'if' : 'else if';
      
      if (actions.length === 0) {
        // Empty segment (wait)
        code += `    // Segment ${idx + 1}: Wait ${seg.duration}ms\n`;
        code += `    ${ifKeyword} (${cntVarName} > seg${idx}_start && ${cntVarName} <= seg${idx}_end) {\n`;
        code += `        // No action, just wait\n`;
        code += `    }\n`;
      } else {
        // Check if all actions need no segment counter (view switch, image change, visibility, timer toggle, focus, color without initial value, etc.)
        const allNoSegCounter = actions.every((action: any) => 
          action.type === 'switchView' || 
          action.type === 'changeImage' || 
          action.type === 'visibility' || 
          action.type === 'switchTimer' || 
          action.type === 'setFocus' ||
          (action.type === 'fgColor' && !action.fgColorFrom) ||
          (action.type === 'bgColor' && !action.bgColorFrom)
        );
        
        // Segment with actions
        code += `    // Segment ${idx + 1}: ${seg.duration}ms, ${actions.length} action(s)\n`;
        code += `    ${ifKeyword} (${cntVarName} > seg${idx}_start && ${cntVarName} <= seg${idx}_end) {\n`;
        
        // Only generate segment counter when interpolation is needed
        if (!allNoSegCounter) {
          code += `        uint16_t seg_cnt = ${cntVarName} - seg${idx}_start;\n`;
          code += `        const uint16_t seg_cnt_max = seg${idx}_end - seg${idx}_start;\n`;
          code += `        \n`;
        }
        
        // Generate code for each action
        actions.forEach((action: any) => {
          const actionCode = this.generateActionCode(action, false, 'seg_cnt', '', 'seg_cnt_max', component);
          // Handle indentation
          const indentedCode = actionCode.split('\n').map(line => line ? `        ${line}` : line).join('\n');
          code += indentedCode;
        });
        
        code += `    }\n`;
      }
    });
    
    code += `    \n`;
    
    // Handle completion after reaching total duration
    if (stopOnComplete) {
      code += `    if (${cntVarName} >= total_cnt_max) {\n`;
      code += `        gui_obj_stop_timer(target);\n`;
      code += `        ${cntVarName} = 0; // Reset counter\n`;
      code += `    }\n`;
    } else {
      code += `    if (${cntVarName} >= total_cnt_max) {\n`;
      code += `        ${cntVarName} = 0; // Reset counter, continue loop\n`;
      code += `    }\n`;
    }
    
    code += `}\n`;
    
    return code;
  }

  /**
   * Generate code for a single action
   */
  private generateActionCode(action: any, hasDelay: boolean, cntVar: string, waitVar: string, maxVar: string, component?: Component): string {
    let code = '';
    const progressExpr = hasDelay ? `(${cntVar} - ${waitVar}) / ${maxVar}` : `${cntVar} / ${maxVar}`;
    
    if (action.type === 'visibility') {
      // Set visibility action
      const visible = action.visible !== false; // Defaults to true
      code += `    // Set visibility: ${visible ? 'show' : 'hide'}\n`;
      code += `    gui_obj_show(target, ${visible ? 'true' : 'false'});\n`;
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
        code += `    uint16_t index = (${processedPaths.length} - 1) * ${progressExpr};\n`;
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
          
          code += `    // Start timer animation: ${timerName}\n`;
          code += `    ${component?.id}_timer_cnt = 0; // Reset counter\n`;
          code += `    gui_obj_create_timer(target, ${targetTimer.interval}, ${targetTimer.reload !== false ? 'true' : 'false'}, ${callback});\n`;
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
      code += `    int16_t x_cur = x_origin + (x_target - x_origin) * ${progressExpr};\n`;
      code += `    int16_t y_cur = y_origin + (y_target - y_origin) * ${progressExpr};\n`;
      code += `    gui_obj_move(target, x_cur, y_cur);\n`;
      code += `    \n`;
    } else if (action.type === 'size') {
      // Size adjustment action (hg_window only)
      code += `    // Adjust size: (${action.fromW}, ${action.fromH}) -> (${action.toW}, ${action.toH})\n`;
      code += `    const int16_t w_origin = ${action.fromW};\n`;
      code += `    const int16_t h_origin = ${action.fromH};\n`;
      code += `    const int16_t w_target = ${action.toW};\n`;
      code += `    const int16_t h_target = ${action.toH};\n`;
      code += `    int16_t w_cur = w_origin + (w_target - w_origin) * ${progressExpr};\n`;
      code += `    int16_t h_cur = h_origin + (h_target - h_origin) * ${progressExpr};\n`;
      code += `    target->w = w_cur;\n`;
      code += `    target->h = h_cur;\n`;
      code += `    \n`;
    } else if (action.type === 'opacity') {
      // Opacity adjustment action
      code += `    // Adjust opacity: ${action.from} -> ${action.to}\n`;
      code += `    const uint8_t opacity_origin = ${action.from};\n`;
      code += `    const uint8_t opacity_target = ${action.to};\n`;
      code += `    int16_t opacity_cur = opacity_origin + (opacity_target - opacity_origin) * ${progressExpr};\n`;
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
        code += `    uint8_t a_cur = a_from + (a_to - a_from) * ${progressExpr};\n`;
        code += `    uint8_t r_cur = r_from + (r_to - r_from) * ${progressExpr};\n`;
        code += `    uint8_t g_cur = g_from + (g_to - g_from) * ${progressExpr};\n`;
        code += `    uint8_t b_cur = b_from + (b_to - b_from) * ${progressExpr};\n`;
        code += `    uint32_t fg_color_cur = (a_cur << 24) | (r_cur << 16) | (g_cur << 8) | b_cur;\n`;
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
        code += `    uint8_t a_cur = a_from + (a_to - a_from) * ${progressExpr};\n`;
        code += `    uint8_t r_cur = r_from + (r_to - r_from) * ${progressExpr};\n`;
        code += `    uint8_t g_cur = g_from + (g_to - g_from) * ${progressExpr};\n`;
        code += `    uint8_t b_cur = b_from + (b_to - b_from) * ${progressExpr};\n`;
        code += `    uint32_t bg_color_cur = (a_cur << 24) | (r_cur << 16) | (g_cur << 8) | b_cur;\n`;
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
                onCallbackBody = `    // Show target component\n    gui_obj_show(${targetComp.id}, true);`;
                offCallbackBody = `    // Hide target component\n    gui_obj_show(${targetComp.id}, false);`;
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
