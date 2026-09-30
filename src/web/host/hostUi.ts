/**
 * 浏览器宿主的交互式 UI 请求队列
 *
 * vscode 替身（showInformationMessage / showInputBox / showQuickPick 等）把请求放进这里，
 * React 组件 HostOverlay 订阅并渲染；用户操作后通过 resolve 回到调用方 Promise。
 */

export type MessageSeverity = 'info' | 'warning' | 'error';

export interface ToastRequest {
    id: number;
    kind: 'toast';
    severity: MessageSeverity;
    message: string;
    items: string[];
    resolve: (item: string | undefined) => void;
}

export interface MessageDialogRequest {
    id: number;
    kind: 'message';
    severity: MessageSeverity;
    message: string;
    detail?: string;
    items: string[];
    resolve: (item: string | undefined) => void;
}

export interface InputDialogRequest {
    id: number;
    kind: 'input';
    prompt?: string;
    placeHolder?: string;
    value?: string;
    valueSelection?: [number, number];
    validateInput?: (value: string) => string | undefined | null | Promise<string | undefined | null>;
    resolve: (value: string | undefined) => void;
}

export interface QuickPickDialogItem {
    label: string;
    description?: string;
    detail?: string;
    picked?: boolean;
}

export interface QuickPickDialogRequest {
    id: number;
    kind: 'quickPick';
    items: QuickPickDialogItem[];
    canPickMany: boolean;
    placeHolder?: string;
    resolve: (indexes: number[] | undefined) => void;
}

export interface ProgressRequest {
    id: number;
    kind: 'progress';
    title: string;
    message?: string;
}

export interface CodeViewerRequest {
    id: number;
    kind: 'codeViewer';
    /** 虚拟文件系统中的绝对路径 */
    filePath: string;
    /** 高亮并滚动到的行（0 起始） */
    line?: number;
    resolve: () => void;
}

export interface LogViewerRequest {
    id: number;
    kind: 'logViewer';
    title: string;
    resolve: () => void;
}

export type HostUiRequest =
    | ToastRequest
    | MessageDialogRequest
    | InputDialogRequest
    | QuickPickDialogRequest
    | ProgressRequest
    | CodeViewerRequest
    | LogViewerRequest;

type Listener = () => void;

let nextId = 1;
let requests: HostUiRequest[] = [];
const listeners = new Set<Listener>();

function notify(): void {
    listeners.forEach(listener => listener());
}

function add<T extends HostUiRequest>(request: T): T {
    requests = [...requests, request];
    notify();
    return request;
}

function remove(id: number): void {
    requests = requests.filter(r => r.id !== id);
    notify();
}

/** 日志行（createOutputChannel 替身写入，LogViewer 读取） */
const logLines: string[] = [];
const MAX_LOG_LINES = 2000;

export const hostUi = {
    subscribe(listener: Listener): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },

    getSnapshot(): HostUiRequest[] {
        return requests;
    },

    /** 关闭请求并把结果交回调用方 */
    settle(request: HostUiRequest, result?: unknown): void {
        remove(request.id);
        if ('resolve' in request) {
            (request.resolve as (value?: unknown) => void)(result);
        }
    },

    showMessage(severity: MessageSeverity, message: string, items: string[], modal: boolean, detail?: string): Promise<string | undefined> {
        return new Promise(resolve => {
            if (modal) {
                add<MessageDialogRequest>({ id: nextId++, kind: 'message', severity, message, detail, items, resolve });
            } else {
                add<ToastRequest>({ id: nextId++, kind: 'toast', severity, message, items, resolve });
            }
        });
    },

    showInput(options: Omit<InputDialogRequest, 'id' | 'kind' | 'resolve'>): Promise<string | undefined> {
        return new Promise(resolve => {
            add<InputDialogRequest>({ id: nextId++, kind: 'input', ...options, resolve });
        });
    },

    showQuickPick(items: QuickPickDialogItem[], canPickMany: boolean, placeHolder?: string): Promise<number[] | undefined> {
        return new Promise(resolve => {
            add<QuickPickDialogRequest>({ id: nextId++, kind: 'quickPick', items, canPickMany, placeHolder, resolve });
        });
    },

    beginProgress(title: string): { report(message?: string): void; done(): void } {
        const request = add<ProgressRequest>({ id: nextId++, kind: 'progress', title });
        return {
            report(message?: string) {
                requests = requests.map(r => r.id === request.id ? { ...request, message } : r);
                notify();
            },
            done() {
                remove(request.id);
            },
        };
    },

    showCode(filePath: string, line?: number): Promise<void> {
        return new Promise(resolve => {
            // 同一时间只显示一个代码查看器：新请求替换旧请求
            requests.filter((r): r is CodeViewerRequest => r.kind === 'codeViewer').forEach(r => r.resolve());
            requests = requests.filter(r => r.kind !== 'codeViewer');
            add<CodeViewerRequest>({ id: nextId++, kind: 'codeViewer', filePath, line, resolve });
        });
    },

    showLog(title: string): Promise<void> {
        return new Promise(resolve => {
            add<LogViewerRequest>({ id: nextId++, kind: 'logViewer', title, resolve });
        });
    },

    appendLog(line: string): void {
        logLines.push(line);
        if (logLines.length > MAX_LOG_LINES) {
            logLines.splice(0, logLines.length - MAX_LOG_LINES);
        }
    },

    getLogLines(): string[] {
        return [...logLines];
    },
};
