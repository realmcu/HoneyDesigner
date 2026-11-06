/**
 * 浏览器仿真的编译规则：构建 Worker 与 CI 预编译脚本（scripts/prebuild-web-examples.js）共用。
 *
 * 两边按同一份规则决定编译单元、编译参数和缓存键，CI 预先编好的目标文件与 project.wasm
 * 才能在浏览器里按键命中：未修改的示例直接加载 project.wasm，不下载编译器；
 * 修改后只重编键变化的单元，其余目标文件取预编译产物。
 */
import type { SimScreen } from './protocol';
import { contentKey } from './hash';

export interface CompileUnit {
    /** 相对 src/ 的路径；app_romfs.c 为文件名本身 */
    name: string;
    /** 编译器虚拟文件系统中的路径 */
    path: string;
    data: Uint8Array;
    /** 追加的编译参数 */
    extra: string[];
}

export interface BuildPlan {
    /** 编译器虚拟文件系统中的工程文件（不含工具链头文件）：路径 → 内容 */
    files: Record<string, Uint8Array>;
    units: CompileUnit[];
    flags: string[];
}

/** wasm-ld 参数（目标文件名追加在后面） */
export const LINK_ARGS = [
    'wasm-ld', '-o', 'project.wasm', '-Bdynamic', '--strip-debug', '-shared',
    '--export=__wasm_call_ctors', '--unresolved-symbols=import-dynamic', '--no-export-dynamic', '--stack-first',
];

/** 预编译产物在 sim/ 下的目录与索引 */
export const PREBUILT_DIR = 'prebuilt/';
export const PREBUILT_INDEX = 'prebuilt/index.json';

/** 预编译索引（CI 生成）：按键列出可直接下载的 project.wasm 与目标文件 */
export interface PrebuiltIndex {
    /** 生成时的 ToolchainInfo.id；与站点当前工具链不同则整个索引作废 */
    toolchain: string;
    /** 有预编译 project.wasm 的工程键，文件在 sim/prebuilt/p/<键>.wasm */
    projects: string[];
    /** 有预编译目标文件的单元键，文件在 sim/prebuilt/o/<键>.o */
    objects: string[];
}

export function prebuiltObjectPath(key: string): string {
    return `${PREBUILT_DIR}o/${key}.o`;
}

export function prebuiltProjectPath(key: string): string {
    return `${PREBUILT_DIR}p/${key}.wasm`;
}

/** 工具链说明（scripts/prepare-web-sim.js 生成）；id 随编译器、binaryen 与头文件变化 */
export interface ToolchainInfo {
    id: string;
    files: number;
    bytes: number;
}

/** project.json 的屏幕参数 → 编译宏。cornerRadius 为 -1 时是圆形屏幕 */
export function simScreen(width: number, height: number, pixelBits: number, cornerRadius: number): SimScreen {
    return {
        width,
        height,
        pixelBits,
        cornerRadius: cornerRadius < 0 ? Math.floor(Math.min(width, height) / 2) : cornerRadius,
    };
}

/** 编译参数；目录名对应头文件包里的 engine/ sysroot/ clangres/ */
export function compileFlags(screen: SimScreen, sourceDirs: string[]): string[] {
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

/**
 * 编译计划：工程 src/ 下的每个 .c 是一个单元，另加可选的 app_romfs.c。
 * 单元按路径排序，CI 与浏览器读目录的顺序不同也不影响链接顺序。
 */
export function planBuild(sources: Record<string, Uint8Array>, screen: SimScreen, romfs?: Uint8Array): BuildPlan {
    const names = Object.keys(sources).sort();
    const files: Record<string, Uint8Array> = {};
    for (const name of names) {
        files[`src/${name}`] = sources[name];
    }
    const sourceDirs = [...new Set(names.map(name => {
        const dir = name.split('/').slice(0, -1).join('/');
        return dir ? `src/${dir}` : 'src';
    }))];
    const units: CompileUnit[] = names.filter(name => name.endsWith('.c')).map(name => ({
        name, path: `src/${name}`, data: sources[name], extra: [],
    }));
    if (romfs) {
        files['app_romfs.c'] = romfs;
        units.push({ name: 'app_romfs.c', path: 'app_romfs.c', data: romfs, extra: ['-O1'] });
    }
    return { files, units, flags: compileFlags(screen, sourceDirs) };
}

export function objectName(unit: CompileUnit): string {
    return `${unit.name.replace(/\//g, '_')}.o`;
}

const INCLUDE = /^[ \t]*#[ \t]*include[ \t]*(?:"([^"]+)"|<([^>]+)>|(\S))/gm;
const decoder = new TextDecoder();

/**
 * 单元依赖的工程头文件（递归）。引擎与系统头文件不在其中，由工具链标识覆盖。
 * 按 clang 的查找顺序在包含者所在目录和 -I 目录里找；找不到的视为引擎/系统头文件。
 * 遇到宏形式的 #include 无法静态判断，返回全部工程头文件。
 */
function headerDeps(unit: CompileUnit, plan: BuildPlan): string[] {
    const includeDirs = plan.flags.flatMap((flag, i) => flag === '-I' && plan.flags[i + 1].startsWith('src') ? [plan.flags[i + 1]] : []);
    const projectHeaders = Object.keys(plan.files).filter(file => file.endsWith('.h'));
    const found = new Set<string>();
    const pending = [unit.path];
    while (pending.length > 0) {
        const file = pending.pop()!;
        const text = decoder.decode(plan.files[file]);
        const dir = file.split('/').slice(0, -1).join('/');
        for (const match of text.matchAll(INCLUDE)) {
            if (match[3]) {
                return projectHeaders;
            }
            const name = match[1] ?? match[2];
            const candidates = [...(match[1] && dir ? [dir] : []), ...includeDirs].map(base => normalize(`${base}/${name}`));
            const target = candidates.find(candidate => candidate in plan.files);
            if (target && !found.has(target)) {
                found.add(target);
                pending.push(target);
            }
        }
    }
    return [...found].sort();
}

function normalize(path: string): string {
    const out: string[] = [];
    for (const part of path.split('/')) {
        if (part === '..') {
            out.pop();
        } else if (part && part !== '.') {
            out.push(part);
        }
    }
    return out.join('/');
}

/**
 * 每个单元的缓存键：工具链标识 + 编译参数 + 源文件 + 它包含的工程头文件。
 * 工具链标识（toolchain.json 的 id）随编译器版本和引擎/系统头文件变化。
 */
export async function unitKeys(plan: BuildPlan, toolchainId: string): Promise<string[]> {
    const flags = plan.flags.join(' ');
    return Promise.all(plan.units.map(unit => {
        const parts: Array<Uint8Array | string> = [toolchainId, '\0', flags, ' ', unit.extra.join(' '), '\0', unit.path, '\0', unit.data];
        for (const header of headerDeps(unit, plan)) {
            parts.push('\0', header, '\0', plan.files[header]);
        }
        return contentKey(parts);
    }));
}

/** 整个工程的键：所有单元键 + 链接参数；与预编译索引里的工程键比较 */
export function projectKey(plan: BuildPlan, keys: string[]): Promise<string> {
    return contentKey([LINK_ARGS.join(' '), '\0', ...plan.units.map((unit, i) => `${objectName(unit)}=${keys[i]}\n`)]);
}

/** binaryen.js 中用到的部分 */
export interface BinaryenModule {
    readBinary(data: Uint8Array): {
        runPasses(passes: string[]): void;
        optimize(): void;
        emitBinary(): Uint8Array;
        dispose(): void;
    };
    setOptimizeLevel(level: number): void;
    setPassArgument(key: string, value: string | null): void;
}

/**
 * 引擎每帧在 gui_thread_mdelay() 里经 Asyncify 让出执行权，并用 Asyncify 切换协作线程。
 * 让出时调用栈上的每一层都必须能保存和恢复，而 clang 编出的 project.wasm 没有这层处理：
 * 工程代码调到会让出的函数（例如在 gui_thread_create 建的线程里 gui_thread_mdelay），
 * 恢复时就会报 unreachable。这里对链接产物补做与 emcc -sASYNCIFY 侧模块相同的变换。
 */
export function asyncify(lib: BinaryenModule, wasm: Uint8Array): Uint8Array {
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

/**
 * 解析解压后的头文件包（格式见 scripts/prepare-web-sim.js 的 packHeaders）：
 * [4 字节文件数] 然后每个文件 [2 字节路径长度][路径][4 字节内容长度][内容]
 */
export function parseHeaderPack(raw: Uint8Array): Record<string, Uint8Array> {
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
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
