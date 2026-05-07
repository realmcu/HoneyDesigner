/**
 * LVGL unified resource manager
 * Wraps LvglImageConverter, LvglFontConverter, and LvglBinImageConverter
 * providing a unified resource query interface for both c-array and external-bin modes
 */
import * as path from 'path';
import { Component } from '../../hml/types';
import { LvglImageConverter } from './resources/LvglImageConverter';
import { LvglFontConverter } from './resources/LvglFontConverter';
import { LvglBinImageConverter, BinImageInfo, ExternalBinImage } from './resources/LvglBinImageConverter';
import { ConversionConfigService } from '../../services/ConversionConfigService';

/** Image reference type returned by getImageRef() */
export interface ImageRef {
  type: 'c-array' | 'external-bin';
  /** For c-array: C variable name (e.g., "img_bg") */
  /** For external-bin: descriptor name (e.g., "bg") */
  name: string;
}

export class LvglResourceManager {
  private imageConverter: LvglImageConverter;
  private fontConverter: LvglFontConverter;
  private binImageConverter: LvglBinImageConverter;

  constructor() {
    this.imageConverter = new LvglImageConverter();
    this.fontConverter = new LvglFontConverter();
    this.binImageConverter = new LvglBinImageConverter();
  }

  /**
   * Prepare resources for all components
   * Splits images by deployment mode and processes each group separately
   */
  async prepare(components: Component[], srcDir: string, lvglDir: string): Promise<void> {
    const projectRoot = path.dirname(srcDir);

    // Collect all image sources from components
    const allImages = this.collectImageSources(components);

    // Load conversion config to resolve deployment mode for each image
    const configService = ConversionConfigService.getInstance();
    const config = configService.loadConfig(projectRoot);

    // Split images into c-array and external-bin groups
    const cArrayImages: string[] = [];
    const externalBinImages: ExternalBinImage[] = [];

    for (const imgSrc of allImages) {
      const resolved = configService.resolveEffectiveConfig(imgSrc, config);
      if (resolved.deployment === 'external-bin') {
        externalBinImages.push({
          sourcePath: imgSrc,
          resolvedFormat: resolved.format,
          resolvedCompression: resolved.compression
        });
      } else {
        cArrayImages.push(imgSrc);
      }
    }

    // Process c-array images (existing logic)
    this.imageConverter.prepareFromList(cArrayImages, srcDir, lvglDir);

    // Process external-bin images (new logic)
    if (externalBinImages.length > 0) {
      const outputRootDir = path.join(projectRoot, 'build', 'root');
      await this.binImageConverter.prepare(externalBinImages, projectRoot, outputRootDir);
    }

    // Process fonts (unchanged)
    this.fontConverter.prepare(components, srcDir, lvglDir);
  }

  /**
   * Get image reference info for code generation
   * Returns different reference based on deployment mode
   */
  getImageRef(source: string): ImageRef | undefined {
    // First check if it's an external-bin image
    const binInfo = this.binImageConverter.getBinImageInfo(source);
    if (binInfo) {
      return {
        type: 'external-bin',
        name: binInfo.descriptorName
      };
    }

    // Then check if it's a c-array image
    const varName = this.imageConverter.getBuiltinImageVar(source);
    if (varName) {
      return {
        type: 'c-array',
        name: varName
      };
    }

    return undefined;
  }

  /** Get C variable name for a converted image (c-array only) */
  getImageVar(source: string): string | undefined {
    return this.imageConverter.getBuiltinImageVar(source);
  }

  /** Get C variable name for a converted font */
  getFontVar(fontFile: string, fontSize: number, bpp: number = 4): string | null {
    return this.fontConverter.getBuiltinFontVar(fontFile, fontSize, bpp);
  }

  /** Get list of all converted image variable names (c-array only) */
  getImageVarList(): string[] {
    return this.imageConverter.getBuiltinImageVarList();
  }

  /** Get list of all converted font variable names */
  getFontVarList(): string[] {
    return this.fontConverter.getBuiltinFontVarList();
  }

  /** Get list of all external-bin image metadata */
  getBinImageInfos(): BinImageInfo[] {
    return this.binImageConverter.getBinImageInfos();
  }

  /** Check if there are any external-bin images */
  hasExternalBinImages(): boolean {
    return this.binImageConverter.hasBinImages();
  }

  /**
   * Collect all image sources used by components
   * Copied from LvglImageConverter for use in deployment splitting
   */
  private collectImageSources(components: Component[]): string[] {
    const imageExts = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.webp']);
    const seen = new Set<string>();
    const result: string[] = [];

    const addImage = (src: string | undefined | null) => {
      if (!src) { return; }
      const srcText = String(src).trim();
      if (!srcText) { return; }
      const ext = path.extname(srcText).toLowerCase();
      if (!imageExts.has(ext)) { return; }
      // Normalize key for deduplication
      const key = srcText.replace(/\\/g, '/').toLowerCase();
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
}
