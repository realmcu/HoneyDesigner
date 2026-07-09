/**
 * LVGL header file generator
 * Generates {designName}_lvgl_ui.h content
 *
 * Declares component handles and per-view create functions.
 */
import { Component } from '../../../hml/types';

export class LvglHeaderFileGenerator {
  /**
   * Generate {designName}_lvgl_ui.h file content
   */
  generate(designName: string, orderedComponents: Component[]): string {
    const guard = `${designName.toUpperCase()}_LVGL_UI_H`;

    // Find root views (hg_view with no parent or parent not in component list)
    const componentIds = new Set(orderedComponents.map(c => c.id));
    const rootViews = orderedComponents.filter(c =>
      c.type === 'hg_view' && (!c.parent || !componentIds.has(c.parent))
    );

    let code = `/**\n`;
    code += ` * ${designName} LVGL UI definitions (auto-generated)\n`;
    code += ` */\n`;
    code += `#ifndef ${guard}\n`;
    code += `#define ${guard}\n\n`;
    code += `#include "lvgl.h"\n\n`;
    code += `#ifdef __cplusplus\n`;
    code += `extern "C" {\n`;
    code += `#endif\n\n`;

    code += `// Component handles\n`;
    orderedComponents.forEach(c => {
      code += `extern lv_obj_t * ${c.id};\n`;
    });

    // Per-view create function declarations
    if (rootViews.length > 0) {
      code += `\n// Per-view create functions\n`;
      rootViews.forEach(view => {
        const isEntry = view.data?.entry === true || view.data?.entry === 'true';
        const comment = isEntry ? ' (entry view)' : '';
        code += `void create_${view.id}(void);${comment ? `  /* ${comment.trim()} */` : ''}\n`;
      });
    }

    // Main entry function
    code += `\n// Main entry: creates all views\n`;
    code += `void ${designName}_lvgl_ui_create(void);\n\n`;
    code += `#ifdef __cplusplus\n`;
    code += `}\n`;
    code += `#endif\n\n`;
    code += `#endif /* ${guard} */\n`;
    return code;
  }
}
