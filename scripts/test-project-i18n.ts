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

console.log('project-i18n tests passed');
