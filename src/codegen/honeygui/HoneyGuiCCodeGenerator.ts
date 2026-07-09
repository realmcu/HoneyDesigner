/**
 * HoneyGUI C Code Generator
 * Generates C code calling HoneyGUI APIs from a component tree
 * 
 * File generation strategy (Qt-style + protected areas):
 * - *_ui.h/c: Auto-generated, overwritten each time (pure UI code)
 * - *_callbacks.h/c: Generated once + protected areas (event callbacks)
 * - User code directory: Generated once, fully user-controlled
 */

import * as fs from 'fs';
import * as path from 'path';
import { writeFileIfChanged } from '../../utils/fileWrite';
import { HoneyGuiApiMapper } from './HoneyGuiApiMapper';
import { Component } from '../../hml/types';
import { SConscriptGenerator } from '../../simulation/SConscriptGenerator';
import { ICodeGenerator, CodeGenOptions, CodeGenResult } from '../ICodeGenerator';
import { EventGeneratorFactory } from './events';
import { ComponentGeneratorFactory, GeneratorContext } from './components';
import { ListGenerator } from './components/ListGenerator';
import { LabelGenerator } from './components/LabelGenerator';
import { ArcGenerator } from './components/ArcGenerator';
import { CallbackFileGenerator, UserFileGenerator, ProtectedAreaMerger } from './files';

// Re-export for backward compatibility
export { Component } from '../../hml/types';
export { CodeGenOptions, CodeGenResult } from '../ICodeGenerator';

export class HoneyGuiCCodeGenerator implements ICodeGenerator {
  private apiMapper: HoneyGuiApiMapper;
  private components: Component[];
  private options: CodeGenOptions;
  private componentMap: Map<string, Component>;

  constructor(components: Component[], options: CodeGenOptions) {
    this.apiMapper = new HoneyGuiApiMapper();
    this.components = components;
    this.options = options;
    this.componentMap = new Map(components.map(c => [c.id, c]));
  }

  /**
   * Generate all code files
   */
  async generate(): Promise<CodeGenResult> {
    try {
      const files: string[] = [];
      const designName = this.options.designName;
      const srcDir = this.options.srcDir;

      // Create directory structure
      const uiDir = path.join(srcDir, 'ui');
      const callbacksDir = path.join(srcDir, 'callbacks');
      const userDir = path.join(srcDir, 'user');

      [uiDir, callbacksDir, userDir].forEach(dir => {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      });

      // === UI code (overwritten each time) ===
      const uiHeaderFile = path.join(uiDir, `${designName}_ui.h`);
      writeFileIfChanged(uiHeaderFile, this.generateUiHeader(designName));
      files.push(uiHeaderFile);

      const uiImplFile = path.join(uiDir, `${designName}_ui.c`);
      writeFileIfChanged(uiImplFile, this.generateUiImplementation(designName));
      files.push(uiImplFile);

      // === Callback code (protected areas) ===
      const callbackGenerator = new CallbackFileGenerator(this.components);
      const callbackHeaderFile = path.join(callbacksDir, `${designName}_callbacks.h`);
      const callbackImplFile = path.join(callbacksDir, `${designName}_callbacks.c`);
      
      // Read existing callbacks.c content (if exists)
      let existingCallbacksC: string | undefined;
      if (fs.existsSync(callbackImplFile)) {
        existingCallbacksC = fs.readFileSync(callbackImplFile, 'utf-8');
      }
      
      // Callback header: overwritten each time, auto-extracts custom function declarations from callbacks.c
      writeFileIfChanged(callbackHeaderFile, callbackGenerator.generateHeader(designName, existingCallbacksC));
      files.push(callbackHeaderFile);
      
      // Callback implementation: merge with protected areas
      if (!fs.existsSync(callbackImplFile)) {
        writeFileIfChanged(callbackImplFile, callbackGenerator.generateImplementation(designName));
        files.push(callbackImplFile);
      } else if (this.options.enableProtectedAreas) {
        const existing = fs.readFileSync(callbackImplFile, 'utf-8');
        // Pass existing content to check for already-existing functions
        const merged = ProtectedAreaMerger.merge(existing, callbackGenerator.generateImplementation(designName, existing));
        writeFileIfChanged(callbackImplFile, merged);
        files.push(callbackImplFile);
      }

      // === User code (generated once only) ===
      const userGenerator = new UserFileGenerator();
      const userHeaderFile = path.join(userDir, `${designName}_user.h`);
      const userImplFile = path.join(userDir, `${designName}_user.c`);

      // Collect list components that use user-defined note_design
      const listComponentsWithUserNoteDesign = this.components.filter(
        c => c.type === 'hg_list' && c.data?.useUserNoteDesign === true
      );

      if (!fs.existsSync(userHeaderFile)) {
        writeFileIfChanged(userHeaderFile, userGenerator.generateHeader(designName, listComponentsWithUserNoteDesign));
        files.push(userHeaderFile);
      }

      if (!fs.existsSync(userImplFile)) {
        writeFileIfChanged(userImplFile, userGenerator.generateImplementation(designName, listComponentsWithUserNoteDesign));
        files.push(userImplFile);
      }

      // Generate SConscript
      SConscriptGenerator.generate(srcDir);
      files.push(path.join(srcDir, 'SConscript'));

      return { success: true, files };
    } catch (error) {
      return {
        success: false,
        files: [],
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Generate UI header file (overwritten each time)
   */
  private generateUiHeader(baseName: string): string {
    const guardName = `${baseName.toUpperCase()}_UI_H`;
    const componentTypes = [...new Set(this.components.map(c => c.type))];
    const headers = this.apiMapper.getRequiredHeaders(componentTypes);
    const hasView = componentTypes.includes('hg_view');
    const hasWindow = componentTypes.includes('hg_window');
    const has3D = componentTypes.includes('hg_3d');
    const hasLabel = componentTypes.includes('hg_label');
    const hasArc = componentTypes.includes('hg_arc');
    
    // Check for arc groups
    const hasArcGroup = this.components.some(c => c.type === 'hg_arc' && c.data?.arcGroup);

    let code = `/**
 * ${baseName} UI Definition (Auto-generated, do not modify manually)
 */
#ifndef ${guardName}
#define ${guardName}

#include "guidef.h"
#include "gui_obj.h"
`;

    if (hasView) {
      code += `#include "gui_components_init.h"\n`;
      code += `#include "gui_view.h"\n`;
      code += `#include "gui_view_instance.h"\n`;
    }

    if (hasWindow) {
      code += `#include "gui_win.h"\n`;
    }

    // Check for text-related components (label, time_label, scroll_text)
    const hasTextComponent = componentTypes.includes('hg_label') || 
                            componentTypes.includes('hg_time_label') || 
                            componentTypes.includes('hg_scroll_text');
    
    // If text components exist, include font-related headers first
    if (hasTextComponent) {
      code += `#include "draw_font.h"\n`;
      code += `#include "font_types.h"\n`;
    }

    // Check for scrolling text
    const hasScrollText = this.components.some(c => c.type === 'hg_label' && (c.data?.enableScroll === true || c.data?.enableScroll === 'true'));
    if (hasScrollText) {
      code += `#include "gui_scroll_text.h"\n`;
    }

    if (has3D) {
      code += `#include "gui_lite3d.h"\n`;
      code += `#include "gui_vfs.h"\n`;
      
      // Check for 3D models with touch rotation enabled
      const hasTouchRotation = this.components.some(c => 
        c.type === 'hg_3d' && (c.data?.touchRotationEnabled as boolean)
      );
      if (hasTouchRotation) {
        code += `#include "tp_algo.h"\n`;
      }
    }

    // Cellular menu component headers
    if (componentTypes.includes('hg_menu_cellular')) {
      code += `#include "gui_menu_cellular.h"\n`;
    }

    // QR code / barcode component headers
    if (componentTypes.includes('hg_qbcode')) {
      code += `#include "gui_qbcode.h"\n`;
    }
    
    // If arc groups exist, add headers
    if (hasArcGroup) {
      code += `#include "gui_arc_group.h"\n`;
    }

    headers.forEach(header => {
      if (header !== 'gui_view.h' && header !== 'gui_win.h') {
        code += `#include "${header}"\n`;
      }
    });

    // Lite video components require gui_lite_video.h
    const hasLiteVideo = this.components.some(c =>
      c.type === 'hg_video' && (c.data?.useMsv1 === true || c.data?.useMsv1 === 'true')
    );
    if (hasLiteVideo) {
      code += `#include "gui_lite_video.h"\n`;
    }

    // Streaming components require gui_stream.h
    if (componentTypes.includes('hg_streaming')) {
      code += `#include "gui_stream.h"\n`;
    }

    // Particle effect component headers (dynamically generated based on particleEffect value)
    const particleComponents = this.components.filter(c => c.type === 'hg_particle');
    if (particleComponents.length > 0) {
      const effectHeaders = new Set<string>();
      particleComponents.forEach(comp => {
        const effectType = comp.data?.particleEffect || 'snow';
        effectHeaders.add(`effect_${effectType}.h`);
      });
      effectHeaders.forEach(header => {
        code += `#include "${header}"\n`;
      });
    }

    // 3D models do not need external data declarations (load bin files via VFS paths)

    code += `\n// Component handle declarations\n`;

    this.components.forEach(comp => {
      // Skip hg_view, hg_3d, and hg_list_item (list_item is handled by note_design callback)
      if (comp.type !== 'hg_view' && comp.type !== 'hg_3d' && comp.type !== 'hg_list_item') {
        // Use the correct handle type based on component type
        const handleType = this.getComponentHandleType(comp);
        code += `extern ${handleType} *${comp.id};\n`;
        
        // If split time format time label, add sub-component declarations
        if (comp.type === 'hg_time_label' && comp.data?.timeFormat === 'HH:mm-split') {
          code += `extern gui_text_t *${comp.id}_hour;\n`;
          code += `extern gui_text_t *${comp.id}_colon;\n`;
          code += `extern gui_text_t *${comp.id}_min;\n`;
        }
      }
    });

    // Toggle button state management function declarations
    const toggleButtons = this.components.filter(c => c.type === 'hg_button' && (c.data?.toggleMode === true || c.data?.toggleMode === 'true'));
    if (toggleButtons.length > 0) {
      code += `\n// Toggle button state management function declarations\n`;
      toggleButtons.forEach(comp => {
        code += `extern bool ${comp.id}_get_state(void);\n`;
        code += `extern void ${comp.id}_set_state(bool state);\n`;
      });
    }

    // hg_menu_cellular switch_view callback function declarations
    const menuCellularComponents = this.components.filter(c => c.type === 'hg_menu_cellular');
    if (menuCellularComponents.length > 0) {
      const { MenuCellularGenerator } = require('./components/MenuCellularGenerator');
      menuCellularComponents.forEach(comp => {
        const iconActions: any[] = Array.isArray(comp.data?.iconActions) ? comp.data.iconActions : [];
        const hasAnyAction = iconActions.some((a: any) => a && a.target && a.target.trim() !== '');
        if (hasAnyAction) {
          code += `\n// ${comp.id} menu cellular switch view callback declarations\n`;
          const generator = new MenuCellularGenerator();
          iconActions.forEach((action: any, index: number) => {
            if (action && action.target && action.target.trim() !== '') {
              const cbName = generator.getSwitchViewCallbackName(comp.id, index);
              code += `void ${cbName}(void *obj, gui_event_t *e);\n`;
            }
          });
        }
      });
    }

    // Timer label control function declarations
    const timerLabels = this.components.filter(c => c.type === 'hg_timer_label');
    if (timerLabels.length > 0) {
      code += `\n`;
      timerLabels.forEach(comp => {
        const generator = ComponentGeneratorFactory.getGenerator('hg_timer_label');
        if ('generateTimerHeaders' in generator) {
          code += (generator as any).generateTimerHeaders(comp);
        }
      });
    }

    code += `
#endif // ${guardName}
`;

    return code;
  }

  /**
   * Generate UI implementation file (overwritten each time)
   */
  private generateUiImplementation(baseName: string): string {
    // Collect all time labels and timer labels
    const timeLabels = this.components.filter(c => c.type === 'hg_time_label');
    const timerLabels = this.components.filter(c => c.type === 'hg_timer_label');
    
    let code = `/**
 * ${baseName} UI Implementation (Auto-generated, do not modify manually)
 */
#include "${baseName}_ui.h"
#include "../callbacks/${baseName}_callbacks.h"
#include "../user/${baseName}_user.h"
#include <stddef.h>
`;

    // If time labels or timer labels exist, add required headers
    if (timeLabels.length > 0) {
      code += `#include <time.h>\n`;
    }
    if (timerLabels.length > 0) {
      code += `#include <stdio.h>\n`;
      code += `#include <string.h>\n`;
    }

    code += `\n// Component handle definitions\n`;

    this.components.forEach(comp => {
      // Skip hg_view, hg_3d, and hg_list_item (list_item is handled by note_design callback)
      if (comp.type !== 'hg_view' && comp.type !== 'hg_3d' && comp.type !== 'hg_list_item') {
        // Use the correct handle type based on component type
        const handleType = this.getComponentHandleType(comp);
        code += `${handleType} *${comp.id} = NULL;\n`;
        
        // If split time format time label, add sub-component definitions
        if (comp.type === 'hg_time_label' && comp.data?.timeFormat === 'HH:mm-split') {
          code += `gui_text_t *${comp.id}_hour = NULL;\n`;
          code += `gui_text_t *${comp.id}_colon = NULL;\n`;
          code += `gui_text_t *${comp.id}_min = NULL;\n`;
        }
      }
    });

    // Generate global time string variables for time labels
    if (timeLabels.length > 0) {
      code += `\n// Time string global variables\n`;
      timeLabels.forEach(label => {
        const bufferSize = this.getTimeBufferSize(label.data?.timeFormat);
        code += `char ${label.id}_time_str[${bufferSize}] = {0};\n`;
      });
    }

    // Generate global variables and callback functions for timer labels
    if (timerLabels.length > 0) {
      code += `\n`;
      timerLabels.forEach(label => {
        const generator = ComponentGeneratorFactory.getGenerator('hg_timer_label');
        if ('generateTimerGlobals' in generator) {
          code += (generator as any).generateTimerGlobals(label);
        }
      });
    }

    code += `\n`;

    // Generate toggle button callback functions
    const hasToggleButtons = this.components.some(c => c.type === 'hg_button' && (c.data?.toggleMode === true || c.data?.toggleMode === 'true'));
    if (hasToggleButtons) {
      code += `// Toggle button callback functions\n`;
      this.components.forEach(comp => {
        if (comp.type === 'hg_button' && (comp.data?.toggleMode === true || comp.data?.toggleMode === 'true')) {
          const generator = ComponentGeneratorFactory.getGenerator('hg_button');
          if ('generateToggleCallback' in generator) {
            code += (generator as any).generateToggleCallback(comp);
          }
        }
      });
    }

    // Generate normal button press/release callback functions
    const normalButtons = this.components.filter(c => c.type === 'hg_button' && !(c.data?.toggleMode === true || c.data?.toggleMode === 'true') && (c.data?.imageOn || c.data?.imageOff));
    if (normalButtons.length > 0) {
      code += `// Normal button press/release callback functions\n`;
      normalButtons.forEach(comp => {
        const generator = ComponentGeneratorFactory.getGenerator('hg_button');
        if ('generateNormalCallback' in generator) {
          code += (generator as any).generateNormalCallback(comp);
        }
      });
    }

    // Generate hg_menu_cellular switch_view callback functions
    const hasMenuCellular = this.components.some(c => c.type === 'hg_menu_cellular');
    if (hasMenuCellular) {
      const { MenuCellularGenerator } = require('./components/MenuCellularGenerator');
      this.components.forEach(comp => {
        if (comp.type === 'hg_menu_cellular') {
          const generator = new MenuCellularGenerator();
          const cbCode = generator.generateSwitchViewCallbacks(comp);
          if (cbCode) {
            code += cbCode;
          }
        }
      });
    }

    // Generate button effect callback functions (rect, circle, image)
    const hasButtonEffects = this.components.some(c => 
      ['hg_rect', 'hg_circle', 'hg_image'].includes(c.type) && 
      c.data?.buttonMode && 
      c.data.buttonMode !== 'none'
    );
    if (hasButtonEffects) {
      code += `// Button effect callback functions\n`;
      this.components.forEach(comp => {
        if (['hg_rect', 'hg_circle', 'hg_image'].includes(comp.type)) {
          const buttonMode = comp.data?.buttonMode;
          if (buttonMode && buttonMode !== 'none') {
            const generator = ComponentGeneratorFactory.getGenerator(comp.type);
            if ('generateButtonCallback' in generator) {
              code += (generator as any).generateButtonCallback(comp);
            }
          }
        }
      });
    }

    // Generate 3D model callback functions (including animations)
    const has3DComponents = this.components.some(c => c.type === 'hg_3d');
    if (has3DComponents) {
      code += `// 3D model callback functions\n`;
      this.components.forEach(comp => {
        if (comp.type === 'hg_3d') {
          const generator = ComponentGeneratorFactory.getGenerator('hg_3d');
          if ('generateCallbacks' in generator) {
            code += (generator as any).generateCallbacks(comp);
          }
        }
      });
    }

    // No longer generate standalone on_switch_in callbacks; handled directly in GUI_VIEW_INSTANCE switch_in

    // Generate note_design callback functions for all list components
    const hasListComponents = this.components.some(c => c.type === 'hg_list');
    if (hasListComponents) {
      code += `// List component note_design callback functions\n`;
      this.components.forEach(comp => {
        if (comp.type === 'hg_list') {
          const generator = ComponentGeneratorFactory.getGenerator('hg_list');
          if (generator instanceof ListGenerator) {
            code += generator.generateNoteDesignCallback(
              comp, 
              this.createGeneratorContext(),
              (type: string) => ComponentGeneratorFactory.getGenerator(type)
            );
          }
        }
      });
    }

    // Generate split time label callback functions
    const splitTimeLabels = this.components.filter(c => c.type === 'hg_time_label' && c.data?.timeFormat === 'HH:mm-split');
    if (splitTimeLabels.length > 0) {
      code += `// Split time label callback functions\n`;
      splitTimeLabels.forEach(label => {
        code += this.generateSplitTimeCallbacks(label);
      });
    }

    const rootComponents = this.components.filter(c => c.parent === null);
    rootComponents.forEach(comp => {
      code += this.generateComponentTree(comp, 0);
    });

    return code;
  }

  /**
   * Recursively generate component tree
   */
  private generateComponentTree(component: Component, indent: number): string {
    let code = '';
    const indentStr = '    '.repeat(indent);

    // Skip hg_list_item generation (handled by note_design callback)
    if (component.type === 'hg_list_item') {
      return code;
    }

    // Add comment
    code += `\n${indentStr}// Create ${component.id} (${component.type})\n`;

    // hg_view/hg_window uses ViewGenerator
    if (component.type === 'hg_view' || component.type === 'hg_window') {
      code += this.generateViewComponent(component, indent);
      return code;
    }

    // Regular component: generate creation code
    code += this.generateComponentCreation(component, indent);

    // Generate property setter code
    code += this.generatePropertySetters(component, indent);

    // Button: generate event binding (toggle or normal mode)
    if (component.type === 'hg_button') {
      const generator = ComponentGeneratorFactory.getGenerator('hg_button');
      if ('generateEventBinding' in generator) {
        code += (generator as any).generateEventBinding(component, indent);
      }
    }

    // Button effect: generate event bindings for rect, circle, image
    if (['hg_rect', 'hg_circle', 'hg_image'].includes(component.type)) {
      const buttonMode = component.data?.buttonMode;
      if (buttonMode && buttonMode !== 'none') {
        const generator = ComponentGeneratorFactory.getGenerator(component.type);
        if ('generateEventBinding' in generator) {
          code += (generator as any).generateEventBinding(component, indent);
        }
      }
    }

    // Generate timer binding code
    code += this.generateTimerBindings(component, indent);

    // Generate event binding code
    code += this.generateEventConfigBindings(component, indent);

    // If component has key events configured, set focus
    if (this.hasKeyEvents(component)) {
      code += `${indentStr}gui_obj_focus_set((gui_obj_t *)${component.id});\n`;
    }

    // Recursively generate child components
    if (component.children && component.children.length > 0) {
      component.children.forEach(childId => {
        const child = this.componentMap.get(childId);
        if (child) {
          code += this.generateComponentTree(child, indent);
        }
      });
    }

    return code;
  }

  /**
   * Generate component creation code (excluding hg_view)
   */
  private generateComponentCreation(component: Component, indent: number): string {
    const generator = ComponentGeneratorFactory.getGenerator(component.type);
    return generator.generateCreation(component, indent, this.createGeneratorContext());
  }

  /**
   * Generate hg_view/hg_window component code
   * Uses the corresponding Generator and handles child components
   * Children are generated in array order (i.e., component tree display order)
   * Earlier-created components render at the bottom layer, later ones on top
   */
  private generateViewComponent(component: Component, indent: number): string {
    const generator = ComponentGeneratorFactory.getGenerator(component.type);
    let code = generator.generateCreation(component, indent, this.createGeneratorContext());
    
    // Generate child component code (in children array order, i.e., component tree display order)
    let childrenCode = '';
    if (component.children && component.children.length > 0) {
      childrenCode += '\n';
      
      // Collect arc groups
      const childComponents = component.children
        .map(id => this.componentMap.get(id))
        .filter((c): c is Component => c !== undefined);
      
      const arcGroups = ArcGenerator.collectArcGroups(childComponents);
      const processedGroups = new Set<string>();
      
      // Sort children by zIndex ascending (lower zIndex created first = bottom layer)
      // For same zIndex, maintain children array original order
      const sortedChildIds = [...component.children].sort((a, b) => {
        const compA = this.componentMap.get(a);
        const compB = this.componentMap.get(b);
        const zIndexA = compA?.zIndex ?? 0;
        const zIndexB = compB?.zIndex ?? 0;
        return zIndexA - zIndexB;  // Ascending: lower zIndex created first = bottom layer
      });
      
      sortedChildIds.forEach(childId => {
        const child = this.componentMap.get(childId);
        if (child) {
          // Check if this is an arc group member
          if (child.type === 'hg_arc' && child.data?.arcGroup) {
            const groupKey = `${component.id}_${child.data.arcGroup}`;
            // Only generate group code on first encounter of this group
            if (!processedGroups.has(groupKey) && arcGroups.has(groupKey)) {
              const groupInfo = arcGroups.get(groupKey)!;
              const parentRef = component.type === 'hg_view' ? '(gui_obj_t *)view' : component.id;
              const childIndent = component.type === 'hg_window' ? indent : indent + 1;
              childrenCode += ArcGenerator.generateGroupCreation(groupKey, groupInfo, parentRef, childIndent);
              processedGroups.add(groupKey);
            }
            // Skip standalone generation for group members
            return;
          }
          
          // Adjust indentation for hg_window children (no switch_in callback wrapper)
          const childIndent = component.type === 'hg_window' ? indent : indent + 1;
          childrenCode += this.generateComponentTree(child, childIndent);
        }
      });
    }
    
    // Generate event binding code (for hg_view and hg_window onMessage, key events, etc.)
    let eventBindingsCode = '';
    if (component.type === 'hg_view' || component.type === 'hg_window') {
      // For hg_view, use indent + 1 (inside switch_in function)
      // For hg_window, use indent (directly inside parent component)
      const eventIndent = component.type === 'hg_view' ? indent + 1 : indent;
      eventBindingsCode = this.generateEventConfigBindings(component, eventIndent);
      
      // If component has key events configured, set focus
      if (this.hasKeyEvents(component)) {
        const indentStr = '    '.repeat(eventIndent);
        // hg_view uses view variable, hg_window uses component id
        const targetRef = component.type === 'hg_view' ? '(gui_obj_t *)view' : `(gui_obj_t *)${component.id}`;
        eventBindingsCode += `${indentStr}gui_obj_focus_set(${targetRef});\n`;
      }
      
      if (eventBindingsCode) {
        eventBindingsCode = '\n' + eventBindingsCode;
      }
    }
    
    // Replace placeholders (global replace to support multiple windows)
    code = code.replace(/__CHILDREN_PLACEHOLDER__/g, childrenCode);
    code = code.replace(/__EVENT_BINDINGS_PLACEHOLDER__/g, eventBindingsCode);
    
    return code;
  }

  /**
   * Generate property setter code
   */
  private generatePropertySetters(component: Component, indent: number): string {
    const generator = ComponentGeneratorFactory.getGenerator(component.type);
    return generator.generatePropertySetters(component, indent, this.createGeneratorContext());
  }

  /**
   * Create generator context
   */
  private createGeneratorContext(): GeneratorContext {
    // Derive project root from srcDir (parent directory of srcDir)
    const projectRoot = path.dirname(this.options.srcDir);
    
    return {
      componentMap: this.componentMap,
      projectRoot,
      projectI18nCatalog: this.options.projectI18nCatalog,
      getParentRef: (component: Component) => {
        if (!component.parent) return 'NULL';
        const parentComp = this.componentMap.get(component.parent);
        if (parentComp?.type === 'hg_view') {
          return '(gui_obj_t *)view';
        }
        return component.parent;
      },
      generateTimerBindings: this.generateTimerBindings.bind(this)
    };
  }

  /**
   * Generate event config binding code (based on eventConfigs)
   */
  private generateEventConfigBindings(component: Component, indent: number): string {
    const generator = EventGeneratorFactory.getGenerator(component.type);
    return generator.generateEventBindings(component, indent, this.componentMap);
  }

  /**
   * Generate timer binding code
   */
  private generateTimerBindings(component: Component, indent: number): string {
    const indentStr = '    '.repeat(indent);
    let code = '';

    // Support new timers array format
    if (component.data?.timers && Array.isArray(component.data.timers)) {
      const enabledTimers = component.data.timers.filter((timer: any) => timer.enabled === true);
      
      if (enabledTimers.length > 0) {
        enabledTimers.forEach((timer: any) => {
          let callback: string;
          // Preset action mode: supports segments (multi-step animation) or actions (single-step animation)
          if (timer.mode === 'preset' && ((timer.segments && timer.segments.length > 0) || (timer.actions && timer.actions.length > 0))) {
            // Preset action mode: generate callback function name from timer ID
            callback = `${component.id}_${timer.id}_cb`;
          } else if (timer.mode === 'custom' && timer.callback) {
            // Custom function mode
            callback = timer.callback;
          } else {
            return; // Skip invalid configuration
          }
          
          const timerName = timer.name || timer.id;
          code += `${indentStr}// Bind timer: ${timerName}\n`;
          code += `${indentStr}gui_obj_create_timer((gui_obj_t *)${component.id}, ${timer.interval}, ${timer.reload !== false ? 'true' : 'false'}, ${callback});\n`;
          // If not set to run immediately, call gui_obj_start_timer
          if (!timer.runImmediately) {
            code += `${indentStr}gui_obj_start_timer((gui_obj_t *)${component.id});\n`;
          }
        });
      }
    }
    // Backward compatibility with legacy single-timer format
    else if (component.data?.timerEnabled === true) {
      const timerMode = component.data.timerMode || 'custom';
      let callback: string;
      
      if (timerMode === 'preset' && component.data.timerActions && component.data.timerActions.length > 0) {
        // Preset action mode: generate auto callback function name
        callback = `${component.id}_preset_timer_cb`;
      } else if (timerMode === 'custom' && component.data.timerCallback) {
        // Custom function mode
        callback = component.data.timerCallback;
      } else {
        return code; // Invalid configuration
      }
      
      code += `${indentStr}// Bind timer\n`;
      code += `${indentStr}gui_obj_create_timer((gui_obj_t *)${component.id}, ${component.data.timerInterval || 1000}, ${component.data.timerReload !== false ? 'true' : 'false'}, ${callback});\n`;
      code += `${indentStr}gui_obj_start_timer((gui_obj_t *)${component.id});\n`;
    }

    return code;
  }

  /**
   * Generate callback implementation file
   */
  private generateCallbackImplementation(baseName: string): string {
    let code = `#include "${baseName}_callbacks.h"
#include "../ui/${baseName}_ui.h"
#include <stdio.h>

// Event callback function implementations

`;

    // Generate standard callback function templates
    const callbackFunctions = this.collectCallbackFunctions();
    
    callbackFunctions.forEach(funcName => {
      code += `void ${funcName}(void *obj, gui_event_t *e)\n`;
      code += `{\n`;
      code += `    GUI_UNUSED(obj);\n`;
      code += `    GUI_UNUSED(e);\n`;
      code += `    // TODO: Implement event handling logic\n`;
      code += `    printf("${funcName} triggered\\n");\n`;
      code += `}\n\n`;
    });

    code += `/* @protected start custom_functions */
// Custom functions
/* @protected end custom_functions */
`;

    return code;
  }

  /**
   * Collect all callback function names to be generated
   */
  private collectCallbackFunctions(): string[] {
    const functions = new Set<string>();

    this.components.forEach(component => {
      const generator = EventGeneratorFactory.getGenerator(component.type);
      generator.collectCallbackFunctions(component).forEach(fn => functions.add(fn));
    });

    return Array.from(functions).sort();
  }

  /**
   * Generate split time label callback functions
   */
  private generateSplitTimeCallbacks(component: Component): string {
    const color = component.style?.color || '#ffffff';
    const rgb = this.colorToRgb(color);
    
    let code = `
// ${component.id} split time callback functions
static int8_t ${component.id}_breath_dir = -1;
static int16_t ${component.id}_current_alpha = 255;

static void ${component.id}_breath_anim_cb(void *p)
{
    gui_text_t *t_colon = (gui_text_t *)p;
    
    ${component.id}_current_alpha += (${component.id}_breath_dir * 15);

    if (${component.id}_current_alpha >= 255) {
        ${component.id}_current_alpha = 255;
        ${component.id}_breath_dir = -1;
    } else if (${component.id}_current_alpha <= 50) {
        ${component.id}_current_alpha = 50;
        ${component.id}_breath_dir = 1;
    }
    
    gui_color_t new_color = gui_rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, (uint8_t)${component.id}_current_alpha);
    gui_text_color_set(t_colon, new_color);
}

`;
    return code;
  }

  /**
   * Convert color string to RGB object
   */
  private colorToRgb(color: string): { r: number; g: number; b: number } {
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
    return { r: 255, g: 255, b: 255 };  // Default white
  }

  /**
   * Get buffer size for the given time format
   */
  private getTimeBufferSize(timeFormat?: string): number {
    switch (timeFormat) {
      case 'HH:mm:ss': return 10;
      case 'HH:mm': return 10;
      case 'HH': return 4;
      case 'mm': return 4;
      case 'HH:mm-split': return 10;  // Split time format, needs access to str+3, so requires enough space
      case 'YYYY-MM-DD': return 16;
      case 'YYYY-MM-DD HH:mm:ss': return 32;
      case 'MM-DD HH:mm': return 16;
      default: return 10;
    }
  }

  /**
   * Get buffer size for the given timer format
   */
  private getTimerBufferSize(timerFormat?: string): number {
    switch (timerFormat) {
      case 'HH:MM:SS': return 10;  // "HH:MM:SS\0" = 9 + 1
      case 'MM:SS': return 6;      // "MM:SS\0" = 5 + 1
      case 'MM:SS:MS': return 10;  // "MM:SS:MS\0" = 9 + 1
      case 'SS': return 4;         // "SS\0" = 2 + 1
      default: return 10;
    }
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
   * Get the correct handle type based on component type
   */
  private getComponentHandleType(comp: Component): string {
    // Check if scrolling is enabled (scrolling text uses gui_scroll_text_t)
    const enableScroll = comp.data?.enableScroll === true || comp.data?.enableScroll === 'true';
    
    switch (comp.type) {
      case 'hg_label':
        return enableScroll ? 'gui_scroll_text_t' : 'gui_text_t';
      case 'hg_time_label':
        return enableScroll ? 'gui_scroll_text_t' : 'gui_text_t';
      case 'hg_timer_label':
        return enableScroll ? 'gui_scroll_text_t' : 'gui_text_t';
      case 'hg_image':
        return 'gui_img_t';
      case 'hg_gif':
        return 'gui_gif_t';
      case 'hg_window':
        return 'gui_win_t';
      case 'hg_list':
        return 'gui_list_t';
      case 'hg_arc':
        return 'gui_arc_t';
      case 'hg_rect':
        return 'gui_rounded_rect_t';
      case 'hg_circle':
        return 'gui_circle_t';
      case 'hg_canvas':
        return 'gui_canvas_t';
      case 'hg_particle':
        return 'gui_particle_widget_t';
      case 'hg_menu_cellular':
        return 'gui_menu_cellular_t';
      case 'hg_qbcode':
        return 'gui_qbcode_t';
      case 'hg_video':
        return (comp.data?.useMsv1 === true || comp.data?.useMsv1 === 'true') ? 'gui_lite_video_t' : 'gui_video_t';
      case 'hg_streaming':
        return 'gui_stream_t';
      default:
        // Other unimplemented components use gui_obj_t
        return 'gui_obj_t';
    }
  }

}
