/**
 * 预编译网页版示例工程（由 scripts/prebuild-web-examples.js 用 esbuild 打包后运行）。
 *
 * 对官方模板（GitHub 镜像，与「从 GitHub 打开」的下拉一致）和 src/web/examples/*.zip 中的
 * 每个 HoneyGUI 工程，按浏览器「完整仿真」的同一流程：
 *   CodeGenerator 生成代码 → 按 src/web/sim/buildCore 的规则编译每个单元 → 链接 → Asyncify
 * 产物写到 dist/web/sim/prebuilt/：
 *   o/<单元键>.o        目标文件：用户改了界面后，只有键变化的单元需要在浏览器里重编
 *   p/<工程键>.wasm     整个工程：未修改的工程直接加载，不下载编译器
 *   index.json          上面两类文件的键列表与工具链标识
 *
 * 头文件取自 prepare-web-sim.js 打好的 toolchain.pack，与浏览器编译时用的是同一份。
 * 键里含工具链标识，产物可以按键跨部署复用：--cache <目录>（CI 里由 actions/cache 保留）
 * 按同样的布局保存产物，本次没用到的会被删掉。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { runClang, runLLVM } from '@yowasp/clang';
import binaryen from 'binaryen';
import { CodeGenerator } from '../src/services/CodeGenerator';
import { ProjectUtils } from '../src/utils/ProjectUtils';
import {
    BinaryenModule, LINK_ARGS, PREBUILT_DIR, PREBUILT_INDEX, PrebuiltIndex, ToolchainInfo,
    asyncify, objectName, parseHeaderPack, planBuild, prebuiltObjectPath, prebuiltProjectPath, projectKey, simScreen, unitKeys,
} from '../src/web/sim/buildCore';
import { treeFromFlat, TreeNode } from '../src/web/sim/fileTree';
import { PrebuildProject, collectProjects } from './webPrebuildProjects';

type Runner = (args: string[], files: TreeNode, options?: Record<string, unknown>) => Promise<Record<string, Uint8Array>>;
const clang = runClang as unknown as Runner;
const llvm = runLLVM as unknown as Runner;

const repo = path.resolve(__dirname, '..');
const simDir = path.join(repo, 'dist', 'web', 'sim');
const outDir = path.join(simDir, PREBUILT_DIR);
const decoder = new TextDecoder();

function fail(message: string): never {
    console.error(`prebuild-web-examples: ${message}`);
    process.exit(1);
}

function argValue(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 单个工程预编译失败：示例要修，模板只告警（见 main） */
class ProjectError extends Error {}

/**
 * 按键取产物：先看缓存目录，没有再调用 make 生成，并写回缓存。
 * rel 是 prebuiltObjectPath / prebuiltProjectPath 返回的相对 sim/ 的路径，缓存目录用同样的布局。
 */
class ArtifactStore {
    readonly used = new Set<string>();
    built = 0;
    reused = 0;

    constructor(private readonly cacheDir: string | undefined) {}

    async get(rel: string, make: () => Promise<Uint8Array>): Promise<Uint8Array> {
        this.used.add(this.relInCache(rel));
        const target = path.join(simDir, rel);
        if (fs.existsSync(target)) {
            return new Uint8Array(fs.readFileSync(target));
        }
        let data: Uint8Array;
        const cached = this.cacheDir && this.cachePath(rel);
        if (cached && fs.existsSync(cached)) {
            data = new Uint8Array(fs.readFileSync(cached));
            this.reused++;
        } else {
            data = await make();
            this.built++;
            if (cached) {
                fs.mkdirSync(path.dirname(cached), { recursive: true });
                fs.writeFileSync(cached, data);
            }
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, data);
        return data;
    }

    /** 删掉缓存里本次没用到的文件（旧工具链、模板改动前的产物） */
    prune(): void {
        if (!this.cacheDir || !fs.existsSync(this.cacheDir)) {
            return;
        }
        for (const file of listFiles(this.cacheDir)) {
            if (!this.used.has(file)) {
                fs.rmSync(path.join(this.cacheDir, file), { force: true });
            }
        }
    }

    private relInCache(rel: string): string {
        return rel.slice(PREBUILT_DIR.length);
    }

    private cachePath(rel: string): string {
        return path.join(this.cacheDir!, this.relInCache(rel));
    }
}

/** 目录下全部文件的相对路径（用 `/` 分隔） */
function listFiles(dir: string, rel = ''): string[] {
    return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap(entry => {
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        return entry.isDirectory() ? listFiles(dir, relPath) : [relPath];
    });
}

function readTree(dir: string, filter: (rel: string) => boolean): Record<string, Uint8Array> {
    const out: Record<string, Uint8Array> = {};
    const walk = (current: string, rel: string) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const relPath = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                walk(path.join(current, entry.name), relPath);
            } else if (filter(relPath)) {
                out[relPath] = new Uint8Array(fs.readFileSync(path.join(current, entry.name)));
            }
        }
    };
    walk(dir, '');
    return out;
}

interface BuildContext {
    headers: Record<string, Uint8Array>;
    toolchain: ToolchainInfo;
    store: ArtifactStore;
    /** 工程所在的临时目录：生成代码里出现它说明含绝对路径 */
    work: string;
}

/** 预编译一个工程；成功时返回它的工程键与单元键，由调用方并入索引 */
async function prebuild(project: PrebuildProject, context: BuildContext): Promise<{ project: string; objects: string[] } | undefined> {
    const { label, root } = project;
    const { headers, toolchain, store, work } = context;
    const config = ProjectUtils.loadProjectConfig(root);
    if ((config.targetEngine || 'honeygui') !== 'honeygui') {
        console.log(`prebuild-web-examples: ${label}: not a HoneyGUI project, skipped`);
        return undefined;
    }
    const generated = await new CodeGenerator().generate(root);
    if (!generated.success) {
        throw new ProjectError(`${label}: code generation failed: ${generated.errors[0]?.error}`);
    }

    const sources = readTree(ProjectUtils.getSrcDir(root), rel => /\.(c|h)$/.test(rel));
    // 浏览器里工程根是 /workspace/<id>/<名称>，生成的代码若含绝对路径，键在浏览器里永远对不上
    for (const [rel, data] of Object.entries(sources)) {
        if (decoder.decode(data).includes(work)) {
            throw new ProjectError(`${label}: generated ${rel} contains the build path; prebuilt keys would never match in the browser`);
        }
    }
    const { width, height } = ProjectUtils.parseResolution(config.resolution);
    const screen = simScreen(width, height, ProjectUtils.getPixelBits(config.pixelMode), config.cornerRadius ?? 0);
    // 浏览器默认不编译 app_romfs.c（SimulationController.compileRomfs），这里也不编
    const plan = planBuild(sources, screen);
    const keys = await unitKeys(plan, toolchain.id);
    const key = await projectKey(plan, keys);
    let tree: TreeNode | undefined;

    const objects: Record<string, Uint8Array> = {};
    for (const [i, unit] of plan.units.entries()) {
        objects[objectName(unit)] = await store.get(prebuiltObjectPath(keys[i]), async () => {
            const started = Date.now();
            tree ??= treeFromFlat({ ...headers, ...plan.files });
            let stderr = '';
            const out = await clang(['clang', ...plan.flags, ...unit.extra, '-c', unit.path, '-o', 'out.o'], tree, {
                stderr: (bytes: Uint8Array | null) => { if (bytes) { stderr += decoder.decode(bytes); } },
            }).catch(error => { throw new ProjectError(`${label}: ${unit.name} failed to compile\n${stderr || String(error)}`); });
            const object = out['out.o'];
            if (!object || object.length === 0) {
                throw new ProjectError(`${label}: ${unit.name} produced no output`);
            }
            console.log(`prebuild-web-examples: ${label}: ${unit.name} ${Date.now() - started} ms`);
            return object;
        });
    }

    // 链接与 Asyncify 也按工程键缓存：工程键由全部单元键与链接参数得到
    const wasm = await store.get(prebuiltProjectPath(key), async () => {
        let stderr = '';
        const linked = await llvm([...LINK_ARGS, ...Object.keys(objects)], objects, {
            stderr: (bytes: Uint8Array | null) => { if (bytes) { stderr += decoder.decode(bytes); } },
        }).catch(error => { throw new ProjectError(`${label}: link failed\n${stderr || String(error)}`); });
        // 函数签名不一致在桌面链接器里只是警告，运行到那里时 WebAssembly 会直接报错
        if (/signature mismatch/i.test(stderr)) {
            throw new ProjectError(`${label}: link reported a function signature mismatch\n${stderr}`);
        }
        if (stderr.trim()) {
            console.warn(stderr.trim());
        }
        return asyncify(binaryen as unknown as BinaryenModule, linked['project.wasm']);
    });
    console.log(`prebuild-web-examples: ${label}: ${plan.units.length} units, project.wasm ${(wasm.length / 1024).toFixed(0)} KiB`);
    return { project: key, objects: keys };
}

async function main(): Promise<void> {
    const toolchainJson = path.join(simDir, 'toolchain.json');
    if (!fs.existsSync(toolchainJson)) {
        fail('dist/web/sim/toolchain.json not found; run "node scripts/prepare-web-sim.js" (without --preview-only) first');
    }
    const toolchain = JSON.parse(fs.readFileSync(toolchainJson, 'utf8')) as ToolchainInfo;
    if (!toolchain.id) {
        fail('toolchain.json has no id; rerun scripts/prepare-web-sim.js');
    }
    const headers = parseHeaderPack(new Uint8Array(zlib.inflateRawSync(fs.readFileSync(path.join(simDir, 'toolchain.pack')))));
    const store = new ArtifactStore(argValue('--cache'));

    fs.rmSync(outDir, { recursive: true, force: true });
    const index: PrebuiltIndex = { toolchain: toolchain.id, projects: [], objects: [] };
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'honeygui-prebuild-'));
    try {
        for (const project of collectProjects(work, 'prebuild-web-examples')) {
            try {
                const result = await prebuild(project, { headers, toolchain, store, work });
                if (result) {
                    index.projects.push(result.project);
                    index.objects.push(...result.objects);
                }
            } catch (error) {
                // 内置示例随站点发布，必须能编；官方模板在别的仓库，编不过只影响它自己（浏览器里现场编译）
                if (!(error instanceof ProjectError) || project.kind === 'example') {
                    throw error;
                }
                console.warn(`prebuild-web-examples: warning: ${error.message}`);
            }
        }
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
    store.prune();
    index.objects = [...new Set(index.objects)].sort();
    index.projects = [...new Set(index.projects)].sort();
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(simDir, PREBUILT_INDEX), JSON.stringify(index));
    console.log(`prebuild-web-examples: ${index.projects.length} projects, ${index.objects.length} objects (${store.built} built, ${store.reused} from cache)`);
}

main().catch(error => fail(error instanceof Error ? (error.stack || error.message) : String(error)));
