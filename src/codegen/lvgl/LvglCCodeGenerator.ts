/**
 * LVGL C code generator
 * Generates C code calling LVGL APIs from a component tree
 *
 * Architecture:
 * - Main generator handles file output and orchestration only
 * - Component code generation logic is in components/ directory
 * - Resource conversion logic is in resources/ directory
 * - Utility functions are in LvglUtils.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { writeFileIfChanged } from '../../utils/fileWrite';
import { Component } from '../../hml/types';
import { ICodeGenerator, CodeGenOptions, CodeGenResult } from '../ICodeGenerator';
import { LvglGeneratorContext } from './LvglComponentGenerator';
import { LvglResourceManager } from './LvglResourceManager';
import { LvglHeaderFileGenerator } from './files/LvglHeaderFileGenerator';
import { LvglSourceFileGenerator } from './files/LvglSourceFileGenerator';
import { LvglEntryFileGenerator } from './files/LvglEntryFileGenerator';
import { LvglCallbackFileGenerator, CallbackImpl } from './files/LvglCallbackFileGenerator';
import { LvglAnimationGenerator } from './LvglAnimationGenerator';
import { LvglProtectedAreaMerger } from './files/LvglProtectedAreaMerger';
import { LvglComponentGeneratorFactory } from './components';
import { LvglEventGeneratorFactory } from './events';
import { LvglRomfsPackager } from './resources/LvglRomfsPackager';
import { LvglImgDscListGenerator } from './files/LvglImgDscListGenerator';
import { DEFAULT_ROMFS_BASE_ADDR } from '../../common/ProjectConfig';
import { logger } from '../../utils/Logger';

export class LvglCCodeGenerator implements ICodeGenerator {
  private components: Component[];
  private options: CodeGenOptions;
  private componentMap: Map<string, Component>;
  private resourceManager: LvglResourceManager;

  constructor(components: Component[], options: CodeGenOptions) {
    this.components = components;
    this.options = options;
    this.componentMap = new Map(components.map(c => [c.id, c]));
    // Use shared resource manager if provided (multi-design mode), otherwise create a new one
    this.resourceManager = (options.sharedResourceManager instanceof LvglResourceManager)
      ? options.sharedResourceManager
      : new LvglResourceManager();
  }

  // File generators
  private headerFileGenerator = new LvglHeaderFileGenerator();
  private sourceFileGenerator = new LvglSourceFileGenerator();
  private entryFileGenerator = new LvglEntryFileGenerator();
  private callbackFileGenerator = new LvglCallbackFileGenerator();

  /**
   * Generate all code files
   */
  async generate(): Promise<CodeGenResult> {
    try {
      const files: string[] = [];
      const srcDir = this.options.srcDir;
      const designName = this.options.designName;

      const lvglDir = path.join(srcDir, 'lvgl');
      if (!fs.existsSync(lvglDir)) {
        fs.mkdirSync(lvglDir, { recursive: true });
      }

      // Resource preprocessing (skip if already done externally in multi-design mode)
      // NOTE: await is required - prepare() runs async LVGLImage.py to convert images to bin format
      // and populates binImageInfoMap; without await, hasExternalBinImages() will return false
      // and external-bin assets will silently fall back to c-array behavior.
      if (!this.options.skipResourcePrepare) {
        await this.resourceManager.prepare(this.components, srcDir, lvglDir);
      }

      // Prepare shared data
      const orderedComponents = this.getCreationOrder();
      const ctx = this.createContext();
      const imageVars = this.resourceManager.getImageVarList();
      const fontVars = this.resourceManager.getFontVarList();

      // Generate content via file generators
      const headerFile = path.join(lvglDir, `${designName}_lvgl_ui.h`);
      const sourceFile = path.join(lvglDir, `${designName}_lvgl_ui.c`);

      // Shared animation generator: the source generator's pre-pass populates it
      // with discrete-action timer callbacks + extern declarations, which are then
      // collected into the callback files below.
      const animGenerator = new LvglAnimationGenerator();

      writeFileIfChanged(headerFile, this.headerFileGenerator.generate(designName, orderedComponents), 'utf-8');

      const generatedUiSource = this.sourceFileGenerator.generate(designName, orderedComponents, ctx, imageVars, fontVars, (c) => this.getParentRef(c), this.resourceManager, animGenerator);
      if (fs.existsSync(sourceFile)) {
        try {
          const existingUiSource = fs.readFileSync(sourceFile, 'utf-8');
          const mergedUiSource = LvglProtectedAreaMerger.merge(existingUiSource, generatedUiSource);
          writeFileIfChanged(sourceFile, mergedUiSource, 'utf-8');
        } catch (e) {
          logger.warn(`[LvglCCodeGenerator] Failed to read existing source file, overwriting: ${e}`);
          writeFileIfChanged(sourceFile, generatedUiSource, 'utf-8');
        }
      } else {
        writeFileIfChanged(sourceFile, generatedUiSource, 'utf-8');
      }

      files.push(headerFile, sourceFile);

      // Generate entry file with all design names and entry view
      const allDesignNames = this.options.allDesignNames || [designName];
      const entryViewId = this.options.entryViewId;
      const entryHeaderFile = path.join(lvglDir, 'lvgl_generated_ui.h');
      const entrySourceFile = path.join(lvglDir, 'lvgl_generated_ui.c');

      // Check if there are external-bin images
      const hasExternalBin = this.resourceManager.hasExternalBinImages();

      writeFileIfChanged(entryHeaderFile, this.entryFileGenerator.generateHeader(), 'utf-8');
      writeFileIfChanged(entrySourceFile, this.entryFileGenerator.generateSource(designName, allDesignNames, entryViewId, hasExternalBin), 'utf-8');

      files.push(entryHeaderFile, entrySourceFile);

      // Generate callback files (with protected area mechanism)
      // Always generate callback files, even if no events are configured, to ensure header exists for #include
      const callbackImpls = this.collectCallbackImpls(orderedComponents);
      // Append discrete-action timer callbacks collected during the source pre-pass.
      callbackImpls.push(...animGenerator.getTimerCallbackImpls());
      const callbackHeaderFile = path.join(lvglDir, `${designName}_lvgl_callbacks.h`);
      const callbackSourceFile = path.join(lvglDir, `${designName}_lvgl_callbacks.c`);
      const callbackDeclarations = callbackImpls.map(impl => impl.signature);

      const generatedHeader = this.callbackFileGenerator.generateHeader(designName, callbackDeclarations);
      const generatedSource = this.callbackFileGenerator.generateImplementation(
        designName,
        callbackImpls,
        animGenerator.getCallbackExternDeclarations()
      );

      writeFileIfChanged(callbackHeaderFile, generatedHeader, 'utf-8');

      // Callback implementation file: merge protected areas to preserve user code if file exists
      if (fs.existsSync(callbackSourceFile)) {
        try {
          const existing = fs.readFileSync(callbackSourceFile, 'utf-8');
          const merged = LvglProtectedAreaMerger.merge(existing, generatedSource);
          writeFileIfChanged(callbackSourceFile, merged, 'utf-8');
        } catch (e) {
          console.warn(`Failed to read existing callback file, overwriting: ${e}`);
          writeFileIfChanged(callbackSourceFile, generatedSource, 'utf-8');
        }
      } else {
        writeFileIfChanged(callbackSourceFile, generatedSource, 'utf-8');
      }

      files.push(callbackHeaderFile, callbackSourceFile);

      // External-bin post-processing: package romfs and generate img_dsc_list
      if (hasExternalBin) {
        const externalBinResult = await this.processExternalBinImages(lvglDir);
        if (externalBinResult.files.length > 0) {
          files.push(...externalBinResult.files);
        }
        if (externalBinResult.errors.length > 0) {
          return {
            success: false,
            files,
            errors: externalBinResult.errors
          };
        }
      }

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
   * Process external-bin images: package romfs and generate img_dsc_list
   */
  private async processExternalBinImages(lvglDir: string): Promise<{ files: string[]; errors: string[] }> {
    const files: string[] = [];
    const errors: string[] = [];

    const projectRoot = this.options.projectRoot;
    if (!projectRoot) {
      errors.push('projectRoot is required for external-bin deployment mode');
      return { files, errors };
    }

    const binImageInfos = this.resourceManager.getBinImageInfos();
    if (binImageInfos.length === 0) {
      return { files, errors };
    }

    const rootDir = path.join(projectRoot, 'build', 'root');
    const outputDir = path.join(projectRoot, 'build');
    const baseAddr = this.options.romfsBaseAddr || DEFAULT_ROMFS_BASE_ADDR;

    // Package romfs.bin
    const packager = new LvglRomfsPackager();
    const packageResult = await packager.package(rootDir, outputDir, lvglDir, baseAddr, binImageInfos);

    if (!packageResult.success) {
      errors.push(`Failed to package romfs: ${packageResult.error}`);
      return { files, errors };
    }

    if (packageResult.romfsBinPath) {
      files.push(packageResult.romfsBinPath);
      logger.info(`[LvglCCodeGenerator] Generated romfs.bin: ${packageResult.romfsBinPath}`);
    }

    if (packageResult.uiResourceHeaderPath) {
      files.push(packageResult.uiResourceHeaderPath);
      logger.info(`[LvglCCodeGenerator] Generated ui_resource.h: ${packageResult.uiResourceHeaderPath}`);
    }

    // Generate lv_img_dsc_list.c/h
    const imgDscListGenerator = new LvglImgDscListGenerator();
    const imgDscListHeader = path.join(lvglDir, 'lv_img_dsc_list.h');
    const imgDscListSource = path.join(lvglDir, 'lv_img_dsc_list.c');

    writeFileIfChanged(imgDscListHeader, imgDscListGenerator.generateHeader(binImageInfos), 'utf-8');
    writeFileIfChanged(imgDscListSource, imgDscListGenerator.generateSource(binImageInfos), 'utf-8');

    files.push(imgDscListHeader, imgDscListSource);
    logger.info(`[LvglCCodeGenerator] Generated lv_img_dsc_list for ${binImageInfos.length} external-bin images`);

    return { files, errors };
  }

  /**
   * Create generator context (used by component generators)
   */
  private createContext(): LvglGeneratorContext {
    return {
      componentMap: this.componentMap,
      getParentRef: (component: Component) => this.getParentRef(component),
      resources: this.resourceManager,
      projectI18nCatalog: this.options.projectI18nCatalog,
      getBuiltinImageVar: (source: string) => this.resourceManager.getImageVar(source),
      getBuiltinFontVar: (fontFile: string, fontSize: number, bpp?: number, pixelOrder?: 'MSB' | 'LSB') => this.resourceManager.getFontVar(fontFile, fontSize, bpp, pixelOrder),
      getAncestorBackgroundColor: (component: Component) => this.getAncestorBackgroundColor(component),
    };
  }

  /**
   * Component creation order sorted by z-index (depth-first)
   */
  private getCreationOrder(): Component[] {
    const childrenMap = new Map<string | null, Component[]>();

    const pushChild = (parentId: string | null, component: Component): void => {
      const list = childrenMap.get(parentId) || [];
      list.push(component);
      childrenMap.set(parentId, list);
    };

    this.components.forEach(component => {
      const parentId = component.parent || null;
      if (parentId && !this.componentMap.has(parentId)) {
        pushChild(null, component);
      } else {
        pushChild(parentId, component);
      }
    });

    const sortByZIndex = (list: Component[]): Component[] => {
      return list.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
    };

    const ordered: Component[] = [];
    const visited = new Set<string>();

    const walk = (parentId: string | null): void => {
      const children = sortByZIndex(childrenMap.get(parentId) || []);
      children.forEach(child => {
        if (visited.has(child.id)) { return; }
        visited.add(child.id);
        ordered.push(child);
        walk(child.id);
      });
    };

    walk(null);

    // Ensure all components are included
    this.components.forEach(component => {
      if (!visited.has(component.id)) {
        ordered.push(component);
      }
    });

    return ordered;
  }

  private getParentRef(component: Component): string {
    const parentId = component.parent;
    if (!parentId || !this.componentMap.has(parentId)) {
      return 'parent';
    }
    return parentId;
  }

  /**
   * Collect callback function implementations from event generator factory
   */
  private collectCallbackImpls(orderedComponents: Component[]): CallbackImpl[] {
    const impls: CallbackImpl[] = [];

    for (const component of orderedComponents) {
      const eventGenerator = LvglEventGeneratorFactory.getGenerator(component.type);
      if (!eventGenerator) { continue; }

      const callbackCodes = eventGenerator.getEventCallbackImpl(component);
      for (const callbackCode of callbackCodes) {
        // Parse static void xxx(lv_event_t * e) { ... } block
        const funcRegex = /static void (\w+)\(lv_event_t \* e\)\n\{([\s\S]*?)\n\}\n?$/;
        const match = funcRegex.exec(callbackCode);
        if (match) {
          impls.push({
            name: match[1],
            signature: `void ${match[1]}(lv_event_t * e)`,
            body: match[2] + '\n',
          });
        }
      }
    }

    return impls;
  }

  /**
   * Look up ancestor container's background color
   */
  private getAncestorBackgroundColor(component: Component): string | null {
    let current: Component | undefined = component;
    while (current) {
      const parentId = current.parent;
      if (!parentId) { break; }
      const parent = this.componentMap.get(parentId);
      if (!parent) { break; }
      const bgColor = parent.style?.backgroundColor;
      if (bgColor) {
        return String(bgColor);
      }
      current = parent;
    }
    return null;
  }
}
