/**
 * 浏览器版 `child_process` 替身
 *
 * 浏览器不能启动外部进程（Python、SCons、ffmpeg 等）。调用方都已经有进程启动
 * 失败的降级路径，这里让 spawn 立即以 error 事件结束、exec 立即回调错误。
 */
import { EventEmitter } from 'events';

function unsupported(command: string): Error {
    const err = new Error(`External process is not available in the browser: ${command}`) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    return err;
}

class BrowserChildProcess extends EventEmitter {
    readonly pid = undefined;
    readonly stdout = new EventEmitter();
    readonly stderr = new EventEmitter();
    readonly stdin = { write() { return false; }, end() { /* noop */ } };
    killed = false;
    exitCode: number | null = null;

    constructor(command: string) {
        super();
        setTimeout(() => {
            this.emit('error', unsupported(command));
            this.exitCode = -1;
            this.emit('close', -1, null);
            this.emit('exit', -1, null);
        }, 0);
    }

    kill(): boolean {
        this.killed = true;
        return true;
    }
}

export function spawn(command: string): BrowserChildProcess {
    return new BrowserChildProcess(command);
}

export function exec(command: string, ...args: unknown[]): BrowserChildProcess {
    const callback = args.find(arg => typeof arg === 'function') as ((err: Error, stdout: string, stderr: string) => void) | undefined;
    if (callback) {
        setTimeout(() => callback(unsupported(command), '', ''), 0);
    }
    return new BrowserChildProcess(command);
}

export const execFile = exec;

export function execSync(command: string): never {
    throw unsupported(command);
}

export const execFileSync = execSync;

export function spawnSync(command: string): { status: number; error: Error; stdout: string; stderr: string } {
    return { status: -1, error: unsupported(command), stdout: '', stderr: '' };
}

export default { spawn, exec, execFile, execSync, execFileSync, spawnSync };
