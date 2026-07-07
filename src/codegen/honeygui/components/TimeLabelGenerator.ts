/**
 * hg_time_label component code generator
 * Extends LabelGenerator, handles time format display
 */
import { Component } from '../../../hml/types';
import { GeneratorContext } from './ComponentGenerator';
import { LabelGenerator } from './LabelGenerator';

export class TimeLabelGenerator extends LabelGenerator {

  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width, height } = component.position;
    
    const timeFormat = component.data?.timeFormat || 'HH:mm:ss';
    
    // Check if split time format
    if (timeFormat === 'HH:mm-split') {
      return this.generateSplitTimeCreation(component, indent, context);
    }

    // Time label does not support scrolling, use plain text
    return `${indentStr}${component.id} = gui_text_create(${parentRef}, "${component.name}", ${x}, ${y}, ${width}, ${height});\n`;
  }

  generatePropertySetters(component: Component, indent: number, _context: GeneratorContext): string {
    const timeFormat = component.data?.timeFormat || 'HH:mm:ss';
    
    // Split time format properties are already set in generateSplitTimeCreation
    if (timeFormat === 'HH:mm-split') {
      return '';
    }
    
    let code = '';
    const indentStr = '    '.repeat(indent);

    // Get property values
    const fontSize = component.data?.fontSize || 16;
    const color = component.style?.color || '#ffffff';
    const rgb = this.colorToRgb(color);
    
    // Time label: use global variable with dynamic length calculation
    const varName = `${component.id}_time_str`;
    const text = varName;
    const textLengthExpr = `strlen(${varName})`;

    // Determine font type
    const fontType = this.getFontType(component);
    const fontFile = component.data?.fontFile;

    // Set text content and basic properties
    code += `${indentStr}gui_text_set((gui_text_t *)${component.id}, ${text}, ${fontType}, gui_rgb(${rgb.r}, ${rgb.g}, ${rgb.b}), ${textLengthExpr}, ${fontSize});\n`;

    // Set font file path (if specified)
    if (fontFile) {
      const convertedFontFile = this.getConvertedFontFileName(component);
      const fontMode = this.getFontMode();
      code += `${indentStr}gui_text_type_set((gui_text_t *)${component.id}, "${convertedFontFile}", ${fontMode});\n`;
    }

    // Text alignment
    const textMode = this.getTextMode(component);
    code += `${indentStr}gui_text_mode_set((gui_text_t *)${component.id}, ${textMode});\n`;

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

    return code;
  }

  /**
   * Generate split time format code (hours, colon, minutes + breathing animation)
   */
  private generateSplitTimeCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width } = component.position;
    const fontSize = component.data?.fontSize || 16;
    const color = component.style?.color || '#ffffff';
    const rgb = this.colorToRgb(color);
    
    // Use font size directly as height
    const height = Number(fontSize);
    
    // Check if word wrap is enabled
    const wordWrap = component.style?.wordWrap || false;
    
    const numX = Number(x);
    const numY = Number(y);
    const numWidth = Number(width);
    
    if (wordWrap) {
      // Wrap mode: hours on first line, colon and minutes on second line
      const fontSizeNum = Number(component.data?.fontSize) || 16;
      const digitCharWidth = Math.floor(fontSizeNum * 0.5);
      const twoDigitsWidth = digitCharWidth * 2;
      const colonWidth = Math.max(Math.floor(fontSizeNum / 4), 20);
      const colonSpacing = Math.floor(fontSizeNum / 8);
      const centerX = numX + Math.floor(numWidth / 2);
      
      const hourWidth = twoDigitsWidth;
      const hourX = centerX - Math.floor(hourWidth / 2);
      const hourY = numY;
      
      const secondLineWidth = colonWidth + colonSpacing + twoDigitsWidth;
      const secondLineX = centerX - Math.floor(secondLineWidth / 2);
      const colonX = secondLineX;
      const colonY = Number(numY) + Number(fontSizeNum);
      const minWidth = twoDigitsWidth;
      const minX = secondLineX + colonWidth + colonSpacing;
      const minY = Number(numY) + Number(fontSizeNum);
      
      return this.generateSplitTimeWithWrap(component, indent, context, 
        hourX, hourY, hourWidth, colonX, colonY, colonWidth, minX, minY, minWidth, fontSizeNum);
    } else {
      // No-wrap mode: hours, colon, minutes on same line
      const colonWidth = Math.max(Math.floor(Number(fontSize) / 4), 20);
      const halfWidth = Math.floor((numWidth - colonWidth) / 2);
      const hourWidth = halfWidth;
      const minWidth = numWidth - colonWidth - hourWidth;
      const hourX = numX;
      const colonX = numX + hourWidth;
      const minX = numX + hourWidth + colonWidth;
      
      return this.generateSplitTimeInline(component, indent, context,
        hourX, numY, hourWidth, colonX, numY, colonWidth, minX, numY, minWidth, height);
    }
  }

  /**
   * Generate split time code in wrap mode
   */
  private generateSplitTimeWithWrap(
    component: Component, indent: number, context: GeneratorContext,
    hourX: number, hourY: number, hourWidth: number,
    colonX: number, colonY: number, colonWidth: number,
    minX: number, minY: number, minWidth: number,
    height: number
  ): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const fontSize = component.data?.fontSize || 16;
    const color = component.style?.color || '#ffffff';
    const rgb = this.colorToRgb(color);
    
    const fontType = this.getFontType(component);
    const fontFile = component.data?.fontFile;
    const convertedFontFile = fontFile ? this.getConvertedFontFileName(component) : '';
    const fontMode = this.getFontMode();
    
    let code = '';
    
    // Generate hour label
    code += `${indentStr}// Split time - hour\n`;
    code += `${indentStr}${component.id}_hour = gui_text_create(${parentRef}, "${component.name}_hour", ${hourX}, ${hourY}, ${hourWidth}, ${height});\n`;
    code += `${indentStr}gui_text_set(${component.id}_hour, ${component.id}_time_str, ${fontType}, gui_rgb(${rgb.r}, ${rgb.g}, ${rgb.b}), 2, ${fontSize});\n`;
    if (fontFile) {
      code += `${indentStr}gui_text_type_set(${component.id}_hour, "${convertedFontFile}", ${fontMode});\n`;
    }
    code += `${indentStr}gui_text_mode_set(${component.id}_hour, CENTER);\n`;
    
    const letterSpacing = component.style?.letterSpacing;
    if (letterSpacing !== undefined && letterSpacing !== 0) {
      code += `${indentStr}gui_text_extra_letter_spacing_set(${component.id}_hour, ${letterSpacing});\n`;
    }
    const lineSpacing = component.style?.lineSpacing;
    if (lineSpacing !== undefined && lineSpacing !== 0) {
      code += `${indentStr}gui_text_extra_line_spacing_set(${component.id}_hour, ${lineSpacing});\n`;
    }
    
    // Generate colon label
    code += `${indentStr}// Split time - colon (with breathing animation)\n`;
    code += `${indentStr}${component.id}_colon = gui_text_create(${parentRef}, "${component.name}_colon", ${colonX}, ${colonY}, ${colonWidth}, ${height});\n`;
    code += `${indentStr}gui_text_set(${component.id}_colon, ":", ${fontType}, gui_rgb(${rgb.r}, ${rgb.g}, ${rgb.b}), 1, ${fontSize});\n`;
    if (fontFile) {
      code += `${indentStr}gui_text_type_set(${component.id}_colon, "${convertedFontFile}", ${fontMode});\n`;
    }
    code += `${indentStr}gui_text_mode_set(${component.id}_colon, CENTER);\n`;
    
    // Generate minute label
    code += `${indentStr}// Split time - minute\n`;
    code += `${indentStr}${component.id}_min = gui_text_create(${parentRef}, "${component.name}_min", ${minX}, ${minY}, ${minWidth}, ${height});\n`;
    code += `${indentStr}gui_text_set(${component.id}_min, ${component.id}_time_str + 3, ${fontType}, gui_rgb(${rgb.r}, ${rgb.g}, ${rgb.b}), 2, ${fontSize});\n`;
    if (fontFile) {
      code += `${indentStr}gui_text_type_set(${component.id}_min, "${convertedFontFile}", ${fontMode});\n`;
    }
    code += `${indentStr}gui_text_mode_set(${component.id}_min, CENTER);\n`;
    
    if (letterSpacing !== undefined && letterSpacing !== 0) {
      code += `${indentStr}gui_text_extra_letter_spacing_set(${component.id}_min, ${letterSpacing});\n`;
    }
    if (lineSpacing !== undefined && lineSpacing !== 0) {
      code += `${indentStr}gui_text_extra_line_spacing_set(${component.id}_min, ${lineSpacing});\n`;
    }
    
    // Create timers
    code += `${indentStr}// Colon breathing animation timer\n`;
    code += `${indentStr}gui_obj_create_timer(GUI_BASE(${component.id}_colon), 50, true, ${component.id}_breath_anim_cb);\n`;
    code += `${indentStr}// Time update timer\n`;
    code += `${indentStr}gui_obj_create_timer(${parentRef}, 1000, true, ${component.id}_time_update_cb);\n`;
    code += `${indentStr}${component.id} = GUI_BASE(${component.id}_hour);\n`;
    
    return code;
  }

  /**
   * Generate split time code in no-wrap mode
   */
  private generateSplitTimeInline(
    component: Component, indent: number, context: GeneratorContext,
    hourX: number, hourY: number, hourWidth: number,
    colonX: number, colonY: number, colonWidth: number,
    minX: number, minY: number, minWidth: number,
    height: number
  ): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const fontSize = Number(component.data?.fontSize) || 16;
    const color = component.style?.color || '#ffffff';
    const rgb = this.colorToRgb(color);
    
    const fontType = this.getFontType(component);
    const fontFile = component.data?.fontFile;
    const convertedFontFile = fontFile ? this.getConvertedFontFileName(component) : '';
    const fontMode = this.getFontMode();
    
    let code = '';
    
    // Generate hour label
    code += `${indentStr}// Split time - hour\n`;
    code += `${indentStr}${component.id}_hour = gui_text_create(${parentRef}, "${component.name}_hour", ${hourX}, ${hourY}, ${hourWidth}, ${height});\n`;
    code += `${indentStr}gui_text_set(${component.id}_hour, ${component.id}_time_str, ${fontType}, gui_rgb(${rgb.r}, ${rgb.g}, ${rgb.b}), 2, ${fontSize});\n`;
    if (fontFile) {
      code += `${indentStr}gui_text_type_set(${component.id}_hour, "${convertedFontFile}", ${fontMode});\n`;
    }
    code += `${indentStr}gui_text_mode_set(${component.id}_hour, RIGHT);\n`;
    
    const letterSpacing = component.style?.letterSpacing;
    if (letterSpacing !== undefined && letterSpacing !== 0) {
      code += `${indentStr}gui_text_extra_letter_spacing_set(${component.id}_hour, ${letterSpacing});\n`;
    }
    const lineSpacing = component.style?.lineSpacing;
    if (lineSpacing !== undefined && lineSpacing !== 0) {
      code += `${indentStr}gui_text_extra_line_spacing_set(${component.id}_hour, ${lineSpacing});\n`;
    }
    
    // Generate colon label
    code += `${indentStr}// Split time - colon (with breathing animation)\n`;
    code += `${indentStr}${component.id}_colon = gui_text_create(${parentRef}, "${component.name}_colon", ${colonX}, ${colonY}, ${colonWidth}, ${height});\n`;
    code += `${indentStr}gui_text_set(${component.id}_colon, ":", ${fontType}, gui_rgb(${rgb.r}, ${rgb.g}, ${rgb.b}), 1, ${fontSize});\n`;
    if (fontFile) {
      code += `${indentStr}gui_text_type_set(${component.id}_colon, "${convertedFontFile}", ${fontMode});\n`;
    }
    code += `${indentStr}gui_text_mode_set(${component.id}_colon, LEFT);\n`;
    
    // Generate minute label
    code += `${indentStr}// Split time - minute\n`;
    code += `${indentStr}${component.id}_min = gui_text_create(${parentRef}, "${component.name}_min", ${minX}, ${minY}, ${minWidth}, ${height});\n`;
    code += `${indentStr}gui_text_set(${component.id}_min, ${component.id}_time_str + 3, ${fontType}, gui_rgb(${rgb.r}, ${rgb.g}, ${rgb.b}), 2, ${fontSize});\n`;
    if (fontFile) {
      code += `${indentStr}gui_text_type_set(${component.id}_min, "${convertedFontFile}", ${fontMode});\n`;
    }
    code += `${indentStr}gui_text_mode_set(${component.id}_min, LEFT);\n`;
    
    if (letterSpacing !== undefined && letterSpacing !== 0) {
      code += `${indentStr}gui_text_extra_letter_spacing_set(${component.id}_min, ${letterSpacing});\n`;
    }
    if (lineSpacing !== undefined && lineSpacing !== 0) {
      code += `${indentStr}gui_text_extra_line_spacing_set(${component.id}_min, ${lineSpacing});\n`;
    }
    
    // Create timers
    code += `${indentStr}// Colon breathing animation timer\n`;
    code += `${indentStr}gui_obj_create_timer(GUI_BASE(${component.id}_colon), 50, true, ${component.id}_breath_anim_cb);\n`;
    code += `${indentStr}// Time update timer\n`;
    code += `${indentStr}gui_obj_create_timer(${parentRef}, 1000, true, ${component.id}_time_update_cb);\n`;
    code += `${indentStr}${component.id} = GUI_BASE(${component.id}_hour);\n`;
    
    return code;
  }
}
