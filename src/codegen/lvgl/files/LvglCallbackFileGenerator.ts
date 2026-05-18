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
   * @param callbackFunctions Callback function name list
   */
  generateHeader(designName: string, callbackFunctions: string[]): string {
    const guard = `${designName.toUpperCase()}_LVGL_CALLBACKS_H`;
    let code = `/**\n`;
    code += ` * ${designName} LVGL callback declarations (auto-generated)\n`;
    code += ` */\n`;
    code += `#ifndef ${guard}\n`;
    code += `#define ${guard}\n\n`;
    code += `#include "lvgl.h"\n\n`;

    for (const fn of callbackFunctions) {
      code += `void ${fn}(lv_event_t * e);\n`;
    }

    code += `\n#endif /* ${guard} */\n`;
    return code;
  }

  /**
   * Generate {designName}_lvgl_callbacks.c (with protected area markers)
   * @param designName Design name
   * @param callbackImpls Callback function implementation list
   */
  generateImplementation(designName: string, callbackImpls: CallbackImpl[]): string {
    let code = `/**\n`;
    code += ` * ${designName} LVGL callback implementations (auto-generated)\n`;
    code += ` * User code inside protected areas will be preserved on regeneration.\n`;
    code += ` */\n`;
    code += `#include "${designName}_lvgl_callbacks.h"\n`;
    code += `#include "${designName}_lvgl_ui.h"\n\n`;

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
