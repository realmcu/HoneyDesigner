export interface ProgressConfig {
  mode: 'linear' | 'segmented' | 'arc' | 'arc-segmented' | 'arc-gauge' | 'arc-dots' | 'loading' | 'loading-slide';
  fillStart: 'left' | 'right' | 'top' | 'bottom';
  count: number;
  min: number;
  max: number;
  value: number;
  gap: number;
  arcStartAngle: number;
  arcSweepAngle: number;
  arcDirection: 'clockwise' | 'counterclockwise';
  arcStrokeWidth: number;
  arcSegmentGap: number;
  spinArcLen: number;
  spinPeriod: number;
  slideLengthPercent: number;
  spinAutostart: boolean;
  showTrack: boolean;
  cornerRadius: number;
  vertical: boolean;
  activeColor: string;
  inactiveColor: string;
  activeOpacity: number;
  inactiveOpacity: number;
  colorMode: 'single' | 'positional' | 'state';
  thresholdLow: number;
  thresholdHigh: number;
  zoneLowColor: string;
  zoneMidColor: string;
  zoneHighColor: string;
  showValueLabel: boolean;
  valueLabelFormat: 'percent' | 'value';
  valueLabelColor: string;
  valueLabelFontSize: number;
  valueLabelOffsetX: number;
  valueLabelOffsetY: number;
}

export function progressConfig(
  data: Record<string, any> = {},
  style: Record<string, any> = {}
): ProgressConfig {
  const finite = (value: unknown, fallback: number) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const color = (value: unknown, fallback: string) =>
    typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
  const count = Math.max(1, Math.min(64, Math.round(finite(data.segmentCount, data.progressMode === 'arc-dots' ? 24 : 12))));
  const min = Math.max(-2147483647, Math.min(2147483646, Math.trunc(finite(data.min, 0))));
  const max = Math.max(min + 1, Math.min(2147483647, Math.trunc(finite(data.max, 100))));
  const vertical = (style.orientation ?? data.orientation) === 'vertical';
  const fillStart = vertical
    ? (data.fillStart === 'top' ? 'top' : 'bottom')
    : (data.fillStart === 'right' ? 'right' : 'left');
  const colorMode = data.colorMode === 'positional' || data.colorMode === 'state'
    ? data.colorMode : 'single';
  const thresholdLow = Math.max(0, Math.min(100, Math.round(finite(
    data.thresholdLow, colorMode === 'state' ? 20 : 30
  ))));
  return {
    mode: ['segmented', 'arc', 'arc-segmented', 'arc-gauge', 'arc-dots', 'loading', 'loading-slide'].includes(data.progressMode) ? data.progressMode : 'linear',
    fillStart,
    count,
    min,
    max,
    value: Math.max(min, Math.min(max, Math.trunc(finite(data.value, 50)))),
    gap: Math.max(0, Math.round(finite(data.segmentGap, 3))),
    arcStartAngle: Math.max(-360, Math.min(360, finite(data.arcStartAngle, data.progressMode === 'arc-gauge' ? -45 : -90))),
    arcSweepAngle: Math.max(1, Math.min(360, finite(data.arcSweepAngle, data.progressMode === 'arc-gauge' ? 270 : 360))),
    arcDirection: data.arcDirection === 'counterclockwise' || (data.arcDirection === undefined && data.progressMode === 'arc-gauge')
      ? 'counterclockwise' : 'clockwise',
    arcStrokeWidth: Math.max(1, Math.round(finite(data.arcStrokeWidth, 8))),
    arcSegmentGap: Math.max(0, finite(data.arcSegmentGap, 8)),
    spinArcLen: Math.max(10, Math.min(180, Math.round(finite(data.spinArcLen, 90)))),
    spinPeriod: Math.max(400, Math.min(10000, Math.round(finite(data.spinPeriod, 1600)))),
    slideLengthPercent: Math.max(5, Math.min(90, Math.round(finite(data.slideLengthPercent, 25)))),
    spinAutostart: data.spinAutostart !== false && data.spinAutostart !== 'false',
    showTrack: data.showTrack !== false && data.showTrack !== 'false',
    cornerRadius: Math.max(0, Math.min(2147483647, Math.round(finite(style.borderRadius, 12)))),
    vertical,
    activeColor: color(data.activeColor, '#3edb88'),
    inactiveColor: color(data.inactiveColor, '#343b42'),
    activeOpacity: Math.max(0, Math.min(255, Math.round(finite(data.activeOpacity, 255)))),
    inactiveOpacity: Math.max(0, Math.min(255, Math.round(finite(data.inactiveOpacity, 255)))),
    colorMode,
    thresholdLow,
    thresholdHigh: Math.max(thresholdLow, Math.min(100, Math.round(finite(
      data.thresholdHigh, colorMode === 'state' ? 50 : 70
    )))),
    zoneLowColor: color(data.zoneLowColor, colorMode === 'state' ? '#e8564a' : '#3edb88'),
    zoneMidColor: color(data.zoneMidColor, '#f2b33d'),
    zoneHighColor: color(data.zoneHighColor, colorMode === 'state' ? '#3edb88' : '#e8564a'),
    showValueLabel: data.showValueLabel === true || data.showValueLabel === 'true',
    valueLabelFormat: data.valueLabelFormat === 'value' ? 'value' : 'percent',
    valueLabelColor: color(data.valueLabelColor, '#ffffff'),
    valueLabelFontSize: Math.max(1, Math.min(255, Math.round(finite(data.fontSize, 16)))),
    valueLabelOffsetX: Math.round(finite(data.valueLabelOffsetX, 0)),
    valueLabelOffsetY: Math.round(finite(data.valueLabelOffsetY, 0)),
  };
}

export function isIndeterminateProgressMode(mode: ProgressConfig['mode']): boolean {
  return mode === 'loading' || mode === 'loading-slide';
}

export function slideFillWidth(config: ProgressConfig, width: number): number {
  const extent = Math.max(1, Math.round(width));
  return Math.max(1, Math.min(extent, Math.round(extent * config.slideLengthPercent / 100)));
}

export function slideOffset(phase: number, travel: number): number {
  const half = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  return Math.round(travel * half * half * (3 - 2 * half));
}

export function segmentActiveColor(config: ProgressConfig, index: number): string {
  if (config.colorMode === 'single') return config.activeColor;
  const position = config.colorMode === 'positional'
    ? index * 100 / config.count
    : (config.value - config.min) * 100 / (config.max - config.min);
  if (position < config.thresholdLow) return config.zoneLowColor;
  if (position < config.thresholdHigh) return config.zoneMidColor;
  return config.zoneHighColor;
}

export function progressLabelText(config: ProgressConfig): string {
  if (config.valueLabelFormat === 'value') return String(config.value);
  return `${Math.round((config.value - config.min) * 100 / (config.max - config.min))}%`;
}

export function arcGeometry(config: ProgressConfig, width: number, height: number) {
  const stroke = Math.min(config.arcStrokeWidth, Math.max(1, Math.floor(Math.min(width, height) / 2)));
  return {
    cx: width / 2,
    cy: height / 2,
    radius: Math.max(1, Math.floor((Math.min(width, height) - stroke) / 2)),
    stroke,
  };
}

export function arcSegmentAngles(config: ProgressConfig, width: number, height: number, index: number) {
  const step = config.arcSweepAngle / config.count;
  const direction = config.arcDirection === 'clockwise' ? 1 : -1;
  const { radius, stroke } = arcGeometry(config, width, height);
  const capAngle = 2 * Math.asin(Math.min(1, stroke / (2 * radius))) * 180 / Math.PI;
  const gap = Math.min(config.arcSegmentGap + capAngle, Math.max(0, step - 1));
  const closed = config.arcSweepAngle === 360 && config.count > 1;
  return {
    start: config.arcStartAngle + direction * (index * step + (index || closed ? gap / 2 : 0)),
    end: config.arcStartAngle + direction * ((index + 1) * step - (index === config.count - 1 && !closed ? 0 : gap / 2)),
  };
}

export function arcDotPosition(config: ProgressConfig, width: number, height: number, index: number) {
  const { cx, cy, radius, stroke } = arcGeometry(config, width, height);
  const steps = config.arcSweepAngle === 360 ? config.count : Math.max(1, config.count - 1);
  const direction = config.arcDirection === 'clockwise' ? 1 : -1;
  const angle = (config.arcStartAngle + direction * index * config.arcSweepAngle / steps) * Math.PI / 180;
  return {
    x: Math.round(cx + radius * Math.cos(angle)),
    y: Math.round(cy + radius * Math.sin(angle)),
    radius: Math.max(1, Math.floor(stroke / 2)),
  };
}

export function activeSegmentCount(config: ProgressConfig): number {
  return Math.min(config.count, Math.ceil((config.value - config.min) * config.count / (config.max - config.min)));
}

export function segmentBounds(config: ProgressConfig, width: number, height: number, index: number) {
  const extent = config.vertical ? height : width;
  const other = config.vertical ? width : height;
  const gap = Math.min(config.gap, Math.max(0, Math.floor(extent / config.count) - 1));
  const start = Math.floor(index * extent / config.count) + (index ? Math.ceil(gap / 2) : 0);
  const end = Math.floor((index + 1) * extent / config.count) -
    (index === config.count - 1 ? 0 : Math.floor(gap / 2));
  const length = Math.max(1, end - start);
  return config.vertical
    ? { x: 0, y: config.fillStart === 'top' ? start : height - start - length, width: other, height: length }
    : { x: config.fillStart === 'right' ? width - start - length : start, y: 0, width: length, height: other };
}

export function progressCornerRadius(config: ProgressConfig, width: number, height: number): number {
  return Math.min(config.cornerRadius, Math.floor(Math.min(width, height) / 2));
}

export function linearFillLength(config: ProgressConfig, extent: number): number {
  return Math.round((config.value - config.min) * extent / (config.max - config.min));
}
