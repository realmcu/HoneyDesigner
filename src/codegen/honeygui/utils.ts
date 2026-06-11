/**
 * Code generation utility functions
 */

import * as path from 'path';

/**
 * Calculate C code output directory from HML file path
 * Rule: ui/xxx/ -> src/
 * 
 * @param hmlFilePath Full path of the HML file
 * @param projectRoot Project root directory
 * @returns Output directory path (src/)
 */
export function getOutputDir(hmlFilePath: string, projectRoot: string): string {
  return path.join(projectRoot, 'src');
}

/**
 * Extract filename (without extension) from a file path
 * 
 * @param filePath File path
 * @returns Filename without extension
 * 
 * @example
 * getBaseName('/path/to/main.hml') // 'main'
 */
export function getBaseName(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

/**
 * Find project root directory
 * Traverse upward to find a directory containing package.json or .git
 * 
 * @param startPath Starting path
 * @returns Project root directory, or parent of startPath if not found
 */
export function findProjectRoot(startPath: string): string {
  let currentPath = startPath;

  while (currentPath !== path.dirname(currentPath)) {
    if (
      require('fs').existsSync(path.join(currentPath, 'package.json')) ||
      require('fs').existsSync(path.join(currentPath, '.git'))
    ) {
      return currentPath;
    }
    currentPath = path.dirname(currentPath);
  }

  return path.dirname(startPath);
}

/**
 * 将颜色值转换为 gui_rgb() C 代码格式
 * @param color 颜色值（如 "#FF0000" 或 "APP_COLOR_WHITE"）
 * @param defaultColor 未提供颜色时的默认值
 * @returns C 代码中的颜色调用字符串（如 "gui_rgb(255, 0, 0)"）
 */
export function convertColor(color?: string, defaultColor: string = 'APP_COLOR_WHITE'): string {
  if (!color) return defaultColor;

  if (color.startsWith('#')) {
    const hex = color.substring(1);
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `gui_rgb(${r}, ${g}, ${b})`;
  }

  return color;
}

/**
 * 将颜色值和透明度转换为 gui_rgba() C 代码格式
 * @param color 颜色值
 * @param opacity 透明度（0-255）
 * @returns C 代码中的颜色调用字符串
 */
export function convertColorWithOpacity(color: string | undefined, opacity: number): string {
  if (!color) {
    return `gui_rgba(255, 255, 255, ${opacity})`;
  }

  if (color.startsWith('#')) {
    const hex = color.substring(1);
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `gui_rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  return `gui_rgba(255, 255, 255, ${opacity})`;
}

/**
 * 将颜色值转换为 gui_rgba() C 代码格式（梯度色专用，alpha=255）
 * @param color 颜色值
 * @returns C 代码中的颜色调用字符串
 */
export function convertColorToRgba(color: string): string {
  if (color.startsWith('#')) {
    const hex = color.substring(1);
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `gui_rgba(${r}, ${g}, ${b}, 255)`;
  }

  return `gui_rgba(255, 255, 255, 255)`;
}
