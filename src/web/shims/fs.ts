/**
 * 浏览器版 `fs` 替身：内存文件系统
 *
 * 扩展宿主代码（hml / codegen / designer）大量使用 Node 同步 fs API。浏览器构建中
 * webpack 把 `fs` 指向本模块，让这些代码无需改动即可运行。路径统一为 POSIX 绝对路径。
 *
 * 只实现宿主代码实际用到的 API 子集；写操作会通过 vfs.onChange 广播，
 * 供 FileSystemWatcher 替身、IndexedDB 持久化和本地目录回写使用。
 */
import { Buffer } from 'buffer';
import * as path from 'path';

interface FileEntry {
    data: Uint8Array;
    mtimeMs: number;
}

export type VfsChangeType = 'create' | 'change' | 'delete';

export interface VfsChange {
    type: VfsChangeType;
    path: string;
    isDirectory: boolean;
}

type ChangeListener = (change: VfsChange) => void;

const files = new Map<string, FileEntry>();
const dirs = new Map<string, number>([['/', Date.now()]]);
const children = new Map<string, Set<string>>([['/', new Set()]]);
const listeners = new Set<ChangeListener>();

function normalize(p: string | URL | Buffer): string {
    let s = typeof p === 'string' ? p : p instanceof URL ? p.pathname : p.toString();
    s = s.replace(/\\/g, '/');
    if (/^[a-zA-Z]:\//.test(s)) {
        s = s.slice(2);
    }
    return path.posix.resolve('/', s);
}

function fsError(code: string, syscall: string, p: string): Error {
    const messages: Record<string, string> = {
        ENOENT: 'no such file or directory',
        EEXIST: 'file already exists',
        ENOTDIR: 'not a directory',
        EISDIR: 'illegal operation on a directory',
        ENOTEMPTY: 'directory not empty',
        EBADF: 'bad file descriptor',
    };
    const err = new Error(`${code}: ${messages[code] || code}, ${syscall} '${p}'`) as NodeJS.ErrnoException;
    err.code = code;
    err.syscall = syscall;
    err.path = p;
    return err;
}

function emit(type: VfsChangeType, p: string, isDirectory: boolean): void {
    const change = { type, path: p, isDirectory };
    for (const listener of [...listeners]) {
        try {
            listener(change);
        } catch (error) {
            console.error('[vfs] change listener failed:', error);
        }
    }
}

function link(p: string): void {
    const parent = path.posix.dirname(p);
    if (parent === p) {
        return;
    }
    children.get(parent)?.add(path.posix.basename(p));
}

function unlinkChild(p: string): void {
    const parent = path.posix.dirname(p);
    children.get(parent)?.delete(path.posix.basename(p));
}

function requireParentDir(p: string, syscall: string): void {
    const parent = path.posix.dirname(p);
    if (!dirs.has(parent)) {
        throw fsError(files.has(parent) ? 'ENOTDIR' : 'ENOENT', syscall, p);
    }
}

function toBytes(data: unknown, encoding?: BufferEncoding): Uint8Array {
    if (typeof data === 'string') {
        return new Uint8Array(Buffer.from(data, encoding || 'utf8'));
    }
    if (data instanceof Uint8Array) {
        return new Uint8Array(data);
    }
    if (data instanceof ArrayBuffer) {
        return new Uint8Array(data.slice(0));
    }
    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    }
    return new Uint8Array(Buffer.from(String(data)));
}

function encodingOf(options: unknown): BufferEncoding | undefined {
    if (typeof options === 'string') {
        return options as BufferEncoding;
    }
    if (options && typeof options === 'object' && 'encoding' in options) {
        return ((options as { encoding?: BufferEncoding | null }).encoding) || undefined;
    }
    return undefined;
}

function mkdirInternal(p: string, recursive: boolean): string | undefined {
    if (dirs.has(p)) {
        if (recursive) {
            return undefined;
        }
        throw fsError('EEXIST', 'mkdir', p);
    }
    if (files.has(p)) {
        throw fsError('EEXIST', 'mkdir', p);
    }
    const parent = path.posix.dirname(p);
    let first: string | undefined;
    if (!dirs.has(parent)) {
        if (!recursive) {
            throw fsError('ENOENT', 'mkdir', p);
        }
        first = mkdirInternal(parent, true);
    }
    dirs.set(p, Date.now());
    children.set(p, new Set());
    link(p);
    emit('create', p, true);
    return first || p;
}

function writeInternal(p: string, bytes: Uint8Array, syscall: string): void {
    if (dirs.has(p)) {
        throw fsError('EISDIR', syscall, p);
    }
    requireParentDir(p, syscall);
    const existed = files.has(p);
    files.set(p, { data: bytes, mtimeMs: Date.now() });
    if (!existed) {
        link(p);
    }
    emit(existed ? 'change' : 'create', p, false);
}

function removeFile(p: string): void {
    files.delete(p);
    unlinkChild(p);
    emit('delete', p, false);
}

function removeDirRecursive(p: string): void {
    for (const name of [...(children.get(p) || [])]) {
        const child = path.posix.join(p, name);
        if (dirs.has(child)) {
            removeDirRecursive(child);
        } else {
            removeFile(child);
        }
    }
    dirs.delete(p);
    children.delete(p);
    unlinkChild(p);
    emit('delete', p, true);
}

class Stats {
    readonly dev = 0;
    readonly ino = 0;
    readonly mode: number;
    readonly nlink = 1;
    readonly uid = 0;
    readonly gid = 0;
    readonly rdev = 0;
    readonly blksize = 4096;
    readonly blocks: number;
    readonly atimeMs: number;
    readonly ctimeMs: number;
    readonly birthtimeMs: number;
    readonly atime: Date;
    readonly mtime: Date;
    readonly ctime: Date;
    readonly birthtime: Date;

    constructor(private readonly _isDir: boolean, readonly size: number, readonly mtimeMs: number) {
        this.mode = _isDir ? 0o40755 : 0o100644;
        this.blocks = Math.ceil(size / 512);
        this.atimeMs = this.ctimeMs = this.birthtimeMs = mtimeMs;
        this.atime = this.mtime = this.ctime = this.birthtime = new Date(mtimeMs);
    }

    isFile(): boolean { return !this._isDir; }
    isDirectory(): boolean { return this._isDir; }
    isSymbolicLink(): boolean { return false; }
    isBlockDevice(): boolean { return false; }
    isCharacterDevice(): boolean { return false; }
    isFIFO(): boolean { return false; }
    isSocket(): boolean { return false; }
}

class Dirent {
    constructor(readonly name: string, private readonly _isDir: boolean, readonly parentPath: string) {}
    get path(): string { return this.parentPath; }
    isFile(): boolean { return !this._isDir; }
    isDirectory(): boolean { return this._isDir; }
    isSymbolicLink(): boolean { return false; }
    isBlockDevice(): boolean { return false; }
    isCharacterDevice(): boolean { return false; }
    isFIFO(): boolean { return false; }
    isSocket(): boolean { return false; }
}

// ---------------------------------------------------------------------------
// 同步 API
// ---------------------------------------------------------------------------

export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, COPYFILE_EXCL: 1 };

export function existsSync(p: string): boolean {
    try {
        const n = normalize(p);
        return files.has(n) || dirs.has(n);
    } catch {
        return false;
    }
}

export function accessSync(p: string): void {
    if (!existsSync(p)) {
        throw fsError('ENOENT', 'access', normalize(p));
    }
}

export function statSync(p: string, options?: { throwIfNoEntry?: boolean }): Stats | undefined {
    const n = normalize(p);
    const file = files.get(n);
    if (file) {
        return new Stats(false, file.data.byteLength, file.mtimeMs);
    }
    const dirTime = dirs.get(n);
    if (dirTime !== undefined) {
        return new Stats(true, 0, dirTime);
    }
    if (options?.throwIfNoEntry === false) {
        return undefined;
    }
    throw fsError('ENOENT', 'stat', n);
}

export const lstatSync = statSync;

export function realpathSync(p: string): string {
    const n = normalize(p);
    accessSync(n);
    return n;
}
(realpathSync as unknown as { native: typeof realpathSync }).native = realpathSync;

export function readFileSync(p: string | number, options?: unknown): Buffer | string {
    const n = typeof p === 'number' ? fdPath(p, 'read') : normalize(p);
    const file = files.get(n);
    if (!file) {
        throw fsError(dirs.has(n) ? 'EISDIR' : 'ENOENT', 'open', n);
    }
    const buffer = Buffer.from(file.data);
    const encoding = encodingOf(options);
    return encoding ? buffer.toString(encoding) : buffer;
}

export function writeFileSync(p: string | number, data: unknown, options?: unknown): void {
    const n = typeof p === 'number' ? fdPath(p, 'write') : normalize(p);
    writeInternal(n, toBytes(data, encodingOf(options)), 'open');
}

export function appendFileSync(p: string, data: unknown, options?: unknown): void {
    const n = normalize(p);
    const existing = files.get(n)?.data;
    const extra = toBytes(data, encodingOf(options));
    if (!existing) {
        writeInternal(n, extra, 'open');
        return;
    }
    const merged = new Uint8Array(existing.byteLength + extra.byteLength);
    merged.set(existing, 0);
    merged.set(extra, existing.byteLength);
    writeInternal(n, merged, 'open');
}

export function mkdirSync(p: string, options?: { recursive?: boolean } | number): string | undefined {
    const recursive = typeof options === 'object' && !!options?.recursive;
    return mkdirInternal(normalize(p), recursive);
}

export function mkdtempSync(prefix: string): string {
    const dir = `${normalize(prefix)}${Math.random().toString(36).slice(2, 8)}`;
    mkdirInternal(dir, true);
    return dir;
}

export function readdirSync(p: string, options?: unknown): string[] | Dirent[] {
    const n = normalize(p);
    if (!dirs.has(n)) {
        throw fsError(files.has(n) ? 'ENOTDIR' : 'ENOENT', 'scandir', n);
    }
    const names = [...(children.get(n) || [])].sort();
    const withFileTypes = !!(options && typeof options === 'object' && (options as { withFileTypes?: boolean }).withFileTypes);
    const recursive = !!(options && typeof options === 'object' && (options as { recursive?: boolean }).recursive);

    if (recursive) {
        const result: Array<string | Dirent> = [];
        const walk = (dir: string, rel: string) => {
            for (const name of [...(children.get(dir) || [])].sort()) {
                const full = path.posix.join(dir, name);
                const relName = rel ? `${rel}/${name}` : name;
                const isDir = dirs.has(full);
                result.push(withFileTypes ? new Dirent(name, isDir, dir) : relName);
                if (isDir) {
                    walk(full, relName);
                }
            }
        };
        walk(n, '');
        return result as string[] | Dirent[];
    }

    if (withFileTypes) {
        return names.map(name => new Dirent(name, dirs.has(path.posix.join(n, name)), n));
    }
    return names;
}

export function unlinkSync(p: string): void {
    const n = normalize(p);
    if (dirs.has(n)) {
        throw fsError('EISDIR', 'unlink', n);
    }
    if (!files.has(n)) {
        throw fsError('ENOENT', 'unlink', n);
    }
    removeFile(n);
}

export function rmdirSync(p: string, options?: { recursive?: boolean }): void {
    const n = normalize(p);
    if (!dirs.has(n)) {
        throw fsError(files.has(n) ? 'ENOTDIR' : 'ENOENT', 'rmdir', n);
    }
    if (!options?.recursive && (children.get(n)?.size || 0) > 0) {
        throw fsError('ENOTEMPTY', 'rmdir', n);
    }
    removeDirRecursive(n);
}

export function rmSync(p: string, options?: { recursive?: boolean; force?: boolean }): void {
    const n = normalize(p);
    if (files.has(n)) {
        removeFile(n);
        return;
    }
    if (dirs.has(n)) {
        if (!options?.recursive && (children.get(n)?.size || 0) > 0) {
            throw fsError('ENOTEMPTY', 'rm', n);
        }
        removeDirRecursive(n);
        return;
    }
    if (!options?.force) {
        throw fsError('ENOENT', 'rm', n);
    }
}

export function renameSync(from: string, to: string): void {
    const src = normalize(from);
    const dest = normalize(to);
    if (src === dest) {
        return;
    }
    const file = files.get(src);
    if (file) {
        requireParentDir(dest, 'rename');
        if (dirs.has(dest)) {
            throw fsError('EISDIR', 'rename', dest);
        }
        writeInternal(dest, file.data, 'rename');
        removeFile(src);
        return;
    }
    if (!dirs.has(src)) {
        throw fsError('ENOENT', 'rename', src);
    }
    requireParentDir(dest, 'rename');
    if (files.has(dest) || (dirs.has(dest) && (children.get(dest)?.size || 0) > 0)) {
        throw fsError('ENOTEMPTY', 'rename', dest);
    }
    copyDirRecursive(src, dest);
    removeDirRecursive(src);
}

function copyDirRecursive(src: string, dest: string): void {
    mkdirInternal(dest, true);
    for (const name of [...(children.get(src) || [])]) {
        const from = path.posix.join(src, name);
        const to = path.posix.join(dest, name);
        if (dirs.has(from)) {
            copyDirRecursive(from, to);
        } else {
            writeInternal(to, files.get(from)!.data, 'copyfile');
        }
    }
}

export function copyFileSync(from: string, to: string, mode?: number): void {
    const src = normalize(from);
    const dest = normalize(to);
    const file = files.get(src);
    if (!file) {
        throw fsError(dirs.has(src) ? 'EISDIR' : 'ENOENT', 'copyfile', src);
    }
    if (mode && (mode & constants.COPYFILE_EXCL) && existsSync(dest)) {
        throw fsError('EEXIST', 'copyfile', dest);
    }
    writeInternal(dest, new Uint8Array(file.data), 'copyfile');
}

export function cpSync(from: string, to: string, options?: { recursive?: boolean }): void {
    const src = normalize(from);
    if (dirs.has(src)) {
        if (!options?.recursive) {
            throw fsError('EISDIR', 'cp', src);
        }
        copyDirRecursive(src, normalize(to));
        return;
    }
    copyFileSync(from, to);
}

export function utimesSync(): void {
    // 内存文件系统不追踪访问时间
}

// 文件描述符：只支持读写整文件内容的简单场景（readSync 按偏移读取文件头）
const fds = new Map<number, string>();
let nextFd = 3;

function fdPath(fd: number, syscall: string): string {
    const p = fds.get(fd);
    if (!p) {
        throw fsError('EBADF', syscall, String(fd));
    }
    return p;
}

export function openSync(p: string, flags: string = 'r'): number {
    const n = normalize(p);
    if (flags.startsWith('r') && !files.has(n)) {
        throw fsError('ENOENT', 'open', n);
    }
    if ((flags.startsWith('w') || flags.startsWith('a')) && !files.has(n)) {
        writeInternal(n, new Uint8Array(0), 'open');
    }
    const fd = nextFd++;
    fds.set(fd, n);
    return fd;
}

export function readSync(fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null): number {
    const file = files.get(fdPath(fd, 'read'));
    if (!file) {
        return 0;
    }
    const start = position ?? 0;
    const chunk = file.data.subarray(start, Math.min(start + length, file.data.byteLength));
    buffer.set(chunk, offset);
    return chunk.byteLength;
}

export function fstatSync(fd: number): Stats | undefined {
    return statSync(fdPath(fd, 'fstat'));
}

export function closeSync(fd: number): void {
    fds.delete(fd);
}

export function watch(): { close(): void; on(): void } {
    return { close() { /* noop */ }, on() { /* noop */ } };
}

export function watchFile(): void { /* noop */ }
export function unwatchFile(): void { /* noop */ }

// ---------------------------------------------------------------------------
// Promise / 回调 API：直接包装同步实现
// ---------------------------------------------------------------------------

function wrapPromise<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => Promise<R> {
    return (...args: A) => new Promise<R>((resolve, reject) => {
        try {
            resolve(fn(...args));
        } catch (error) {
            reject(error);
        }
    });
}

export const promises = {
    access: wrapPromise(accessSync),
    readFile: wrapPromise(readFileSync),
    writeFile: wrapPromise(writeFileSync),
    appendFile: wrapPromise(appendFileSync),
    mkdir: wrapPromise(mkdirSync),
    mkdtemp: wrapPromise(mkdtempSync),
    readdir: wrapPromise(readdirSync),
    stat: wrapPromise(statSync),
    lstat: wrapPromise(statSync),
    realpath: wrapPromise(realpathSync),
    unlink: wrapPromise(unlinkSync),
    rmdir: wrapPromise(rmdirSync),
    rm: wrapPromise(rmSync),
    rename: wrapPromise(renameSync),
    copyFile: wrapPromise(copyFileSync),
    cp: wrapPromise(cpSync),
    utimes: wrapPromise(utimesSync),
};

function wrapCallback<A extends unknown[], R>(fn: (...args: A) => R) {
    return (...args: unknown[]) => {
        const callback = typeof args[args.length - 1] === 'function'
            ? args.pop() as (err: unknown, result?: R) => void
            : undefined;
        let result: R;
        try {
            result = fn(...(args as A));
        } catch (error) {
            if (callback) {
                setTimeout(() => callback(error), 0);
            }
            return;
        }
        if (callback) {
            setTimeout(() => callback(null, result), 0);
        }
    };
}

export const access = wrapCallback(accessSync);
export const readFile = wrapCallback(readFileSync);
export const writeFile = wrapCallback(writeFileSync);
export const appendFile = wrapCallback(appendFileSync);
export const mkdir = wrapCallback(mkdirSync);
export const readdir = wrapCallback(readdirSync);
export const stat = wrapCallback(statSync);
export const lstat = wrapCallback(statSync);
export const unlink = wrapCallback(unlinkSync);
export const rmdir = wrapCallback(rmdirSync);
export const rm = wrapCallback(rmSync);
export const rename = wrapCallback(renameSync);
export const copyFile = wrapCallback(copyFileSync);

export function exists(p: string, callback: (exists: boolean) => void): void {
    const result = existsSync(p);
    setTimeout(() => callback(result), 0);
}

export { Stats, Dirent };

// ---------------------------------------------------------------------------
// 浏览器宿主专用接口（不属于 Node fs）
// ---------------------------------------------------------------------------

export const vfs = {
    normalize,

    onChange(listener: ChangeListener): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },

    /** 批量写入（导入工程用），不逐个广播事件 */
    load(entries: Iterable<[string, Uint8Array]>): void {
        const saved = [...listeners];
        listeners.clear();
        try {
            for (const [p, data] of entries) {
                const n = normalize(p);
                mkdirInternal(path.posix.dirname(n), true);
                writeInternal(n, data, 'open');
            }
        } finally {
            saved.forEach(l => listeners.add(l));
        }
    },

    /** 列出目录下全部文件（递归），返回绝对路径 */
    listFiles(root: string): string[] {
        const n = normalize(root);
        const prefix = n === '/' ? '/' : `${n}/`;
        return [...files.keys()].filter(p => p.startsWith(prefix)).sort();
    },

    /** 列出目录下全部子目录（递归），返回绝对路径 */
    listDirs(root: string): string[] {
        const n = normalize(root);
        const prefix = n === '/' ? '/' : `${n}/`;
        return [...dirs.keys()].filter(p => p.startsWith(prefix)).sort();
    },

    readBytes(p: string): Uint8Array | undefined {
        return files.get(normalize(p))?.data;
    },

    mtime(p: string): number | undefined {
        const n = normalize(p);
        return files.get(n)?.mtimeMs ?? dirs.get(n);
    },

    isDirectory(p: string): boolean {
        return dirs.has(normalize(p));
    },
};

export default {
    constants, existsSync, accessSync, statSync, lstatSync, realpathSync, readFileSync, writeFileSync,
    appendFileSync, mkdirSync, mkdtempSync, readdirSync, unlinkSync, rmdirSync, rmSync, renameSync,
    copyFileSync, cpSync, utimesSync, openSync, readSync, fstatSync, closeSync, watch, watchFile,
    unwatchFile, promises, access, readFile, writeFile, appendFile, mkdir, readdir, stat, lstat, unlink,
    rmdir, rm, rename, copyFile, exists, Stats, Dirent,
};
