/**
 * hg_button event code generator.
 * Toggle button's onClick event is not bound separately (toggle_cb already occupies GUI_EVENT_TOUCH_CLICKED),
 * instead onClick actions are merged into toggle_cb for unified execution.
 */
import { Component } from '../../../hml/types';
import { DefaultEventGenerator } from './DefaultEventGenerator';
import { EVENT_TYPE_TO_GUI_EVENT, getMessageCallbackName } from './EventCodeGenerator';

export class ButtonEventGenerator extends DefaultEventGenerator {

  /**
   * Skip independent onClick binding in toggle mode (toggle_cb already handles GUI_EVENT_TOUCH_CLICKED)
   */
  generateEventBindings(component: Component, indent: number, componentMap: Map<string, Component>): string {
    const isToggle = component.data?.toggleMode === true || component.data?.toggleMode === 'true';
    if (!isToggle) {
      return super.generateEventBindings(component, indent, componentMap);
    }

    // Toggle mode: skip onClick, bind other events normally
    if (!component.eventConfigs || component.eventConfigs.length === 0) {
      return '';
    }

    let code = '';
    const indentStr = '    '.repeat(indent);
    let msgIndex = 0;
    const eventTypeMap = new Map<string, boolean>();

    component.eventConfigs.forEach(eventConfig => {
      if (eventConfig.type === 'onMessage' && eventConfig.message) {
        const callbackName = eventConfig.handler || getMessageCallbackName(component, eventConfig, msgIndex);
        msgIndex++;
        code += `${indentStr}gui_msg_subscribe((gui_obj_t *)${component.id}, "${eventConfig.message}", ${callbackName});\n`;
        return;
      }

      // Skip onClick in toggle mode (handled by toggle_cb)
      if (isToggle && eventConfig.type === 'onClick') {
        return;
      }

      const guiEvent = EVENT_TYPE_TO_GUI_EVENT[eventConfig.type];
      if (!guiEvent) return;

      if (!eventTypeMap.has(eventConfig.type)) {
        const callbackName = this.getCallbackName(component.id, eventConfig.type);
        code += `${indentStr}gui_obj_add_event_cb(${component.id}, (gui_event_cb_t)${callbackName}, ${guiEvent}, NULL);\n`;
        eventTypeMap.set(eventConfig.type, true);
      }
    });

    return code;
  }

  /**
   * Skip onClick callback implementation in toggle mode (actions merged into toggle_cb)
   */
  getEventCallbackImpl(component: Component, componentMap: Map<string, Component>): string[] {
    const isToggle = component.data?.toggleMode === true || component.data?.toggleMode === 'true';
    if (!isToggle) {
      return super.getEventCallbackImpl(component, componentMap);
    }

    // Toggle mode: filter out onClick, generate other events normally
    const filtered = { ...component, eventConfigs: (component.eventConfigs || []).filter(e => e.type !== 'onClick') };
    return super.getEventCallbackImpl(filtered as Component, componentMap);
  }

  collectCallbackFunctions(component: Component): string[] {
    const isToggle = component.data?.toggleMode === true || component.data?.toggleMode === 'true';
    if (!isToggle) {
      return super.collectCallbackFunctions(component);
    }

    // Toggle mode: filter out onClick
    const filtered = { ...component, eventConfigs: (component.eventConfigs || []).filter(e => e.type !== 'onClick') };
    return super.collectCallbackFunctions(filtered as Component);
  }

  private getCallbackName(componentId: string, eventType: string): string {
    const suffixMap: Record<string, string> = {
      'onLongPress': 'long_pressed',
      'onTouchDown': 'pressed',
      'onTouchUp': 'released',
      'onKeyShortPress': 'key',
      'onKeyLongPress': 'key_long',
      'onSwipeLeft': 'swiped_left',
      'onSwipeRight': 'swiped_right',
      'onSwipeUp': 'swiped_up',
      'onSwipeDown': 'swiped_down',
      'onSwipeLeftQuick': 'swiped_left_quick',
      'onSwipeRightQuick': 'swiped_right_quick',
      'onSwipeUpQuick': 'swiped_up_quick',
      'onSwipeDownQuick': 'swiped_down_quick',
    };
    const suffix = suffixMap[eventType] || 'event';
    return `${componentId}_${suffix}_cb`;
  }
}
