/**
 * 浏览器版 `stream` 替身
 *
 * pngjs 的流式 PNG/Packer 类在模块加载时 `util.inherits(X, require("stream"))`；
 * 浏览器版只使用它的同步 API，这里提供可被继承的最小 Stream（EventEmitter + pipe）。
 *
 * 与 Node 一致，模块本身就是 Stream 类，子类挂在静态属性上。为此本文件不写 ES
 * import/export，让 webpack 按 CommonJS 处理，module.exports 保持为类本身。
 */
const { EventEmitter: BaseEmitter } = require('events') as typeof import('events');

class Stream extends BaseEmitter {
    readable = false;
    writable = false;

    pipe<T extends { write(chunk: unknown): unknown; end(): unknown }>(destination: T): T {
        this.on('data', chunk => destination.write(chunk));
        this.on('end', () => destination.end());
        return destination;
    }
}

class Readable extends Stream {}
class Writable extends Stream {}
class Transform extends Stream {}
class PassThrough extends Stream {}

module.exports = Object.assign(Stream, { Stream, Readable, Writable, Transform, PassThrough });
