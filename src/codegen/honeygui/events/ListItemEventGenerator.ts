/**
 * hg_list_item event code generator.
 * list_item events are generated in the note_design callback and require special handling.
 */
import { Component } from '../../../hml/types';
import { EventCodeGenerator, EVENT_TYPE_TO_GUI_EVENT, generateMessageCallbackImpl, generateControlTimerCallbackImpl, generateEventCallbackName } from './EventCodeGenerator';
import { cLiteral } from '../../cLiteral';

export class ListItemEventGenerator implements EventCodeGenerator {
  generateEventBindings(component: Component, indent: number, componentMap: Map<string, Component>): string {
    if (!component.eventConfigs || component.eventConfigs.length === 0) {
      return '';
    }

    const indentStr = '    '.repeat(indent);
    let code = '';

    // Track onMessage event index
    let msgIndex = 0;
    const eventTypeIndexMap = new Map<string, number>();

    component.eventConfigs.forEach(eventConfig => {
      if (eventConfig.type === 'onMessage') {
        // onMessage event handling
        if (eventConfig.message) {
          const callbackName = eventConfig.handler || `${component.id}_msg_cb_${msgIndex}`;
          msgIndex++;
          code += `${indentStr}gui_msg_subscribe((gui_obj_t *)${component.id}, ${cLiteral(eventConfig.message)}, ${callbackName});\n`;
        }
      } else {
        // Standard touch/swipe events
        const guiEvent = EVENT_TYPE_TO_GUI_EVENT[eventConfig.type];
        if (!guiEvent) {
          console.warn(`[ListItemEventGenerator] Unknown event type: ${eventConfig.type}`);
          return;
        }

        // Check for switchView, callFunction, or controlTimer actions
        const hasSwitchView = eventConfig.actions.some(a => a.type === 'switchView');
        const hasCallFunction = eventConfig.actions.some(a => a.type === 'callFunction');
        const hasControlTimer = eventConfig.actions.some(a => a.type === 'controlTimer' && a.timerTargets && a.timerTargets.length > 0);

        if (hasSwitchView) {
          // Use switchView callback
          const callbackName = `${component.id}_switch_view_cb`;
          code += `${indentStr}gui_obj_add_event_cb(${component.id}, ${callbackName}, ${guiEvent}, NULL);\n`;
        } else if (hasCallFunction) {
          // Use user-specified callback function
          const functionName = eventConfig.actions.find(a => a.type === 'callFunction')?.functionName;
          if (functionName) {
            code += `${indentStr}gui_obj_add_event_cb(${component.id}, ${functionName}, ${guiEvent}, NULL);\n`;
          }
        } else if (hasControlTimer) {
          // Use controlTimer callback
          const currentIndex = eventTypeIndexMap.get(eventConfig.type) || 0;
          const callbackName = generateEventCallbackName(component.id, eventConfig.type, currentIndex);
          eventTypeIndexMap.set(eventConfig.type, currentIndex + 1);
          code += `${indentStr}gui_obj_add_event_cb(${component.id}, (gui_event_cb_t)${callbackName}, ${guiEvent}, NULL);\n`;
        }
      }
    });

    return code;
  }

  collectCallbackFunctions(component: Component): string[] {
    const functions: string[] = [];
    if (!component.eventConfigs) return functions;

    // Track onMessage event index
    let msgIndex = 0;
    const eventTypeIndexMap = new Map<string, number>();

    component.eventConfigs.forEach(eventConfig => {
      if (eventConfig.type === 'onMessage') {
        // onMessage callback
        if (eventConfig.message) {
          const callbackName = eventConfig.handler || `${component.id}_msg_cb_${msgIndex}`;
          msgIndex++;
          functions.push(callbackName);
        }
      } else {
        // Standard event callback
        const hasSwitchView = eventConfig.actions.some(a => a.type === 'switchView');
        const hasCallFunction = eventConfig.actions.some(a => a.type === 'callFunction');
        const hasControlTimer = eventConfig.actions.some(a => a.type === 'controlTimer' && a.timerTargets && a.timerTargets.length > 0);

        if (hasSwitchView) {
          functions.push(`${component.id}_switch_view_cb`);
        } else if (hasCallFunction) {
          const functionName = eventConfig.actions.find(a => a.type === 'callFunction')?.functionName;
          if (functionName) {
            functions.push(functionName);
          }
        } else if (hasControlTimer) {
          const currentIndex = eventTypeIndexMap.get(eventConfig.type) || 0;
          functions.push(generateEventCallbackName(component.id, eventConfig.type, currentIndex));
          eventTypeIndexMap.set(eventConfig.type, currentIndex + 1);
        }
      }
    });

    return functions;
  }

  getSwitchViewCallbackImpl(component: Component, componentMap: Map<string, Component>): string[] {
    const impls: string[] = [];
    if (!component.eventConfigs) return impls;

    const hasSwitchView = component.eventConfigs.some(ec => 
      ec.type !== 'onMessage' && ec.actions.some(a => a.type === 'switchView')
    );

    if (!hasSwitchView) return impls;

    const callbackName = `${component.id}_switch_view_cb`;
    let body = '';

    component.eventConfigs.forEach(eventConfig => {
      if (eventConfig.type === 'onMessage') return;

      eventConfig.actions.forEach(action => {
        if (action.type === 'switchView' && action.target) {
          const targetComponent = componentMap.get(action.target);
          const targetName = targetComponent?.name || action.target;
          const switchOutStyle = action.switchOutStyle || 'SWITCH_OUT_TO_LEFT_USE_TRANSLATION';
          const switchInStyle = action.switchInStyle || 'SWITCH_IN_FROM_RIGHT_USE_TRANSLATION';
          body += `    gui_view_switch_direct(gui_view_get_current(), "${targetName}", ${switchOutStyle}, ${switchInStyle});\n`;
        }
      });
    });

    if (body) {
      impls.push(`void ${callbackName}(void *obj, gui_event_t *e)
{
    GUI_UNUSED(obj);
    GUI_UNUSED(e);
${body}}`);
    }

    return impls;
  }

  getMessageCallbackImpl(component: Component, componentMap: Map<string, Component>): string[] {
    return generateMessageCallbackImpl(component, componentMap);
  }

  getControlTimerCallbackImpl(component: Component, componentMap: Map<string, Component>): string[] {
    return generateControlTimerCallbackImpl(component, componentMap);
  }

  /**
   * Generate unified event callback implementations (all events except onMessage)
   */
  getEventCallbackImpl(component: Component, componentMap: Map<string, Component>): string[] {
    const impls: string[] = [];
    
    // Generate switchView callbacks
    impls.push(...this.getSwitchViewCallbackImpl(component, componentMap));
    
    // Generate controlTimer callbacks
    impls.push(...generateControlTimerCallbackImpl(component, componentMap));
    
    return impls;
  }
}
