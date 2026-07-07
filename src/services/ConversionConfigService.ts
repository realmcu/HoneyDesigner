import * as path from 'path';
import * as fs from 'fs';

/**
 * 目标格式枚举
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
 */
export type VideoFormat = 'MJPEG' | 'AVI' | 'H264' | 'MSV1' | 'CINEPAK' | 'inherit';

/**
 * 压缩方式枚举
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
 * 资源部署方式（LVGL only）
 * - 'c-array': 资源编译为 C 数组，链接到固件中
 * - 'external-bin': 资源打包为外部二进制文件（romfs），运行时加载
 * - 'inherit': 从父级配置继承（默认行为）
 */
export type DeploymentMode = 'c-array' | 'external-bin' | 'inherit';

/**
 * YUV 采样方式
 */
export type YuvSampling = 'YUV444' | 'YUV422' | 'YUV411';

/**
 * YUV 模糊程度
 */
export type YuvBlur = 'none' | '1bit' | '2bit' | '4bit';

/**
 * JPEG 采样方式
 */
export type JpegSampling = 'YUV420' | 'YUV422' | 'YUV444' | 'Grayscale';

/**
 * JPEG 压缩参数
 */
export interface JpegParams {
  sampling: JpegSampling;
  /** 编码质量 1-31，数值越小质量越高 */
  quality: number;
  /** 透明图片背景色，默认 'black' */
  backgroundColor?: string;
  /**
   * 编码尺寸对齐到 MCU，默认 false（与最小尺寸相互独立）。
   * JPEG 物理编码始终以 MCU 为单位；此开关只决定 SOF 标记报告的宽高：
   * 开启则向上取整到 MCU（在右/下补黑边），关闭则报告精确内容尺寸（可非 MCU）。
   * GUI 头部始终记录原始宽高。依赖 ffprobe（随 FFmpeg 安装）。映射到转换器的 `align` 参数。
   */
  align?: boolean;
  /**
   * 最小内容宽度（像素），与 align 相互独立：内容宽 = max(原始宽, 该值)，
   * 该值会被抬升到不小于 MCU；是否再向上对齐到 MCU 由 align 决定。
   * 留空表示不设最小宽（内容下限即一个 MCU）。映射到转换器的 `minWidth`。
   */
  minWidth?: number;
  /**
   * 最小内容高度（像素），与 align 相互独立：内容高 = max(原始高, 该值)，
   * 该值会被抬升到不小于 MCU；是否再向上对齐到 MCU 由 align 决定。
   * 留空表示不设最小高（内容下限即一个 MCU）。映射到转换器的 `minHeight`。
   */
  minHeight?: number;
}

/**
 * YUV 压缩参数
 */
export interface YuvParams {
  sampling: YuvSampling;
  blur: YuvBlur;
  fastlzSecondary: boolean;
}

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
  /** 抖动处理 */
  dither?: boolean;
  /** YUV 压缩参数 */
  yuvParams?: YuvParams;
  /** JPEG 压缩参数 */
  jpegParams?: JpegParams;
  /** 字体：不转换格式，直接拷贝原文件 */
  fontCopyOnly?: boolean;
  /** GIF 文件处理模式：true=作为视频转换，false/undefined=作为图片处理（默认） */
  gifAsVideo?: boolean;
  /** 资源部署方式（LVGL only，HoneyGUI 忽略此字段） */
  deployment?: DeploymentMode;
}

/**
 * 强制转换配置（支持精确路径和 glob 模式）
 */
export interface AlwaysConvertConfig {
  images?: string[];   // 图片资源路径或 glob 模式
  videos?: string[];   // 视频资源路径或 glob 模式
  models?: string[];   // 3D 模型资源路径或 glob 模式
  fonts?: string[];    // 字体资源路径或 glob 模式
}

/**
 * 完整配置文件结构
 */
export interface ConversionConfig {
  version: string;
  defaultSettings: ItemSettings;
  items: Record<string, ItemSettings>;
  /** 强制转换列表（即使 HML 未引用也会被转换打包） */
  alwaysConvert?: AlwaysConvertConfig;
  /** 灵活打包模式：true=只转换被引用的资源（按需），false/undefined=转换所有资源（全量） */
  smartPacking?: boolean;
}


/**
 * 解析后的有效配置（已处理继承）
 */
export interface ResolvedConfig {
  format: Exclude<TargetFormat, 'inherit' | 'adaptive16' | 'adaptive24'>;
  /** 继承解析后的原始格式（未经 adaptive 转换），用于判断是否需要自适应处理 */
  rawFormat: TargetFormat;
  compression: Exclude<CompressionMethod, 'inherit'>;
  /** 资源部署方式（LVGL only） */
  deployment: 'c-array' | 'external-bin';
  yuvParams?: YuvParams;
  jpegParams?: JpegParams;
  dither?: boolean;
  isInherited: boolean;
  inheritedFrom?: string;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: ConversionConfig = {
  version: '1.0',
  defaultSettings: {
    format: 'adaptive16',
    compression: 'adaptive',
    dither: false,
    videoFormat: 'MJPEG',
    videoQuality: 5,
    videoFrameRate: undefined
  },
  items: {}
};

/**
 * 默认 YUV 参数
 */
const DEFAULT_YUV_PARAMS: YuvParams = {
  sampling: 'YUV422',
  blur: 'none',
  fastlzSecondary: false
};

/**
 * 默认 JPEG 参数
 */
const DEFAULT_JPEG_PARAMS: JpegParams = {
  sampling: 'YUV420',
  quality: 10,
  backgroundColor: 'black',
  align: false
};

/**
 * 图片转换配置服务
 * 处理配置文件的读写和继承解析
 */
export class ConversionConfigService {
  private static instance: ConversionConfigService;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): ConversionConfigService {
    if (!ConversionConfigService.instance) {
      ConversionConfigService.instance = new ConversionConfigService();
    }
    return ConversionConfigService.instance;
  }

  /**
   * 获取配置文件路径
   * @param projectRoot 项目根目录
   * @returns 配置文件完整路径
   */
  getConfigPath(projectRoot: string): string {
    return path.join(projectRoot, 'assets', 'conversion.json');
  }

  /**
   * 归一化资源 key 为 conversion.json 内部规范：
   * - 反斜杠 → 正斜杠
   * - 去掉首尾的 '/'
   * - 去掉前导 'assets/'（HML 里 src="assets/foo.png"，但 conversion.json 内部存为 "foo.png"）
   *
   * 这样无论调用方传入 "assets/foo.png" 还是 "foo.png"，最终查到的是同一条记录。
   */
  private normalizeAssetKey(assetPath: string): string {
    let normalized = assetPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (normalized.toLowerCase().startsWith('assets/')) {
      normalized = normalized.substring('assets/'.length);
    }
    return normalized;
  }

  /**
   * 迁移：将 items 中带 'assets/' 前缀的旧 key 改名为不带前缀（与新规范对齐）。
   * 冲突时合并：以"不带前缀"的现有条目为基础，"带前缀"的字段补齐缺失项。
   * @returns 是否发生过迁移（用于决定是否需要回写文件）
   */
  private migrateLegacyAssetsPrefix(items: Record<string, ItemSettings>): boolean {
    let changed = false;
    for (const oldKey of Object.keys(items)) {
      const lower = oldKey.toLowerCase();
      if (!lower.startsWith('assets/')) {
        continue;
      }
      const newKey = oldKey.substring('assets/'.length);
      const oldVal = items[oldKey];
      const existing = items[newKey];
      if (existing) {
        // 冲突时：现有 newKey 为基础，oldKey 仅补充缺失字段
        items[newKey] = { ...oldVal, ...existing };
      } else {
        items[newKey] = oldVal;
      }
      delete items[oldKey];
      changed = true;
    }
    return changed;
  }

  /**
   * 加载配置文件
   * @param projectRoot 项目根目录
   * @returns 配置对象，如果文件不存在则返回默认配置
   */
  loadConfig(projectRoot: string): ConversionConfig {
    const configPath = this.getConfigPath(projectRoot);
    let config: ConversionConfig;

    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(content) as ConversionConfig;
        config = this.validateAndMergeConfig(parsed);
      } else {
        config = { ...DEFAULT_CONFIG, items: {} };
      }
    } catch (error) {
      console.error('Failed to load conversion config:', error);
      config = { ...DEFAULT_CONFIG, items: {} };
    }

    // 向后兼容：如果 conversion.json 中没有 alwaysConvert，尝试从 project.json 迁移
    if (!config.alwaysConvert) {
      const migrated = this.migrateAlwaysConvertFromProject(projectRoot);
      if (migrated) {
        config.alwaysConvert = migrated;
        // 自动保存迁移后的配置
        try {
          this.saveConfig(projectRoot, config);
          console.log('[ConversionConfigService] alwaysConvert 已从 project.json 迁移到 conversion.json');
        } catch (e) {
          console.error('[ConversionConfigService] 保存迁移配置失败:', e);
        }
      }
    }

    // 向后兼容：将历史上手编辑写入的 'assets/xxx' key 迁移为不带前缀的形式，
    // 与 UI / BuildCore / ImageConverterService 的写入约定对齐。
    if (this.migrateLegacyAssetsPrefix(config.items)) {
      try {
        this.saveConfig(projectRoot, config);
        console.log('[ConversionConfigService] 已将带 assets/ 前缀的历史 key 迁移为不带前缀');
      } catch (e) {
        console.error('[ConversionConfigService] 保存迁移配置失败:', e);
      }
    }

    return config;
  }

  /**
   * 从 project.json 迁移 alwaysConvert 配置（向后兼容）
   */
  private migrateAlwaysConvertFromProject(projectRoot: string): AlwaysConvertConfig | null {
    try {
      const projectJsonPath = path.join(projectRoot, 'project.json');
      if (!fs.existsSync(projectJsonPath)) {
        return null;
      }
      const projectConfig = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
      if (!projectConfig.alwaysConvert) {
        return null;
      }
      const ac = projectConfig.alwaysConvert;
      // 检查是否有实际内容
      const hasContent = ['images', 'videos', 'models', 'fonts'].some(
        (k) => Array.isArray(ac[k]) && ac[k].length > 0
      );
      if (!hasContent) {
        return null;
      }
      return {
        images: ac.images || [],
        videos: ac.videos || [],
        models: ac.models || [],
        fonts: ac.fonts || []
      };
    } catch {
      return null;
    }
  }


  /**
   * 保存配置文件
   * @param projectRoot 项目根目录
   * @param config 配置对象
   */
  saveConfig(projectRoot: string, config: ConversionConfig): void {
    const configPath = this.getConfigPath(projectRoot);
    const configDir = path.dirname(configPath);

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    const content = JSON.stringify(config, null, 2);
    fs.writeFileSync(configPath, content, 'utf-8');
  }

  /**
   * 验证并合并配置
   */
  private validateAndMergeConfig(config: Partial<ConversionConfig>): ConversionConfig {
    return {
      version: config.version || DEFAULT_CONFIG.version,
      defaultSettings: { ...DEFAULT_CONFIG.defaultSettings, ...config.defaultSettings },
      items: config.items || {},
      alwaysConvert: config.alwaysConvert,
      smartPacking: config.smartPacking
    };
  }

  /**
   * 解析有效配置（处理继承）
   * @param assetPath 资源路径（相对于 assets 目录）
   * @param config 完整配置对象
   * @returns 解析后的有效配置
   */
  resolveEffectiveConfig(assetPath: string, config: ConversionConfig): ResolvedConfig {
    // 同时兼容 "assets/foo.png" 与 "foo.png" 两种调用方式
    const normalizedPath = this.normalizeAssetKey(assetPath);
    const itemSettings = config.items[normalizedPath];

    // 判断 format、compression、deployment 是否需要继承
    const formatNeedsInherit = !itemSettings || !itemSettings.format || itemSettings.format === 'inherit';
    const compressionNeedsInherit = !itemSettings || !itemSettings.compression || itemSettings.compression === 'inherit';
    const deploymentNeedsInherit = !itemSettings || !itemSettings.deployment || itemSettings.deployment === 'inherit';

    // isInherited 仅反映 format/compression 的继承状态：
    // deployment 在 buildResolvedConfig 中有硬默认 'c-array'，未显式设置时不应被视为"继承"。
    const semanticallyInherited = formatNeedsInherit || compressionNeedsInherit;

    // 如果三者都不需要继承，直接使用当前配置
    if (!formatNeedsInherit && !compressionNeedsInherit && !deploymentNeedsInherit) {
      return this.buildResolvedConfig(itemSettings!, false);
    }

    // 需要继承：查找父级配置
    const pathParts = normalizedPath.split('/');
    let inheritedFrom: string | undefined;
    let inheritedSettings: ItemSettings | undefined;

    for (let i = pathParts.length - 1; i >= 0; i--) {
      const parentPath = pathParts.slice(0, i).join('/');
      const parentSettings = config.items[parentPath];

      // 父级有任何有效配置（format/compression/deployment 不是 inherit）就匹配
      const parentHasFormat = parentSettings?.format && parentSettings.format !== 'inherit';
      const parentHasCompression = parentSettings?.compression && parentSettings.compression !== 'inherit';
      const parentHasDeployment = parentSettings?.deployment && parentSettings.deployment !== 'inherit';
      if (parentSettings && (parentHasFormat || parentHasCompression || parentHasDeployment)) {
        inheritedSettings = parentSettings;
        inheritedFrom = parentPath || 'root';
        break;
      }
    }

    // 如果没有找到父级配置，使用默认配置
    if (!inheritedSettings) {
      inheritedSettings = config.defaultSettings;
      inheritedFrom = 'default';
    }

    // 合并配置：对需要继承的字段使用父级值，否则使用自身值
    const mergedSettings: ItemSettings = {
      ...inheritedSettings,
      ...itemSettings,
      format: formatNeedsInherit ? inheritedSettings.format : itemSettings!.format,
      compression: compressionNeedsInherit ? inheritedSettings.compression : itemSettings!.compression,
      deployment: deploymentNeedsInherit ? inheritedSettings.deployment : itemSettings!.deployment,
    };

    return this.buildResolvedConfig(
      mergedSettings,
      semanticallyInherited,
      semanticallyInherited ? inheritedFrom : undefined
    );
  }


  /**
   * 根据图片是否有透明度解析自适应格式
   * @param format 原始格式设置
   * @param hasAlpha 图片是否包含透明度
   * @returns 解析后的具体格式
   */
  resolveAdaptiveFormat(
    format: TargetFormat,
    hasAlpha: boolean
  ): Exclude<TargetFormat, 'inherit' | 'adaptive16' | 'adaptive24'> {
    switch (format) {
      case 'adaptive16':
        return hasAlpha ? 'ARGB8565' : 'RGB565';
      case 'adaptive24':
        return hasAlpha ? 'ARGB8888' : 'RGB888';
      case 'inherit':
        return 'RGB565';
      default:
        return format;
    }
  }

  /**
   * 构建解析后的配置对象
   */
  private buildResolvedConfig(
    settings: ItemSettings,
    isInherited: boolean,
    inheritedFrom?: string
  ): ResolvedConfig {
    const format = settings.format || 'RGB565';
    const compression = settings.compression || 'adaptive';
    // inherit 不应该出现在这里（已在 resolveEffectiveConfig 中处理），防御性处理
    const resolvedCompression = compression === 'inherit' ? 'adaptive' : compression;
    const dither = settings.dither;

    // deployment 继承解析：undefined / 'inherit' → fallback to 'c-array'
    const deployment = settings.deployment === 'external-bin' ? 'external-bin' : 'c-array';

    let resolvedFormat: Exclude<TargetFormat, 'inherit' | 'adaptive16' | 'adaptive24'>;
    if (format === 'adaptive16' || format === 'adaptive24' || format === 'inherit') {
      resolvedFormat = 'RGB565';
    } else {
      resolvedFormat = format;
    }

    const result: ResolvedConfig = {
      format: resolvedFormat,
      rawFormat: format,
      compression: resolvedCompression,
      deployment,
      dither,
      isInherited
    };

    if (inheritedFrom) {
      result.inheritedFrom = inheritedFrom;
    }

    if (resolvedCompression === 'yuv' && settings.yuvParams) {
      result.yuvParams = { ...settings.yuvParams };
    } else if (resolvedCompression === 'yuv') {
      result.yuvParams = { ...DEFAULT_YUV_PARAMS };
    }

    if (resolvedCompression === 'jpeg' && settings.jpegParams) {
      result.jpegParams = { ...settings.jpegParams };
    } else if (resolvedCompression === 'jpeg') {
      result.jpegParams = { ...DEFAULT_JPEG_PARAMS };
    }

    return result;
  }

  /**
   * 更新单个项目的配置
   */
  updateItemConfig(projectRoot: string, assetPath: string, settings: ItemSettings): void {
    const config = this.loadConfig(projectRoot);
    const normalizedPath = this.normalizeAssetKey(assetPath);

    if (Object.keys(settings).length === 0) {
      delete config.items[normalizedPath];
    } else {
      config.items[normalizedPath] = settings;
    }

    this.saveConfig(projectRoot, config);
  }

  /**
   * 获取单个项目的原始配置（不处理继承）
   */
  getItemConfig(projectRoot: string, assetPath: string): ItemSettings | undefined {
    const config = this.loadConfig(projectRoot);
    const normalizedPath = this.normalizeAssetKey(assetPath);
    return config.items[normalizedPath];
  }
}
