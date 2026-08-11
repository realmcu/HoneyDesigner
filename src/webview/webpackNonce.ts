/**
 * 设置 webpack 运行时 nonce
 *
 * 按需加载的 chunk 由 webpack 运行时动态插入 <script> 标签。Webview 的 CSP
 * 只允许带正确 nonce 的脚本执行，因此必须把宿主注入的 nonce 交给 webpack。
 *
 * 这里独立成模块，是因为 ESM 的 import 声明会被提升 —— 写在入口文件 import
 * 语句之前的普通语句其实晚于依赖求值。作为入口的第一个 import，本模块的副作用
 * 会在其余依赖之前执行。
 */

declare let __webpack_nonce__: string;

if (typeof window !== 'undefined' && window.__honeyguiNonce) {
    __webpack_nonce__ = window.__honeyguiNonce;
}

export {};
