/**
 * hg_circle component code generator
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';
import { convertColor, convertColorWithOpacity, convertColorToRgba } from '../utils';

export class CircleGenerator implements ComponentCodeGenerator {
  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width, height } = component.position;
    
    // Get parameters from style with defaults
    const radius = component.style?.radius || 40;
    
    // Get opacity, default 255 (fully opaque)
    // Read from style first, fallback to data
    const opacity = component.style?.opacity ?? component.data?.opacity ?? 255;
    
    // Check for dual-state button, use color corresponding to initial state
    let color: string;
    const buttonMode = component.data?.buttonMode;
    if (buttonMode === 'dual-state') {
      const initialState = component.data?.buttonInitialState === 'on';
      const onColor = component.data?.buttonStateOnColor || '#00FF00';
      const offColor = component.data?.buttonStateOffColor || '#FF0000';
      const stateColor = initialState ? onColor : offColor;
      
      color = opacity < 255
        ? convertColorWithOpacity(stateColor, opacity)
        : convertColor(stateColor);
    } else {
      // Plain circle uses fillColor
      color = opacity < 255
        ? convertColorWithOpacity(component.style?.fillColor, opacity)
        : convertColor(component.style?.fillColor);
    }

    // Important: gui_circle_create x, y parameters are center coordinates, not bounding box top-left
    // Designer stores bounding box top-left, need to convert to center coordinates
    // Center = top-left + width/2
    const centerX = x + width / 2;
    const centerY = y + height / 2;

    return `${indentStr}${component.id} = gui_circle_create(${parentRef}, "${component.name}", ${centerX}, ${centerY}, ${radius}, ${color});\n`;
  }

  generatePropertySetters(component: Component, indent: number, _context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    let code = '';

    // Note: opacity already set in gui_rgba, no separate opacity_value needed

    // Gradient settings
    if (component.style?.useGradient && component.data?.gradientStops) {
      const stops = component.data.gradientStops as Array<{ position: number; color: string }>;
      if (stops.length >= 2) {
        const gradientType = component.style?.gradientType || 'radial';
        
        code += `${indentStr}// Set ${gradientType === 'radial' ? 'radial' : 'angular'} gradient\n`;
        
        if (gradientType === 'radial') {
          code += `${indentStr}gui_circle_set_radial_gradient(${component.id});\n`;
        } else {
          // Angular gradient
          const startAngle = component.data?.gradientStartAngle ?? 0;
          const endAngle = component.data?.gradientEndAngle ?? 360;
          code += `${indentStr}gui_circle_set_angular_gradient(${component.id}, ${startAngle}, ${endAngle});\n`;
        }
        
        stops.forEach(stop => {
          const color = convertColorToRgba(stop.color);
          // Ensure position is float format (e.g. 0.0f not 0f)
          const position = Number.isInteger(stop.position) 
            ? `${stop.position}.0f` 
            : `${stop.position}f`;
          code += `${indentStr}gui_circle_add_gradient_stop(${component.id}, ${position}, ${color});\n`;
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
      return `${indentStr}gui_obj_add_event_cb((gui_obj_t *)${component.id}, ${component.id}_button_cb, GUI_EVENT_TOUCH_CLICKED, NULL);\n`;
    } else if (buttonMode === 'opacity') {
      let code = '';
      code += `${indentStr}gui_obj_add_event_cb((gui_obj_t *)${component.id}, ${component.id}_button_press_cb, GUI_EVENT_TOUCH_PRESSED, NULL);\n`;
      code += `${indentStr}gui_obj_add_event_cb((gui_obj_t *)${component.id}, ${component.id}_button_release_cb, GUI_EVENT_TOUCH_RELEASED, NULL);\n`;
      return code;
    }

    return '';
  }

  /**
   * Generate button effect callback functions (similar to RectGenerator)
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
    
    ${component.id}_state = !${component.id}_state;
    
    if (${component.id}_state) {
        gui_circle_set_color((gui_circle_t *)${component.id}, ${onColorRgba});
    } else {
        gui_circle_set_color((gui_circle_t *)${component.id}, ${offColorRgba});
    }
}

bool ${component.id}_get_state(void) { return ${component.id}_state; }
void ${component.id}_set_state(bool state) {
    if (${component.id}_state != state) {
        ${component.id}_state = state;
        gui_circle_set_color((gui_circle_t *)${component.id}, state ? ${onColorRgba} : ${offColorRgba});
    }
}
`;
  }

  private generateOpacityCallback(component: Component): string {
    const pressedOpacity = component.data?.buttonPressedOpacity || 128;
    const releasedOpacity = component.data?.buttonReleasedOpacity || 255;

    return `
// ${component.id} opacity button callback

void ${component.id}_button_press_cb(void *obj, gui_event_t *e)
{
    GUI_UNUSED(obj);
    GUI_UNUSED(e);
    
    gui_circle_set_opacity((gui_circle_t *)${component.id}, ${pressedOpacity});
}

void ${component.id}_button_release_cb(void *obj, gui_event_t *e)
{
    GUI_UNUSED(obj);
    GUI_UNUSED(e);
    
    gui_circle_set_opacity((gui_circle_t *)${component.id}, ${releasedOpacity});
}
`;
  }

}
