/**
 * LVGL callback file generator
 * Generates standalone callback code files with protected area markers inside each callback body
 */

/** Callback function implementation descriptor */
export interface CallbackImpl {
  /** Callback function name, e.g. "btn1_event_cb" */
  name: string;
  /** C function signature, e.g. "void btn1_event_cb(lv_event_t * e)" */
  signature: string;
  /** Default function body (without protected area markers, without outer braces) */
  body: string;
}

export class LvglCallbackFileGenerator {
  /**
   * Generate {designName}_lvgl_callbacks.h
   * @param designName Design name
   * @param declarations Full callback declarations (e.g. "void cb(lv_event_t * e)").
   *   Each callback carries its own signature so event (lv_event_t) and animation
   *   timer (lv_timer_t) callbacks can coexist.
   */
  generateHeader(designName: string, declarations: string[]): string {
    const guard = `${designName.toUpperCase()}_LVGL_CALLBACKS_H`;
    let code = `/**\n`;
    code += ` * ${designName} LVGL callback declarations (auto-generated)\n`;
    code += ` */\n`;
    code += `#ifndef ${guard}\n`;
    code += `#define ${guard}\n\n`;
    code += `#include "lvgl.h"\n\n`;

    for (const decl of declarations) {
      code += `${decl};\n`;
    }

    code += `\n#endif /* ${guard} */\n`;
    return code;
  }

  /**
   * Generate {designName}_lvgl_callbacks.c (with protected area markers)
   * @param designName Design name
   * @param callbackImpls Callback function implementation list
   * @param externDeclarations Optional forward/extern declaration block for
   *   symbols defined in the UI source that animation timer callbacks reference
   *   (e.g. switchTimer handles and start/stop helpers).
   */
  generateImplementation(designName: string, callbackImpls: CallbackImpl[], externDeclarations = ''): string {
    let code = `/**\n`;
    code += ` * ${designName} LVGL callback implementations (auto-generated)\n`;
    code += ` * User code inside protected areas will be preserved on regeneration.\n`;
    code += ` */\n`;
    code += `#include "${designName}_lvgl_callbacks.h"\n`;
    code += `#include "${designName}_lvgl_ui.h"\n\n`;

    if (externDeclarations) {
      code += externDeclarations;
    }

    for (const impl of callbackImpls) {
      code += `${impl.signature}\n`;
      code += `{\n`;
      code += impl.body;
      code += `    /* USER CODE BEGIN ${impl.name} */\n`;
      code += `    /* USER CODE END ${impl.name} */\n`;
      code += `}\n\n`;
    }

    return code;
  }

  /**
   * Generate empty callback files skeleton
   * Used when no events are configured, to ensure header file exists for #include
   * @param designName Design name
   */
  generateEmptySkeleton(designName: string): { header: string; source: string } {
    const header = this.generateHeader(designName, []);
    const source = this.generateImplementation(designName, []);
    return { header, source };
  }
}
