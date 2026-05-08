/**
 * hg_openclaw component code generator
 *
 * API: gui_openclaw_create_from_mem
 * Dependency: lib/gui_openclaw (auto-copied to output directory during code generation)
 *
 * Usage:
 *   - Font File (.ttf) loaded via VFS filesystem
 *   - Emoji Font File (.ttf) loaded via VFS filesystem
 *   - Recommended emoji font: Noto Emoji (https://fonts.google.com/noto/specimen/Noto+Emoji)
 *   - Runtime uses gui_vfs_open / gui_vfs_read to read file content
 *   - Uses gui_lower_malloc to allocate buffer for font data
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';

export class OpenClawGenerator implements ComponentCodeGenerator {
  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width, height } = component.position;

    const fontFile = (component.data?.fontFile as string) || '';
    const emojiFontFile = (component.data?.emojiFontFile as string) || '';
    const senderId = (component.data?.senderId as string) || 'user1';

    // Generate VFS path (absolute path starting with /)
    const fontVfsPath = fontFile.startsWith('/') ? fontFile : `/${fontFile}`;
    const emojiFontVfsPath = emojiFontFile.startsWith('/') ? emojiFontFile : `/${emojiFontFile}`;

    // Generate unique variable names for each component
    const compIdSafe = component.id.replace(/[^a-zA-Z0-9_]/g, '_');

    let code = '';

    // Declare variables
    code += `${indentStr}// Load font files via VFS for ${component.id}\n`;
    code += `${indentStr}uint8_t *${compIdSafe}_ttf_addr = NULL;\n`;
    code += `${indentStr}size_t ${compIdSafe}_ttf_size = 0;\n`;
    code += `${indentStr}uint8_t *${compIdSafe}_emoji_ttf_addr = NULL;\n`;
    code += `${indentStr}size_t ${compIdSafe}_emoji_ttf_size = 0;\n`;

    // Load main font file into newly allocated buffer
    if (fontFile) {
      code += `${indentStr}{\n`;
      code += `${indentStr}    const char *src_path = "${fontVfsPath}";\n`;
      code += `${indentStr}    gui_vfs_file_t *f = gui_vfs_open(src_path, GUI_VFS_READ);\n`;
      code += `${indentStr}    if (f)\n`;
      code += `${indentStr}    {\n`;
      code += `${indentStr}        ${compIdSafe}_ttf_size = gui_vfs_seek(f, 0, GUI_VFS_SEEK_END);\n`;
      code += `${indentStr}        gui_vfs_seek(f, 0, GUI_VFS_SEEK_SET);\n`;
      code += `${indentStr}        ${compIdSafe}_ttf_addr = (uint8_t *)gui_lower_malloc(${compIdSafe}_ttf_size);\n`;
      code += `${indentStr}        if (${compIdSafe}_ttf_addr)\n`;
      code += `${indentStr}        {\n`;
      code += `${indentStr}            gui_vfs_read(f, ${compIdSafe}_ttf_addr, ${compIdSafe}_ttf_size);\n`;
      code += `${indentStr}        }\n`;
      code += `${indentStr}        gui_vfs_close(f);\n`;
      code += `${indentStr}    }\n`;
      code += `${indentStr}}\n`;
    }

    // Load emoji font file into newly allocated buffer
    if (emojiFontFile) {
      code += `${indentStr}{\n`;
      code += `${indentStr}    const char *emoji_path = "${emojiFontVfsPath}";\n`;
      code += `${indentStr}    gui_vfs_file_t *f = gui_vfs_open(emoji_path, GUI_VFS_READ);\n`;
      code += `${indentStr}    if (f)\n`;
      code += `${indentStr}    {\n`;
      code += `${indentStr}        ${compIdSafe}_emoji_ttf_size = gui_vfs_seek(f, 0, GUI_VFS_SEEK_END);\n`;
      code += `${indentStr}        gui_vfs_seek(f, 0, GUI_VFS_SEEK_SET);\n`;
      code += `${indentStr}        ${compIdSafe}_emoji_ttf_addr = (uint8_t *)gui_lower_malloc(${compIdSafe}_emoji_ttf_size);\n`;
      code += `${indentStr}        if (${compIdSafe}_emoji_ttf_addr)\n`;
      code += `${indentStr}        {\n`;
      code += `${indentStr}            gui_vfs_read(f, ${compIdSafe}_emoji_ttf_addr, ${compIdSafe}_emoji_ttf_size);\n`;
      code += `${indentStr}        }\n`;
      code += `${indentStr}        gui_vfs_close(f);\n`;
      code += `${indentStr}    }\n`;
      code += `${indentStr}}\n`;
    }

    // Create OpenClaw widget
    code += `${indentStr}${component.id} = gui_openclaw_create_from_mem(${parentRef}, "${component.name}",\n`;
    code += `${indentStr}    ${compIdSafe}_ttf_addr, ${compIdSafe}_ttf_size,\n`;
    code += `${indentStr}    ${compIdSafe}_emoji_ttf_addr, ${compIdSafe}_emoji_ttf_size,\n`;
    code += `${indentStr}    "${senderId}",\n`;
    code += `${indentStr}    ${x}, ${y}, ${width}, ${height});\n`;

    return code;
  }

  generatePropertySetters(component: Component, indent: number, _context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    let code = '';

    // Visibility
    if (component.visible === false) {
      code += `${indentStr}gui_obj_hidden((gui_obj_t *)${component.id}, true);\n`;
    }

    return code;
  }

  /**
   * Collect extra #include headers required by this component (called by HoneyGuiCCodeGenerator)
   * OpenClaw component requires VFS and openclaw headers
   */
  getExtraIncludes(_component: Component): string[] {
    return [
      '#include "gui_vfs.h"',
      '#include "gui_openclaw.h"'
    ];
  }
}
