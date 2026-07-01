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
import {
    collectI18nCatalogCharacters,
    collectI18nCatalogCharactersForKeys,
    summarizeI18nAutoCharset,
    summarizeI18nAutoCharsetForKeys,
} from '../src/project-i18n/autoCharset';
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

const autoCharsetText = collectI18nCatalogCharacters(catalog);
assert.ok(autoCharsetText.includes('S'));
assert.ok(autoCharsetText.includes('扫'));
assert.ok(autoCharsetText.includes('配'));
assert.strictEqual(
    Array.from(autoCharsetText).filter((char) => char === '配').length,
    1,
    'auto i18n charset should de-duplicate repeated characters',
);

const autoCharsetSummary = summarizeI18nAutoCharset(catalog);
assert.ok(autoCharsetSummary.source);
assert.strictEqual(autoCharsetSummary.source?.type, 'string');
assert.ok(autoCharsetSummary.charCount > 0);
assert.ok(autoCharsetSummary.stringCount >= 2);

setTranslation(catalog, 'pairing.skip', 'en-US', 'Jump over');
setTranslation(catalog, 'pairing.skip', 'zh-CN', '跳过');
setTranslation(catalog, 'unused.language_name', 'en-US', 'Simplified Chinese');
setTranslation(catalog, 'unused.language_name', 'zh-CN', '简体中文');

const scanOnlyCharsetText = collectI18nCatalogCharactersForKeys(catalog, ['pairing.scan_code']);
assert.ok(scanOnlyCharsetText.includes('扫'));
assert.ok(scanOnlyCharsetText.includes('S'));
assert.ok(!scanOnlyCharsetText.includes('跳'), 'key-scoped charset should not include other referenced keys');
assert.ok(!scanOnlyCharsetText.includes('简'), 'key-scoped charset should not include unused catalog keys');

const duplicateKeyCharsetText = collectI18nCatalogCharactersForKeys(catalog, [
    'pairing.scan_code',
    'pairing.scan_code',
    'missing.key',
]);
assert.strictEqual(duplicateKeyCharsetText, scanOnlyCharsetText);

const scanOnlySummary = summarizeI18nAutoCharsetForKeys(catalog, ['pairing.scan_code']);
assert.ok(scanOnlySummary.source);
assert.strictEqual(scanOnlySummary.source?.type, 'string');
assert.strictEqual(scanOnlySummary.stringCount, 2);
assert.strictEqual(scanOnlySummary.charCount, Array.from(scanOnlyCharsetText).length);

const emptyKeySummary = summarizeI18nAutoCharsetForKeys(catalog, []);
assert.strictEqual(emptyKeySummary.source, undefined);
assert.strictEqual(emptyKeySummary.charCount, 0);
assert.strictEqual(emptyKeySummary.stringCount, 0);

console.log('project-i18n tests passed');
