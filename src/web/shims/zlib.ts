/**
 * 浏览器版 `zlib` 替身（基于 fflate），覆盖 pngjs 同步编解码用到的 API
 */
import { Buffer } from 'buffer';
import { unzlibSync, zlibSync, inflateSync as rawInflateSync, deflateSync as rawDeflateSync } from 'fflate';

interface ZlibOptions {
    level?: number;
    chunkSize?: number;
    maxLength?: number;
}

type Level = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

function toLevel(level?: number): Level {
    return (level === undefined || level < 0 || level > 9 ? 6 : level) as Level;
}

export function inflateSync(data: Uint8Array, options?: ZlibOptions): Buffer {
    const result = Buffer.from(unzlibSync(data));
    if (options?.maxLength !== undefined && result.length > options.maxLength) {
        return result.subarray(0, options.maxLength) as Buffer;
    }
    return result;
}

export function deflateSync(data: Uint8Array, options?: ZlibOptions): Buffer {
    return Buffer.from(zlibSync(data, { level: toLevel(options?.level) }));
}

export function inflateRawSync(data: Uint8Array): Buffer {
    return Buffer.from(rawInflateSync(data));
}

export function deflateRawSync(data: Uint8Array, options?: ZlibOptions): Buffer {
    return Buffer.from(rawDeflateSync(data, { level: toLevel(options?.level) }));
}

export const constants = {
    Z_NO_FLUSH: 0,
    Z_FINISH: 4,
    Z_OK: 0,
    Z_STREAM_END: 1,
    Z_DEFAULT_COMPRESSION: -1,
    Z_MIN_CHUNK: 64,
};

export const Z_MIN_CHUNK = constants.Z_MIN_CHUNK;
export const Z_FINISH = constants.Z_FINISH;

function unsupportedStream(): never {
    throw new Error('Streaming zlib is not available in the browser build');
}

export const createInflate = unsupportedStream;
export const createDeflate = unsupportedStream;
export class Inflate {
    constructor() {
        unsupportedStream();
    }
}
export class Deflate {
    constructor() {
        unsupportedStream();
    }
}

export default {
    inflateSync, deflateSync, inflateRawSync, deflateRawSync, constants, Z_MIN_CHUNK, Z_FINISH,
    createInflate, createDeflate, Inflate, Deflate,
};
