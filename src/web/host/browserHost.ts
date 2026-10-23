/**
 * 浏览器宿主：在页面内创建与 VS Code 扩展相同的 DesignerPanel
 *
 * DesignerPanel / FileManager / MessageHandler / AssetManager 等宿主模块原样复用，
 * 它们依赖的 vscode、fs、child_process 在 webpack.web.config.js 中被替换为 src/web/shims。
 */
import * as path from 'path';
import * as vscode from '../shims/vscode';
import * as fs from '../shims/fs';
import { DesignerPanel } from '../../designer/DesignerPanel';
import { BrowserWebviewPanel } from './browserWebviewPanel';
import { setWorkspaceFolder } from './webEnvironment';
import { SimulationController, SimulationFlow } from '../sim/simulationController';
import type { SimulationMode } from '../sim/simulationService';

/** 需要本机工具链（SCons / Python / 串口）的命令，浏览器版给出说明而不是静默失败 */
const DESKTOP_ONLY_COMMANDS = [
    'honeygui.simulation.clean',
    'honeygui.simulation.debug',
    'honeygui.uartDownload',
    'honeygui.uartDownload.quick',
    'honeygui.convertResource',
];

/**
 * 仿真由页面级控制器驱动（构建 Worker + 引擎 + 浮动窗口），在 src/web/index.tsx 创建后注入。
 * 命令只在这里注册一次，当前活动面板用来回发工具栏状态。
 */
let simulation: SimulationController | undefined;
/** 工具栏最近一次勾选的仿真阶段；在仿真窗口切换方式时沿用 */
let lastFlow: SimulationFlow = { convert: true, codegen: true, simulate: true };

/** 仿真方式（快速预览 / 完整仿真）在浏览器中记住，下次打开页面沿用 */
const SIMULATION_MODE_STORAGE_KEY = 'honeygui.web.simulationMode';

function savedSimulationMode(): SimulationMode {
    return globalThis.localStorage?.getItem(SIMULATION_MODE_STORAGE_KEY) === 'full' ? 'full' : 'preview';
}

export function setSimulationController(controller: SimulationController): void {
    simulation = controller;
    controller.setMode(savedSimulationMode());
}

/** 仿真窗口切换仿真方式：记住选择，并按新方式重新开始仿真 */
export function restartSimulation(mode: SimulationMode): void {
    globalThis.localStorage?.setItem(SIMULATION_MODE_STORAGE_KEY, mode);
    simulation?.setMode(mode);
    void vscode.commands.executeCommand('honeygui.simulation', { flow: lastFlow });
}

/** 仿真窗口的关闭按钮：与工具栏「停止」走同一条命令，工具栏才会复位 */
export function stopSimulation(): void {
    void vscode.commands.executeCommand('honeygui.simulation.stop');
}

let commandsRegistered = false;
/** 当前打开的面板；桌面专属命令结束后需向它回发 operationComplete 以复位工具栏忙碌态 */
let activePanel: BrowserWebviewPanel | undefined;

function registerBrowserCommands(): void {
    if (commandsRegistered) {
        return;
    }
    commandsRegistered = true;
    for (const id of DESKTOP_ONLY_COMMANDS) {
        vscode.commands.registerCommand(id, async () => {
            try {
                await vscode.window.showInformationMessage(
                    vscode.l10n.t('This feature requires the local toolchain. Export the project as ZIP and open it in VS Code with the HoneyGUI extension.'),
                    { modal: true }
                );
            } finally {
                // VS Code 中由 SimulationService 回发；浏览器版没有它，这里代为复位
                void activePanel?.webview.postMessage({ command: 'operationComplete', operation: id });
            }
        });
    }
    // 编译仿真：命令参数里带着工具栏勾选的阶段（见 Toolbar.handleSimulation）
    vscode.commands.registerCommand('honeygui.simulation', async (args?: { flow?: { convert?: boolean; codegen?: boolean; simulate?: boolean } }) => {
        const notify = (running: boolean) => {
            void activePanel?.webview.postMessage({ command: 'simulationStatus', isRunning: running });
        };
        try {
            if (!simulation) {
                throw new Error('Simulation is not available');
            }
            lastFlow = {
                convert: args?.flow?.convert ?? true,
                codegen: args?.flow?.codegen ?? true,
                simulate: args?.flow?.simulate ?? true,
            };
            await simulation.start(lastFlow, notify);
        } catch (error) {
            // 错误已显示在仿真窗口里，这里只复位工具栏忙碌态
            console.error('[simulation]', error);
        } finally {
            void activePanel?.webview.postMessage({ command: 'operationComplete', operation: 'honeygui.simulation' });
        }
    });
    vscode.commands.registerCommand('honeygui.simulation.stop', async () => {
        simulation?.stop();
        // 准备阶段被中止时也要复位工具栏：此时引擎还没启动，stop() 不会回调
        void activePanel?.webview.postMessage({ command: 'simulationStatus', isRunning: false });
        void activePanel?.webview.postMessage({ command: 'operationComplete', operation: 'honeygui.simulation.stop' });
    });

    // 资源面板「在系统文件管理器中打开」
    vscode.commands.registerCommand('revealFileInOS', async () => {
        await vscode.window.showInformationMessage(
            vscode.l10n.t('Opening folders in the system file manager is not available in the browser.')
        );
    });
}

/** 最小 ExtensionContext：DesignerPanel 只用到 extensionUri 与 globalState/workspaceState */
function createExtensionContext(): unknown {
    const memento = () => {
        const values = new Map<string, unknown>();
        return {
            get: <T>(key: string, defaultValue?: T) => (values.has(key) ? values.get(key) : defaultValue) as T,
            update: async (key: string, value: unknown) => { values.set(key, value); },
            keys: () => [...values.keys()],
        };
    };
    return {
        extensionUri: vscode.Uri.file('/extension'),
        extensionPath: '/extension',
        subscriptions: [] as vscode.Disposable[],
        globalState: memento(),
        workspaceState: memento(),
    };
}

export interface OpenedDesigner {
    panel: BrowserWebviewPanel;
    designer: DesignerPanel;
    projectRoot: string;
    hmlPath: string;
    dispose(): void;
}

/** 查找工程主 HML：project.json 的 mainHmlFile，否则 ui/ 下第一个 .hml */
export function findMainHml(projectRoot: string): string | undefined {
    try {
        const config = JSON.parse(fs.readFileSync(path.posix.join(projectRoot, 'project.json'), 'utf8') as string);
        if (typeof config.mainHmlFile === 'string') {
            const candidate = path.posix.join(projectRoot, config.mainHmlFile);
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
    } catch {
        // project.json 缺失或损坏时退回扫描
    }
    const uiDir = path.posix.join(projectRoot, 'ui');
    if (!fs.existsSync(uiDir)) {
        return undefined;
    }
    const hmlFiles = (fs.readdirSync(uiDir, { recursive: true }) as string[])
        .filter(name => name.endsWith('.hml'))
        .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
    return hmlFiles.length > 0 ? path.posix.join(uiDir, hmlFiles[0]) : undefined;
}

/**
 * 为工程创建设计器宿主。与 HmlEditorProvider.resolveCustomTextEditor 的顺序一致：
 * 先解析文档（不推送），等设计器发来 ready 后由 MessageHandler 推送 loadHml。
 */
export async function openDesigner(projectRoot: string, hmlPath: string, stateKey: string): Promise<OpenedDesigner> {
    registerBrowserCommands();
    setWorkspaceFolder(projectRoot);

    const panel = new BrowserWebviewPanel(stateKey);
    activePanel = panel;
    const designer =new DesignerPanel(panel as unknown as import('vscode').WebviewPanel, createExtensionContext() as import('vscode').ExtensionContext);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(hmlPath));
    await designer.loadFromDocument(document as unknown as import('vscode').TextDocument);

    const onFocus = () => panel.notifyViewStateChanged();
    globalThis.addEventListener('focus', onFocus);

    return {
        panel,
        designer,
        projectRoot,
        hmlPath,
        dispose() {
            globalThis.removeEventListener('focus', onFocus);
            if (activePanel === panel) {
                activePanel = undefined;
            }
            designer.dispose();
            setWorkspaceFolder(undefined);
        },
    };
}
