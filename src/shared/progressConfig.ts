export interface ProgressConfig {
  mode: 'linear' | 'segmented' | 'arc' | 'arc-segmented';
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
  cornerRadius: number;
  vertical: boolean;
  activeColor: string;
  inactiveColor: string;
  activeOpacity: number;
  inactiveOpacity: number;
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
  const count = Math.max(1, Math.min(64, Math.round(finite(data.segmentCount, 12))));
  const min = Math.max(-2147483647, Math.min(2147483646, Math.trunc(finite(data.min, 0))));
  const max = Math.max(min + 1, Math.min(2147483647, Math.trunc(finite(data.max, 100))));
  const vertical = (style.orientation ?? data.orientation) === 'vertical';
  const fillStart = vertical
    ? (data.fillStart === 'top' ? 'top' : 'bottom')
    : (data.fillStart === 'right' ? 'right' : 'left');
  return {
    mode: ['segmented', 'arc', 'arc-segmented'].includes(data.progressMode) ? data.progressMode : 'linear',
    fillStart,
    count,
    min,
    max,
    value: Math.max(min, Math.min(max, Math.trunc(finite(data.value, 50)))),
    gap: Math.max(0, Math.round(finite(data.segmentGap, 3))),
    arcStartAngle: Math.max(-360, Math.min(360, finite(data.arcStartAngle, -90))),
    arcSweepAngle: Math.max(1, Math.min(360, finite(data.arcSweepAngle, 360))),
    arcDirection: data.arcDirection === 'counterclockwise' ? 'counterclockwise' : 'clockwise',
    arcStrokeWidth: Math.max(1, Math.round(finite(data.arcStrokeWidth, 8))),
    arcSegmentGap: Math.max(0, finite(data.arcSegmentGap, 8)),
    cornerRadius: Math.max(0, Math.min(2147483647, Math.round(finite(style.borderRadius, 12)))),
    vertical,
    activeColor: color(data.activeColor, '#3edb88'),
    inactiveColor: color(data.inactiveColor, '#343b42'),
    activeOpacity: Math.max(0, Math.min(255, Math.round(finite(data.activeOpacity, 255)))),
    inactiveOpacity: Math.max(0, Math.min(255, Math.round(finite(data.inactiveOpacity, 255)))),
    showValueLabel: data.showValueLabel === true || data.showValueLabel === 'true',
    valueLabelFormat: data.valueLabelFormat === 'value' ? 'value' : 'percent',
    valueLabelColor: color(data.valueLabelColor, '#ffffff'),
    valueLabelFontSize: Math.max(1, Math.min(255, Math.round(finite(data.fontSize, 16)))),
    valueLabelOffsetX: Math.round(finite(data.valueLabelOffsetX, 0)),
    valueLabelOffsetY: Math.round(finite(data.valueLabelOffsetY, 0)),
  };
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
