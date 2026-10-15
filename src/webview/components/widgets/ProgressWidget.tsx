import React from 'react';
import type { WidgetProps } from './types';
import { activeSegmentCount, arcGeometry, arcSegmentAngles, linearFillLength, progressConfig, progressCornerRadius, progressLabelText, segmentBounds } from '../../../shared/progressConfig';
import { useFontLoader } from '../../hooks/useFontLoader';

function arcPath(cx: number, cy: number, radius: number, start: number, end: number): string {
  const point = (angle: number) => {
    const rad = angle * Math.PI / 180;
    return `${cx + radius * Math.cos(rad)} ${cy + radius * Math.sin(rad)}`;
  };
  const sweep = end >= start ? 1 : 0;
  const span = Math.abs(end - start);
  if (span >= 360) {
    const halfway = start + (sweep ? 180 : -180);
    return `M ${point(start)} A ${radius} ${radius} 0 1 ${sweep} ${point(halfway)} A ${radius} ${radius} 0 1 ${sweep} ${point(start)}`;
  }
  return `M ${point(start)} A ${radius} ${radius} 0 ${span > 180 ? 1 : 0} ${sweep} ${point(end)}`;
}

export const ProgressWidget: React.FC<WidgetProps> = ({ component, style, handlers, children }) => {
  const config = progressConfig(component.data, component.style);
  const { fontFamily } = useFontLoader(config.showValueLabel ? component.data?.fontFile : undefined);
  const active = activeSegmentCount(config);
  const { width, height } = component.position;
  const extent = config.vertical ? height : width;
  const fillLength = linearFillLength(config, extent);
  const radius = progressCornerRadius(config, width, height);
  const arc = arcGeometry(config, width, height);
  const arcDirection = config.arcDirection === 'clockwise' ? 1 : -1;
  const drawArc = (start: number, end: number, color: string, opacity: number, key?: number) => (
    <path key={key} d={arcPath(arc.cx, arc.cy, arc.radius, start, end)}
      fill="none" stroke={color} strokeOpacity={opacity / 255}
      strokeWidth={arc.stroke} strokeLinecap="round" />
  );
  return (
    <div style={{ ...style, background: 'transparent', overflow: 'visible' }} {...handlers}>
      {config.mode.startsWith('arc') ? (
        <svg width={width} height={height} style={{ display: 'block', pointerEvents: 'none', overflow: 'visible' }}>
          {config.mode === 'arc' ? (
            <>
              {drawArc(config.arcStartAngle, config.arcStartAngle + arcDirection * config.arcSweepAngle, config.inactiveColor, config.inactiveOpacity)}
              {config.value > config.min && drawArc(
                config.arcStartAngle,
                config.arcStartAngle + arcDirection * config.arcSweepAngle * (config.value - config.min) / (config.max - config.min),
                config.activeColor, config.activeOpacity
              )}
            </>
          ) : Array.from({ length: config.count }, (_, index) => {
            const angles = arcSegmentAngles(config, width, height, index);
            const activeSegment = index < active;
            return drawArc(angles.start, angles.end,
              activeSegment ? config.activeColor : config.inactiveColor,
              activeSegment ? config.activeOpacity : config.inactiveOpacity, index);
          })}
        </svg>
      ) : config.mode === 'linear' ? (
        <>
          <div style={{ position: 'absolute', inset: 0, borderRadius: radius,
            backgroundColor: config.inactiveColor, opacity: config.inactiveOpacity / 255, pointerEvents: 'none' }} />
          {fillLength > 0 && <div style={{
            position: 'absolute',
            left: !config.vertical && config.fillStart === 'right' ? width - fillLength : 0,
            top: config.vertical && config.fillStart === 'bottom' ? height - fillLength : 0,
            width: config.vertical ? width : fillLength,
            height: config.vertical ? fillLength : height,
            borderRadius: progressCornerRadius(config, config.vertical ? width : fillLength, config.vertical ? fillLength : height),
            backgroundColor: config.activeColor,
            opacity: config.activeOpacity / 255,
            pointerEvents: 'none',
          }} />}
        </>
      ) : Array.from({ length: config.count }, (_, index) => {
        const bounds = segmentBounds(config, width, height, index);
        return (
          <div key={index} style={{
            position: 'absolute',
            left: bounds.x,
            top: bounds.y,
            width: bounds.width,
            height: bounds.height,
            borderRadius: progressCornerRadius(config, bounds.width, bounds.height),
            backgroundColor: index < active ? config.activeColor : config.inactiveColor,
            opacity: (index < active ? config.activeOpacity : config.inactiveOpacity) / 255,
            pointerEvents: 'none',
          }} />
        );
      })}
      {config.showValueLabel && (
        <div style={{
          position: 'absolute', left: config.valueLabelOffsetX, top: config.valueLabelOffsetY,
          width, height, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: config.valueLabelColor, fontSize: config.valueLabelFontSize,
          fontFamily: fontFamily || 'inherit', whiteSpace: 'nowrap', pointerEvents: 'none',
        }}>
          {progressLabelText(config)}
        </div>
      )}
      {children}
    </div>
  );
};
