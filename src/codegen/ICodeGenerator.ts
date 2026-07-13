/**
 * Code generator interface
 * Supports code generation for multiple GUI engines
 */

import { Component } from '../hml/types';
import type { I18nCatalog } from '../project-i18n/types';

export type OverwritePolicy = 'always' | 'once' | 'protected';

export interface CodeGenOptions {
  srcDir: string;           // Root src directory
  designName: string;       // Design name (used for file naming)
  enableProtectedAreas?: boolean;
  /** All design names in the project (for LVGL multi-design entry file) */
  allDesignNames?: string[];
  /** Entry view ID to load as the initial screen (for LVGL multi-design) */
  entryViewId?: string;
  /** Shared resource manager instance (for LVGL multi-design resource sharing) */
  sharedResourceManager?: unknown;
  /** Skip resource preparation (when using shared resource manager) */
  skipResourcePrepare?: boolean;
  /** Project root directory (for LVGL external-bin resource packaging) */
  projectRoot?: string;
  /** Project i18n catalog for resolving active-locale text (falling back to defaultLocale) during code generation */
  projectI18nCatalog?: I18nCatalog;
  /** ROMFS base address (hex string, e.g., "0x704D1400") */
  romfsBaseAddr?: string;
}

export interface CodeGenResult {
  success: boolean;
  files: string[];
  errors?: string[];
}

/**
 * Code generator interface
 */
export interface ICodeGenerator {
  /**
   * Generate all code files
   */
  generate(): Promise<CodeGenResult>;
}

/**
 * Code generator constructor type
 */
export interface ICodeGeneratorConstructor {
  new (components: Component[], options: CodeGenOptions): ICodeGenerator;
}
