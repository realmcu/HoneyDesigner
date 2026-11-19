/**
 * 浏览器工程存储
 *
 * 两种工程来源：
 * - browser：文件保存在 IndexedDB 中（新建工程、导入 ZIP）
 * - directory：用户通过 File System Access API 授权的本地目录，读写直接落到磁盘
 *
 * 编辑期间所有模块都通过内存文件系统（shims/fs.ts）读写；ProjectSync 监听
 * 内存文件系统变化，按路径合并后批量回写到对应的持久化后端。
 */
import * as path from 'path';
import * as fs from '../shims/fs';
import { vfs, VfsChange } from '../shims/fs';

export type ProjectStorageMode = 'browser' | 'directory';

export interface StoredProject {
    id: string;
    name: string;
    mode: ProjectStorageMode;
    updatedAt: number;
    handle?: FileSystemDirectoryHandle;
    /**
     * 工程来源地址（例如导入时的 GitHub 仓库 URL），仅用于展示来源。
     * 不含同步或自动更新语义：再次打开读的是浏览器里的副本，不会回源拉取。
     */
    sourceUrl?: string;
    /**
     * 来源工程的标识（例如 `github.com/owner/repo/子目录`），只用于导入时识别「已经导入过」，
     * 避免同一个仓库工程在浏览器里出现多份副本。
     */
    sourceKey?: string;
    /** 导入时的来源版本（GitHub commit SHA），用于提示已有副本是否与仓库当前版本一致 */
    sourceRevision?: string;
}

interface StoredEntry {
    key: string;
    projectId: string;
    path: string;
    kind: 'file' | 'dir';
    data?: Uint8Array;
}

/** 从本地目录读取时跳过的目录（编译产物、依赖、版本库） */
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'build', 'out', 'dist', '.vscode', '__pycache__']);
/** 超过此大小的单个文件不读入内存 */
const MAX_FILE_BYTES = 64 * 1024 * 1024;

const DB_NAME = 'honeygui-web';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('projects')) {
                    db.createObjectStore('projects', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('files')) {
                    const files = db.createObjectStore('files', { keyPath: 'key' });
                    files.createIndex('projectId', 'projectId');
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

function entryKey(projectId: string, relPath: string): string {
    return `${projectId}\u0000${relPath}`;
}

export function createProjectId(): string {
    return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 工程在内存文件系统中的根目录 */
export function projectRootOf(project: StoredProject): string {
    const safeName = project.name.replace(/[^A-Za-z0-9_.-]/g, '_') || 'project';
    return `/workspace/${project.id}/${safeName}`;
}

// ---------------------------------------------------------------------------
// 工程列表
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<StoredProject[]> {
    const db = await openDb();
    const tx = db.transaction('projects', 'readonly');
    const projects = await requestToPromise(tx.objectStore('projects').getAll() as IDBRequest<StoredProject[]>);
    return projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<StoredProject | undefined> {
    const db = await openDb();
    const tx = db.transaction('projects', 'readonly');
    return requestToPromise(tx.objectStore('projects').get(id) as IDBRequest<StoredProject | undefined>);
}

export async function saveProjectRecord(project: StoredProject): Promise<void> {
    const db = await openDb();
    const tx = db.transaction('projects', 'readwrite');
    tx.objectStore('projects').put(project);
    await transactionDone(tx);
}

export async function deleteProject(id: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(['projects', 'files'], 'readwrite');
    tx.objectStore('projects').delete(id);
    const index = tx.objectStore('files').index('projectId');
    const keys = await requestToPromise(index.getAllKeys(IDBKeyRange.only(id)));
    keys.forEach(key => tx.objectStore('files').delete(key));
    await transactionDone(tx);
}

/** 只删除工程记录，保留已存储的工程文件（启动页「清空记录」用） */
export async function deleteProjectRecord(id: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction('projects', 'readwrite');
    tx.objectStore('projects').delete(id);
    await transactionDone(tx);
}

/**
 * 删除本次新导入工程的写入痕迹。
 * 只按传入的工程 id 删，不会波及任何已有工程 —— 用于导入中途失败或校验不通过时回滚。
 */
export async function discardProject(id: string): Promise<void> {
    await deleteProject(id);
}

/** 清空最近工程列表；只移除记录，本地文件夹与浏览器中已存的工程文件都不动 */
export async function clearProjectHistory(projects: StoredProject[]): Promise<void> {
    for (const project of projects) {
        await deleteProjectRecord(project.id);
    }
}

/** 启动页列表要展示的工程信息，全部读自工程自身的 project.json */
export interface ProjectSummary {
    /** 入口 HML 文件（工程内相对路径） */
    mainHmlFile?: string;
    /** 画布分辨率，如 480X272 */
    resolution?: string;
}

/**
 * 读取工程的 project.json 取得入口文件与分辨率。
 * 本地目录工程在授权失效（未授予读权限）时读取会抛错，此时返回 undefined，
 * 由调用方退回到「本地文件夹 / 浏览器存储」这类已知信息，不弹权限提示。
 */
export async function readProjectSummary(project: StoredProject): Promise<ProjectSummary | undefined> {
    try {
        let text: string | undefined;
        if (project.mode === 'directory') {
            if (!project.handle) {
                return undefined;
            }
            const fileHandle = await project.handle.getFileHandle('project.json');
            text = await (await fileHandle.getFile()).text();
        } else {
            const db = await openDb();
            const tx = db.transaction('files', 'readonly');
            const entry = await requestToPromise(
                tx.objectStore('files').get(entryKey(project.id, 'project.json')) as IDBRequest<StoredEntry | undefined>
            );
            text = entry?.data ? new TextDecoder().decode(entry.data) : undefined;
        }
        if (!text) {
            return undefined;
        }
        const config = JSON.parse(text) as { mainHmlFile?: unknown; resolution?: unknown };
        return {
            mainHmlFile: typeof config.mainHmlFile === 'string' ? config.mainHmlFile : undefined,
            resolution: typeof config.resolution === 'string' ? config.resolution : undefined,
        };
    } catch {
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// browser 模式：IndexedDB 文件
// ---------------------------------------------------------------------------

/** 把一组文件（相对路径 → 内容）整体写入 IndexedDB，用于新建/导入工程 */
export async function writeBrowserFiles(projectId: string, files: Map<string, Uint8Array>): Promise<void> {
    const db = await openDb();
    const tx = db.transaction('files', 'readwrite');
    putBrowserFiles(tx.objectStore('files'), projectId, files);
    await transactionDone(tx);
}

/**
 * 把一组文件（相对路径 → 内容）写入用户授权的本地目录。
 *
 * 新建工程时直接用这个落盘，而不是写 IndexedDB：文件在真实磁盘上，
 * 外部 AI 工具才能直接读写工程，这正是网页版「新建工程后 AI 无法参与」的解法。
 */
export async function writeDirectoryFiles(
    handle: FileSystemDirectoryHandle,
    files: Map<string, Uint8Array>
): Promise<void> {
    for (const [relPath, data] of files) {
        const dirName = path.posix.dirname(relPath);
        const baseName = path.posix.basename(relPath);
        const dir = await resolveDirectory(handle, dirName === '.' ? '' : dirName, true);
        if (!dir) {
            throw new Error(`Cannot create directory for ${relPath}`);
        }
        const fileHandle = await dir.getFileHandle(baseName, { create: true });
        const writable = await (fileHandle as unknown as {
            createWritable(): Promise<{ write(data: BufferSource): Promise<void>; close(): Promise<void> }>;
        }).createWritable();
        await writable.write(data as unknown as BufferSource);
        await writable.close();
    }
}

/**
 * 把浏览器工程（IndexedDB）里的全部文件取出，写成「相对路径 → 内容」。
 *
 * 迁移到本地文件夹用：浏览器存储里的文件在磁盘上不存在，外部 AI 工具读不到，
 * 只有落到真实目录才能参与协作。
 */
export async function readBrowserFiles(project: StoredProject): Promise<Map<string, Uint8Array>> {
    const db = await openDb();
    const tx = db.transaction('files', 'readonly');
    const entries = await requestToPromise(
        tx.objectStore('files').index('projectId').getAll(IDBKeyRange.only(project.id)) as IDBRequest<StoredEntry[]>
    );
    const files = new Map<string, Uint8Array>();
    for (const entry of entries) {
        if (entry.kind === 'file' && entry.data) {
            files.set(entry.path, entry.data);
        }
    }
    return files;
}

/**
 * 用一组新文件整体替换浏览器工程的内容，并更新工程记录（重新下载覆盖已有副本时用）。
 *
 * 删旧文件、写新文件、改记录在同一个 IndexedDB 事务里完成：任一步失败整个事务回滚，
 * 旧副本保持原样，不会出现「旧文件删了一半、新文件没写完」的工程。
 */
export async function replaceBrowserProject(project: StoredProject, files: Map<string, Uint8Array>): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(['projects', 'files'], 'readwrite');
    const store = tx.objectStore('files');
    const keys = await requestToPromise(store.index('projectId').getAllKeys(IDBKeyRange.only(project.id)));
    keys.forEach(key => store.delete(key));
    putBrowserFiles(store, project.id, files);
    tx.objectStore('projects').put(project);
    await transactionDone(tx);
}

function putBrowserFiles(store: IDBObjectStore, projectId: string, files: Map<string, Uint8Array>): void {
    const dirs = new Set<string>();
    for (const [relPath, data] of files) {
        store.put({ key: entryKey(projectId, relPath), projectId, path: relPath, kind: 'file', data } satisfies StoredEntry);
        let dir = path.posix.dirname(relPath);
        while (dir !== '.' && !dirs.has(dir)) {
            dirs.add(dir);
            dir = path.posix.dirname(dir);
        }
    }
    dirs.forEach(dir => store.put({ key: entryKey(projectId, dir), projectId, path: dir, kind: 'dir' } satisfies StoredEntry));
}

async function loadBrowserProject(project: StoredProject, root: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction('files', 'readonly');
    const entries = await requestToPromise(
        tx.objectStore('files').index('projectId').getAll(IDBKeyRange.only(project.id)) as IDBRequest<StoredEntry[]>
    );
    const fileEntries: Array<[string, Uint8Array]> = [];
    for (const entry of entries) {
        const target = path.posix.join(root, entry.path);
        if (entry.kind === 'dir') {
            ensureDir(target);
        } else if (entry.data) {
            fileEntries.push([target, entry.data]);
        }
    }
    vfs.load(fileEntries);
}

/** 空目录也要恢复（资源面板里用户新建的空文件夹） */
function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// directory 模式：File System Access API
// ---------------------------------------------------------------------------

type PermissionMode = { mode: 'read' | 'readwrite' };
type HandleWithPermission = FileSystemDirectoryHandle & {
    queryPermission?(descriptor: PermissionMode): Promise<PermissionState>;
    requestPermission?(descriptor: PermissionMode): Promise<PermissionState>;
};

export async function hasDirectoryPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
    const h = handle as HandleWithPermission;
    return !h.queryPermission || (await h.queryPermission({ mode: 'readwrite' })) === 'granted';
}

/** 需在用户手势中调用 */
export async function requestDirectoryPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
    const h = handle as HandleWithPermission;
    if (!h.requestPermission) {
        return true;
    }
    return (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
}

export async function pickProjectDirectory(): Promise<FileSystemDirectoryHandle | undefined> {
    const picker = (globalThis as unknown as { showDirectoryPicker(options: PermissionMode): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    try {
        return await picker({ mode: 'readwrite' });
    } catch (error) {
        if ((error as DOMException)?.name === 'AbortError') {
            return undefined;
        }
        throw error;
    }
}

async function readDirectoryInto(handle: FileSystemDirectoryHandle, target: string, out: Array<[string, Uint8Array]>, dirs: string[]): Promise<void> {
    dirs.push(target);
    const entries = (handle as unknown as { values(): AsyncIterable<FileSystemHandle> }).values();
    for await (const entry of entries) {
        const childPath = path.posix.join(target, entry.name);
        if (entry.kind === 'directory') {
            if (!SKIPPED_DIRECTORIES.has(entry.name)) {
                await readDirectoryInto(entry as FileSystemDirectoryHandle, childPath, out, dirs);
            }
        } else {
            const file = await (entry as FileSystemFileHandle).getFile();
            if (file.size <= MAX_FILE_BYTES) {
                out.push([childPath, new Uint8Array(await file.arrayBuffer())]);
            }
        }
    }
}

/** 工程名 → 子目录名：只替换 Windows/macOS 文件名里不允许的字符，其余（含中文）保留 */
export function projectFolderName(name: string): string {
    const safe = name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
    return safe || 'project';
}

/** 父目录下能否放这个工程子目录：不存在，或存在但为空 */
export async function projectFolderAvailable(parent: FileSystemDirectoryHandle, folderName: string): Promise<boolean> {
    try {
        const existing = await parent.getDirectoryHandle(folderName);
        const entries = (existing as unknown as { keys(): AsyncIterableIterator<string> }).keys();
        return (await entries.next()).done === true;
    } catch (error) {
        if ((error as DOMException)?.name === 'NotFoundError') {
            return true;
        }
        throw error;
    }
}

/**
 * 在用户选择的父目录下建工程子目录，与 VS Code 版新建工程一致：选的是「保存位置」，
 * 工程放在其中以工程名命名的文件夹里，而不是把文件直接铺进所选目录。
 *
 * 同名子目录已存在且非空时返回 undefined，不往别人的文件里混写；已存在但为空时直接沿用。
 */
export async function createProjectDirectory(
    parent: FileSystemDirectoryHandle,
    folderName: string
): Promise<FileSystemDirectoryHandle | undefined> {
    if (!(await projectFolderAvailable(parent, folderName))) {
        return undefined;
    }
    return parent.getDirectoryHandle(folderName, { create: true });
}

export async function directoryContainsProject(handle: FileSystemDirectoryHandle): Promise<boolean> {
    try {
        await handle.getFileHandle('project.json');
        return true;
    } catch {
        return false;
    }
}

async function loadDirectoryProject(project: StoredProject, root: string): Promise<void> {
    if (!project.handle) {
        throw new Error('Missing directory handle');
    }
    const files: Array<[string, Uint8Array]> = [];
    const dirs: string[] = [];
    await readDirectoryInto(project.handle, root, files, dirs);
    dirs.forEach(ensureDir);
    vfs.load(files);
}

async function resolveDirectory(root: FileSystemDirectoryHandle, relDir: string, create: boolean): Promise<FileSystemDirectoryHandle | undefined> {
    let current = root;
    for (const segment of relDir.split('/').filter(Boolean)) {
        try {
            current = await current.getDirectoryHandle(segment, { create });
        } catch (error) {
            if (!create && (error as DOMException)?.name === 'NotFoundError') {
                return undefined;
            }
            throw error;
        }
    }
    return current;
}

// ---------------------------------------------------------------------------
// 打开工程 + 回写同步
// ---------------------------------------------------------------------------

export async function loadProjectIntoVfs(project: StoredProject): Promise<string> {
    const root = projectRootOf(project);
    ensureDir(root);
    if (project.mode === 'directory') {
        await loadDirectoryProject(project, root);
    } else {
        await loadBrowserProject(project, root);
    }
    return root;
}

export type SyncState = 'idle' | 'saving' | 'error';

/** 正在把磁盘上的外部改动写入内存文件系统（ProjectSync 据此不回写） */
let externalApplyDepth = 0;

/**
 * 把内存文件系统中工程目录下的变化回写到持久化后端。
 * 以「路径最终状态」为准：刷新时文件存在就写入，不存在就删除，
 * 这样原子写入产生的临时文件（先建后删）不会留下痕迹。
 */
export class ProjectSync {
    private readonly dirtyPaths = new Set<string>();
    private timer: ReturnType<typeof setTimeout> | undefined;
    private flushing: Promise<void> = Promise.resolve();
    private readonly unsubscribe: () => void;
    private state: SyncState = 'idle';
    private readonly stateListeners = new Set<(state: SyncState, error?: unknown) => void>();

    constructor(private readonly project: StoredProject, private readonly root: string) {
        this.unsubscribe = vfs.onChange(change => this.onChange(change));
        globalThis.addEventListener('beforeunload', this.onBeforeUnload);
    }

    onStateChange(listener: (state: SyncState, error?: unknown) => void): () => void {
        this.stateListeners.add(listener);
        return () => this.stateListeners.delete(listener);
    }

    get hasPendingChanges(): boolean {
        return this.dirtyPaths.size > 0 || this.state === 'saving';
    }

    dispose(): void {
        this.unsubscribe();
        globalThis.removeEventListener('beforeunload', this.onBeforeUnload);
        if (this.timer) {
            clearTimeout(this.timer);
        }
    }

    /** 立即回写所有待同步变化 */
    flush(): Promise<void> {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.flushing = this.flushing.then(() => this.flushNow());
        return this.flushing;
    }

    private readonly onBeforeUnload = (event: BeforeUnloadEvent) => {
        if (this.hasPendingChanges) {
            event.preventDefault();
            event.returnValue = '';
        }
    };

    private setState(state: SyncState, error?: unknown): void {
        this.state = state;
        this.stateListeners.forEach(listener => listener(state, error));
    }

    private onChange(change: VfsChange): void {
        const relative = path.posix.relative(this.root, change.path);
        if (!relative || relative.startsWith('..')) {
            return;
        }
        // 编译产物（build/ 等）随时可重新生成，打开工程时也不读取，不回写
        if (SKIPPED_DIRECTORIES.has(relative.split('/')[0])) {
            return;
        }
        // 从磁盘读进来的外部改动，磁盘上已经是这份内容，不再写回
        if (externalApplyDepth > 0) {
            return;
        }
        this.dirtyPaths.add(relative);
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => void this.flush(), 400);
    }

    private async flushNow(): Promise<void> {
        if (this.dirtyPaths.size === 0) {
            return;
        }
        const paths = [...this.dirtyPaths].sort();
        this.dirtyPaths.clear();
        this.setState('saving');
        try {
            if (this.project.mode === 'directory') {
                await this.flushToDirectory(paths);
            } else {
                await this.flushToIndexedDb(paths);
            }
            this.project.updatedAt = Date.now();
            await saveProjectRecord(this.project);
            this.setState(this.dirtyPaths.size > 0 ? 'saving' : 'idle');
        } catch (error) {
            paths.forEach(p => this.dirtyPaths.add(p));
            console.error('[ProjectSync] flush failed:', error);
            this.setState('error', error);
        }
    }

    private async flushToIndexedDb(paths: string[]): Promise<void> {
        const db = await openDb();
        const tx = db.transaction('files', 'readwrite');
        const store = tx.objectStore('files');
        const removedDirs: string[] = [];
        for (const relPath of paths) {
            const absolute = path.posix.join(this.root, relPath);
            const key = entryKey(this.project.id, relPath);
            const data = vfs.readBytes(absolute);
            if (data) {
                store.put({ key, projectId: this.project.id, path: relPath, kind: 'file', data } satisfies StoredEntry);
            } else if (vfs.isDirectory(absolute)) {
                store.put({ key, projectId: this.project.id, path: relPath, kind: 'dir' } satisfies StoredEntry);
            } else {
                store.delete(key);
                removedDirs.push(relPath);
            }
        }
        if (removedDirs.length > 0) {
            // 删除目录时 vfs 会逐个广播子项，这里再兜底清理残留子键
            const entries = await requestToPromise(store.index('projectId').getAll(IDBKeyRange.only(this.project.id)) as IDBRequest<StoredEntry[]>);
            for (const entry of entries) {
                if (removedDirs.some(dir => entry.path.startsWith(`${dir}/`))
                    && !vfs.readBytes(path.posix.join(this.root, entry.path))
                    && !vfs.isDirectory(path.posix.join(this.root, entry.path))) {
                    store.delete(entry.key);
                }
            }
        }
        await transactionDone(tx);
    }

    private async flushToDirectory(paths: string[]): Promise<void> {
        const handle = this.project.handle!;
        for (const relPath of paths) {
            const absolute = path.posix.join(this.root, relPath);
            const data = vfs.readBytes(absolute);
            const dirName = path.posix.dirname(relPath);
            const baseName = path.posix.basename(relPath);
            if (data) {
                const dir = await resolveDirectory(handle, dirName === '.' ? '' : dirName, true);
                const fileHandle = await dir!.getFileHandle(baseName, { create: true });
                const writable = await (fileHandle as unknown as { createWritable(): Promise<{ write(data: BufferSource): Promise<void>; close(): Promise<void> }> }).createWritable();
                await writable.write(data as unknown as BufferSource);
                await writable.close();
            } else if (vfs.isDirectory(absolute)) {
                await resolveDirectory(handle, relPath, true);
            } else {
                const dir = await resolveDirectory(handle, dirName === '.' ? '' : dirName, false);
                try {
                    await dir?.removeEntry(baseName, { recursive: true });
                } catch (error) {
                    if ((error as DOMException)?.name !== 'NotFoundError') {
                        throw error;
                    }
                }
            }
        }
    }
}

interface DiskStamp {
    lastModified: number;
    size: number;
}

/** 本地目录轮询间隔：AI 工具改完文件后两秒内画布跟上 */
const DIRECTORY_POLL_MS = 2000;

/**
 * 定时轮询本地目录，把外部程序（AI 工具、编辑器、git）对磁盘的改动读回内存文件系统。
 * File System Access API 没有变更通知，只能比对每个文件的修改时间和大小；
 * 时间戳变了再读内容，与内存中的内容一致（自己回写产生的）就只更新时间戳。
 * 有待回写的改动时跳过本轮：此刻磁盘与内存本来就不一致，等回写完成再比。
 */
export class DirectoryWatcher {
    private stamps = new Map<string, DiskStamp>();
    private timer: ReturnType<typeof setInterval> | undefined;
    private scanning = false;
    private disposed = false;

    constructor(
        private readonly handle: FileSystemDirectoryHandle,
        private readonly root: string,
        private readonly sync: ProjectSync,
        private readonly onExternalChange: (absolutePaths: string[]) => void,
    ) {}

    async start(): Promise<void> {
        this.stamps = await this.scan();
        if (this.disposed) {
            return;
        }
        this.timer = setInterval(() => void this.poll(), DIRECTORY_POLL_MS);
        globalThis.addEventListener('focus', this.onFocus);
    }

    dispose(): void {
        this.disposed = true;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        globalThis.removeEventListener('focus', this.onFocus);
    }

    /** 切回页面时立即检查一次，不必等下一个周期 */
    private readonly onFocus = () => void this.poll();

    private async poll(): Promise<void> {
        if (this.scanning || this.disposed || globalThis.document?.visibilityState === 'hidden' || this.sync.hasPendingChanges) {
            return;
        }
        this.scanning = true;
        try {
            const current = await this.scan();
            if (this.disposed || this.sync.hasPendingChanges) {
                return;
            }
            const changed: string[] = [];
            for (const [relPath, stamp] of current) {
                const previous = this.stamps.get(relPath);
                if (previous && previous.lastModified === stamp.lastModified && previous.size === stamp.size) {
                    continue;
                }
                const absolute = path.posix.join(this.root, relPath);
                const data = await this.readFile(relPath);
                // 读盘是异步的，期间设计器可能刚写了新内容：有待回写的改动就不覆盖。
                // 不更新时间戳，下一轮重新比对；已读回的文件下一轮内容一致会跳过
                if (this.disposed || this.sync.hasPendingChanges) {
                    if (changed.length > 0 && !this.disposed) {
                        this.onExternalChange(changed);
                    }
                    return;
                }
                if (data && !bytesEqual(data, vfs.readBytes(absolute))) {
                    this.applyExternal(() => {
                        fs.mkdirSync(path.posix.dirname(absolute), { recursive: true });
                        fs.writeFileSync(absolute, data);
                    });
                    changed.push(absolute);
                }
            }
            for (const relPath of this.stamps.keys()) {
                const absolute = path.posix.join(this.root, relPath);
                if (!current.has(relPath) && vfs.readBytes(absolute)) {
                    this.applyExternal(() => fs.rmSync(absolute, { force: true }));
                    changed.push(absolute);
                }
            }
            this.stamps = current;
            if (changed.length > 0) {
                this.onExternalChange(changed);
            }
        } catch (error) {
            // 权限被收回、目录被移走等：保留旧时间戳，下一轮再试
            console.warn('[DirectoryWatcher] poll failed:', error);
        } finally {
            this.scanning = false;
        }
    }

    private applyExternal(write: () => void): void {
        externalApplyDepth++;
        try {
            write();
        } finally {
            externalApplyDepth--;
        }
    }

    private async readFile(relPath: string): Promise<Uint8Array | undefined> {
        const dirName = path.posix.dirname(relPath);
        try {
            const dir = await resolveDirectory(this.handle, dirName === '.' ? '' : dirName, false);
            const file = await (await dir?.getFileHandle(path.posix.basename(relPath)))?.getFile();
            return file ? new Uint8Array(await file.arrayBuffer()) : undefined;
        } catch (error) {
            // 扫描后、读取前文件被删掉（原子写入的临时文件）：下一轮按删除处理
            if ((error as DOMException)?.name === 'NotFoundError') {
                return undefined;
            }
            throw error;
        }
    }

    /** 与打开工程时读取的范围一致：跳过编译产物目录和超大文件 */
    private async scan(): Promise<Map<string, DiskStamp>> {
        const out = new Map<string, DiskStamp>();
        const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
            const entries = (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values();
            for await (const entry of entries) {
                const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
                if (entry.kind === 'directory') {
                    if (!SKIPPED_DIRECTORIES.has(entry.name)) {
                        await walk(entry as FileSystemDirectoryHandle, relPath);
                    }
                    continue;
                }
                try {
                    const file = await (entry as FileSystemFileHandle).getFile();
                    if (file.size <= MAX_FILE_BYTES) {
                        out.set(relPath, { lastModified: file.lastModified, size: file.size });
                    }
                } catch (error) {
                    if ((error as DOMException)?.name !== 'NotFoundError') {
                        throw error;
                    }
                }
            }
        };
        await walk(this.handle, '');
        return out;
    }
}

function bytesEqual(a: Uint8Array, b: Uint8Array | undefined): boolean {
    if (!b || a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}
