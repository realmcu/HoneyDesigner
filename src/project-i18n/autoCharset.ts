import type { I18nCatalog } from './types';

export interface I18nAutoCharsetSummary {
    source: { type: 'string'; value: string } | undefined;
    charCount: number;
    stringCount: number;
    preview: string;
}

function addTextCharacters(text: string, charSet: Set<string>): void {
    for (const char of Array.from(text)) {
        charSet.add(char);
    }
}

export function collectI18nCatalogCharacters(catalog: I18nCatalog | undefined): string {
    if (!catalog) {
        return '';
    }

    const charSet = new Set<string>();
    const keys = Object.keys(catalog.strings).sort((a, b) => a.localeCompare(b));

    for (const key of keys) {
        const entry = catalog.strings[key] || {};
        for (const locale of catalog.locales) {
            const text = entry[locale];
            if (typeof text === 'string' && text.length > 0) {
                addTextCharacters(text, charSet);
            }
        }

        const extraLocales = Object.keys(entry)
            .filter((locale) => !catalog.locales.includes(locale))
            .sort((a, b) => a.localeCompare(b));
        for (const locale of extraLocales) {
            const text = entry[locale];
            if (typeof text === 'string' && text.length > 0) {
                addTextCharacters(text, charSet);
            }
        }
    }

    return Array.from(charSet).join('');
}

function normalizeKeyList(keys: Iterable<string | undefined | null>): string[] {
    const result: string[] = [];
    for (const key of keys) {
        const normalized = typeof key === 'string' ? key.trim() : '';
        if (normalized && !result.includes(normalized)) {
            result.push(normalized);
        }
    }
    return result.sort((a, b) => a.localeCompare(b));
}

export function collectI18nCatalogCharactersForKeys(
    catalog: I18nCatalog | undefined,
    keys: Iterable<string | undefined | null>,
): string {
    if (!catalog) {
        return '';
    }

    const charSet = new Set<string>();
    const normalizedKeys = normalizeKeyList(keys);

    for (const key of normalizedKeys) {
        const entry = catalog.strings[key];
        if (!entry) {
            continue;
        }

        for (const locale of catalog.locales) {
            const text = entry[locale];
            if (typeof text === 'string' && text.length > 0) {
                addTextCharacters(text, charSet);
            }
        }

        const extraLocales = Object.keys(entry)
            .filter((locale) => !catalog.locales.includes(locale))
            .sort((a, b) => a.localeCompare(b));
        for (const locale of extraLocales) {
            const text = entry[locale];
            if (typeof text === 'string' && text.length > 0) {
                addTextCharacters(text, charSet);
            }
        }
    }

    return Array.from(charSet).join('');
}

export function summarizeI18nAutoCharset(catalog: I18nCatalog | undefined): I18nAutoCharsetSummary {
    const value = collectI18nCatalogCharacters(catalog);
    const stringCount = catalog
        ? Object.values(catalog.strings).reduce((count, entry) => {
            return count + Object.values(entry).filter((text) => typeof text === 'string' && text.length > 0).length;
        }, 0)
        : 0;

    return {
        source: value ? { type: 'string', value } : undefined,
        charCount: Array.from(value).length,
        stringCount,
        preview: Array.from(value).slice(0, 24).join(''),
    };
}

export function summarizeI18nAutoCharsetForKeys(
    catalog: I18nCatalog | undefined,
    keys: Iterable<string | undefined | null>,
): I18nAutoCharsetSummary {
    const normalizedKeys = normalizeKeyList(keys);
    const value = collectI18nCatalogCharactersForKeys(catalog, normalizedKeys);
    const stringCount = catalog
        ? normalizedKeys.reduce((count, key) => {
            const entry = catalog.strings[key];
            return count + (entry
                ? Object.values(entry).filter((text) => typeof text === 'string' && text.length > 0).length
                : 0);
        }, 0)
        : 0;

    return {
        source: value ? { type: 'string', value } : undefined,
        charCount: Array.from(value).length,
        stringCount,
        preview: Array.from(value).slice(0, 24).join(''),
    };
}
