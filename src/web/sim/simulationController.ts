/**
 * 仿真控制器：响应工具栏「仿真 / 停止」，驱动 准备 → 引擎 的完整流程并更新仿真窗口。
 * 命令由 browserHost 注册；这里不依赖 React，窗口只通过 simulationUi 观察状态。
 *
 * 快速预览运行时会跟随工程变化：ui/ 下的 HML 保存后只重写界面文件，引擎在下一帧重建
 * 当前视图；资源或 i18n 文本变化需要重新转换，此时在后台重新准备并重启引擎，停在原视图。
 */
import * as path from 'path';
import * as fs from '../shims/fs';
import { SimulationService, SimulationOptions, SimulationMode, SimulationInputs } from './simulationService';
import { startEngine, EngineSession, SimKey } from './engineHost';
import { simulationUi } from './simulationUi';
import { getWorkspaceFolder } from '../host/webEnvironment';
import { FontRequirements, fontRequirementsCovered } from '../../simulation/HmlPreviewPrep';

/** sim/ 目录相对站点根的位置；与 scripts/prepare-web-sim.js 的输出一致 */
const SIM_BASE = './sim/';
/** 保存后稍等再刷新，合并连续保存与代码生成写入的一串文件变化 */
const REFRESH_DELAY_MS = 300;
/**
 * 一个引擎实例热更新的界面文件总量上限。hml_reload() 为仍在使用旧节点的隐藏视图保留被替换
 * 的文档，不释放；10 MB 的引擎堆在重载约 80 次 86 KB 的文件后耗尽。超过上限就重启引擎。
 */
const RELOAD_BUDGET_BYTES = 3 * 1024 * 1024;

export interface SimulationFlow {
    convert: boolean;
    codegen: boolean;
    simulate: boolean;
}

/** 刷新范围：只改了界面文件，或需要重新转换资源 */
type RefreshKind = 'hml' | 'assets';

export class SimulationController {
    private readonly service: SimulationService;
    private session: EngineSession | undefined;
    private canvas: HTMLCanvasElement | null = null;
    private canvasWaiters: Array<() => void> = [];
    private generation = 0;
    private mode: SimulationMode = 'preview';
    /** 当前运行的工程；快速预览还记录交给引擎的界面文件（计算差异）和已转换字体覆盖的内容 */
    private running: {
        root: string;
        mode: SimulationMode;
        hml: Record<string, Uint8Array>;
        fonts: FontRequirements;
        /** 本引擎实例已热更新的界面文件字节数（见 RELOAD_BUDGET_BYTES） */
        reloadedBytes: number;
    } | undefined;
    private unwatch: (() => void) | undefined;
    private pendingRefresh: RefreshKind | undefined;
    private refreshTimer: ReturnType<typeof setTimeout> | undefined;
    private refreshing: Promise<void> = Promise.resolve();
    private notifyState: ((running: boolean) => void) | undefined;

    /** 完整仿真是否编译 app_romfs.c：生成的入口文件仿真时挂载 ./assets，不读它，默认跳过 */
    private compileRomfs = false;

    constructor(createWorker: () => Worker) {
        this.service = new SimulationService(createWorker);
    }

    get isRunning(): boolean {
        return this.session !== undefined;
    }

    /** SimulationWindow 的 canvas 引用（挂载/卸载时调用） */
    setCanvas(canvas: HTMLCanvasElement | null): void {
        this.canvas = canvas;
        if (canvas) {
            this.canvasWaiters.splice(0).forEach(resolve => resolve());
        }
    }

    setCompileRomfs(enabled: boolean): void {
        this.compileRomfs = enabled;
    }

    setMode(mode: SimulationMode): void {
        this.mode = mode;
    }

    /** 仿真窗口底部的硬件按键；引擎未运行时忽略 */
    pressKey(key: SimKey): void {
        this.session?.pressKey(key);
    }

    async start(flow: SimulationFlow, notifyState: (running: boolean) => void): Promise<void> {
        this.stop(notifyState);
        const generation = ++this.generation;
        const projectRoot = getWorkspaceFolder();
        if (!projectRoot) {
            throw new Error('No project is open');
        }
        const mode = this.mode;

        simulationUi.begin(mode);
        try {
            const inputs = await this.service.prepare(this.options(projectRoot, mode, flow, generation));
            if (generation !== this.generation) {
                return;
            }
            if (!flow.simulate) {
                simulationUi.reset();
                return;
            }
            this.log(`Prepared in ${JSON.stringify(inputs.timings)}`);
            await this.run(projectRoot, mode, inputs, generation, notifyState);
        } catch (error) {
            if (generation === this.generation) {
                simulationUi.fail(error instanceof Error ? error.message : String(error));
                this.log(error instanceof Error ? (error.stack || error.message) : String(error), true);
            }
            throw error;
        }
    }

    stop(notifyState?: (running: boolean) => void): void {
        this.generation++;
        this.service.cancel();
        this.stopWatching();
        if (this.session) {
            this.session.stop();
            this.session = undefined;
            notifyState?.(false);
        }
        this.running = undefined;
        this.notifyState = undefined;
        simulationUi.reset();
    }

    private options(projectRoot: string, mode: SimulationMode, flow: Pick<SimulationFlow, 'convert' | 'codegen'>, generation: number): SimulationOptions {
        return {
            projectRoot,
            mode,
            simBase: SIM_BASE,
            flow: { convert: flow.convert, codegen: flow.codegen },
            compileRomfs: this.compileRomfs,
            onProgress: progress => { if (generation === this.generation) { simulationUi.progress(progress); } },
            onLog: (text, isError) => this.log(text, isError),
        };
    }

    private log(text: string, isError?: boolean): void {
        simulationUi.appendLog(isError ? `[error] ${text}` : text);
    }

    private async run(projectRoot: string, mode: SimulationMode, inputs: SimulationInputs, generation: number, notifyState: (running: boolean) => void, startView?: string): Promise<void> {
        simulationUi.progress({ stage: 'start' });
        const canvas = await this.waitForCanvas();
        const session = await startEngine(SIM_BASE + 'engine/', canvas, { ...inputs, startView }, (text, isError) => this.log(text, isError));
        if (generation !== this.generation) {
            session.stop();
            return;
        }
        this.session = session;
        this.notifyState = notifyState;
        this.running = { root: projectRoot, mode, hml: pickHml(inputs.assets), fonts: inputs.fonts ?? new Map(), reloadedBytes: 0 };
        simulationUi.running(inputs.screen.width, inputs.screen.height, mode, inputs.gaps);
        notifyState(true);
        if (mode === 'preview') {
            this.watch(projectRoot);
        }
    }

    // -----------------------------------------------------------------------
    // 快速预览：跟随工程变化
    // -----------------------------------------------------------------------

    private watch(projectRoot: string): void {
        this.stopWatching();
        this.unwatch = fs.vfs.onChange(change => {
            const rel = path.posix.relative(projectRoot, change.path);
            if (!rel || rel.startsWith('..') || change.isDirectory) {
                return;
            }
            const kind = refreshKindOf(rel);
            if (kind) {
                this.scheduleRefresh(kind);
            }
        });
    }

    private stopWatching(): void {
        this.unwatch?.();
        this.unwatch = undefined;
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = undefined;
        }
        this.pendingRefresh = undefined;
    }

    private scheduleRefresh(kind: RefreshKind): void {
        this.pendingRefresh = this.pendingRefresh === 'assets' ? 'assets' : kind;
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined;
            const pending = this.pendingRefresh;
            this.pendingRefresh = undefined;
            if (pending) {
                // 串行执行：上一次刷新（可能在转换资源）结束后再开始下一次
                this.refreshing = this.refreshing.then(() => this.refresh(pending)).catch(error => {
                    this.log(`Preview refresh failed: ${error instanceof Error ? error.message : String(error)}`, true);
                });
            }
        }, REFRESH_DELAY_MS);
    }

    private async refresh(kind: RefreshKind): Promise<void> {
        const running = this.running;
        const session = this.session;
        if (!running || !session || running.mode !== 'preview') {
            return;
        }
        if (kind === 'hml') {
            const hml = this.service.readHml(running.root);
            const { changed, removed } = diffFiles(running.hml, hml);
            if (Object.keys(changed).length === 0 && removed.length === 0) {
                return;
            }
            // 删除的文件：hml_reload() 只重读现有文件，已注册的视图不会撤销，重启引擎。
            // 新引用的图片、新的字体或字符还没有转换，也只能整体重新准备
            if (removed.length > 0
                || !this.referencedImagesExist(running.root, changed)
                || !fontRequirementsCovered(running.fonts, this.service.fontRequirements(running.root))) {
                return this.restart(running.root);
            }
            const bytes = Object.values(changed).reduce((sum, data) => sum + data.length, 0);
            if (running.reloadedBytes + bytes > RELOAD_BUDGET_BYTES) {
                return this.restart(running.root);
            }
            running.reloadedBytes += bytes;
            running.hml = hml;
            session.updateHml(changed, removed);
            simulationUi.setGaps(this.service.collectGaps(hml));
            this.log(`Preview updated: ${[...Object.keys(changed), ...removed].join(', ')}`);
            return;
        }
        return this.restart(running.root);
    }

    /** 重新准备资源（转换结果有缓存，只转换变化的部分）后重启引擎，停在原来的视图上 */
    private async restart(projectRoot: string): Promise<void> {
        const generation = this.generation;
        const notifyState = this.notifyState;
        const view = this.session?.currentView();
        this.log('Restarting preview...');
        const inputs = await this.service.prepare(this.options(projectRoot, 'preview', { convert: true, codegen: false }, generation));
        if (generation !== this.generation || !this.session || !notifyState) {
            return;
        }
        this.session.stop();
        this.session = undefined;
        await this.run(projectRoot, 'preview', inputs, generation, notifyState, view);
    }

    /**
     * 变化的界面文件引用的图片在 build/assets 中是否都已转换（新加入设计的图片需要先转换）。
     * 路径规则与 HML 运行时的 hml_resolve_asset_path 一致。
     */
    private referencedImagesExist(projectRoot: string, changed: Record<string, Uint8Array>): boolean {
        const assetsDir = path.posix.join(projectRoot, 'build', 'assets');
        const decoder = new TextDecoder();
        for (const data of Object.values(changed)) {
            for (const asset of referencedImages(decoder.decode(data))) {
                if (!fs.existsSync(path.posix.join(assetsDir, asset))) {
                    return false;
                }
            }
        }
        return true;
    }

    private waitForCanvas(): Promise<HTMLCanvasElement> {
        if (this.canvas) {
            return Promise.resolve(this.canvas);
        }
        return new Promise(resolve => {
            this.canvasWaiters.push(() => resolve(this.canvas!));
        });
    }
}

/** 工程内文件变化对快速预览的影响；与预览无关的变化（src/、build/ 等）返回 undefined */
function refreshKindOf(rel: string): RefreshKind | undefined {
    const top = rel.split('/')[0];
    if (top === 'ui') {
        return rel.endsWith('.hml') ? 'hml' : undefined;
    }
    if (top === 'assets' || top === 'i18n' || rel === 'project.json') {
        return 'assets';
    }
    return undefined;
}

function pickHml(assets: Record<string, Uint8Array>): Record<string, Uint8Array> {
    const out: Record<string, Uint8Array> = {};
    for (const [rel, data] of Object.entries(assets)) {
        if (rel.startsWith('ui/') && rel.endsWith('.xml')) {
            out[rel] = data;
        }
    }
    return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

function diffFiles(before: Record<string, Uint8Array>, after: Record<string, Uint8Array>): { changed: Record<string, Uint8Array>; removed: string[] } {
    const changed: Record<string, Uint8Array> = {};
    for (const [rel, data] of Object.entries(after)) {
        if (!before[rel] || !sameBytes(before[rel], data)) {
            changed[rel] = data;
        }
    }
    const removed = Object.keys(before).filter(rel => !(rel in after));
    return { changed, removed };
}

/** 界面文件引用的已转换图片（相对 build/assets）：src / imageOn / imageOff 的位图 → .bin */
function referencedImages(xml: string): string[] {
    const images = new Set<string>();
    for (const match of xml.matchAll(/\s(?:src|imageOn|imageOff)\s*=\s*"([^"]+)"/g)) {
        const rel = match[1].replace(/^assets\//, '').replace(/^\/+/, '');
        if (/\.(png|jpe?g|bmp|tiff?|webp)$/i.test(rel)) {
            images.add(rel.replace(/\.[^./]+$/, '.bin'));
        }
    }
    return [...images];
}
