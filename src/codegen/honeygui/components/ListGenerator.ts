/**
 * hg_list component code generator
 * Generates gui_list_create() calls and related property setters
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';
import { ComponentGeneratorFactory } from './index';
import { EventGeneratorFactory } from '../events';

export class ListGenerator implements ComponentCodeGenerator {
  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    try {
      const indentStr = '    '.repeat(indent);
      const parentRef = context.getParentRef(component);
      let { x, y, width, height } = component.position;

      // Get screen dimensions (from root hg_view)
      let screenWidth = 480;  // Defaults
      let screenHeight = 272; // Default
      
      // Find root hg_view component to get screen dimensions
      const allComponents = Array.from(context.componentMap.values());
      const rootView = allComponents.find(c => c.type === 'hg_view' && !c.parent);
      if (rootView) {
        screenWidth = rootView.position.width;
        screenHeight = rootView.position.height;
      }

      // Bounds check: ensure x + width <= screenWidth
      if (x + width > screenWidth) {
        width = Math.max(1, screenWidth - x);
      }

      // Bounds check: ensure y + height <= screenHeight
      if (y + height > screenHeight) {
        height = Math.max(1, screenHeight - y);
      }

      // Get list properties
      // itemWidth and itemHeight are in style group, but check both data and style for compatibility
      const itemWidth = component.style?.itemWidth ?? component.data?.itemWidth ?? 100;
      const itemHeight = component.style?.itemHeight ?? component.data?.itemHeight ?? 100;
      const space = component.style?.space ?? component.data?.space ?? 10;  // Default spacing: 10
      const direction = component.style?.direction ?? component.data?.direction ?? 'VERTICAL';
      const createBar = component.data?.createBar ?? false;

      // Validate required properties
      if (!component.id) {
        throw new Error('List component missing required id');
      }
      if (!component.name) {
        throw new Error(`List component ${component.id} missing required name`);
      }

      // Determine note_length based on direction
      const noteLength = direction === 'VERTICAL' ? itemHeight : itemWidth;

      // Generate LIST_DIR enum value based on direction
      const dirEnum = direction === 'VERTICAL' ? 'VERTICAL' : 'HORIZONTAL';

      // Generate note_design callback function name
      // If user-defined note_design is enabled and a function is selected, use it directly
      const useUserNoteDesign = component.data?.useUserNoteDesign === true;
      const userNoteDesignFunc = component.data?.userNoteDesignFunc as string | undefined;
      const noteDesignCallback = (useUserNoteDesign && userNoteDesignFunc && userNoteDesignFunc.trim() !== '')
        ? userNoteDesignFunc
        : `${component.id}_note_design`;

      // Get style and count (must be set immediately after creation)
      const style = component.style?.style ?? 'LIST_CLASSIC';
      const noteNum = component.data?.noteNum ?? 5;

      // Generate creation code using position and size values
      let code = `${indentStr}${component.id} = gui_list_create(${parentRef}, "${component.name}", ${x}, ${y}, ${width}, ${height}, ${noteLength}, ${space}, ${dirEnum}, ${noteDesignCallback}, NULL, ${createBar ? 'true' : 'false'});\n`;
      
      // Set style and count immediately (must be set right after creation or some styles won't work)
      code += `${indentStr}gui_list_set_style(${component.id}, ${style});\n`;
      code += `${indentStr}gui_list_set_note_num(${component.id}, ${noteNum});\n`;

      return code;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ListGenerator] generateCreation failed for component ${component.id}: ${errorMsg}`);
      
      // Return code with error comments
      const indentStr = '    '.repeat(indent);
      return `${indentStr}// ERROR: Failed to generate list creation code for ${component.id}\n` +
             `${indentStr}// Reason: ${errorMsg}\n` +
             `${indentStr}// Please check the component configuration\n`;
    }
  }

  generatePropertySetters(component: Component, indent: number, _context: GeneratorContext): string {
    try {
      const indentStr = '    '.repeat(indent);
      let code = '';

      // Validate component ID
      if (!component.id) {
        throw new Error('List component missing required id');
      }

      // Get list properties (style and noteNum already set in generateCreation)
      const autoAlign = component.data?.autoAlign ?? true;
      const inertia = component.data?.inertia ?? true;
      const loop = component.data?.loop ?? false;
      const offset = component.data?.offset ?? 0;
      const outScope = component.data?.outScope ?? 0;
      const style = component.style?.style ?? 'LIST_CLASSIC';
      const cardStackLocation = component.style?.cardStackLocation ?? 0;
      // Circle radius: default depends on direction (vertical=width, horizontal=height)
      const direction = component.style?.direction ?? 'VERTICAL';
      const defaultCircleRadius = direction === 'VERTICAL' ? component.position.width : component.position.height;
      const circleRadius = component.style?.circleRadius ?? defaultCircleRadius;
      const enableAreaDisplay = component.data?.enableAreaDisplay ?? false;

      // 1. Conditionally generate gui_list_set_auto_align() (only when autoAlign is true)
      if (autoAlign === true) {
        code += `${indentStr}gui_list_set_auto_align(${component.id}, true);\n`;
      }

      // 2. Conditionally generate gui_list_set_inertia() (only when inertia is false)
      if (inertia === false) {
        code += `${indentStr}gui_list_set_inertia(${component.id}, false);\n`;
      }

      // 3. Conditionally generate gui_list_enable_loop() (only when loop is true)
      // When loop scrolling is enabled, out-of-scope is forced to 0, style cannot be LIST_CARD
      if (loop === true) {
        code += `${indentStr}gui_list_enable_loop(${component.id}, true);\n`;
      }

      // 4. Conditionally generate gui_list_set_offset() (only when offset is non-zero)
      if (offset !== 0) {
        code += `${indentStr}gui_list_set_offset(${component.id}, ${offset});\n`;
      }

      // 5. Conditionally generate gui_list_set_out_scope() (only when outScope is non-zero, not looping, not LIST_CARD)
      // Out-of-scope must be 0 for loop scrolling or LIST_CARD style
      if (outScope !== 0 && !loop && style !== 'LIST_CARD') {
        code += `${indentStr}gui_list_set_out_scope(${component.id}, ${outScope});\n`;
      }

      // 6. LIST_CARD style specific: set stack location (always called, even when value is 0)
      if (style === 'LIST_CARD') {
        code += `${indentStr}gui_list_set_card_stack_location(${component.id}, ${cardStackLocation});\n`;
      }

      // 7. LIST_CIRCLE style specific: set circle radius (always called, using default or user value)
      if (style === 'LIST_CIRCLE') {
        code += `${indentStr}gui_list_set_circle_radius(${component.id}, ${circleRadius});\n`;
      }

      // 8. Conditionally generate gui_list_enable_area_display() (only when enableAreaDisplay is true)
      if (enableAreaDisplay === true) {
        code += `${indentStr}gui_list_enable_area_display(${component.id}, true);\n`;
      }

      // 9. Conditionally generate gui_list_keep_note_alive() (only when keepNoteAlive is true)
      const keepNoteAlive = component.data?.keepNoteAlive ?? false;
      if (keepNoteAlive === true) {
        code += `${indentStr}gui_list_keep_note_alive(${component.id}, true);\n`;
      }

      // Visibility
      if (component.visible !== undefined) {
        code += `${indentStr}gui_obj_show((gui_obj_t *)${component.id}, ${component.visible ? 'true' : 'false'});\n`;
      }

      return code;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ListGenerator] generatePropertySetters failed for component ${component.id}: ${errorMsg}`);
      
      // Return code with error comments
      const indentStr = '    '.repeat(indent);
      return `${indentStr}// ERROR: Failed to generate list property setters for ${component.id}\n` +
             `${indentStr}// Reason: ${errorMsg}\n` +
             `${indentStr}// Please check the component properties\n`;
    }
  }

  /**
   * Generate note_design callback function
   * Designs the content of each list_item
   * If useUserNoteDesign is true AND userNoteDesignFunc is set, skip generation (user provides the function)
   */
  generateNoteDesignCallback(component: Component, context: GeneratorContext, getGenerator: (type: string) => ComponentCodeGenerator): string {
    try {
      // Only skip generation if BOTH useUserNoteDesign is true AND a valid function is selected
      const useUserNoteDesign = component.data?.useUserNoteDesign === true;
      const userNoteDesignFunc = component.data?.userNoteDesignFunc as string | undefined;
      if (useUserNoteDesign && userNoteDesignFunc && userNoteDesignFunc.trim() !== '') {
        return '';
      }

      const callbackName = `${component.id}_note_design`;
      let code = '';

      // Validate component ID
      if (!component.id) {
        throw new Error('List component missing required id');
      }

      // Get all list_item child components
      const listItems = this.getAllListItems(component, context);
      
      if (listItems.length === 0) {
        // No list_items, generate empty callback
        code += `// note_design callback function declaration\n`;
        code += `static void ${callbackName}(gui_obj_t *obj, void *param);\n\n`;
        code += `// note_design callback function implementation\n`;
        code += `static void ${callbackName}(gui_obj_t *obj, void *param)\n`;
        code += `{\n`;
        code += `    GUI_UNUSED(obj);\n`;
        code += `    GUI_UNUSED(param);\n`;
        code += `    // No child components\n`;
        code += `}\n\n`;
        return code;
      }

      // Generate callback function declaration
      code += `// note_design callback function declaration\n`;
      code += `static void ${callbackName}(gui_obj_t *obj, void *param);\n\n`;

      // Generate callback function implementation
      code += `// note_design callback function implementation\n`;
      code += `static void ${callbackName}(gui_obj_t *obj, void *param)\n`;
      code += `{\n`;
      code += `    GUI_UNUSED(param);\n`;
      code += `    \n`;
      code += `    // Cast obj to gui_list_note_t * type\n`;
      code += `    gui_list_note_t *note = (gui_list_note_t *)obj;\n`;
      
      // Use different index calculation based on loop scrolling mode
      const loop = component.data?.loop ?? false;
      if (loop) {
        code += `    // Loop scroll mode: handle negative index\n`;
        code += `    int16_t index = note->index;\n`;
        code += `    gui_list_t *list = (gui_list_t *)obj->parent;\n`;
        code += `    uint8_t note_num = list->note_num;\n`;
        code += `    index %= note_num;\n`;
        code += `    index += note_num;\n`;
        code += `    index %= note_num;\n`;
      } else {
        code += `    uint16_t index = note->index;\n`;
      }
      code += `    \n`;

      // Generate switch-case structure to create different content based on index
      code += `    // Create different list_item content based on index\n`;
      code += `    switch (index)\n`;
      code += `    {\n`;

      // Generate a case for each list_item
      listItems.forEach((listItem, idx) => {
        code += `    case ${idx}:\n`;
        code += `    {\n`;
        
        // Generate child components for this list_item
        if (listItem.children && listItem.children.length > 0) {
          listItem.children.forEach(childId => {
            const child = context.componentMap.get(childId);
            if (child) {
              try {
                // Pass isFirstLevel=true since these are direct children of list_item
                code += this.generateChildComponentCode(child, context, getGenerator, 2, true);
              } catch (childError) {
                const childErrorMsg = childError instanceof Error ? childError.message : String(childError);
                console.error(`[ListGenerator] Failed to generate child component ${childId}: ${childErrorMsg}`);
                code += `        // ERROR: Failed to generate child component ${childId}\n`;
                code += `        // Reason: ${childErrorMsg}\n`;
              }
            }
          });
        }
        
        // Generate event bindings for list_item itself (if any)
        if (listItem.eventConfigs && listItem.eventConfigs.length > 0) {
          const eventGenerator = EventGeneratorFactory.getGenerator('hg_list_item');
          if (eventGenerator) {
            // Generate event binding code
            let eventCode = eventGenerator.generateEventBindings(listItem, 2, context.componentMap);
            // Only replace first argument of gui_obj_add_event_cb (component reference), keep callback name unchanged
            // e.g.: gui_obj_add_event_cb(list_item_id, callback, ...) -> gui_obj_add_event_cb(obj, callback, ...)
            eventCode = eventCode.replace(
              new RegExp(`gui_obj_add_event_cb\\(${listItem.id},`, 'g'),
              'gui_obj_add_event_cb(obj,'
            );
            eventCode = eventCode.replace(
              new RegExp(`gui_msg_subscribe\\(${listItem.id},`, 'g'),
              'gui_msg_subscribe(obj,'
            );
            code += eventCode;
          }
        }

        // Generate timer bindings for list_item (note) itself
        code += this.generateNoteTimerBindings(listItem, 2);
        
        code += `        break;\n`;
        code += `    }\n`;
      });

      // Add default case
      code += `    default:\n`;
      code += `        break;\n`;
      code += `    }\n`;

      code += `}\n\n`;

      return code;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ListGenerator] generateNoteDesignCallback failed for component ${component.id}: ${errorMsg}`);
      
      // Return callback function with error comments
      const callbackName = component.id ? `${component.id}_note_design` : 'unknown_note_design';
      return `// ERROR: Failed to generate note_design callback for ${component.id}\n` +
             `// Reason: ${errorMsg}\n` +
             `static void ${callbackName}(gui_obj_t *obj, void *param)\n` +
             `{\n` +
             `    GUI_UNUSED(obj);\n` +
             `    GUI_UNUSED(param);\n` +
             `    // Please check the list component configuration\n` +
             `}\n\n`;
    }
  }

  /**
   * Get all list_item child components (in order)
   */
  private getAllListItems(listComponent: Component, context: GeneratorContext): Component[] {
    if (!listComponent.children || listComponent.children.length === 0) {
      return [];
    }

    const listItems: Component[] = [];
    
    // Find all child components of type hg_list_item
    for (const childId of listComponent.children) {
      const child = context.componentMap.get(childId);
      if (child && child.type === 'hg_list_item') {
        listItems.push(child);
      }
    }

    // Sort by index property (if present)
    listItems.sort((a, b) => {
      const indexA = (a.data?.index as number) ?? 0;
      const indexB = (b.data?.index as number) ?? 0;
      return indexA - indexB;
    });

    return listItems;
  }

  /**
   * Generate timer binding code for list_item (note), bound to the note (obj) variable
   */
  private generateNoteTimerBindings(listItem: Component, indent: number): string {
    const indentStr = '    '.repeat(indent);
    let code = '';

    if (listItem.data?.timers && Array.isArray(listItem.data.timers)) {
      const enabledTimers = listItem.data.timers.filter((timer: any) => timer.enabled === true);
      enabledTimers.forEach((timer: any) => {
        let callback: string;
        if (timer.mode === 'preset' && ((timer.segments && timer.segments.length > 0) || (timer.actions && timer.actions.length > 0))) {
          callback = `${listItem.id}_${timer.id}_cb`;
        } else if (timer.mode === 'custom' && timer.callback) {
          callback = timer.callback;
        } else {
          return;
        }
        const timerName = timer.name || timer.id;
        code += `${indentStr}// Bind timer: ${timerName}\n`;
        code += `${indentStr}gui_obj_create_timer((gui_obj_t *)note, ${timer.interval}, ${timer.reload !== false ? 'true' : 'false'}, ${callback});\n`;
        if (!timer.runImmediately) {
          code += `${indentStr}gui_obj_start_timer((gui_obj_t *)note);\n`;
        }
      });
    } else if (listItem.data?.timerEnabled === true) {
      let callback: string;
      const timerMode = listItem.data.timerMode || 'custom';
      if (timerMode === 'preset' && listItem.data.timerActions && listItem.data.timerActions.length > 0) {
        callback = `${listItem.id}_preset_timer_cb`;
      } else if (timerMode === 'custom' && listItem.data.timerCallback) {
        callback = listItem.data.timerCallback;
      } else {
        return code;
      }
      code += `${indentStr}// Bind timer\n`;
      code += `${indentStr}gui_obj_create_timer((gui_obj_t *)note, ${listItem.data.timerInterval || 1000}, ${listItem.data.timerReload !== false ? 'true' : 'false'}, ${callback});\n`;
      code += `${indentStr}gui_obj_start_timer((gui_obj_t *)note);\n`;
    }

    return code;
  }

  /**
   * Check if component has key events configured
   */
  private hasKeyEvents(component: Component): boolean {
    if (!component.eventConfigs || component.eventConfigs.length === 0) {
      return false;
    }
    
    return component.eventConfigs.some(eventConfig => 
      (eventConfig.type === 'onKeyShortPress' || eventConfig.type === 'onKeyLongPress') && 
      eventConfig.keyName
    );
  }

  /**
   * Generate child component creation code
   * @param component Component to generate
   * @param context Generator context (contains parent reference info)
   * @param getGenerator Function to get the generator
   * @param indent Indentation level
   * @param isFirstLevel Whether this is a first-level child of list_item (first level uses note, deeper levels use actual parent)
   */
  private generateChildComponentCode(
    component: Component, 
    context: GeneratorContext, 
    getGenerator: (type: string) => ComponentCodeGenerator, 
    indent: number,
    isFirstLevel: boolean = true
  ): string {
    try {
      const indentStr = '    '.repeat(indent);
      let code = '';

      // Validate component
      if (!component.id) {
        throw new Error('Child component missing required id');
      }
      if (!component.type) {
        throw new Error(`Child component ${component.id} missing required type`);
      }

      // Add comment
      code += `${indentStr}// Create ${component.name || component.id} (${component.type})\n`;

      // Determine which context to use:
      // - First-level children: use note as parent
      // - Deeper-level children: use provided context (already contains correct parent reference)
      let effectiveContext: GeneratorContext;
      
      if (isFirstLevel) {
        // First level: force use note
        effectiveContext = {
          componentMap: context.componentMap,
          getParentRef: (_comp: Component) => '(gui_obj_t *)note',
          projectRoot: context.projectRoot,
          generateTimerBindings: context.generateTimerBindings,
          isInsideListItem: true
        };
      } else {
        // Deeper level: use provided context (preserve isInsideListItem flag)
        effectiveContext = context;
      }

      // Use corresponding generator to generate creation code
      const generator = getGenerator(component.type);
      if (!generator) {
        throw new Error(`No generator found for component type: ${component.type}`);
      }

      let creationCode = generator.generateCreation(component, indent, effectiveContext);
      
      // For hg_view and hg_window, need to handle child component placeholders
      if (component.type === 'hg_view' || component.type === 'hg_window') {
        let childrenCode = '';
        if (component.children && component.children.length > 0) {
          childrenCode += '\n';
          // Create new context with parent reference updated to current component
          const parentId = component.id;
          const nestedContext: GeneratorContext = {
            componentMap: context.componentMap,
            getParentRef: (_comp: Component) => `(gui_obj_t *)${parentId}`,
            projectRoot: context.projectRoot,
            generateTimerBindings: context.generateTimerBindings,
            isInsideListItem: context.isInsideListItem
          };
          component.children.forEach(childId => {
            const child = context.componentMap.get(childId);
            if (child) {
              try {
                // Pass isFirstLevel=false since these are children of window/view, not direct children of list_item
                childrenCode += this.generateChildComponentCode(child, nestedContext, getGenerator, indent, false);
              } catch (nestedError) {
                const nestedErrorMsg = nestedError instanceof Error ? nestedError.message : String(nestedError);
                console.error(`[ListGenerator] Failed to generate nested child component ${childId}: ${nestedErrorMsg}`);
                childrenCode += `${indentStr}// ERROR: Failed to generate nested child ${childId}\n`;
                childrenCode += `${indentStr}// Reason: ${nestedErrorMsg}\n`;
              }
            }
          });
        }
        // Replace placeholders (including children and event bindings)
        creationCode = creationCode.replace(/__CHILDREN_PLACEHOLDER__/g, childrenCode);
        
        // Generate event binding code for window in list_item
        let eventBindingsCode = '';
        if (component.type === 'hg_window' && component.eventConfigs && component.eventConfigs.length > 0) {
          const eventGenerator = EventGeneratorFactory.getGenerator('hg_window');
          if (eventGenerator) {
            const eventCode = eventGenerator.generateEventBindings(component, indent, context.componentMap);
            if (eventCode) {
              eventBindingsCode = '\n' + eventCode;
            }
          }
        }
        creationCode = creationCode.replace(/__EVENT_BINDINGS_PLACEHOLDER__/g, eventBindingsCode);
        code += creationCode;
      } else {
        // Regular component: add creation code directly
        code += creationCode;
        
        // Generate property setter code
        code += generator.generatePropertySetters(component, indent, effectiveContext);

        // Dual-state button: generate click event binding
        if (component.type === 'hg_button' && (component.data?.toggleMode === true || component.data?.toggleMode === 'true')) {
          const buttonGenerator = ComponentGeneratorFactory.getGenerator('hg_button');
          if ('generateEventBinding' in buttonGenerator) {
            code += (buttonGenerator as any).generateEventBinding(component, indent);
          }
        }

        // Button effects: generate event bindings for rect, circle, image
        if (['hg_rect', 'hg_circle', 'hg_image'].includes(component.type)) {
          const buttonMode = component.data?.buttonMode;
          if (buttonMode && buttonMode !== 'none') {
            const generator = ComponentGeneratorFactory.getGenerator(component.type);
            if ('generateEventBinding' in generator) {
              code += (generator as any).generateEventBinding(component, indent);
            }
          }
        }

        // Generate event binding code
        const eventGenerator = EventGeneratorFactory.getGenerator(component.type);
        if (eventGenerator && component.eventConfigs && component.eventConfigs.length > 0) {
          code += eventGenerator.generateEventBindings(component, indent, context.componentMap);
        }

        // Generate timer binding code
        if (effectiveContext.generateTimerBindings) {
          const timerCode = effectiveContext.generateTimerBindings(component, indent);
          if (timerCode.trim()) {
            code += '\n' + timerCode;
          }
        }

        // Add focus setting if component has key events
        if (this.hasKeyEvents(component)) {
          code += `${indentStr}gui_obj_focus_set((gui_obj_t *)${component.id});\n`;
        }

        // Recursively generate child components (if any)
        if (component.children && component.children.length > 0) {
          // Create new context with parent reference updated to current component
          const parentId = component.id;
          const nestedContext: GeneratorContext = {
            componentMap: context.componentMap,
            getParentRef: (_comp: Component) => `(gui_obj_t *)${parentId}`,
            projectRoot: context.projectRoot,
            generateTimerBindings: context.generateTimerBindings,
            isInsideListItem: context.isInsideListItem
          };
          component.children.forEach(childId => {
            const child = context.componentMap.get(childId);
            if (child) {
              try {
                // Pass isFirstLevel=false since these are children of a regular component
                code += this.generateChildComponentCode(child, nestedContext, getGenerator, indent, false);
              } catch (nestedError) {
                const nestedErrorMsg = nestedError instanceof Error ? nestedError.message : String(nestedError);
                console.error(`[ListGenerator] Failed to generate nested child component ${childId}: ${nestedErrorMsg}`);
                code += `${indentStr}// ERROR: Failed to generate nested child ${childId}\n`;
                code += `${indentStr}// Reason: ${nestedErrorMsg}\n`;
              }
            }
          });
        }
      }

      return code;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ListGenerator] generateChildComponentCode failed for component ${component.id}: ${errorMsg}`);
      
      // Return code with error comments
      const indentStr = '    '.repeat(indent);
      return `${indentStr}// ERROR: Failed to generate child component code for ${component.id}\n` +
             `${indentStr}// Reason: ${errorMsg}\n`;
    }
  }
}
