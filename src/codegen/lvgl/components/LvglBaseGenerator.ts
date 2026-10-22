/**
 * LVGL component code generator abstract base class
 * Encapsulates common logic for position calculation and size resolution,
 * eliminating duplicate code across component generators
 */
import { Component } from '../../../hml/types';
import { LvglComponentCodeGenerator, LvglGeneratorContext } from '../LvglComponentGenerator';

export abstract class LvglBaseGenerator implements LvglComponentCodeGenerator {
  /**
   * Resolve final position from Component (including transform.translateX/translateY offsets)
   */
  protected resolvePosition(component: Component): { x: number; y: number } {
    const tx = Number(component.style?.transform?.translateX || 0);
    const ty = Number(component.style?.transform?.translateY || 0);
    return {
      x: Math.round(component.position.x + tx),
      y: Math.round(component.position.y + ty),
    };
  }

  /**
   * Resolve size from Component (minimum value 1)
   */
  protected resolveSize(component: Component): { width: number; height: number } {
    return {
      width: Math.max(1, Math.round(component.position.width)),
      height: Math.max(1, Math.round(component.position.height)),
    };
  }

  /**
   * Text opacity (0-255). LVGL text_opa affects glyphs only, which mirrors
   * HoneyGUI applying opacity through the text color alpha.
   */
  protected resolveTextOpacity(component: Component): number {
    const raw = Number(component.style?.opacity ?? component.data?.opacity ?? 255);
    return Number.isFinite(raw) ? Math.max(0, Math.min(255, Math.round(raw))) : 255;
  }

  /** Emit text_opa only when the label is actually translucent. */
  protected generateTextOpa(component: Component): string {
    const opacity = this.resolveTextOpacity(component);
    return opacity < 255
      ? `    lv_obj_set_style_text_opa(${component.id}, ${opacity}, LV_PART_MAIN);\n`
      : '';
  }

  /**
   * Generate lv_obj_set_pos + lv_obj_set_size two lines of code
   */
  protected generatePositionAndSize(component: Component): string {
    const { x, y } = this.resolvePosition(component);
    const { width, height } = this.resolveSize(component);
    let code = `    lv_obj_set_pos(${component.id}, ${x}, ${y});\n`;
    code += `    lv_obj_set_size(${component.id}, ${width}, ${height});\n`;
    return code;
  }

  /** Subclasses must implement: generate component creation + property setup code */
  abstract generateCreation(
    component: Component, parentRef: string, ctx: LvglGeneratorContext
  ): string;

  /** Optional: generate event callback function code */
  generateEventCallbacks?(components: Component[]): string;

  /** Optional: generate global style/variable definitions */
  generateGlobalDefinitions?(components: Component[]): string;
}
