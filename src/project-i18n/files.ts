import * as fs from 'fs';
import * as path from 'path';
import { createEmptyCatalog, normalizeCatalog } from './catalog';
import type { I18nCatalog, LocaleCode } from './types';

export const PROJECT_I18N_RELATIVE_PATH = path.join('i18n', 'strings.json');

export function loadProjectI18nCatalog(projectRoot: string, defaultLocale: LocaleCode = 'en-US'): I18nCatalog {
    const filePath = path.join(projectRoot, PROJECT_I18N_RELATIVE_PATH);
    if (!fs.existsSync(filePath)) {
        return createEmptyCatalog(defaultLocale);
    }

    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return normalizeCatalog(JSON.parse(raw), defaultLocale);
    } catch {
        return createEmptyCatalog(defaultLocale);
    }
}

export function saveProjectI18nCatalog(projectRoot: string, catalog: I18nCatalog): void {
    const filePath = path.join(projectRoot, PROJECT_I18N_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
}
