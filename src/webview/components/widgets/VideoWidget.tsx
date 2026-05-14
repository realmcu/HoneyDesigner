import React, { useEffect, useMemo, useState } from 'react';
import { WidgetProps } from './types';
import { useWebviewUri } from '../../hooks/useWebviewUri';
import { useDesignerStore } from '../../store';

export const VideoWidget: React.FC<WidgetProps> = ({ component, style, handlers }) => {
  const videoPath = component.data?.src as string;
  const webviewUri = useWebviewUri(videoPath);
  const [error, setError] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const fileName = videoPath ? videoPath.split('/').pop() : '';

  const conversionConfig = useDesignerStore(state => state.conversionConfig);
  const updateComponent = useDesignerStore(state => state.updateComponent);

  // 查找当前视频的缩放配置
  const videoScaleConfig = useMemo(() => {
    if (!conversionConfig || !videoPath) return undefined;
    const key = videoPath.replace(/\\/g, '/').replace(/^assets\//i, '');
    return conversionConfig.items[key]?.videoScale;
  }, [conversionConfig, videoPath]);

  // 根据缩放配置和视频原始尺寸，计算输出尺寸（像素）
  const scaledDisplaySize = useMemo((): { w: number; h: number } | null => {
    if (!videoScaleConfig) return null;
    const nat = naturalSize;
    if (videoScaleConfig.mode === 'pixels') {
      const sw = videoScaleConfig.width;
      const sh = videoScaleConfig.height;
      if (sw && sh) return { w: sw, h: sh };
      if (sw && nat) return { w: sw, h: Math.round(nat.h * sw / nat.w) };
      if (sh && nat) return { w: Math.round(nat.w * sh / nat.h), h: sh };
    } else {
      if (!nat) return null;
      const wp = videoScaleConfig.widthPercentage;
      const hp = videoScaleConfig.heightPercentage;
      if (wp !== undefined && hp !== undefined) {
        return { w: Math.round(nat.w * wp / 100), h: Math.round(nat.h * hp / 100) };
      }
      if (wp !== undefined) return { w: Math.round(nat.w * wp / 100), h: Math.round(nat.h * wp / 100) };
      if (hp !== undefined) return { w: Math.round(nat.w * hp / 100), h: Math.round(nat.h * hp / 100) };
    }
    return null;
  }, [videoScaleConfig, naturalSize]);

  // 当缩放配置生效时，自动同步组件的宽高以匹配输出尺寸
  useEffect(() => {
    if (!scaledDisplaySize) return;
    const { w, h } = scaledDisplaySize;
    // 读取当前最新组件状态，避免 stale closure
    const current = useDesignerStore.getState().components.find(c => c.id === component.id);
    if (!current || (current.position.width === w && current.position.height === h)) return;
    updateComponent(component.id, { position: { ...current.position, width: w, height: h } }, { save: false });
  }, [scaledDisplaySize?.w, scaledDisplaySize?.h, component.id, updateComponent]);

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
    <div key={component.id} style={{ ...style, overflow: 'hidden' }} {...handlers}>
      <video
        src={webviewUri}
        muted
        style={{ width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none' }}
        onLoadedMetadata={(e) => {
          const v = e.target as HTMLVideoElement;
          setNaturalSize({ w: v.videoWidth, h: v.videoHeight });
        }}
        onLoadedData={(e) => {
          (e.target as HTMLVideoElement).currentTime = 0.1;
        }}
        onError={() => setError(true)}
      />
    </div>
  );
};
