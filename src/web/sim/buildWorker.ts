/**
 * 构建 Worker：用 WASM 版 clang / wasm-ld 把工程的 C 源码编译链接成 project.wasm
 *
 * 在 Worker 中运行，编译期间页面保持可操作。每个编译单元依次取：
 *   1. 内存缓存（Worker 存活期间有效，页面不关闭就一直复用）；
 *   2. 站点上 CI 预编译的目标文件（键相同即内容相同，见 buildCore.unitKeys）；
 *   3. 现场编译。
 * 只有第 3 步才需要编译器（压缩后约 29 MB），所以只改了界面的示例工程只重编界面文件，
 * 所有单元都有现成目标文件时不下载编译器。缓存键由页面算好随请求传入。
 */
/// <reference lib="webworker" />
import type { BuildRequest, WorkerMessage } from './protocol';
import { treeFromFlat, TreeNode } from './fileTree';
import { BinaryenModule, LINK_ARGS, asyncify, objectName, parseHeaderPack, planBuild, prebuiltObjectPath } from './buildCore';

interface YowaspModule {
    runClang(args: string[], files: TreeNode, options?: Record<string, unknown>): Promise<Record<string, Uint8Array>>;
    runLLVM(args: string[], files: TreeNode, options?: Record<string, unknown>): Promise<Record<string, Uint8Array>>;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: WorkerMessage, transfer: Transferable[] = []) => ctx.postMessage(message, transfer);

/** 目标文件缓存：键见 buildCore.unitKeys */
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

/** 头文件包格式见 scripts/prepare-web-sim.js 的 packHeaders：整体 deflate */
async function loadToolchain(base: string): Promise<Record<string, Uint8Array>> {
    if (toolchain && toolchain.base === base) {
        return toolchain.headers;
    }
    const compressed = await fetchBytes(new URL('toolchain.pack', base).href);
    const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const headers = parseHeaderPack(new Uint8Array(await new Response(stream).arrayBuffer()));
    toolchain = { base, headers };
    return headers;
}

/** 预编译目标文件；取不到（例如站点刚更新）时返回 undefined，改为现场编译 */
async function fetchPrebuilt(base: string, key: string): Promise<Uint8Array | undefined> {
    try {
        const object = await fetchBytes(new URL(prebuiltObjectPath(key), base).href);
        return object.length > 0 ? object : undefined;
    } catch {
        return undefined;
    }
}

async function build(request: BuildRequest): Promise<void> {
    const timings: Record<string, number> = {};
    const lap = (name: string, since: number) => { timings[name] = Math.round(performance.now() - since); };
    const base = request.toolchainBase;
    const plan = planBuild(request.sources, request.screen, request.romfs);
    if (request.keys.length !== plan.units.length) {
        throw new Error('Build request keys do not match the compile units');
    }
    const available = new Set(request.prebuilt);
    const objects: Record<string, Uint8Array> = {};
    let reused = 0;
    let downloaded = 0;

    // 1. 缓存与预编译产物
    let t = performance.now();
    const missing: number[] = [];
    await Promise.all(plan.units.map(async (unit, index) => {
        const key = request.keys[index];
        let object = objectCache.get(key);
        if (object) {
            reused++;
        } else if (available.has(key) && (object = await fetchPrebuilt(base, key))) {
            objectCache.set(key, object);
            downloaded++;
        } else {
            missing.push(index);
            return;
        }
        objects[objectName(unit)] = object;
    }));
    lap('prebuilt', t);

    // 2. 现场编译剩下的单元（这时才下载编译器与头文件）
    t = performance.now();
    post({ type: 'progress', phase: 'download', done: 0, total: 1 });
    const [clang, headers, wasmOpt] = await Promise.all([
        loadCompiler(base),
        missing.length > 0 ? loadToolchain(base) : Promise.resolve({}),
        loadBinaryen(base),
    ]);
    lap('load toolchain', t);

    t = performance.now();
    missing.sort((a, b) => a - b);
    const tree = missing.length > 0 ? treeFromFlat({ ...headers, ...plan.files }) : {};
    for (const [done, index] of missing.entries()) {
        const unit = plan.units[index];
        post({ type: 'progress', phase: unit.name === 'app_romfs.c' ? 'romfs' : 'compile', done, total: missing.length, file: unit.name });
        const out = await clang.runClang(['clang', ...plan.flags, ...unit.extra, '-c', unit.path, '-o', 'out.o'], tree);
        const object = out['out.o'];
        if (!object || object.length === 0) {
            throw new Error(`Compiler produced no output for ${unit.name}`);
        }
        objectCache.set(request.keys[index], object);
        objects[objectName(unit)] = object;
    }
    lap('compile', t);
    timings.compiled = missing.length;
    timings.reused = reused;
    timings.downloaded = downloaded;
    post({ type: 'progress', phase: 'compile', done: missing.length, total: missing.length });

    // 3. 链接（顺序与 CI 预编译一致：按单元顺序）
    t = performance.now();
    post({ type: 'progress', phase: 'link', done: 0, total: 1 });
    const ordered: Record<string, Uint8Array> = {};
    for (const unit of plan.units) {
        ordered[objectName(unit)] = objects[objectName(unit)];
    }
    const linked = await clang.runLLVM([...LINK_ARGS, ...Object.keys(ordered)], ordered);
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
