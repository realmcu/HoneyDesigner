import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { createEmptyCatalog, normalizeCatalog } from './catalog';
import type { I18nCatalog, LocaleCode } from './types';

export const PROJECT_I18N_RELATIVE_PATH = path.join('i18n', 'strings.json');

export interface ProjectI18nCatalogReadResult {
    /** 文件是否存在 */
    exists: boolean;
    /** 内容解析成功时的规范化 catalog；文件缺失或 JSON 非法时为 undefined */
    catalog?: I18nCatalog;
    /** 文件存在但不可读或不是合法 JSON 时的错误描述 */
    error?: string;
    /** 原始内容 hash；文件缺失或读取失败时为 undefined */
    contentHash?: string;
}

/**
 * 读盘并区分「文件不存在」「内容非法」「内容合法」三种情况。
 *
 * 调用方不能把「非法」当成空 catalog 处理：空 catalog 会把表格清空，
 * 随后任何一次表格编辑都会把空目录整份写回，用户的词条随之丢失。
 */
export function readProjectI18nCatalogFile(
    projectRoot: string,
    defaultLocale: LocaleCode = 'en-US',
): ProjectI18nCatalogReadResult {
    const filePath = path.join(projectRoot, PROJECT_I18N_RELATIVE_PATH);
    if (!fs.existsSync(filePath)) {
        return { exists: false };
    }

    let raw: string;
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        return {
            exists: true,
            error: error instanceof Error ? error.message : String(error),
        };
    }

    const contentHash = createHash('sha1').update(raw, 'utf8').digest('hex');
    try {
        return {
            exists: true,
            catalog: normalizeCatalog(JSON.parse(raw), defaultLocale),
            contentHash,
        };
    } catch (error) {
        return {
            exists: true,
            error: error instanceof Error ? error.message : String(error),
            contentHash,
        };
    }
}

export function loadProjectI18nCatalog(projectRoot: string, defaultLocale: LocaleCode = 'en-US'): I18nCatalog {
    return readProjectI18nCatalogFile(projectRoot, defaultLocale).catalog
        ?? createEmptyCatalog(defaultLocale);
}

export function saveProjectI18nCatalog(projectRoot: string, catalog: I18nCatalog): void {
    const filePath = path.join(projectRoot, PROJECT_I18N_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
}
