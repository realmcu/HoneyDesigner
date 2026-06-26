/**
 * hg_streaming event code generator.
 */
import { Component } from '../../../hml/types';
import { EventCodeGenerator } from './EventCodeGenerator';

export class StreamingEventGenerator implements EventCodeGenerator {
  generateEventBindings(_component: Component, _indent: number, _componentMap: Map<string, Component>): string {
    return '';
  }

  collectCallbackFunctions(_component: Component): string[] {
    return [];
  }

  getSwitchViewCallbackImpl(_component: Component, _componentMap: Map<string, Component>): string[] {
    return [];
  }
}
