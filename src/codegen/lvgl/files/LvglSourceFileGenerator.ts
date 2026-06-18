/**
 * LVGL source file generator
 * Generates {designName}_lvgl_ui.c content
 *
 * Architecture: Each root view (hg_view with no parent) generates an independent
 * create_xxx() function. The main ui_create() function only calls the entry view's
 * create function. Non-entry views can be created on demand (e.g., during screen switching).
 */
import { Component } from '../../../hml/types';
import { LvglGeneratorContext } from '../LvglComponentGenerator';
import { LvglComponentGeneratorFactory } from '../components';
import { LvglEventGeneratorFactory } from '../events';
import { LvglResourceManager } from '../LvglResourceManager';
import { LvglAnimationGenerator } from '../LvglAnimationGenerator';

/** Information about a root view and its descendant components */
interface ViewGroup {
  /** The root view component */
  view: Component;
  /** All components belonging to this view (including the view itself), in creation order */
  components: Component[];
  /** Whether this is the entry view */
  isEntry: boolean;
}

export class LvglSourceFileGenerator {
  /** Per-component pre-generated animation code, keyed by component id. */
  private animCodeMap = new Map<string, string>();

  /**
   * Generate {designName}_lvgl_ui.c file content
   * @param designName Design name
   * @param orderedComponents Components ordered by creation sequence
   * @param ctx Generator context
   * @param imageVars Built-in image resource variable name list
   * @param fontVars Built-in font resource variable name list
   * @param getParentRef Function to get parent component reference
   * @param resourceManager Resource manager to check for external-bin images
   */
  generate(
    designName: string,
    orderedComponents: Component[],
    ctx: LvglGeneratorContext,
    imageVars: string[],
    fontVars: string[],
    getParentRef: (component: Component) => string,
    resourceManager?: LvglResourceManager,
    animGenerator: LvglAnimationGenerator = new LvglAnimationGenerator()
  ): string {
    let code = `/**\n`;
    code += ` * ${designName} LVGL UI implementation (auto-generated)\n`;
    code += ` * Generated at: ${new Date().toISOString()}\n`;
    code += ` */\n`;
    code += `#include "${designName}_lvgl_ui.h"\n`;
    code += `#include "${designName}_lvgl_callbacks.h"\n\n`;

    // Include lv_img_dsc_list.h if there are external-bin images
    // Note: ui_resource.h is included by lv_img_dsc_list.c, not here
    const hasExternalBin = resourceManager?.hasExternalBinImages() ?? false;
    if (hasExternalBin) {
      code += `#include "lv_img_dsc_list.h"\n\n`;
    }

    // Built-in image resource declarations (c-array only)
    if (imageVars.length > 0) {
      code += `// LVGL built-in image resource declarations\n`;
      imageVars.forEach(v => { code += `extern const lv_image_dsc_t ${v};\n`; });
      code += `\n`;
    }

    // Built-in font resource declarations
    if (fontVars.length > 0) {
      code += `// LVGL built-in font resource declarations\n`;
      fontVars.forEach(v => { code += `extern const lv_font_t ${v};\n`; });
      code += `\n`;
    }

    // Iterate all registered generators to produce global definitions
    for (const [, generator] of LvglComponentGeneratorFactory.getAllGenerators()) {
      if (generator.generateGlobalDefinitions) {
        code += generator.generateGlobalDefinitions(orderedComponents);
      }
    }

    // Pre-pass: translate each component's animations (data.timers) into lv_anim /
    // lv_timer code up front. This caches the per-component create-view code and lets
    // the animation generator collect wrapper exec_cb helpers, timeline/timer handles
    // and the discrete-action callbacks (queried later via the shared instance), so
    // every dependency is emitted before the view create functions that reference it.
    this.animCodeMap = new Map<string, string>();
    orderedComponents.forEach(c => {
      const animCode = animGenerator.generate(c, ctx);
      if (animCode) {
        this.animCodeMap.set(c.id, animCode);
      }
    });
    code += animGenerator.getHelperDefinitions();
    code += animGenerator.getTimelineDeclarations();
    code += animGenerator.getTimerHandleDeclarations();

    // Component handle definitions
    code += `// Component handle definitions\n`;
    orderedComponents.forEach(c => {
      code += `lv_obj_t * ${c.id} = NULL;\n`;
    });
    code += `\n`;

    // Controllable animation start/stop helpers (referenced by both create
    // functions and switchTimer callbacks), defined before the create functions.
    code += animGenerator.getStartHelperDefinitions();

    // Group components by root view
    const viewGroups = this.groupByRootView(orderedComponents, ctx);

    // Generate a create function for each root view
    for (const group of viewGroups) {
      code += this.generateViewCreateFunction(group, ctx, getParentRef);
    }

    // Generate orphan components (components not belonging to any root view)
    const orphans = this.getOrphanComponents(orderedComponents, viewGroups);

    // Main ui_create function
    code += `\nvoid ${designName}_lvgl_ui_create(void)\n`;
    code += `{\n`;

    // Create orphan components first (if any)
    if (orphans.length > 0) {
      code += `    // Standalone components\n`;
      for (const component of orphans) {
        code += this.generateComponentCode(component, ctx, getParentRef);
      }
    }

    // Call entry view's create function, then other views
    const entryGroups = viewGroups.filter(g => g.isEntry);
    const nonEntryGroups = viewGroups.filter(g => !g.isEntry);

    if (entryGroups.length > 0) {
      for (const group of entryGroups) {
        code += `    create_${group.view.id}();\n`;
      }
    }

    // Non-entry views: also create them so screen switching works
    if (nonEntryGroups.length > 0) {
      for (const group of nonEntryGroups) {
        code += `    create_${group.view.id}();\n`;
      }
    }

    code += `}\n`;
    return code;
  }

  /**
   * Group ordered components by their root view ancestor.
   * A root view is an hg_view whose parent is not in the component map (parentRef === 'parent').
   */
  private groupByRootView(orderedComponents: Component[], ctx: LvglGeneratorContext): ViewGroup[] {
    const componentMap = ctx.componentMap;
    const groups: ViewGroup[] = [];
    const assignedIds = new Set<string>();

    // Find all root views (hg_view with no valid parent)
    const rootViews = orderedComponents.filter(c =>
      c.type === 'hg_view' && (!c.parent || !componentMap.has(c.parent))
    );

    for (const rootView of rootViews) {
      const isEntry = rootView.data?.entry === true || rootView.data?.entry === 'true';
      const descendants = this.collectDescendants(rootView.id, orderedComponents, componentMap);
      const components = [rootView, ...descendants];

      components.forEach(c => assignedIds.add(c.id));

      groups.push({
        view: rootView,
        components,
        isEntry,
      });
    }

    return groups;
  }

  /**
   * Collect all descendant components of a given root, in the order they appear in orderedComponents.
   */
  private collectDescendants(
    rootId: string,
    orderedComponents: Component[],
    componentMap: Map<string, Component>
  ): Component[] {
    const descendants: Component[] = [];
    const belongsToRoot = new Set<string>([rootId]);

    for (const component of orderedComponents) {
      if (component.id === rootId) { continue; }
      const parentId = component.parent;
      if (parentId && belongsToRoot.has(parentId)) {
        belongsToRoot.add(component.id);
        descendants.push(component);
      }
    }

    return descendants;
  }

  /**
   * Get components that don't belong to any root view group.
   */
  private getOrphanComponents(orderedComponents: Component[], viewGroups: ViewGroup[]): Component[] {
    const assignedIds = new Set<string>();
    for (const group of viewGroups) {
      group.components.forEach(c => assignedIds.add(c.id));
    }
    return orderedComponents.filter(c => !assignedIds.has(c.id));
  }

  /**
   * Generate a create_xxx() function for a single root view and all its children.
   */
  private generateViewCreateFunction(
    group: ViewGroup,
    ctx: LvglGeneratorContext,
    getParentRef: (component: Component) => string
  ): string {
    const viewId = group.view.id;
    let code = `\n/**\n`;
    code += ` * Create ${viewId} screen and all its child components\n`;
    code += ` */\n`;
    code += `void create_${viewId}(void)\n`;
    code += `{\n`;

    for (const component of group.components) {
      code += this.generateComponentCode(component, ctx, getParentRef);
    }

    // Bind radio mutual exclusion event handler on parent containers within this view
    const radioComponents = group.components.filter(c => c.type === 'hg_radio');
    if (radioComponents.length > 0) {
      const parentIds = new Set<string>();
      for (const radio of radioComponents) {
        if (radio.parent && !parentIds.has(radio.parent)) {
          parentIds.add(radio.parent);
          code += `    // Radio group mutual exclusion for ${radio.parent}\n`;
          code += `    lv_obj_add_event_cb(${radio.parent}, radio_event_handler, LV_EVENT_CLICKED, &${radio.parent}_radio_active_index);\n\n`;
        }
      }
    }

    code += `}\n`;
    return code;
  }

  /**
   * Generate code for a single component (creation + flags + events).
   */
  private generateComponentCode(
    component: Component,
    ctx: LvglGeneratorContext,
    getParentRef: (component: Component) => string
  ): string {
    let code = '';
    const parentRef = getParentRef(component);
    const generator = LvglComponentGeneratorFactory.getGenerator(component.type);

    code += `    // ${component.id} (${component.type})\n`;
    code += generator.generateCreation(component, parentRef, ctx);

    if (component.visible === false) {
      code += `    lv_obj_add_flag(${component.id}, LV_OBJ_FLAG_HIDDEN);\n`;
    }
    if (component.enabled === false) {
      code += `    lv_obj_add_state(${component.id}, LV_STATE_DISABLED);\n`;
    }

    // Event bindings (unified via event generator)
    const eventGen = LvglEventGeneratorFactory.getGenerator(component.type);
    if (eventGen) {
      const bindings = eventGen.generateEventBindings(component);
      if (bindings) {
        code += bindings;
      }
    }

    // Animation bindings (lv_anim, pre-generated in the anim pre-pass). Placed after
    // creation/events so the component handle is ready, matching HoneyGUI's timer
    // binding timing inside the view create function.
    const animCode = this.animCodeMap.get(component.id);
    if (animCode) {
      code += animCode;
    }

    code += `\n`;
    return code;
  }
}
