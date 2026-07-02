import type {
    I18nCatalog,
    I18nDiagnostic,
    I18nKey,
    LocaleCode,
    LocalizedTextResolution,
} from './types';

const CATALOG_VERSION = 1 as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanLocale(locale: unknown): LocaleCode | undefined {
    if (typeof locale !== 'string') {
        return undefined;
    }

    const trimmed = locale.trim();
    return trimmed ? trimmed : undefined;
}

function dedupeLocales(locales: LocaleCode[]): LocaleCode[] {
    const result: LocaleCode[] = [];
    for (const locale of locales) {
        if (!result.includes(locale)) {
            result.push(locale);
        }
    }
    return result;
}

export function createEmptyCatalog(defaultLocale: LocaleCode): I18nCatalog {
    const cleanDefaultLocale = cleanLocale(defaultLocale) || 'en-US';
    return {
        version: CATALOG_VERSION,
        defaultLocale: cleanDefaultLocale,
        locales: [cleanDefaultLocale],
        strings: {},
    };
}

export function normalizeCatalog(input: unknown, defaultLocale: LocaleCode): I18nCatalog {
    if (!isRecord(input)) {
        return createEmptyCatalog(defaultLocale);
    }

    const normalizedDefaultLocale = cleanLocale(input.defaultLocale) || cleanLocale(defaultLocale) || 'en-US';
    const inputLocales = Array.isArray(input.locales)
        ? input.locales.map(cleanLocale).filter((locale): locale is LocaleCode => Boolean(locale))
        : [];
    const locales = dedupeLocales([normalizedDefaultLocale, ...inputLocales]);
    const strings: I18nCatalog['strings'] = {};

    if (isRecord(input.strings)) {
        for (const [rawKey, rawEntry] of Object.entries(input.strings)) {
            const key = rawKey.trim();
            if (!key || !isRecord(rawEntry)) {
                continue;
            }

            const entry: Partial<Record<LocaleCode, string>> = {};
            for (const [rawLocale, rawText] of Object.entries(rawEntry)) {
                const locale = cleanLocale(rawLocale);
                if (!locale || typeof rawText !== 'string') {
                    continue;
                }
                entry[locale] = rawText;
                if (!locales.includes(locale)) {
                    locales.push(locale);
                }
            }

            strings[key] = entry;
        }
    }

    return {
        version: CATALOG_VERSION,
        defaultLocale: normalizedDefaultLocale,
        locales,
        strings,
    };
}

export function ensureLocale(catalog: I18nCatalog, locale: LocaleCode): I18nCatalog {
    const clean = cleanLocale(locale);
    if (clean && !catalog.locales.includes(clean)) {
        catalog.locales.push(clean);
    }
    return catalog;
}

/**
 * 删除一个语言集合（locale）：从 locales 列表移除，并清理每个 key 下该 locale 的翻译值。
 *
 * 必须同时清理 strings 里残留的翻译值——否则 normalizeCatalog 会遍历 strings 中出现过的
 * locale 并把它重新加回 locales，导致“删了又复活”。
 * defaultLocale 不允许删除（返回原 catalog 不变）。
 */
export function removeLocale(catalog: I18nCatalog, locale: LocaleCode): I18nCatalog {
    const clean = cleanLocale(locale);
    if (!clean || clean === catalog.defaultLocale || !catalog.locales.includes(clean)) {
        return catalog;
    }

    catalog.locales = catalog.locales.filter((item) => item !== clean);

    for (const key of Object.keys(catalog.strings)) {
        const entry = catalog.strings[key];
        if (entry && Object.prototype.hasOwnProperty.call(entry, clean)) {
            delete entry[clean];
        }
    }

    return catalog;
}

export function setTranslation(
    catalog: I18nCatalog,
    key: I18nKey,
    locale: LocaleCode,
    text: string,
): I18nCatalog {
    const cleanKey = key.trim();
    const cleanLocaleCode = cleanLocale(locale);
    if (!cleanKey || !cleanLocaleCode) {
        return catalog;
    }

    ensureLocale(catalog, cleanLocaleCode);
    if (!catalog.strings[cleanKey]) {
        catalog.strings[cleanKey] = {};
    }
    catalog.strings[cleanKey][cleanLocaleCode] = text;
    return catalog;
}

export function removeI18nKey(catalog: I18nCatalog, key: I18nKey): I18nCatalog {
    const cleanKey = key.trim();
    if (cleanKey && catalog.strings[cleanKey]) {
        delete catalog.strings[cleanKey];
    }
    return catalog;
}

export function listI18nKeys(catalog: I18nCatalog): string[] {
    return Object.keys(catalog.strings).sort((a, b) => a.localeCompare(b));
}

export function findUnusedKeys(catalog: I18nCatalog, referencedKeys: Set<string>): string[] {
    return listI18nKeys(catalog).filter((key) => !referencedKeys.has(key));
}

export function resolveLocalizedText(
    catalog: I18nCatalog | undefined,
    key: I18nKey | undefined,
    previewLocale: LocaleCode,
    fallbackText: string | undefined,
    fallbackName?: string,
): LocalizedTextResolution {
    const fallback = fallbackText ?? '';
    const requestedLocale = cleanLocale(previewLocale) || catalog?.defaultLocale || 'en-US';
    const cleanKey = key?.trim();

    if (catalog && cleanKey) {
        const entry = catalog.strings[cleanKey];
        const localeText = entry?.[requestedLocale];
        if (localeText !== undefined && localeText !== '') {
            return { text: localeText, source: 'locale', locale: requestedLocale, key: cleanKey };
        }

        const defaultText = entry?.[catalog.defaultLocale];
        if (defaultText !== undefined && defaultText !== '') {
            return { text: defaultText, source: 'defaultLocale', locale: catalog.defaultLocale, key: cleanKey };
        }
    }

    if (fallback !== '') {
        return { text: fallback, source: 'componentText', locale: requestedLocale, key: cleanKey };
    }

    return { text: fallbackName ?? '', source: 'componentName', locale: requestedLocale, key: cleanKey };
}

export function validateCatalog(catalog: I18nCatalog): I18nDiagnostic[] {
    const diagnostics: I18nDiagnostic[] = [];

    if (!catalog || catalog.version !== CATALOG_VERSION) {
        diagnostics.push({
            severity: 'error',
            code: 'invalid-catalog',
            message: 'i18n catalog version must be 1',
        });
    }

    if (!catalog.defaultLocale.trim()) {
        diagnostics.push({
            severity: 'error',
            code: 'empty-default-locale',
            message: 'defaultLocale is empty',
        });
    }

    for (const locale of catalog.locales) {
        if (!locale.trim()) {
            diagnostics.push({
                severity: 'error',
                code: 'empty-locale',
                message: 'locale is empty',
            });
        }
    }

    for (const [key, entry] of Object.entries(catalog.strings)) {
        if (!key.trim()) {
            diagnostics.push({
                severity: 'error',
                code: 'empty-key',
                message: 'i18n key is empty',
                key,
            });
            continue;
        }

        if (!entry[catalog.defaultLocale]) {
            diagnostics.push({
                severity: 'warning',
                code: 'missing-default-locale-translation',
                message: `${key} is missing ${catalog.defaultLocale} text`,
                key,
                locale: catalog.defaultLocale,
            });
        }

        for (const locale of catalog.locales) {
            if (locale === catalog.defaultLocale) {
                continue;
            }
            if (!entry[locale]) {
                diagnostics.push({
                    severity: 'warning',
                    code: 'missing-locale-translation',
                    message: `${key} is missing ${locale} text`,
                    key,
                    locale,
                });
            }
        }
    }

    return diagnostics;
}
