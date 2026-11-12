/**
 * 共享样式属性与组件的对应关系。
 *
 * 样式不绑定组件类型，任何组件都能引用；组件只使用自己支持的属性（组件定义里声明过、
 * 且在样式白名单内的），其余忽略。组件定义是属性面板的来源，用它判断就和面板显示的一致
 * （发光/阴影只有 rect/circle 有）。
 */
import { componentDefinitions } from '../ComponentLibrary';
import {
  isShareableStyleProperty,
  resolveSharedStyle,
  SHARED_STYLE_FONT_PROPERTIES,
  SHARED_STYLE_PROPERTIES,
} from '../../../shared/sharedStyles';
import type { PropertyDefinition } from '../../types';

const byType = new Map<string, PropertyDefinition[]>();

/** 某种组件能从样式里接收的属性 */
export function shareablePropertiesFor(componentType: string | undefined): PropertyDefinition[] {
  if (!componentType) {
    return [];
  }
  const cached = byType.get(componentType);
  if (cached) {
    return cached;
  }
  const definition = componentDefinitions.find((item) => item.type === componentType);
  const seen = new Set<string>();
  const result = (definition?.properties ?? []).filter((property) => {
    if (seen.has(property.name) || !isShareableStyleProperty(property.name)) {
      return false;
    }
    seen.add(property.name);
    return true;
  });
  byType.set(componentType, result);
  return result;
}

export interface StylePropertyOption {
  name: string;
  /** 任一组件里的定义，用来决定编辑器类型和显示名；没有组件声明时为 undefined */
  definition?: PropertyDefinition;
  /** 支持该属性的组件显示名 */
  supportedBy: string[];
}

let options: StylePropertyOption[] | null = null;

/** 样式可添加的全部属性，附带支持它的组件 */
export function stylePropertyOptions(): StylePropertyOption[] {
  if (options) {
    return options;
  }
  options = [...SHARED_STYLE_FONT_PROPERTIES, ...SHARED_STYLE_PROPERTIES].map((name) => {
    let definition: PropertyDefinition | undefined;
    const supportedBy: string[] = [];
    for (const component of componentDefinitions) {
      // 矩形/圆形没有 color，但样式里的 color 会作为它们的填充色（见 resolveSharedStyle）
      const effective = resolveSharedStyle({ id: '_', props: { [name]: '' } }, component.type);
      const effectiveName = Object.keys(effective!.props)[0];
      const found = shareablePropertiesFor(component.type).find((property) => property.name === effectiveName);
      if (found) {
        if (!definition || (definition.name !== name && found.name === name)) {
          definition = found;
        }
        supportedBy.push(component.name);
      }
    }
    return { name, definition, supportedBy };
  });
  return options;
}
