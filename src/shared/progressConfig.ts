export interface ProgressConfig {
  mode: 'linear' | 'segmented';
  fillStart: 'left' | 'right' | 'top' | 'bottom';
  count: number;
  min: number;
  max: number;
  value: number;
  gap: number;
  cornerRadius: number;
  vertical: boolean;
  activeColor: string;
  inactiveColor: string;
  activeOpacity: number;
  inactiveOpacity: number;
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
    mode: data.progressMode === 'segmented' ? 'segmented' : 'linear',
    fillStart,
    count,
    min,
    max,
    value: Math.max(min, Math.min(max, Math.trunc(finite(data.value, 50)))),
    gap: Math.max(0, Math.round(finite(data.segmentGap, 3))),
    cornerRadius: Math.max(0, Math.min(2147483647, Math.round(finite(style.borderRadius, 12)))),
    vertical,
    activeColor: color(data.activeColor, '#3edb88'),
    inactiveColor: color(data.inactiveColor, '#343b42'),
    activeOpacity: Math.max(0, Math.min(255, Math.round(finite(data.activeOpacity, 255)))),
    inactiveOpacity: Math.max(0, Math.min(255, Math.round(finite(data.inactiveOpacity, 255)))),
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
