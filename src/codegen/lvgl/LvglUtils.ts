/**
 * LVGL code generation utility functions
 */
import * as path from 'path';

/**
 * Parse the RGB hex portion of a color string (without #)
 */
export function parseColorHex(color: string): string {
  const hex = color.replace(/^#/, '').toUpperCase();
  if (hex.length === 3) {
    return hex.split('').map(c => c + c).join('');
  }
  if (hex.length === 4) {
    return hex.slice(0, 3).split('').map(c => c + c).join('');
  }
  if (hex.length === 8) {
    return hex.slice(0, 6);
  }
  return hex.padStart(6, '0');
}

/**
 * Parse alpha value (0-255) from a color string
 * Supported formats: #RGB, #RGBA, #RRGGBB, #RRGGBBAA
 */
export function parseColorAlpha(color: string): number {
  const hex = color.replace(/^#/, '').toUpperCase();
  if (hex.length === 4) {
    const a = hex[3];
    return parseInt(a + a, 16);
  }
  if (hex.length === 8) {
    return parseInt(hex.slice(6, 8), 16);
  }
  return 255;
}

/**
 * Normalize a hex color value
 */
export function normalizeHexColor(value: string, fallback: string): string {
  const raw = (value || '').trim();
  if (!raw.startsWith('#')) {
    return fallback;
  }
  const hex = raw.slice(1);
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return hex.toUpperCase();
  }
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toUpperCase();
  }
  return fallback;
}


/**
 * Escape special characters in a C string
 */
export function escapeCString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

/**
 * Select the closest LVGL built-in font by font size
 */
export function getLvglFontBySize(fontSize: number): string {
  const sizes = [8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48];
  let closest = 14;
  let minDiff = Infinity;
  for (const size of sizes) {
    const diff = Math.abs(size - fontSize);
    if (diff < minDiff) {
      minDiff = diff;
      closest = size;
    }
  }
  return `lv_font_montserrat_${closest}`;
}

/**
 * Normalize LVGL image source path (add A: virtual drive prefix)
 */
export function normalizeLvglImageSource(source: string): string {
  const normalized = source.replace(/\\/g, '/').trim();
  if (!normalized) {
    return normalized;
  }
  if (/^[A-Z]:/i.test(normalized)) {
    return normalized;
  }
  const withoutLeadingSlash = normalized.replace(/^\/+/, '');
  if (withoutLeadingSlash.startsWith('assets/')) {
    return `A:${withoutLeadingSlash}`;
  }
  return `A:assets/${withoutLeadingSlash}`;
}

/**
 * Normalize video/Lottie source path (OS native path, not via LVGL filesystem)
 */
export function normalizeVideoSource(source: string): string {
  const normalized = source.replace(/\\/g, '/').trim();
  if (!normalized) {
    return normalized;
  }
  if (/^[A-Z]:/i.test(normalized) && normalized.length > 2 && normalized[2] === '/') {
    return normalized;
  }
  const withoutDriveLetter = normalized.replace(/^[A-Z]:/i, '');
  const withoutLeadingSlash = withoutDriveLetter.replace(/^\/+/, '');
  if (withoutLeadingSlash.startsWith('assets/')) {
    return withoutLeadingSlash;
  }
  return `assets/${withoutLeadingSlash}`;
}

/**
 * Safely convert to a finite number
 */
export function toFiniteNumber(value: any, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

/**
 * Resolve gradient color stops
 */
export function resolveGradientStops(rawStops: any, fallbackHex: string): Array<{ colorHex: string; frac: number }> {
  if (!Array.isArray(rawStops)) {
    return [
      { colorHex: fallbackHex, frac: 0 },
      { colorHex: fallbackHex, frac: 255 },
    ];
  }

  const parsed = rawStops
    .map((item) => {
      const position = toFiniteNumber(item?.position, 0);
      const colorHex = normalizeHexColor(String(item?.color || `#${fallbackHex}`), fallbackHex);
      const frac = Math.max(0, Math.min(255, Math.round(position * 255)));
      return { colorHex, frac };
    })
    .sort((a, b) => a.frac - b.frac);

  if (parsed.length < 2) {
    return [
      { colorHex: fallbackHex, frac: 0 },
      { colorHex: fallbackHex, frac: 255 },
    ];
  }

  const limited = parsed.slice(0, 8);
  limited[0] = { ...limited[0], frac: 0 };
  limited[limited.length - 1] = { ...limited[limited.length - 1], frac: 255 };
  return limited;
}

/**
 * Calculate high-contrast text color (black or white) based on background color
 */
export function getContrastTextColor(bgColor: string): string {
  const hex = parseColorHex(bgColor);
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
  return luminance > 128 ? '000000' : 'FFFFFF';
}

/**
 * Normalize image source path for Map lookup
 */
export function normalizeImageKey(source: string): string {
  return source
    .replace(/\\/g, '/')
    .replace(/^A:/i, '')
    .replace(/^\/+/, '')
    .trim()
    .toLowerCase();
}

/**
 * Normalize font key base (fontFile + fontSize + bpp), without pixelOrder.
 * Used for conflict detection across different pixelOrder variants.
 */
export function normalizeFontBaseKey(fontFile: string, fontSize: number, bpp: number = 4): string {
  const normalized = fontFile.replace(/\\/g, '/').toLowerCase().trim();
  return `${normalized}@${fontSize}@${bpp}`;
}

/**
 * Normalize font key (fontFile + fontSize + bpp + pixelOrder combination)
 * @param bpp Bits per pixel (render mode), defaults to 4
 * @param pixelOrder Bit order for glyph bitmap, defaults to 'LSB'
 */
export function normalizeFontKey(fontFile: string, fontSize: number, bpp: number = 4, pixelOrder: 'MSB' | 'LSB' = 'LSB'): string {
  return `${normalizeFontBaseKey(fontFile, fontSize, bpp)}@${pixelOrder}`;
}

/**
 * Build image variable name
 */
export function buildImageVarName(source: string): string {
  let normalized = source.replace(/\\/g, '/').trim();
  normalized = normalized.replace(/^A:/i, '').replace(/^\/+/, '');
  if (normalized.startsWith('assets/')) {
    normalized = normalized.substring('assets/'.length);
  }
  const base = normalized.replace(/\.[^.]+$/, '').replace(/[\/]+/g, '_');
  let varName = 'img_' + base.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_');
  if (/^[0-9]/.test(varName)) {
    varName = 'img_' + varName;
  }
  return varName;
}

/**
 * Build font variable name
 * @param bpp Bits per pixel (render mode), defaults to 4
 * @param pixelOrder Bit order for glyph bitmap, defaults to 'LSB'
 */
export function buildFontVarName(fontFile: string, fontSize: number, bpp: number = 4, pixelOrder: 'MSB' | 'LSB' = 'LSB'): string {
  const baseName = path.basename(fontFile, path.extname(fontFile))
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  // Include pixelOrder suffix only for MSB (LSB is default, omit for backward compatibility)
  const pixelOrderSuffix = pixelOrder === 'MSB' ? '_msb' : '';
  return `font_${baseName}_${fontSize}_bpp${bpp}${pixelOrderSuffix}`;
}
