/**
 * 浏览器版 `vscode` 模块替身
 *
 * 只实现设计器宿主代码（DesignerPanel / FileManager / MessageHandler / AssetManager /
 * CodeGenerationService 等）实际用到的 API 子集：
 * - 文件相关 API 落到内存文件系统（shims/fs.ts）
 * - 消息框、输入框、快速选择、进度、代码查看交给 hostUi，由 HostOverlay 渲染
 * - 仿真、串口烧录等依赖本机工具链的命令在浏览器版中不可用
 */
import * as path from 'path';
import * as fs from './fs';
import { vfs } from './fs';
import { hostUi, MessageSeverity, QuickPickDialogItem } from '../host/hostUi';
import { pickFiles } from '../host/filePicker';
import { getWebLocale, getWorkspaceFolder } from '../host/webEnvironment';
import zhCnBundle from '../../../l10n/bundle.l10n.zh-cn.json';

// ---------------------------------------------------------------------------
// 基础类型
// ---------------------------------------------------------------------------

export class Disposable {
    constructor(private readonly callOnDispose: () => void = () => { /* noop */ }) {}

    static from(...disposables: Array<{ dispose(): unknown }>): Disposable {
        return new Disposable(() => disposables.forEach(d => d.dispose()));
    }

    dispose(): void {
        this.callOnDispose();
    }
}

export type Event<T> = (listener: (e: T) => unknown, thisArgs?: unknown, disposables?: Disposable[]) => Disposable;

export class EventEmitter<T> {
    private readonly listeners = new Set<(e: T) => unknown>();

    readonly event: Event<T> = (listener, thisArgs, disposables) => {
        const bound = thisArgs ? listener.bind(thisArgs) : listener;
        this.listeners.add(bound);
        const disposable = new Disposable(() => this.listeners.delete(bound));
        disposables?.push(disposable);
        return disposable;
    };

    fire(data: T): void {
        [...this.listeners].forEach(listener => {
            try {
                listener(data);
            } catch (error) {
                console.error('[vscode-shim] event listener failed:', error);
            }
        });
    }

    dispose(): void {
        this.listeners.clear();
    }
}

export class Uri {
    private constructor(
        readonly scheme: string,
        readonly path: string,
        private readonly _external?: string
    ) {}

    static file(fsPath: string): Uri {
        return new Uri('file', vfs.normalize(fsPath));
    }

    static parse(value: string): Uri {
        if (value.startsWith('file://')) {
            return Uri.file(decodeURIComponent(value.slice('file://'.length)));
        }
        const scheme = value.includes(':') ? value.slice(0, value.indexOf(':')) : 'file';
        return new Uri(scheme, value, value);
    }

    static joinPath(base: Uri, ...segments: string[]): Uri {
        return new Uri(base.scheme, path.posix.join(base.path, ...segments));
    }

    /** 浏览器宿主内部使用：包装一个可直接给 <img>/fetch 使用的 URL */
    static external(url: string): Uri {
        return new Uri('blob', url, url);
    }

    get fsPath(): string {
        return this.path;
    }

    with(change: { path?: string }): Uri {
        return new Uri(this.scheme, change.path ?? this.path, this._external);
    }

    toString(): string {
        return this._external ?? `file://${this.path}`;
    }

    toJSON(): unknown {
        return { scheme: this.scheme, path: this.path, fsPath: this.fsPath, external: this.toString() };
    }
}

export class Position {
    constructor(readonly line: number, readonly character: number, readonly offset: number = -1) {}
}

export class Range {
    constructor(readonly start: Position, readonly end: Position) {}
}

export class Selection extends Range {
    constructor(readonly anchor: Position, readonly active: Position) {
        super(anchor, active);
    }
}

export class RelativePattern {
    readonly baseUri: Uri;

    constructor(base: string | Uri | { uri: Uri }, readonly pattern: string) {
        if (typeof base === 'string') {
            this.baseUri = Uri.file(base);
        } else if (base instanceof Uri) {
            this.baseUri = base;
        } else {
            this.baseUri = base.uri;
        }
    }

    get base(): string {
        return this.baseUri.fsPath;
    }
}

export enum ProgressLocation {
    SourceControl = 1,
    Window = 10,
    Notification = 15,
}

export enum TextEditorRevealType {
    Default = 0,
    InCenter = 1,
    InCenterIfOutsideViewport = 2,
    AtTop = 3,
}

export enum ViewColumn {
    Active = -1,
    Beside = -2,
    One = 1,
    Two = 2,
}

export enum FileType {
    Unknown = 0,
    File = 1,
    Directory = 2,
}

export class CancellationTokenSource {
    readonly token = { isCancellationRequested: false, onCancellationRequested: new EventEmitter<void>().event };
    cancel(): void { /* noop */ }
    dispose(): void { /* noop */ }
}

// ---------------------------------------------------------------------------
// l10n
// ---------------------------------------------------------------------------

function format(message: string, args: unknown[]): string {
    const named = args.length === 1 && args[0] && typeof args[0] === 'object' ? args[0] as Record<string, unknown> : undefined;
    return message.replace(/\{(\w+)\}/g, (match, key: string) => {
        if (named && key in named) {
            return String(named[key]);
        }
        const index = Number(key);
        return Number.isInteger(index) && index < args.length ? String(args[index]) : match;
    });
}

export const l10n = {
    t(message: string | { message: string; args?: unknown[] }, ...args: unknown[]): string {
        const key = typeof message === 'string' ? message : message.message;
        const params = typeof message === 'string' ? args : (message.args || []);
        const bundle: Record<string, string> | undefined = getWebLocale() === 'zh-cn' ? zhCnBundle : undefined;
        return format(bundle?.[key] ?? key, params);
    },
    bundle: undefined,
    uri: undefined,
};

// ---------------------------------------------------------------------------
// window
// ---------------------------------------------------------------------------

interface MessageOptions {
    modal?: boolean;
    detail?: string;
}

type MessageItem = string | { title: string };

function showMessage(severity: MessageSeverity, message: string, rest: unknown[]): Promise<any> {
    let options: MessageOptions = {};
    let items = rest as MessageItem[];
    if (rest.length > 0 && rest[0] && typeof rest[0] === 'object' && !('title' in (rest[0] as object))) {
        options = rest[0] as MessageOptions;
        items = rest.slice(1) as MessageItem[];
    }
    const labels = items.map(item => typeof item === 'string' ? item : item.title);
    return hostUi.showMessage(severity, message, labels, !!options.modal, options.detail).then(label => {
        if (label === undefined) {
            return undefined;
        }
        return items[labels.indexOf(label)];
    });
}

interface OutputChannel {
    name: string;
    append(value: string): void;
    appendLine(value: string): void;
    trace(value: string): void;
    debug(value: string): void;
    info(value: string): void;
    warn(value: string): void;
    error(value: string): void;
    clear(): void;
    show(): void;
    hide(): void;
    dispose(): void;
}

function createOutputChannel(name: string): OutputChannel {
    const write = (level: string, value: string) => {
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
        hostUi.appendLog(`[${timestamp}] [${name}] [${level}] ${value}`);
        if (level === 'error') {
            console.error(`[${name}]`, value);
        } else if (level === 'warn') {
            console.warn(`[${name}]`, value);
        }
    };
    return {
        name,
        append: value => write('info', value),
        appendLine: value => write('info', value),
        trace: value => write('trace', value),
        debug: value => write('debug', value),
        info: value => write('info', value),
        warn: value => write('warn', value),
        error: value => write('error', value),
        clear: () => { /* noop */ },
        show: () => { void hostUi.showLog(name); },
        hide: () => { /* noop */ },
        dispose: () => { /* noop */ },
    };
}

interface OpenDialogOptions {
    canSelectFiles?: boolean;
    canSelectFolders?: boolean;
    canSelectMany?: boolean;
    filters?: Record<string, string[]>;
    openLabel?: string;
    defaultUri?: Uri;
    title?: string;
}

interface InputBoxOptions {
    prompt?: string;
    placeHolder?: string;
    value?: string;
    valueSelection?: [number, number];
    validateInput?: (value: string) => string | undefined | null | Promise<string | undefined | null>;
}

interface QuickPickOptions {
    canPickMany?: boolean;
    placeHolder?: string;
}

class TextEditor {
    private _selection: Selection;

    constructor(readonly document: TextDocument) {
        const origin = new Position(0, 0, 0);
        this._selection = new Selection(origin, origin);
    }

    get selection(): Selection {
        return this._selection;
    }

    set selection(value: Selection) {
        this._selection = value;
    }

    revealRange(range: Range): void {
        void hostUi.showCode(this.document.uri.fsPath, range.start.line);
    }
}

export const window = {
    activeTextEditor: undefined as TextEditor | undefined,
    visibleTextEditors: [] as TextEditor[],

    showInformationMessage: (message: string, ...rest: unknown[]) => showMessage('info', message, rest),
    showWarningMessage: (message: string, ...rest: unknown[]) => showMessage('warning', message, rest),
    showErrorMessage: (message: string, ...rest: unknown[]) => showMessage('error', message, rest),

    async showInputBox(options: InputBoxOptions = {}): Promise<string | undefined> {
        return hostUi.showInput(options);
    },

    async showQuickPick<T extends string | QuickPickDialogItem>(items: readonly T[] | Promise<readonly T[]>, options: QuickPickOptions = {}): Promise<any> {
        const resolved = await items;
        const normalized: QuickPickDialogItem[] = resolved.map(item => typeof item === 'string' ? { label: item } : item as QuickPickDialogItem);
        const indexes = await hostUi.showQuickPick(normalized, !!options.canPickMany, options.placeHolder);
        if (!indexes) {
            return undefined;
        }
        const picked = indexes.map(i => resolved[i]);
        return options.canPickMany ? picked : picked[0];
    },

    async withProgress<R>(options: { title?: string }, task: (progress: { report(value: { message?: string; increment?: number }): void }, token: unknown) => Promise<R>): Promise<R> {
        const progress = hostUi.beginProgress(options.title || '');
        try {
            return await task({ report: value => progress.report(value.message) }, new CancellationTokenSource().token);
        } finally {
            progress.done();
        }
    },

    async showOpenDialog(options: OpenDialogOptions = {}): Promise<Uri[] | undefined> {
        const extensions = options.filters
            ? Object.values(options.filters).flat().filter(ext => ext !== '*')
            : [];
        const picked = await pickFiles({
            directory: !!options.canSelectFolders && !options.canSelectFiles,
            multiple: !!options.canSelectMany,
            extensions,
            label: options.openLabel || options.title,
        });
        return picked?.map(p => Uri.file(p));
    },

    async showSaveDialog(): Promise<Uri | undefined> {
        // 浏览器版中文档始终属于已打开的工程，不存在「另存为」到任意位置的场景
        return undefined;
    },

    async showTextDocument(documentOrUri: TextDocument | Uri): Promise<TextEditor> {
        const document = documentOrUri instanceof Uri ? await workspace.openTextDocument(documentOrUri) : documentOrUri;
        void hostUi.showCode(document.uri.fsPath);
        const editor = new TextEditor(document);
        window.activeTextEditor = editor;
        return editor;
    },

    createOutputChannel,

    setStatusBarMessage(): Disposable {
        return new Disposable();
    },

    createWebviewPanel(): never {
        throw new Error('createWebviewPanel is not available in the browser build');
    },
};

// ---------------------------------------------------------------------------
// workspace
// ---------------------------------------------------------------------------

function offsetToPosition(text: string, offset: number): Position {
    const clamped = Math.max(0, Math.min(offset, text.length));
    let line = 0;
    let lineStart = 0;
    for (let i = 0; i < clamped; i++) {
        if (text.charCodeAt(i) === 10) {
            line++;
            lineStart = i + 1;
        }
    }
    return new Position(line, clamped - lineStart, clamped);
}

function positionToOffset(text: string, position: Position): number {
    if (position.offset >= 0) {
        return position.offset;
    }
    let line = 0;
    let offset = 0;
    while (line < position.line && offset < text.length) {
        const next = text.indexOf('\n', offset);
        if (next < 0) {
            return text.length;
        }
        offset = next + 1;
        line++;
    }
    return Math.min(offset + position.character, text.length);
}

export class TextDocument {
    readonly isUntitled = false;
    readonly languageId = 'xml';
    readonly version = 1;

    constructor(readonly uri: Uri) {}

    get fileName(): string {
        return this.uri.fsPath;
    }

    get isDirty(): boolean {
        return false;
    }

    getText(range?: Range): string {
        const text = fs.existsSync(this.uri.fsPath) ? fs.readFileSync(this.uri.fsPath, 'utf8') as string : '';
        if (!range) {
            return text;
        }
        return text.slice(positionToOffset(text, range.start), positionToOffset(text, range.end));
    }

    positionAt(offset: number): Position {
        return offsetToPosition(this.getText(), offset);
    }

    offsetAt(position: Position): number {
        return positionToOffset(this.getText(), position);
    }

    get lineCount(): number {
        return this.getText().split('\n').length;
    }

    async save(): Promise<boolean> {
        // 编辑在 applyEdit 时已直接写入文件系统
        return true;
    }
}

interface TextEdit {
    uri: Uri;
    range: Range;
    newText: string;
}

export class WorkspaceEdit {
    readonly edits: TextEdit[] = [];

    replace(uri: Uri, range: Range, newText: string): void {
        this.edits.push({ uri, range, newText });
    }

    insert(uri: Uri, position: Position, newText: string): void {
        this.edits.push({ uri, range: new Range(position, position), newText });
    }

    delete(uri: Uri, range: Range): void {
        this.edits.push({ uri, range, newText: '' });
    }
}

const onDidRenameFilesEmitter = new EventEmitter<{ files: Array<{ oldUri: Uri; newUri: Uri }> }>();
const onDidSaveTextDocumentEmitter = new EventEmitter<TextDocument>();
const onDidChangeTextDocumentEmitter = new EventEmitter<unknown>();

/** 把 glob 转成正则：支持 **、*、?，其余字符按字面匹配 */
function globToRegExp(glob: string): RegExp {
    let source = '';
    for (let i = 0; i < glob.length; i++) {
        const ch = glob[i];
        if (ch === '*') {
            if (glob[i + 1] === '*') {
                const slash = glob[i + 2] === '/';
                source += slash ? '(?:.*/)?' : '.*';
                i += slash ? 2 : 1;
            } else {
                source += '[^/]*';
            }
        } else if (ch === '?') {
            source += '[^/]';
        } else {
            source += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        }
    }
    return new RegExp(`^${source}$`);
}

interface FileSystemWatcher extends Disposable {
    onDidCreate: Event<Uri>;
    onDidChange: Event<Uri>;
    onDidDelete: Event<Uri>;
}

function createFileSystemWatcher(pattern: RelativePattern | string): FileSystemWatcher {
    const base = typeof pattern === 'string' ? '/' : pattern.base;
    const regex = globToRegExp(typeof pattern === 'string' ? pattern.replace(/^\/+/, '') : pattern.pattern);
    const created = new EventEmitter<Uri>();
    const changed = new EventEmitter<Uri>();
    const deleted = new EventEmitter<Uri>();

    const unsubscribe = vfs.onChange(change => {
        const relative = path.posix.relative(base, change.path);
        if (!relative || relative.startsWith('..') || !regex.test(relative)) {
            return;
        }
        const uri = Uri.file(change.path);
        // 与 VS Code 一致：事件异步派发，写入方的同步流程先完成
        setTimeout(() => {
            if (change.type === 'create') {
                created.fire(uri);
            } else if (change.type === 'change') {
                changed.fire(uri);
            } else {
                deleted.fire(uri);
            }
        }, 0);
    });

    const watcher = new Disposable(() => {
        unsubscribe();
        created.dispose();
        changed.dispose();
        deleted.dispose();
    }) as FileSystemWatcher;
    watcher.onDidCreate = created.event;
    watcher.onDidChange = changed.event;
    watcher.onDidDelete = deleted.event;
    return watcher;
}

export const workspace = {
    get workspaceFolders(): Array<{ uri: Uri; name: string; index: number }> | undefined {
        const folder = getWorkspaceFolder();
        return folder ? [{ uri: Uri.file(folder), name: path.posix.basename(folder), index: 0 }] : undefined;
    },

    get rootPath(): string | undefined {
        return getWorkspaceFolder();
    },

    textDocuments: [] as TextDocument[],

    async openTextDocument(uriOrPath: Uri | string): Promise<TextDocument> {
        const uri = typeof uriOrPath === 'string' ? Uri.file(uriOrPath) : uriOrPath;
        if (!fs.existsSync(uri.fsPath)) {
            throw new Error(`File not found: ${uri.fsPath}`);
        }
        return new TextDocument(uri);
    },

    async applyEdit(edit: WorkspaceEdit): Promise<boolean> {
        const byFile = new Map<string, TextEdit[]>();
        for (const e of edit.edits) {
            const list = byFile.get(e.uri.fsPath) || [];
            list.push(e);
            byFile.set(e.uri.fsPath, list);
        }
        for (const [filePath, edits] of byFile) {
            let text = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') as string : '';
            const resolved = edits
                .map(e => ({ start: positionToOffset(text, e.range.start), end: positionToOffset(text, e.range.end), newText: e.newText }))
                .sort((a, b) => b.start - a.start);
            for (const e of resolved) {
                text = text.slice(0, e.start) + e.newText + text.slice(e.end);
            }
            fs.writeFileSync(filePath, text, 'utf8');
        }
        return true;
    },

    createFileSystemWatcher,

    onDidRenameFiles: onDidRenameFilesEmitter.event,
    onDidSaveTextDocument: onDidSaveTextDocumentEmitter.event,
    onDidChangeTextDocument: onDidChangeTextDocumentEmitter.event,

    getConfiguration() {
        return {
            get<T>(_key: string, defaultValue?: T): T | undefined {
                return defaultValue;
            },
            has: () => false,
            update: async () => { /* noop */ },
        };
    },

    fs: {
        async stat(uri: Uri) {
            const stats = fs.statSync(uri.fsPath)!;
            return {
                type: stats.isDirectory() ? FileType.Directory : FileType.File,
                size: stats.size,
                mtime: stats.mtimeMs,
                ctime: stats.mtimeMs,
            };
        },
        async readFile(uri: Uri): Promise<Uint8Array> {
            return new Uint8Array(fs.readFileSync(uri.fsPath) as Uint8Array);
        },
        async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
            fs.mkdirSync(path.posix.dirname(uri.fsPath), { recursive: true });
            fs.writeFileSync(uri.fsPath, content);
        },
        async delete(uri: Uri, options?: { recursive?: boolean }): Promise<void> {
            fs.rmSync(uri.fsPath, { recursive: !!options?.recursive, force: true });
        },
        async createDirectory(uri: Uri): Promise<void> {
            fs.mkdirSync(uri.fsPath, { recursive: true });
        },
    },
};

// ---------------------------------------------------------------------------
// commands / env
// ---------------------------------------------------------------------------

type CommandHandler = (...args: any[]) => unknown;
const commandRegistry = new Map<string, CommandHandler>();

export const commands = {
    registerCommand(id: string, handler: CommandHandler): Disposable {
        commandRegistry.set(id, handler);
        return new Disposable(() => commandRegistry.delete(id));
    },

    async executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T | undefined> {
        const handler = commandRegistry.get(id);
        if (handler) {
            return await handler(...args) as T;
        }
        if (!id.startsWith('_')) {
            console.warn(`[vscode-shim] command not available in browser: ${id}`);
        }
        return undefined;
    },
};

export const env = {
    get language(): string {
        return getWebLocale() === 'zh-cn' ? 'zh-cn' : 'en';
    },
    appName: 'HoneyGUI Designer Web',
    uriScheme: 'https',
    clipboard: {
        async writeText(text: string): Promise<void> {
            await navigator.clipboard.writeText(text);
        },
        async readText(): Promise<string> {
            return navigator.clipboard.readText();
        },
    },
    async openExternal(uri: Uri): Promise<boolean> {
        globalThis.open(uri.toString(), '_blank', 'noopener');
        return true;
    },
};

export const extensions = {
    getExtension: () => undefined,
};

export default {
    Disposable, EventEmitter, Uri, Position, Range, Selection, RelativePattern, ProgressLocation,
    TextEditorRevealType, ViewColumn, FileType, CancellationTokenSource, TextDocument, WorkspaceEdit,
    l10n, window, workspace, commands, env, extensions,
};
