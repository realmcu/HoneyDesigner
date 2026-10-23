/**
 * 目标文件缓存的键：源码内容与编译参数的 SHA-256。
 * Worker 中 crypto.subtle 可用（安全上下文）；不可用时退化为长度 + 抽样的弱指纹，
 * 此时缓存可能误命中的风险由「同一路径同长度同抽样」才相同来限制，且缓存只在本次会话有效。
 */
export async function sourceKey(data: Uint8Array, flags: string): Promise<string> {
    const flagBytes = new TextEncoder().encode(flags);
    if (globalThis.crypto?.subtle) {
        const joined = new Uint8Array(data.length + flagBytes.length);
        joined.set(data, 0);
        joined.set(flagBytes, data.length);
        const digest = await globalThis.crypto.subtle.digest('SHA-256', joined);
        return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    }

    let h = 2166136261;
    const step = Math.max(1, Math.floor(data.length / 4096));
    for (let i = 0; i < data.length; i += step) {
        h = Math.imul(h ^ data[i], 16777619);
    }
    for (const b of flagBytes) {
        h = Math.imul(h ^ b, 16777619);
    }
    return `weak-${data.length}-${(h >>> 0).toString(16)}`;
}
