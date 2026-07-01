/**
 * Component code generator interface
 */
import { Component } from '../../../hml/types';
import type { I18nCatalog } from '../../../project-i18n/types';

export interface ComponentCodeGenerator {
  /**
   * Generate component creation code
   */
  generateCreation(component: Component, indent: number, context: GeneratorContext): string;

  /**
   * Generate property setter code
   */
  generatePropertySetters(component: Component, indent: number, context: GeneratorContext): string;
}

/**
 * Generator context
 */
export interface GeneratorContext {
  componentMap: Map<string, Component>;
  getParentRef(component: Component): string;
  projectRoot?: string;  // Project root directory for reading asset files
  projectI18nCatalog?: I18nCatalog;  // Project i18n catalog for default-locale static text
  generateTimerBindings?: (component: Component, indent: number) => string;  // Timer binding code generation method
  isInsideListItem?: boolean;  // Whether this component is inside a list_item (note_design callback context)
}
