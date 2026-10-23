/**
 * 浏览器版「仿真」流程，对应桌面版 SimulationRunner 的几个阶段。两种模式：
 *
 * 快速预览（默认）
 *   1. 资源转换     BuildCore.convertAssets（图片/字体等，转换结果在会话内缓存）
 *   2. 运行         预编译引擎的 HML 运行时直接解析 ui/*.xml，不编译工程
 *   工程的 C 代码（回调、自定义定时器）不会执行，缺失内容由 PreviewGapCollector 列出。
 *
 * 完整仿真
 *   1. 生成代码     CodeGenerator（与桌面版同一份代码，写入内存文件系统）
 *   2. 资源转换     同上，另外生成 app_romfs.c（可选）
 *   3. 编译链接     构建 Worker 里的 WASM 版 clang / wasm-ld，产出 project.wasm
 *   4. 运行         预编译引擎动态加载 project.wasm
 *
 * 页面线程只做代码生成与资源转换（纯 JS），编译在 Worker 里，运行由引擎自己的循环驱动。
 */
import * as path from 'path';
import * as fs from '../shims/fs';
import * as vscode from '../shims/vscode';
import { CodeGenerator } from '../../services/CodeGenerator';
import { BuildCore } from '../../simulation/BuildCore';
import { ConversionCache } from '../../simulation/ConversionCache';
import { FontRequirements, PreviewGap, PreviewGapCollector, fontRequirementsOf, localizeHml } from '../../simulation/HmlPreviewPrep';
import { loadProjectI18nCatalog } from '../../project-i18n/files';
import { ProjectUtils } from '../../utils/ProjectUtils';
import { BuildClient } from './buildClient';
import type { SimScreen, BuildPhase } from './protocol';

export type SimulationMode = 'preview' | 'full';

export interface SimulationProgress {
    stage: 'codegen' | 'assets' | 'toolchain' | 'compile' | 'romfs' | 'link' | 'start';
    /** 0..1，未知时为 undefined */
    fraction?: number;
    detail?: string;
}

/** 引擎运行所需的全部输入 */
export interface SimulationInputs {
    screen: SimScreen;
    /** 运行时资源：相对 build/assets 的路径 → 内容；快速预览时其中 ui/ 下是界面 XML */
    assets: Record<string, Uint8Array>;
    /** 完整仿真：编译好的工程；快速预览为空 */
    project?: Uint8Array;
    /** 快速预览：运行时未实现、因而看不到的内容 */
    gaps: PreviewGap[];
    /** 快速预览：本次转换出的字体覆盖的内容（热更新据此判断是否要重新转换字体） */
    fonts?: FontRequirements;
    timings: Record<string, number>;
}

export interface SimulationOptions {
    projectRoot: string;
    mode: SimulationMode;
    /** 部署时 sim/ 目录的基址（例如 "./sim/"） */
    simBase: string;
    /** 与桌面版相同的阶段开关；默认全部执行（快速预览不生成代码，codegen 被忽略） */
    flow?: { convert: boolean; codegen: boolean };
    /** 完整仿真是否把 app_romfs.c 编进去。生成的入口文件在仿真时挂载的是 ./assets，不读它 */
    compileRomfs: boolean;
    onProgress?(progress: SimulationProgress): void;
    onLog?(text: string, isError?: boolean): void;
}

const PHASE_TO_STAGE: Record<BuildPhase, SimulationProgress['stage']> = {
    download: 'toolchain', compile: 'compile', romfs: 'romfs', link: 'link',
};

/** 把目录读成扁平映射（相对路径 → 内容） */
function readTree(dir: string, filter: (rel: string) => boolean = () => true): Record<string, Uint8Array> {
    const out: Record<string, Uint8Array> = {};
    const walk = (current: string, rel: string): void => {
        for (const name of fs.readdirSync(current) as string[]) {
            const full = path.posix.join(current, name);
            const relPath = rel ? `${rel}/${name}` : name;
            if (fs.statSync(full)!.isDirectory()) {
                walk(full, relPath);
            } else if (filter(relPath)) {
                out[relPath] = new Uint8Array(fs.readFileSync(full) as Uint8Array);
            }
        }
    };
    if (fs.existsSync(dir)) {
        walk(dir, '');
    }
    return out;
}

export class SimulationService {
    private readonly client: BuildClient;
    /** 图片与字体的转换结果，在同一工程的多次仿真之间复用 */
    private readonly conversionCache = new ConversionCache();
    private cacheRoot: string | undefined;

    constructor(createWorker: () => Worker) {
        this.client = new BuildClient(createWorker);
    }

    cancel(): void {
        this.client.cancel();
    }

    async prepare(options: SimulationOptions): Promise<SimulationInputs> {
        const { projectRoot, onProgress, onLog } = options;
        const timings: Record<string, number> = {};
        const lap = (name: string, since: number) => { timings[name] = Math.round(performance.now() - since); };

        const config = ProjectUtils.loadProjectConfig(projectRoot);
        if ((config.targetEngine || 'honeygui') !== 'honeygui') {
            throw new Error(vscode.l10n.t('Browser simulation currently supports the HoneyGUI engine only. Use VS Code to simulate LVGL projects.'));
        }
        const screen = this.screenOf(config);
        const flow = options.flow ?? { convert: true, codegen: true };
        const full = options.mode === 'full';

        // 1. 生成代码（只有完整仿真需要）
        let t = performance.now();
        if (full && flow.codegen) {
            onProgress?.({ stage: 'codegen' });
            const generated = await new CodeGenerator().generate(projectRoot);
            if (!generated.success) {
                throw new Error(generated.errors[0]?.error || 'Code generation failed');
            }
            onLog?.(`Code generated: ${generated.totalFiles} files`);
            lap('codegen', t);
        }

        // 2. 资源转换（浏览器里 BuildCore 跳过 SCons 脚手架、视频，并用 TS 生成 romfs C）
        const core = new BuildCore(projectRoot, '/extension/lib/sim', config, {
            log: (message: string, isError?: boolean) => onLog?.(message, isError),
        });
        if (this.cacheRoot !== projectRoot) {
            this.conversionCache.clear();
            this.cacheRoot = projectRoot;
        }
        core.setConversionCache(this.conversionCache);
        await core.setupBuildDir();
        const buildDir = core.getBuildDir();
        const assetsDir = path.posix.join(buildDir, 'assets');
        t = performance.now();
        // 字体按转换时的 HML 生成；在转换前取，转换期间的保存会在下一次刷新中发现
        const fonts = full ? undefined : this.fontRequirements(projectRoot);
        // 快速预览的界面文件来自转换，没有转换结果时也必须转换一次
        if (flow.convert || !fs.existsSync(path.posix.join(assetsDir, 'ui'))) {
            onProgress?.({ stage: 'assets' });
            await core.convertAssets({
                packRomfs: full && options.compileRomfs,
                // 图片转换在页面线程上进行：逐张转换并让出，页面保持可操作、进度条可见
                onImageConverted: async (done, total) => {
                    onProgress?.({ stage: 'assets', fraction: done / total, detail: `${done}/${total}` });
                    await new Promise(resolve => setTimeout(resolve, 0));
                },
            });
            lap('assets', t);
        } else {
            onLog?.('Skipping resource conversion');
        }

        // 3. 运行时资源：生成的入口文件 gui_vfs_mount_posix("/", "./assets") 读的就是 build/assets
        if (!full) {
            // 界面文件直接取自 ui/*.hml：跳过转换时 build/assets/ui 可能是旧的，也可能留有已删除的文件
            const hml = this.readHml(projectRoot);
            const assets = { ...readTree(assetsDir, rel => !rel.startsWith('ui/')), ...hml };
            return { screen, assets, gaps: this.collectGaps(hml), fonts, timings };
        }
        const assets = readTree(assetsDir);

        // 4. 编译链接（Worker）。只部署了引擎的站点（prepare-web-sim.js --preview-only）没有编译器
        const toolchainBase = new URL(options.simBase, globalThis.location.href).href;
        const probe = await fetch(new URL('toolchain.json', toolchainBase), { cache: 'no-store' }).catch(() => undefined);
        if (!probe?.ok) {
            throw new Error(vscode.l10n.t('Full simulation is not available on this site: the compiler is not deployed. Use Quick Preview, or simulate in VS Code.'));
        }
        const sources = readTree(ProjectUtils.getSrcDir(projectRoot), rel => /\.(c|h)$/.test(rel));
        const romfsPath = path.posix.join(buildDir, 'app_romfs.c');
        const romfs = options.compileRomfs && fs.existsSync(romfsPath)
            ? new Uint8Array(fs.readFileSync(romfsPath) as Uint8Array)
            : undefined;
        const result = await this.client.build(
            { toolchainBase, sources, romfs, screen },
            {
                onProgress: message => onProgress?.({
                    stage: PHASE_TO_STAGE[message.phase],
                    fraction: message.total > 0 ? message.done / message.total : undefined,
                    detail: message.file,
                }),
            }
        );
        return { screen, assets, project: result.project, gaps: [], timings: { ...timings, ...result.timings } };
    }

    /**
     * 只刷新界面文件（保存 HML 后的热更新）：重新读取 ui/*.hml 并做与 prepare 相同的处理。
     * 返回相对 build/assets 的路径 → 内容；新引用的图片或字体需要完整走一遍 prepare。
     */
    readHml(projectRoot: string): Record<string, Uint8Array> {
        const files: Record<string, Uint8Array> = {};
        for (const [rel, data] of Object.entries(this.readProjectHml(projectRoot))) {
            files[`ui/${rel.replace(/\.hml$/, '.xml')}`] = data;
        }
        return this.prepareHml(projectRoot, files);
    }

    /** 工程 HML 当前需要的字体内容（与资源转换读取同一份文件，转换前取一次即为转换结果的范围） */
    fontRequirements(projectRoot: string): FontRequirements {
        const decoder = new TextDecoder();
        return fontRequirementsOf(Object.values(this.readProjectHml(projectRoot)).map(data => decoder.decode(data)));
    }

    private readProjectHml(projectRoot: string): Record<string, Uint8Array> {
        return readTree(ProjectUtils.getUiDir(projectRoot), name => name.endsWith('.hml'));
    }

    collectGaps(files: Record<string, Uint8Array>): PreviewGap[] {
        const collector = new PreviewGapCollector();
        const decoder = new TextDecoder();
        for (const [rel, data] of Object.entries(files)) {
            if (rel.startsWith('ui/') && rel.endsWith('.xml')) {
                collector.scan(decoder.decode(data));
            }
        }
        return collector.list();
    }

    /**
     * 界面文件交给运行时之前的处理：
     * - 带 i18nKey 的标签换成当前语言的文本（运行时不读 i18n/strings.json）；
     * - ui/ 子目录里的文件挪到 ui/ 下（运行时只扫描 ui/ 这一层，代码生成则递归扫描），
     *   视图按 id 注册，与文件名无关。
     */
    private prepareHml(projectRoot: string, files: Record<string, Uint8Array>): Record<string, Uint8Array> {
        const catalog = loadProjectI18nCatalog(projectRoot);
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        const out: Record<string, Uint8Array> = {};
        for (const [rel, data] of Object.entries(files)) {
            if (!rel.startsWith('ui/') || !rel.endsWith('.xml')) {
                out[rel] = data;
                continue;
            }
            const text = decoder.decode(data);
            const localized = localizeHml(text, catalog);
            out[`ui/${rel.slice(3).split('/').join('__')}`] = localized === text ? data : encoder.encode(localized);
        }
        return out;
    }

    private screenOf(config: ReturnType<typeof ProjectUtils.loadProjectConfig>): SimScreen {
        const { width, height } = ProjectUtils.parseResolution(config.resolution);
        // cornerRadius: -1 为圆形屏幕，>0 为圆角半径
        const radius = config.cornerRadius ?? 0;
        return {
            width,
            height,
            pixelBits: ProjectUtils.getPixelBits(config.pixelMode),
            cornerRadius: radius < 0 ? Math.floor(Math.min(width, height) / 2) : radius,
        };
    }
}
