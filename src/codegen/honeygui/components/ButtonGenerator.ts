/**
 * hg_button component code generator
 * Toggle mode: dual-state image button with persistent state
 * Normal mode: momentary press button with press/release image switching
 * Both use gui_img control since SDK has no native gui_button
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';
import * as path from 'path';
import * as fs from 'fs';

export class ButtonGenerator implements ComponentCodeGenerator {

  private isToggleMode(component: Component): boolean {
    return component.data?.toggleMode === true || component.data?.toggleMode === 'true';
  }

  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width, height } = component.position;

    if (this.isToggleMode(component)) {
      // Toggle mode: create image button using gui_img
      const imageOn = component.data?.imageOn || '';
      const imageOff = component.data?.imageOff || '';
      const binOn = this.convertToBinPath(imageOn);
      const binOff = this.convertToBinPath(imageOff);

      let code = `${indentStr}${component.id} = (gui_obj_t *)gui_img_create_from_fs(${parentRef}, "${component.name}", "${binOff}", ${x}, ${y}, ${width}, ${height});\n`;
      code += `${indentStr}if (${component.id}_state) {\n`;
      code += `${indentStr}    gui_img_set_src((gui_img_t *)${component.id}, (const uint8_t *)"${binOn}", IMG_SRC_FILESYS);\n`;
      code += `${indentStr}}\n`;
      return code;
    }

    // Normal mode: create image button with default (off) image
    const imageOff = component.data?.imageOff || '';
    const binOff = this.convertToBinPath(imageOff);

    if (!binOff) {
      return `${indentStr}// Button ${component.id}: no image configured\n`;
    }

    return `${indentStr}${component.id} = (gui_obj_t *)gui_img_create_from_fs(${parentRef}, "${component.name}", "${binOff}", ${x}, ${y}, ${width}, ${height});\n`;
  }

  generatePropertySetters(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    let code = '';

    // Visibility
    if (component.visible === false) {
      code += `${indentStr}gui_obj_hidden((gui_obj_t *)${component.id}, true);\n`;
    }

    // Normal mode without images — skip scaling
    const hasImages = !!(component.data?.imageOn || component.data?.imageOff);
    if (!hasImages) {
      return code;
    }

    // Auto-scale: add scaling code if button size differs from original image size
    const { width, height } = component.position;
    const imageSize = this.getImageSize(component, context);
    
    if (imageSize && (width !== imageSize.width || height !== imageSize.height)) {
      const scaleX = width / imageSize.width;
      const scaleY = height / imageSize.height;
      code += `${indentStr}gui_img_scale((gui_img_t *)${component.id}, ${scaleX.toFixed(6)}f, ${scaleY.toFixed(6)}f);\n`;
    }

    return code;
  }

  /**
   * Get original image dimensions
   */
  private getImageSize(component: Component, context: GeneratorContext): { width: number; height: number } | null {
    const imageOn = component.data?.imageOn || '';
    const imageOff = component.data?.imageOff || '';
    // For toggle mode use initial state image; for normal use off image
    const imagePath = this.isToggleMode(component)
      ? (component.data?.initialState === 'on' ? imageOn : imageOff)
      : (imageOff || imageOn);

    if (!imagePath) {
      return null;
    }

    let projectRoot = context.projectRoot;
    if (!projectRoot) {
      return null;
    }

    if (projectRoot.endsWith('.preview')) {
      projectRoot = path.dirname(projectRoot);
    }

    const fullImagePath = path.join(projectRoot, imagePath);
    
    if (!fs.existsSync(fullImagePath)) {
      return null;
    }

    try {
      const buffer = fs.readFileSync(fullImagePath);
      return this.parseImageSize(buffer, imagePath);
    } catch (err) {
      console.error(`Failed to read image size for ${imagePath}:`, err);
      return null;
    }
  }

  /**
   * Parse image dimensions (supports PNG, JPEG, BMP)
   */
  private parseImageSize(buffer: Buffer, filename: string): { width: number; height: number } | null {
    const ext = path.extname(filename).toLowerCase();

    if (ext === '.png') {
      if (buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);
        return { width, height };
      }
    } else if (ext === '.jpg' || ext === '.jpeg') {
      let offset = 2;
      while (offset < buffer.length - 9) {
        if (buffer[offset] === 0xFF) {
          const marker = buffer[offset + 1];
          if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
            const height = buffer.readUInt16BE(offset + 5);
            const width = buffer.readUInt16BE(offset + 7);
            return { width, height };
          }
          const segmentLength = buffer.readUInt16BE(offset + 2);
          offset += 2 + segmentLength;
        } else {
          offset++;
        }
      }
    } else if (ext === '.bmp') {
      if (buffer.length >= 26) {
        const width = buffer.readInt32LE(18);
        const height = Math.abs(buffer.readInt32LE(22));
        return { width, height };
      }
    }

    return null;
  }

  /**
   * Generate toggle mode callback (state-based toggle)
   */
  generateToggleCallback(component: Component): string {
    if (!this.isToggleMode(component)) {
      return '';
    }

    const imageOn = component.data?.imageOn || '';
    const imageOff = component.data?.imageOff || '';
    const binOn = this.convertToBinPath(imageOn);
    const binOff = this.convertToBinPath(imageOff);

    const onCallback = component.data?.onCallback || '';
    const offCallback = component.data?.offCallback || '';

    const onCallLinedefine = onCallback ? `        extern void ${onCallback}(void *obj, gui_event_t *e);\n` : '';
    const onCallLine = onCallback ? `        ${onCallback}(obj, e);\n` : '';
    const offCallLine = offCallback ? `        ${offCallback}(obj, e);\n` : '';
    const onCallLineNull = onCallback ? `        ${onCallback}(NULL, NULL);\n` : '';
    const offCallLineNull = offCallback ? `        ${offCallback}(NULL, NULL);\n` : '';

    const onClickActions = (component.eventConfigs || [])
      .filter(e => e.type === 'onClick')
      .flatMap(e => e.actions || []);

    const extraCode = onClickActions.length > 0
      ? this.generateOnClickActionsCode(onClickActions, component)
      : '';

    return `
// ${component.id} dual-state button callback
static bool ${component.id}_state = ${component.data?.initialState === 'on' ? 'true' : 'false'};

void ${component.id}_toggle_cb(void *obj, gui_event_t *e)
{
    GUI_UNUSED(obj);
    GUI_UNUSED(e);
    
    // Toggle state
    ${component.id}_state = !${component.id}_state;
    
    // Switch image based on state and call corresponding callback
    if (${component.id}_state) {
        gui_img_set_src((gui_img_t *)${component.id}, (const uint8_t *)"${binOn}", IMG_SRC_FILESYS);
${onCallLinedefine}${onCallLine}    } else {
        gui_img_set_src((gui_img_t *)${component.id}, (const uint8_t *)"${binOff}", IMG_SRC_FILESYS);
${onCallLinedefine}${offCallLine}    }
    gui_fb_change();
${extraCode}}

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
            gui_img_set_src((gui_img_t *)${component.id}, (const uint8_t *)"${binOn}", IMG_SRC_FILESYS);
${onCallLinedefine}${onCallLineNull}        } else {
            gui_img_set_src((gui_img_t *)${component.id}, (const uint8_t *)"${binOff}", IMG_SRC_FILESYS);
${onCallLinedefine}${offCallLineNull}        }
    }
}
`;
  }

  /**
   * Generate normal mode callbacks (momentary press/release)
   */
  generateNormalCallback(component: Component): string {
    if (this.isToggleMode(component)) {
      return '';
    }

    const imageOn = component.data?.imageOn || '';
    const imageOff = component.data?.imageOff || '';
    const binOn = this.convertToBinPath(imageOn);
    const binOff = this.convertToBinPath(imageOff);

    if (!binOn && !binOff) {
      return '';
    }

    const clickCallback = component.data?.clickCallback || '';

    const onClickActions = (component.eventConfigs || [])
      .filter(e => e.type === 'onClick')
      .flatMap(e => e.actions || []);

    const extraCode = onClickActions.length > 0
      ? this.generateOnClickActionsCode(onClickActions, component)
      : '';

    let clickCallCode = '';
    if (clickCallback) {
      clickCallCode += `    extern void ${clickCallback}(void *obj, gui_event_t *e);\n`;
      clickCallCode += `    ${clickCallback}(obj, e);\n`;
    }

    return `
// ${component.id} button press callback - switch to highlight image
void ${component.id}_press_cb(void *obj, gui_event_t *e)
{
    GUI_UNUSED(obj);
    GUI_UNUSED(e);
    gui_img_set_src((gui_img_t *)${component.id}, (const uint8_t *)"${binOn}", IMG_SRC_FILESYS);
    gui_fb_change();
}

// ${component.id} button release callback - restore default image and trigger click
void ${component.id}_release_cb(void *obj, gui_event_t *e)
{
    GUI_UNUSED(obj);
    GUI_UNUSED(e);
    gui_img_set_src((gui_img_t *)${component.id}, (const uint8_t *)"${binOff}", IMG_SRC_FILESYS);
    gui_fb_change();
${clickCallCode}${extraCode}}
`;
  }

  /**
   * Generate onClick actions as inline code
   */
  private generateOnClickActionsCode(actions: any[], component: Component): string {
    let code = `\n    // onClick event actions\n`;
    actions.forEach(action => {
      if (action.type === 'callFunction' && action.functionName) {
        code += `    ${action.functionName}(obj, e);\n`;
      } else if (action.type === 'switchView' && action.target) {
        const switchOutStyle = action.switchOutStyle || 'SWITCH_OUT_TO_LEFT_USE_TRANSLATION';
        const switchInStyle = action.switchInStyle || 'SWITCH_IN_FROM_RIGHT_USE_TRANSLATION';
        code += `    gui_view_switch_direct(gui_view_get_current(), "${action.target}", ${switchOutStyle}, ${switchInStyle});\n`;
      } else if (action.type === 'sendMessage' && action.message) {
        code += `    gui_msg_publish("${action.message}", NULL, 0);\n`;
      }
    });
    return code;
  }

  /**
   * Callback declarations (not needed — user declares in _user.h)
   */
  generateCallbackDeclarations(_component: Component): string {
    return '';
  }

  /**
   * Callback implementations (not needed — user implements)
   */
  generateCallbackImplementations(_component: Component): string {
    return '';
  }

  /**
   * Generate event bindings
   */
  generateEventBinding(component: Component, indent: number): string {
    const indentStr = '    '.repeat(indent);

    if (this.isToggleMode(component)) {
      return `${indentStr}gui_obj_add_event_cb((gui_obj_t *)${component.id}, ${component.id}_toggle_cb, GUI_EVENT_TOUCH_CLICKED, NULL);\n`;
    }

    // Normal mode: bind press and release events
    const hasImages = !!(component.data?.imageOn || component.data?.imageOff);
    if (!hasImages) {
      return '';
    }

    let code = '';
    code += `${indentStr}gui_obj_add_event_cb((gui_obj_t *)${component.id}, ${component.id}_press_cb, GUI_EVENT_TOUCH_PRESSED, NULL);\n`;
    code += `${indentStr}gui_obj_add_event_cb((gui_obj_t *)${component.id}, ${component.id}_release_cb, GUI_EVENT_TOUCH_RELEASED, NULL);\n`;
    return code;
  }

  /**
   * Convert image path to .bin format
   */
  private convertToBinPath(src: string): string {
    if (!src) return '';
    
    let binSrc = src.replace(/\.(png|jpe?g|bmp|gif|tiff?|webp)$/i, '.bin');
    binSrc = binSrc.replace(/^assets\//, '');
    if (!binSrc.startsWith('/')) {
      binSrc = '/' + binSrc;
    }
    
    return binSrc;
  }
}
