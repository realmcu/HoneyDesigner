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
import type { ProjectI18nIndex } from '../project-i18n/projectIndex';
import type { ComponentIconName } from './components/icons/ComponentIcon';
import type { I18nCatalog, LocaleCode } from '../project-i18n/types';
import type { EventType } from '../hml/eventTypes';

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
  | 'hg_menu_cellular'
  | 'hg_qbcode'
  | 'hg_streaming';

export type EngineSupport = 'ready' | 'unsupported';

export interface ComponentDefinition {
  type: ComponentType;
  name: string;
  icon: ComponentIconName;
  defaultSize: { width: number; height: number };
  properties: PropertyDefinition[];
  /**
   * Per-engine support status.
   * - 'ready': supported, shown in component library
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

// 视图跳转边信息：改判别联合并迁至 src/shared/navContract.ts（评审 I6：control 可编辑 /
// timer 只读，宿主 FileManager 与 webview 共用同一定义，不再手抄同步）。
// 保留 ViewEdgeInfo 别名，webview 各消费方（ViewRelationModal 等）无需改 import。
import type { ViewNavEdge } from '../shared/navContract';
export type { ViewNavEdge, ControlNavEdge, TimerNavEdge } from '../shared/navContract';
export type ViewEdgeInfo = ViewNavEdge;

// 项目中的视图信息（包含跳转关系）
// 与 src/designer/FileManager.ts 的 ViewNavNode 保持同步（新字段全部可选，向后兼容）
export interface ViewInfo {
  id: string;
  name: string;
  file: string;          // 旧字段：文件名去 .hml（向后兼容；新逻辑请用 viewKey）
  edges: ViewEdgeInfo[]; // 该视图的所有跳转（含控件级 + 定时器边）

  // ---- 导航图新字段（可选）----
  viewKey?: string;      // 复合键：relPath#viewId
  filePath?: string;     // 所属文件绝对路径
  fileRelative?: string; // 所属文件相对项目根路径（正斜杠）
  fileMtime?: number;    // 扫描时文件 mtime（ms）
  fileHash?: string;     // 扫描时文件内容 hash（sha1）
}

// 导航图节点布局坐标（T7：持久化到 <projectRoot>/.honeygui/nav-layout.json）
export interface NavLayoutEntry {
  x: number;
  y: number;
}

// 复合键（relPath#viewId）→ 坐标
export type NavLayoutMap = Record<string, NavLayoutEntry>;

// 单个 view 下可交互控件的枚举描述（T9，用于 T11 新建跳转选择器）
// 与 src/designer/FileManager.ts 的 ViewControlInfo 保持同步。
export interface ViewControlInfo {
  id: string;
  name: string;
  type: string;
  supportedEvents: EventType[];
  occupiedSwitchViewEvents: EventType[];
  sourceIsView: boolean;
}

// ---------------- 导航写事务（T10/T11）----------------
// 契约类型迁至 src/shared/navContract.ts（评审 I4/I5：宿主/webview 单一真相源）。
// 从此 errorCode 是 NavEditErrorCode 而非退化的 string，undoCount / panelResyncFailed
// 等字段直接派生自服务端 NavEditResult，无需两端手抄同步。
import type {
  NavEditOp,
  NavEditErrorCode,
  NavEditConfirmReason,
  NavEditEdgeLocator,
  NavEditCreateSpec,
  NavEditRequestBody,
  NavEditRequestPayload,
  NavEditResultMessage,
} from '../shared/navContract';

export type {
  NavEditOp,
  NavEditErrorCode,
  NavEditConfirmReason,
  NavEditEdgeLocator,
  NavEditCreateSpec,
  NavEditRequestBody,
  NavEditRequestPayload,
  NavEditResultMessage,
};

export interface DesignerState {
  components: Component[];
  allViews?: ViewInfo[]; // 项目中所有 view（含跳转关系）
  allHmlFiles?: Array<{path: string, name: string, relativePath: string}>; // 项目中所有 HML 文件
  otherFileComponentIds?: string[]; // 其他 HML 文件中的组件 ID（跨文件命名去重）
  currentFilePath?: string; // 当前打开的文件路径
  navLayout: NavLayoutMap | null; // 导航图持久化布局；null = 尚未从宿主读取
  navLayoutSaveError: string | null; // 布局写入失败的提示文案（不阻塞，仅展示）
  viewControls: ViewControlInfo[] | null; // 请求 getViewControls 后回推的控件列表（T9，UI 用在 T11）
  viewControlsForKey: string | null; // 上面 viewControls 对应的 viewKey，用于校验请求-响应是否匹配
  viewControlsError: string | null; // getViewControls 失败提示（不阻塞，仅展示）
  navEditPending: boolean; // 导航写事务进行中（T11：编辑操作互斥）
  navEditResult: NavEditResultMessage | null; // 最近一次 navEditResult 回执（消费后由 modal 清除）
  isDirty: boolean; // store 内容相对磁盘是否有未保存改动（变化时经 dirtyStateChanged 消息同步给宿主）
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
  projectI18nCatalog: I18nCatalog; // Project text localization catalog
  projectI18nIndex?: ProjectI18nIndex; // Project-wide localization reference index
  projectI18nIndexErrors?: Array<{ filePath: string; message: string }>;
  isProjectI18nManagerOpen: boolean;
  previewLocale: LocaleCode; // Current content preview locale
  assetCategory: 'all' | 'images' | 'svgs' | 'videos' | 'models' | 'fonts' | 'glass' | 'lottie' | 'trmap'; // 资源面板分类
  isSimulationRunning: boolean; // 仿真运行状态
  operationInProgress: 'codegen' | 'simulate' | 'clean' | 'download' | 'convert' | null; // 当前正在执行的操作（互斥）
  simulationFlow: { convert: boolean; codegen: boolean; simulate: boolean }; // 仿真流程配置（可独立勾选）
  guiVersion: { engine: string; tag: string; branch: string; commit: string; buildDate: string } | null; // GUI 库版本信息
}

export interface VSCodeAPI {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
}

export interface WebviewPerformanceMarks {
  htmlStartedAt: number;
  scriptStartedAt?: number;
  scriptEvaluatedAt?: number;
  reactRenderStartedAt?: number;
}

declare global {
  interface Window {
    acquireVsCodeApi(): VSCodeAPI;
    vscodeAPI?: VSCodeAPI;
    __honeyguiPerf?: WebviewPerformanceMarks;
    /** 宿主注入的 CSP nonce，供按需 chunk 的 <script> 标签使用 */
    __honeyguiNonce?: string;
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
export type VideoFormat = 'MJPEG' | 'AVI' | 'H264' | 'MSV1' | 'CINEPAK' | 'inherit';

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
  /** 编码尺寸对齐到 MCU（与最小尺寸独立）：JPEG 物理编码始终按 MCU，此开关只决定
   *  SOF 报告的宽高——开启则向上取整到 MCU（右/下补黑边），关闭则报告精确内容尺寸。
   *  GUI 头部始终记录原始宽高。默认关闭 */
  align?: boolean;
  /** 最小内容宽度（像素，与 align 独立）：内容宽 = max(原始宽, 该值)，该值抬升到不小于 MCU；
   *  是否再对齐到 MCU 由 align 决定。留空表示不设下限。映射到转换器的 minWidth */
  minWidth?: number;
  /** 最小内容高度（像素，与 align 独立）：内容高 = max(原始高, 该值)，该值抬升到不小于 MCU；
   *  是否再对齐到 MCU 由 align 决定。留空表示不设下限。映射到转换器的 minHeight */
  minHeight?: number;
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
  /** GIF 文件处理模式：true=作为视频转换，false/undefined=作为图片处理（默认） */
  gifAsVideo?: boolean;
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
