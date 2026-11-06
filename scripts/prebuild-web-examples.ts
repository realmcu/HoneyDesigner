/**
 * 预编译网页版示例工程（由 scripts/prebuild-web-examples.js 用 esbuild 打包后运行）。
 *
 * 对 src/web/examples/*.zip 中的每个工程，按浏览器「完整仿真」的同一流程：
 *   解压 → CodeGenerator 生成代码 → 按 src/web/sim/buildCore 的规则编译每个单元 → 链接 → Asyncify
 * 产物写到 dist/web/sim/prebuilt/：
 *   o/<单元键>.o        目标文件：用户改了界面后，只有键变化的单元需要在浏览器里重编
 *   p/<工程键>.wasm     整个工程：未修改的示例直接加载，不下载编译器
 *   index.json          上面两类文件的键列表与工具链标识
 *
 * 头文件取自 prepare-web-sim.js 打好的 toolchain.pack，与浏览器编译时用的是同一份。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { unzipSync } from 'fflate';
import { runClang, runLLVM } from '@yowasp/clang';
import binaryen from 'binaryen';
import { CodeGenerator } from '../src/services/CodeGenerator';
import { ProjectUtils } from '../src/utils/ProjectUtils';
import {
    BinaryenModule, LINK_ARGS, PREBUILT_DIR, PREBUILT_INDEX, PrebuiltIndex, ToolchainInfo,
    asyncify, objectName, parseHeaderPack, planBuild, prebuiltObjectPath, prebuiltProjectPath, projectKey, simScreen, unitKeys,
} from '../src/web/sim/buildCore';
import { treeFromFlat, TreeNode } from '../src/web/sim/fileTree';

type Runner = (args: string[], files: TreeNode, options?: Record<string, unknown>) => Promise<Record<string, Uint8Array>>;
const clang = runClang as unknown as Runner;
const llvm = runLLVM as unknown as Runner;

const repo = path.resolve(__dirname, '..');
const simDir = path.join(repo, 'dist', 'web', 'sim');
const examplesDir = path.join(repo, 'src', 'web', 'examples');
const outDir = path.join(simDir, PREBUILT_DIR);
const decoder = new TextDecoder();

function fail(message: string): never {
    console.error(`prebuild-web-examples: ${message}`);
    process.exit(1);
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

/** 与 src/web/host/projectZip.ts 相同：project.json 所在目录是工程根 */
function unzipProject(zip: string, dest: string): string {
    const entries = unzipSync(new Uint8Array(fs.readFileSync(zip)));
    const projectJson = Object.keys(entries)
        .filter(p => !p.startsWith('__MACOSX/') && path.posix.basename(p) === 'project.json')
        .sort((a, b) => a.split('/').length - b.split('/').length)[0];
    if (!projectJson) {
        fail(`project.json not found in ${zip}`);
    }
    const prefix = path.posix.dirname(projectJson) === '.' ? '' : `${path.posix.dirname(projectJson)}/`;
    const name = prefix ? path.posix.basename(prefix) : path.basename(zip, '.zip');
    const root = path.join(dest, name);
    for (const [entry, data] of Object.entries(entries)) {
        if (!entry.startsWith(prefix) || entry.endsWith('/') || entry.startsWith('__MACOSX/')) {
            continue;
        }
        const file = path.join(root, entry.slice(prefix.length));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, data);
    }
    return root;
}

async function prebuild(zip: string, headers: Record<string, Uint8Array>, toolchain: ToolchainInfo, index: PrebuiltIndex): Promise<void> {
    const label = path.basename(zip, '.zip');
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'honeygui-prebuild-'));
    try {
        const root = unzipProject(zip, work);
        const config = ProjectUtils.loadProjectConfig(root);
        if ((config.targetEngine || 'honeygui') !== 'honeygui') {
            console.log(`prebuild-web-examples: ${label}: not a HoneyGUI project, skipped`);
            return;
        }
        const generated = await new CodeGenerator().generate(root);
        if (!generated.success) {
            fail(`${label}: code generation failed: ${generated.errors[0]?.error}`);
        }

        const sources = readTree(ProjectUtils.getSrcDir(root), rel => /\.(c|h)$/.test(rel));
        // 浏览器里工程根是 /workspace/<id>/<名称>，生成的代码若含绝对路径，键在浏览器里永远对不上
        for (const [rel, data] of Object.entries(sources)) {
            if (decoder.decode(data).includes(work)) {
                fail(`${label}: generated ${rel} contains the build path; prebuilt keys would never match in the browser`);
            }
        }
        const { width, height } = ProjectUtils.parseResolution(config.resolution);
        const screen = simScreen(width, height, ProjectUtils.getPixelBits(config.pixelMode), config.cornerRadius ?? 0);
        // 浏览器默认不编译 app_romfs.c（SimulationController.compileRomfs），这里也不编
        const plan = planBuild(sources, screen);
        const keys = await unitKeys(plan, toolchain.id);
        const tree = treeFromFlat({ ...headers, ...plan.files });

        const objects: Record<string, Uint8Array> = {};
        for (const [i, unit] of plan.units.entries()) {
            const started = Date.now();
            let stderr = '';
            const out = await clang(['clang', ...plan.flags, ...unit.extra, '-c', unit.path, '-o', 'out.o'], tree, {
                stderr: (bytes: Uint8Array | null) => { if (bytes) { stderr += decoder.decode(bytes); } },
            }).catch(error => fail(`${label}: ${unit.name} failed to compile\n${stderr || String(error)}`));
            const object = out['out.o'];
            if (!object || object.length === 0) {
                fail(`${label}: ${unit.name} produced no output`);
            }
            objects[objectName(unit)] = object;
            fs.mkdirSync(path.dirname(path.join(simDir, prebuiltObjectPath(keys[i]))), { recursive: true });
            fs.writeFileSync(path.join(simDir, prebuiltObjectPath(keys[i])), object);
            index.objects.push(keys[i]);
            console.log(`prebuild-web-examples: ${label}: ${unit.name} ${Date.now() - started} ms`);
        }

        let stderr = '';
        const linked = await llvm([...LINK_ARGS, ...Object.keys(objects)], objects, {
            stderr: (bytes: Uint8Array | null) => { if (bytes) { stderr += decoder.decode(bytes); } },
        }).catch(error => fail(`${label}: link failed\n${stderr || String(error)}`));
        // 函数签名不一致在桌面链接器里只是警告，运行到那里时 WebAssembly 会直接报错
        if (/signature mismatch/i.test(stderr)) {
            fail(`${label}: link reported a function signature mismatch\n${stderr}`);
        }
        if (stderr.trim()) {
            console.warn(stderr.trim());
        }
        const project = asyncify(binaryen as unknown as BinaryenModule, linked['project.wasm']);
        const key = await projectKey(plan, keys);
        fs.mkdirSync(path.dirname(path.join(simDir, prebuiltProjectPath(key))), { recursive: true });
        fs.writeFileSync(path.join(simDir, prebuiltProjectPath(key)), project);
        index.projects.push(key);
        console.log(`prebuild-web-examples: ${label}: ${plan.units.length} units, project.wasm ${(project.length / 1024).toFixed(0)} KiB`);
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
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

    fs.rmSync(outDir, { recursive: true, force: true });
    const index: PrebuiltIndex = { toolchain: toolchain.id, projects: [], objects: [] };
    const zips = fs.readdirSync(examplesDir).filter(name => name.endsWith('.zip')).sort();
    for (const zip of zips) {
        await prebuild(path.join(examplesDir, zip), headers, toolchain, index);
    }
    index.objects = [...new Set(index.objects)].sort();
    index.projects = [...new Set(index.projects)].sort();
    fs.writeFileSync(path.join(simDir, PREBUILT_INDEX), JSON.stringify(index));
    console.log(`prebuild-web-examples: ${index.projects.length} projects, ${index.objects.length} objects`);
}

main().catch(error => fail(error instanceof Error ? (error.stack || error.message) : String(error)));
