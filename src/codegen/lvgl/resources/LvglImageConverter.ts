/**
 * LVGL image resource converter
 * Converts project images to LVGL built-in C array format
 *
 * Incremental conversion: only converts images that are new or whose source
 * file has been modified since the last conversion. Removes orphaned outputs.
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { Component } from '../../../hml/types';
import { normalizeImageKey, buildImageVarName } from '../LvglUtils';

export class LvglImageConverter {
  private builtinImageVarMap: Map<string, string> = new Map();
  private builtinImageVars: string[] = [];

  /** Get built-in image variable name */
  getBuiltinImageVar(source: string): string | undefined {
    return this.builtinImageVarMap.get(normalizeImageKey(source));
  }

  /** Get list of all built-in image variable names */
  getBuiltinImageVarList(): string[] {
    return this.builtinImageVars;
  }

  /**
   * Prepare built-in image resources (incremental).
   * - Skips images whose output .c already exists and is newer than the source file.
   * - Removes orphaned img_*.c files that are no longer referenced.
   */
  prepare(components: Component[], srcDir: string, lvglDir: string): void {
    this.builtinImageVarMap.clear();
    this.builtinImageVars = [];

    const toolPath = this.findLvglImageTool();
    if (!toolPath) {
      console.warn('LVGL image conversion tool not found, skipping built-in image conversion');
      return;
    }

    const projectRoot = path.dirname(srcDir);
    const assetsDir = path.join(projectRoot, 'assets');
    if (!fs.existsSync(assetsDir)) {
      return;
    }

    const images = this.collectImageSources(components);

    // Build the set of varNames that are currently needed
    const neededVarNames = new Set<string>();
    for (const imgSrc of images) {
      neededVarNames.add(buildImageVarName(imgSrc));
    }

    // Remove orphaned img_*.c files (no longer referenced by any component)
    this.cleanupOrphanedImages(lvglDir, neededVarNames);

    if (images.length === 0) {
      return;
    }

    for (const imgSrc of images) {
      const inputPath = this.resolveImagePath(projectRoot, imgSrc);
      if (!inputPath) {
        console.warn(`Image file not found, skipping: ${imgSrc}`);
        continue;
      }

      const varName = buildImageVarName(imgSrc);
      const outputFile = path.join(lvglDir, `${varName}.c`);

      // Incremental check: skip if output exists and is newer than source
      if (this.isUpToDate(inputPath, outputFile)) {
        // Already converted and up-to-date, just register the mapping
        const key = normalizeImageKey(imgSrc);
        this.builtinImageVarMap.set(key, varName);
        this.builtinImageVars.push(varName);
        continue;
      }

      const success = this.convertImageToLvgl(toolPath, inputPath, lvglDir, varName);
      if (success) {
        const key = normalizeImageKey(imgSrc);
        this.builtinImageVarMap.set(key, varName);
        this.builtinImageVars.push(varName);
      }
    }
  }

  /**
   * Check if the output file is up-to-date relative to the source file.
   * Returns true if output exists and its mtime >= source mtime.
   */
  private isUpToDate(sourcePath: string, outputPath: string): boolean {
    try {
      if (!fs.existsSync(outputPath)) {
        return false;
      }
      const srcStat = fs.statSync(sourcePath);
      const outStat = fs.statSync(outputPath);
      return outStat.mtimeMs >= srcStat.mtimeMs;
    } catch {
      return false;
    }
  }

  /**
   * Collect all image sources used by components
   */
  private collectImageSources(components: Component[]): string[] {
    const imageExts = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.webp']);
    // GIF files are excluded: they require runtime decoding (lv_gif) and should not be converted to C arrays
    const seen = new Set<string>();
    const result: string[] = [];

    const addImage = (src: string | undefined | null) => {
      if (!src) { return; }
      const srcText = String(src).trim();
      if (!srcText) { return; }
      const ext = path.extname(srcText).toLowerCase();
      if (!imageExts.has(ext)) { return; }
      const key = normalizeImageKey(srcText);
      if (seen.has(key)) { return; }
      seen.add(key);
      result.push(srcText);
    };

    for (const component of components) {
      if (component.type === 'hg_image') {
        addImage(component.data?.src);
      } else if (component.type === 'hg_button') {
        addImage(component.data?.imageOn);
        addImage(component.data?.imageOff);
      }
    }

    return result;
  }

  /**
   * Find LVGLImage.py conversion tool
   */
  private findLvglImageTool(): string | null {
    const candidates = [
      process.env.HONEYGUI_LVGL_IMAGE_TOOL,
      path.resolve(__dirname, '../../../../../lvgl-pc/lvgl-official-tools/scripts/LVGLImage.py'),
      path.join(process.cwd(), 'lvgl-pc', 'lvgl-official-tools', 'scripts', 'LVGLImage.py'),
    ].filter((c): c is string => !!c);

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * Resolve absolute path for an image
   */
  private resolveImagePath(projectRoot: string, source: string): string | null {
    let normalized = source.replace(/\\/g, '/').trim();
    normalized = normalized.replace(/^A:/i, '').replace(/^\/+/, '');

    const relativePath = normalized.startsWith('assets/')
      ? normalized.substring('assets/'.length)
      : normalized;

    const fullPath = path.join(projectRoot, 'assets', relativePath);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }

    const altPath = path.join(projectRoot, normalized);
    if (fs.existsSync(altPath)) {
      return altPath;
    }

    return null;
  }

  /**
   * Convert image to LVGL C array using LVGLImage.py
   */
  private convertImageToLvgl(
    toolPath: string,
    inputPath: string,
    outputDir: string,
    varName: string
  ): boolean {
    const ext = path.extname(inputPath).toLowerCase();

    let actualInputPath = inputPath;
    let tempPngPath: string | null = null;
    let colorFormat = 'ARGB8888';

    if (ext !== '.png') {
      tempPngPath = path.join(outputDir, `_temp_${varName}.png`);
      const convertSuccess = this.convertToPng(inputPath, tempPngPath);
      if (!convertSuccess) {
        console.warn(`Image format conversion failed: ${inputPath}`);
        return false;
      }
      actualInputPath = tempPngPath;
      colorFormat = 'RGB565';
    }

    const baseArgs = [toolPath, '--ofmt', 'C', '--cf', colorFormat, '-o', outputDir, '--name', varName, actualInputPath];

    const pythonCommands = ['python', 'python3', 'py'];
    let success = false;

    for (const pyCmd of pythonCommands) {
      const args = pyCmd === 'py' ? ['-3', ...baseArgs] : baseArgs;
      const result = spawnSync(pyCmd, args, { encoding: 'utf-8', windowsHide: true });

      if (result.status === 0) {
        const outputFile = path.join(outputDir, `${varName}.c`);
        if (fs.existsSync(outputFile)) {
          success = true;
          break;
        }
      }
    }

    if (tempPngPath && fs.existsSync(tempPngPath)) {
      try { fs.unlinkSync(tempPngPath); } catch { /* ignore */ }
    }

    if (!success) {
      console.warn(`Image conversion failed: ${inputPath}`);
    }
    return success;
  }

  /**
   * Convert image to PNG format using Pillow
   */
  private convertToPng(inputPath: string, outputPath: string): boolean {
    const script = `from PIL import Image; img = Image.open(r'${inputPath.replace(/'/g, "\\'")}'); img.convert('RGBA').save(r'${outputPath.replace(/'/g, "\\'")}', 'PNG')`;

    const pythonCommands = ['python', 'python3', 'py'];

    for (const pyCmd of pythonCommands) {
      const args = pyCmd === 'py' ? ['-3', '-c', script] : ['-c', script];
      const result = spawnSync(pyCmd, args, { encoding: 'utf-8', windowsHide: true });

      if (result.status === 0 && fs.existsSync(outputPath)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Remove orphaned img_*.c files that are no longer needed.
   * Only deletes files whose varName is NOT in the neededVarNames set.
   */
  private cleanupOrphanedImages(lvglDir: string, neededVarNames: Set<string>): void {
    if (!fs.existsSync(lvglDir)) {
      return;
    }
    const prefix = 'img_';
    const files = fs.readdirSync(lvglDir);
    for (const file of files) {
      if (file.startsWith(prefix) && file.endsWith('.c')) {
        const varName = file.replace(/\.c$/, '');
        if (!neededVarNames.has(varName)) {
          console.log(`[LvglImageConverter] Removing orphaned image: ${file}`);
          fs.unlinkSync(path.join(lvglDir, file));
        }
      }
    }
  }
}
