/**
 * 本机终端服务（tools/web-terminal）的连接参数与配对凭证。
 *
 * 首次连接时由本机用户在服务弹出的确认框中同意配对，服务下发长期凭证；凭证存在 localStorage，
 * 之后连接不再确认。页面只在用户打开终端面板时访问本机。
 */

/** 与 tools/web-terminal/server.js 的 PORT、PROTOCOL_VERSION 一致 */
export const TERMINAL_PORT = 38913;
export const TERMINAL_PROTOCOL = 1;

export const TERMINAL_DOWNLOAD_URL = 'https://github.com/realmcu/HoneyDesigner/releases/download/web-terminal-v0.1.0/HoneyGUI-Terminal.zip';
export const NODE_DOWNLOAD_URL = 'https://nodejs.org/';

const CREDENTIAL_KEY = 'honeygui.web.terminal.credential';

/** 隐私模式等场景下 localStorage 可能不可用，此时每次连接都需要重新配对 */
export function loadTerminalCredential(): string | undefined {
    try {
        return globalThis.localStorage?.getItem(CREDENTIAL_KEY) || undefined;
    } catch {
        return undefined;
    }
}

export function saveTerminalCredential(credential: string): void {
    try {
        globalThis.localStorage?.setItem(CREDENTIAL_KEY, credential);
    } catch {
        // 见 loadTerminalCredential
    }
}

export function clearTerminalCredential(): void {
    try {
        globalThis.localStorage?.removeItem(CREDENTIAL_KEY);
    } catch {
        // 见 loadTerminalCredential
    }
}
