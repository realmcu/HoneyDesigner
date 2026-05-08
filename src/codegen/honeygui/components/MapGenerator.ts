/**
 * hg_map component code generator
 *
 * API: gui_vector_map_create_from_mem
 * Dependency: lib/gui_vector_map (auto-copied to output directory during code generation)
 *
 * Usage:
 *   - Map File (.bin) / Font File (.ttf) loaded via VFS filesystem
 *   - Runtime uses gui_lower_malloc to allocate memory, then gui_vfs_read to read file content
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';

/**
 * Convert file path to C variable name suffix
 * e.g.: "assets/map.bin" -> "map_bin"
 *       "NotoSansSC-Medium.ttf" -> "notosanssc_medium_ttf"
 */
function filePathToVarSuffix(filePath: string): string {
  const basename = filePath.split('/').pop() || filePath;
  return basename.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
}

export class MapGenerator implements ComponentCodeGenerator {
  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width, height } = component.position;

    const mapFile  = (component.data?.mapFile  as string) || '';
    const fontFile = (component.data?.fontFile as string) || '';
    const pcSerialName = (component.data?.pcSerialName as string) || '';

    // Generate VFS path (absolute path starting with /)
    const mapVfsPath = mapFile.startsWith('/') ? mapFile : `/${mapFile}`;
    const fontVfsPath = fontFile.startsWith('/') ? fontFile : `/${fontFile}`;

    // Generate unique variable names for each component
    const mapVarSuffix = filePathToVarSuffix(mapFile) || 'map';
    const fontVarSuffix = filePathToVarSuffix(fontFile) || 'font';
    const compIdSafe = component.id.replace(/[^a-zA-Z0-9_]/g, '_');

    let code = '';

    // Declare variables
    code += `${indentStr}// Load map and font files via VFS for ${component.id}\n`;
    code += `${indentStr}uint8_t *${compIdSafe}_map_addr = NULL;\n`;
    code += `${indentStr}size_t ${compIdSafe}_map_size = 0;\n`;
    code += `${indentStr}uint8_t *${compIdSafe}_ttf_addr = NULL;\n`;
    code += `${indentStr}size_t ${compIdSafe}_ttf_size = 0;\n`;

    // Load map file
    if (mapFile) {
      code += `${indentStr}{\n`;
      code += `${indentStr}    const char *src_path = "${mapVfsPath}";\n`;
      code += `${indentStr}    gui_vfs_file_t *f = gui_vfs_open(src_path, GUI_VFS_READ);\n`;
      code += `${indentStr}    if (f)\n`;
      code += `${indentStr}    {\n`;
      code += `${indentStr}        ${compIdSafe}_map_size = gui_vfs_seek(f, 0, GUI_VFS_SEEK_END);\n`;
      code += `${indentStr}        gui_vfs_seek(f, 0, GUI_VFS_SEEK_SET);\n`;
      code += `${indentStr}        ${compIdSafe}_map_addr = (uint8_t *)gui_lower_malloc(${compIdSafe}_map_size);\n`;
      code += `${indentStr}        if (${compIdSafe}_map_addr)\n`;
      code += `${indentStr}        {\n`;
      code += `${indentStr}            gui_vfs_read(f, ${compIdSafe}_map_addr, ${compIdSafe}_map_size);\n`;
      code += `${indentStr}        }\n`;
      code += `${indentStr}        gui_vfs_close(f);\n`;
      code += `${indentStr}    }\n`;
      code += `${indentStr}}\n`;
    }

    // Load font file
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

    // Create map widget
    code += `${indentStr}${component.id} = gui_vector_map_create_from_mem(${parentRef}, "${component.name}",\n`;
    code += `${indentStr}    ${compIdSafe}_map_addr, ${compIdSafe}_map_size,\n`;
    code += `${indentStr}    ${compIdSafe}_ttf_addr, ${compIdSafe}_ttf_size,\n`;
    code += `${indentStr}    "${pcSerialName}",\n`;
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
   * Map component requires VFS and vector_map headers
   */
  getExtraIncludes(_component: Component): string[] {
    return [
      '#include "gui_vfs.h"',
      '#include "gui_vector_map.h"'
    ];
  }
}
