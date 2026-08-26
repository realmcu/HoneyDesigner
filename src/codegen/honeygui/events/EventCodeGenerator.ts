/**
 * Event code generator base interface
 */
import { Component } from '../../../hml/types';
import { EventConfig } from '../../../hml/eventTypes';
import { presetTimerStateNames, timerReloadArg } from '../PresetTimerModel';

export interface EventCodeGenerator {
  /**
   * Generate event binding code
   */
  generateEventBindings(component: Component, indent: number, componentMap: Map<string, Component>): string;

  /**
   * Collect callback function names to generate
   */
  collectCallbackFunctions(component: Component): string[];

  /**
   * Get unified event callback implementations (all events except onMessage)
   */
  getEventCallbackImpl?(component: Component, componentMap: Map<string, Component>): string[];

  /**
   * Get onMessage callback implementation (optional)
   */
  getMessageCallbackImpl?(component: Component, componentMap: Map<string, Component>): string[];

  /**
   * Get key event callback implementation (optional)
   */
  getKeyEventCallbackImpl?(component: Component, componentMap: Map<string, Component>): string[];
}

/**
 * Mapping from event type to GUI_EVENT
 */
export const EVENT_TYPE_TO_GUI_EVENT: Record<string, string> = {
  // Touch events
  'onClick': 'GUI_EVENT_TOUCH_CLICKED',
  'onLongPress': 'GUI_EVENT_TOUCH_LONG',
  'onTouchDown': 'GUI_EVENT_TOUCH_PRESSED',
  'onTouchUp': 'GUI_EVENT_TOUCH_RELEASED',
  // Key events
  'onKeyShortPress': 'GUI_EVENT_KB_SHORT_PRESSED',
  'onKeyLongPress': 'GUI_EVENT_KB_LONG_PRESSED',
  // Swipe events
  'onSwipeLeft': 'GUI_EVENT_TOUCH_MOVE_LEFT',
  'onSwipeRight': 'GUI_EVENT_TOUCH_MOVE_RIGHT',
  'onSwipeUp': 'GUI_EVENT_TOUCH_MOVE_UP',
  'onSwipeDown': 'GUI_EVENT_TOUCH_MOVE_DOWN',
  // Quick slide events (edge of screen)
  'onSwipeLeftQuick': 'GUI_EVENT_TOUCH_LEFT_SLIDE_QUICK',
  'onSwipeRightQuick': 'GUI_EVENT_TOUCH_RIGHT_SLIDE_QUICK',
  'onSwipeUpQuick': 'GUI_EVENT_TOUCH_UP_SLIDE_QUICK',
  'onSwipeDownQuick': 'GUI_EVENT_TOUCH_DOWN_SLIDE_QUICK',
};

/**
 * Mapping from event type to callback function name suffix
 */
export const EVENT_TYPE_TO_CALLBACK_SUFFIX: Record<string, string> = {
  'onClick': 'clicked',
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

/**
 * Generate callback function name based on event type
 * @param componentId Component ID
 * @param eventType Event type
 * @param index Index (multiple callbacks may exist for the same event type)
 */
export function generateEventCallbackName(componentId: string, eventType: string, index: number): string {
  const suffix = EVENT_TYPE_TO_CALLBACK_SUFFIX[eventType] || 'event';
  return `${componentId}_${suffix}_${index}_cb`;
}

/**
 * Generate onMessage callback function name
 */
export function getMessageCallbackName(component: Component, eventConfig: EventConfig, eventIndex: number): string {
  // Prefer user-specified handler
  if (eventConfig.handler) {
    return eventConfig.handler;
  }
  // Auto-generate: {componentId}_msg_cb_{index}
  return `${component.id}_msg_cb_${eventIndex}`;
}

/**
 * Generate event-type-based callback implementation (for controlTimer actions etc.)
 */
export function generateControlTimerCallbackImpl(component: Component, componentMap: Map<string, Component>): string[] {
  const impls: string[] = [];
  if (!component.eventConfigs) return impls;

  // Maintain independent index per event type
  const eventTypeIndexMap = new Map<string, number>();

  component.eventConfigs.forEach(eventConfig => {
    if (eventConfig.type === 'onMessage') return;

    // Skip key events (controlTimer for key events is handled in generateKeyEventCallbackImpl)
    if ((eventConfig.type === 'onKeyShortPress' || eventConfig.type === 'onKeyLongPress') && eventConfig.keyName) {
      return;
    }

    // Check for controlTimer actions
    const controlTimerActions = eventConfig.actions.filter(a => 
      a.type === 'controlTimer' && a.timerTargets && a.timerTargets.length > 0
    );

    if (controlTimerActions.length === 0) return;

    // Get the index for the current event type
    const currentIndex = eventTypeIndexMap.get(eventConfig.type) || 0;
    eventTypeIndexMap.set(eventConfig.type, currentIndex + controlTimerActions.length);

    // Generate independent callback for each controlTimer action
    controlTimerActions.forEach((action, actionIndex) => {
      const callbackName = generateEventCallbackName(component.id, eventConfig.type, currentIndex + actionIndex);

      let callbackBody = ``;

      action.timerTargets!.forEach(target => {
        const targetComp = componentMap.get(target.componentId);
        if (!targetComp) return;

        // Check if this is a timer label
        const isTimerLabel = targetComp.type === 'hg_timer_label';

        if (isTimerLabel) {
          // Timer label start/stop control (using generated control functions)
          if (target.action === 'start') {
            callbackBody += `    ${target.componentId}_start();\n`;
          } else if (target.action === 'stop') {
            callbackBody += `    ${target.componentId}_stop();\n`;
          } else if (target.action === 'reset') {
            callbackBody += `    ${target.componentId}_reset();\n`;
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
              callbackBody += `    ${presetTimerStateNames(target.componentId).resetFn}();\n`;
            }
            callbackBody += `    gui_obj_create_timer(GUI_BASE(${target.componentId}), ${timer.interval}, ${timerReloadArg(isPreset, timer.reload ? 'true' : 'false')}, ${callback});\n`;
            callbackBody += `    gui_obj_start_timer(GUI_BASE(${target.componentId}));\n`;
          } else if (target.action === 'stop') {
            // Stop timer
            callbackBody += `    if (GUI_BASE(${target.componentId})->timer) {\n`;
            callbackBody += `        gui_obj_stop_timer(GUI_BASE(${target.componentId}));\n`;
            callbackBody += `    }\n`;
          }
        }
      });

      impls.push(`void ${callbackName}(void *obj, gui_event_t *e)\n{\n    GUI_UNUSED(obj);\n    GUI_UNUSED(e);\n${callbackBody}}`);
    });
  });

  return impls;
}

/**
 * Common function for generating onMessage callback implementations
 */
export function generateMessageCallbackImpl(component: Component, componentMap: Map<string, Component>): string[] {
  const impls: string[] = [];
  if (!component.eventConfigs) return impls;

  // Track onMessage event index
  let msgIndex = 0;
  component.eventConfigs.forEach(eventConfig => {
    if (eventConfig.type !== 'onMessage' || !eventConfig.message) return;

    // Use handler property as callback name if available
    const callbackName = eventConfig.handler || getMessageCallbackName(component, eventConfig, msgIndex);
    msgIndex++;
    
    let body = '';

    // Generate corresponding code if actions exist
    if (eventConfig.actions && eventConfig.actions.length > 0) {
      eventConfig.actions.forEach(action => {
        if (action.type === 'callFunction' && action.functionName) {
          body += `    ${action.functionName}(obj, topic, data, len);\n`;
        } else if (action.type === 'switchView' && action.target) {
          const targetComponent = componentMap.get(action.target);
          const targetName = targetComponent?.name || action.target;
          const switchOutStyle = action.switchOutStyle || 'SWITCH_OUT_TO_LEFT_USE_TRANSLATION';
          const switchInStyle = action.switchInStyle || 'SWITCH_IN_FROM_RIGHT_USE_TRANSLATION';
          body += `    gui_view_switch_direct(gui_view_get_current(), "${targetName}", ${switchOutStyle}, ${switchInStyle});\n`;
        } else if (action.type === 'sendMessage' && action.message) {
          body += `    gui_msg_publish("${action.message}", data, len);\n`;
        } else if (action.type === 'controlTimer' && action.timerTargets && action.timerTargets.length > 0) {
          // Control animation timer
          action.timerTargets.forEach(target => {
            const targetComp = componentMap.get(target.componentId);
            if (!targetComp) return;
            
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
                body += `    ${presetTimerStateNames(target.componentId).resetFn}();\n`;
              }
              body += `    gui_obj_create_timer(GUI_BASE(${target.componentId}), ${timer.interval}, ${timerReloadArg(isPreset, timer.reload ? 'true' : 'false')}, ${callback});\n`;
              body += `    gui_obj_start_timer(GUI_BASE(${target.componentId}));\n`;
            } else if (target.action === 'stop') {
              // Stop timer
              body += `    if (GUI_BASE(${target.componentId})->timer) {\n`;
              body += `        gui_obj_stop_timer(GUI_BASE(${target.componentId}));\n`;
              body += `    }\n`;
            }
          });
        }
      });
    }

    // Generate TODO comment if no actions or body is empty
    if (!body) {
      body = `    // TODO: Implement message handling logic\n`;
    }
    
    impls.push(`void ${callbackName}(gui_obj_t *obj, const char *topic, void *data, uint16_t len)
{
    GUI_UNUSED(obj);
    GUI_UNUSED(topic);
    GUI_UNUSED(data);
    GUI_UNUSED(len);
${body}}`);
  });

  return impls;
}

/**
 * Common function for generating key event callback implementations.
 * Same-type key events (short/long press) on the same component generate only one callback.
 * Different keys are distinguished via strcmp(e->indev_name, "keyName") inside the callback.
 */
export function generateKeyEventCallbackImpl(component: Component, componentMap: Map<string, Component>): string[] {
  const impls: string[] = [];
  if (!component.eventConfigs) return impls;

  // Group by event type (onKeyShortPress and onKeyLongPress)
  const keyEventGroups = new Map<string, EventConfig[]>();
  
  component.eventConfigs.forEach(eventConfig => {
    if ((eventConfig.type !== 'onKeyShortPress' && eventConfig.type !== 'onKeyLongPress') || !eventConfig.keyName) {
      return;
    }
    
    if (!keyEventGroups.has(eventConfig.type)) {
      keyEventGroups.set(eventConfig.type, []);
    }
    keyEventGroups.get(eventConfig.type)!.push(eventConfig);
  });

  // Generate one callback per event type
  let keyEventIndex = 0;
  keyEventGroups.forEach((eventConfigs, eventType) => {
    const callbackName = `${component.id}_key_${keyEventIndex}_cb`;
    keyEventIndex++;

    let callbackBody = '';

    // Generate if-else branches for each key name
    eventConfigs.forEach((eventConfig, index) => {
      const isFirst = index === 0;
      const isLast = index === eventConfigs.length - 1;

      // Generate condition check
      if (isFirst) {
        callbackBody += `    // Check key name\n`;
        callbackBody += `    if (strcmp(e->indev_name, "${eventConfig.keyName}") == 0)\n    {\n`;
      } else {
        callbackBody += `    else if (strcmp(e->indev_name, "${eventConfig.keyName}") == 0)\n    {\n`;
      }

      // Generate action code
      if (eventConfig.actions && eventConfig.actions.length > 0) {
        eventConfig.actions.forEach(action => {
          if (action.type === 'callFunction' && action.functionName) {
            callbackBody += `        ${action.functionName}(obj, e);\n`;
          } else if (action.type === 'switchView' && action.target) {
            const targetComponent = componentMap.get(action.target);
            const targetName = targetComponent?.name || action.target;
            const switchOutStyle = action.switchOutStyle || 'SWITCH_OUT_TO_LEFT_USE_TRANSLATION';
            const switchInStyle = action.switchInStyle || 'SWITCH_IN_FROM_RIGHT_USE_TRANSLATION';
            callbackBody += `        gui_view_switch_direct(gui_view_get_current(), "${targetName}", ${switchOutStyle}, ${switchInStyle});\n`;
          } else if (action.type === 'sendMessage' && action.message) {
            callbackBody += `        gui_msg_publish("${action.message}", NULL, 0);\n`;
          } else if (action.type === 'controlTimer' && action.timerTargets && action.timerTargets.length > 0) {
            // Control animation timer
            action.timerTargets.forEach(target => {
              const targetComp = componentMap.get(target.componentId);
              if (!targetComp) return;

              // Check if this is a timer label
              const isTimerLabel = targetComp.type === 'hg_label' && targetComp.data?.isTimerLabel === true;

              if (isTimerLabel) {
                // Timer label start/stop control
                if (target.action === 'start') {
                  callbackBody += `        gui_obj_create_timer((void *)${target.componentId}, 10, -1, ${target.componentId}_timer_update_cb);\n`;
                  callbackBody += `        gui_obj_start_timer((void *)${target.componentId});\n`;
                } else if (target.action === 'stop') {
                  callbackBody += `        if (GUI_BASE(${target.componentId})->timer) {\n`;
                  callbackBody += `            gui_obj_stop_timer((void *)${target.componentId});\n`;
                  callbackBody += `        }\n`;
                }
              } else {
                // Regular timer start/stop control
                const timers = targetComp.data?.timers;
                if (!timers || !Array.isArray(timers)) return;

                const timer = timers[target.timerIndex || 0];
                if (!timer) return;

                if (target.action === 'start') {
                  const isPreset = timer.mode === 'preset';
                  const callback = isPreset
                    ? `${target.componentId}_${timer.id}_cb`
                    : (timer.callback || `${target.componentId}_timer_cb`);
                  if (isPreset) {
                    // Replay the animation from the start of its timeline
                    callbackBody += `        ${presetTimerStateNames(target.componentId).resetFn}();\n`;
                  }
                  callbackBody += `        gui_obj_create_timer(GUI_BASE(${target.componentId}), ${timer.interval}, ${timerReloadArg(isPreset, timer.reload ? 'true' : 'false')}, ${callback});\n`;
                  callbackBody += `        gui_obj_start_timer(GUI_BASE(${target.componentId}));\n`;
                } else if (target.action === 'stop') {
                  callbackBody += `        if (GUI_BASE(${target.componentId})->timer) {\n`;
                  callbackBody += `            gui_obj_stop_timer(GUI_BASE(${target.componentId}));\n`;
                  callbackBody += `        }\n`;
                }
              }
            });
          }
        });
      } else {
        // Generate TODO comment if no actions
        callbackBody += `        // TODO: Implement key event handling logic\n`;
      }

      callbackBody += `    }\n`;
    });

    impls.push(`void ${callbackName}(void *obj, gui_event_t *e)
{
    GUI_UNUSED(obj);
    GUI_UNUSED(e);
${callbackBody}}`);
  });

  return impls;
}
