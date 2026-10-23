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

// ---------------------------------------------------------------------------
// browser 模式：IndexedDB 文件
// ---------------------------------------------------------------------------

/** 把一组文件（相对路径 → 内容）整体写入 IndexedDB，用于新建/导入工程 */
export async function writeBrowserFiles(projectId: string, files: Map<string, Uint8Array>): Promise<void> {
    const db = await openDb();
    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
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
    await transactionDone(tx);
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
