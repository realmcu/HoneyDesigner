/**
 * Default event code generator (generic components)
 */
import { Component } from '../../../hml/types';
import { EventCodeGenerator, EVENT_TYPE_TO_GUI_EVENT, EVENT_TYPE_TO_CALLBACK_SUFFIX, generateMessageCallbackImpl, getMessageCallbackName } from './EventCodeGenerator';
import { presetTimerStateNames, timerReloadArg } from '../PresetTimerModel';

export class DefaultEventGenerator implements EventCodeGenerator {

  generateEventBindings(component: Component, indent: number, componentMap: Map<string, Component>): string {
    if (!component.eventConfigs || component.eventConfigs.length === 0) {
      return '';
    }

    let code = '';
    const indentStr = '    '.repeat(indent);
    let msgIndex = 0;
    const eventTypeMap = new Map<string, boolean>(); // Track whether each event type is already bound

    component.eventConfigs.forEach((eventConfig) => {
      // Handle onMessage events (message subscription)
      if (eventConfig.type === 'onMessage' && eventConfig.message) {
        // Prefer handler property
        const callbackName = eventConfig.handler || getMessageCallbackName(component, eventConfig, msgIndex);
        msgIndex++;
        code += `${indentStr}gui_msg_subscribe((gui_obj_t *)${component.id}, "${eventConfig.message}", ${callbackName});\n`;
        return;
      }

      // Handle other events: bind to corresponding callback via gui_obj_add_event_cb
      const guiEvent = EVENT_TYPE_TO_GUI_EVENT[eventConfig.type];
      if (!guiEvent) return;

      // Bind only one callback per event type
      if (!eventTypeMap.has(eventConfig.type)) {
        const callbackName = this.getEventCallbackName(component.id, eventConfig.type);
        code += `${indentStr}gui_obj_add_event_cb(${component.id}, (gui_event_cb_t)${callbackName}, ${guiEvent}, NULL);\n`;
        eventTypeMap.set(eventConfig.type, true);
      }
    });

    return code;
  }

  collectCallbackFunctions(component: Component): string[] {
    const functions: string[] = [];
    if (!component.eventConfigs) return functions;

    let msgIndex = 0;
    const eventTypeMap = new Map<string, boolean>(); // Track whether each event type is already collected
    
    component.eventConfigs.forEach(eventConfig => {
      if (eventConfig.type === 'onMessage' && eventConfig.message) {
        // Prefer handler property
        if (eventConfig.handler) {
          functions.push(eventConfig.handler);
        } else {
          functions.push(getMessageCallbackName(component, eventConfig, msgIndex));
        }
        msgIndex++;
      } else {
        // Other events: collect only one callback name per event type
        if (!eventTypeMap.has(eventConfig.type)) {
          const callbackName = this.getEventCallbackName(component.id, eventConfig.type);
          functions.push(callbackName);
          eventTypeMap.set(eventConfig.type, true);
        }
      }
    });

    return functions;
  }

  /**
   * Generate unified event callback implementations (all events except onMessage)
   */
  getEventCallbackImpl(component: Component, componentMap: Map<string, Component>): string[] {
    const impls: string[] = [];
    if (!component.eventConfigs) return impls;

    // Group by event type
    const eventGroups = new Map<string, typeof component.eventConfigs>();
    
    component.eventConfigs.forEach(eventConfig => {
      if (eventConfig.type === 'onMessage') return; // onMessage handled separately
      
      if (!eventGroups.has(eventConfig.type)) {
        eventGroups.set(eventConfig.type, []);
      }
      eventGroups.get(eventConfig.type)!.push(eventConfig);
    });

    // Generate one callback per event type
    eventGroups.forEach((eventConfigs, eventType) => {
      const callbackName = this.getEventCallbackName(component.id, eventType);
      let callbackBody = '';

      // Key events: distinguish different keys via strcmp
      const isKeyEvent = eventType === 'onKeyShortPress' || eventType === 'onKeyLongPress';
      
      if (isKeyEvent) {
        // Key events: distinguish different keys via strcmp
        eventConfigs.forEach((eventConfig, index) => {
          const isFirst = index === 0;
          const keyName = eventConfig.keyName || 'unknown';
          
          if (isFirst) {
            callbackBody += `    // Check key name\n`;
            callbackBody += `    if (strcmp(e->indev_name, "${keyName}") == 0)\n    {\n`;
          } else {
            callbackBody += `    else if (strcmp(e->indev_name, "${keyName}") == 0)\n    {\n`;
          }
          
          // Generate action code (a key may have multiple actions)
          callbackBody += this.generateActionsCode(eventConfig, componentMap, '        ');
          callbackBody += `    }\n`;
        });
      } else {
        // Non-key events: merge all eventConfig actions, execute in order
        // Note: same event type may have multiple eventConfigs (uncommon), each with multiple actions
        eventConfigs.forEach(eventConfig => {
          // Generate code for each action
          if (eventConfig.actions && eventConfig.actions.length > 0) {
            eventConfig.actions.forEach((action: any) => {
              callbackBody += this.generateSingleActionCode(action, componentMap, '    ');
            });
          }
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

    return impls;
  }

  /**
   * Generate onMessage callback implementations
   */
  getMessageCallbackImpl(component: Component, componentMap: Map<string, Component>): string[] {
    return generateMessageCallbackImpl(component, componentMap);
  }

  /**
   * Generate event action code (iterate all actions)
   */
  private generateActionsCode(eventConfig: any, componentMap: Map<string, Component>, indent: string): string {
    let code = '';
    
    if (!eventConfig.actions || eventConfig.actions.length === 0) {
      return code;
    }

    eventConfig.actions.forEach((action: any) => {
      code += this.generateSingleActionCode(action, componentMap, indent);
    });

    return code;
  }

  /**
   * Generate code for a single action
   */
  private generateSingleActionCode(action: any, componentMap: Map<string, Component>, indent: string): string {
    let code = '';

    if (action.type === 'callFunction' && action.functionName?.trim()) {
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

  /**
   * Generate callback function name based on event type
   */
  private getEventCallbackName(componentId: string, eventType: string): string {
    const suffix = EVENT_TYPE_TO_CALLBACK_SUFFIX[eventType] || 'event';
    return `${componentId}_${suffix}_cb`;
  }
}
