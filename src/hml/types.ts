/**
 * HML组件类型定义
 * 统一格式：与前端保持一致的格式
 */

/**
 * 组件位置类型
 */
export interface ComponentPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 图像变换类型
 */
export interface ImageTransform {
  // 缩放
  scaleX?: number;      // 默认 1.0
  scaleY?: number;      // 默认 1.0
  
  // 旋转
  rotation?: number;    // 角度，默认 0
  
  // 平移
  translateX?: number;  // 默认 0
  translateY?: number;  // 默认 0
  
  // 倾斜
  skewX?: number;       // 角度，默认 0
  skewY?: number;       // 角度，默认 0
  
  // 变换中心点
  // 注意：SDK 默认行为不一致
  // - 旋转默认围绕图片中心
  // - 缩放默认以 (0,0) 为中心
  // 设置 focusX/focusY 可统一变换中心
  focusX?: number;      // 默认：旋转用图片中心，缩放用左上角
  focusY?: number;      // 默认：旋转用图片中心，缩放用左上角
  
  // 透明度
  opacity?: number;     // 0-255，默认 255
}

/**
 * 组件样式类型
 */
export interface ComponentStyle {
  color?: string;
  backgroundColor?: string;
  fontSize?: number;
  fontWeight?: string;
  border?: string;
  borderRadius?: number;
  padding?: number;
  margin?: number;
  overflow?: string;
  title?: string;
  titleBarHeight?: number;
  titleBarColor?: string;
  
  // 图像变换（用于 hg_image 组件）
  transform?: ImageTransform;
  
  [key: string]: any;  // 允许其他样式属性
}

/**
 * 定时动画动作类型
 */
export interface TimerAction {
  type: 'size' | 'position' | 'opacity' | 'rotation' | 'scale' | 'value' | 'switchView' | 'changeImage' | 'imageSequence' | 'visibility' | 'switchTimer' | 'setFocus' | 'fgColor' | 'bgColor';
  // 大小动作
  fromW?: number;
  fromH?: number;
  toW?: number;
  toH?: number;
  // 位置动作
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
  // 透明度动作
  from?: number;
  to?: number;
  // 旋转动作（仅 hg_image）
  angleOrigin?: number;
  angleTarget?: number;
  // 缩放动作（仅 hg_image）
  zoomXOrigin?: number;
  zoomXTarget?: number;
  zoomYOrigin?: number;
  zoomYTarget?: number;
  // 跳转界面动作
  target?: string;           // 目标视图ID
  switchOutStyle?: string;   // 退出动画
  switchInStyle?: string;    // 进入动画
  // 更换图片动作（仅 hg_image）
  imagePath?: string;        // 图片路径
  // 图片序列动作（仅 hg_image）
  imageSequence?: string[];  // 图片路径数组
  // 可见性动作
  visible?: boolean;         // 是否可见（true=显示，false=隐藏）
  // 切换定时动画动作（新版：支持多个定时器控制）
  timerTargets?: Array<{     // 目标定时器列表
    timerId: string;         // 定时器ID
    action: 'start' | 'stop'; // 动作：启动或停止
  }>;
  // 切换定时动画动作（旧版：保留兼容）
  timerId?: string;          // 要切换到的定时动画ID（已废弃，使用 timerTargets）
  // 前景色动作（仅 hg_image）
  fgColorFrom?: string;      // 初始前景色（0xFFRRGGBB 格式，可选）
  fgColorTo?: string;        // 目标前景色（0xFFRRGGBB 格式）
  // 背景色动作（仅 hg_image）
  bgColorFrom?: string;      // 初始背景色（0xFFRRGGBB 格式，可选）
  bgColorTo?: string;        // 目标背景色（0xFFRRGGBB 格式）
  // 数值动作（hg_progressbar / hg_slider，仅 LVGL）
  fromValue?: number;        // 起始值
  toValue?: number;          // 目标值
}

/**
 * 动画段配置（支持多段动画）
 */
export interface AnimationSegment {
  duration: number;  // 这段动画的持续时间（毫秒）
  actions: TimerAction[];  // 这段动画的动作列表（可以为空，表示等待）
}

/**
 * 定时动画配置类型
 */
export interface TimerConfig {
  id: string;  // 动画唯一标识
  name?: string;  // 动画名称（用于注释）
  enabled: boolean;  // 是否在创建组件时绑定到组件（只有一个可以为 true）
  runImmediately?: boolean;  // 是否立即运行（不等待 interval，当前帧立即执行）
  interval: number;  // 动画间隔（毫秒）
  reload: boolean;  // 是否重复执行
  mode: 'preset' | 'custom';  // 动画模式：预设动作或自定义函数
  actions?: TimerAction[];  // 预设动作列表（旧版兼容，单段动画）
  segments?: AnimationSegment[];  // 多段动画列表（新版）
  segmentsBackup?: AnimationSegment[];  // 预设动作备份（切换到自定义模式时保存，方便切回来）
  callback?: string;  // 自定义回调函数名
  duration?: number;  // 总时间（毫秒）（旧版兼容）
  stopOnComplete?: boolean;  // 到达总时间后是否停止动画
  delayStart?: number;  // 延时启动时间（毫秒），默认 0（已废弃，用 segments 的第一段空动作替代）
  enableLog?: boolean;  // 是否启用调试日志（打印函数名和 cnt 值）
}

/**
 * 组件数据类型
 */
export interface ComponentData {
  text?: string;
  src?: string;
  value?: string | number | boolean;
  placeholder?: string;
  options?: string[];
  timeFormat?: string;  // 时间格式（用于 label 组件自动更新时间）
  residentMemory?: boolean | string;  // 常驻内存属性（用于 hg_view 组件），支持 boolean 或 string "true"/"false"
  animateStep?: number;  // 动画步长（用于 hg_view 组件）
  opacity?: number;  // 透明度 0-255（用于 hg_view 组件）
  
  // 计时标签配置（用于 label 组件的计时器功能）
  isTimerLabel?: boolean;  // 是否为计时标签
  timerType?: 'stopwatch' | 'countdown';  // 计时器类型：正计时或倒计时
  timerFormat?: 'HH:MM:SS' | 'MM:SS' | 'MM:SS:MS' | 'SS';  // 计时器显示格式
  timerInitialValue?: number;  // 计时器初始值（毫秒）
  timerAutoStart?: boolean;  // 是否自动启动（默认 true）
  
  // 定时器配置（新版：支持多个定时器）
  timers?: TimerConfig[];  // 定时器列表
  
  // 定时器配置（旧版：保留兼容，将在加载时转换为新版）
  timerEnabled?: boolean;  // 是否启用定时器
  timerInterval?: number;  // 定时器间隔（毫秒）
  timerReload?: boolean;  // 是否重复执行
  timerMode?: 'preset' | 'custom';  // 定时器模式：预设动作或自定义函数
  timerActions?: TimerAction[];  // 预设动作列表
  timerCallback?: string;  // 自定义回调函数名
  timerDuration?: number;  // 总时间（毫秒）
  timerStopOnComplete?: boolean;  // 到达总时间后是否停止定时器
  
  [key: string]: any;  // 允许其他数据属性
}

/**
 * 事件处理器类型（旧版，保留兼容）
 */
export interface ComponentEvents {
  [eventName: string]: string;
}

// 导入 Event-Action 类型
export type { EventConfig, Action, EventType, ActionType } from './eventTypes';

/**
 * 组件类型 - 统一格式（与前端一致）
 */
export interface Component {
  id: string;
  type: string;
  name: string;
  position: ComponentPosition;
  style?: ComponentStyle;
  data?: ComponentData;
  events?: ComponentEvents;
  eventConfigs?: import('./eventTypes').EventConfig[]; // Event-Action 配置
  children?: string[];  // ID引用，避免循环引用
  parent?: string | null;
  visible: boolean;
  enabled: boolean;
  locked: boolean;
  showOverflow?: boolean;  // 在设计器中显示溢出内容
  zIndex: number;
}

/**
 * 元数据类型
 */
export interface Meta {
  title?: string;
  description?: string;
  project?: {
    name?: string;
    appId?: string;
    resolution?: string;
    minSdk?: string;
    pixelMode?: string;
    [key: string]: any;
  };
  author?: {
    name?: string;
    email?: string;
    [key: string]: any;
  };
}

/**
 * 视图类型
 */
export interface View {
  id?: string;
  components?: Component[];
}

/**
 * 文档类型
 */
export interface Document {
  meta: Meta;
  view: View;
}
