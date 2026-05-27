/**
 * HoneyGUI Designer React Types
 * 定义所有组件的类型和接口
 */

import type {
  Component as HmlComponent,
  ComponentPosition as HmlComponentPosition,
  ComponentStyle as HmlComponentStyle,
  ComponentData as HmlComponentData
} from '../hml/types';

export type ComponentPosition = HmlComponentPosition;
export type ComponentStyle = HmlComponentStyle;
export type ComponentData = HmlComponentData;

export type Component = Omit<HmlComponent, 'type'> & { type: ComponentType };

export type ComponentType =
  | 'hg_button'
  | 'hg_label'
  | 'hg_time_label'
  | 'hg_timer_label'
  | 'hg_input'
  | 'hg_textarea'
  | 'hg_checkbox'
  | 'hg_radio'
  | 'hg_switch'
  | 'hg_slider'
  | 'hg_progressbar'
  | 'hg_image'
  | 'hg_gif'
  | 'hg_view'
  | 'hg_window'
  | 'hg_canvas'
  | 'hg_list'
  | 'hg_list_item'
  | 'hg_video'
  | 'hg_3d'
  | 'hg_arc'
  | 'hg_circle'
  | 'hg_rect'
  | 'hg_svg'
  | 'hg_lottie'
  | 'hg_glass'
  | 'hg_particle'
  | 'hg_map'
  | 'hg_openclaw'
  | 'hg_claw_face'
  | 'hg_menu_cellular'
  | 'hg_qbcode';

export type EngineSupport = 'ready' | 'planned' | 'unsupported';

export interface ComponentDefinition {
  type: ComponentType;
  name: string;
  icon: string;
  defaultSize: { width: number; height: number };
  properties: PropertyDefinition[];
  /**
   * Per-engine support status.
   * - 'ready': fully supported, normal display
   * - 'planned': planned but not yet implemented, greyed out with TODO badge
   * - 'unsupported': not supported, hidden from component library
   *
   * If omitted, defaults to 'ready' for all engines.
   */
  engineSupport?: Partial<Record<string, EngineSupport>>;
}

export interface PropertyDefinition {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'color' | 'select' | 'options';
  defaultValue?: any;
  options?: string[] | any[];
  group: 'general' | 'style' | 'data' | 'events' | 'font' | 'interaction' | 'scroll' | 'timer' | 'time';
  min?: number;  // 数字类型的最小值
  max?: number;  // 数字类型的最大值
  hint?: string;  // 提示信息，显示在输入框下方
}

// 视图跳转边信息
export interface ViewEdgeInfo {
  target: string;        // 目标 view id
  event: string;         // 事件类型 (onSwipeLeft 等)
  switchOutStyle?: string;
  switchInStyle?: string;
}

// 项目中的视图信息（包含跳转关系）
export interface ViewInfo {
  id: string;
  name: string;
  file: string;          // 所属设计目录名
  edges: ViewEdgeInfo[]; // 该视图的所有跳转
}

export interface DesignerState {
  components: Component[];
  allViews?: ViewInfo[]; // 项目中所有 view（含跳转关系）
  allHmlFiles?: Array<{path: string, name: string, relativePath: string}>; // 项目中所有 HML 文件
  otherFileComponentIds?: string[]; // 其他 HML 文件中的组件 ID（跨文件命名去重）
  currentFilePath?: string; // 当前打开的文件路径
  selectedComponent: string | null;
  selectedComponents: string[];
  hoveredComponent: string | null;
  draggedComponent: string | null;
  zoom: number;
  canvasOffset: { x: number; y: number };
  canvasSize: { width: number; height: number };
  canvasBackgroundColor: string;
  editingMode: 'select' | 'move' | 'resize';
  undoStack: any[];
  redoStack: any[];
  projectConfig?: any; // Project configuration (resolution, etc.)
  assetCategory: 'all' | 'images' | 'svgs' | 'videos' | 'models' | 'fonts' | 'glass' | 'lottie' | 'trmap'; // 资源面板分类
  isSimulationRunning: boolean; // 仿真运行状态
  operationInProgress: 'codegen' | 'simulate' | 'clean' | 'download' | null; // 当前正在执行的操作（互斥）
  guiVersion: { engine: string; tag: string; branch: string; commit: string; buildDate: string } | null; // GUI 库版本信息
}

export interface VSCodeAPI {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
}

declare global {
  interface Window {
    acquireVsCodeApi(): VSCodeAPI;
    vscodeAPI?: VSCodeAPI;
  }
}

/**
 * 资源文件类型定义
 */
export interface AssetFile {
  name: string;
  path: string;
  relativePath?: string; // 相对于 assets 目录的路径
  type: 'image' | 'font' | 'model3d' | 'folder' | 'svg' | 'video' | 'glass' | 'lottie' | 'trmap' | 'raw';
  size: number;
  children?: AssetFile[]; // 文件夹的子项
  isUserAsset?: boolean;  // user 目录下的资源（不转换，直接打包）
}


// ============================================
// 图片转换配置相关类型定义
// ============================================

/**
 * 目标格式枚举
 * - RGB565, RGB888, ARGB8565, ARGB8888: 固定格式
 * - I8: 8位索引格式（仅用于图片）
 * - A8: 8位Alpha格式（仅用于图片）
 * - adaptive16: 自适应16bit（有透明度→ARGB8565，无透明度→RGB565）
 * - adaptive24: 自适应24bit（有透明度→ARGB8888，无透明度→RGB888）
 * - inherit: 继承父文件夹设置（仅用于图片）
 */
export type TargetFormat =
  | 'RGB565'
  | 'RGB888'
  | 'ARGB8565'
  | 'ARGB8888'
  | 'I8'
  | 'A8'
  | 'A4'
  | 'A2'
  | 'A1'
  | 'adaptive16'
  | 'adaptive24'
  | 'inherit';

/**
 * 视频目标格式枚举
 * - MJPEG: Motion JPEG 格式
 * - AVI: AVI 容器格式
 * - H264: H.264 编码格式
 * - inherit: 继承父文件夹设置（仅用于视频文件）
 */
export type VideoFormat = 'MJPEG' | 'AVI' | 'H264' | 'inherit';

/**
 * 压缩方式枚举
 * - none: 不压缩
 * - rle: RLE 压缩
 * - fastlz: FastLZ 压缩
 * - yuv: YUV 有损压缩
 * - adaptive: 无损自适应（比较 FastLZ、RLE、不压缩，选择最小）
 */
export type CompressionMethod =
  | 'none'
  | 'rle'
  | 'fastlz'
  | 'yuv'
  | 'jpeg'
  | 'adaptive'
  | 'inherit';

/**
 * YUV 采样方式
 */
export type YuvSampling = 'YUV444' | 'YUV422' | 'YUV411';

/**
 * YUV 模糊程度
 */
export type YuvBlur = 'none' | '1bit' | '2bit' | '4bit';

/**
 * YUV 压缩参数
 */
export interface YuvParams {
  /** 采样方式 */
  sampling: YuvSampling;
  /** 模糊程度 */
  blur: YuvBlur;
  /** FastLZ 二次压缩 */
  fastlzSecondary: boolean;
}

/**
 * JPEG 采样方式
 */
export type JpegSampling = 'YUV420' | 'YUV422' | 'YUV444' | 'Grayscale';

/**
 * JPEG 压缩参数
 */
export interface JpegParams {
  /** 采样方式 */
  sampling: JpegSampling;
  /** 编码质量 1-31，数值越小质量越高 */
  quality: number;
  /** 透明图片背景色 */
  backgroundColor?: string;
}

/**
 * 资源部署方式（仅 LVGL 项目使用，HoneyGUI 项目忽略此字段）
 * - 'c-array': 资源编译为 C 数组，链接到固件中
 * - 'external-bin': 资源打包为外部二进制文件（romfs），运行时加载
 * - 'inherit': 从父级配置继承（默认行为）
 */
export type DeploymentMode = 'c-array' | 'external-bin' | 'inherit';

/**
 * 视频缩放配置
 */
export interface VideoScaleConfig {
  /** 缩放模式：按像素或按比例 */
  mode: 'pixels' | 'percentage';
  /** 目标宽度（像素模式，可选，留空自动保持宽高比） */
  width?: number;
  /** 目标高度（像素模式，可选，留空自动保持宽高比） */
  height?: number;
  /** 宽度缩放比例（比例模式，如 50 表示缩放到原来的 50%，留空则根据高度自动计算） */
  widthPercentage?: number;
  /** 高度缩放比例（比例模式，如 50 表示缩放到原来的 50%，留空则根据宽度自动计算） */
  heightPercentage?: number;
}

/**
 * 视频裁剪配置
 */
export interface VideoCropConfig {
  /** 裁剪宽度（必填） */
  width: number;
  /** 裁剪高度（必填） */
  height: number;
  /** 裁剪起始 X 坐标（可选，未设置时自动居中） */
  x?: number;
  /** 裁剪起始 Y 坐标（可选，未设置时自动居中） */
  y?: number;
}

/**
 * 预处理顺序：裁剪和缩放的执行顺序
 * - 'crop-then-scale'：先裁剪，再缩放（默认）
 * - 'scale-then-crop'：先缩放，再裁剪
 */
export type PreprocessOrder = 'crop-then-scale' | 'scale-then-crop';

/**
 * 单个项目（文件夹或图片）的配置
 */
export interface ItemSettings {
  /** 图片目标格式 */
  format?: TargetFormat;
  /** 视频目标格式 */
  videoFormat?: VideoFormat;
  /** 视频质量（MJPEG/AVI: 1-31, H264: 0-51） */
  videoQuality?: number;
  /** 视频帧率 (FPS) */
  videoFrameRate?: number;
  /** 视频缩放配置 */
  videoScale?: VideoScaleConfig;
  /** 视频裁剪配置 */
  videoCrop?: VideoCropConfig;
  /** 裁剪与缩放的预处理顺序（默认：先裁剪后缩放） */
  preprocessOrder?: PreprocessOrder;
  /** 压缩方式 */
  compression?: CompressionMethod;
  /** YUV 压缩参数（仅当 compression 为 'yuv' 时有效） */
  yuvParams?: YuvParams;
  /** JPEG 压缩参数（仅当 compression 为 'jpeg' 时有效） */
  jpegParams?: JpegParams;
  /** 是否启用抖动（减少色彩损失） */
  dither?: boolean;
  /** 字体：不转换格式，直接拷贝原文件 */
  fontCopyOnly?: boolean;
  /** 资源部署方式（仅 LVGL 项目使用，HoneyGUI 项目忽略此字段） */
  deployment?: DeploymentMode;
}

/**
 * 完整配置文件结构
 */
export interface ConversionConfig {
  /** 配置文件版本，如 "1.0" */
  version: string;
  /** 根目录默认设置 */
  defaultSettings: ItemSettings;
  /** 路径 -> 设置映射 */
  items: Record<string, ItemSettings>;
}

/**
 * 解析后的有效配置（已处理继承）
 */
export interface ResolvedConfig {
  /** 解析后的格式（不包含 inherit、adaptive16、adaptive24） */
  format: Exclude<TargetFormat, 'inherit' | 'adaptive16' | 'adaptive24'>;
  /** 继承解析后的原始格式（未经 adaptive 转换），用于判断是否需要自适应处理 */
  rawFormat?: TargetFormat;
  /** 压缩方式 */
  compression: CompressionMethod;
  /** YUV 压缩参数 */
  yuvParams?: YuvParams;
  /** JPEG 压缩参数 */
  jpegParams?: JpegParams;
  /** 是否启用抖动 */
  dither?: boolean;
  /** 是否继承自父级 */
  isInherited: boolean;
  /** 继承来源路径 */
  inheritedFrom?: string;
}
