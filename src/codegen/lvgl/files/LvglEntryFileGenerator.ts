/**
 * LVGL entry file generator
 * Generates lvgl_generated_ui.h and lvgl_generated_ui.c content
 *
 * Supports multi-design projects: calls all designs' UI create functions,
 * then explicitly loads the specified entry screen (similar to HoneyGUI's
 * EntryFileGenerator which uses entry="true" to determine the initial view).
 *
 * Supports external-bin deployment mode: generates resource_root loading logic
 * for Windows simulator to load romfs.bin at runtime.
 */

export class LvglEntryFileGenerator {
  /**
   * Generate lvgl_generated_ui.h file content
   */
  generateHeader(): string {
    let code = `/**\n`;
    code += ` * LVGL generated entry (auto-generated)\n`;
    code += ` * Generated at: ${new Date().toISOString()}\n`;
    code += ` */\n`;
    code += `#ifndef LVGL_GENERATED_UI_H\n`;
    code += `#define LVGL_GENERATED_UI_H\n\n`;
    code += `#include "lvgl.h"\n\n`;
    code += `#ifdef __cplusplus\n`;
    code += `extern "C" {\n`;
    code += `#endif\n\n`;
    code += `void lvgl_generated_ui_create(void);\n\n`;
    code += `#ifdef __cplusplus\n`;
    code += `}\n`;
    code += `#endif\n\n`;
    code += `#endif /* LVGL_GENERATED_UI_H */\n`;
    return code;
  }

  /**
   * Generate lvgl_generated_ui.c file content
   *
   * All designs' UI create functions are called to create all screens.
   * Then the specified entry view is explicitly loaded as the active screen.
   *
   * When hasExternalBin is true, generates resource_root loading logic for
   * Windows simulator to load romfs.bin at runtime.
   *
   * @param entryDesignName The current design name (used as fallback for single-design)
   * @param allDesignNames All design names in the project
   * @param entryViewId The entry view ID to load as the initial screen
   * @param hasExternalBin Whether the project uses external-bin deployment mode
   */
  generateSource(entryDesignName: string, allDesignNames?: string[], entryViewId?: string, hasExternalBin?: boolean): string {
    const designNames = allDesignNames || [entryDesignName];

    let code = `/**\n`;
    code += ` * LVGL generated entry implementation (auto-generated)\n`;
    code += ` * Generated at: ${new Date().toISOString()}\n`;
    code += ` */\n`;
    code += `#include "lvgl_generated_ui.h"\n`;

    // Include all design headers
    for (const name of designNames) {
      code += `#include "${name}_lvgl_ui.h"\n`;
    }

    // Include ui_resource.h and lv_img_dsc_list.h for external-bin mode
    if (hasExternalBin) {
      code += `#include "ui_resource.h"\n`;
      code += `#include "lv_img_dsc_list.h"\n`;
    }

    code += `\n`;

    // Generate resource_root loading logic for Windows simulator
    if (hasExternalBin) {
      code += this.generateResourceRootLoader();
    }

    code += `void lvgl_generated_ui_create(void)\n`;
    code += `{\n`;

    // Load resource_root and initialize image descriptors (simulator only)
    if (hasExternalBin) {
      code += `#if defined _HONEYGUI_SIMULATOR_\n`;
      code += `    load_ui_resource();\n`;
      code += `    lv_img_dsc_list_init();\n`;
      code += `#endif\n`;
      code += `\n`;
    }

    // Call all designs' UI create functions (creates all screens)
    for (const name of designNames) {
      code += `    ${name}_lvgl_ui_create();\n`;
    }

    // Explicitly load the entry screen (overrides any previous lv_screen_load calls)
    if (entryViewId) {
      code += `\n    /* Load the entry screen */\n`;
      code += `    lv_screen_load(${entryViewId});\n`;
    }

    code += `}\n`;
    return code;
  }

  /**
   * Generate resource_root loader for Windows simulator
   * This function loads romfs.bin into memory and sets up resource_root pointer
   */
  private generateResourceRootLoader(): string {
    let code = `#if defined _HONEYGUI_SIMULATOR_\n`;
    code += `#include <stdio.h>\n`;
    code += `#include <stdlib.h>\n`;
    code += `\n`;
    code += `/* Resource root pointer for Windows simulator */\n`;
    code += `unsigned char *resource_root = NULL;\n`;
    code += `\n`;
    code += `/**\n`;
    code += ` * Load romfs.bin into memory for Windows simulator\n`;
    code += ` * This allows external-bin images to be accessed via resource_root + offset\n`;
    code += ` */\n`;
    code += `static void load_ui_resource(void)\n`;
    code += `{\n`;
    code += `    if (resource_root != NULL) {\n`;
    code += `        return;  /* Already loaded */\n`;
    code += `    }\n`;
    code += `\n`;
    code += `    FILE *fp = fopen("romfs.bin", "rb");\n`;
    code += `    if (!fp) {\n`;
    code += `        fprintf(stderr, "Error: Cannot open romfs.bin\\n");\n`;
    code += `        return;\n`;
    code += `    }\n`;
    code += `\n`;
    code += `    /* Get file size */\n`;
    code += `    fseek(fp, 0, SEEK_END);\n`;
    code += `    long size = ftell(fp);\n`;
    code += `    fseek(fp, 0, SEEK_SET);\n`;
    code += `\n`;
    code += `    /* Allocate memory and read file */\n`;
    code += `    resource_root = (unsigned char *)malloc(size);\n`;
    code += `    if (!resource_root) {\n`;
    code += `        fprintf(stderr, "Error: Cannot allocate memory for romfs.bin\\n");\n`;
    code += `        fclose(fp);\n`;
    code += `        return;\n`;
    code += `    }\n`;
    code += `\n`;
    code += `    if (fread(resource_root, 1, size, fp) != (size_t)size) {\n`;
    code += `        fprintf(stderr, "Error: Failed to read romfs.bin\\n");\n`;
    code += `        free(resource_root);\n`;
    code += `        resource_root = NULL;\n`;
    code += `        fclose(fp);\n`;
    code += `        return;\n`;
    code += `    }\n`;
    code += `\n`;
    code += `    fclose(fp);\n`;
    code += `    printf("Loaded romfs.bin (%ld bytes) into resource_root\\n", size);\n`;
    code += `}\n`;
    code += `#endif /* _HONEYGUI_SIMULATOR_ */\n`;
    code += `\n`;

    return code;
  }
}
