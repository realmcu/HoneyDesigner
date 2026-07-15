/**
 * hg_view component code generator
 * Generates view code using the GUI_VIEW_INSTANCE macro
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';
import { convertColor } from '../utils';

// Event type to GUI_EVENT mapping (for view switch events)
// Note: Key events (onKeyShortPress, onKeyLongPress) should use gui_obj_add_event_cb, not gui_view_switch_on_event
const VIEW_SWITCH_EVENT_MAP: Record<string, string> = {
  // Touch events
  'onClick': 'GUI_EVENT_TOUCH_CLICKED',
  'onLongPress': 'GUI_EVENT_TOUCH_LONG',
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

export class ViewGenerator implements ComponentCodeGenerator {
  
  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const name = component.name;
    // Handle residentMemory correctly: support both boolean and string types
    const residentMemoryValue = component.data?.residentMemory;
    const residentMemory = residentMemoryValue === true || residentMemoryValue === 'true';
    // Handle snapShot correctly: support both boolean and string types
    const snapShotValue = component.data?.snapShot;
    const snapShot = snapShotValue === true || snapShotValue === 'true';
    // Default animation step is 1/10 of screen height
    const defaultAnimateStep = Math.round(component.position.height / 10);
    const animateStep = component.data?.animateStep ?? defaultAnimateStep;
    // Default opacity 255 (fully opaque), ensure numeric type
    // Read from data first, fallback to style
    const opacityValue = component.data?.opacity ?? component.style?.opacity;
    const opacity = opacityValue !== undefined ? Number(opacityValue) : 255;

    let code = '';
    
    // Generate switch_out callback
    const switchOutFunc = component.data?.switchOutFunctionName as string | undefined;
    code += `${indentStr}static void ${name}_switch_out(gui_view_t *view)\n`;
    code += `${indentStr}{\n`;
    if (switchOutFunc) {
      code += `${indentStr}    ${switchOutFunc}(view);\n`;
    } else {
      code += `${indentStr}    GUI_UNUSED(view);\n`;
    }
    code += `${indentStr}}\n\n`;
    
    // Generate switch_in callback
    code += `${indentStr}static void ${name}_switch_in(gui_view_t *view)\n`;
    code += `${indentStr}{\n`;

    // Set animation step (always set, using default or user-configured value)
    code += `${indentStr}    // Set animation step\n`;
    code += `${indentStr}    gui_view_set_animate_step(view, ${animateStep});\n`;
    code += '\n';

    // Set opacity
    code += `${indentStr}    // Set opacity\n`;
    code += `${indentStr}    gui_view_set_opacity(view, ${opacity});\n`;

    // Set background color if specified
    const bgColor = component.style?.backgroundColor;
    if (bgColor) {
      code += '\n';
      code += `${indentStr}    // Set background color\n`;
      code += `${indentStr}    gui_view_set_bg_color(view, ${convertColor(bgColor)});\n`;
    }
    
    // Generate timer binding code for hg_view (placed after setter calls)
    const viewTimerBindings = this.generateViewTimerBindings(component, indent + 1);
    if (viewTimerBindings.trim()) {
      code += '\n';
      code += viewTimerBindings;
    }
    
    code += '\n';
    
    // Register view switch events
    const switchViewEvents = this.extractSwitchViewEvents(component, context);
    if (switchViewEvents.length > 0) {
      switchViewEvents.forEach(({ guiEvent, targetName, switchOutStyle, switchInStyle }) => {
        code += `${indentStr}    gui_view_switch_on_event(view, "${targetName}", ${switchOutStyle}, ${switchInStyle}, ${guiEvent});\n`;
      });
    } else {
      // Add GUI_UNUSED when no view switch events
      code += `${indentStr}    GUI_UNUSED(view);\n`;
    }
    
    // Initialize time string variables (declare once at function start to avoid duplicates)
    // Collect all time labels (including those in windows) to ensure now and t variables are declared
    const allTimeLabels = this.collectAllTimeLabels(component, context);
    const hasTimeLabels = allTimeLabels.length > 0;
    
    // Initialize time labels only from direct view children (excluding those in windows)
    const viewTimeLabels = this.collectViewTimeLabels(component, context);
    
    if (hasTimeLabels) {
      code += `\n${indentStr}    // Initialize time strings\n`;
      code += `${indentStr}    time_t now = time(NULL);\n`;
      code += `${indentStr}    struct tm *t = localtime(&now);\n`;
      if (viewTimeLabels.length > 0) {
        code += `${indentStr}    if (t != NULL)\n`;
        code += `${indentStr}    {\n`;
        viewTimeLabels.forEach(labelId => {
          const labelComp = context.componentMap.get(labelId);
          const timeFormat = labelComp?.data?.timeFormat;
          const formatCode = this.getTimeFormatCode(timeFormat);
          code += `${indentStr}        snprintf(${labelId}_time_str, sizeof(${labelId}_time_str), "${formatCode.format}", ${formatCode.args});\n`;
        });
        code += `${indentStr}    }\n`;
      }
      code += '\n';
    }
    
    // Child component creation handled by main generator (via childrenCode callback)
    code += `__CHILDREN_PLACEHOLDER__`;
    
    // Event binding code placeholder (filled by main generator)
    code += `__EVENT_BINDINGS_PLACEHOLDER__`;
    
    // Create timers for time labels in direct view children (those in windows are handled by WindowGenerator)
    if (viewTimeLabels.length > 0) {
      code += `\n${indentStr}    // Create time update timer\n`;
      viewTimeLabels.forEach(labelId => {
        const labelComp = context.componentMap.get(labelId);
        const timeFormat = labelComp?.data?.timeFormat;
        // Skip split time format (timer already created in LabelGenerator)
        if (timeFormat === 'HH:mm-split') {
          return;
        }
        const interval = this.getTimerInterval(timeFormat);
        code += `${indentStr}    gui_obj_create_timer(GUI_BASE(${labelId}), ${interval}, true, ${labelId}_time_update_cb);\n`;
      });
    }
    
    code += `${indentStr}}\n`;
    
    // GUI_VIEW_INSTANCE macro call — always uses 5 args (snap_shot is last)
    code += `${indentStr}GUI_VIEW_INSTANCE("${name}", ${residentMemory ? 'true' : 'false'}, ${name}_switch_in, ${name}_switch_out, ${snapShot ? 'true' : 'false'});\n`;

    return code;
  }

  generatePropertySetters(component: Component, indent: number, _context: GeneratorContext): string {
    let code = '';
    const indentStr = '    '.repeat(indent);

    // Visibility
    if (component.visible === false) {
      code += `${indentStr}gui_obj_hidden((gui_obj_t *)${component.id}, true);\n`;
    }

    return code;
  }

  /**
   * Extract switchView events from eventConfigs
   */
  private extractSwitchViewEvents(component: Component, context: GeneratorContext): Array<{
    guiEvent: string;
    targetName: string;
    switchOutStyle: string;
    switchInStyle: string;
  }> {
    const result: Array<{
      guiEvent: string;
      targetName: string;
      switchOutStyle: string;
      switchInStyle: string;
    }> = [];

    if (!component.eventConfigs) return result;

    component.eventConfigs.forEach(eventConfig => {
      const guiEvent = VIEW_SWITCH_EVENT_MAP[eventConfig.type];
      if (!guiEvent) return;

      eventConfig.actions.forEach(action => {
        if (action.type === 'switchView' && action.target) {
          const targetComponent = context.componentMap.get(action.target);
          const targetName = targetComponent?.name || action.target;
          result.push({
            guiEvent,
            targetName,
            switchOutStyle: action.switchOutStyle || 'SWITCH_OUT_TO_LEFT_USE_TRANSLATION',
            switchInStyle: action.switchInStyle || 'SWITCH_IN_FROM_RIGHT_USE_TRANSLATION',
          });
        }
      });
    });

    return result;
  }

  /**
   * Collect all time labels (including those in windows)
   * Used to determine whether now and t variables need to be declared
   */
  private collectAllTimeLabels(component: Component, context: GeneratorContext): string[] {
    const timeLabels: string[] = [];
    
    const collectRecursive = (comp: Component) => {
      // Check if current component is a time label
      if (comp.type === 'hg_time_label') {
        timeLabels.push(comp.id);
      }
      
      // Recursively check all child components (including hg_window)
      if (comp.children) {
        comp.children.forEach(childId => {
          const child = context.componentMap.get(childId);
          if (child) {
            collectRecursive(child);
          }
        });
      }
    };
    
    collectRecursive(component);
    return timeLabels;
  }

  /**
   * Collect time labels from direct view children (excluding those in windows)
   * Used for generating initialization code and timers
   */
  private collectViewTimeLabels(component: Component, context: GeneratorContext): string[] {
    const timeLabels: string[] = [];
    
    const collectRecursive = (comp: Component) => {
      // Check if current component is a time label
      if (comp.type === 'hg_time_label') {
        timeLabels.push(comp.id);
      }
      
      // Recursively check child components, but skip hg_window
      if (comp.children) {
        comp.children.forEach(childId => {
          const child = context.componentMap.get(childId);
          if (child && child.type !== 'hg_window') {
            collectRecursive(child);
          }
        });
      }
    };
    
    collectRecursive(component);
    return timeLabels;
  }

  /**
   * Get timer interval in milliseconds based on time format
   */
  private getTimerInterval(timeFormat?: string): number {
    if (!timeFormat) return 500;
    
    switch (timeFormat) {
      case 'HH:mm:ss':
      case 'YYYY-MM-DD HH:mm:ss':
        return 500; // With seconds: 500ms
      case 'HH:mm':
      case 'MM-DD HH:mm':
        return 30000; // Hours/minutes only: 30s
      case 'HH':
      case 'mm':
        return 30000; // Hours or minutes only: 30s
      case 'YYYY-MM-DD':
        return 60000; // Date only: 60s
      default:
        return 500;
    }
  }

  /**
   * Get sprintf format code based on time format
   */
  private getTimeFormatCode(timeFormat?: string): { format: string; args: string } {
    switch (timeFormat) {
      case 'HH:mm:ss':
        return {
          format: '%02d:%02d:%02d',
          args: 't->tm_hour, t->tm_min, t->tm_sec'
        };
      case 'HH:mm':
      case 'HH:mm-split':  // Split time format uses same format
        return {
          format: '%02d:%02d',
          args: 't->tm_hour, t->tm_min'
        };
      case 'HH':
        return {
          format: '%02d',
          args: 't->tm_hour'
        };
      case 'mm':
        return {
          format: '%02d',
          args: 't->tm_min'
        };
      case 'YYYY-MM-DD':
        return {
          format: '%04d-%02d-%02d',
          args: '(t->tm_year + 1900) % 10000, t->tm_mon + 1, t->tm_mday'
        };
      case 'YYYY-MM-DD HH:mm:ss':
        return {
          format: '%04d-%02d-%02d %02d:%02d:%02d',
          args: '(t->tm_year + 1900) % 10000, t->tm_mon + 1, t->tm_mday, t->tm_hour, t->tm_min, t->tm_sec'
        };
      case 'MM-DD HH:mm':
        return {
          format: '%02d-%02d %02d:%02d',
          args: 't->tm_mon + 1, t->tm_mday, t->tm_hour, t->tm_min'
        };
      default:
        return {
          format: '%02d:%02d:%02d',
          args: 't->tm_hour, t->tm_min, t->tm_sec'
        };
    }
  }

  /**
   * Generate timer binding code for hg_view component
   * Uses function parameter view instead of component name
   */
  private generateViewTimerBindings(component: Component, indent: number): string {
    const indentStr = '    '.repeat(indent);
    const timers = component.data?.timers;
    
    if (!timers || !Array.isArray(timers) || timers.length === 0) {
      return '';
    }

    let code = '';

    // Filter enabled timers
    const enabledTimers = timers.filter((timer: any) => timer.enabled !== false);
    
    if (enabledTimers.length === 0) {
      return '';
    }

    enabledTimers.forEach((timer: any) => {
      let callback: string;
      // Preset action mode: supports segments (multi-step animation) or actions (single-step animation)
      if (timer.mode === 'preset' && ((timer.segments && timer.segments.length > 0) || (timer.actions && timer.actions.length > 0))) {
        // Preset action mode: generate callback function name from timer ID
        callback = `${component.id}_${timer.id}_cb`;
      } else if (timer.mode === 'custom' && timer.callback) {
        // Custom function mode
        callback = timer.callback;
      } else {
        return; // Skip invalid configuration
      }

      const timerName = timer.name || timer.id;
      code += `${indentStr}// Bind timer: ${timerName}\n`;
      code += `${indentStr}gui_obj_create_timer((gui_obj_t *)view, ${timer.interval}, ${timer.reload !== false ? 'true' : 'false'}, ${callback});\n`;
      // If not set to run immediately, call gui_obj_start_timer
      if (!timer.runImmediately) {
        code += `${indentStr}gui_obj_start_timer((gui_obj_t *)view);\n`;
      }
    });

    return code;
  }
}
