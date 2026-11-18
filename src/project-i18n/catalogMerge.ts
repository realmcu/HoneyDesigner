import type { I18nCatalog, LocaleCode } from './types';

export interface CatalogMergeResult {
    catalog: I18nCatalog;
    /** 从磁盘（外部改动）采纳的 key */
    adoptedKeys: string[];
    /** 双方改了同一 key 的同一语言且取值不同，最终以本地为准的 key */
    conflictedKeys: string[];
}

type CatalogEntry = Partial<Record<LocaleCode, string>>;

function cloneEntry(entry: CatalogEntry): CatalogEntry {
    const copy: CatalogEntry = {};
    for (const [locale, text] of Object.entries(entry)) {
        if (typeof text === 'string') {
            copy[locale] = text;
        }
    }
    return copy;
}

function entriesEqual(a: CatalogEntry | undefined, b: CatalogEntry | undefined): boolean {
    const left = a ?? {};
    const right = b ?? {};
    const locales = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const locale of locales) {
        if ((left[locale] ?? undefined) !== (right[locale] ?? undefined)) {
            return false;
        }
    }
    return true;
}

function sameLocaleList(a: LocaleCode[], b: LocaleCode[]): boolean {
    return a.length === b.length && a.every((locale, index) => locale === b[index]);
}

/** 结构比较（键与语言顺序无关），用于判断两份 catalog 是否有实质差异 */
export function catalogsEqual(a: I18nCatalog | undefined, b: I18nCatalog | undefined): boolean {
    if (!a || !b) {
        return a === b;
    }
    if (a.defaultLocale !== b.defaultLocale || (a.activeLocale ?? '') !== (b.activeLocale ?? '')) {
        return false;
    }
    const leftLocales = [...a.locales].sort();
    const rightLocales = [...b.locales].sort();
    if (!sameLocaleList(leftLocales, rightLocales)) {
        return false;
    }
    const keys = new Set([...Object.keys(a.strings), ...Object.keys(b.strings)]);
    for (const key of keys) {
        if (!entriesEqual(a.strings[key], b.strings[key])) {
            return false;
        }
    }
    return true;
}

/**
 * 三方合并：base 是本地页面最后一次见过的 catalog，ours 是页面提交的整份快照，
 * theirs 是磁盘现值。以 ours 为准，只把「本地没动、外部动过」的部分吸收进来。
 *
 * 整份快照保存没有版本信息，不合并就会在页面保存时覆盖掉外部改动。
 */
export function mergeCatalogExternalChanges(
    base: I18nCatalog,
    ours: I18nCatalog,
    theirs: I18nCatalog,
): CatalogMergeResult {
    const adoptedKeys: string[] = [];
    const conflictedKeys: string[] = [];
    const mergedStrings: I18nCatalog['strings'] = {};

    const allKeys = new Set([...Object.keys(ours.strings), ...Object.keys(theirs.strings)]);
    for (const key of allKeys) {
        const baseEntry = base.strings[key];
        const oursEntry = ours.strings[key];
        const theirsEntry = theirs.strings[key];

        if (!oursEntry) {
            // 本地没这个 key：base 也没有说明是外部新增，采纳；否则是本地删除，不复活
            if (!baseEntry && theirsEntry) {
                mergedStrings[key] = cloneEntry(theirsEntry);
                adoptedKeys.push(key);
            }
            continue;
        }

        if (!theirsEntry) {
            // 外部删除了该 key：本地没改动就跟着删，本地改过则保留
            if (!baseEntry || !entriesEqual(oursEntry, baseEntry)) {
                mergedStrings[key] = cloneEntry(oursEntry);
            }
            continue;
        }

        const entry: CatalogEntry = {};
        let conflicted = false;
        const locales = new Set([...Object.keys(oursEntry), ...Object.keys(theirsEntry)]);
        for (const locale of locales) {
            const localText = oursEntry[locale];
            const externalText = theirsEntry[locale];
            const baseText = baseEntry?.[locale];

            let text: string | undefined;
            if (localText === externalText) {
                text = localText;
            } else if (localText === baseText) {
                text = externalText;
            } else if (externalText === baseText) {
                text = localText;
            } else {
                // 双方都改了同一语言：本地是用户刚提交的输入，优先本地
                text = localText;
                conflicted = true;
            }
            if (text !== undefined) {
                entry[locale] = text;
            }
        }

        if (Object.keys(entry).length > 0) {
            mergedStrings[key] = entry;
        }
        if (!entriesEqual(entry, oursEntry)) {
            adoptedKeys.push(key);
        }
        if (conflicted) {
            conflictedKeys.push(key);
        }
    }

    // 语言列表：本地顺序为基准，吸收外部新增，跟随外部删除（本地重新加回的不算删除）
    const locales = [...ours.locales];
    for (const locale of theirs.locales) {
        if (!locales.includes(locale)) {
            locales.push(locale);
        }
    }
    for (const locale of base.locales) {
        if (theirs.locales.includes(locale) || !ours.locales.includes(locale)) {
            continue;
        }
        const index = locales.indexOf(locale);
        if (index >= 0 && locale !== ours.defaultLocale) {
            locales.splice(index, 1);
        }
    }

    const defaultLocale = ours.defaultLocale === base.defaultLocale && theirs.defaultLocale !== base.defaultLocale
        ? theirs.defaultLocale
        : ours.defaultLocale;
    const finalDefaultLocale = locales.includes(defaultLocale) ? defaultLocale : (locales[0] ?? 'en-US');

    const rawActiveLocale = ours.activeLocale === base.activeLocale && theirs.activeLocale !== base.activeLocale
        ? theirs.activeLocale
        : ours.activeLocale;
    const activeLocale = rawActiveLocale && locales.includes(rawActiveLocale)
        ? rawActiveLocale
        : finalDefaultLocale;

    // 被删除语言下的翻译值必须一并清理，否则 normalizeCatalog 会把语言重新加回
    for (const key of Object.keys(mergedStrings)) {
        const entry = mergedStrings[key];
        for (const locale of Object.keys(entry)) {
            if (!locales.includes(locale)) {
                delete entry[locale];
            }
        }
        if (Object.keys(entry).length === 0) {
            delete mergedStrings[key];
        }
    }

    return {
        catalog: {
            version: 1,
            defaultLocale: finalDefaultLocale,
            locales: locales.length > 0 ? locales : [finalDefaultLocale],
            strings: mergedStrings,
            activeLocale,
        },
        adoptedKeys: adoptedKeys.filter((key) => conflictedKeys.indexOf(key) < 0).sort(),
        conflictedKeys: conflictedKeys.sort(),
    };
}
