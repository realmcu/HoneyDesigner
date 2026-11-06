/**
 * 目标文件缓存与预编译产物的键：若干段内容的 SHA-256。
 * 页面、Worker 与 Node（CI 预编译）中 crypto.subtle 都可用，三处算出的键一致；
 * 不可用时（非安全上下文）退化为长度 + 抽样的弱指纹，只在本次会话的内存缓存里使用，
 * 不会与预编译产物的键相同。
 */
export async function contentKey(parts: Array<Uint8Array | string>): Promise<string> {
    const encoder = new TextEncoder();
    const bytes = parts.map(part => typeof part === 'string' ? encoder.encode(part) : part);
    if (globalThis.crypto?.subtle) {
        const joined = new Uint8Array(bytes.reduce((sum, part) => sum + part.length, 0));
        let offset = 0;
        for (const part of bytes) {
            joined.set(part, offset);
            offset += part.length;
        }
        const digest = await globalThis.crypto.subtle.digest('SHA-256', joined);
        return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    }

    let h = 2166136261;
    let length = 0;
    for (const data of bytes) {
        length += data.length;
        const step = Math.max(1, Math.floor(data.length / 4096));
        for (let i = 0; i < data.length; i += step) {
            h = Math.imul(h ^ data[i], 16777619);
        }
    }
    return `weak-${length}-${(h >>> 0).toString(16)}`;
}
