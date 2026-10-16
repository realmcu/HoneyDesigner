import React from 'react';
import { WidgetProps } from './types';
import { useGeometryButtonPreview } from './useGeometryButtonPreview';

interface GradientStop {
  position: number;
  color: string;
}

export const CircleWidget: React.FC<WidgetProps> = ({ component, style, handlers, children }) => {
  const { isOn, previewHandlers } = useGeometryButtonPreview(component);
  const width = component.position?.width ?? 100;
  const height = component.position?.height ?? 100;
  const s = component.style || {};
  const d = component.data || {};
  
  const radius = s.radius ?? 40;
  const strokeWidth = Math.max(0, Number(s.strokeWidth) || 0);
  const isDualState = d.buttonMode === 'dual-state';
  const fillColor = isDualState
    ? (isOn ? d.buttonStateOnColor || '#00FF00' : d.buttonStateOffColor || '#FF0000')
    : s.fillColor ?? '#007acc';
  const opacity = s.opacity !== undefined ? s.opacity / 255 : 1;

  // 渐变设置
  const useGradient = s.useGradient ?? false;
  const gradientType = s.gradientType ?? 'radial';
  const gradientStops: GradientStop[] = d.gradientStops || [];

  // 圆心在组件中心
  const cx = width / 2;
  const cy = height / 2;

  // 生成唯一的渐变 ID
  const gradientId = `circle-gradient-${component.id}`;

  // 渲染渐变定义
  const renderGradient = () => {
    if (!useGradient || gradientStops.length < 2) return null;
    
    if (gradientType === 'radial') {
      // 径向渐变：从圆心向边缘
      return (
        <defs>
          <radialGradient id={gradientId} cx="50%" cy="50%" r="50%">
            {gradientStops.map((stop, index) => (
              <stop
                key={index}
                offset={`${stop.position * 100}%`}
                stopColor={stop.color}
              />
            ))}
          </radialGradient>
        </defs>
      );
    } else {
      // 角度渐变：使用 conic-gradient 模拟（SVG 不直接支持，使用 linearGradient 近似）
      const startAngle = d.gradientStartAngle ?? 0;
      const endAngle = d.gradientEndAngle ?? 360;
      const startRad = startAngle * Math.PI / 180;
      const endRad = endAngle * Math.PI / 180;
      
      const x1 = 50 + 50 * Math.cos(startRad);
      const y1 = 50 + 50 * Math.sin(startRad);
      const x2 = 50 + 50 * Math.cos(endRad);
      const y2 = 50 + 50 * Math.sin(endRad);
      
      return (
        <defs>
          <linearGradient 
            id={gradientId} 
            x1={`${x1}%`} 
            y1={`${y1}%`} 
            x2={`${x2}%`} 
            y2={`${y2}%`}
          >
            {gradientStops.map((stop, index) => (
              <stop
                key={index}
                offset={`${stop.position * 100}%`}
                stopColor={stop.color}
              />
            ))}
          </linearGradient>
        </defs>
      );
    }
  };

  // 确定填充颜色
  const fill = !isDualState && useGradient && gradientStops.length >= 2
    ? `url(#${gradientId})` 
    : fillColor;

  return (
    <div style={{ ...style, overflow: 'visible' }} {...handlers} {...previewHandlers}>
      <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
        {renderGradient()}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill={fill}
          fillOpacity={opacity}
          stroke={s.strokeColor ?? '#FFFFFF'}
          strokeWidth={strokeWidth}
          strokeOpacity={opacity}
        />
      </svg>
      {children}
    </div>
  );
};
