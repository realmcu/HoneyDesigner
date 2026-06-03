/**
 * LVGL font resource converter
 * Converts project TTF fonts to LVGL C format
 *
 * Incremental conversion: maintains a manifest file to track the configuration
 * (font file, size, character set hash) used for each conversion. Only reconverts
 * when the configuration changes or the source font file is modified.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';
import { Component } from '../../../hml/types';
import { normalizeFontKey, normalizeFontBaseKey, buildFontVarName } from '../LvglUtils';

interface CharacterSetSource {
  type: 'range' | 'string' | 'file' | 'codepage';
  value: string;
}

/** Manifest entry for a single converted font */
interface FontManifestEntry {
  varName: string;
  fontFile: string;
  fontSize: number;
  /** Bits per pixel (render mode): 1, 2, 4, or 8 */
  bpp: number;
  /** Bit order for glyph bitmap: MSB (default) or LSB */
  pixelOrder: 'MSB' | 'LSB';
  /** SHA-256 hash of the sorted character set string */
  charsHash: string;
  /** mtime of the source font file at conversion time */
  fontMtimeMs: number;
}

/** Manifest file structure */
interface FontManifest {
  version: 1;
  entries: Record<string, FontManifestEntry>; // keyed by normalizeFontKey
}

export class LvglFontConverter {
  private builtinFontVarMap: Map<string, string> = new Map();
  private builtinFontVars: string[] = [];

  /** Get converted font variable name */
  getBuiltinFontVar(fontFile: string, fontSize: number, bpp: number = 4, pixelOrder: 'MSB' | 'LSB' = 'LSB'): string | null {
    const key = normalizeFontKey(fontFile, fontSize, bpp, pixelOrder);
    return this.builtinFontVarMap.get(key) || null;
  }

  /** Get list of all built-in font variable names */
  getBuiltinFontVarList(): string[] {
    return this.builtinFontVars;
  }

  /**
   * Prepare built-in font resources (incremental).
   * - Loads a manifest from the previous run.
   * - Skips fonts whose config (file mtime + character set hash) hasn't changed.
   * - Removes orphaned font_*.c files no longer referenced.
   * - Saves an updated manifest after conversion.
   */
  prepare(components: Component[], srcDir: string, lvglDir: string): void {
    this.builtinFontVarMap.clear();
    this.builtinFontVars = [];

    const projectRoot = path.dirname(srcDir);
    const assetsDir = path.join(projectRoot, 'assets');

    const fontConfigs = this.collectFontConfigs(components, projectRoot);

    const fontOutputDir = path.join(lvglDir, 'fonts');
    if (!fs.existsSync(fontOutputDir)) {
      fs.mkdirSync(fontOutputDir, { recursive: true });
    }

    const manifestPath = path.join(fontOutputDir, '.font_manifest.json');
    const oldManifest = this.loadManifest(manifestPath);
    const newManifest: FontManifest = { version: 1, entries: {} };

    // Build the set of varNames that are currently needed
    const neededVarNames = new Set<string>();
    for (const config of fontConfigs) {
      neededVarNames.add(buildFontVarName(config.fontFile, config.fontSize, config.bpp, config.pixelOrder));
    }

    // Remove orphaned font_*.c files
    this.cleanupOrphanedFonts(fontOutputDir, neededVarNames);

    if (fontConfigs.length === 0) {
      this.saveManifest(manifestPath, newManifest);
      return;
    }

    for (const config of fontConfigs) {
      const inputPath = this.resolveFontPath(projectRoot, assetsDir, config.fontFile);
      if (!inputPath) {
        console.warn(`Font file not found, skipping: ${config.fontFile}`);
        continue;
      }

      const varName = buildFontVarName(config.fontFile, config.fontSize, config.bpp, config.pixelOrder);
      const key = normalizeFontKey(config.fontFile, config.fontSize, config.bpp, config.pixelOrder);
      const charsHash = this.hashString(config.characters);
      const fontMtimeMs = this.getFileMtime(inputPath);
      const outputFile = path.join(fontOutputDir, `${varName}.c`);

      // Incremental check: skip if output exists and config hasn't changed
      const oldEntry = oldManifest.entries[key];
      if (oldEntry
        && oldEntry.varName === varName
        && oldEntry.charsHash === charsHash
        && oldEntry.fontMtimeMs === fontMtimeMs
        && oldEntry.bpp === config.bpp
        && oldEntry.pixelOrder === config.pixelOrder
        && fs.existsSync(outputFile)) {
        // Up-to-date, just register the mapping
        this.builtinFontVarMap.set(key, varName);
        this.builtinFontVars.push(varName);
        newManifest.entries[key] = oldEntry;
        console.log(`[LvglFontConverter] Skipping (up-to-date): ${varName}`);
        continue;
      }

      console.log(`[LvglFontConverter] Converting font: ${config.fontFile}, size: ${config.fontSize}, bpp: ${config.bpp}, pixelOrder: ${config.pixelOrder}, chars(${config.characters.length}): "${config.characters.substring(0, 80)}${config.characters.length > 80 ? '...' : ''}"`);
      // Note: --extract-glyph-bitmap is temporarily disabled because the generated .c file
      // uses #warning to prompt for FONT_xxx_GLYPH_BITMAP_BIN macro, but doesn't include
      // ui_resource.h where the macro is defined. This causes compilation warnings.
      // TODO: Re-enable after fixing lv_font_conv to add #include "ui_resource.h"
      //
      // Note: --pixel-order LSB requires --no-compress (enforced by lv_font_conv cli.js).
      // --stride 1 is required for LSB only: the RTK draw unit checks `fdsc->stride`
      // (lv_draw_rtk.c rtk_evaluate) and falls back to SW renderer without it, which
      // assumes MSB and produces misaligned glyphs. MSB fonts work without stride.
      const extendedOpts = config.pixelOrder === 'MSB'
        ? { pixelOrder: 'MSB' as const, noCompress: true }
        : { pixelOrder: 'LSB' as const, noCompress: true, stride: 1 };
      const success = this.convertFontToLvgl(inputPath, fontOutputDir, varName, config.fontSize, config.bpp, config.characters, srcDir, extendedOpts);
      if (success) {
        this.builtinFontVarMap.set(key, varName);
        this.builtinFontVars.push(varName);
        newManifest.entries[key] = { varName, fontFile: config.fontFile, fontSize: config.fontSize, bpp: config.bpp, pixelOrder: config.pixelOrder, charsHash, fontMtimeMs };
      }
    }

    this.saveManifest(manifestPath, newManifest);
  }

  /** Compute SHA-256 hash of a string */
  private hashString(s: string): string {
    return crypto.createHash('sha256').update(s, 'utf-8').digest('hex');
  }

  /** Get file mtime in milliseconds, or 0 if not found */
  private getFileMtime(filePath: string): number {
    try {
      return fs.statSync(filePath).mtimeMs;
    } catch {
      return 0;
    }
  }

  /** Load manifest from disk */
  private loadManifest(manifestPath: string): FontManifest {
    try {
      if (fs.existsSync(manifestPath)) {
        const data = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        if (data && data.version === 1 && data.entries) {
          return data as FontManifest;
        }
      }
    } catch {
      // Corrupted manifest, start fresh
    }
    return { version: 1, entries: {} };
  }

  /** Save manifest to disk */
  private saveManifest(manifestPath: string, manifest: FontManifest): void {
    try {
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    } catch (e) {
      console.warn(`[LvglFontConverter] Failed to save manifest: ${e}`);
    }
  }

  /**
   * Remove orphaned font_*.c files that are no longer needed.
   */
  private cleanupOrphanedFonts(fontOutputDir: string, neededVarNames: Set<string>): void {
    if (!fs.existsSync(fontOutputDir)) {
      return;
    }
    const files = fs.readdirSync(fontOutputDir);
    for (const file of files) {
      if (file.startsWith('font_') && file.endsWith('.c')) {
        const varName = file.replace(/\.c$/, '');
        if (!neededVarNames.has(varName)) {
          console.log(`[LvglFontConverter] Removing orphaned font: ${file}`);
          fs.unlinkSync(path.join(fontOutputDir, file));
        }
      }
    }
  }

  /**
   * Collect font configurations used by all text-bearing components
   * (hg_label, hg_time_label, hg_timer_label, hg_checkbox, hg_radio)
   * Includes text characters + additional character sets (range, string, file, codepage)
   * Groups by (fontFile, fontSize, bpp, pixelOrder) to avoid overwriting.
   * Warns if the same font has conflicting pixelOrder settings.
   */
  private collectFontConfigs(components: Component[], projectRoot: string): Array<{ fontFile: string; fontSize: number; bpp: number; characters: string; pixelOrder: 'MSB' | 'LSB' }> {
    const fontExts = new Set(['.ttf', '.otf', '.woff', '.woff2']);
    /** Component types that support custom fonts */
    const fontComponentTypes = new Set(['hg_label', 'hg_time_label', 'hg_timer_label', 'hg_checkbox', 'hg_radio']);
    // Key: (fontFile, fontSize, bpp), Value: config with pixelOrder tracking
    const seen = new Map<string, {
      fontFile: string;
      fontSize: number;
      bpp: number;
      pixelOrder: 'MSB' | 'LSB';
      characters: Set<string>;
      additionalCharSets: Set<string>; // JSON-serialized for dedup
    }>();
    // Track pixelOrder conflicts: key -> first seen pixelOrder
    const pixelOrderConflictMap = new Map<string, 'MSB' | 'LSB'>();

    for (const component of components) {
      if (!fontComponentTypes.has(component.type)) {
        continue;
      }

      const fontFile = component.data?.fontFile;
      if (!fontFile) {
        continue;
      }

      const fontFileStr = String(fontFile).trim();
      const ext = path.extname(fontFileStr).toLowerCase();
      if (!fontExts.has(ext)) {
        continue;
      }

      const fontSize = Number(component.style?.fontSize || component.data?.fontSize || 16);
      const bpp = this.parseRenderMode((component.data as any)?.renderMode);
      const pixelOrder = (component.data as any)?.pixelOrder === 'MSB' ? 'MSB' as const : 'LSB' as const;
      // checkbox/radio may store text in 'text' or 'label' field
      const text = String(component.data?.text || component.data?.label || '');
      // Key WITHOUT pixelOrder for conflict detection
      const baseKey = normalizeFontBaseKey(fontFileStr, fontSize, bpp);
      // Key WITH pixelOrder for actual dedup
      const fullKey = normalizeFontKey(fontFileStr, fontSize, bpp, pixelOrder);

      // Check for pixelOrder conflict
      const firstPixelOrder = pixelOrderConflictMap.get(baseKey);
      if (firstPixelOrder === undefined) {
        pixelOrderConflictMap.set(baseKey, pixelOrder);
      } else if (firstPixelOrder !== pixelOrder) {
        console.warn(`[LvglFontConverter] Font "${fontFileStr}" size ${fontSize} bpp ${bpp}: conflicting pixelOrder (${firstPixelOrder} vs ${pixelOrder}). Both variants will be generated.`);
      }

      if (seen.has(fullKey)) {
        const existing = seen.get(fullKey)!;
        for (const char of text) {
          existing.characters.add(char);
        }
        // Merge additional character sets
        const charSets = (component.data as any)?.characterSets;
        if (Array.isArray(charSets)) {
          for (const cs of charSets) {
            existing.additionalCharSets.add(JSON.stringify(cs));
          }
        }
      } else {
        const additionalCharSets = new Set<string>();
        const charSets = (component.data as any)?.characterSets;
        if (Array.isArray(charSets)) {
          for (const cs of charSets) {
            additionalCharSets.add(JSON.stringify(cs));
          }
        }
        seen.set(fullKey, {
          fontFile: fontFileStr,
          fontSize,
          bpp,
          pixelOrder,
          characters: new Set(text),
          additionalCharSets
        });
      }
    }

    return Array.from(seen.values()).map(config => {
      // Resolve additional character sets into code points
      const extraChars = this.resolveAdditionalCharSets(
        Array.from(config.additionalCharSets).map(s => JSON.parse(s)),
        projectRoot
      );
      // Merge text characters + additional characters
      const allChars = new Set<string>(config.characters);
      for (const cp of extraChars) {
        allChars.add(String.fromCodePoint(cp));
      }
      return {
        fontFile: config.fontFile,
        fontSize: config.fontSize,
        bpp: config.bpp,
        characters: this.buildCharacterSet(allChars),
        pixelOrder: config.pixelOrder
      };
    });
  }

  /**
   * Parse renderMode from component data to a valid bpp value (1, 2, 4, or 8).
   * Defaults to 4 if not specified or invalid.
   */
  private parseRenderMode(renderMode: any): number {
    const value = Number(renderMode);
    if ([1, 2, 4, 8].includes(value)) {
      return value;
    }
    return 4; // default bpp
  }

  /**
   * Resolve additional character set sources into code points
   */
  private resolveAdditionalCharSets(charSets: CharacterSetSource[], projectRoot: string): number[] {
    const result = new Set<number>();

    for (const cs of charSets) {
      if (!cs.value) {
        continue;
      }

      try {
        switch (cs.type) {
          case 'range': {
            // Parse "0xXXXX-0xYYYY" format
            const match = cs.value.trim().match(/^(0x)?([0-9a-fA-F]+)\s*-\s*(0x)?([0-9a-fA-F]+)$/);
            if (match) {
              const start = parseInt(match[2], 16);
              const end = parseInt(match[4], 16);
              if (!isNaN(start) && !isNaN(end) && start <= end) {
                for (let i = start; i <= end; i++) {
                  result.add(i);
                }
              }
            }
            break;
          }
          case 'string': {
            // Extract characters from string
            for (const char of cs.value) {
              const cp = char.codePointAt(0);
              if (cp !== undefined) {
                result.add(cp);
              }
            }
            break;
          }
          case 'file': {
            // Read .cst binary file (uint16_t little-endian)
            const filePath = path.isAbsolute(cs.value)
              ? cs.value
              : path.resolve(projectRoot, cs.value);
            if (fs.existsSync(filePath)) {
              const data = fs.readFileSync(filePath);
              if (data.length % 2 === 0) {
                for (let i = 0; i < data.length / 2; i++) {
                  result.add(data.readUInt16LE(i * 2));
                }
              }
            } else {
              console.warn(`Character set file not found: ${filePath}`);
            }
            break;
          }
          case 'codepage': {
            // CodePage files - try to find and parse
            const cpPath = path.isAbsolute(cs.value)
              ? cs.value
              : path.resolve(projectRoot, cs.value);
            if (fs.existsSync(cpPath)) {
              const data = fs.readFileSync(cpPath);
              if (data.length % 2 === 0) {
                for (let i = 0; i < data.length / 2; i++) {
                  result.add(data.readUInt16LE(i * 2));
                }
              }
            } else {
              console.warn(`CodePage file not found: ${cpPath}`);
            }
            break;
          }
        }
      } catch (error) {
        console.warn(`Failed to resolve character set (${cs.type}: ${cs.value}): ${error}`);
      }
    }

    return Array.from(result);
  }

  /**
   * Build character set: only include user-used characters + space
   * Space (0x20) is always included as it's essential for text rendering and costs minimal ROM.
   */
  private buildCharacterSet(userChars: Set<string>): string {
    const chars = new Set<string>(userChars);
    chars.add(' '); // always include space
    return Array.from(chars).sort().join('');
  }

  /**
   * Resolve absolute path for a font file
   */
  private resolveFontPath(projectRoot: string, assetsDir: string, fontFile: string): string | null {
    let normalized = fontFile.replace(/\\/g, '/').trim();
    normalized = normalized.replace(/^A:/i, '').replace(/^\/+/, '');

    const candidates = [
      path.join(assetsDir, normalized),
      path.join(assetsDir, 'font', path.basename(normalized)),
      path.join(projectRoot, normalized),
      path.join(projectRoot, 'assets', normalized),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Find the local lv_font_conv tool script.
   * Looks in tools/lv-font-conv/ relative to the project root.
   */
  private findFontConvTool(): string | null {
    const candidates = [
      // Relative to the compiled extension (out/src/codegen/lvgl/resources/ -> project root)
      path.resolve(__dirname, '../../../../../tools/lv-font-conv/lv_font_conv.js'),
      // Absolute workspace root
      path.join(process.cwd(), 'tools', 'lv-font-conv', 'lv_font_conv.js'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * Convert font to LVGL C format using local lv_font_conv (forked version with pixel-order + extract-glyph-bitmap)
   */
  private convertFontToLvgl(
    inputPath: string,
    outputDir: string,
    varName: string,
    fontSize: number,
    bpp: number,
    characters: string,
    srcDir: string,
    options?: { pixelOrder?: 'MSB' | 'LSB'; extractGlyphBitmap?: boolean; noCompress?: boolean; stride?: number }
  ): boolean {
    const toolPath = this.findFontConvTool();
    if (!toolPath) {
      console.warn('[LvglFontConverter] Local lv_font_conv tool not found, skipping font conversion');
      return false;
    }

    try {
      const outputFile = path.join(outputDir, `${varName}.c`);

      const codePoints = Array.from(new Set(characters))
        .map(ch => ch.codePointAt(0)!)
        .filter(cp => cp !== undefined)
        .sort((a, b) => a - b);

      const ranges = this.compactRanges(codePoints);

      const args = [
        toolPath,
        '--font', inputPath,
        '--size', String(fontSize),
        '--format', 'lvgl',
        '--output', outputFile,
        '--bpp', String(bpp),
      ];

      for (const range of ranges) {
        args.push('--range', range);
      }

      // Extended options (fork-specific)
      if (options?.pixelOrder) {
        args.push('--pixel-order', options.pixelOrder);
      }
      if (options?.noCompress) {
        args.push('--no-compress');
      }
      if (options?.extractGlyphBitmap) {
        args.push('--extract-glyph-bitmap');
      }
      if (options?.stride && options.stride > 0) {
        args.push('--stride', String(options.stride));
      }

      const result = spawnSync('node', args, {
        encoding: 'utf-8',
        timeout: 60000,
        cwd: path.dirname(srcDir),
        shell: true
      });

      if (result.status === 0) {
        console.log(`Font conversion succeeded: ${varName}`);
        return true;
      } else {
        console.warn(`Font conversion failed ${varName}: ${result.stderr || result.error}`);
        return false;
      }
    } catch (error) {
      console.warn(`Font conversion error ${varName}: ${error}`);
      return false;
    }
  }

  /**
   * Compact sorted code points into range strings for lv_font_conv --range
   * e.g. [0x20, 0x21, 0x22, 0x41, 0x43] => ['0x20-0x22', '0x41', '0x43']
   */
  private compactRanges(sortedCodePoints: number[]): string[] {
    if (sortedCodePoints.length === 0) {
      return ['0x20']; // fallback: at least space
    }

    const ranges: string[] = [];
    let start = sortedCodePoints[0];
    let end = start;

    for (let i = 1; i < sortedCodePoints.length; i++) {
      if (sortedCodePoints[i] === end + 1) {
        end = sortedCodePoints[i];
      } else {
        ranges.push(start === end ? `0x${start.toString(16)}` : `0x${start.toString(16)}-0x${end.toString(16)}`);
        start = sortedCodePoints[i];
        end = start;
      }
    }
    ranges.push(start === end ? `0x${start.toString(16)}` : `0x${start.toString(16)}-0x${end.toString(16)}`);

    return ranges;
  }
}
