/**
 * hg_menu_cellular component code generator
 * Generates C code for cellular menu control
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';

interface IconAction {
  target?: string;
  switchOutStyle?: string;
  switchInStyle?: string;
}

export class MenuCellularGenerator implements ComponentCodeGenerator {

  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const iconSize = component.data?.iconSize ?? 64;
    const offsetX = component.data?.offsetX ?? 0;
    const offsetY = component.data?.offsetY ?? 0;

    const iconImages: string[] = Array.isArray(component.data?.iconImages)
      ? component.data.iconImages
      : [];

    const iconActions: IconAction[] = Array.isArray(component.data?.iconActions)
      ? component.data.iconActions
      : [];

    let code = '';

    if (iconImages.length !== 0) {
      // Generate icon path array
      code += `${indentStr}void *${component.id}_icons[] = {\n`;
      iconImages.forEach((iconPath, index) => {
        const binPath = this.convertToBinPath(iconPath);
        const comma = index < iconImages.length - 1 ? ',' : '';
        code += `${indentStr}    "${binPath}"${comma}\n`;
      });
      code += `${indentStr}};\n`;

      code += `${indentStr}${component.id} = gui_menu_cellular_create(${parentRef}, ${iconSize}, ${component.id}_icons, ${iconImages.length}, IMG_SRC_FILESYS);\n`;
    }

    // Conditional offset generation
    if (offsetX !== 0 || offsetY !== 0) {
      code += `${indentStr}gui_menu_cellular_offset(${component.id}, ${offsetX}, ${offsetY});\n`;
    }

    // Generate gui_menu_cellular_on_click (only when at least one target is configured)
    const hasAnyAction = iconActions.some(a => a && a.target && a.target.trim() !== '');
    if (hasAnyAction && iconImages.length > 0) {
      const count = iconImages.length;
      code += `${indentStr}static struct gui_menu_cellular_gesture_parameter ${component.id}_params[] = {\n`;
      for (let i = 0; i < count; i++) {
        const action = iconActions[i];
        const comma = i < count - 1 ? ',' : '';
        if (action && action.target && action.target.trim() !== '') {
          const cbName = this.getSwitchViewCallbackName(component.id, i);
          code += `${indentStr}    { ${cbName}, NULL }${comma}\n`;
        } else {
          code += `${indentStr}    { NULL, NULL }${comma}\n`;
        }
      }
      code += `${indentStr}};\n`;
      code += `${indentStr}gui_menu_cellular_on_click(${component.id}, ${component.id}_params, ${count});\n`;
    }

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
   * Generate switch_view callback functions (written to *_ui.c)
   * Each icon with a configured target gets an independent callback function
   */
  generateSwitchViewCallbacks(component: Component): string {
    const iconActions: IconAction[] = Array.isArray(component.data?.iconActions)
      ? component.data.iconActions
      : [];

    const hasAnyAction = iconActions.some(a => a && a.target && a.target.trim() !== '');
    if (!hasAnyAction) {
      return '';
    }

    let code = `// ${component.id} menu cellular icon switch view callbacks\n`;

    iconActions.forEach((action, index) => {
      if (!action || !action.target || action.target.trim() === '') {
        return;
      }
      const cbName = this.getSwitchViewCallbackName(component.id, index);
      const switchOut = action.switchOutStyle || 'SWITCH_OUT_TO_LEFT_USE_TRANSLATION';
      const switchIn = action.switchInStyle || 'SWITCH_IN_FROM_RIGHT_USE_TRANSLATION';

      code += `void ${cbName}(void *obj, gui_event_t *e)\n`;
      code += `{\n`;
      code += `    GUI_UNUSED(obj);\n`;
      code += `    GUI_UNUSED(e);\n`;
      code += `    gui_view_switch_direct(gui_view_get_current(), "${action.target}", ${switchOut}, ${switchIn});\n`;
      code += `}\n\n`;
    });

    return code;
  }

  /**
   * Get icon switch_view callback function name
   */
  getSwitchViewCallbackName(componentId: string, iconIndex: number): string {
    return `${componentId}_icon_${iconIndex}_switch_view_cb`;
  }

  /**
   * Convert image path to .bin path
   * Rules: replace extension with .bin, strip assets/ prefix, ensure path starts with /
   */
  convertToBinPath(src: string): string {
    if (!src) { return ''; }
    let binSrc = src.replace(/\.(png|jpe?g|bmp|gif|tiff?|webp)$/i, '.bin');
    binSrc = binSrc.replace(/^assets\//, '');
    if (!binSrc.startsWith('/')) {
      binSrc = '/' + binSrc;
    }
    return binSrc;
  }
}
