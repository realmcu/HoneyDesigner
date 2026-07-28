import React, { useEffect, useState } from 'react';
import { WidgetProps } from './types';
import { useWebviewUri } from '../../hooks/useWebviewUri';
import { markImageFailed, markImageReady } from '../../utils/imageLoadTracker';

/**
 * 将 0xFFRRGGBB 格式转换为 CSS rgba 颜色
 */
const argbToRgba = (argb: string | undefined, alpha: number = 1): string => {
  if (!argb || !argb.startsWith('0x')) return `rgba(255, 255, 255, ${alpha})`;
  const hex = argb.substring(4); // 去掉 0xFF
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/**
 * 将图片中纯黑像素 (R=0, G=0, B=0) 设为透明，模拟 IMG_FILTER_BLACK 渲染模式
 */
function useFilterBlack(srcUri: string | undefined, enabled: boolean): string | undefined {
  const [filteredUrl, setFilteredUrl] = useState<string | undefined>();

  useEffect(() => {
    if (!srcUri || !enabled) {
      setFilteredUrl(undefined);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(srcUri);
        const blob = await response.blob();
        const imageBitmap = await createImageBitmap(blob);

        if (cancelled) return;

        const canvas = document.createElement('canvas');
        canvas.width = imageBitmap.width;
        canvas.height = imageBitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(imageBitmap, 0, 0);
        imageBitmap.close();

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // 纯黑像素 (R=0, G=0, B=0) → alpha 设为 0（透明）
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0) {
            data[i + 3] = 0;
          }
        }

        ctx.putImageData(imageData, 0, 0);

        if (cancelled) return;

        const dataUrl = canvas.toDataURL('image/png');
        setFilteredUrl(dataUrl);
      } catch (err) {
        console.error('Failed to filter black pixels:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [srcUri, enabled]);

  return filteredUrl;
}

/**
 * 将图片 alpha 通道量化为指定位数（MSB），返回处理后的 data URL
 * A4: 4-bit (16 levels), A2: 2-bit (4 levels), A1: 1-bit (2 levels)
 */
function useQuantizedAlphaMask(srcUri: string | undefined, assetFormat: string | undefined): string | undefined {
  const [maskUrl, setMaskUrl] = useState<string | undefined>();

  const shiftBits = assetFormat === 'A4' ? 4 : assetFormat === 'A2' ? 6 : assetFormat === 'A1' ? 7 : 0;

  useEffect(() => {
    if (!srcUri || shiftBits === 0) {
      setMaskUrl(undefined);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(srcUri);
        const blob = await response.blob();
        const imageBitmap = await createImageBitmap(blob);

        if (cancelled) return;

        const canvas = document.createElement('canvas');
        canvas.width = imageBitmap.width;
        canvas.height = imageBitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(imageBitmap, 0, 0);
        imageBitmap.close();

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Quantize alpha with bit replication:
        // A4: MSB 4-bit replicated once → 0xC0 → 0xCC
        // A2: MSB 2-bit replicated 3 times → 0xC0 → 0xFF
        // A1: MSB 1-bit replicated 7 times → 0x80 → 0xFF
        for (let i = 3; i < data.length; i += 4) {
          const a = data[i];
          if (shiftBits === 4) {
            const msb = a >> 4;
            data[i] = (msb << 4) | msb;
          } else if (shiftBits === 6) {
            const msb = a >> 6;
            data[i] = (msb << 6) | (msb << 4) | (msb << 2) | msb;
          } else {
            // A1: shiftBits === 7
            data[i] = (a >> 7) * 255;
          }
        }

        ctx.putImageData(imageData, 0, 0);

        if (cancelled) return;

        // Use data URL instead of blob URL to comply with CSP
        const dataUrl = canvas.toDataURL('image/png');
        setMaskUrl(dataUrl);
      } catch (err) {
        console.error('Failed to quantize alpha mask:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [srcUri, shiftBits]);

  return maskUrl;
}

export const ImageWidget: React.FC<WidgetProps> = ({ component, style, handlers }) => {
  const webviewUri = useWebviewUri(component.data?.src);

  useEffect(() => {
    if (!webviewUri) {
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) {
        void image.decode().catch(() => {}).finally(() => markImageReady(component.id));
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        markImageFailed(component.id);
      }
    };
    image.src = webviewUri;
    return () => {
      cancelled = true;
    };
  }, [component.id, webviewUri]);

  // 检查渲染模式
  const blendMode = component.data?.blendMode;
  const isBypassMode = blendMode === 'IMG_BYPASS_MODE';
  const isCoverMode = blendMode === 'IMG_COVER_MODE';
  const isFilterBlack = !blendMode || blendMode === 'IMG_FILTER_BLACK';
  const isA8FG = blendMode === 'IMG_2D_SW_FIX_A8_FG';
  const isA8BGFG = blendMode === 'IMG_2D_SW_FIX_A8_BGFG';
  const isA8Mode = isA8FG || isA8BGFG;

  // IMG_FILTER_BLACK：过滤纯黑像素
  const filteredBlackUrl = useFilterBlack(webviewUri, isFilterBlack);
  
  // 资源格式量化
  const assetFormat = isA8Mode ? component.data?.assetFormat : undefined;
  const needsQuantization = isA8Mode && (assetFormat === 'A4' || assetFormat === 'A2' || assetFormat === 'A1');
  const quantizedMaskUrl = useQuantizedAlphaMask(webviewUri, needsQuantization ? assetFormat : undefined);

  // 用于 mask 的 URL：量化格式时使用处理后的图片，否则使用原始图片
  const maskUri = needsQuantization ? (quantizedMaskUrl || webviewUri) : webviewUri;

  // 获取前景色和背景色
  const fgColor = component.data?.fgColor;
  const bgColor = component.data?.bgColor;
  
  // A8 模式的样式处理
  let imageStyle: React.CSSProperties = {
    ...style,
  };
  
  if (webviewUri && (isBypassMode || isCoverMode)) {
    // BYPASS / COVER 模式：直接像素拷贝，不进行 alpha 混合，用黑色底色模拟帧缓冲
    imageStyle = {
      ...style,
      backgroundColor: '#000000',
      backgroundImage: `url(${webviewUri})`,
      backgroundSize: 'contain',
      backgroundRepeat: 'no-repeat',
    };
  } else if (webviewUri && isFilterBlack) {
    // FILTER_BLACK 模式：纯黑像素被过滤为透明（默认模式）
    const displayUri = filteredBlackUrl || webviewUri;
    imageStyle = {
      ...style,
      backgroundImage: `url(${displayUri})`,
      backgroundSize: 'contain',
      backgroundRepeat: 'no-repeat',
    };
  } else if (webviewUri && isA8Mode) {
    // A8 模式：图片作为 alpha 通道，应用颜色
    // 使用双层结构：背景色层 + 前景色层（使用图片作为 mask）
    imageStyle = {
      ...style,
      background: isA8BGFG && bgColor ? argbToRgba(bgColor) : 'transparent',
    };
  } else if (webviewUri) {
    // 普通模式：直接显示图片
    imageStyle = {
      ...style,
      backgroundImage: `url(${webviewUri})`,
      backgroundSize: 'contain',
      backgroundRepeat: 'no-repeat',
    };
  }

  return (
    <div style={imageStyle} {...handlers}>
      {webviewUri && isA8Mode ? (
        // A8 模式：使用 mask 应用前景色
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: fgColor ? argbToRgba(fgColor) : '#FFFFFF',
          WebkitMaskImage: `url(${maskUri})`,
          WebkitMaskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          maskImage: `url(${maskUri})`,
          maskSize: 'contain',
          maskRepeat: 'no-repeat',
        }} />
      ) : !webviewUri ? (
        // 未选择图片时的占位符
        <div style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px dashed #666',
          borderRadius: '4px',
          backgroundColor: 'rgba(128,128,128,0.1)',
          color: '#888',
          fontSize: '12px',
          gap: '4px',
          boxSizing: 'border-box'
        }}>
          <span style={{ fontSize: '24px' }}>🖼️</span>
          <span>选择图片</span>
        </div>
      ) : null}
    </div>
  );
};
