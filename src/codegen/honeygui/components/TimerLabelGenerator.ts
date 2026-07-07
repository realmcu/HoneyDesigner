/**
 * Timer label component code generator
 * Extends LabelGenerator, handles timer functionality
 * 
 * Reference: HoneyGUI/example/application/watch_turnkey_410_502/app_stopwatch.c
 * Core mechanism:
 * 1. Global variables store timer state (time_count, timer_running)
 * 2. Timer callback updates every 10ms (gui_obj_create_timer(obj, 10, -1, callback))
 * 3. Callback updates via time_count += 10 (count-up) or time_count -= 10 (countdown)
 * 4. Control functions (start/stop/reset) manage timer state
 * 5. Button events call control functions instead of toggling show/hide
 */
import { Component } from '../../../hml/types';
import { GeneratorContext } from './ComponentGenerator';
import { LabelGenerator } from './LabelGenerator';

export class TimerLabelGenerator extends LabelGenerator {

  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width, height } = component.position;
    
    // Check if scrolling is enabled
    const enableScroll = component.data?.enableScroll === true || component.data?.enableScroll === 'true';
    
    // Select API based on scrolling
    const createFunction = enableScroll ? 'gui_scroll_text_create' : 'gui_text_create';

    return `${indentStr}${component.id} = ${createFunction}(${parentRef}, "${component.name}", ${x}, ${y}, ${width}, ${height});\n`;
  }

  generatePropertySetters(component: Component, indent: number, _context: GeneratorContext): string {
    let code = '';
    const indentStr = '    '.repeat(indent);

    // Check if scrolling is enabled
    const enableScroll = component.data?.enableScroll === true || component.data?.enableScroll === 'true';
    const scrollDirection = component.data?.scrollDirection || 'horizontal';
    const scrollReverse = component.data?.scrollReverse === true || component.data?.scrollReverse === 'true';

    // Get property values
    const fontSize = component.data?.fontSize || 16;
    const color = component.style?.color || '#ffffff';
    const rgb = this.colorToRgb(color);
    
    // Timer mode: use global variables
    const varName = `${component.id}_time_str`;
    const text = varName;
    const textLengthExpr = `strlen(${varName})`;

    // Determine font type
    const fontType = this.getFontType(component);
    const fontFile = component.data?.fontFile;

    // Select API based on scrolling
    const widgetCast = enableScroll ? 'gui_scroll_text_t' : 'gui_text_t';
    const setFunction = enableScroll ? 'gui_scroll_text_set' : 'gui_text_set';
    
    // Set text content and basic properties
    code += `${indentStr}${setFunction}((${widgetCast} *)${component.id}, ${text}, ${fontType}, gui_rgb(${rgb.r}, ${rgb.g}, ${rgb.b}), ${textLengthExpr}, ${fontSize});\n`;

    // Set font file path (if specified)
    if (fontFile) {
      const convertedFontFile = this.getConvertedFontFileName(component);
      const fontMode = this.getFontMode();
      const typeSetFunction = enableScroll ? 'gui_scroll_text_type_set' : 'gui_text_type_set';
      code += `${indentStr}${typeSetFunction}((${widgetCast} *)${component.id}, "${convertedFontFile}", ${fontMode});\n`;
    }

    // Text alignment - scroll text doesn't need gui_text_mode_set
    if (!enableScroll) {
      const textMode = this.getTextMode(component);
      code += `${indentStr}gui_text_mode_set((gui_text_t *)${component.id}, ${textMode});\n`;
    }

    // Scroll text specific: set scroll parameters
    if (enableScroll) {
      let scrollModeStr: string;
      const vAlign = component.style?.vAlign || 'TOP';
      
      if (scrollDirection === 'horizontal') {
        if (vAlign === 'MID') {
          scrollModeStr = scrollReverse ? 'SCROLL_X_MID_REVERSE' : 'SCROLL_X_MID';
        } else {
          scrollModeStr = scrollReverse ? 'SCROLL_X_REVERSE' : 'SCROLL_X';
        }
      } else {
        scrollModeStr = scrollReverse ? 'SCROLL_Y_REVERSE' : 'SCROLL_Y';
      }
      
      const startOffset = component.data?.scrollStartOffset ?? 0;
      const endOffset = component.data?.scrollEndOffset ?? 0;
      const interval = component.data?.scrollInterval ?? 3000;
      const duration = component.data?.scrollDuration ?? 0;
      
      code += `${indentStr}gui_scroll_text_scroll_set((gui_scroll_text_t *)${component.id}, ${scrollModeStr}, ${startOffset}, ${endOffset}, ${interval}, ${duration});\n`;
    }

    // Letter spacing
    const letterSpacing = component.style?.letterSpacing;
    if (letterSpacing !== undefined && letterSpacing !== 0) {
      code += `${indentStr}gui_text_extra_letter_spacing_set((gui_text_t *)${component.id}, ${letterSpacing});\n`;
    }

    // Line spacing
    const lineSpacing = component.style?.lineSpacing;
    if (lineSpacing !== undefined && lineSpacing !== 0) {
      code += `${indentStr}gui_text_extra_line_spacing_set((gui_text_t *)${component.id}, ${lineSpacing});\n`;
    }

    // Word break protection
    const wordBreak = component.style?.wordBreak;
    if (wordBreak === true) {
      code += `${indentStr}gui_text_wordwrap_set((gui_text_t *)${component.id}, true);\n`;
    }

    // Visibility
    if (component.visible === false) {
      code += `${indentStr}gui_obj_hidden((gui_obj_t *)${component.id}, true);\n`;
    }

    // Timer mode: create timer (10ms interval, infinite loop)
    code += `${indentStr}// Create timer (interval 10ms, infinite loop)\n`;
    code += `${indentStr}gui_obj_create_timer((gui_obj_t *)${component.id}, 10, -1, ${component.id}_timer_cb);\n`;
    
    // Determine whether to auto-start
    const autoStart = component.data?.timerAutoStart !== false; // Auto-start by default
    if (autoStart) {
      code += `${indentStr}${component.id}_start();\n`;
    }

    return code;
  }

  /**
   * Generate timer-related global variables and callback functions
   * Based on app_stopwatch.c implementation
   */
  generateTimerGlobals(component: Component): string {
    let code = '';
    const varName = `${component.id}_time_str`;
    
    // Get timer configuration (compatible with timerFormat and timerDisplayFormat)
    const timerType = component.data?.timerType || 'stopwatch'; // stopwatch or countdown
    const displayFormat = component.data?.timerFormat || component.data?.timerDisplayFormat || 'HH:MM:SS';
    const initialValue = component.data?.timerInitialValue || 0; // milliseconds
    
    // Calculate initial display string
    const initialDisplay = this.formatTime(initialValue, displayFormat);
    
    // Global variables: timer state
    code += `// ${component.id} timer global variables\n`;
    code += `static uint32_t ${component.id}_time_count = ${initialValue}; // milliseconds\n`;
    code += `static bool ${component.id}_timer_running = false;\n`;
    code += `static char ${varName}[16] = "${initialDisplay}";\n\n`;
    
    // Format function: generate time string based on display format
    code += `// ${component.id} format time string\n`;
    code += `static void ${component.id}_format_time(void)\n`;
    code += `{\n`;
    
    switch (displayFormat) {
      case 'HH:MM:SS':
        code += `    uint32_t hours = ${component.id}_time_count / 3600000;\n`;
        code += `    uint32_t minutes = (${component.id}_time_count % 3600000) / 60000;\n`;
        code += `    uint32_t seconds = (${component.id}_time_count % 60000) / 1000;\n`;
        code += `    snprintf(${varName}, sizeof(${varName}), "%02u:%02u:%02u", hours, minutes, seconds);\n`;
        break;
      case 'MM:SS':
        code += `    uint32_t minutes = ${component.id}_time_count / 60000;\n`;
        code += `    uint32_t seconds = (${component.id}_time_count % 60000) / 1000;\n`;
        code += `    snprintf(${varName}, sizeof(${varName}), "%02u:%02u", minutes, seconds);\n`;
        break;
      case 'MM:SS:MS':
        code += `    uint32_t minutes = ${component.id}_time_count / 60000;\n`;
        code += `    uint32_t seconds = (${component.id}_time_count % 60000) / 1000;\n`;
        code += `    uint32_t centiseconds = (${component.id}_time_count % 1000) / 10;\n`;
        code += `    snprintf(${varName}, sizeof(${varName}), "%02u:%02u.%02u", minutes, seconds, centiseconds);\n`;
        break;
      case 'SS':
        code += `    uint32_t seconds = ${component.id}_time_count / 1000;\n`;
        code += `    snprintf(${varName}, sizeof(${varName}), "%02u", seconds);\n`;
        break;
      default:
        code += `    snprintf(${varName}, sizeof(${varName}), "%u", ${component.id}_time_count);\n`;
    }
    
    code += `}\n\n`;
    
    // Timer callback function: updates every 10ms
    code += `// ${component.id} timer callback (called every 10ms)\n`;
    code += `static void ${component.id}_timer_cb(void *obj)\n`;
    code += `{\n`;
    code += `    if (!${component.id}_timer_running) {\n`;
    code += `        return;\n`;
    code += `    }\n\n`;
    
    if (timerType === 'countdown') {
      // Countdown mode
      code += `    // Countdown mode\n`;
      code += `    if (${component.id}_time_count >= 10) {\n`;
      code += `        ${component.id}_time_count -= 10;\n`;
      code += `    } else {\n`;
      code += `        ${component.id}_time_count = 0;\n`;
      code += `        ${component.id}_timer_running = false;\n`;
      code += `        gui_obj_stop_timer((gui_obj_t *)obj);\n`;
      code += `    }\n`;
    } else {
      // Count-up mode (stopwatch)
      code += `    // Count-up mode\n`;
      code += `    ${component.id}_time_count += 10;\n`;
    }
    
    code += `\n`;
    code += `    ${component.id}_format_time();\n`;
    code += `    gui_text_content_set((gui_text_t *)obj, ${varName}, strlen(${varName}));\n`;
    code += `}\n\n`;
    
    // Control function: start timer
    code += `// ${component.id} start timer\n`;
    code += `void ${component.id}_start(void)\n`;
    code += `{\n`;
    code += `    ${component.id}_timer_running = true;\n`;
    code += `    gui_obj_start_timer((gui_obj_t *)${component.id});\n`;
    code += `}\n\n`;
    
    // Control function: stop timer
    code += `// ${component.id} stop timer\n`;
    code += `void ${component.id}_stop(void)\n`;
    code += `{\n`;
    code += `    ${component.id}_timer_running = false;\n`;
    code += `    gui_obj_stop_timer((gui_obj_t *)${component.id});\n`;
    code += `}\n\n`;
    
    // Control function: reset timer
    code += `// ${component.id} reset timer\n`;
    code += `void ${component.id}_reset(void)\n`;
    code += `{\n`;
    code += `    ${component.id}_time_count = ${initialValue};\n`;
    code += `    ${component.id}_timer_running = false;\n`;
    code += `    ${component.id}_format_time();\n`;
    code += `    gui_text_content_set((gui_text_t *)${component.id}, ${varName}, strlen(${varName}));\n`;
    code += `}\n\n`;
    
    return code;
  }

  /**
   * Generate timer control function header declarations
   */
  generateTimerHeaders(component: Component): string {
    let code = '';
    code += `// ${component.id} timer control functions\n`;
    code += `void ${component.id}_start(void);\n`;
    code += `void ${component.id}_stop(void);\n`;
    code += `void ${component.id}_reset(void);\n\n`;
    return code;
  }

  /**
   * Format time (for generating initial display string)
   */
  private formatTime(ms: number, format: string): string {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const centiseconds = Math.floor((ms % 1000) / 10);
    
    switch (format) {
      case 'HH:MM:SS':
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      case 'MM:SS':
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      case 'MM:SS:MS':
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
      case 'SS':
        return seconds.toString().padStart(2, '0');
      default:
        return ms.toString();
    }
  }
}
