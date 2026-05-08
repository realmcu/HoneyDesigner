/**
 * hg_claw_face component code generator
 *
 * API: gui_openclaw_emoji_create
 * Dependency: lib/gui_openclaw (auto-copied to output directory during code generation)
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';

export class ClawFaceGenerator implements ComponentCodeGenerator {
  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width, height } = component.position;
    const initialExpression = this.getExpressionEnum((component.data?.initialExpression as string) || 'neutral');

    let code = '';
    code += `${indentStr}${component.id} = gui_openclaw_emoji_create(${parentRef}, "${component.name}", ${x}, ${y}, ${width}, ${height});\n`;
    code += `${indentStr}gui_openclaw_emoji_set_expression(${component.id}, ${initialExpression});\n`;

    return code;
  }

  generatePropertySetters(component: Component, indent: number, _context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    let code = '';

    if (component.visible === false) {
      code += `${indentStr}gui_obj_hidden((gui_obj_t *)${component.id}, true);\n`;
    }

    return code;
  }

  getExtraIncludes(_component: Component): string[] {
    return [
      '#include "gui_openclaw_emoji.h"'
    ];
  }

  private getExpressionEnum(expression: string): string {
    switch (expression) {
      case 'happy':
        return 'GUI_OPENCLAW_EXPR_HAPPY';
      case 'sad':
        return 'GUI_OPENCLAW_EXPR_SAD';
      case 'angry':
        return 'GUI_OPENCLAW_EXPR_ANGRY';
      case 'surprised':
        return 'GUI_OPENCLAW_EXPR_SURPRISED';
      case 'thinking':
        return 'GUI_OPENCLAW_EXPR_THINKING';
      case 'sleeping':
        return 'GUI_OPENCLAW_EXPR_SLEEPING';
      case 'love':
        return 'GUI_OPENCLAW_EXPR_LOVE';
      case 'wink':
        return 'GUI_OPENCLAW_EXPR_WINK';
      case 'neutral':
      default:
        return 'GUI_OPENCLAW_EXPR_NEUTRAL';
    }
  }
}