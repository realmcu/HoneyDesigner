/**
 * ConversionConfigPanel - 图片转换配置面板
 * 用于配置文件夹和图片的目标格式、压缩方式等
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDesignerStore } from '../store';
import { t } from '../i18n';
import {
  AssetFile,
  TargetFormat,
  VideoFormat,
  CompressionMethod,
  DeploymentMode,
  YuvSampling,
  YuvBlur,
  JpegSampling,
  ItemSettings,
  ConversionConfig,
} from '../types';
import './ConversionConfigPanel.css';

// 视频文件扩展名
const VIDEO_EXTS = ['mp4', 'avi', 'mov', 'mkv', 'webm'];

// 字体文件扩展名
const FONT_EXTS = ['ttf', 'otf', 'woff', 'woff2'];

// 图片文件扩展名
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'];

// 支持显示尺寸的文件类型
const DIMENSION_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS];

// 文件夹可用的格式选项
const FOLDER_FORMAT_OPTIONS: { value: TargetFormat; label: string }[] = [
  { value: 'RGB565', label: 'RGB565' },
  { value: 'RGB888', label: 'RGB888' },
  { value: 'ARGB8565', label: 'ARGB8565' },
  { value: 'ARGB8888', label: 'ARGB8888' },
  { value: 'I8', label: 'I8' },
  { value: 'A8', label: 'A8' },
  { value: 'A4', label: 'A4' },
  { value: 'A2', label: 'A2' },
  { value: 'A1', label: 'A1' },
  { value: 'adaptive16', label: 'formatAdaptive16' },
  { value: 'adaptive24', label: 'formatAdaptive24' },
];

// 图片可用的格式选项（包含继承选项和 I8、A8）
const IMAGE_FORMAT_OPTIONS: { value: TargetFormat; label: string }[] = [
  { value: 'inherit', label: 'formatInherit' },
  { value: 'RGB565', label: 'RGB565' },
  { value: 'RGB888', label: 'RGB888' },
  { value: 'ARGB8565', label: 'ARGB8565' },
  { value: 'ARGB8888', label: 'ARGB8888' },
  { value: 'I8', label: 'I8' },
  { value: 'A8', label: 'A8' },
  { value: 'A4', label: 'A4' },
  { value: 'A2', label: 'A2' },
  { value: 'A1', label: 'A1' },
];

// 文件夹可用的视频格式选项（不含继承）
const FOLDER_VIDEO_FORMAT_OPTIONS: { value: VideoFormat; label: string }[] = [
  { value: 'MJPEG', label: 'MJPEG' },
  { value: 'AVI', label: 'AVI' },
  { value: 'H264', label: 'H264' },
];

// 视频文件可用的格式选项（包含继承选项）
const VIDEO_FORMAT_OPTIONS: { value: VideoFormat; label: string }[] = [
  { value: 'inherit', label: 'formatInherit' },
  { value: 'MJPEG', label: 'MJPEG' },
  { value: 'AVI', label: 'AVI' },
  { value: 'H264', label: 'H264' },
];

// 压缩方式选项 - HoneyGUI 项目（文件夹用，含继承）
const FOLDER_COMPRESSION_OPTIONS_HONEYGUI: { value: CompressionMethod; label: string }[] = [
  { value: 'inherit', label: 'compressionInherit' },
  { value: 'none', label: 'compressionNone' },
  { value: 'rle', label: 'compressionRLE' },
  { value: 'fastlz', label: 'compressionFastLZ' },
  { value: 'yuv', label: 'compressionYUV' },
  { value: 'jpeg', label: 'compressionJPEG' },
  { value: 'adaptive', label: 'compressionAdaptive' },
];

// 压缩方式选项 - HoneyGUI 项目（图片用，含继承）
const COMPRESSION_OPTIONS_HONEYGUI: { value: CompressionMethod; label: string }[] = [
  { value: 'inherit', label: 'compressionInherit' },
  { value: 'none', label: 'compressionNone' },
  { value: 'rle', label: 'compressionRLE' },
  { value: 'fastlz', label: 'compressionFastLZ' },
  { value: 'yuv', label: 'compressionYUV' },
  { value: 'jpeg', label: 'compressionJPEG' },
  { value: 'adaptive', label: 'compressionAdaptive' },
];

// 压缩方式选项 - LVGL c-array 模式（文件夹用，含继承）
// LVGLImage.py 支持的压缩方式
const FOLDER_COMPRESSION_OPTIONS_LVGL_CARRAY: { value: CompressionMethod; label: string }[] = [
  { value: 'inherit', label: 'compressionInherit' },
  { value: 'none', label: 'compressionNone' },
  { value: 'rle', label: 'compressionRLE' },
];

// 压缩方式选项 - LVGL c-array 模式（图片用，含继承）
const COMPRESSION_OPTIONS_LVGL_CARRAY: { value: CompressionMethod; label: string }[] = [
  { value: 'inherit', label: 'compressionInherit' },
  { value: 'none', label: 'compressionNone' },
  { value: 'rle', label: 'compressionRLE' },
];

// 压缩方式选项 - LVGL external-bin 模式（文件夹用）
// HoneyGUI bin 格式的压缩与 LVGL 不兼容，仅 RLE 在 LVGL 实机可解析
const FOLDER_COMPRESSION_OPTIONS_LVGL_BIN: { value: CompressionMethod; label: string }[] = [
  { value: 'none', label: 'compressionNone' },
  { value: 'rle', label: 'compressionRLE' },
];

// 压缩方式选项 - LVGL external-bin 模式（图片用）
const COMPRESSION_OPTIONS_LVGL_BIN: { value: CompressionMethod; label: string }[] = [
  { value: 'none', label: 'compressionNone' },
  { value: 'rle', label: 'compressionRLE' },
];

// 部署方式选项（文件夹用，无继承）
const FOLDER_DEPLOYMENT_OPTIONS: { value: DeploymentMode; label: string }[] = [
  { value: 'c-array', label: 'deploymentCArray' },
  { value: 'external-bin', label: 'deploymentExternalBin' },
];

// 部署方式选项（图片用，含继承）
const DEPLOYMENT_OPTIONS: { value: DeploymentMode; label: string }[] = [
  { value: 'inherit', label: 'deploymentInherit' },
  { value: 'c-array', label: 'deploymentCArray' },
  { value: 'external-bin', label: 'deploymentExternalBin' },
];

// YUV 采样方式选项
const YUV_SAMPLING_OPTIONS: { value: YuvSampling; label: string }[] = [
  { value: 'YUV444', label: 'YUV444' },
  { value: 'YUV422', label: 'YUV422' },
  { value: 'YUV411', label: 'YUV411' },
];

// YUV 模糊程度选项
const YUV_BLUR_OPTIONS: { value: YuvBlur; label: string }[] = [
  { value: 'none', label: 'blurNone' },
  { value: '1bit', label: '1bit' },
  { value: '2bit', label: '2bit' },
  { value: '4bit', label: '4bit' },
];

// JPEG 采样方式选项
const JPEG_SAMPLING_OPTIONS: { value: JpegSampling; label: string }[] = [
  { value: 'YUV420', label: 'YUV 4:2:0' },
  { value: 'YUV422', label: 'YUV 4:2:2' },
  { value: 'YUV444', label: 'YUV 4:4:4' },
  { value: 'Grayscale', label: 'jpegGrayscale' },
];


/**
 * 获取格式的显示标签
 */
const getFormatLabel = (format: TargetFormat): string => {
  switch (format) {
    case 'adaptive16':
      return t('formatAdaptive16');
    case 'adaptive24':
      return t('formatAdaptive24');
    case 'inherit':
      return t('formatInherit');
    default:
      return format;
  }
};

/**
 * 获取压缩方式的显示标签
 */
const getCompressionLabel = (compression: CompressionMethod): string => {
  switch (compression) {
    case 'none':
      return t('compressionNone');
    case 'rle':
      return t('compressionRLE');
    case 'fastlz':
      return t('compressionFastLZ');
    case 'yuv':
      return t('compressionYUV');
    case 'jpeg':
      return t('compressionJPEG');
    case 'adaptive':
      return t('compressionAdaptive');
    case 'inherit':
      return t('compressionInherit');
    default:
      return compression;
  }
};

/**
 * 获取 YUV 模糊程度的显示标签
 */
const getBlurLabel = (blur: YuvBlur): string => {
  if (blur === 'none') {
    return t('blurNone');
  }
  return blur;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

interface ConversionConfigPanelProps {
  // Props can be extended if needed
}

/**
 * 获取部署方式的显示标签
 */
const getDeploymentLabel = (deployment: DeploymentMode): string => {
  switch (deployment) {
    case 'c-array':
      return t('deploymentCArray');
    case 'external-bin':
      return t('deploymentExternalBin');
    case 'inherit':
      return t('deploymentInherit');
    default:
      return deployment;
  }
};

const ConversionConfigPanel: React.FC<ConversionConfigPanelProps> = () => {
  const selectedAsset = useDesignerStore((state) => state.selectedAsset);
  const conversionConfig = useDesignerStore((state) => state.conversionConfig);
  const updateAssetConfig = useDesignerStore((state) => state.updateAssetConfig);
  // 部署方式仅 LVGL 项目使用，HoneyGUI 项目下隐藏该控件
  const targetEngine = useDesignerStore((state) => (state as any).projectConfig?.targetEngine || 'honeygui');
  const isLvglProject = targetEngine === 'lvgl';

  // 判断是否是文件夹
  const isFolder = selectedAsset?.type === 'folder';

  // 判断是否是视频文件
  const isVideo = useMemo(() => {
    if (!selectedAsset || isFolder) return false;
    const ext = selectedAsset.name.split('.').pop()?.toLowerCase() || '';
    return VIDEO_EXTS.includes(ext);
  }, [selectedAsset, isFolder]);

  // 判断是否是字体文件
  const isFont = useMemo(() => {
    if (!selectedAsset || isFolder) return false;
    const ext = selectedAsset.name.split('.').pop()?.toLowerCase() || '';
    return FONT_EXTS.includes(ext);
  }, [selectedAsset, isFolder]);

  // Asset metadata (dimensions, file size)
  const [assetMetadata, setAssetMetadata] = useState<{
    width?: number;
    height?: number;
    fileSize?: number;
  } | null>(null);

  useEffect(() => {
    if (!selectedAsset || isFolder) {
      setAssetMetadata(null);
      return;
    }

    const ext = selectedAsset.name.split('.').pop()?.toLowerCase() || '';
    const hasDimensions = DIMENSION_EXTS.includes(ext);

    if (!hasDimensions) {
      // For non-image/video files, show file size only
      setAssetMetadata(selectedAsset.size ? { fileSize: selectedAsset.size } : null);
      return;
    }

    setAssetMetadata(null);

    const relativePath = selectedAsset.relativePath || selectedAsset.name;
    window.vscodeAPI?.postMessage({
      command: 'getAssetMetadata',
      relativePath,
    });

    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.command === 'assetMetadata' && msg.metadata?.relativePath === relativePath) {
        setAssetMetadata({
          width: msg.metadata.width,
          height: msg.metadata.height,
          fileSize: msg.metadata.fileSize,
        });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [selectedAsset, isFolder]);

  // 获取当前资源的配置
  const currentSettings = useMemo((): ItemSettings => {
    if (!selectedAsset || !conversionConfig) {
      return {};
    }
    const assetPath = selectedAsset.relativePath || selectedAsset.name;
    return conversionConfig.items[assetPath] || {};
  }, [selectedAsset, conversionConfig]);

  // 获取有效配置（处理继承）- 图片格式
  const effectiveSettings = useMemo((): { settings: ItemSettings; isInherited: boolean; inheritedFrom?: string } => {
    if (!selectedAsset || !conversionConfig) {
      return { settings: {}, isInherited: false };
    }

    const assetPath = (selectedAsset.relativePath || selectedAsset.name).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const itemSettings = conversionConfig.items[assetPath];

    const formatNeedsInherit = !itemSettings || !itemSettings.format || itemSettings.format === 'inherit';
    const compressionNeedsInherit = !itemSettings || !itemSettings.compression || itemSettings.compression === 'inherit';

    // 如果两者都不需要继承，直接使用
    if (!formatNeedsInherit && !compressionNeedsInherit) {
      return { settings: itemSettings!, isInherited: false };
    }

    // 需要继承：查找父级配置
    const pathParts = assetPath.split('/');
    for (let i = pathParts.length - 1; i >= 0; i--) {
      const parentPath = pathParts.slice(0, i).join('/');
      const parentSettings = parentPath ? conversionConfig.items[parentPath] : undefined;

      // 父级有任何有效配置（format 或 compression 不是 inherit）就匹配
      const parentHasFormat = parentSettings?.format && parentSettings.format !== 'inherit';
      const parentHasCompression = parentSettings?.compression && parentSettings.compression !== 'inherit';
      if (parentSettings && (parentHasFormat || parentHasCompression)) {
        const merged = {
          ...parentSettings,
          ...itemSettings,
          format: formatNeedsInherit && parentHasFormat ? parentSettings.format : (formatNeedsInherit ? undefined : itemSettings!.format),
          compression: compressionNeedsInherit && parentHasCompression ? parentSettings.compression : (compressionNeedsInherit ? undefined : itemSettings!.compression),
        };
        return {
          settings: merged,
          isInherited: true,
          inheritedFrom: parentPath || t('Root'),
        };
      }
    }

    // 使用默认配置
    const merged = {
      ...conversionConfig.defaultSettings,
      ...itemSettings,
      format: formatNeedsInherit ? conversionConfig.defaultSettings.format : itemSettings!.format,
      compression: compressionNeedsInherit ? conversionConfig.defaultSettings.compression : itemSettings!.compression,
    };
    return {
      settings: merged,
      isInherited: true,
      inheritedFrom: t('defaultSettings'),
    };
  }, [selectedAsset, conversionConfig]);

  // 获取有效视频配置（处理继承）
  const effectiveVideoSettings = useMemo((): { videoFormat: VideoFormat; isInherited: boolean; inheritedFrom?: string } => {
    if (!selectedAsset || !conversionConfig) {
      return { videoFormat: 'MJPEG', isInherited: false };
    }

    const assetPath = (selectedAsset.relativePath || selectedAsset.name).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const itemSettings = conversionConfig.items[assetPath];

    // 如果有明确配置且不是 inherit，直接使用
    if (itemSettings && itemSettings.videoFormat && itemSettings.videoFormat !== 'inherit') {
      return { videoFormat: itemSettings.videoFormat, isInherited: false };
    }

    // 需要继承：查找父级配置
    const pathParts = assetPath.split('/');
    for (let i = pathParts.length - 1; i >= 0; i--) {
      const parentPath = pathParts.slice(0, i).join('/');
      const parentSettings = parentPath ? conversionConfig.items[parentPath] : undefined;

      if (parentSettings && parentSettings.videoFormat && parentSettings.videoFormat !== 'inherit') {
        return {
          videoFormat: parentSettings.videoFormat,
          isInherited: true,
          inheritedFrom: parentPath || t('Root'),
        };
      }
    }

    // 使用默认值 MJPEG
    return {
      videoFormat: 'MJPEG',
      isInherited: true,
      inheritedFrom: t('defaultSettings'),
    };
  }, [selectedAsset, conversionConfig]);

  // 获取有效视频质量（处理继承）
  const effectiveVideoQuality = useMemo((): { quality: number | undefined; isInherited: boolean; inheritedFrom?: string } => {
    if (!selectedAsset || !conversionConfig) {
      return { quality: undefined, isInherited: false };
    }

    const assetPath = (selectedAsset.relativePath || selectedAsset.name).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const itemSettings = conversionConfig.items[assetPath];

    // 如果有明确配置，直接使用
    if (itemSettings && itemSettings.videoQuality !== undefined) {
      return { quality: itemSettings.videoQuality, isInherited: false };
    }

    // 需要继承：查找父级配置
    const pathParts = assetPath.split('/');
    for (let i = pathParts.length - 1; i >= 0; i--) {
      const parentPath = pathParts.slice(0, i).join('/');
      const parentSettings = parentPath ? conversionConfig.items[parentPath] : undefined;

      if (parentSettings && parentSettings.videoQuality !== undefined) {
        return {
          quality: parentSettings.videoQuality,
          isInherited: true,
          inheritedFrom: parentPath || t('Root'),
        };
      }
    }

    // 没有配置，检查 defaultSettings
    if (conversionConfig.defaultSettings.videoQuality !== undefined) {
      return {
        quality: conversionConfig.defaultSettings.videoQuality,
        isInherited: true,
        inheritedFrom: t('defaultSettings'),
      };
    }

    // 没有配置，返回 undefined（使用默认值）
    return {
      quality: undefined,
      isInherited: false,
    };
  }, [selectedAsset, conversionConfig]);

  // 获取有效视频帧率（处理继承）
  const effectiveVideoFrameRate = useMemo((): { frameRate: number | undefined; isInherited: boolean; inheritedFrom?: string } => {
    if (!selectedAsset || !conversionConfig) {
      return { frameRate: undefined, isInherited: false };
    }

    const assetPath = (selectedAsset.relativePath || selectedAsset.name).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const itemSettings = conversionConfig.items[assetPath];

    // 如果有明确配置，直接使用
    if (itemSettings && itemSettings.videoFrameRate !== undefined) {
      return { frameRate: itemSettings.videoFrameRate, isInherited: false };
    }

    // 需要继承：查找父级配置
    const pathParts = assetPath.split('/');
    for (let i = pathParts.length - 1; i >= 0; i--) {
      const parentPath = pathParts.slice(0, i).join('/');
      const parentSettings = parentPath ? conversionConfig.items[parentPath] : undefined;

      if (parentSettings && parentSettings.videoFrameRate !== undefined) {
        return {
          frameRate: parentSettings.videoFrameRate,
          isInherited: true,
          inheritedFrom: parentPath || t('Root'),
        };
      }
    }

    // 没有配置，返回 undefined（使用默认值）
    return {
      frameRate: undefined,
      isInherited: false,
    };
  }, [selectedAsset, conversionConfig]);

  // 获取有效 Dither 配置（处理继承）
  const effectiveDither = useMemo((): { dither: boolean; isInherited: boolean; inheritedFrom?: string } => {
    if (!selectedAsset || !conversionConfig) {
      return { dither: false, isInherited: false };
    }

    const assetPath = (selectedAsset.relativePath || selectedAsset.name).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const itemSettings = conversionConfig.items[assetPath];

    // 如果有明确配置，直接使用
    if (itemSettings && itemSettings.dither !== undefined) {
      return { dither: itemSettings.dither, isInherited: false };
    }

    // 需要继承：查找父级配置
    const pathParts = assetPath.split('/');
    for (let i = pathParts.length - 1; i >= 0; i--) {
      const parentPath = pathParts.slice(0, i).join('/');
      const parentSettings = parentPath ? conversionConfig.items[parentPath] : undefined;

      if (parentSettings && parentSettings.dither !== undefined) {
        return {
          dither: parentSettings.dither,
          isInherited: true,
          inheritedFrom: parentPath || t('Root'),
        };
      }
    }

    // 使用默认配置
    return {
      dither: conversionConfig.defaultSettings.dither ?? false,
      isInherited: true,
      inheritedFrom: t('defaultSettings'),
    };
  }, [selectedAsset, conversionConfig]);

  // 获取有效部署方式（处理继承，仅 LVGL 项目使用）
  const effectiveDeployment = useMemo((): { deployment: DeploymentMode; isInherited: boolean; inheritedFrom?: string } => {
    if (!selectedAsset || !conversionConfig) {
      return { deployment: 'c-array', isInherited: false };
    }

    const assetPath = (selectedAsset.relativePath || selectedAsset.name).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const itemSettings = conversionConfig.items[assetPath];

    // 如果有明确配置且不是 inherit，直接使用
    if (itemSettings && itemSettings.deployment && itemSettings.deployment !== 'inherit') {
      return { deployment: itemSettings.deployment, isInherited: false };
    }

    // 需要继承：查找父级配置
    const pathParts = assetPath.split('/');
    for (let i = pathParts.length - 1; i >= 0; i--) {
      const parentPath = pathParts.slice(0, i).join('/');
      const parentSettings = parentPath ? conversionConfig.items[parentPath] : undefined;

      if (parentSettings && parentSettings.deployment && parentSettings.deployment !== 'inherit') {
        return {
          deployment: parentSettings.deployment,
          isInherited: true,
          inheritedFrom: parentPath || t('Root'),
        };
      }
    }

    // 检查 defaultSettings
    const defaultDeployment = conversionConfig.defaultSettings?.deployment;
    if (defaultDeployment && defaultDeployment !== 'inherit') {
      return {
        deployment: defaultDeployment,
        isInherited: true,
        inheritedFrom: t('defaultSettings'),
      };
    }

    // 最终 fallback：c-array
    return {
      deployment: 'c-array',
      isInherited: true,
      inheritedFrom: t('defaultSettings'),
    };
  }, [selectedAsset, conversionConfig]);

  // 处理格式变更
  const handleFormatChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!selectedAsset) return;
      const newFormat = e.target.value as TargetFormat;
      const assetPath = selectedAsset.relativePath || selectedAsset.name;
      updateAssetConfig(assetPath, {
        ...currentSettings,
        format: newFormat,
      });
    },
    [selectedAsset, currentSettings, updateAssetConfig]
  );

  // 处理视频格式变更
  const handleVideoFormatChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!selectedAsset) return;
      const newFormat = e.target.value as VideoFormat;
      const assetPath = selectedAsset.relativePath || selectedAsset.name;
      updateAssetConfig(assetPath, {
        ...currentSettings,
        videoFormat: newFormat,
        videoQuality: undefined, // Switch format, reset quality to default
      }, 'videoFormat'); // 传递变更字段，触发代码生成
    },
    [selectedAsset, currentSettings, updateAssetConfig]
  );

  // 处理视频质量变更
  const handleVideoQualityChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!selectedAsset) return;
      const value = e.target.value;
      const assetPath = selectedAsset.relativePath || selectedAsset.name;
      // 允许空值（使用默认值）
      const quality = value === '' ? undefined : parseInt(value, 10);
      updateAssetConfig(assetPath, {
        ...currentSettings,
        videoQuality: quality,
      });
    },
    [selectedAsset, currentSettings, updateAssetConfig]
  );

  // 处理视频帧率变更
  const handleVideoFrameRateChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!selectedAsset) return;
      const value = e.target.value;
      const assetPath = selectedAsset.relativePath || selectedAsset.name;
      // 允许空值（使用默认值）
      const frameRate = value === '' ? undefined : parseInt(value, 10);
      updateAssetConfig(assetPath, {
        ...currentSettings,
        videoFrameRate: frameRate,
      });
    },
    [selectedAsset, currentSettings, updateAssetConfig]
  );

  // 处理 Dither 变更
  const handleDitherChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!selectedAsset) return;
      const newValue = e.target.checked;
      const assetPath = selectedAsset.relativePath || selectedAsset.name;
      updateAssetConfig(assetPath, {
        ...currentSettings,
        dither: newValue,
      });
    },
    [selectedAsset, currentSettings, updateAssetConfig]
  );

  // 处理部署方式变更（仅 LVGL 项目）
  const handleDeploymentChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!selectedAsset) return;
      const newDeployment = e.target.value as DeploymentMode;
      const assetPath = selectedAsset.relativePath || selectedAsset.name;
      const newSettings: ItemSettings = {
        ...currentSettings,
        deployment: newDeployment,
      };

      // LVGL external-bin 模式压缩限制：
      // 当切换到 external-bin 时，如果当前压缩方式不在允许列表中（none, rle），
      // 自动重置为 'none'
      if (newDeployment === 'external-bin') {
        const allowedCompressions: CompressionMethod[] = ['none', 'rle'];
        const currentComp = currentSettings.compression || 'inherit';
        // 如果当前压缩方式不在允许列表中，重置为 'none'
        if (currentComp !== 'inherit' && !allowedCompressions.includes(currentComp)) {
          newSettings.compression = 'none';
        }
      }

      // 传递 changedField='deployment'，触发后端代码生成
      // （切换 c-array / external-bin 会改变 lv_img_dsc_list 与 entry 文件）
      updateAssetConfig(assetPath, newSettings, 'deployment');
    },
    [selectedAsset, currentSettings, updateAssetConfig]
  );

  // 处理压缩方式变更
  const handleCompressionChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!selectedAsset) return;
      const newCompression = e.target.value as CompressionMethod;
      const assetPath = selectedAsset.relativePath || selectedAsset.name;
      const newSettings: ItemSettings = {
        ...currentSettings,
        compression: newCompression,
      };
      // 如果选择 YUV，添加默认 YUV 参数
      if (newCompression === 'yuv' && !newSettings.yuvParams) {
        newSettings.yuvParams = {
          sampling: 'YUV422',
          blur: 'none',
          fastlzSecondary: false,
        };
      }
      // 如果不是 YUV，移除 YUV 参数
      if (newCompression !== 'yuv') {
        delete newSettings.yuvParams;
      }
      // 如果选择 JPEG，添加默认 JPEG 参数
      if (newCompression === 'jpeg' && !newSettings.jpegParams) {
        newSettings.jpegParams = {
          sampling: 'YUV420',
          quality: 10,
          backgroundColor: 'black',
        };
      }
      // 如果不是 JPEG，移除 JPEG 参数
      if (newCompression !== 'jpeg') {
        delete newSettings.jpegParams;
      }
      updateAssetConfig(assetPath, newSettings);
    },
    [selectedAsset, currentSettings, updateAssetConfig]
  );

  // 处理 YUV 采样方式变更
  const handleYuvSamplingChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!selectedAsset) return;
      const newSampling = e.target.value as YuvSampling;
      const assetPath = selectedAsset.relativePath || selectedAsset.name;
      updateAssetConfig(assetPath, {
        ...currentSettings,
        yuvParams: {
          ...(currentSettings.yuvParams || { sampling: 'YUV422', blur: 'none', fastlzSecondary: false }),
          sampling: newSampling,
        },
      });
    },
    [selectedAsset, currentSettings, updateAssetConfig]
  );

  // 处理 YUV 模糊程度变更
  const handleYuvBlurChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!selectedAsset) return;
      const newBlur = e.target.value as YuvBlur;
      const assetPath = selectedAsset.relativePath || selectedAsset.name;
      updateAssetConfig(assetPath, {
        ...currentSettings,
        yuvParams: {
          ...(currentSettings.yuvParams || { sampling: 'YUV422', blur: 'none', fastlzSecondary: false }),
          blur: newBlur,
        },
      });
    },
    [selectedAsset, currentSettings, updateAssetConfig]
  );

  // 处理 FastLZ 二次压缩变更
  const handleFastlzSecondaryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!selectedAsset) return;
      const newValue = e.target.checked;
      const assetPath = selectedAsset.relativePath || selectedAsset.name;
      updateAssetConfig(assetPath, {
        ...currentSettings,
        yuvParams: {
          ...(currentSettings.yuvParams || { sampling: 'YUV422', blur: 'none', fastlzSecondary: false }),
          fastlzSecondary: newValue,
        },
      });
    },
    [selectedAsset, currentSettings, updateAssetConfig]
  );

  // 处理字体"直接拷贝"变更
  const handleFontCopyOnlyChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!selectedAsset) return;
      const newValue = e.target.checked;
      const assetPath = selectedAsset.relativePath || selectedAsset.name;
      updateAssetConfig(assetPath, {
        ...currentSettings,
        fontCopyOnly: newValue,
      });
    },
    [selectedAsset, currentSettings, updateAssetConfig]
  );

  // 处理 JPEG 采样方式变更
  const handleJpegSamplingChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!selectedAsset) return;
      const newSampling = e.target.value as JpegSampling;
      const assetPath = selectedAsset.relativePath || selectedAsset.name;
      updateAssetConfig(assetPath, {
        ...currentSettings,
        jpegParams: {
          ...(currentSettings.jpegParams || { sampling: 'YUV420', quality: 10, backgroundColor: 'black' }),
          sampling: newSampling,
        },
      });
    },
    [selectedAsset, currentSettings, updateAssetConfig]
  );

  // 处理 JPEG 质量变更
  const handleJpegQualityChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!selectedAsset) return;
      const value = parseInt(e.target.value, 10);
      if (isNaN(value) || value < 1 || value > 31) return;
      const assetPath = selectedAsset.relativePath || selectedAsset.name;
      updateAssetConfig(assetPath, {
        ...currentSettings,
        jpegParams: {
          ...(currentSettings.jpegParams || { sampling: 'YUV420', quality: 10, backgroundColor: 'black' }),
          quality: value,
        },
      });
    },
    [selectedAsset, currentSettings, updateAssetConfig]
  );

  // 处理 JPEG 背景色变更
  const handleJpegBackgroundColorChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!selectedAsset) return;
      const newColor = e.target.value;
      const assetPath = selectedAsset.relativePath || selectedAsset.name;
      updateAssetConfig(assetPath, {
        ...currentSettings,
        jpegParams: {
          ...(currentSettings.jpegParams || { sampling: 'YUV420', quality: 10, backgroundColor: 'black' }),
          backgroundColor: newColor,
        },
      });
    },
    [selectedAsset, currentSettings, updateAssetConfig]
  );

  // 如果没有选中资源，显示提示
  if (!selectedAsset) {
    return (
      <div className="conversion-config-panel">
        <div className="conversion-config-header">
          <h3>{t('Conversion Settings')}</h3>
        </div>
        <div className="conversion-config-content">
          <div className="no-selection">{t('selectAssetToConfig')}</div>
        </div>
      </div>
    );
  }

  const formatOptions = isFolder ? FOLDER_FORMAT_OPTIONS : IMAGE_FORMAT_OPTIONS;
  const videoFormatOptions = isFolder ? FOLDER_VIDEO_FORMAT_OPTIONS : VIDEO_FORMAT_OPTIONS;
  const deploymentOptions = isFolder ? FOLDER_DEPLOYMENT_OPTIONS : DEPLOYMENT_OPTIONS;
  const currentFormat = currentSettings.format || (isFolder ? 'adaptive16' : 'inherit');
  const currentVideoFormat = currentSettings.videoFormat || (isFolder ? 'MJPEG' : 'inherit');
  const currentCompression = currentSettings.compression || 'inherit';
  const currentDeployment: DeploymentMode = currentSettings.deployment || (isFolder ? 'c-array' : 'inherit');
  const showYuvParams = currentCompression === 'yuv' || effectiveSettings.settings.compression === 'yuv';
  const showJpegParams = currentCompression === 'jpeg' || effectiveSettings.settings.compression === 'jpeg';

  // 根据目标引擎和部署模式选择压缩选项
  // - HoneyGUI 项目：支持所有压缩方式
  // - LVGL c-array 模式：支持 none, rle（LVGLImage.py 支持）
  // - LVGL external-bin 模式：支持 none, rle（仅 RLE 在 LVGL 实机可解析）
  const compressionOptions = useMemo(() => {
    if (!isLvglProject) {
      // HoneyGUI 项目：支持所有压缩方式
      return isFolder ? FOLDER_COMPRESSION_OPTIONS_HONEYGUI : COMPRESSION_OPTIONS_HONEYGUI;
    }
    // LVGL 项目：根据部署模式选择
    // 注意：文件夹的 deployment 可能是 'c-array' 或 'external-bin'（无继承）
    // 图片的 deployment 可能是 'inherit'，需要解析
    const effectiveDeploymentMode = currentDeployment === 'inherit'
      ? (effectiveSettings.settings.deployment || 'c-array')
      : currentDeployment;

    if (effectiveDeploymentMode === 'external-bin') {
      // LVGL external-bin 模式：仅支持 none, rle
      return isFolder ? FOLDER_COMPRESSION_OPTIONS_LVGL_BIN : COMPRESSION_OPTIONS_LVGL_BIN;
    }
    // LVGL c-array 模式：支持 none, rle
    return isFolder ? FOLDER_COMPRESSION_OPTIONS_LVGL_CARRAY : COMPRESSION_OPTIONS_LVGL_CARRAY;
  }, [isLvglProject, isFolder, currentDeployment, effectiveSettings.settings.deployment]);

  // 渲染图片设置区域
  const renderImageSettings = () => (
    <div className="config-group">
      <div className="config-group-title">🖼️ {t('Image Settings')}</div>
      <div className="config-item">
        <label>{t('Target Format')}</label>
        <select value={currentFormat} onChange={handleFormatChange}>
          {formatOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label.startsWith('format') || option.label.startsWith('compression') || option.label.startsWith('blur')
                ? t(option.label as any)
                : option.label}
            </option>
          ))}
        </select>
        {/* 继承状态指示器 */}
        {effectiveSettings.isInherited && currentFormat === 'inherit' && (
          <div className="inherited-indicator">
            <span className="icon">↩️</span>
            <span>
              {t('inheritedFrom')}: {effectiveSettings.inheritedFrom} (
              {getFormatLabel(effectiveSettings.settings.format || 'RGB565')})
            </span>
          </div>
        )}
      </div>
      <div className="config-item">
        <label>{t('Compression Method')}</label>
        <select value={currentCompression} onChange={handleCompressionChange}>
          {compressionOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.label as any)}
            </option>
          ))}
        </select>
        {/* 压缩方式继承状态指示器 */}
        {currentCompression === 'inherit' && effectiveSettings.isInherited && (
          <div className="inherited-indicator">
            <span className="icon">↩️</span>
            <span>
              {t('inheritedFrom')}: {effectiveSettings.inheritedFrom} (
              {getCompressionLabel(effectiveSettings.settings.compression || 'adaptive')})
            </span>
          </div>
        )}
        {currentCompression === 'adaptive' && (
          <div className="config-hint">{t('adaptiveCompressionHint')}</div>
        )}
      </div>

      {/* 部署方式：仅 LVGL 项目显示 */}
      {isLvglProject && (
        <div className="config-item">
          <label>{t('Deployment')}</label>
          <select value={currentDeployment} onChange={handleDeploymentChange}>
            {deploymentOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label as any)}
              </option>
            ))}
          </select>
          {/* 部署方式继承状态指示器（仅图片可选 inherit） */}
          {currentDeployment === 'inherit' && effectiveDeployment.isInherited && (
            <div className="inherited-indicator">
              <span className="icon">↩️</span>
              <span>
                {t('inheritedFrom')}: {effectiveDeployment.inheritedFrom} (
                {getDeploymentLabel(effectiveDeployment.deployment)})
              </span>
            </div>
          )}
          <div className="config-hint">{t('deploymentHint')}</div>
        </div>
      )}

      <div className="config-item checkbox-item">
        <div className="checkbox-wrapper">
          <input
            type="checkbox"
            id="dither"
            checked={currentSettings.dither ?? effectiveDither.dither}
            onChange={handleDitherChange}
          />
          <label htmlFor="dither">{t('Enable Dither')}</label>
        </div>
        <div className="config-hint">{t('ditherHint')}</div>
        {/* Dither 继承状态指示器 */}
        {effectiveDither.isInherited && currentSettings.dither === undefined && (
          <div className="inherited-indicator">
            <span className="icon">↩️</span>
            <span>
              {t('inheritedFrom')}: {effectiveDither.inheritedFrom} ({effectiveDither.dither ? t('Enabled') : t('Disabled')})
            </span>
          </div>
        )}
      </div>

      {/* YUV 参数配置 */}
      {showYuvParams && (
        <div className="yuv-params-section">
          <div className="yuv-params-title">{t('YUV Parameters')}</div>
          <div className="yuv-params-grid">
            <div className="yuv-param-item">
              <label>{t('Sampling')}</label>
              <select
                value={currentSettings.yuvParams?.sampling || effectiveSettings.settings.yuvParams?.sampling || 'YUV422'}
                onChange={handleYuvSamplingChange}
              >
                {YUV_SAMPLING_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="yuv-param-item">
              <label>{t('Blur')}</label>
              <select
                value={currentSettings.yuvParams?.blur || effectiveSettings.settings.yuvParams?.blur || 'none'}
                onChange={handleYuvBlurChange}
              >
                {YUV_BLUR_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {getBlurLabel(option.value)}
                  </option>
                ))}
              </select>
            </div>
            <div className="checkbox-wrapper">
              <input
                type="checkbox"
                id="fastlzSecondary"
                checked={
                  currentSettings.yuvParams?.fastlzSecondary ??
                  effectiveSettings.settings.yuvParams?.fastlzSecondary ??
                  false
                }
                onChange={handleFastlzSecondaryChange}
              />
              <label htmlFor="fastlzSecondary">{t('FastLZ Secondary Compression')}</label>
            </div>
          </div>
        </div>
      )}

      {/* JPEG 参数配置 */}
      {showJpegParams && (
        <div className="jpeg-params-section">
          <div className="jpeg-params-title">{t('jpegParameters')}</div>
          <div className="jpeg-params-grid">
            <div className="jpeg-param-item">
              <label>{t('Sampling')}</label>
              <select
                value={currentSettings.jpegParams?.sampling || effectiveSettings.settings.jpegParams?.sampling || 'YUV420'}
                onChange={handleJpegSamplingChange}
              >
                {JPEG_SAMPLING_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label.startsWith('jpeg') ? t(option.label as any) : option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="jpeg-param-item">
              <label>{t('jpegQuality')}</label>
              <div className="jpeg-quality-control">
                <input
                  type="range"
                  min={1}
                  max={31}
                  value={currentSettings.jpegParams?.quality ?? effectiveSettings.settings.jpegParams?.quality ?? 10}
                  onChange={handleJpegQualityChange}
                />
                <span className="jpeg-quality-value">
                  {currentSettings.jpegParams?.quality ?? effectiveSettings.settings.jpegParams?.quality ?? 10}
                </span>
              </div>
              <div className="config-hint">{t('jpegQualityHint')}</div>
            </div>
            <div className="jpeg-param-item">
              <label>{t('jpegBackgroundColor')}</label>
              <div className="jpeg-color-control">
                <input
                  type="color"
                  className="jpeg-color-picker"
                  value={currentSettings.jpegParams?.backgroundColor || effectiveSettings.settings.jpegParams?.backgroundColor || '#000000'}
                  onChange={handleJpegBackgroundColorChange}
                />
                <input
                  type="text"
                  className="jpeg-color-text"
                  value={currentSettings.jpegParams?.backgroundColor || effectiveSettings.settings.jpegParams?.backgroundColor || 'black'}
                  onChange={handleJpegBackgroundColorChange}
                  placeholder="black, #FF0000..."
                />
              </div>
              <div className="config-hint">{t('jpegBackgroundColorHint')}</div>
            </div>
          </div>
          <div className="config-hint jpeg-ffmpeg-hint">⚠️ {t('jpegRequiresFFmpeg')}</div>
        </div>
      )}
    </div>
  );

  // 渲染视频设置区域
  const renderVideoSettings = () => {
    // 获取有效的视频格式（用于确定质量范围）
    const effectiveFormat = currentVideoFormat === 'inherit'
      ? effectiveVideoSettings.videoFormat
      : currentVideoFormat;

    // 根据格式确定质量范围和默认值
    const isH264 = effectiveFormat === 'H264';
    const qualityMin = isH264 ? 0 : 1;
    const qualityMax = isH264 ? 51 : 31;
    const qualityDefault = isH264 ? 23 : 5;
    const qualityLabel = isH264 ? t('CRF Quality (0-51)') : t('Quality (1-31)');
    const qualityHint = isH264 ? t('H.264 CRF value, 0=lossless, 23=default, 51=lowest') : t('JPEG compression quality, 1=highest, 5=default, 31=lowest');

    // 当前质量值和帧率值
    const currentQuality = currentSettings.videoQuality;
    const currentFrameRate = currentSettings.videoFrameRate;

    return (
      <div className="config-group">
        <div className="config-group-title">🎬 {t('Video Settings')}</div>
        <div className="config-item">
          <label>{t('Target Format')}</label>
          <select value={currentVideoFormat} onChange={handleVideoFormatChange}>
            {videoFormatOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label === 'formatInherit' ? t('formatInherit') : option.label}
              </option>
            ))}
          </select>
          {/* 视频格式继承状态指示器 */}
          {effectiveVideoSettings.isInherited && currentVideoFormat === 'inherit' && (
            <div className="inherited-indicator">
              <span className="icon">↩️</span>
              <span>
                {t('inheritedFrom')}: {effectiveVideoSettings.inheritedFrom} ({effectiveVideoSettings.videoFormat})
              </span>
            </div>
          )}
        </div>
        <div className="config-item">
          <label>{qualityLabel}</label>
          <input
            type="number"
            min={qualityMin}
            max={qualityMax}
            value={currentQuality ?? ''}
            placeholder={String(qualityDefault)}
            onChange={handleVideoQualityChange}
          />
          <div className="config-hint">{qualityHint}</div>
          {/* 视频质量继承状态指示器 */}
          {effectiveVideoQuality.isInherited && currentQuality === undefined && (
            <div className="inherited-indicator">
              <span className="icon">↩️</span>
              <span>
                {t('inheritedFrom')}: {effectiveVideoQuality.inheritedFrom} ({effectiveVideoQuality.quality})
              </span>
            </div>
          )}
        </div>
        <div className="config-item">
          <label>{t('Frame Rate (FPS)')}</label>
          <input
            type="number"
            min={1}
            max={60}
            value={currentFrameRate ?? ''}
            placeholder="30"
            onChange={handleVideoFrameRateChange}
          />
          <div className="config-hint">{t('Output video frame rate')}</div>
          {/* 视频帧率继承状态指示器 */}
          {effectiveVideoFrameRate.isInherited && currentFrameRate === undefined && (
            <div className="inherited-indicator">
              <span className="icon">↩️</span>
              <span>
                {t('inheritedFrom')}: {effectiveVideoFrameRate.inheritedFrom} ({effectiveVideoFrameRate.frameRate})
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="conversion-config-panel">
      <div className="conversion-config-header">
        <h3>{t('Conversion Settings')}</h3>
      </div>
      <div className="conversion-config-content">
        {/* 资源信息 */}
        <div className="asset-info-section">
          <div className="asset-name">
            <span className="asset-icon">{isFolder ? '📁' : isVideo ? '🎬' : isFont ? '🔤' : '🖼️'}</span>
            <span>{selectedAsset.name}</span>
          </div>
          {selectedAsset.relativePath && (
            <div className="asset-path">{selectedAsset.relativePath}</div>
          )}
          {!isFolder && assetMetadata && (
            <div className="asset-metadata">
              {assetMetadata.width && assetMetadata.height && (
                <span className="asset-meta-item">{assetMetadata.width} × {assetMetadata.height} px</span>
              )}
              {assetMetadata.fileSize != null && (
                <span className="asset-meta-item">{formatFileSize(assetMetadata.fileSize)}</span>
              )}
            </div>
          )}
        </div>

        {/* 根据资源类型显示不同的配置区域 */}
        {isFolder ? (
          <>
            {/* 文件夹：同时显示图片和视频设置 */}
            {renderImageSettings()}
            {renderVideoSettings()}
          </>
        ) : isVideo ? (
          /* 视频文件：只显示视频设置 */
          renderVideoSettings()
        ) : isFont ? (
          /* 字体文件：显示"直接拷贝"选项 */
          <div className="config-section">
            <div className="config-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={currentSettings.fontCopyOnly ?? false}
                  onChange={handleFontCopyOnlyChange}
                />
                <span>{t('Copy only (no format conversion)')}</span>
              </label>
            </div>
            {!(currentSettings.fontCopyOnly) && (
              <div className="config-hint">
                {t('Font files do not require conversion settings')}
              </div>
            )}
          </div>
        ) : (
          /* 图片文件：只显示图片设置 */
          renderImageSettings()
        )}
      </div>
    </div>
  );
};

export default ConversionConfigPanel;
