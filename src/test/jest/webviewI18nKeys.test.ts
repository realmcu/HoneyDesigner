/**
 * Webview i18n guard: the src/webview locale files (en.ts / zh-cn.ts) are not
 * covered by l10nBundles.test.ts, which only checks the extension-side
 * vscode.l10n bundles. These tests catch the failure mode where a label is
 * passed to t() as a literal that exists in neither bundle, so t() silently
 * returns the argument itself and the Chinese text leaks into the English UI.
 */
import * as fs from 'fs';
import * as path from 'path';
import en from '../../webview/i18n/locales/en';
import zhCN from '../../webview/i18n/locales/zh-cn';
import { ALIGNMENT_CONFIGS } from '../../webview/utils/alignmentUtils';
import { getMenuItems } from '../../webview/config/contextMenuConfig';
import { Component } from '../../webview/types';

const ROOT = path.resolve(__dirname, '../../..');
const WEBVIEW = path.join(ROOT, 'src/webview');
const CJK = /[一-鿿　-〿＀-￯]/;

const enKeys = new Set(Object.keys(en));
const zhKeys = new Set(Object.keys(zhCN));

function walkSources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSources(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Array of { file, line, key } for every `t('literal')` call in the webview. */
function collectLiteralKeys(): Array<{ where: string; key: string }> {
  const found: Array<{ where: string; key: string }> = [];
  for (const file of walkSources(WEBVIEW)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (rel.includes('/i18n/locales/')) continue;
    const source = fs.readFileSync(file, 'utf8');
    const re = /\bt\(\s*'((?:[^'\\]|\\.)+)'/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      const line = source.slice(0, match.index).split('\n').length;
      const key = match[1].replace(/\\(.)/g, '$1'); // unescape \' etc. to match the TS string value
      found.push({ where: `${rel}:${line}`, key });
    }
  }
  return found;
}

describe('webview i18n locale bundles', () => {
  it('en and zh-cn declare the same keys', () => {
    expect([...zhKeys].filter(k => !enKeys.has(k))).toEqual([]);
    expect([...enKeys].filter(k => !zhKeys.has(k))).toEqual([]);
  });

  it('en values never contain CJK text', () => {
    // 'Example: ABC123你好' intentionally shows CJK characters as a charset example.
    const intentional = new Set(['Example: ABC123你好']);
    const leaked = Object.keys(en)
      .filter(key => !intentional.has(key) && CJK.test((en as Record<string, string>)[key]))
      .map(key => `${JSON.stringify(key)} -> ${(en as Record<string, string>)[key]}`);
    expect(leaked).toEqual([]);
  });

  it('every t() literal in the webview resolves in both bundles', () => {
    const missing = collectLiteralKeys()
      .filter(({ key }) => !enKeys.has(key) || !zhKeys.has(key))
      .map(({ where, key }) => `${where} ${JSON.stringify(key)}`);
    expect(missing).toEqual([]);
  });
});

describe('webview i18n config-driven labels', () => {
  it('context menu labels resolve in both bundles', () => {
    // Every menu id reachable through getMenuItems must carry a translatable label.
    const component = { id: 'c1', type: 'hg_label', locked: false } as unknown as Component;
    for (const multi of [1, 2]) {
      for (const item of getMenuItems('hg_label', true, multi)) {
        if (typeof item.label === 'function') continue;
        expect(enKeys.has(item.label)).toBe(true);
        expect(zhKeys.has(item.label)).toBe(true);
      }
    }
    // The lock item toggles between two keys; cover both states.
    const locked = getMenuItems('hg_label', true, 1).find(i => i.id === 'lock')!;
    expect(typeof locked.label).toBe('function');
    for (const lockedState of [false, true]) {
      const label = (locked.label as (c: Component) => string)({ ...component, locked: lockedState });
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('alignment config labelKeys resolve in both bundles', () => {
    for (const config of ALIGNMENT_CONFIGS) {
      expect(enKeys.has(config.labelKey)).toBe(true);
      expect(zhKeys.has(config.labelKey)).toBe(true);
    }
  });
});
