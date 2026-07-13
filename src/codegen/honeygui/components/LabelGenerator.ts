/**
 * hg_label component code generator
 * Plain text label without time functionality
 */
import * as path from 'path';
import { Component } from '../../../hml/types';
import { resolveLocalizedText } from '../../../project-i18n/catalog';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';

export class LabelGenerator implements ComponentCodeGenerator {

  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width, height } = component.position;
    
    // Check if scrolling is enabled (note: may be string 'true' or boolean true)
    const enableScroll = component.data?.enableScroll === true || component.data?.enableScroll === 'true';
    
    // Select API based on scrolling
    const createFunction = enableScroll ? 'gui_scroll_text_create' : 'gui_text_create';

    return `${indentStr}${component.id} = ${createFunction}(${parentRef}, "${component.name}", ${x}, ${y}, ${width}, ${height});\n`;
  }

  generatePropertySetters(component: Component, indent: number, _context: GeneratorContext): string {
    let code = '';
    const indentStr = '    '.repeat(indent);

    // Check if scrolling is enabled (note: may be string 'true' or boolean true)
    const enableScroll = component.data?.enableScroll === true || component.data?.enableScroll === 'true';
    const scrollDirection = component.data?.scrollDirection || 'horizontal';
    const scrollReverse = component.data?.scrollReverse === true || component.data?.scrollReverse === 'true';

    // Get property values
    const fontSize = component.data?.fontSize || 16;
    const color = component.style?.color || '#ffffff';
    const rgb = this.colorToRgb(color);
    
    // Plain label: use the project's active-locale catalog text when i18nKey is bound.
    const staticText = this.resolveCodegenText(component, _context);
    const escapedText = this.escapeCString(staticText);
    const text = `"${escapedText}"`;
    const textLengthExpr = String(this.getUtf8ByteLength(staticText));

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

    // Text alignment - scroll text doesn't need gui_text_mode_set since gui_scroll_text_scroll_set has mode parameter
    if (!enableScroll) {
      const textMode = this.getTextMode(component);
      code += `${indentStr}gui_text_mode_set((gui_text_t *)${component.id}, ${textMode});\n`;
    }

    // Scroll text specific: set scroll parameters
    if (enableScroll) {
      // Convert scroll direction and alignment mode
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

    return code;
  }

  /**
   * Resolve static codegen text.
   * Uses the project's current active locale (catalog.activeLocale), falling back to
   * defaultLocale, then to the HML `text` attribute. Still static codegen only: firmware
   * runtime locale switching is not generated here.
   */
  private resolveCodegenText(component: Component, context: GeneratorContext): string {
    const fallbackText = String(component.data?.text ?? '');
    const key = typeof component.data?.i18nKey === 'string'
      ? component.data.i18nKey.trim()
      : '';
    const catalog = context.projectI18nCatalog;

    if (!catalog || !key) {
      return fallbackText;
    }

    return resolveLocalizedText(catalog, key, catalog.activeLocale ?? catalog.defaultLocale, fallbackText).text;
  }

  /**
   * Determine font type based on font configuration
   */
  protected getFontType(component: Component): string {
    const fontType = component.data?.fontType || 'bitmap';
    if (fontType === 'vector') {
      return 'GUI_FONT_SRC_TTF';
    }
    return 'GUI_FONT_SRC_BMP';
  }

  /**
   * Generate TEXT_MODE based on hAlign, vAlign and wordWrap
   */
  protected getTextMode(component: Component): string {
    const hAlign = component.style?.hAlign || 'LEFT';
    const vAlign = component.style?.vAlign || 'TOP';
    const wordWrap = component.style?.wordWrap || false;
    
    if (vAlign === 'MID') {
      if (wordWrap) {
        switch (hAlign) {
          case 'LEFT': return 'MULTI_MID_LEFT';
          case 'CENTER': return 'MULTI_MID_CENTER';
          case 'RIGHT': return 'MULTI_MID_RIGHT';
          default: return 'MULTI_MID_LEFT';
        }
      } else {
        switch (hAlign) {
          case 'LEFT': return 'MID_LEFT';
          case 'CENTER': return 'MID_CENTER';
          case 'RIGHT': return 'MID_RIGHT';
          default: return 'MID_LEFT';
        }
      }
    } else {
      if (wordWrap) {
        switch (hAlign) {
          case 'LEFT': return 'MULTI_LEFT';
          case 'CENTER': return 'MULTI_CENTER';
          case 'RIGHT': return 'MULTI_RIGHT';
          default: return 'MULTI_LEFT';
        }
      } else {
        switch (hAlign) {
          case 'LEFT': return 'LEFT';
          case 'CENTER': return 'CENTER';
          case 'RIGHT': return 'RIGHT';
          default: return 'LEFT';
        }
      }
    }
  }

  /**
   * Get font source mode
   */
  protected getFontMode(): string {
    return 'FONT_SRC_FILESYS';
  }

  /**
   * Escape special characters in C strings
   */
  protected escapeCString(str: string): string {
    return str
      .replace(/\\/g, '\\\\')   // Backslash must be processed first
      .replace(/"/g, '\\"')     // Double quote
      .replace(/\n/g, '\\n')    // Newline
      .replace(/\r/g, '\\r')    // Carriage return
      .replace(/\t/g, '\\t')    // Tab
      .replace(/\0/g, '\\0');   // Null character
  }

  /**
   * Calculate UTF-8 byte length of a string
   */
  protected getUtf8ByteLength(str: string): number {
    let byteLength = 0;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code <= 0x7F) {
        byteLength += 1;
      } else if (code <= 0x7FF) {
        byteLength += 2;
      } else if (code >= 0xD800 && code <= 0xDBFF) {
        byteLength += 4;
        i++;
      } else {
        byteLength += 3;
      }
    }
    return byteLength;
  }

  /**
   * Convert color string to RGB object
   */
  protected colorToRgb(color: string): { r: number; g: number; b: number } {
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      if (hex.length === 6) {
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
        };
      } else if (hex.length === 3) {
        return {
          r: parseInt(hex[0] + hex[0], 16),
          g: parseInt(hex[1] + hex[1], 16),
          b: parseInt(hex[2] + hex[2], 16),
        };
      }
    }
    return { r: 255, g: 255, b: 255 };
  }

  /**
   * Generate converted font filename based on component properties
   */
  protected getConvertedFontFileName(component: Component): string {
    const fontFile = component.data?.fontFile;
    if (!fontFile) {
      return '';
    }

    const fontFileName = path.basename(fontFile);
    // Remove extension and replace - with _ (consistent with font converter)
    const fontName = fontFileName.replace(/\.(ttf|otf|woff|woff2)$/i, '').replace(/-/g, '_');
    
    const fontType = component.data?.fontType || 'bitmap';
    const fontSize = component.data?.fontSize || 16;
    const renderMode = parseInt(component.data?.renderMode || '4', 10);

    const fontDir = path.dirname(fontFile);
    
    let convertedFileName: string;
    if (fontType === 'vector') {
      convertedFileName = `${fontName}_vector.bin`;
    } else {
      convertedFileName = `${fontName}_size${fontSize}_bits${renderMode}_bitmap.bin`;
    }

    if (fontDir && fontDir !== '.') {
      return `${fontDir}/${convertedFileName}`;
    }
    return convertedFileName;
  }
}
