/**
 * 替换 pngjs/lib/sync-inflate.js
 *
 * 原实现直接调用 Node zlib 句柄的内部方法 `_processChunk` 分块解压，
 * 浏览器中改用 fflate 一次性解压，再按 pngjs 传入的 maxLength 截断。
 *
 * pngjs 以 CommonJS 方式 require 并直接调用本模块，因此这里不写 ES import/export，
 * 让 webpack 按 CommonJS 处理，module.exports 保持为函数。
 * （src/ 下的 .js 会被 npm run compile 的 clean:src 清理，所以用 .ts）
 */
const { Buffer: NodeBuffer } = require('buffer') as typeof import('buffer');
const { unzlibSync } = require('fflate') as typeof import('fflate');

function pngjsInflateSync(buffer: Uint8Array, options?: { maxLength?: number }) {
    const result = NodeBuffer.from(unzlibSync(buffer));
    if (options?.maxLength !== undefined && result.length > options.maxLength) {
        return result.subarray(0, options.maxLength);
    }
    return result;
}

module.exports = Object.assign(pngjsInflateSync, { inflateSync: pngjsInflateSync });
