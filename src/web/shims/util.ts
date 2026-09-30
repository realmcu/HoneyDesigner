/**
 * 浏览器版 `util` 替身：覆盖第三方库（pngjs 等）加载时用到的少量 API
 */
export function inherits(ctor: { prototype: object; super_?: unknown }, superCtor: { prototype: object }): void {
    ctor.super_ = superCtor;
    Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
}

export function format(message: unknown, ...args: unknown[]): string {
    let index = 0;
    const text = String(message).replace(/%[sdifjoO%]/g, token => {
        if (token === '%%') {
            return '%';
        }
        if (index >= args.length) {
            return token;
        }
        const arg = args[index++];
        if (token === '%j' || token === '%o' || token === '%O') {
            try {
                return JSON.stringify(arg);
            } catch {
                return '[Circular]';
            }
        }
        return token === '%d' || token === '%i' ? String(Number(arg)) : String(arg);
    });
    return [text, ...args.slice(index).map(String)].join(' ');
}

export function inspect(value: unknown): string {
    try {
        return typeof value === 'string' ? value : JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export function deprecate<T extends (...args: never[]) => unknown>(fn: T): T {
    return fn;
}

export function promisify<T>(fn: (...args: unknown[]) => void): (...args: unknown[]) => Promise<T> {
    return (...args) => new Promise<T>((resolve, reject) => {
        fn(...args, (err: unknown, value: T) => (err ? reject(err) : resolve(value)));
    });
}

export const types = {
    isUint8Array: (value: unknown): value is Uint8Array => value instanceof Uint8Array,
};

export const TextEncoder = globalThis.TextEncoder;
export const TextDecoder = globalThis.TextDecoder;

export default { inherits, format, inspect, deprecate, promisify, types, TextEncoder, TextDecoder };
