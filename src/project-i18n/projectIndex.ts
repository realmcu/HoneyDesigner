import type { I18nCatalog, LocaleCode } from './types';

export interface ProjectI18nReference {
    key: string;
    filePath: string;
    componentId: string;
    componentName: string;
    componentType: string;
    fallbackText: string;
}

export interface ProjectI18nUnboundText {
    filePath: string;
    componentId: string;
    componentName: string;
    componentType: string;
    text: string;
    suggestedKey: string;
}

export interface ProjectI18nRow {
    key: string;
    translations: Partial<Record<LocaleCode, string>>;
    references: ProjectI18nReference[];
    missingLocales: LocaleCode[];
    isUnused: boolean;
}

export interface ProjectI18nIndex {
    rows: ProjectI18nRow[];
    unboundTexts: ProjectI18nUnboundText[];
    duplicateTexts: Array<{ text: string; items: ProjectI18nUnboundText[] }>;
    locales: LocaleCode[];
}

export interface ProjectI18nComponentInput {
    filePath: string;
    id: string;
    name?: string;
    type: string;
    text?: string;
    i18nKey?: string;
}

function normalizeKeyPart(value: string): string {
    return value
        .trim()
        .replace(/\.hml$/i, '')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
}

export function suggestI18nKey(filePath: string, componentId: string): string {
    const fileName = filePath.split(/[\\/]/).pop() || 'screen';
    const normalizedFileName = normalizeKeyPart(fileName) || 'screen';
    const normalizedComponentId = normalizeKeyPart(componentId) || 'label';
    return `${normalizedFileName}.${normalizedComponentId}`;
}

export function buildProjectI18nIndex(
    catalog: I18nCatalog,
    components: ProjectI18nComponentInput[],
): ProjectI18nIndex {
    const referencesByKey = new Map<string, ProjectI18nReference[]>();
    const unboundTexts: ProjectI18nUnboundText[] = [];

    for (const component of components) {
        if (component.type !== 'hg_label') {
            continue;
        }

        const key = component.i18nKey?.trim();
        const fallbackText = component.text || '';

        if (key) {
            const refs = referencesByKey.get(key) || [];
            refs.push({
                key,
                filePath: component.filePath,
                componentId: component.id,
                componentName: component.name || component.id,
                componentType: component.type,
                fallbackText,
            });
            referencesByKey.set(key, refs);
            continue;
        }

        if (fallbackText.trim()) {
            unboundTexts.push({
                filePath: component.filePath,
                componentId: component.id,
                componentName: component.name || component.id,
                componentType: component.type,
                text: fallbackText,
                suggestedKey: suggestI18nKey(component.filePath, component.id),
            });
        }
    }

    const allKeys = Array.from(new Set([
        ...Object.keys(catalog.strings),
        ...Array.from(referencesByKey.keys()),
    ])).sort((a, b) => a.localeCompare(b));

    const rows = allKeys.map((key): ProjectI18nRow => {
        const translations = catalog.strings[key] || {};
        const references = referencesByKey.get(key) || [];
        return {
            key,
            translations,
            references,
            missingLocales: catalog.locales.filter((locale) => !translations[locale]),
            isUnused: references.length === 0,
        };
    });

    const duplicateMap = new Map<string, ProjectI18nUnboundText[]>();
    for (const item of unboundTexts) {
        const list = duplicateMap.get(item.text) || [];
        list.push(item);
        duplicateMap.set(item.text, list);
    }

    return {
        rows,
        unboundTexts,
        duplicateTexts: Array.from(duplicateMap.entries())
            .filter(([, items]) => items.length > 1)
            .map(([text, items]) => ({ text, items })),
        locales: catalog.locales,
    };
}
