/**
 * 改进的HML解析器
 * 修复了组件过滤问题，支持更灵活的组件识别
 */

import { XMLParser } from 'fast-xml-parser';
import { Component, Meta, View, Document, ComponentPosition } from './types';
import type { EventConfig, Action, EventType, ActionType } from './eventTypes';
import { logger } from '../utils/Logger';
import { convertAttributeValue } from '../shared/componentPropertyTypes';

/**
 * 组件注册表 - 集中管理所有支持的组件类型
 */
class ComponentRegistry {
  private static readonly VALID_COMPONENTS = new Set([
    // HoneyGUI标准组件 (hg_前缀)
    'hg_button', 'hg_image', 'hg_input',
    'hg_checkbox', 'hg_radio', 'hg_progressbar', 'hg_slider',
    'hg_switch', 'hg_canvas', 'hg_list', 'hg_list_item', 'hg_grid', 'hg_tab',
    'hg_label', 'hg_glass',
    
    // 容器组件
    'hg_window', 'hg_dialog', 'hg_container', 'hg_view',
    // 粒子效果组件
    'hg_particle',
    // 蜂窝菜单组件
    'hg_menu_cellular'
  ]);

  static isValidComponent(name: string): boolean {
    return this.VALID_COMPONENTS.has(name) || name.startsWith('hg_') || name.startsWith('custom_');
  }

  static register(componentName: string): void {
    this.VALID_COMPONENTS.add(componentName);
  }
}

/**
 * HML解析器 (改进版本)
 * 使用 preserveOrder 模式保持 XML 元素的原始顺序
 */
export class HmlParser {
  private xmlParser: XMLParser;
  private xmlParserOrdered: XMLParser;
  private idCounter = 0;

  constructor() {
    // 文本类属性，保留原始值（不 trim）
    const TEXT_PROPS = new Set(['text', 'placeholder']);
    
    // 属性值处理器：text/placeholder 保留原始值，其他属性 trim
    const attributeValueProcessor = (attrName: string, attrValue: string): string => {
      if (TEXT_PROPS.has(attrName)) {
        return attrValue; // 保留原始值，包括首尾空格
      }
      return attrValue.trim();
    };

    // 普通解析器（用于 meta 等不需要保持顺序的部分）
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      textNodeName: '_text',
      parseAttributeValue: false,
      trimValues: false,  // 关闭全局 trim，由 attributeValueProcessor 精确控制
      attributeValueProcessor,
    });
    
    // 保持顺序的解析器（用于 view 中的组件）
    this.xmlParserOrdered = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      textNodeName: '_text',
      parseAttributeValue: false,
      trimValues: false,  // 关闭全局 trim，由 attributeValueProcessor 精确控制
      attributeValueProcessor,
      preserveOrder: true  // 保持 XML 元素的原始顺序
    });
  }

  // 当前 HML 文件路径（用于加载相对路径的 SVG 文件）
  private currentHmlPath: string = '';

  /**
   * 解析HML内容
   * @param content HML 文件内容
   * @param hmlFilePath 可选，HML 文件路径（用于加载相对路径的 SVG 文件）
   */
  parse(content: string, hmlFilePath?: string): Document {
    try {
      // 保存当前 HML 路径
      this.currentHmlPath = hmlFilePath || '';

      // 使用普通解析器获取 meta
      const parsed = this.xmlParser.parse(content);
      
      if (!parsed.hml) {
        throw new Error('Invalid HML: missing <hml> root element');
      }

      const meta = this._parseMeta(parsed.hml.meta || {});
      
      // 使用保持顺序的解析器解析 view
      const parsedOrdered = this.xmlParserOrdered.parse(content);
      const view = this._parseViewOrdered(parsedOrdered, meta);

      return { meta, view };
    } catch (error) {
      throw new Error(`HML parsing failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 解析元数据
   */
  private _parseMeta(metaElement: any): Meta {
    const meta: Meta = {};

    // 基本属性
    if (metaElement.title) meta.title = String(metaElement.title);
    if (metaElement.description) meta.description = String(metaElement.description);

    // 项目信息
    if (metaElement.project) {
      meta.project = { ...metaElement.project };
    }

    // 作者信息
    if (metaElement.author) {
      meta.author = { ...metaElement.author };
    }

    // 默认值
    if (!meta.title) meta.title = '未命名页面';

    return meta;
  }

  /**
   * 解析视图（保持顺序版本）
   * preserveOrder 模式下的数据结构是数组形式
   */
  private _parseViewOrdered(parsedOrdered: any[], meta: Meta): View {
    const componentMap = new Map<string, Component>();

    // 找到 hml 元素
    const hmlElement = parsedOrdered.find((item: any) => item.hml);
    if (!hmlElement || !hmlElement.hml) {
      return { components: [] };
    }

    // 找到 view 元素
    const viewElement = hmlElement.hml.find((item: any) => item.view);
    if (!viewElement || !viewElement.view) {
      return { components: [] };
    }

    // 解析 view 中的组件（保持顺序）
    this._parseChildrenOrdered(viewElement.view, componentMap, undefined);

    // 按层级排序组件（同级组件按 zIndex 排序）
    const sortedComponents = this._sortComponentsByZIndex(Array.from(componentMap.values()));

    return {
      components: sortedComponents
    };
  }

  /**
   * 按层级排序组件（同级组件按 zIndex 排序）
   */
  private _sortComponentsByZIndex(components: Component[]): Component[] {
    // 按父组件分组
    const grouped = new Map<string | null | undefined, Component[]>();
    for (const comp of components) {
      const key = comp.parent || null;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(comp);
    }

    // 对每组同级组件按 zIndex 排序
    for (const [_, siblings] of grouped) {
      siblings.sort((a, b) => {
        const zIndexA = typeof a.zIndex === 'number' ? a.zIndex : 0;
        const zIndexB = typeof b.zIndex === 'number' ? b.zIndex : 0;
        return zIndexA - zIndexB;
      });
    }

    // 重新构建数组（保持层级结构）
    const result: Component[] = [];
    const addComponentAndChildren = (comp: Component) => {
      result.push(comp);
      if (comp.children) {
        for (const childId of comp.children) {
          const child = components.find(c => c.id === childId);
          if (child) {
            addComponentAndChildren(child);
          }
        }
      }
    };

    // 从根组件开始
    const roots = grouped.get(null) || [];
    for (const root of roots) {
      addComponentAndChildren(root);
    }

    return result;
  }

  /**
   * 规范化属性名（移除 preserveOrder 模式下的 @_ 前缀）
   */
  private _normalizeAttributes(rawAttributes: Record<string, any>): Record<string, any> {
    const normalized: Record<string, any> = {};
    
    for (const key of Object.keys(rawAttributes)) {
      // 移除 @_ 前缀
      const normalizedKey = key.startsWith('@_') ? key.substring(2) : key;
      normalized[normalizedKey] = rawAttributes[key];
    }
    
    return normalized;
  }

  /**
   * 解析子组件（保持顺序版本）
   * preserveOrder 模式下，子元素是数组，每个元素是 { tagName: [...children], ':@': { '@_attrName': value } }
   */
  private _parseChildrenOrdered(
    elements: any[],
    componentMap: Map<string, Component>,
    parentId: string | undefined
  ): string[] {
    const childIds: string[] = [];
    let listItemIndex = 0;

    if (!Array.isArray(elements)) {
      return childIds;
    }

    elements.forEach((element: any) => {
      // 获取标签名（排除 :@ 属性对象）
      const tagName = Object.keys(element).find(key => key !== ':@');
      if (!tagName) return;

      // 跳过非组件元素
      if (!ComponentRegistry.isValidComponent(tagName)) {
        return;
      }

      // 获取属性（preserveOrder 模式下属性名有 @_ 前缀）
      const rawAttributes = element[':@'] || {};
      const attributes = this._normalizeAttributes(rawAttributes);
      const children = element[tagName] || [];

      // 解析组件
      const component = this._parseComponentOrdered(tagName, attributes, children, componentMap, parentId);
      
      // 对于 hg_list 的 hg_list_item 子组件，自动分配 index
      if (parentId) {
        const parent = componentMap.get(parentId);
        if (parent?.type === 'hg_list' && component.type === 'hg_list_item') {
          if (component.data && component.data.index === undefined) {
            component.data.index = listItemIndex;
          }
          listItemIndex++;
        }
      }

      childIds.push(component.id);
    });

    return childIds;
  }

  /**
   * 解析单个组件（保持顺序版本）
   */
  private _parseComponentOrdered(
    tagName: string,
    attributes: Record<string, any>,
    children: any[],
    componentMap: Map<string, Component>,
    parentId?: string
  ): Component {
    const componentId = attributes.id || this._generateId(tagName);

    // 检查是否已存在
    if (componentMap.has(componentId)) {
      return componentMap.get(componentId)!;
    }

    // 解析位置和尺寸
    const position: ComponentPosition = {
      x: parseInt(attributes.x || '0'),
      y: parseInt(attributes.y || '0'),
      width: parseInt(attributes.width || '100'),
      height: parseInt(attributes.height || '40')
    };

    // 分离属性
    const { style, data, events } = this._categorizeAttributes(attributes, tagName);

    // 应用默认值（针对 list 控件）
    if (tagName === 'hg_list') {
      this._applyListDefaults(style, data);
    }

    // 对于 hg_canvas，加载 SVG 文件内容
    if (tagName === 'hg_canvas' && data.svgFile && this.currentHmlPath) {
      this._loadCanvasSvgContent(data);
    }

    // 解析事件配置
    const eventConfigs = this._parseEventConfigsOrdered(children);

    // 创建组件
    const component: Component = {
      id: componentId,
      type: tagName,
      name: attributes.name || componentId,
      position,
      style,
      data,
      events,
      eventConfigs,
      children: [],
      parent: parentId || null,
      visible: attributes.visible !== 'false',
      enabled: attributes.enabled !== 'false',
      locked: attributes.locked === 'true',
      showOverflow: attributes.showOverflow === 'true',
      zIndex: parseInt(attributes.zIndex || '0')
    };

    // 添加到映射
    componentMap.set(componentId, component);

    // 递归解析子组件（保持顺序）
    component.children = this._parseChildrenOrdered(children, componentMap, componentId);

    // 对于 hg_list 组件，按 y/x 坐标排序子组件（hg_list_item），并修正位置
    if (tagName === 'hg_list' && component.children && component.children.length > 0) {
      // 只处理 hg_list_item 类型的子组件
      const listItemComponents = component.children
        .map(childId => componentMap.get(childId))
        .filter(child => child !== undefined && child.type === 'hg_list_item') as Component[];
      
      if (listItemComponents.length > 0) {
        const direction = style?.direction || data?.direction || 'VERTICAL';
        const isVertical = direction === 'VERTICAL';
        
        // 先按位置排序
        listItemComponents.sort((a, b) => {
          if (isVertical) {
            return a.position.y - b.position.y;
          } else {
            return a.position.x - b.position.x;
          }
        });
        
        // 获取 list 的布局属性
        const itemWidth = parseInt(style?.itemWidth) || 100;
        const itemHeight = parseInt(style?.itemHeight) || 100;
        const space = parseInt(style?.space) || 0;
        
        // 重新计算每个 list_item 的位置和尺寸
        listItemComponents.forEach((child, idx) => {
          // 更新 index
          if (child.data) {
            child.data.index = idx;
          } else {
            child.data = { index: idx };
          }
          
          // 根据 direction、itemWidth、itemHeight、space 计算正确的位置
          if (isVertical) {
            child.position.x = 0;
            child.position.y = idx * (itemHeight + space);
            child.position.width = itemWidth;
            child.position.height = itemHeight;
          } else {
            child.position.x = idx * (itemWidth + space);
            child.position.y = 0;
            child.position.width = itemWidth;
            child.position.height = itemHeight;
          }
        });
        
        // 重新排列 children 数组：先放排序后的 list_item，再放其他子组件
        const otherChildren = component.children.filter(childId => {
          const child = componentMap.get(childId);
          return child && child.type !== 'hg_list_item';
        });
        component.children = [...listItemComponents.map(c => c.id), ...otherChildren];
      }
    }

    return component;
  }

  /**
   * 解析事件配置（保持顺序版本）
   */
  private _parseEventConfigsOrdered(children: any[]): EventConfig[] | undefined {
    if (!Array.isArray(children)) return undefined;

    // 找到 events 元素
    const eventsElement = children.find((item: any) => item.events);
    if (!eventsElement || !eventsElement.events) return undefined;

    const eventConfigs: EventConfig[] = [];
    const eventElements = eventsElement.events;

    if (!Array.isArray(eventElements)) return undefined;

    eventElements.forEach((eventEl: any) => {
      if (!eventEl.event) return;

      const rawAttrs = eventEl[':@'] || {};
      const attrs = this._normalizeAttributes(rawAttrs);
      const eventType = attrs.type as EventType;
      if (!eventType) return;

      const eventConfig: EventConfig = {
        type: eventType,
        actions: [],
      };

      if (eventType === 'onMessage' && attrs.message) {
        eventConfig.message = attrs.message;
      }

      if (attrs.handler) {
        eventConfig.handler = attrs.handler;
      }

      // 解析 checkReleaseArea 属性（抬起区域检测）
      if (eventType === 'onTouchUp' && attrs.checkReleaseArea === 'true') {
        eventConfig.checkReleaseArea = true;
      }

      // 解析 keyName 属性（按键事件专用）
      if ((eventType === 'onKeyShortPress' || eventType === 'onKeyLongPress') && attrs.keyName) {
        eventConfig.keyName = attrs.keyName;
      }

      // 解析动作
      const actionElements = eventEl.event;
      if (Array.isArray(actionElements)) {
        actionElements.forEach((actionEl: any) => {
          if (!actionEl.action) return;
          
          const rawActionAttrs = actionEl[':@'] || {};
          const actionAttrs = this._normalizeAttributes(rawActionAttrs);
          const action: Action = {
            type: actionAttrs.type as ActionType,
          };

          if (actionAttrs.target) action.target = actionAttrs.target;
          if (actionAttrs.message) action.message = actionAttrs.message;
          if (actionAttrs.functionName) action.functionName = actionAttrs.functionName;
          if (actionAttrs.switchOutStyle) action.switchOutStyle = actionAttrs.switchOutStyle;
          if (actionAttrs.switchInStyle) action.switchInStyle = actionAttrs.switchInStyle;
          
          // 解析 controlTimer 的 timerTargets
          if (actionAttrs.timerTargets && typeof actionAttrs.timerTargets === 'string') {
            try {
              action.timerTargets = JSON.parse(actionAttrs.timerTargets);
            } catch (e) {
              console.warn(`Failed to parse timerTargets JSON: ${actionAttrs.timerTargets}`);
            }
          }

          eventConfig.actions.push(action);
        });
      }

      eventConfigs.push(eventConfig);
    });

    return eventConfigs.length > 0 ? eventConfigs : undefined;
  }

  /**
   * 解析视图（旧版本，保留兼容）
   */
  private _parseView(viewElement: any, meta: Meta): View {
    const components: Component[] = [];
    const componentMap = new Map<string, Component>();

    if (viewElement && typeof viewElement === 'object') {
      Object.keys(viewElement).forEach(key => {
        if (key === '_attributes' || key === '_text') {
          return;
        }

        // 使用改进的组件验证
        if (!ComponentRegistry.isValidComponent(key)) {
          logger.warn(`[HoneyGUI] 跳过未知组件: ${key}, 提示: 如果这是自定义组件，请使用 'custom_' 前缀或注册到组件表`);
          return;
        }

        const element = viewElement[key];
        if (element && typeof element === 'object') {
          const elements = Array.isArray(element) ? element : [element];
          elements.forEach((child: any) => {
            const component = this._parseComponent(key, child, componentMap, undefined);
            components.push(component);
          });
        }
      });
    }

    // 按层级排序组件（同级组件按 zIndex 排序）
    const sortedComponents = this._sortComponentsByZIndex(Array.from(componentMap.values()));

    return {
      components: sortedComponents
    };
  }

  /**
   * 解析组件
   */
  private _parseComponent(
    tagName: string,
    element: any,
    componentMap: Map<string, Component>,
    parentId?: string
  ): Component {
    // 优先从 _attributes 中获取，如果不存在则从 element 本身获取
    const attributes = element._attributes || element;
    // 确保正确提取 id，避免生成新ID
    const componentId = attributes.id || element.id || this._generateId(tagName);

    // 检查是否已存在
    if (componentMap.has(componentId)) {
      return componentMap.get(componentId)!;
    }

    // 直接使用tagName作为组件类型
    const normalizedType = tagName;

    // 解析位置和尺寸
    const position: ComponentPosition = {
      x: parseInt(attributes.x || '0'),
      y: parseInt(attributes.y || '0'),
      width: parseInt(attributes.width || '100'),
      height: parseInt(attributes.height || '40')
    };

    // 分离属性
    const { style, data, events } = this._categorizeAttributes(attributes, normalizedType);

    // 应用默认值（针对 list 控件）
    if (normalizedType === 'hg_list') {
      this._applyListDefaults(style, data);
    }

    // 解析事件配置
    const eventConfigs = this._parseEventConfigs(element);

    // 创建组件
    const component: Component = {
      id: componentId,
      type: normalizedType,
      name: attributes.name || componentId,
      position,
      style,
      data,
      events,
      eventConfigs,
      children: [],
      parent: parentId || null,
      visible: attributes.visible !== 'false',
      enabled: attributes.enabled !== 'false',
      locked: attributes.locked === 'true',
      showOverflow: attributes.showOverflow === 'true',
      zIndex: parseInt(attributes.zIndex || '0')
    };

    // 添加到映射
    componentMap.set(componentId, component);

    // 解析子组件
    this._parseChildren(element, componentMap, componentId, component);

    return component;
  }

  /**
   * 应用 list 控件的默认值
   */
  private _applyListDefaults(style: Record<string, any>, data: Record<string, any>): void {
    // 样式默认值
    if (style.itemWidth === undefined) style.itemWidth = 100;
    if (style.itemHeight === undefined) style.itemHeight = 100;
    if (style.space === undefined) style.space = 0;
    if (style.direction === undefined) style.direction = 'VERTICAL';
    if (style.style === undefined) style.style = 'LIST_CLASSIC';

    // 数据默认值
    if (data.noteNum === undefined) data.noteNum = 5;

    // 通用属性默认值
    if (data.autoAlign === undefined) data.autoAlign = true;
    if (data.inertia === undefined) data.inertia = true;
    if (data.loop === undefined) data.loop = false;
    if (data.createBar === undefined) data.createBar = false;
    if (data.enableAreaDisplay === undefined) data.enableAreaDisplay = false;
    if (data.keepNoteAlive === undefined) data.keepNoteAlive = false;
  }

  /**
   * 分类属性到style、data、events
   */
  private _categorizeAttributes(attributes: any, tagName: string): {
    style: Record<string, any>;
    data: Record<string, any>;
    events: Record<string, any>;
  } {
    const style: Record<string, any> = {};
    const data: Record<string, any> = {};
    const events: Record<string, any> = {};

    const styleProps = new Set([
      'color', 'backgroundColor', 'fontWeight',
      'border', 'borderRadius', 'padding', 'margin',
      'overflow', 'title', 'titleBarHeight', 'titleBarColor',
      // 圆弧属性
      'radius', 'startAngle', 'endAngle', 'strokeWidth',
      // 矩形属性
      'fillColor',
      // 窗口属性
      'showBackground',
      // 列表属性
      'itemWidth', 'itemHeight', 'direction', 'style', 'space', 'cardStackLocation', 'circleRadius',
      // 图像变换属性
      'transform',
      // 文本样式属性
      'align', 'hAlign', 'vAlign', 'letterSpacing', 'lineSpacing', 'wordWrap', 'wordBreak',
      // 渐变属性
      'useGradient', 'gradientType', 'gradientDirection',
      // 透明度
      'opacity',
      // 进度条属性
      'orientation'
    ]);

    // 需要转换为数字的属性
    const numericProps = new Set([
      'fontSize', 'borderRadius', 'padding', 'margin',
      'titleBarHeight', 'radius', 'startAngle', 'endAngle', 'strokeWidth',
      'itemWidth', 'itemHeight', 'space', 'opacity'
    ]);

    const dataProps = new Set([
      'text', 'src', 'value', 'placeholder', 'options',
      'min', 'max', 'step', 'checked', 'selected',
      // 列表数据属性
      'noteNum',
      // 列表通用属性
      'autoAlign', 'inertia', 'loop', 'createBar', 'enableAreaDisplay', 'keepNoteAlive', 'offset', 'outScope',
      // 文本数据属性
      'fontFile', 'timeFormat',
      // 滚动文本属性
      'enableScroll', 'scrollDirection', 'scrollReverse', 'scrollStartOffset', 'scrollEndOffset', 'scrollInterval', 'scrollDuration',
      // 字体配置属性
      'fontType', 'renderMode', 'fontSize', 'characterSets',
      // hg_view 特有属性
      'residentMemory', 'animateStep',
      // 双态按钮属性
      'toggleMode', 'imageOn', 'imageOff', 'initialState', 'onCallback', 'offCallback',
      // hg_glass 特有属性
      'movable', 'click',
      // hg_canvas SVG 文件属性
      'svgFile',
      // hg_particle 粒子效果属性
      'particleEffect',
      // hg_image 图片属性
      'blendMode', 'fgColor', 'bgColor', 'highQuality', 'needClip', 'assetFormat',
      // 计时标签属性
      'isTimerLabel', 'timerType', 'timerFormat', 'timerInitialValue', 'timerAutoStart',
      // 定时器属性（新版）
      'timers',
      // 定时器属性（旧版，保留兼容）
      'timerEnabled', 'timerInterval', 'timerReload', 'timerMode', 'timerCallback', 
      'timerActions', 'timerDuration', 'timerStopOnComplete',
      // 蜂窝菜单属性
      'iconFolder', 'iconImages', 'iconSize', 'offsetX', 'offsetY', 'iconActions',
      // list 用户自定义 note_design 属性
      'useUserNoteDesign', 'userNoteDesignFunc',
      // hg_video 属性
      'autoPlay', 'frameRate',
    ]);

    const metaProps = new Set([
      'id', 'name', 'x', 'y', 'width', 'height',
      'visible', 'enabled', 'locked', 'zIndex', 'parent',
      'showOverflow'
    ]);

    Object.keys(attributes).forEach(key => {
      if (metaProps.has(key)) {
        return; // 跳过元属性
      }

      // 跳过组件类型属性（如 hg_button, hg_view 等），这些是冗余数据
      if (ComponentRegistry.isValidComponent(key)) {
        return;
      }

      if (dataProps.has(key)) {
        // dataProps 白名单优先（防止 onCallback 等被误判为事件）
        let value = attributes[key];
        // 根据共享组件定义做类型转换（boolean/number），不在定义中的属性保留字符串
        value = convertAttributeValue(tagName, key, value);

        // JSON 结构化数据反序列化（这些不是简单的标量类型转换）
        // characterSets 需要从 JSON 字符串解析为数组
        if (key === 'characterSets' && typeof value === 'string') {
          try { value = JSON.parse(value); } catch (e) { value = []; }
        }
        // timerActions 需要从 JSON 字符串解析为数组
        if (key === 'timerActions' && typeof value === 'string') {
          try { value = JSON.parse(value); } catch (e) { value = []; }
        }
        // timers 需要从 JSON 字符串解析为数组
        if (key === 'timers' && typeof value === 'string') {
          try { value = JSON.parse(value); } catch (e) { value = []; }
        }
        // iconImages 需要从 JSON 字符串解析为数组
        if (key === 'iconImages' && typeof value === 'string') {
          try { value = JSON.parse(value); } catch (e) { value = []; }
        }
        // iconActions 需要从 JSON 字符串解析为数组
        if (key === 'iconActions' && typeof value === 'string') {
          try { value = JSON.parse(value); } catch (e) { value = []; }
        }
        data[key] = value;
      } else if (key.startsWith('on')) {
        events[key] = attributes[key];
      } else if (styleProps.has(key)) {
        // 根据共享组件定义做类型转换（style 属性也可能是 boolean/number）
        let value = convertAttributeValue(tagName, key, attributes[key]);
        // 兼容：numericProps 中的属性如果不在共享定义中，仍然做数值转换
        if (numericProps.has(key) && typeof value === 'string') {
          const num = parseFloat(value);
          value = isNaN(num) ? value : num;
        }
        // transform 属性需要从 JSON 字符串解析为对象
        if (key === 'transform' && typeof value === 'string') {
          try {
            value = JSON.parse(value);
          } catch (e) {
            console.warn(`Failed to parse transform JSON: ${value}`);
          }
        }
        style[key] = value;
      } else {
        // 未知属性放入data
        let value = convertAttributeValue(tagName, key, attributes[key]);
        // gradientStops 需要从 JSON 字符串解析为数组
        if (key === 'gradientStops' && typeof value === 'string') {
          try {
            value = JSON.parse(value);
          } catch (e) {
            console.warn(`Failed to parse gradientStops JSON: ${value}`);
            value = [];
          }
        }
        // JSON 结构化数据反序列化

        // characterSets 需要从 JSON 字符串解析为数组
        if (key === 'characterSets' && typeof value === 'string') {
          try {
            value = JSON.parse(value);
          } catch (e) {
            console.warn(`Failed to parse characterSets JSON: ${value}`);
            value = [];
          }
        }
        // timerActions 需要从 JSON 字符串解析为数组
        if (key === 'timerActions' && typeof value === 'string') {
          try {
            value = JSON.parse(value);
          } catch (e) {
            console.warn(`Failed to parse timerActions JSON: ${value}`);
            value = [];
          }
        }
        data[key] = value;
      }
    });

    // 兼容旧版定时器格式：如果存在旧版字段但没有 timers 数组，自动转换
    if (!data.timers && data.timerEnabled === true) {
      const timerMode = data.timerMode || 'custom';
      const timerId = `timer_${Date.now()}`;
      
      data.timers = [{
        id: timerId,
        name: timerMode === 'preset' ? '预设动作定时器' : '自定义定时器',
        enabled: true,
        interval: data.timerInterval || 1000,
        reload: data.timerReload !== false,
        mode: timerMode,
        actions: data.timerActions || [],
        callback: data.timerCallback,
        duration: data.timerDuration || 1000,
        stopOnComplete: data.timerStopOnComplete !== false,
        delayStart: 0
      }];
      
      // 清除旧版字段
      delete data.timerEnabled;
      delete data.timerInterval;
      delete data.timerReload;
      delete data.timerMode;
      delete data.timerActions;
      delete data.timerCallback;
      delete data.timerDuration;
      delete data.timerStopOnComplete;
    }

    return { style, data, events };
  }

  /**
   * 解析子组件
   */
  private _parseChildren(
    element: any,
    componentMap: Map<string, Component>,
    parentId: string,
    parentComponent: Component
  ): void {
    let listItemIndex = 0; // 用于自动分配 list_item 的 index
    
    Object.keys(element).forEach(key => {
      if (key === '_attributes' || key === '_text' || key === 'events') {
        return;
      }

      if (!ComponentRegistry.isValidComponent(key)) {
        return;
      }

      const childElement = element[key];
      if (childElement && typeof childElement === 'object') {
        const children = Array.isArray(childElement) ? childElement : [childElement];
        children.forEach((child: any) => {
          const childComponent = this._parseComponent(key, child, componentMap, parentId);
          
          // 对于 hg_list 的 hg_list_item 子组件，如果没有 index 属性，自动分配
          if (parentComponent.type === 'hg_list' && childComponent.type === 'hg_list_item') {
            if (childComponent.data && childComponent.data.index === undefined) {
              childComponent.data.index = listItemIndex;
            }
            listItemIndex++;
          }
          
          parentComponent.children!.push(childComponent.id);
        });
      }
    });

    // 对于 hg_list 组件，按 y 坐标排序子组件（hg_list_item），并重新分配 index 和位置
    if (parentComponent.type === 'hg_list' && parentComponent.children && parentComponent.children.length > 0) {
      // 只处理 hg_list_item 类型的子组件
      const listItemComponents = parentComponent.children
        .map(childId => componentMap.get(childId))
        .filter(child => child !== undefined && child.type === 'hg_list_item') as Component[];
      
      if (listItemComponents.length > 0) {
        // 按 y 坐标排序（对于垂直列表）或 x 坐标排序（对于水平列表）
        const direction = parentComponent.style?.direction || parentComponent.data?.direction || 'VERTICAL';
        const isVertical = direction === 'VERTICAL';
        
        listItemComponents.sort((a, b) => {
          if (isVertical) {
            return a.position.y - b.position.y;
          } else {
            return a.position.x - b.position.x;
          }
        });
        
        // 获取 list 的布局属性
        const itemWidth = parseInt(parentComponent.style?.itemWidth) || 100;
        const itemHeight = parseInt(parentComponent.style?.itemHeight) || 100;
        const space = parseInt(parentComponent.style?.space) || 0;
        
        // 重新分配 index 和位置（按排序后的顺序）
        listItemComponents.forEach((child, idx) => {
          // 更新 index
          if (child.data) {
            child.data.index = idx;
          } else {
            child.data = { index: idx };
          }
          
          // 根据 direction、itemWidth、itemHeight、space 计算正确的位置
          if (isVertical) {
            child.position.x = 0;
            child.position.y = idx * (itemHeight + space);
            child.position.width = itemWidth;
            child.position.height = itemHeight;
          } else {
            child.position.x = idx * (itemWidth + space);
            child.position.y = 0;
            child.position.width = itemWidth;
            child.position.height = itemHeight;
          }
        });
        
        // 重新排列 children 数组：先放排序后的 list_item，再放其他子组件
        const otherChildren = parentComponent.children.filter(childId => {
          const child = componentMap.get(childId);
          return child && child.type !== 'hg_list_item';
        });
        parentComponent.children = [...listItemComponents.map(c => c.id), ...otherChildren];
      }
    }
  }

  /**
   * 解析事件配置 (Event-Action)
   */
  private _parseEventConfigs(element: any): EventConfig[] | undefined {
    // 支持两种格式：events.event 和 eventConfigs.eventConfig
    const eventsSource = element.events?.event || element.eventConfigs?.eventConfig;
    
    if (!eventsSource) {
      return undefined;
    }

    const eventElements = Array.isArray(eventsSource)
      ? eventsSource
      : [eventsSource];

    const eventConfigs: EventConfig[] = [];

    eventElements.forEach((eventEl: any) => {
      const attrs = eventEl._attributes || eventEl;
      const eventType = attrs.type as EventType;
      
      if (!eventType) return;

      const eventConfig: EventConfig = {
        type: eventType,
        actions: [],
      };

      // onMessage 需要 message 属性
      if (eventType === 'onMessage' && attrs.message) {
        eventConfig.message = attrs.message;
      }

      // 解析 handler 属性（回调函数名）
      if (attrs.handler) {
        eventConfig.handler = attrs.handler;
      }

      // 解析 checkReleaseArea 属性（抬起区域检测）
      if (eventType === 'onTouchUp' && attrs.checkReleaseArea === 'true') {
        eventConfig.checkReleaseArea = true;
      }

      // 解析 keyName 属性（按键事件专用）
      if ((eventType === 'onKeyShortPress' || eventType === 'onKeyLongPress') && attrs.keyName) {
        eventConfig.keyName = attrs.keyName;
      }

      // 解析动作
      if (eventEl.action) {
        const actionElements = Array.isArray(eventEl.action)
          ? eventEl.action
          : [eventEl.action];

        actionElements.forEach((actionEl: any) => {
          const actionAttrs = actionEl._attributes || actionEl;
          const action: Action = {
            type: actionAttrs.type as ActionType,
          };

          // 根据动作类型解析参数
          if (actionAttrs.target) action.target = actionAttrs.target;
          if (actionAttrs.message) action.message = actionAttrs.message;
          if (actionAttrs.functionName) action.functionName = actionAttrs.functionName;
          if (actionAttrs.switchOutStyle) action.switchOutStyle = actionAttrs.switchOutStyle;
          if (actionAttrs.switchInStyle) action.switchInStyle = actionAttrs.switchInStyle;
          
          // 解析 controlTimer 的 timerTargets
          if (actionAttrs.timerTargets && typeof actionAttrs.timerTargets === 'string') {
            try {
              action.timerTargets = JSON.parse(actionAttrs.timerTargets);
            } catch (e) {
              console.warn(`Failed to parse timerTargets JSON: ${actionAttrs.timerTargets}`);
            }
          }

          eventConfig.actions.push(action);
        });
      }

      eventConfigs.push(eventConfig);
    });

    return eventConfigs.length > 0 ? eventConfigs : undefined;
  }

  /**
   * 生成唯一ID
   */
  private _generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${this.idCounter++}`;
  }

  /**
   * 加载 Canvas 组件的 SVG 文件内容
   * @param data 组件的 data 对象
   */
  private _loadCanvasSvgContent(data: Record<string, any>): void {
    if (!data.svgFile || !this.currentHmlPath) return;

    try {
      const fs = require('fs');
      const path = require('path');
      const hmlDir = path.dirname(this.currentHmlPath);
      const svgFilePath = path.join(hmlDir, data.svgFile);

      if (fs.existsSync(svgFilePath)) {
        data.svgContent = fs.readFileSync(svgFilePath, 'utf8');
        logger.debug(`[HmlParser] 加载 SVG 文件: ${svgFilePath}`);
      } else {
        logger.warn(`[HmlParser] SVG 文件不存在: ${svgFilePath}`);
      }
    } catch (error) {
      logger.error(`[HmlParser] 加载 SVG 文件失败: ${error}`);
    }
  }
}

// 导出组件注册表供外部使用
export { ComponentRegistry };
