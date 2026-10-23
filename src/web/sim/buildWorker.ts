/**
 * 构建 Worker：用 WASM 版 clang / wasm-ld 把工程的 C 源码编译链接成 project.wasm
 *
 * 在 Worker 中运行，编译期间页面保持可操作。编译器（约 105 MB）首次构建时才下载，
 * 之后由 Service Worker / HTTP 缓存提供。目标文件按「源码 + 编译参数」的哈希缓存在
 * 内存里：只改了界面代码时，未改动的文件（尤其是 22 MB 的 app_romfs.c）不会重编。
 */
/// <reference lib="webworker" />
import type { BuildRequest, WorkerMessage } from './protocol';
import { treeFromFlat, TreeNode } from './fileTree';
import { sourceKey } from './hash';

interface YowaspModule {
    runClang(args: string[], files: TreeNode, options?: Record<string, unknown>): Promise<Record<string, Uint8Array>>;
    runLLVM(args: string[], files: TreeNode, options?: Record<string, unknown>): Promise<Record<string, Uint8Array>>;
}

/** binaryen.js 中用到的部分 */
interface BinaryenModule {
    readBinary(data: Uint8Array): {
        runPasses(passes: string[]): void;
        optimize(): void;
        emitBinary(): Uint8Array;
        dispose(): void;
    };
    setOptimizeLevel(level: number): void;
    setPassArgument(key: string, value: string | null): void;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: WorkerMessage, transfer: Transferable[] = []) => ctx.postMessage(message, transfer);

/** 目标文件缓存：键为源码与编译参数的哈希。Worker 存活期间有效（页面不关闭就一直复用） */
const objectCache = new Map<string, Uint8Array>();
/** 工具链头文件（引擎头 + 系统头）是否已加载，以及对应的基址 */
let toolchain: { base: string; headers: Record<string, Uint8Array> } | undefined;
let compiler: YowaspModule | undefined;
let compilerBase: string | undefined;
let binaryen: { base: string; module: BinaryenModule } | undefined;

async function fetchBytes(url: string): Promise<Uint8Array> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${response.status} ${url}`);
    }
    return new Uint8Array(await response.arrayBuffer());
}

async function loadCompiler(base: string): Promise<YowaspModule> {
    if (compiler && compilerBase === base) {
        return compiler;
    }
    // 动态 import：这个 URL 在运行时才确定（编译器文件不随首屏下载）
    compiler = await import(/* webpackIgnore: true */ new URL('clang/bundle.js', base).href) as YowaspModule;
    compilerBase = base;
    return compiler;
}

async function loadBinaryen(base: string): Promise<BinaryenModule> {
    if (binaryen && binaryen.base === base) {
        return binaryen.module;
    }
    const imported = await import(/* webpackIgnore: true */ new URL('binaryen/index.js', base).href) as { default: BinaryenModule };
    binaryen = { base, module: imported.default };
    return binaryen.module;
}

/**
 * 引擎每帧在 gui_thread_mdelay() 里经 Asyncify 让出执行权，并用 Asyncify 切换协作线程。
 * 让出时调用栈上的每一层都必须能保存和恢复，而 clang 编出的 project.wasm 没有这层处理：
 * 工程代码调到会让出的函数（例如在 gui_thread_create 建的线程里 gui_thread_mdelay），
 * 恢复时就会报 unreachable。这里对链接产物补做与 emcc -sASYNCIFY 侧模块相同的变换。
 */
function asyncify(lib: BinaryenModule, wasm: Uint8Array): Uint8Array {
    const module = lib.readBinary(wasm);
    try {
        lib.setOptimizeLevel(1);
        // 侧模块使用主模块导出的 Asyncify 状态（emcc 对 SIDE_MODULE 传的也是这个参数）
        lib.setPassArgument('asyncify-import-globals', '1');
        module.runPasses(['asyncify']);
        module.optimize();
        return module.emitBinary();
    } finally {
        module.dispose();
    }
}

/** 头文件包格式见 scripts/prepare-web-sim.js 的 packHeaders：整体 deflate，内部是「长度 + 路径 + 长度 + 内容」的序列 */
async function unpackHeaders(compressed: Uint8Array): Promise<Record<string, Uint8Array>> {
    const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const raw = new Uint8Array(await new Response(stream).arrayBuffer());
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const decoder = new TextDecoder();
    const headers: Record<string, Uint8Array> = {};

    let offset = 4;
    for (let i = view.getUint32(0, true); i > 0; i--) {
        const nameLength = view.getUint16(offset, true);
        offset += 2;
        const name = decoder.decode(raw.subarray(offset, offset + nameLength));
        offset += nameLength;
        const size = view.getUint32(offset, true);
        offset += 4;
        headers[name] = raw.slice(offset, offset + size);
        offset += size;
    }
    return headers;
}

async function loadToolchain(base: string): Promise<Record<string, Uint8Array>> {
    if (toolchain && toolchain.base === base) {
        return toolchain.headers;
    }
    const headers = await unpackHeaders(await fetchBytes(new URL('toolchain.pack', base).href));
    toolchain = { base, headers };
    return headers;
}

function compileFlags(request: BuildRequest, sourceDirs: string[]): string[] {
    const { screen } = request;
    return [
        '--target=wasm32-unknown-emscripten', '-fPIC', '-O2', '-std=gnu99', '-nostdinc',
        '-isystem', 'clangres/include', '-isystem', 'sysroot/include/compat', '-isystem', 'sysroot/include',
        '-D_HONEYGUI_SIMULATOR_',
        `-DDRV_LCD_WIDTH=${screen.width}`, `-DDRV_LCD_HEIGHT=${screen.height}`,
        `-DDRV_LCD_CORNER_RADIUS=${screen.cornerRadius}`, `-DDRV_PIXEL_BITS=${screen.pixelBits}`,
        '-I', 'engine', ...sourceDirs.flatMap(dir => ['-I', dir]),
        // 生成代码不是给用户读警告的；真正的错误仍会让编译失败
        '-Wno-everything',
    ];
}

async function build(request: BuildRequest): Promise<void> {
    const timings: Record<string, number> = {};
    const lap = (name: string, since: number) => { timings[name] = Math.round(performance.now() - since); };

    let t = performance.now();
    post({ type: 'progress', phase: 'download', done: 0, total: 1 });
    const [clang, headers, wasmOpt] = await Promise.all([
        loadCompiler(request.toolchainBase), loadToolchain(request.toolchainBase), loadBinaryen(request.toolchainBase),
    ]);
    lap('load toolchain', t);

    const files: Record<string, Uint8Array> = { ...headers };
    for (const [name, data] of Object.entries(request.sources)) {
        files[`src/${name}`] = data;
    }
    const sourceNames = Object.keys(request.sources).filter(name => name.endsWith('.c'));
    const sourceDirs = [...new Set(Object.keys(request.sources).map(name => {
        const dir = name.split('/').slice(0, -1).join('/');
        return dir ? `src/${dir}` : 'src';
    }))];
    const flags = compileFlags(request, sourceDirs);
    const flagsKey = flags.join(' ');

    // 参与编译的每个单元：生成的 C 文件，加上可选的 app_romfs.c
    const units: Array<{ name: string; path: string; data: Uint8Array; extra: string[] }> = sourceNames.map(name => ({
        name, path: `src/${name}`, data: request.sources[name], extra: [],
    }));
    if (request.romfs) {
        files['app_romfs.c'] = request.romfs;
        units.push({ name: 'app_romfs.c', path: 'app_romfs.c', data: request.romfs, extra: ['-O1'] });
    }

    const tree = treeFromFlat(files);
    const objects: Record<string, Uint8Array> = {};
    t = performance.now();
    let compiled = 0;
    let reused = 0;

    for (const [index, unit] of units.entries()) {
        const isRomfs = unit.name === 'app_romfs.c';
        post({ type: 'progress', phase: isRomfs ? 'romfs' : 'compile', done: index, total: units.length, file: unit.name });

        const key = await sourceKey(unit.data, flagsKey + unit.extra.join(' '));
        let object = objectCache.get(key);
        if (object) {
            reused++;
        } else {
            const out = await clang.runClang(['clang', ...flags, ...unit.extra, '-c', unit.path, '-o', 'out.o'], tree);
            object = out['out.o'];
            if (!object || object.length === 0) {
                throw new Error(`Compiler produced no output for ${unit.name}`);
            }
            objectCache.set(key, object);
            compiled++;
        }
        objects[`${unit.name.replace(/\//g, '_')}.o`] = object;
    }
    lap('compile', t);
    timings.compiled = compiled;
    timings.reused = reused;
    post({ type: 'progress', phase: 'compile', done: units.length, total: units.length });

    t = performance.now();
    post({ type: 'progress', phase: 'link', done: 0, total: 1 });
    const linked = await clang.runLLVM([
        'wasm-ld', '-o', 'project.wasm', '-Bdynamic', '--strip-debug', '-shared',
        '--export=__wasm_call_ctors', '--unresolved-symbols=import-dynamic', '--no-export-dynamic', '--stack-first',
        ...Object.keys(objects),
    ], objects);
    lap('link', t);

    t = performance.now();
    const project = asyncify(wasmOpt, linked['project.wasm']);
    lap('asyncify', t);
    post({ type: 'done', project, timings }, [project.buffer]);
}

ctx.onmessage = async ({ data }: MessageEvent<BuildRequest>) => {
    if (data.cmd !== 'build') {
        return;
    }
    try {
        await build(data);
    } catch (error) {
        post({ type: 'error', message: describeError(error) });
    }
};

/** clang 的诊断信息在抛出的 Exit 错误里（stderr 内容经 console.log 输出），这里尽量提取可读文本 */
function describeError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
