/**
 * 浏览器内仿真构建：页面与构建 Worker 之间的消息协议
 *
 * 构建在 Worker 里完成（WASM 版 clang 编译约 50 秒，不能占用页面主线程）。
 * 输入是一份纯数据快照：生成的 C 源码、romfs C 源码、屏幕参数；
 * 输出是链接好的 project.wasm。引擎（主模块）与运行时资源由页面单独提供。
 */

export interface SimScreen {
    width: number;
    height: number;
    /** 8 / 16 / 24 / 32 */
    pixelBits: number;
    cornerRadius: number;
}

export interface BuildRequest {
    cmd: 'build';
    /** 引擎头文件与系统头文件的目录基址（相对页面） */
    toolchainBase: string;
    /** 项目 src/ 下的全部文件：相对路径 → 内容 */
    sources: Record<string, Uint8Array>;
    /** app_romfs.c 的内容；为空则不编译（浏览器仿真运行时资源走 ./assets，不依赖它） */
    romfs?: Uint8Array;
    screen: SimScreen;
}

export type BuildPhase = 'download' | 'compile' | 'romfs' | 'link';

export type WorkerMessage =
    | { type: 'progress'; phase: BuildPhase; done: number; total: number; file?: string }
    | { type: 'log'; text: string; isError?: boolean }
    | { type: 'done'; project: Uint8Array; timings: Record<string, number> }
    | { type: 'error'; message: string };

export interface BuildResult {
    project: Uint8Array;
    timings: Record<string, number>;
}
