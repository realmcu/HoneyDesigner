/**
 * 组件属性类型映射表（共享层）
 * 
 * 这是组件属性类型的唯一真相来源（Single Source of Truth）。
 * HmlParser 根据此映射在解析 XML 时将字符串属性值转换为正确的 JS 类型。
 * 
 * 规则：
 * - 'boolean': "true"/"false" → true/false
 * - 'number':  "123" → 123
 * - 其他类型（string/color/select 等）: 保留原始字符串
 * 
 * 新增组件或属性时，只需在此文件中添加对应条目，解析器和消费方自动生效。
 */

export type PropertyType = 'string' | 'number' | 'boolean' | 'color' | 'select';

/**
 * 属性类型映射：componentType → { propertyName → propertyType }
 * 
 * 只需要记录 boolean 和 number 类型的属性。
 * 不在此映射中的属性默认保留为字符串（XML 的原始类型）。
 */
const COMPONENT_PROPERTY_TYPES: Record<string, Record<string, PropertyType>> = {
  // ─── 基础控件 ───
  hg_button: {
    toggleMode: 'boolean',
  },
  hg_label: {
    wordWrap: 'boolean',
    wordBreak: 'boolean',
    scrollReverse: 'boolean',
    enableScroll: 'boolean',
    scrollPreview: 'boolean',
    isTimerLabel: 'boolean',
    timerAutoStart: 'boolean',
    scrollStartOffset: 'number',
    scrollEndOffset: 'number',
    scrollInterval: 'number',
    scrollDuration: 'number',
    letterSpacing: 'number',
    lineSpacing: 'number',
    fontSize: 'number',
  },
  hg_time_label: {
    wordWrap: 'boolean',
    letterSpacing: 'number',
    lineSpacing: 'number',
    fontSize: 'number',
  },
  hg_timer_label: {
    timerAutoStart: 'boolean',
    wordWrap: 'boolean',
    timerInitialValue: 'number',
    letterSpacing: 'number',
    lineSpacing: 'number',
    fontSize: 'number',
  },
  hg_image: {
    highQuality: 'boolean',
    needClip: 'boolean',
    opacity: 'number',
  },
  hg_gif: {
    highQuality: 'boolean',
  },

  // ─── 输入控件 ───
  hg_checkbox: {
    value: 'boolean',
    checked: 'boolean',
    fontSize: 'number',
  },
  hg_radio: {
    value: 'boolean',
    checked: 'boolean',
    fontSize: 'number',
  },
  hg_switch: {
    value: 'boolean',
    checked: 'boolean',
  },
  hg_slider: {
    value: 'number',
    min: 'number',
    max: 'number',
  },

  // ─── 容器 ───
  hg_view: {
    entry: 'boolean',
    borderRadius: 'number',
    padding: 'number',
  },
  hg_window: {
    showBackground: 'boolean',
    enableBlur: 'boolean',
    blurDegree: 'number',
  },
  hg_canvas: {
    borderRadius: 'number',
  },

  // ─── 列表 ───
  hg_list: {
    autoAlign: 'boolean',
    inertia: 'boolean',
    loop: 'boolean',
    createBar: 'boolean',
    enableAreaDisplay: 'boolean',
    keepNoteAlive: 'boolean',
    useUserNoteDesign: 'boolean',
    noteNum: 'number',
    offset: 'number',
    outScope: 'number',
    itemWidth: 'number',
    itemHeight: 'number',
    space: 'number',
    cardStackLocation: 'number',
    circleRadius: 'number',
  },

  // ─── 图形控件 ───
  hg_arc: {
    useGradient: 'boolean',
    radius: 'number',
    startAngle: 'number',
    endAngle: 'number',
    strokeWidth: 'number',
    opacity: 'number',
  },
  hg_circle: {
    useGradient: 'boolean',
    opacity: 'number',
    radius: 'number',
    buttonPressedOpacity: 'number',
    buttonReleasedOpacity: 'number',
  },
  hg_rect: {
    useGradient: 'boolean',
    borderRadius: 'number',
    opacity: 'number',
    buttonPressedOpacity: 'number',
    buttonReleasedOpacity: 'number',
  },

  // ─── 多媒体 ───
  hg_video: {
    autoPlay: 'boolean',
    loop: 'boolean',
    frameRate: 'number',
  },
  hg_lottie: {
    autoplay: 'boolean',
    loop: 'boolean',
  },
  hg_glass: {
    movable: 'boolean',
    click: 'boolean',
    distortion: 'number',
    region: 'number',
  },

  // ─── 3D ───
  hg_3d: {
    worldX: 'number', worldY: 'number', worldZ: 'number',
    rotationX: 'number', rotationY: 'number', rotationZ: 'number',
    scale: 'number',
    cameraPosX: 'number', cameraPosY: 'number', cameraPosZ: 'number',
    cameraLookX: 'number', cameraLookY: 'number', cameraLookZ: 'number',
    touchRotationEnabled: 'boolean',
    autoRotationEnabled: 'boolean',
  },

  // ─── 蜂窝菜单 ───
  hg_menu_cellular: {
    iconSize: 'number',
    offsetX: 'number',
    offsetY: 'number',
  },
};

/**
 * 查询指定组件的指定属性的类型。
 * 返回 undefined 表示该属性不在定义中，应保留为字符串。
 */
export function getPropertyType(componentType: string, propertyName: string): PropertyType | undefined {
  return COMPONENT_PROPERTY_TYPES[componentType]?.[propertyName];
}

/**
 * 根据组件类型和属性名，将 XML 字符串值转换为正确的 JS 类型。
 * - boolean 属性: "true" → true, 其他 → false
 * - number 属性: "123" → 123, 无效值保留字符串
 * - 其他: 保留原始字符串
 */
export function convertAttributeValue(componentType: string, propertyName: string, value: any): any {
  // 已经不是字符串（比如 fast-xml-parser 自动转换的），直接返回
  if (typeof value !== 'string') {
    return value;
  }

  const propType = getPropertyType(componentType, propertyName);
  if (!propType) {
    return value; // 不在定义中，保留字符串
  }

  switch (propType) {
    case 'boolean':
      return value === 'true';
    case 'number': {
      const num = parseFloat(value);
      return isNaN(num) ? value : num;
    }
    default:
      return value;
  }
}
