/**
 * 引擎宿主：加载预编译的引擎主模块，挂载运行时资源，驱动画布。
 *
 * 引擎（gui.js + gui.wasm）与 web_sim.js 来自 HoneyGUI 的 simulator/web，部署在 sim/engine/。
 * gui.js 是经典脚本（定义全局 createHoneyGUI），web_sim.js 提供 startHoneyGUI；
 * 这里按需用 <script> 加载它们，首屏不下载。
 *
 * 两种运行方式：
 * - 快速预览：不带工程模块，引擎的 HML 运行时解析 assets/ui/*.xml（web_sim_load_hml）；
 * - 完整仿真：动态加载编译好的 project.wasm。
 */
import type { SimScreen } from './protocol';

/** 运行时资源在引擎工作目录下的位置，与生成的入口文件 gui_vfs_mount_posix("/", "./assets") 一致 */
const ASSETS_DIR = 'assets';

interface EmscriptenFs {
    cwd(): string;
    mkdir(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
    unlink(path: string): void;
}

interface StartedSimulator {
    module: { FS: EmscriptenFs };
    width: number;
    height: number;
    reloadHml(): void;
    currentView(): string;
    stop(): void;
}

interface StartOptions {
    createModule: unknown;
    canvas: HTMLCanvasElement;
    files: Record<string, Uint8Array>;
    screen: SimScreen;
    project?: Uint8Array;
    hml?: { dir: string; startView?: string };
    print?: (text: string) => void;
    printErr?: (text: string) => void;
}

interface EngineGlobals {
    createHoneyGUI?: unknown;
    startHoneyGUI?: (options: StartOptions) => Promise<StartedSimulator>;
}

export interface EngineSession {
    stop(): void;
    /** 当前显示的视图名（快速预览重启后据此回到同一界面） */
    currentView(): string;
    /** 快速预览：写入/删除 assets 下的文件，并让引擎在下一帧按新文件重建当前视图 */
    updateHml(changed: Record<string, Uint8Array>, removed: string[]): void;
}

export interface EngineInputs {
    screen: SimScreen;
    assets: Record<string, Uint8Array>;
    /** 完整仿真的工程模块；为空时运行 assets/ui 下的 HML */
    project?: Uint8Array;
    /** 快速预览：启动后显示的视图（为空则显示入口视图） */
    startView?: string;
}

const loadedScripts = new Map<string, Promise<void>>();

function loadScript(url: string): Promise<void> {
    let loading = loadedScripts.get(url);
    if (!loading) {
        loading = new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = () => resolve();
            script.onerror = () => {
                loadedScripts.delete(url);
                reject(new Error(`Failed to load ${url}`));
            };
            document.head.appendChild(script);
        });
        loadedScripts.set(url, loading);
    }
    return loading;
}

function mkdirp(fs: EmscriptenFs, dir: string): void {
    let current = '';
    for (const part of dir.split('/').filter(Boolean)) {
        current += `/${part}`;
        try {
            fs.mkdir(current);
        } catch {
            // 目录已存在
        }
    }
}

export async function startEngine(
    engineBase: string,
    canvas: HTMLCanvasElement,
    inputs: EngineInputs,
    log: (text: string, isError?: boolean) => void
): Promise<EngineSession> {
    const base = new URL(engineBase, globalThis.location.href).href;
    await loadScript(new URL('gui.js', base).href);
    await loadScript(new URL('web_sim.js', base).href);

    const globals = globalThis as unknown as EngineGlobals;
    if (!globals.createHoneyGUI || !globals.startHoneyGUI) {
        throw new Error('The simulator engine did not initialise');
    }

    const files: Record<string, Uint8Array> = {};
    for (const [relPath, data] of Object.entries(inputs.assets)) {
        files[`${ASSETS_DIR}/${relPath}`] = data;
    }

    const sim = await globals.startHoneyGUI({
        createModule: globals.createHoneyGUI,
        canvas,
        files,
        screen: inputs.screen,
        project: inputs.project,
        hml: inputs.project ? undefined : { dir: ASSETS_DIR, startView: inputs.startView },
        print: text => log(text),
        printErr: text => log(text, true),
    });

    return {
        stop: () => sim.stop(),
        currentView: () => sim.currentView(),
        updateHml(changed, removed) {
            const fs = sim.module.FS;
            const root = `${fs.cwd()}/${ASSETS_DIR}`.replace(/\/+/g, '/');
            for (const [relPath, data] of Object.entries(changed)) {
                const full = `${root}/${relPath}`;
                mkdirp(fs, full.slice(0, full.lastIndexOf('/')));
                fs.writeFile(full, data);
            }
            for (const relPath of removed) {
                try {
                    fs.unlink(`${root}/${relPath}`);
                } catch {
                    // 已不存在
                }
            }
            sim.reloadHml();
        },
    };
}
