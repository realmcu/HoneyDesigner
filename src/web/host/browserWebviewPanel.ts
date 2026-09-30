/**
 * 浏览器版 WebviewPanel：宿主代码与 React 设计器运行在同一页面，
 * 通过 window.postMessage / 内存回调模拟 VS Code 的双向消息通道。
 *
 * 两个方向都做结构化克隆：VS Code 的 webview 消息天然是序列化后的副本，
 * 宿主代码（如 prepareComponentsForFrontend 返回内部数组）依赖这一点，
 * 共享引用会让前端的修改直接污染宿主文档。
 */
import * as vscode from '../shims/vscode';
import type { VSCodeAPI } from '../../webview/types';
import { resourceUrlFor } from './resourceUrls';

const STATE_STORAGE_PREFIX = 'honeygui.web.webviewState.';

function cloneMessage<T>(message: T): T {
    try {
        return structuredClone(message);
    } catch {
        return JSON.parse(JSON.stringify(message)) as T;
    }
}

class BrowserWebview {
    html = '';
    options: Record<string, unknown> = {};
    readonly cspSource = globalThis.location?.origin ?? '';
    private readonly messageEmitter = new vscode.EventEmitter<unknown>();
    readonly onDidReceiveMessage = this.messageEmitter.event;

    asWebviewUri(uri: vscode.Uri): vscode.Uri {
        return vscode.Uri.external(resourceUrlFor(uri.fsPath));
    }

    /** 宿主 → 设计器 */
    postMessage(message: unknown): Promise<boolean> {
        globalThis.postMessage(cloneMessage(message), globalThis.location.origin);
        return Promise.resolve(true);
    }

    /** 设计器 → 宿主（异步派发，与 VS Code 行为一致） */
    deliverFromDesigner(message: unknown): void {
        const copy = cloneMessage(message);
        setTimeout(() => this.messageEmitter.fire(copy), 0);
    }
}

export class BrowserWebviewPanel {
    readonly viewType = 'honeygui.hmlEditor';
    readonly webview = new BrowserWebview();
    readonly viewColumn = vscode.ViewColumn.One;
    title = '';
    visible = true;
    active = true;
    private disposed = false;

    private readonly disposeEmitter = new vscode.EventEmitter<void>();
    private readonly viewStateEmitter = new vscode.EventEmitter<{ webviewPanel: BrowserWebviewPanel }>();
    readonly onDidDispose = this.disposeEmitter.event;
    readonly onDidChangeViewState = this.viewStateEmitter.event;

    constructor(private readonly stateKey: string) {}

    reveal(): void {
        // 单面板页面，始终可见
    }

    /** 与 VS Code 一致：只触发一次 onDidDispose */
    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.visible = false;
        this.disposeEmitter.fire();
        this.disposeEmitter.dispose();
        this.viewStateEmitter.dispose();
    }

    /** 页面重新获得焦点时通知宿主（DesignerPanel 据此刷新跨文件组件 ID） */
    notifyViewStateChanged(): void {
        this.viewStateEmitter.fire({ webviewPanel: this });
    }

    /** 提供给 React 设计器的 acquireVsCodeApi() 等价对象 */
    createDesignerApi(): VSCodeAPI {
        const storageKey = STATE_STORAGE_PREFIX + this.stateKey;
        return {
            postMessage: message => this.webview.deliverFromDesigner(message),
            getState: () => {
                try {
                    return JSON.parse(globalThis.localStorage.getItem(storageKey) || 'null');
                } catch {
                    return null;
                }
            },
            setState: state => {
                try {
                    globalThis.localStorage.setItem(storageKey, JSON.stringify(state));
                } catch {
                    // 存储配额不足时静默忽略，仅影响界面偏好的记忆
                }
            },
        };
    }
}
