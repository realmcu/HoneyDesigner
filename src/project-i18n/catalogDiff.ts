import type { I18nCatalog } from './types';

export interface CatalogKeyRename {
    from: string;
    to: string;
}

export interface CatalogKeyChanges {
    /** 磁盘上新增的 key */
    added: string[];
    /** 磁盘上消失的 key */
    removed: string[];
    /** 消失 + 新增且翻译内容完全一致的 key，视为改名 */
    renamed: CatalogKeyRename[];
    /** 消失但没有对应新 key 的，视为删除 */
    deleted: string[];
}

export interface CatalogKeyChangeOptions {
    /**
     * 单次外部改动允许自动对账的 key 变化数上限。
     * 超过后不再自动改写 HML——分支切换、整体导入这类批量变化不是「用户改了词条」。
     */
    maxKeys?: number;
}

/**
 * 翻译内容指纹：语言 + 文本，用于识别改名。空词条返回空串，不参与改名匹配。
 */
function entryFingerprint(entry: Partial<Record<string, string>> | undefined): string {
    if (!entry) {
        return '';
    }
    return Object.keys(entry)
        .filter((locale) => typeof entry[locale] === 'string' && entry[locale] !== '')
        .sort()
        .map((locale) => `${locale}\u0000${entry[locale]}`)
        .join('\u0001');
}

/**
 * 比较两次读盘得到的 catalog，给出 key 级变化；改名按「翻译内容一致」唯一匹配识别。
 *
 * 外部改 strings.json 时，改名前后的 key 在文件里只是「删一个、加一个」，
 * 只能靠内容指纹还原用户的真实意图。
 */
export function diffCatalogKeys(previous: I18nCatalog, next: I18nCatalog): CatalogKeyChanges {
    const previousKeys = new Set(Object.keys(previous.strings));
    const nextKeys = new Set(Object.keys(next.strings));

    const removed = [...previousKeys].filter((key) => !nextKeys.has(key)).sort();
    const added = [...nextKeys].filter((key) => !previousKeys.has(key)).sort();

    const renamed: CatalogKeyRename[] = [];
    const claimed = new Set<string>();
    for (const from of removed) {
        const fingerprint = entryFingerprint(previous.strings[from]);
        if (!fingerprint) {
            continue;
        }
        const candidates = added.filter((to) =>
            !claimed.has(to) && entryFingerprint(next.strings[to]) === fingerprint);
        if (candidates.length === 1) {
            renamed.push({ from, to: candidates[0] });
            claimed.add(candidates[0]);
        }
    }

    const renamedFrom = new Set(renamed.map((item) => item.from));
    return {
        added,
        removed,
        renamed,
        deleted: removed.filter((key) => !renamedFrom.has(key)),
    };
}

/** 变化量是否超出自动对账上限（批量变化不应改写 HML） */
export function exceedsAutoReconcileLimit(changes: CatalogKeyChanges, options?: CatalogKeyChangeOptions): boolean {
    const maxKeys = options?.maxKeys ?? 8;
    return changes.removed.length + changes.added.length > maxKeys;
}
