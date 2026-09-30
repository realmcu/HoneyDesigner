/**
 * 浏览器版 `assert` 替身
 */
export function ok(value: unknown, message?: string): asserts value {
    if (!value) {
        throw new Error(message || 'Assertion failed');
    }
}

export function equal(actual: unknown, expected: unknown, message?: string): void {
    ok(actual == expected, message || `${String(actual)} == ${String(expected)}`);
}

export function strictEqual(actual: unknown, expected: unknown, message?: string): void {
    ok(actual === expected, message || `${String(actual)} === ${String(expected)}`);
}

const assert = Object.assign((value: unknown, message?: string) => ok(value, message), { ok, equal, strictEqual });

export default assert;
