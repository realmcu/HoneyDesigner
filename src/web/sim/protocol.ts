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
    /** 每个编译单元的缓存键（buildCore.unitKeys，顺序同 buildCore.planBuild 的 units） */
    keys: string[];
    /** 站点上有预编译目标文件的键 */
    prebuilt: string[];
}

export type BuildPhase = 'download' | 'compile' | 'romfs' | 'link';

export type WorkerMessage =
    /** download：正在取编译器与头文件（total 为未知的下载量，恒为 0） */
    | { type: 'progress'; phase: BuildPhase; done: number; total: number; file?: string }
    /**
     * 下载单个文件的字节进度，几十 MB 的编译器下载期间界面靠它显示进度。
     * total 为 0 表示服务器没给 Content-Length，只能显示已下载字节数。
     */
    | { type: 'transfer'; file: string; loaded: number; total: number }
    | { type: 'log'; text: string; isError?: boolean }
    | { type: 'done'; project: Uint8Array; timings: Record<string, number> }
    | { type: 'error'; message: string };

export interface BuildResult {
    project: Uint8Array;
    timings: Record<string, number>;
}
