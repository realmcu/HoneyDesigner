import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WidgetProps } from './types';
import { useWebviewUri } from '../../hooks/useWebviewUri';
import { useDesignerStore } from '../../store';

export const VideoWidget: React.FC<WidgetProps> = ({ component, style, handlers }) => {
  const videoPath = component.data?.src as string;
  const webviewUri = useWebviewUri(videoPath);
  const [error, setError] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileName = videoPath ? videoPath.split('/').pop() : '';

  const conversionConfig = useDesignerStore(state => state.conversionConfig);
  const updateComponent = useDesignerStore(state => state.updateComponent);

  // 从 conversion.json 读取当前视频的所有配置
  const videoItemSettings = useMemo(() => {
    if (!conversionConfig || !videoPath) return undefined;
    const key = videoPath.replace(/\\/g, '/').replace(/^assets\//i, '');
    return conversionConfig.items[key];
  }, [conversionConfig, videoPath]);

  const videoScaleConfig = videoItemSettings?.videoScale;
  const videoCropConfig = videoItemSettings?.videoCrop;
  const preprocessOrder = videoItemSettings?.preprocessOrder ?? 'crop-then-scale';

  // 计算最终输出尺寸（考虑裁剪和缩放的顺序），用于自动同步组件宽高
  const displaySize = useMemo((): { w: number; h: number } | null => {
    const nat = naturalSize;

    if (preprocessOrder === 'crop-then-scale') {
      let baseW: number | null = nat?.w ?? null;
      let baseH: number | null = nat?.h ?? null;

      if (videoCropConfig) {
        baseW = videoCropConfig.width;
        baseH = videoCropConfig.height;
      }

      if (videoScaleConfig && baseW !== null && baseH !== null) {
        if (videoScaleConfig.mode === 'pixels') {
          const sw = videoScaleConfig.width;
          const sh = videoScaleConfig.height;
          if (sw && sh) return { w: sw, h: sh };
          if (sw) return { w: sw, h: Math.round(baseH * sw / baseW) };
          if (sh) return { w: Math.round(baseW * sh / baseH), h: sh };
        } else {
          const wp = videoScaleConfig.widthPercentage;
          const hp = videoScaleConfig.heightPercentage;
          if (wp !== undefined && hp !== undefined) return { w: Math.round(baseW * wp / 100), h: Math.round(baseH * hp / 100) };
          if (wp !== undefined) return { w: Math.round(baseW * wp / 100), h: Math.round(baseH * wp / 100) };
          if (hp !== undefined) return { w: Math.round(baseW * hp / 100), h: Math.round(baseH * hp / 100) };
        }
      }

      if (videoCropConfig) return { w: videoCropConfig.width, h: videoCropConfig.height };

      if (videoScaleConfig) {
        if (videoScaleConfig.mode === 'pixels') {
          const sw = videoScaleConfig.width;
          const sh = videoScaleConfig.height;
          if (sw && sh) return { w: sw, h: sh };
          if (nat) {
            if (sw) return { w: sw, h: Math.round(nat.h * sw / nat.w) };
            if (sh) return { w: Math.round(nat.w * sh / nat.h), h: sh };
          }
        } else if (nat) {
          const wp = videoScaleConfig.widthPercentage;
          const hp = videoScaleConfig.heightPercentage;
          if (wp !== undefined && hp !== undefined) return { w: Math.round(nat.w * wp / 100), h: Math.round(nat.h * hp / 100) };
          if (wp !== undefined) return { w: Math.round(nat.w * wp / 100), h: Math.round(nat.h * wp / 100) };
          if (hp !== undefined) return { w: Math.round(nat.w * hp / 100), h: Math.round(nat.h * hp / 100) };
        }
      }
      // 无裁剪且无缩放：恢复视频原始尺寸
      if (nat) return { w: nat.w, h: nat.h };
    } else {
      if (videoCropConfig) return { w: videoCropConfig.width, h: videoCropConfig.height };

      if (!nat) {
        if (videoScaleConfig?.mode === 'pixels') {
          const sw = videoScaleConfig.width;
          const sh = videoScaleConfig.height;
          if (sw && sh) return { w: sw, h: sh };
        }
        return null;
      }

      let scaledW = nat.w;
      let scaledH = nat.h;
      if (videoScaleConfig) {
        if (videoScaleConfig.mode === 'pixels') {
          const sw = videoScaleConfig.width;
          const sh = videoScaleConfig.height;
          if (sw && sh) { scaledW = sw; scaledH = sh; }
          else if (sw) { scaledH = Math.round(nat.h * sw / nat.w); scaledW = sw; }
          else if (sh) { scaledW = Math.round(nat.w * sh / nat.h); scaledH = sh; }
        } else {
          const wp = videoScaleConfig.widthPercentage;
          const hp = videoScaleConfig.heightPercentage;
          if (wp !== undefined && hp !== undefined) { scaledW = Math.round(nat.w * wp / 100); scaledH = Math.round(nat.h * hp / 100); }
          else if (wp !== undefined) { scaledW = Math.round(nat.w * wp / 100); scaledH = Math.round(nat.h * wp / 100); }
          else if (hp !== undefined) { scaledW = Math.round(nat.w * hp / 100); scaledH = Math.round(nat.h * hp / 100); }
        }
      }
      return { w: scaledW, h: scaledH };
    }

    return null;
  }, [naturalSize, videoScaleConfig, videoCropConfig, preprocessOrder]);

  /**
   * 将视频当前帧绘制到 canvas，直接使用 drawImage 实现裁剪+缩放。
   * 直接从 video DOM 元素读取尺寸，避免 React 状态闭包陈旧问题。
   */
  const drawFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const natW = video.videoWidth;
    const natH = video.videoHeight;
    if (!natW || !natH) return;

    // 根据配置计算输出尺寸（与 displaySize 逻辑保持一致）
    let outW = natW;
    let outH = natH;

    if (preprocessOrder === 'crop-then-scale') {
      let baseW = videoCropConfig ? videoCropConfig.width : natW;
      let baseH = videoCropConfig ? videoCropConfig.height : natH;

      if (videoScaleConfig) {
        if (videoScaleConfig.mode === 'pixels') {
          const sw = videoScaleConfig.width, sh = videoScaleConfig.height;
          if (sw && sh) { outW = sw; outH = sh; }
          else if (sw) { outW = sw; outH = Math.round(baseH * sw / baseW); }
          else if (sh) { outH = sh; outW = Math.round(baseW * sh / baseH); }
          else { outW = baseW; outH = baseH; }
        } else {
          const wp = videoScaleConfig.widthPercentage, hp = videoScaleConfig.heightPercentage;
          if (wp !== undefined && hp !== undefined) { outW = Math.round(baseW * wp / 100); outH = Math.round(baseH * hp / 100); }
          else if (wp !== undefined) { outW = Math.round(baseW * wp / 100); outH = Math.round(baseH * wp / 100); }
          else if (hp !== undefined) { outW = Math.round(baseW * hp / 100); outH = Math.round(baseH * hp / 100); }
          else { outW = baseW; outH = baseH; }
        }
      } else {
        outW = baseW;
        outH = baseH;
      }
    } else {
      // scale-then-crop: 输出尺寸为裁剪区域大小
      outW = videoCropConfig ? videoCropConfig.width : natW;
      outH = videoCropConfig ? videoCropConfig.height : natH;
    }

    canvas.width = outW;
    canvas.height = outH;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!videoCropConfig) {
      // 无裁剪：全图缩放到输出尺寸
      ctx.drawImage(video, 0, 0, outW, outH);
    } else if (preprocessOrder === 'crop-then-scale') {
      // 先裁剪，再缩放：从原始视频裁剪后缩放到输出尺寸
      const cw = videoCropConfig.width, ch = videoCropConfig.height;
      const cx = videoCropConfig.x !== undefined ? videoCropConfig.x : Math.floor((natW - cw) / 2);
      const cy = videoCropConfig.y !== undefined ? videoCropConfig.y : Math.floor((natH - ch) / 2);
      ctx.drawImage(video, cx, cy, cw, ch, 0, 0, outW, outH);
    } else {
      // 先缩放，再裁剪：将裁剪坐标（缩放空间）映射回原始空间
      let scaledW = natW, scaledH = natH;
      if (videoScaleConfig) {
        if (videoScaleConfig.mode === 'pixels') {
          const sw = videoScaleConfig.width, sh = videoScaleConfig.height;
          if (sw && sh) { scaledW = sw; scaledH = sh; }
          else if (sw) { scaledH = Math.round(natH * sw / natW); scaledW = sw; }
          else if (sh) { scaledW = Math.round(natW * sh / natH); scaledH = sh; }
        } else {
          const wp = videoScaleConfig.widthPercentage, hp = videoScaleConfig.heightPercentage;
          if (wp !== undefined && hp !== undefined) { scaledW = Math.round(natW * wp / 100); scaledH = Math.round(natH * hp / 100); }
          else if (wp !== undefined) { scaledW = Math.round(natW * wp / 100); scaledH = Math.round(natH * wp / 100); }
          else if (hp !== undefined) { scaledW = Math.round(natW * hp / 100); scaledH = Math.round(natH * hp / 100); }
        }
      }
      const cw = videoCropConfig.width, ch = videoCropConfig.height;
      const cx = videoCropConfig.x !== undefined ? videoCropConfig.x : Math.floor((scaledW - cw) / 2);
      const cy = videoCropConfig.y !== undefined ? videoCropConfig.y : Math.floor((scaledH - ch) / 2);
      // 缩放空间坐标 → 原始图像坐标
      const srcX = cx * natW / scaledW;
      const srcY = cy * natH / scaledH;
      const srcW = cw * natW / scaledW;
      const srcH = ch * natH / scaledH;
      ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
    }
  }, [videoCropConfig, videoScaleConfig, preprocessOrder]);

  // 视频 seek 完成后绘制帧（onLoadedMetadata 中已触发 currentTime=0.1）
  const handleSeeked = useCallback(() => {
    drawFrame();
  }, [drawFrame]);

  // 裁剪/缩放配置变化时重新绘制
  useEffect(() => {
    const video = videoRef.current;
    if (video && naturalSize) {
      video.currentTime = 0.1;
    }
  }, [videoCropConfig, videoScaleConfig, preprocessOrder, naturalSize]);

  // 当浏览器无法解码视频时（如 .hgv 等专有格式），从后端 FFprobe 获取尺寸作为 fallback
  useEffect(() => {
    if (!videoPath) return;
    const vscodeAPI = (window as any).vscodeAPI;
    if (!vscodeAPI) return;

    vscodeAPI.postMessage({ command: 'getVideoNaturalSize', videoPath });

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.command === 'videoNaturalSizeResult' && event.data?.videoPath === videoPath) {
        const { width, height } = event.data;
        if (width > 0 && height > 0) {
          setNaturalSize(prev => prev ?? { w: width, h: height });
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [videoPath]);

  // 当输出尺寸改变时，自动同步组件宽高
  useEffect(() => {
    if (!displaySize) return;
    const { w, h } = displaySize;
    const current = useDesignerStore.getState().components.find(c => c.id === component.id);
    if (!current || (current.position.width === w && current.position.height === h)) return;
    updateComponent(component.id, { position: { ...current.position, width: w, height: h } }, { save: false });
  }, [displaySize?.w, displaySize?.h, component.id, updateComponent]);

  // 没有设置路径或加载失败时显示占位符
  if (!webviewUri || error) {
    return (
      <div key={component.id} style={style} {...handlers}>
        <div style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: videoPath ? '#1a1a2e' : 'rgba(100, 100, 100, 0.2)',
          border: videoPath ? 'none' : '2px dashed rgba(150, 150, 150, 0.5)',
          color: videoPath ? '#fff' : 'rgba(100, 100, 100, 0.8)',
          fontSize: '12px'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '8px' }}>
            {videoPath ? '▶️' : '🎬'}
          </div>
          <div>{videoPath ? fileName : '视频组件'}</div>
          {!videoPath && <div style={{ fontSize: '10px', marginTop: '4px' }}>设置 src 属性</div>}
        </div>
      </div>
    );
  }

  return (
    <div key={component.id} style={style} {...handlers}>
      {/* 隐藏的 video 元素，仅用于提取首帧 */}
      <video
        ref={videoRef}
        src={webviewUri}
        muted
        style={{ display: 'none', position: 'absolute' }}
        onLoadedMetadata={(e) => {
          const v = e.target as HTMLVideoElement;
          setNaturalSize({ w: v.videoWidth, h: v.videoHeight });
          v.currentTime = 0.1;
        }}
        onSeeked={handleSeeked}
        onError={() => setError(true)}
      />
      {/* Canvas 展示裁剪/缩放后的首帧预览 */}
      {naturalSize ? (
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
        />
      ) : (
        <div style={{
          width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#1a1a2e', color: '#888', fontSize: '12px', flexDirection: 'column'
        }}>
          <div style={{ fontSize: '32px', marginBottom: '4px' }}>▶️</div>
          <div>{fileName}</div>
        </div>
      )}
    </div>
  );
};

