import * as assert from 'assert';
import { LabelGenerator } from '../src/codegen/honeygui/components/LabelGenerator';
import { LvglLabelGenerator } from '../src/codegen/lvgl/components/LvglLabelGenerator';
import { Component } from '../src/hml/types';
import { createEmptyCatalog, setTranslation, setActiveLocale } from '../src/project-i18n/catalog';

function createLabel(data: Record<string, unknown>): Component {
    return {
        id: 'scan_label',
        type: 'hg_label',
        name: 'scan_label',
        position: { x: 0, y: 0, width: 180, height: 40 },
        style: { color: '#FFFFFF' },
        data,
        events: {},
        children: [],
        parent: null,
        visible: true,
        enabled: true,
        locked: false,
        zIndex: 0,
    };
}

const catalog = createEmptyCatalog('en-US');
setTranslation(catalog, 'pairing.scan_code', 'en-US', 'Catalog Default Scan');
setTranslation(catalog, 'pairing.scan_code', 'zh-CN', '扫码配对');

const generator = new LabelGenerator();
const context = {
    componentMap: new Map<string, Component>(),
    projectI18nCatalog: catalog,
    getParentRef: () => '(gui_obj_t *)view',
};

const localizedCode = generator.generatePropertySetters(
    createLabel({
        text: 'HML Fallback Scan',
        i18nKey: 'pairing.scan_code',
        fontSize: 20,
        fontType: 'bitmap',
    }),
    1,
    context,
);

assert.ok(
    localizedCode.includes('"Catalog Default Scan"'),
    'HoneyGUI label codegen should use default-locale catalog text when i18nKey is present',
);
assert.ok(
    !localizedCode.includes('"HML Fallback Scan"'),
    'HoneyGUI label codegen should not use HML fallback when default-locale catalog text exists',
);

const fallbackCode = generator.generatePropertySetters(
    createLabel({
        text: 'HML Fallback Scan',
        i18nKey: 'missing.key',
        fontSize: 20,
        fontType: 'bitmap',
    }),
    1,
    context,
);

assert.ok(
    fallbackCode.includes('"HML Fallback Scan"'),
    'HoneyGUI label codegen should fall back to HML text when catalog key is missing',
);

const escapedCatalog = createEmptyCatalog('en-US');
setTranslation(escapedCatalog, 'quote.test', 'en-US', 'Say "Hi"');

const escapedCode = generator.generatePropertySetters(
    createLabel({
        text: 'Fallback',
        i18nKey: 'quote.test',
        fontSize: 20,
        fontType: 'bitmap',
    }),
    1,
    {
        componentMap: new Map<string, Component>(),
        projectI18nCatalog: escapedCatalog,
        getParentRef: () => '(gui_obj_t *)view',
    },
);

assert.ok(
    escapedCode.includes('"Say \\"Hi\\""'),
    'HoneyGUI label codegen should escape catalog text as a C string',
);

// activeLocale != defaultLocale: codegen must switch to the user-selected language, not just default-locale.
const activeLocaleCatalog = createEmptyCatalog('en-US');
setTranslation(activeLocaleCatalog, 'pairing.scan_code', 'en-US', 'Catalog Default Scan');
setTranslation(activeLocaleCatalog, 'pairing.scan_code', 'zh-CN', '扫码配对');
setActiveLocale(activeLocaleCatalog, 'zh-CN');

const activeLocaleCode = generator.generatePropertySetters(
    createLabel({
        text: 'HML Fallback Scan',
        i18nKey: 'pairing.scan_code',
        fontSize: 20,
        fontType: 'bitmap',
    }),
    1,
    {
        componentMap: new Map<string, Component>(),
        projectI18nCatalog: activeLocaleCatalog,
        getParentRef: () => '(gui_obj_t *)view',
    },
);

assert.ok(
    activeLocaleCode.includes('"扫码配对"'),
    'HoneyGUI label codegen should use catalog.activeLocale text when it differs from defaultLocale',
);
assert.ok(
    !activeLocaleCode.includes('"Catalog Default Scan"'),
    'HoneyGUI label codegen should not fall back to defaultLocale text when activeLocale has a translation',
);

// Same activeLocale behavior must hold for the LVGL generator (duplicated resolveCodegenText logic).
const lvglGenerator = new LvglLabelGenerator();
const lvglCtx = {
    componentMap: new Map<string, Component>(),
    getParentRef: () => 'view',
    resources: {} as any,
    projectI18nCatalog: activeLocaleCatalog,
    getBuiltinImageVar: () => undefined,
    getBuiltinFontVar: () => null,
    getAncestorBackgroundColor: () => null,
};

const lvglActiveLocaleCode = lvglGenerator.generateCreation(
    createLabel({
        text: 'HML Fallback Scan',
        i18nKey: 'pairing.scan_code',
        fontSize: 20,
    }),
    'view',
    lvglCtx as any,
);

assert.ok(
    lvglActiveLocaleCode.includes('扫码配对'),
    'LVGL label codegen should use catalog.activeLocale text when it differs from defaultLocale',
);
assert.ok(
    !lvglActiveLocaleCode.includes('Catalog Default Scan'),
    'LVGL label codegen should not fall back to defaultLocale text when activeLocale has a translation',
);

console.log('codegen i18n tests passed');
