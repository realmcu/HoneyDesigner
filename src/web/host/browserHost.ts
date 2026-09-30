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

/** 需要本机工具链（SCons / Python / 串口）的命令，浏览器版给出说明而不是静默失败 */
const DESKTOP_ONLY_COMMANDS = [
    'honeygui.simulation',
    'honeygui.simulation.clean',
    'honeygui.simulation.stop',
    'honeygui.simulation.debug',
    'honeygui.uartDownload',
    'honeygui.uartDownload.quick',
    'honeygui.convertResource',
];

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
