import React from 'react';
import { WidgetProps } from './types';

interface GradientStop {
  position: number;
  color: string;
}

export const RectWidget: React.FC<WidgetProps> = ({ component, style, handlers, children }) => {
  const s = component.style || {};
  const d = component.data || {};
  
  const borderRadius = s.borderRadius ?? 0;
  const fillColor = s.fillColor ?? '#007acc';
  const opacity = s.opacity ?? 255;

  // 渐变设置
  const useGradient = s.useGradient ?? false;
  const gradientDirection = s.gradientDirection ?? 'horizontal';
  const gradientStops: GradientStop[] = d.gradientStops || [];

  // 生成 CSS 渐变
  const getGradientBackground = () => {
    if (!useGradient || gradientStops.length < 2) {
      return fillColor;
    }

    // 排序色标
    const sortedStops = [...gradientStops].sort((a, b) => a.position - b.position);
    const stopsStr = sortedStops.map(stop => `${stop.color} ${stop.position * 100}%`).join(', ');

    // 根据方向生成渐变
    let direction: string;
    switch (gradientDirection) {
      case 'vertical':
        direction = 'to bottom';
        break;
      case 'diagonal_tl_br':
        direction = 'to bottom right';
        break;
      case 'diagonal_tr_bl':
        direction = 'to bottom left';
        break;
      case 'horizontal':
      default:
        direction = 'to right';
        break;
    }

    return `linear-gradient(${direction}, ${stopsStr})`;
  };

  const rectStyle: React.CSSProperties = {
    ...style,
    background: getGradientBackground(),
    borderRadius: borderRadius,
    opacity: opacity / 255,
  };

  return <div style={rectStyle} {...handlers}>{children}</div>;
};
