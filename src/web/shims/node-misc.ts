/**
 * 浏览器版 `os` / `perf_hooks` 替身
 */
export function homedir(): string {
    return '/home/web';
}

export function tmpdir(): string {
    return '/tmp';
}

export function platform(): string {
    return 'browser';
}

export function cpus(): unknown[] {
    return [{}];
}

export const EOL = '\n';

export const performance = globalThis.performance;

export default { homedir, tmpdir, platform, cpus, EOL, performance };
