import React from 'react';
import { WidgetProps } from './types';

export const ProgressBarWidget: React.FC<WidgetProps> = ({ component, style, handlers }) => {
  const value = Number(component.data?.value ?? 0);
  const min = Number(component.data?.min ?? 0);
  const max = Number(component.data?.max ?? 100);
  const barColor = (component.style as any)?.color || '#00FF00';
  const trackColor = (component.style as any)?.backgroundColor || '#333333';
  const orientation = (component.style as any)?.orientation || 'horizontal';
  const w = component.position?.width || 200;
  const h = component.position?.height || 20;

  const isVertical = orientation === 'vertical';
  const ratio = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  const trackRadius = (isVertical ? w : h) / 2;

  // 最底层背景（calculateComponentStyle 把 component.style.backgroundColor=轨道色
  // 映射为外层 div 的 background）默认无圆角，会在四角露出与轨道/进度不一致的直角色块。
  // 这里让底层默认采用与轨道一致的圆角；若用户显式设置了 borderRadius 则尊重用户设置。
  const outerStyle: React.CSSProperties = {
    ...style,
    borderRadius: style.borderRadius ?? trackRadius,
  };

  if (isVertical) {
    const fillHeight = ratio * h;
    return (
      <div key={component.id} style={outerStyle} {...handlers}>
        {/* Track */}
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: w,
          height: h,
          borderRadius: trackRadius,
          backgroundColor: trackColor,
        }} />
        {/* Fill (from bottom) */}
        <div style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: w,
          height: fillHeight,
          borderRadius: trackRadius,
          backgroundColor: barColor,
        }} />
      </div>
    );
  }

  // Horizontal
  const fillWidth = ratio * w;
  return (
    <div key={component.id} style={outerStyle} {...handlers}>
      {/* Track */}
      <div style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: w,
        height: h,
        borderRadius: trackRadius,
        backgroundColor: trackColor,
      }} />
      {/* Fill (from left) */}
      <div style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: fillWidth,
        height: h,
        borderRadius: trackRadius,
        backgroundColor: barColor,
      }} />
    </div>
  );
};
