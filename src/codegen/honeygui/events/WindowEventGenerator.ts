/**
 * hg_window event code generator
 * 
 * Differences from ViewEventGenerator:
 * - Does not support view switching (switchView)
 * - Supports standard event binding (onClick, onLongPress, etc.)
 * - Supports message subscription (onMessage)
 * - Supports key events (onKeyShortPress, onKeyLongPress)
 */
import { Component } from '../../../hml/types';
import { EventCodeGenerator, EVENT_TYPE_TO_GUI_EVENT, generateMessageCallbackImpl, generateControlTimerCallbackImpl, generateKeyEventCallbackImpl, getMessageCallbackName, generateEventCallbackName } from './EventCodeGenerator';
import { presetTimerStateNames, timerReloadArg } from '../PresetTimerModel';

export class WindowEventGenerator implements EventCodeGenerator {

  generateEventBindings(component: Component, indent: number, componentMap: Map<string, Component>): string {
    if (!component.eventConfigs) return '';

    let code = '';
    const indentStr = '    '.repeat(indent);
    const eventTypeIndexMap = new Map<string, number>();
    const keyEventTypeMap = new Map<string, boolean>(); // Track whether each key event type is already bound

    component.eventConfigs.forEach(eventConfig => {
      // Handle onMessage events
      if (eventConfig.type === 'onMessage' && eventConfig.message) {
        // Use handler property directly if available
        if (eventConfig.handler) {
          code += `${indentStr}gui_msg_subscribe((gui_obj_t *)GUI_BASE(${component.id}), "${eventConfig.message}", ${eventConfig.handler});\n`;
        } else {
          // All other cases: use auto-generated callback name (which wraps the actual actions)
          const msgIndex = Array.from(component.eventConfigs || [])
            .filter(e => e.type === 'onMessage')
            .indexOf(eventConfig);
          const callbackName = getMessageCallbackName(component, eventConfig, msgIndex);
          code += `${indentStr}gui_msg_subscribe((gui_obj_t *)GUI_BASE(${component.id}), "${eventConfig.message}", ${callbackName});\n`;
        }
        return;
      }

      // Handle key events (bind only once per type)
      if ((eventConfig.type === 'onKeyShortPress' || eventConfig.type === 'onKeyLongPress') && eventConfig.keyName) {
        const guiEvent = EVENT_TYPE_TO_GUI_EVENT[eventConfig.type];
        if (guiEvent && !keyEventTypeMap.has(eventConfig.type)) {
          const keyEventIndex = keyEventTypeMap.size;
          const callbackName = `${component.id}_key_${keyEventIndex}_cb`;
          keyEventTypeMap.set(eventConfig.type, true);
          code += `${indentStr}gui_obj_add_event_cb(GUI_BASE(${component.id}), (gui_event_cb_t)${callbackName}, ${guiEvent}, NULL);\n`;
        }
        return;
      }

      // Handle other events (onClick, onLongPress, etc.)
      const guiEvent = EVENT_TYPE_TO_GUI_EVENT[eventConfig.type];
      if (guiEvent) {
        // Check if callback generation is needed
        const needsCallback = eventConfig.actions.some(action => 
          action.type === 'switchView' || 
          action.type === 'sendMessage' || 
          action.type === 'controlTimer'
        );
        
        if (needsCallback) {
          // Generate unified callback function
          const currentIndex = eventTypeIndexMap.get(eventConfig.type) || 0;
          const callbackName = generateEventCallbackName(component.id, eventConfig.type, currentIndex);
          eventTypeIndexMap.set(eventConfig.type, currentIndex + 1);
          code += `${indentStr}gui_obj_add_event_cb(GUI_BASE(${component.id}), (gui_event_cb_t)${callbackName}, ${guiEvent}, NULL);\n`;
        } else {
          // Only callFunction actions, bind directly
          eventConfig.actions.forEach(action => {
            if (action.type === 'callFunction' && action.functionName) {
              code += `${indentStr}gui_obj_add_event_cb(GUI_BASE(${component.id}), ${action.functionName}, ${guiEvent}, NULL);\n`;
            }
          });
        }
      }
    });

    return code;
  }

  collectCallbackFunctions(component: Component): string[] {
    const functions: string[] = [];
    
    if (!component.eventConfigs) return functions;

    let msgIndex = 0;
    const eventTypeIndexMap = new Map<string, number>();
    const keyEventTypeMap = new Map<string, boolean>(); // Track whether each key event type is already collected
    
    component.eventConfigs.forEach(eventConfig => {
      // Collect onMessage callback function names
      if (eventConfig.type === 'onMessage' && eventConfig.message) {
        // Use handler property if available
        if (eventConfig.handler) {
          functions.push(eventConfig.handler);
        } else {
          // All other cases: use auto-generated callback name
          functions.push(getMessageCallbackName(component, eventConfig, msgIndex));
        }
        msgIndex++;
        return;
      }

      // Collect key event callback names (only once per type)
      if ((eventConfig.type === 'onKeyShortPress' || eventConfig.type === 'onKeyLongPress') && eventConfig.keyName) {
        if (!keyEventTypeMap.has(eventConfig.type)) {
          const keyEventIndex = keyEventTypeMap.size;
          functions.push(`${component.id}_key_${keyEventIndex}_cb`);
          keyEventTypeMap.set(eventConfig.type, true);
        }
        return;
      }

      // Collect other event callback function names
      eventConfig.actions.forEach(action => {
        // Check if callback generation is needed
        const needsCallback = eventConfig.actions.some(a => 
          a.type === 'switchView' || 
          a.type === 'sendMessage' || 
          a.type === 'controlTimer'
        );
        
        if (needsCallback) {
          // Collect callback name only once
          const currentIndex = eventTypeIndexMap.get(eventConfig.type) || 0;
          if (currentIndex === 0 || action === eventConfig.actions[0]) {
            const callbackName = generateEventCallbackName(component.id, eventConfig.type, currentIndex);
            if (!functions.includes(callbackName)) {
              functions.push(callbackName);
              eventTypeIndexMap.set(eventConfig.type, currentIndex + 1);
            }
          }
        } else if (action.type === 'callFunction' && action.functionName) {
          // Only callFunction actions
          functions.push(action.functionName);
        }
      });
    });
    
    return functions;
  }

  getMessageCallbackImpl(component: Component, componentMap: Map<string, Component>): string[] {
    return generateMessageCallbackImpl(component, componentMap);
  }

  getSwitchViewCallbackImpl(_component: Component, _componentMap: Map<string, Component>): string[] {
    // Window does not support view switching
    return [];
  }

  getControlTimerCallbackImpl(component: Component, componentMap: Map<string, Component>): string[] {
    return generateControlTimerCallbackImpl(component, componentMap);
  }

  getKeyEventCallbackImpl(component: Component, componentMap: Map<string, Component>): string[] {
    return generateKeyEventCallbackImpl(component, componentMap);
  }

  /**
   * Generate unified event callback implementations (all events except onMessage).
   * hg_window supports switchView, sendMessage, controlTimer actions, etc.
   */
  getEventCallbackImpl(component: Component, componentMap: Map<string, Component>): string[] {
    const impls: string[] = [];
    if (!component.eventConfigs) return impls;

    // Group by event type
    const eventGroups = new Map<string, typeof component.eventConfigs>();
    
    component.eventConfigs.forEach(eventConfig => {
      if (eventConfig.type === 'onMessage') return; // onMessage handled separately
      
      // Skip key events (handled in getKeyEventCallbackImpl)
      if ((eventConfig.type === 'onKeyShortPress' || eventConfig.type === 'onKeyLongPress') && eventConfig.keyName) {
        return;
      }
      
      if (!eventGroups.has(eventConfig.type)) {
        eventGroups.set(eventConfig.type, []);
      }
      eventGroups.get(eventConfig.type)!.push(eventConfig);
    });

    // Generate one callback per event type
    eventGroups.forEach((eventConfigs, eventType) => {
      // Generate independent callback for each eventConfig
      eventConfigs.forEach((eventConfig, index) => {
        const callbackName = generateEventCallbackName(component.id, eventType, index);
        let callbackBody = '';

        // Generate action code
        if (eventConfig.actions && eventConfig.actions.length > 0) {
          eventConfig.actions.forEach((action: any) => {
            callbackBody += this.generateSingleActionCode(action, componentMap, '    ');
          });
        }

        // Generate TODO comment if no actions
        if (!callbackBody.trim()) {
          callbackBody = `    // TODO: Implement event handling logic\n`;
        }

        impls.push(`void ${callbackName}(void *obj, gui_event_t *e)
{
    GUI_UNUSED(obj);
    GUI_UNUSED(e);
${callbackBody}}`);
      });
    });

    return impls;
  }

  /**
   * Generate code for a single action
   */
  private generateSingleActionCode(action: any, componentMap: Map<string, Component>, indent: string): string {
    let code = '';

    if (action.type === 'callFunction' && action.functionName) {
      // Call function
      code += `${indent}${action.functionName}(obj, e);\n`;
    } else if (action.type === 'switchView' && action.target) {
      // Switch view
      const targetComponent = componentMap.get(action.target);
      const targetName = targetComponent?.name || action.target;
      const switchOutStyle = action.switchOutStyle || 'SWITCH_OUT_TO_LEFT_USE_TRANSLATION';
      const switchInStyle = action.switchInStyle || 'SWITCH_IN_FROM_RIGHT_USE_TRANSLATION';
      code += `${indent}gui_view_switch_direct(gui_view_get_current(), "${targetName}", ${switchOutStyle}, ${switchInStyle});\n`;
    } else if (action.type === 'sendMessage' && action.message) {
      // Send message
      code += `${indent}gui_msg_publish("${action.message}", NULL, 0);\n`;
    } else if (action.type === 'controlTimer' && action.timerTargets && action.timerTargets.length > 0) {
      // Control timer
      action.timerTargets.forEach((target: any) => {
        const targetComp = componentMap.get(target.componentId);
        if (!targetComp) return;

        // Check if this is a timer label
        const isTimerLabel = targetComp.type === 'hg_timer_label';

        if (isTimerLabel) {
          // Timer label start/stop control (using generated control functions)
          if (target.action === 'start') {
            code += `${indent}${target.componentId}_start();\n`;
          } else if (target.action === 'stop') {
            code += `${indent}${target.componentId}_stop();\n`;
          } else if (target.action === 'reset') {
            code += `${indent}${target.componentId}_reset();\n`;
          }
        } else {
          // Regular timer start/stop control
          const timers = targetComp.data?.timers;
          if (!timers || !Array.isArray(timers)) return;

          const timer = timers[target.timerIndex || 0];
          if (!timer) return;

          if (target.action === 'start') {
            // Start timer
            const isPreset = timer.mode === 'preset';
            const callback = isPreset
              ? `${target.componentId}_${timer.id}_cb`
              : (timer.callback || `${target.componentId}_timer_cb`);
            if (isPreset) {
              // Replay the animation from the start of its timeline
              code += `${indent}${presetTimerStateNames(target.componentId).resetFn}();\n`;
            }
            code += `${indent}gui_obj_create_timer(GUI_BASE(${target.componentId}), ${timer.interval}, ${timerReloadArg(isPreset, timer.reload ? 'true' : 'false')}, ${callback});\n`;
            code += `${indent}gui_obj_start_timer(GUI_BASE(${target.componentId}));\n`;
          } else if (target.action === 'stop') {
            // Stop timer
            code += `${indent}if (GUI_BASE(${target.componentId})->timer) {\n`;
            code += `${indent}    gui_obj_stop_timer(GUI_BASE(${target.componentId}));\n`;
            code += `${indent}}\n`;
          }
        }
      });
    }

    return code;
  }
}
