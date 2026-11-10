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
 * 解析 `#RGB` / `#RGBA` / `#RRGGBB` / `#RRGGBBAA` 为 RGB 三元组。
 *
 * 以前 HoneyGUI 侧三处实现都只取前 6 位，三字符缩写（#F00）会得到 NaN，
 * LVGL 侧另有四份实现且行为不同。这里按 HML 规范支持全部长度，
 * 非 # 开头或无法识别的输入返回 undefined，由调用方决定默认值。
 */
export function parseHexRgb(color: string | undefined): { r: number; g: number; b: number; a: number } | undefined {
  if (!color || !color.startsWith('#')) {
    return undefined;
  }
  const hex = color.slice(1).trim();
  const expand = (ch: string) => parseInt(ch + ch, 16);
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return { r: expand(hex[0]), g: expand(hex[1]), b: expand(hex[2]), a: 255 };
  }
  if (/^[0-9a-fA-F]{4}$/.test(hex)) {
    return { r: expand(hex[0]), g: expand(hex[1]), b: expand(hex[2]), a: expand(hex[3]) };
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 255,
    };
  }
  if (/^[0-9a-fA-F]{8}$/.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: parseInt(hex.slice(6, 8), 16),
    };
  }
  return undefined;
}

/**
 * 将颜色值转换为 gui_rgb() C 代码格式
 * @param color 颜色值（如 "#FF0000" 或 "APP_COLOR_WHITE"）
 * @param defaultColor 未提供颜色时的默认值
 * @returns C 代码中的颜色调用字符串（如 "gui_rgb(255, 0, 0)"）
 */
export function convertColor(color?: string, defaultColor: string = 'APP_COLOR_WHITE'): string {
  if (!color) return defaultColor;

  const rgb = parseHexRgb(color);
  if (rgb) {
    return `gui_rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
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
  const rgb = parseHexRgb(color);
  if (rgb) {
    return `gui_rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
  }

  return `gui_rgba(255, 255, 255, ${opacity})`;
}

/**
 * 将颜色值转换为 gui_rgba() C 代码格式（梯度色专用，alpha=255）
 * @param color 颜色值
 * @returns C 代码中的颜色调用字符串
 */
export function convertColorToRgba(color: string): string {
  const rgb = parseHexRgb(color);
  if (rgb) {
    return `gui_rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 255)`;
  }

  return `gui_rgba(255, 255, 255, 255)`;
}
