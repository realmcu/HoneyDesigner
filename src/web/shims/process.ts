/**
 * 浏览器版全局 `process` 替身（由 webpack ProvidePlugin 注入）
 */
const env: Record<string, string | undefined> = {
    NODE_ENV: 'production',
};

const browserProcess = {
    env,
    platform: 'browser',
    arch: 'wasm',
    version: 'v20.0.0',
    versions: { node: '20.0.0' },
    argv: [] as string[],
    execPath: '/usr/bin/node',
    pid: 1,
    cwd: (): string => '/',
    chdir: (): void => { /* noop */ },
    nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]): void => {
        queueMicrotask(() => callback(...args));
    },
    hrtime: Object.assign(
        (previous?: [number, number]): [number, number] => {
            const now = performance.now();
            const seconds = Math.floor(now / 1000);
            const nanos = Math.floor((now % 1000) * 1e6);
            if (!previous) {
                return [seconds, nanos];
            }
            let diffSeconds = seconds - previous[0];
            let diffNanos = nanos - previous[1];
            if (diffNanos < 0) {
                diffSeconds--;
                diffNanos += 1e9;
            }
            return [diffSeconds, diffNanos];
        },
        { bigint: (): bigint => BigInt(Math.floor(performance.now() * 1e6)) }
    ),
    memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
    on: (): void => { /* noop */ },
    once: (): void => { /* noop */ },
    off: (): void => { /* noop */ },
    emitWarning: (warning: unknown): void => console.warn(warning),
    exit: (): void => { /* noop */ },
    stdout: { write: (chunk: string): boolean => { console.log(chunk); return true; } },
    stderr: { write: (chunk: string): boolean => { console.error(chunk); return true; } },
};

export default browserProcess;
