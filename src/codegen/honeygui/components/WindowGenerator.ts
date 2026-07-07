/**
 * hg_window component code generator
 * Maps to HoneyGUI gui_win API
 * 
 * Differences from hg_view:
 * - Uses gui_win_create instead of GUI_VIEW_INSTANCE
 * - Supports blur effect (gui_win_enable_blur, gui_win_set_blur_degree)
 * - No view switching support
 * 
 * Handle type: gui_obj_t * (used directly in handle definition)
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';

export class WindowGenerator implements ComponentCodeGenerator {
  
  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    
    // Get position and dimensions
    const { x, y, width, height } = component.position;
    
    // Get blur-related properties
    const enableBlur = component.data?.enableBlur ?? false;
    const blurDegree = component.data?.blurDegree ?? 225; // Default: 225
    
    let code = '';
    
    // Create window
    code += `${indentStr}${component.id} = gui_win_create(${parentRef}, "${component.id}", ${x}, ${y}, ${width}, ${height});\n`;
    
    // Set blur effect
    if (enableBlur) {
      code += `${indentStr}gui_win_enable_blur((gui_win_t *)${component.id}, true);\n`;
      code += `${indentStr}gui_win_set_blur_degree((gui_win_t *)${component.id}, ${blurDegree});\n`;
    }
    
    // Set visibility (consistent with hg_image)
    if (component.visible === false) {
      code += `${indentStr}gui_obj_hidden((gui_obj_t *)${component.id}, true);\n`;
    }

    // Generate timer binding code (before child components)
    if (context.generateTimerBindings) {
      code += context.generateTimerBindings(component, indent);
    }

    
    // Time label initialization code in window
    const timeLabels = this.collectTimeLabels(component, context);
    if (timeLabels.length > 0) {
      if (context.isInsideListItem) {
        // Inside list_item (note_design callback): t is not declared, need to declare it locally
        code += `\n${indentStr}// Initialize time strings\n`;
        code += `${indentStr}{\n`;
        code += `${indentStr}    time_t now = time(NULL);\n`;
        code += `${indentStr}    struct tm *t = localtime(&now);\n`;
        code += `${indentStr}    if (t != NULL)\n`;
        code += `${indentStr}    {\n`;
        timeLabels.forEach(labelId => {
          const labelComp = context.componentMap.get(labelId);
          const timeFormat = labelComp?.data?.timeFormat;
          const formatCode = this.getTimeFormatCode(timeFormat);
          code += `${indentStr}        snprintf(${labelId}_time_str, sizeof(${labelId}_time_str), "${formatCode.format}", ${formatCode.args});\n`;
        });
        code += `${indentStr}    }\n`;
        code += `${indentStr}}\n`;
      } else {
        // Inside view's switch_in: t is already declared
        code += `\n${indentStr}// Initialize time strings (using now and t variables declared in view)\n`;
        code += `${indentStr}if (t != NULL)\n`;
        code += `${indentStr}{\n`;
        timeLabels.forEach(labelId => {
          const labelComp = context.componentMap.get(labelId);
          const timeFormat = labelComp?.data?.timeFormat;
          const formatCode = this.getTimeFormatCode(timeFormat);
          code += `${indentStr}    snprintf(${labelId}_time_str, sizeof(${labelId}_time_str), "${formatCode.format}", ${formatCode.args});\n`;
        });
        code += `${indentStr}}\n`;
      }
    }
    // Child component creation handled by main generator (via childrenCode callback)
    code += `__CHILDREN_PLACEHOLDER__`;
    
    // Event binding code placeholder (filled by main generator)
    code += `__EVENT_BINDINGS_PLACEHOLDER__`;
    
    // Create timers for all labels with time format
    if (timeLabels.length > 0) {
      code += `\n${indentStr}// Create time update timer\n`;
      timeLabels.forEach(labelId => {
        const labelComp = context.componentMap.get(labelId);
        const timeFormat = labelComp?.data?.timeFormat;
        // Skip split time format (timer already created in LabelGenerator)
        if (timeFormat === 'HH:mm-split') {
          return;
        }
        const interval = this.getTimerInterval(timeFormat);
        code += `${indentStr}gui_obj_create_timer(GUI_BASE(${labelId}), ${interval}, true, ${labelId}_time_update_cb);\n`;
      });
    }
    
    return code;
  }

  generatePropertySetters(_component: Component, _indent: number, _context: GeneratorContext): string {
    // Window component properties are set during creation
    return '';
  }

  /**
   * Collect all time label components under current window
   */
  private collectTimeLabels(component: Component, context: GeneratorContext): string[] {
    const timeLabels: string[] = [];
    
    const collectRecursive = (comp: Component) => {
      // Check if current component is a time label
      if (comp.type === 'hg_time_label') {
        timeLabels.push(comp.id);
      }
      
      // Recursively check child components
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
}
