import type { Component } from '../hml/types';
import type { I18nCatalog } from '../project-i18n/types';
import { resolveLocalizedText } from '../project-i18n/catalog';

export interface ComposeAiBundleInput {
  components: Component[];
  selectedIds: string[];
  hmlRelPath: string;
  screenshotAbsPath: string;
  catalog?: I18nCatalog;
}

/** 递归叠加父容器偏移得到绝对坐标（纯函数）。 */
export function absolutePositionOf(components: Component[], comp: Component): { x: number; y: number } {
  if (!comp.parent) {
    return { x: comp.position.x, y: comp.position.y };
  }
  const parent = components.find((c) => c.id === comp.parent);
  if (!parent) {
    return { x: comp.position.x, y: comp.position.y };
  }
  const base = absolutePositionOf(components, parent);
  return { x: base.x + comp.position.x, y: base.y + comp.position.y };
}

const LABEL_TYPES = new Set(['hg_label', 'hg_time_label', 'hg_timer_label']);
const SALIENT_KEYS = [
  'fontSize', 'color', 'backgroundColor', 'src',
  'imageOn', 'imageOff', 'fontFile',
  'clickCallback', 'onCallback', 'offCallback',
];

function englishLocaleOf(catalog?: I18nCatalog): string {
  const fromList = catalog?.locales.find((l) => /^en/i.test(l));
  return fromList || catalog?.defaultLocale || 'en-US';
}

function controlLine(components: Component[], comp: Component, catalog?: I18nCatalog): string {
  const abs = absolutePositionOf(components, comp);
  const data: Record<string, any> = (comp.data as any) || {};
  const parts: string[] = [];

  if (LABEL_TYPES.has(comp.type) || data.text || data.i18nKey) {
    const resolved = resolveLocalizedText(
      catalog, data.i18nKey, englishLocaleOf(catalog), data.text, comp.name,
    ).text;
    if (resolved) {
      parts.push(`text="${resolved}"`);
    }
  }
  for (const key of SALIENT_KEYS) {
    const value = data[key];
    if (value !== undefined && value !== null && value !== '') {
      parts.push(`${key}=${value}`);
    }
  }

  const parent = comp.parent || 'view-root';
  const geom = `x=${abs.x} y=${abs.y} w=${comp.position.width} h=${comp.position.height}`;
  const tail = parts.length > 0 ? ` ${parts.join(' ')}` : '';
  return `- ${comp.id} (${comp.type}) parent=${parent} ${geom}${tail}`;
}

export function composeAiBundle(input: ComposeAiBundleInput): string {
  const { components, selectedIds, hmlRelPath, screenshotAbsPath, catalog } = input;
  const hasSelection = selectedIds.length > 0;

  const header = hasSelection
    ? `# HoneyGUI Designer selection — file: ${hmlRelPath}\n` +
      `Screenshot (selected items = red box, label = component id):\n${screenshotAbsPath}\n`
    : `# HoneyGUI Designer — file: ${hmlRelPath} (no selection, whole screen)\n` +
      `Screenshot:\n${screenshotAbsPath}\n`;

  const listed = hasSelection
    ? selectedIds
        .map((id) => components.find((c) => c.id === id))
        .filter((c): c is Component => Boolean(c))
    : components;

  const blockTitle = hasSelection ? 'Pointed controls:' : 'Full component tree:';
  const lines = listed.map((c) => controlLine(components, c, catalog));

  return `${header}\n${blockTitle}\n${lines.join('\n')}\n`;
}
