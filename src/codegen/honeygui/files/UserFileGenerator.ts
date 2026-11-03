/**
 * User code file generator
 * Generates user.h and user.c files (generated once only)
 */
import { Component } from '../../../hml/types';

const USER_FILE_BANNER = `/**
 * USER-OWNED FILE - GENERATED ONCE BY HONEYGUI AUTOGEN.
 * This file is not overwritten after creation; edit it freely.
 */
`;

export class UserFileGenerator {

  /**
   * Generate user header file
   */
  generateHeader(baseName: string, listComponents: Component[] = []): string {
    const guardName = `${baseName.toUpperCase()}_USER_H`;
    let code = `${USER_FILE_BANNER}#ifndef ${guardName}
#define ${guardName}

#include "../callbacks/${baseName}_callbacks.h"
#include "../ui/${baseName}_ui.h"

// Add custom declarations here
`;

    // Add note_design function declarations for list components
    if (listComponents.length > 0) {
      code += `\n// List note_design function declarations\n`;
      listComponents.forEach(comp => {
        code += `void ${comp.id}_note_design(gui_obj_t *obj, void *param);\n`;
      });
    }

    code += `\n#endif // ${guardName}\n`;
    return code;
  }

  /**
   * Generate user implementation file
   */
  generateImplementation(baseName: string, listComponents: Component[] = []): string {
    let code = `${USER_FILE_BANNER}#include "${baseName}_user.h"

// Add custom implementations here

/***
 * Template function
 * Distinguish development environments
 */
// void user_defined_func_called_by_event(void *obj, gui_event_t *e)
// {
//     GUI_UNUSED(obj);
//     GUI_UNUSED(e);
// #ifdef _HONEYGUI_SIMULATOR_
//     // TODO
// #else
//     // TODO
// #endif
// }

// void user_defined_func_called_by_msg(gui_obj_t *obj, const char *topic, void *data, uint16_t len)
// {
//     GUI_UNUSED(obj);
//     GUI_UNUSED(topic);
//     GUI_UNUSED(data);
//     GUI_UNUSED(len);
// #ifdef _HONEYGUI_SIMULATOR_
//     // TODO
// #else
//     // TODO
// #endif
// }

// void list_note_design(gui_obj_t *obj, void *param)
// {
//     GUI_UNUSED(param);
//     // Cast obj to gui_list_note_t * type
//     gui_list_note_t *note = (gui_list_note_t *)obj;
//     uint16_t index = note->index;
//     GUI_UNUSED(index);
// }

// void view_switch_in_callback(gui_view_t *view)
// {
//     GUI_UNUSED(view);
// #ifdef _HONEYGUI_SIMULATOR_
//     // TODO: initialize dynamic state when entering this view
// #else
//     // TODO: initialize dynamic state when entering this view
// #endif
// }

// void view_switch_out_callback(gui_view_t *view)
// {
//     GUI_UNUSED(view);
// #ifdef _HONEYGUI_SIMULATOR_
//     // TODO: cleanup or save state when leaving this view
// #else
//     // TODO: cleanup or save state when leaving this view
// #endif
// }
`;

    return code;
  }

  /** Add the standard banner without touching existing user code. */
  ensureHeader(content: string): string {
    if (content.startsWith(USER_FILE_BANNER)) {
      return content;
    }

    const legacyComment = /\n?\/\*\*\n \* User-defined (?:header file|implementation)\n \* This file is generated once only, feel free to modify\n \*\/\n?/g;
    const body = content.replace(legacyComment, '\n').replace(/^\n+/, '');
    return `${USER_FILE_BANNER}${body}`;
  }
}
