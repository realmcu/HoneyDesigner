import React from 'react';
import type { WidgetProps } from './types';
import { activeSegmentCount, arcDotPosition, arcGeometry, arcSegmentAngles, isIndeterminateProgressMode, linearFillLength, progressConfig, progressCornerRadius, progressLabelText, segmentActiveColor, segmentBounds, slideFillWidth, slideOffset } from '../../../shared/progressConfig';
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
  const [spinPhase, setSpinPhase] = React.useState(0);
  React.useEffect(() => {
    setSpinPhase(0);
    if (!isIndeterminateProgressMode(config.mode) || !config.spinAutostart) return;
    let frame: number;
    const start = performance.now();
    const animate = (now: number) => {
      setSpinPhase(((now - start) % config.spinPeriod) * 360 / config.spinPeriod);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [config.mode, config.spinAutostart, config.spinPeriod]);
  const { fontFamily } = useFontLoader(!isIndeterminateProgressMode(config.mode) && config.showValueLabel ? component.data?.fontFile : undefined);
  const active = activeSegmentCount(config);
  const { width, height } = component.position;
  const extent = config.vertical ? height : width;
  const fillLength = linearFillLength(config, extent);
  const slideWidth = slideFillWidth(config, width);
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
      {config.mode === 'loading-slide' ? (
        <>
          <div style={{ position: 'absolute', inset: 0, borderRadius: radius,
            backgroundColor: config.inactiveColor, opacity: config.inactiveOpacity / 255, pointerEvents: 'none' }} />
          <div style={{
            position: 'absolute', left: slideOffset(spinPhase / 360, Math.max(0, width - slideWidth)), top: 0,
            width: slideWidth, height, borderRadius: progressCornerRadius(config, slideWidth, height),
            backgroundColor: config.activeColor, opacity: config.activeOpacity / 255, pointerEvents: 'none',
          }} />
        </>
      ) : (config.mode.startsWith('arc') || config.mode === 'loading') ? (
        <svg width={width} height={height} style={{ display: 'block', pointerEvents: 'none', overflow: 'visible' }}>
          {config.mode === 'loading' ? (
            <>
              {config.showTrack && drawArc(-90, 270, config.inactiveColor, config.inactiveOpacity)}
              {(() => {
                const start = config.arcStartAngle + arcDirection * spinPhase;
                return drawArc(
                  config.arcDirection === 'clockwise' ? start : start - config.spinArcLen,
                  config.arcDirection === 'clockwise' ? start + config.spinArcLen : start,
                  config.activeColor, config.activeOpacity
                );
              })()}
            </>
          ) : config.mode === 'arc' || config.mode === 'arc-gauge' ? (
            <>
              {drawArc(config.arcStartAngle, config.arcStartAngle + arcDirection * config.arcSweepAngle, config.inactiveColor, config.inactiveOpacity)}
              {config.value > config.min && drawArc(
                config.arcStartAngle,
                config.arcStartAngle + arcDirection * config.arcSweepAngle * (config.value - config.min) / (config.max - config.min),
                config.activeColor, config.activeOpacity
              )}
            </>
          ) : config.mode === 'arc-dots' ? Array.from({ length: config.count }, (_, index) => {
            const dot = arcDotPosition(config, width, height, index);
            const isActive = index < active;
            return <circle key={index} cx={dot.x} cy={dot.y} r={dot.radius}
              fill={isActive ? segmentActiveColor(config, index) : config.inactiveColor}
              opacity={(isActive ? config.activeOpacity : config.inactiveOpacity) / 255} />;
          }) : Array.from({ length: config.count }, (_, index) => {
            const angles = arcSegmentAngles(config, width, height, index);
            const activeSegment = index < active;
            return drawArc(angles.start, angles.end,
              activeSegment ? segmentActiveColor(config, index) : config.inactiveColor,
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
            backgroundColor: index < active ? segmentActiveColor(config, index) : config.inactiveColor,
            opacity: (index < active ? config.activeOpacity : config.inactiveOpacity) / 255,
            pointerEvents: 'none',
          }} />
        );
      })}
      {!isIndeterminateProgressMode(config.mode) && config.showValueLabel && (
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
