/**
 * 浏览器宿主的运行环境信息：界面语言、当前工作区根目录、浏览器能力探测
 */

/**
 * 界面语言偏好。键名带版本：早期版本没有默认值，会按浏览器语言自动落到中文，
 * 这段历史偏好与现在的「默认英文」相冲突，换个键让它一次性失效；
 * 之后用户主动选择的语言照常记住。
 */
const LOCALE_STORAGE_KEY = 'honeygui.web.locale.v2';

export type WebLocale = 'en' | 'zh-cn';

let workspaceFolder: string | undefined;

/**
 * 界面语言：默认英文，用户在顶栏切换后记住选择。
 * 不跟随浏览器的 navigator.language 自动切换，避免同一链接在不同机器上首屏语言不同。
 */
export function getWebLocale(): WebLocale {
    const saved = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY);
    if (saved === 'en' || saved === 'zh-cn') {
        return saved;
    }
    return 'en';
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
