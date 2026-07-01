import * as assert from 'assert';
import {
    createEmptyCatalog,
    ensureLocale,
    findUnusedKeys,
    normalizeCatalog,
    resolveLocalizedText,
    setTranslation,
    validateCatalog,
} from '../src/project-i18n/catalog';
import { buildProjectI18nIndex, suggestI18nKey } from '../src/project-i18n/projectIndex';
import { detectScripts } from '../src/project-i18n/script';
import { estimateTextEmWidth } from '../src/project-i18n/textMetrics';

const catalog = createEmptyCatalog('en-US');
ensureLocale(catalog, 'zh-CN');
setTranslation(catalog, 'pairing.scan_code', 'en-US', 'Scan code pairing');
setTranslation(catalog, 'pairing.scan_code', 'zh-CN', '扫码配对');

assert.deepStrictEqual(
    resolveLocalizedText(catalog, 'pairing.scan_code', 'zh-CN', 'Scan code pairing'),
    {
        text: '扫码配对',
        source: 'locale',
        locale: 'zh-CN',
        key: 'pairing.scan_code',
    },
);

assert.deepStrictEqual(
    resolveLocalizedText(catalog, 'pairing.scan_code', 'de-DE', 'Scan code pairing'),
    {
        text: 'Scan code pairing',
        source: 'defaultLocale',
        locale: 'en-US',
        key: 'pairing.scan_code',
    },
);

assert.deepStrictEqual(
    resolveLocalizedText(catalog, 'pairing.missing', 'zh-CN', 'Jump over'),
    {
        text: 'Jump over',
        source: 'componentText',
        locale: 'zh-CN',
        key: 'pairing.missing',
    },
);

const normalized = normalizeCatalog(
    {
        version: 0,
        defaultLocale: '  en-US  ',
        locales: ['en-US', 'zh-CN', 'zh-CN', '', 12],
        strings: {
            ' pairing.skip ': {
                ' zh-CN ': '跳过',
                'en-US': 'Jump over',
                bad: 1,
            },
            '': {
                'en-US': 'ignored',
            },
            invalid: 'ignored',
        },
    },
    'en-US',
);

assert.deepStrictEqual(normalized.locales, ['en-US', 'zh-CN']);
assert.deepStrictEqual(normalized.strings['pairing.skip'], {
    'zh-CN': '跳过',
    'en-US': 'Jump over',
});

ensureLocale(normalized, 'ja-JP');
ensureLocale(normalized, 'ja-JP');
assert.deepStrictEqual(normalized.locales, ['en-US', 'zh-CN', 'ja-JP']);

setTranslation(normalized, 'unused.key', 'en-US', 'Unused');
assert.deepStrictEqual(
    findUnusedKeys(normalized, new Set(['pairing.skip'])),
    ['unused.key'],
);

const diagnostics = validateCatalog({
    version: 1,
    defaultLocale: 'en-US',
    locales: ['en-US', 'zh-CN'],
    strings: {
        'pairing.scan_code': {
            'zh-CN': '扫码配对',
        },
    },
});

assert.ok(
    diagnostics.some((diagnostic) =>
        diagnostic.code === 'missing-default-locale-translation' &&
        diagnostic.key === 'pairing.scan_code' &&
        diagnostic.locale === 'en-US',
    ),
);

assert.ok(
    estimateTextEmWidth('扫码配对') > estimateTextEmWidth('Scan'),
    'CJK label text should estimate wider than a short Latin label',
);

assert.deepStrictEqual(detectScripts('Scan code pairing'), ['Latin']);
assert.deepStrictEqual(detectScripts('扫码配对'), ['CJK']);
assert.deepStrictEqual(detectScripts('コードをスキャン'), ['Kana']);
assert.deepStrictEqual(detectScripts('QR-Code koppeln'), ['Latin']);

assert.strictEqual(
    suggestI18nKey('ui/alone_select_mode_view.hml', 'asm_scan_text'),
    'alone_select_mode_view.asm_scan_text',
);

const projectIndex = buildProjectI18nIndex(catalog, [
    {
        filePath: 'ui/alone_select_mode_view.hml',
        id: 'asm_scan_text',
        type: 'hg_label',
        text: 'Scan code pairing',
        i18nKey: 'pairing.scan_code',
    },
    {
        filePath: 'ui/alone_select_mode_view.hml',
        id: 'asm_skip_text',
        type: 'hg_label',
        text: 'Jump over',
    },
]);

assert.strictEqual(projectIndex.rows.find((row) => row.key === 'pairing.scan_code')?.references.length, 1);
assert.strictEqual(projectIndex.unboundTexts[0].suggestedKey, 'alone_select_mode_view.asm_skip_text');
assert.ok(projectIndex.rows.every((row) => Array.isArray(row.missingLocales)));

console.log('project-i18n tests passed');
