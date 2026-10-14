import React from 'react';
import type { WidgetProps } from './types';
import { activeSegmentCount, linearFillLength, progressConfig, progressCornerRadius, segmentBounds } from '../../../shared/progressConfig';

export const ProgressWidget: React.FC<WidgetProps> = ({ component, style, handlers, children }) => {
  const config = progressConfig(component.data, component.style);
  const active = activeSegmentCount(config);
  const { width, height } = component.position;
  const extent = config.vertical ? height : width;
  const fillLength = linearFillLength(config, extent);
  const radius = progressCornerRadius(config, width, height);
  return (
    <div style={{ ...style, background: 'transparent', overflow: 'visible' }} {...handlers}>
      {config.mode === 'linear' ? (
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
      {children}
    </div>
  );
};
