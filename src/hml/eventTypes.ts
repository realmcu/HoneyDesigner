/**
 * Event-Action 系统类型定义
 */

// ============ 事件类型 ============

export type EventType =
  // 通用事件
  | 'onClick'
  | 'onLongPress'
  | 'onTouchDown'
  | 'onTouchUp'
  | 'onKeyShortPress'
  | 'onKeyLongPress'
  // 滑动事件
  | 'onSwipeLeft'
  | 'onSwipeRight'
  | 'onSwipeUp'
  | 'onSwipeDown'
  // 状态事件
  | 'onValueChange'
  | 'onCheckedChange'
  // 生命周期事件
  | 'onShow'
  | 'onHide'
  // 消息事件
  | 'onMessage';

// ============ 动作类型 ============

export type ActionType =
  // 视图切换(跳转界面，带动画)
  | 'switchView'
  // 消息
  | 'sendMessage'
  // 自定义
  | 'callFunction'
  // 控制动画定时器
  | 'controlTimer';

// ============ 动作定义 ============

export interface Action {
  type: ActionType;
  target?: string;           // 目标视图ID (switchView用)
  message?: string;          // 消息名(sendMessage用)
  functionName?: string;     // 函数名(callFunction用)
  // switchView专用
  switchOutStyle?: string;   // 退出动画
  switchInStyle?: string;    // 进入动画
  // controlTimer专用
  timerTargets?: Array<{     // 目标组件列表
    componentId: string;     // 组件ID
    timerIndex?: number;     // 定时器索引（如果有多个定时器）
    action: 'start' | 'stop'; // 每个定时器的动作
  }>;
}

// ============ 事件配置 ============

export interface EventConfig {
  type: EventType;
  message?: string;          // 仅 onMessage 事件需要
  handler?: string;          // 回调函数名（onMessage 用）
  actions: Action[];
  checkReleaseArea?: boolean; // 抬起区域检测（仅 onTouchUp 事件）
  keyName?: string;          // 按键名（仅 onKeyShortPress 和 onKeyLongPress 事件需要）
}

// ============ 组件支持的事件映射 ============

export const COMPONENT_SUPPORTED_EVENTS: Record<string, EventType[]> = {
  hg_view: ['onClick', 'onLongPress', 'onTouchDown', 'onTouchUp', 'onKeyShortPress', 'onKeyLongPress', 'onSwipeLeft', 'onSwipeRight', 'onSwipeUp', 'onSwipeDown', 'onShow', 'onHide', 'onMessage'],
  hg_window: ['onClick', 'onLongPress', 'onTouchDown', 'onTouchUp', 'onKeyShortPress', 'onKeyLongPress', 'onMessage'],
  hg_button: ['onClick', 'onLongPress', 'onTouchDown', 'onTouchUp', 'onKeyShortPress', 'onKeyLongPress', 'onMessage'],
  hg_image: ['onClick', 'onLongPress', 'onTouchDown', 'onTouchUp', 'onKeyShortPress', 'onKeyLongPress', 'onMessage'],
  hg_label: ['onClick', 'onLongPress', 'onKeyShortPress', 'onKeyLongPress', 'onMessage'],
  hg_switch: ['onClick', 'onCheckedChange', 'onKeyShortPress', 'onKeyLongPress', 'onMessage'],
  hg_checkbox: ['onClick', 'onCheckedChange', 'onKeyShortPress', 'onKeyLongPress', 'onMessage'],
  hg_radio: ['onClick', 'onCheckedChange', 'onKeyShortPress', 'onKeyLongPress', 'onMessage'],
  hg_slider: ['onClick', 'onValueChange', 'onKeyShortPress', 'onKeyLongPress', 'onMessage'],
  hg_progressbar: ['onClick', 'onValueChange', 'onKeyShortPress', 'onKeyLongPress', 'onMessage'],
  hg_input: ['onClick', 'onValueChange', 'onKeyShortPress', 'onKeyLongPress', 'onMessage'],
  hg_canvas: ['onClick', 'onLongPress', 'onKeyShortPress', 'onKeyLongPress', 'onMessage'],
  hg_list: ['onClick', 'onLongPress', 'onSwipeLeft', 'onSwipeRight', 'onSwipeUp', 'onSwipeDown', 'onKeyShortPress', 'onKeyLongPress', 'onMessage'],
  hg_arc: ['onClick', 'onLongPress', 'onKeyShortPress', 'onKeyLongPress', 'onMessage'],
  hg_rect: ['onClick', 'onLongPress', 'onKeyShortPress', 'onKeyLongPress', 'onMessage'],
  hg_svg: ['onClick', 'onLongPress', 'onKeyShortPress', 'onKeyLongPress', 'onMessage'],
  hg_lottie: ['onClick', 'onLongPress', 'onKeyShortPress', 'onKeyLongPress', 'onMessage'],
  hg_video: ['onClick', 'onLongPress', 'onKeyShortPress', 'onKeyLongPress', 'onMessage'],
  hg_3d: ['onClick', 'onLongPress', 'onKeyShortPress', 'onKeyLongPress', 'onMessage'],
  hg_menu_cellular: ['onClick', 'onLongPress', 'onKeyShortPress', 'onKeyLongPress', 'onMessage'],
  hg_qbcode: ['onClick', 'onLongPress', 'onKeyShortPress', 'onKeyLongPress', 'onMessage'],
};

// 默认支持的事件(未在映射中的组件)
export const DEFAULT_SUPPORTED_EVENTS: EventType[] = ['onClick', 'onLongPress', 'onKeyShortPress', 'onKeyLongPress', 'onMessage'];

// ============ 事件显示名称（i18n 键） ============

export const EVENT_LABEL_KEYS: Record<EventType, string> = {
  onClick: 'event.onClick',
  onLongPress: 'event.onLongPress',
  onTouchDown: 'event.onTouchDown',
  onTouchUp: 'event.onTouchUp',
  onKeyShortPress: 'event.onKeyShortPress',
  onKeyLongPress: 'event.onKeyLongPress',
  onSwipeLeft: 'event.onSwipeLeft',
  onSwipeRight: 'event.onSwipeRight',
  onSwipeUp: 'event.onSwipeUp',
  onSwipeDown: 'event.onSwipeDown',
  onValueChange: 'event.onValueChange',
  onCheckedChange: 'event.onCheckedChange',
  onShow: 'event.onShow',
  onHide: 'event.onHide',
  onMessage: 'event.onMessage',
};

// ============ 动作显示名称（i18n 键） ============

export const ACTION_LABEL_KEYS: Record<ActionType, string> = {
  switchView: 'action.switchView',
  sendMessage: 'action.sendMessage',
  callFunction: 'action.callFunction',
  controlTimer: 'action.controlTimer',
};

// ============ 视图切换动画选项 ============

// 按键名选项（保持英文，这些是硬件按键的标准名称）
export const KEY_NAMES = [
  { value: 'Home', label: 'Home' },
  { value: 'Back', label: 'Back' },
  { value: 'Menu', label: 'Menu' },
  { value: 'Power', label: 'Power' },
];

// 动画类型的翻译键映射
const ANIMATION_LABEL_KEYS: Record<string, string> = {
  'SWITCH_INIT_STATE': 'Out: Still (Initial State)',
  'SWITCH_OUT_NONE_ANIMATION': 'Out: No Animation',
  'SWITCH_OUT_TO_LEFT_USE_TRANSLATION': 'Slide Left',
  'SWITCH_OUT_TO_RIGHT_USE_TRANSLATION': 'Slide Right',
  'SWITCH_OUT_TO_TOP_USE_TRANSLATION': 'Slide Up',
  'SWITCH_OUT_TO_BOTTOM_USE_TRANSLATION': 'Slide Down',
  'SWITCH_OUT_TO_LEFT_USE_CUBE': 'Cube Left',
  'SWITCH_OUT_TO_RIGHT_USE_CUBE': 'Cube Right',
  'SWITCH_OUT_TO_TOP_USE_CUBE': 'Cube Up',
  'SWITCH_OUT_TO_BOTTOM_USE_CUBE': 'Cube Down',
  'SWITCH_OUT_TO_LEFT_USE_ROTATE': 'Rotate Left',
  'SWITCH_OUT_TO_RIGHT_USE_ROTATE': 'Rotate Right',
  'SWITCH_OUT_TO_TOP_USE_ROTATE': 'Rotate Up',
  'SWITCH_OUT_TO_BOTTOM_USE_ROTATE': 'Rotate Down',
  'SWITCH_OUT_TO_LEFT_USE_REDUCTION': 'Reduce Left',
  'SWITCH_OUT_TO_RIGHT_USE_REDUCTION': 'Reduce Right',
  'SWITCH_OUT_TO_TOP_USE_REDUCTION': 'Reduce Up',
  'SWITCH_OUT_TO_BOTTOM_USE_REDUCTION': 'Reduce Down',
  'SWITCH_OUT_STILL_USE_BLUR': 'Blur (Still)',
  'SWITCH_OUT_ANIMATION_FADE': 'Out: Fade Out',
};

// 导出静态选项（用于 Webview，使用翻译键）
export const SWITCH_OUT_STYLES = [
  { value: 'SWITCH_INIT_STATE', labelKey: 'Out: Still (Initial State)' },
  { value: 'SWITCH_OUT_TO_LEFT_USE_TRANSLATION', labelKey: 'Slide Left' },
  { value: 'SWITCH_OUT_TO_RIGHT_USE_TRANSLATION', labelKey: 'Slide Right' },
  { value: 'SWITCH_OUT_TO_TOP_USE_TRANSLATION', labelKey: 'Slide Up' },
  { value: 'SWITCH_OUT_TO_BOTTOM_USE_TRANSLATION', labelKey: 'Slide Down' },
  { value: 'SWITCH_OUT_TO_LEFT_USE_CUBE', labelKey: 'Cube Left' },
  { value: 'SWITCH_OUT_TO_RIGHT_USE_CUBE', labelKey: 'Cube Right' },
  { value: 'SWITCH_OUT_TO_TOP_USE_CUBE', labelKey: 'Cube Up' },
  { value: 'SWITCH_OUT_TO_BOTTOM_USE_CUBE', labelKey: 'Cube Down' },
  { value: 'SWITCH_OUT_TO_LEFT_USE_ROTATE', labelKey: 'Rotate Left' },
  { value: 'SWITCH_OUT_TO_RIGHT_USE_ROTATE', labelKey: 'Rotate Right' },
  { value: 'SWITCH_OUT_TO_TOP_USE_ROTATE', labelKey: 'Rotate Up' },
  { value: 'SWITCH_OUT_TO_BOTTOM_USE_ROTATE', labelKey: 'Rotate Down' },
  { value: 'SWITCH_OUT_TO_LEFT_USE_REDUCTION', labelKey: 'Reduce Left' },
  { value: 'SWITCH_OUT_TO_RIGHT_USE_REDUCTION', labelKey: 'Reduce Right' },
  { value: 'SWITCH_OUT_TO_TOP_USE_REDUCTION', labelKey: 'Reduce Up' },
  { value: 'SWITCH_OUT_TO_BOTTOM_USE_REDUCTION', labelKey: 'Reduce Down' },
  { value: 'SWITCH_OUT_STILL_USE_BLUR', labelKey: 'Blur (Still)' },
  { value: 'SWITCH_OUT_ANIMATION_FADE', labelKey: 'Out: Fade Out' },
];

export const SWITCH_IN_STYLES = [
  { value: 'SWITCH_INIT_STATE', labelKey: 'No Animation (Initial)' },
  { value: 'SWITCH_IN_FROM_LEFT_USE_TRANSLATION', labelKey: 'Slide Left' },
  { value: 'SWITCH_IN_FROM_RIGHT_USE_TRANSLATION', labelKey: 'Slide Right' },
  { value: 'SWITCH_IN_FROM_TOP_USE_TRANSLATION', labelKey: 'Slide Up' },
  { value: 'SWITCH_IN_FROM_BOTTOM_USE_TRANSLATION', labelKey: 'Slide Down' },
  { value: 'SWITCH_IN_FROM_LEFT_USE_CUBE', labelKey: 'Cube Left' },
  { value: 'SWITCH_IN_FROM_RIGHT_USE_CUBE', labelKey: 'Cube Right' },
  { value: 'SWITCH_IN_FROM_TOP_USE_CUBE', labelKey: 'Cube Up' },
  { value: 'SWITCH_IN_FROM_BOTTOM_USE_CUBE', labelKey: 'Cube Down' },
  { value: 'SWITCH_IN_FROM_LEFT_USE_ROTATE', labelKey: 'Rotate Left' },
  { value: 'SWITCH_IN_FROM_RIGHT_USE_ROTATE', labelKey: 'Rotate Right' },
  { value: 'SWITCH_IN_FROM_TOP_USE_ROTATE', labelKey: 'Rotate Up' },
  { value: 'SWITCH_IN_FROM_BOTTOM_USE_ROTATE', labelKey: 'Rotate Down' },
  { value: 'SWITCH_IN_FROM_LEFT_USE_REDUCTION', labelKey: 'Reduce Left' },
  { value: 'SWITCH_IN_FROM_RIGHT_USE_REDUCTION', labelKey: 'Reduce Right' },
  { value: 'SWITCH_IN_FROM_TOP_USE_REDUCTION', labelKey: 'Reduce Up' },
  { value: 'SWITCH_IN_FROM_BOTTOM_USE_REDUCTION', labelKey: 'Reduce Down' },
  { value: 'SWITCH_IN_STILL_USE_BLUR', labelKey: 'Blur (Still)' },
  { value: 'SWITCH_IN_NONE_ANIMATION', labelKey: 'Anim: No Animation' },
  { value: 'SWITCH_IN_ANIMATION_ZOOM', labelKey: 'Anim: Zoom' },
  { value: 'SWITCH_IN_ANIMATION_FADE', labelKey: 'Anim: Fade In' },
  { value: 'SWITCH_IN_ANIMATION_MOVE_FADE', labelKey: 'Anim: Move Fade' },
  { value: 'SWITCH_IN_ANIMATION_MOVE_FROM_RIGHT', labelKey: 'Anim: Move From Right' },
  { value: 'SWITCH_IN_ANIMATION_MOVE_FROM_LEFT', labelKey: 'Anim: Move From Left' },
  { value: 'SWITCH_IN_ANIMATION_BOUNCE_FROM_RIGHT', labelKey: 'Anim: Bounce From Right' },
  { value: 'SWITCH_IN_ANIMATION_ZOOM_FROM_TOP_LEFT', labelKey: 'Anim: Zoom From Top Left' },
  { value: 'SWITCH_IN_ANIMATION_ZOOM_FROM_TOP_RIGHT', labelKey: 'Anim: Zoom From Top Right' },
  { value: 'SWITCH_IN_CENTER_ZOOM_FADE', labelKey: 'Anim: Center Zoom Fade' },
];

// ============ 辅助函数 ============

export function getSupportedEvents(componentType: string): EventType[] {
  return COMPONENT_SUPPORTED_EVENTS[componentType] || DEFAULT_SUPPORTED_EVENTS;
}
