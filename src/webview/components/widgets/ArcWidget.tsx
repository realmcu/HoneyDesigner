import React from 'react';
import { WidgetProps } from './types';

interface GradientStop {
  position: number;
  color: string;
}

export const ArcWidget: React.FC<WidgetProps> = ({ component, style, handlers, children }) => {
  const width = component.position?.width ?? 100;
  const height = component.position?.height ?? 100;
  const s = component.style || {};
  const d = component.data || {};

  const radius = s.radius ?? 40;
  const startAngle = s.startAngle ?? 0;
  const endAngle = s.endAngle ?? 270;
  const strokeWidth = s.strokeWidth ?? 8;
  const color = s.color ?? '#007acc';
  const opacity = s.opacity !== undefined ? s.opacity / 255 : 1;
  
  // 渐变设置
  const useGradient = s.useGradient ?? false;
  const gradientStops: GradientStop[] = d.gradientStops || [];
  
  // 渐变角度（独立于弧形角度）
  const gradientStartAngle = d.gradientStartAngle ?? startAngle;
  const gradientEndAngle = d.gradientEndAngle ?? endAngle;

  // 圆心在组件中心
  const cx = width / 2;
  const cy = height / 2;

  // 计算角度跨度
  let angleSpan = endAngle - startAngle;
  if (angleSpan <= 0) angleSpan += 360;

  // 检查是否为完整圆弧（360度）
  const isFullCircle = Math.abs(angleSpan - 360) < 0.01;

  // SDK 使用标准数学坐标系：0度在3点钟方向（最右边），逆时针为正
  // SVG 使用顺时针方向，所以需要取负值
  const startRad = startAngle * Math.PI / 180;
  const endRad = endAngle * Math.PI / 180;

  // 计算弧线路径
  const x1 = cx + radius * Math.cos(startRad);
  const y1 = cy + radius * Math.sin(startRad);
  const x2 = cx + radius * Math.cos(endRad);
  const y2 = cy + radius * Math.sin(endRad);

  // 判断是否大于180度
  const largeArcFlag = angleSpan > 180 ? 1 : 0;

  // 完整圆弧使用两个半圆弧拼接
  let pathD: string;
  if (isFullCircle) {
    // 完整圆弧：使用两个半圆弧
    const midRad = (startAngle + 180) * Math.PI / 180;
    const xMid = cx + radius * Math.cos(midRad);
    const yMid = cy + radius * Math.sin(midRad);
    pathD = `M ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${xMid} ${yMid} A ${radius} ${radius} 0 1 1 ${x1} ${y1}`;
  } else {
    pathD = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`;
  }

  // 端点样式：SDK 默认使用圆角封端
  const strokeLinecap = 'round';
  
  // Canvas ref for gradient rendering
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  
  // 根据位置获取渐变颜色
  const getColorAtPosition = React.useCallback((t: number, stops: GradientStop[]): string => {
    if (stops.length === 0) return '#000000';
    if (stops.length === 1) return stops[0].color;
    
    // 找到 t 所在的两个色标之间
    for (let i = 0; i < stops.length - 1; i++) {
      const stop1 = stops[i];
      const stop2 = stops[i + 1];
      
      if (t >= stop1.position && t <= stop2.position) {
        // 线性插值
        const localT = (t - stop1.position) / (stop2.position - stop1.position);
        return interpolateColor(stop1.color, stop2.color, localT);
      }
    }
    
    // 超出范围，返回最后一个颜色
    return stops[stops.length - 1].color;
  }, []);
  
  // 颜色插值
  const interpolateColor = (color1: string, color2: string, t: number): string => {
    const c1 = parseInt(color1.slice(1), 16);
    const c2 = parseInt(color2.slice(1), 16);
    
    const r1 = (c1 >> 16) & 0xff;
    const g1 = (c1 >> 8) & 0xff;
    const b1 = c1 & 0xff;
    
    const r2 = (c2 >> 16) & 0xff;
    const g2 = (c2 >> 8) & 0xff;
    const b2 = c2 & 0xff;
    
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  };

  // 使用 useEffect 绘制渐变
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // 设置高分辨率
    const dpr = window.devicePixelRatio || 1;
    const canvasWidth = Math.ceil(width * dpr);
    const canvasHeight = Math.ceil(height * dpr);
    
    // 重新设置 canvas 尺寸（这会自动清空画布）
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    
    // 确保画布完全透明
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    
    // 如果不使用渐变或没有足够的色标，不绘制任何内容
    if (!useGradient || gradientStops.length < 2) return;
    
    // 缩放上下文以匹配设备像素比
    ctx.scale(dpr, dpr);
    
    // 计算实际绘制的角度范围
    // 注意：angleSpan 已经在组件顶部计算好了
    const drawAngleSpan = angleSpan;
    
    // 使用 butt lineCap 并增加段数来避免间隙
    const numSegments = Math.max(360, Math.floor(drawAngleSpan * 2));
    const angleStep = drawAngleSpan / numSegments;
    
    ctx.lineCap = 'butt';
    ctx.lineWidth = strokeWidth;
    ctx.globalAlpha = opacity;
    
    // 绘制每个小段
    for (let i = 0; i < numSegments; i++) {
      const currentArcAngle = startAngle + i * angleStep;
      // 确保不超过 endAngle（考虑跨越 360 度的情况）
      let nextArcAngle = startAngle + (i + 1) * angleStep;
      
      // 计算在渐变中的位置 (0-1)，简单地按弧形进度映射
      const t = i / numSegments;
      
      // 根据位置获取颜色
      const segmentColor = getColorAtPosition(t, gradientStops);
      
      // 转换为弧度
      const currentRad = currentArcAngle * Math.PI / 180;
      // 稍微增加一点角度避免间隙，但不超过总范围
      const nextRad = Math.min(nextArcAngle + 0.5, startAngle + drawAngleSpan) * Math.PI / 180;
      
      ctx.beginPath();
      ctx.arc(cx, cy, radius, currentRad, nextRad);
      ctx.strokeStyle = segmentColor;
      ctx.stroke();
    }
    
    // 绘制端点封端
    const capRadius = strokeWidth / 2;
    
    if (isFullCircle) {
      // 完整圆弧：只在终点位置添加封端（终点在绘制结束的位置）
      // 完整圆弧绘制从 startAngle 到 startAngle + 360，终点在最后绘制的位置
      const actualEndRad = (startAngle + drawAngleSpan - 0.5) * Math.PI / 180; // 稍微往回一点，确保在圆弧上
      const endCapX = cx + radius * Math.cos(actualEndRad);
      const endCapY = cy + radius * Math.sin(actualEndRad);
      ctx.beginPath();
      ctx.arc(endCapX, endCapY, capRadius, 0, Math.PI * 2);
      ctx.fillStyle = getColorAtPosition(1, gradientStops); // 使用终点颜色
      ctx.globalAlpha = opacity;
      ctx.fill();
    } else {
      // 非完整圆弧：起点和终点都添加封端
      // 起点封端
      const startCapX = cx + radius * Math.cos(startRad);
      const startCapY = cy + radius * Math.sin(startRad);
      ctx.beginPath();
      ctx.arc(startCapX, startCapY, capRadius, 0, Math.PI * 2);
      ctx.fillStyle = getColorAtPosition(0, gradientStops);
      ctx.globalAlpha = opacity;
      ctx.fill();
      
      // 终点封端
      const actualEndRad = (startAngle + drawAngleSpan) * Math.PI / 180;
      const endCapX = cx + radius * Math.cos(actualEndRad);
      const endCapY = cy + radius * Math.sin(actualEndRad);
      ctx.beginPath();
      ctx.arc(endCapX, endCapY, capRadius, 0, Math.PI * 2);
      ctx.fillStyle = getColorAtPosition(1, gradientStops);
      ctx.globalAlpha = opacity;
      ctx.fill();
    }
    
  }, [width, height, cx, cy, radius, strokeWidth, startAngle, endAngle, angleSpan, startRad, isFullCircle, gradientStops, useGradient, opacity, getColorAtPosition]);

  return (
    <div style={{ ...style, overflow: 'visible' }} {...handlers}>
      {useGradient && gradientStops.length >= 2 ? (
        // 使用 Canvas 绘制角度渐变
        <canvas 
          ref={canvasRef}
          style={{ 
            display: 'block',
            width: `${width}px`,
            height: `${height}px`,
            background: 'transparent'
          }} 
        />
      ) : (
        // 使用 SVG 绘制纯色弧形
        <svg width={width} height={height} style={{ display: 'block' }}>
          <path
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap={strokeLinecap}
            strokeOpacity={opacity}
          />
        </svg>
      )}
      {children}
    </div>
  );
};
