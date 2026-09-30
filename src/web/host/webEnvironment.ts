/**
 * 浏览器宿主的运行环境信息：界面语言、当前工作区根目录、浏览器能力探测
 */

const LOCALE_STORAGE_KEY = 'honeygui.web.locale';

export type WebLocale = 'en' | 'zh-cn';

let workspaceFolder: string | undefined;

export function getWebLocale(): WebLocale {
    const saved = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY);
    if (saved === 'en' || saved === 'zh-cn') {
        return saved;
    }
    return globalThis.navigator?.language?.toLowerCase().startsWith('zh') ? 'zh-cn' : 'en';
}

export function setWebLocale(locale: WebLocale): void {
    globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, locale);
}

export function getWorkspaceFolder(): string | undefined {
    return workspaceFolder;
}

export function setWorkspaceFolder(folder: string | undefined): void {
    workspaceFolder = folder;
}

/** File System Access API（目前仅 Chromium 系浏览器支持目录读写） */
export function isDirectoryAccessSupported(): boolean {
    return typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}
