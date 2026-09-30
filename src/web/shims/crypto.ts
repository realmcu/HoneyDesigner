/**
 * 浏览器版 `crypto` 替身
 *
 * 宿主代码只用 createHash('sha1' | 'sha256') 做内容指纹，且是同步调用，
 * WebCrypto 的 subtle.digest 是异步的，因此这里提供纯 JS 同步实现。
 */
import { Buffer } from 'buffer';

function rotl(x: number, n: number): number {
    return (x << n) | (x >>> (32 - n));
}

function rotr(x: number, n: number): number {
    return (x >>> n) | (x << (32 - n));
}

/** Merkle–Damgård 填充：追加 0x80、补零、写入 64 位大端比特长度 */
function pad(bytes: Uint8Array): DataView {
    const bitLength = bytes.byteLength * 8;
    const total = Math.ceil((bytes.byteLength + 9) / 64) * 64;
    const buffer = new Uint8Array(total);
    buffer.set(bytes);
    buffer[bytes.byteLength] = 0x80;
    const view = new DataView(buffer.buffer);
    view.setUint32(total - 8, Math.floor(bitLength / 0x100000000));
    view.setUint32(total - 4, bitLength >>> 0);
    return view;
}

function sha1(bytes: Uint8Array): Uint8Array {
    const view = pad(bytes);
    const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    const w = new Int32Array(80);
    for (let offset = 0; offset < view.byteLength; offset += 64) {
        for (let i = 0; i < 16; i++) {
            w[i] = view.getInt32(offset + i * 4);
        }
        for (let i = 16; i < 80; i++) {
            w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
        }
        let [a, b, c, d, e] = h;
        for (let i = 0; i < 80; i++) {
            let f: number;
            let k: number;
            if (i < 20) {
                f = (b & c) | (~b & d);
                k = 0x5a827999;
            } else if (i < 40) {
                f = b ^ c ^ d;
                k = 0x6ed9eba1;
            } else if (i < 60) {
                f = (b & c) | (b & d) | (c & d);
                k = 0x8f1bbcdc;
            } else {
                f = b ^ c ^ d;
                k = 0xca62c1d6;
            }
            const temp = (rotl(a, 5) + f + e + k + w[i]) | 0;
            e = d;
            d = c;
            c = rotl(b, 30);
            b = a;
            a = temp;
        }
        h[0] = (h[0] + a) | 0;
        h[1] = (h[1] + b) | 0;
        h[2] = (h[2] + c) | 0;
        h[3] = (h[3] + d) | 0;
        h[4] = (h[4] + e) | 0;
    }
    const out = new DataView(new ArrayBuffer(20));
    h.forEach((v, i) => out.setUint32(i * 4, v >>> 0));
    return new Uint8Array(out.buffer);
}

const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256(bytes: Uint8Array): Uint8Array {
    const view = pad(bytes);
    const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Int32Array(64);
    for (let offset = 0; offset < view.byteLength; offset += 64) {
        for (let i = 0; i < 16; i++) {
            w[i] = view.getInt32(offset + i * 4);
        }
        for (let i = 16; i < 64; i++) {
            const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        let [a, b, c, d, e, f, g, hh] = h;
        for (let i = 0; i < 64; i++) {
            const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (hh + s1 + ch + SHA256_K[i] + w[i]) | 0;
            const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (s0 + maj) | 0;
            hh = g;
            g = f;
            f = e;
            e = (d + t1) | 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) | 0;
        }
        h[0] = (h[0] + a) | 0;
        h[1] = (h[1] + b) | 0;
        h[2] = (h[2] + c) | 0;
        h[3] = (h[3] + d) | 0;
        h[4] = (h[4] + e) | 0;
        h[5] = (h[5] + f) | 0;
        h[6] = (h[6] + g) | 0;
        h[7] = (h[7] + hh) | 0;
    }
    const out = new DataView(new ArrayBuffer(32));
    h.forEach((v, i) => out.setUint32(i * 4, v >>> 0));
    return new Uint8Array(out.buffer);
}

const ALGORITHMS: Record<string, (bytes: Uint8Array) => Uint8Array> = { sha1, sha256 };

class Hash {
    private readonly chunks: Uint8Array[] = [];

    constructor(private readonly digestFn: (bytes: Uint8Array) => Uint8Array) {}

    update(data: string | Uint8Array, encoding?: BufferEncoding): this {
        this.chunks.push(typeof data === 'string' ? new Uint8Array(Buffer.from(data, encoding || 'utf8')) : data);
        return this;
    }

    digest(encoding?: BufferEncoding): string | Buffer {
        const total = this.chunks.reduce((sum, c) => sum + c.byteLength, 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const chunk of this.chunks) {
            merged.set(chunk, offset);
            offset += chunk.byteLength;
        }
        const result = Buffer.from(this.digestFn(merged));
        return encoding ? result.toString(encoding) : result;
    }
}

export function createHash(algorithm: string): Hash {
    const fn = ALGORITHMS[algorithm.toLowerCase()];
    if (!fn) {
        throw new Error(`Unsupported hash algorithm in browser build: ${algorithm}`);
    }
    return new Hash(fn);
}

export function randomBytes(size: number): Buffer {
    const bytes = new Uint8Array(size);
    globalThis.crypto.getRandomValues(bytes);
    return Buffer.from(bytes);
}

export function randomUUID(): string {
    return globalThis.crypto.randomUUID();
}

export default { createHash, randomBytes, randomUUID };
