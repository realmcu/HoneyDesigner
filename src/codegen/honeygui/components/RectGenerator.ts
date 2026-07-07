/**
 * hg_rect component code generator
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';
import { convertColor, convertColorWithOpacity, convertColorToRgba } from '../utils';

export class RectGenerator implements ComponentCodeGenerator {
  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width, height } = component.position;
    
    // Get parameters from style with defaults
    let borderRadius = component.style?.borderRadius || 0;
    
    // Limit border radius: cannot exceed half of width or height
    const maxRadius = Math.min(width / 2, height / 2);
    if (borderRadius > maxRadius) {
      borderRadius = maxRadius;
    }
    
    // Get opacity, default 255 (fully opaque)
    // Read from style first, fallback to data
    const opacity = component.style?.opacity ?? component.data?.opacity ?? 255;
    
    // Check for dual-state button, use color corresponding to initial state
    let fillColor: string;
    const buttonMode = component.data?.buttonMode;
    if (buttonMode === 'dual-state') {
      const initialState = component.data?.buttonInitialState === 'on';
      const onColor = component.data?.buttonStateOnColor || '#00FF00';
      const offColor = component.data?.buttonStateOffColor || '#FF0000';
      const stateColor = initialState ? onColor : offColor;
      
      fillColor = opacity < 255
        ? convertColorWithOpacity(stateColor, opacity)
        : convertColor(stateColor);
    } else {
      // Plain rect uses fillColor
      fillColor = opacity < 255
        ? convertColorWithOpacity(component.style?.fillColor, opacity)
        : convertColor(component.style?.fillColor);
    }

    return `${indentStr}${component.id} = gui_rect_create(${parentRef}, "${component.name}", ${x}, ${y}, ${width}, ${height}, ${borderRadius}, ${fillColor});\n`;
  }

  generatePropertySetters(component: Component, indent: number, _context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    let code = '';

    // Note: opacity already set in gui_rgba, no separate opacity_value needed

    // Gradient settings
    if (component.style?.useGradient && component.data?.gradientStops) {
      const stops = component.data.gradientStops as Array<{ position: number; color: string }>;
      if (stops.length >= 2) {
        const direction = component.style?.gradientDirection || 'horizontal';
        
        // Map direction to SDK enum
        const directionMap: Record<string, string> = {
          'horizontal': 'RECT_GRADIENT_HORIZONTAL',
          'vertical': 'RECT_GRADIENT_VERTICAL',
          'diagonal_tl_br': 'RECT_GRADIENT_DIAGONAL_TL_BR',
          'diagonal_tr_bl': 'RECT_GRADIENT_DIAGONAL_TR_BL'
        };
        
        const sdkDirection = directionMap[direction] || 'RECT_GRADIENT_HORIZONTAL';
        
        code += `${indentStr}// Set linear gradient\n`;
        code += `${indentStr}gui_rect_set_linear_gradient(${component.id}, ${sdkDirection});\n`;
        
        stops.forEach(stop => {
          const color = convertColorToRgba(stop.color);
          // Ensure position is float format (e.g. 0.0f not 0f)
          const position = Number.isInteger(stop.position) 
            ? `${stop.position}.0f` 
            : `${stop.position}f`;
          code += `${indentStr}gui_rect_add_gradient_stop(${component.id}, ${position}, ${color});\n`;
        });
      }
    }

    // Visibility
    if (component.visible === false) {
      code += `${indentStr}gui_obj_hidden((gui_obj_t *)${component.id}, true);\n`;
    }

    return code;
  }

  /**
   * Generate button effect event bindings
   */
  generateEventBinding(component: Component, indent: number): string {
    const buttonMode = component.data?.buttonMode;
    if (!buttonMode || buttonMode === 'none') {
      return '';
    }

    const indentStr = '    '.repeat(indent);
    
    if (buttonMode === 'dual-state') {
      // Dual-state button: use click event
      return `${indentStr}gui_obj_add_event_cb((gui_obj_t *)${component.id}, ${component.id}_button_cb, GUI_EVENT_TOUCH_CLICKED, NULL);\n`;
    } else if (buttonMode === 'opacity') {
      // Opacity button: use press and release events
      let code = '';
      code += `${indentStr}gui_obj_add_event_cb((gui_obj_t *)${component.id}, ${component.id}_button_press_cb, GUI_EVENT_TOUCH_PRESSED, NULL);\n`;
      code += `${indentStr}gui_obj_add_event_cb((gui_obj_t *)${component.id}, ${component.id}_button_release_cb, GUI_EVENT_TOUCH_RELEASED, NULL);\n`;
      return code;
    }

    return '';
  }

  /**
   * Generate button effect callback functions
   */
  generateButtonCallback(component: Component): string {
    const buttonMode = component.data?.buttonMode;
    if (!buttonMode || buttonMode === 'none') {
      return '';
    }

    if (buttonMode === 'dual-state') {
      return this.generateDualStateCallback(component);
    } else if (buttonMode === 'opacity') {
      return this.generateOpacityCallback(component);
    }

    return '';
  }

  /**
   * Generate dual-state button callback
   */
  private generateDualStateCallback(component: Component): string {
    const onColor = component.data?.buttonStateOnColor || '#00FF00';
    const offColor = component.data?.buttonStateOffColor || '#FF0000';
    const initialState = component.data?.buttonInitialState === 'on';

    const onColorRgba = convertColorToRgba(onColor);
    const offColorRgba = convertColorToRgba(offColor);

    return `
// ${component.id} dual-state button callback
static bool ${component.id}_state = ${initialState ? 'true' : 'false'};

void ${component.id}_button_cb(void *obj, gui_event_t *e)
{
    GUI_UNUSED(obj);
    GUI_UNUSED(e);
    
    // Toggle state
    ${component.id}_state = !${component.id}_state;
    
    // Switch color based on state
    if (${component.id}_state) {
        gui_rect_set_color((gui_rect_t *)${component.id}, ${onColorRgba});
    } else {
        gui_rect_set_color((gui_rect_t *)${component.id}, ${offColorRgba});
    }
}

// Get current state
bool ${component.id}_get_state(void)
{
    return ${component.id}_state;
}

// Set state (external call)
void ${component.id}_set_state(bool state)
{
    if (${component.id}_state != state) {
        ${component.id}_state = state;
        
        if (state) {
            gui_rect_set_color((gui_rect_t *)${component.id}, ${onColorRgba});
        } else {
            gui_rect_set_color((gui_rect_t *)${component.id}, ${offColorRgba});
        }
    }
}
`;
  }

  /**
   * Generate opacity button callback (dim on press, restore on release)
   */
  private generateOpacityCallback(component: Component): string {
    const pressedOpacity = component.data?.buttonPressedOpacity || 128;
    const releasedOpacity = component.data?.buttonReleasedOpacity || 255;

    return `
// ${component.id} opacity button callback

// Change opacity on press
void ${component.id}_button_press_cb(void *obj, gui_event_t *e)
{
    GUI_UNUSED(obj);
    GUI_UNUSED(e);
    
    gui_rect_set_opacity((gui_rounded_rect_t *)${component.id}, ${pressedOpacity});
}

// Restore opacity on release
void ${component.id}_button_release_cb(void *obj, gui_event_t *e)
{
    GUI_UNUSED(obj);
    GUI_UNUSED(e);
    
    gui_rect_set_opacity((gui_rounded_rect_t *)${component.id}, ${releasedOpacity});
}
`;
  }

}
