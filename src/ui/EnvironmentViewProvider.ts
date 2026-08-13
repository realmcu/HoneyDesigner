import * as vscode from 'vscode';
import { EnvironmentChecker, EnvironmentCheckResult } from '../simulation/EnvironmentChecker';

// 安装指引
const INSTALL_GUIDES: Record<string, { windows: string; linux: string; url?: string }> = {
    python: {
        windows: 'https://www.python.org/downloads/',
        linux: 'sudo apt-get install python3',
        url: 'https://www.python.org/downloads/'
    },
    scons: {
        windows: 'pip install scons',
        linux: 'pip install scons'
    },
    gcc: {
        windows: 'https://www.mingw-w64.org/',
        linux: 'sudo apt-get install build-essential',
        url: 'https://www.mingw-w64.org/'
    },
    sdl2: {
        windows: 'https://www.libsdl.org/',
        linux: 'sudo apt-get install libsdl2-dev',
        url: 'https://www.libsdl.org/'
    },
    ffmpeg: {
        windows: 'https://ffmpeg.org/download.html',
        linux: 'sudo apt-get install ffmpeg',
        url: 'https://ffmpeg.org/download.html'
    }
};

/**
 * 环境检查视图提供者
 */
export class EnvironmentViewProvider implements vscode.TreeDataProvider<EnvironmentItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<EnvironmentItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private checkResult: EnvironmentCheckResult | null = null;
    private checker = new EnvironmentChecker();

    constructor() {
        this.refresh();
    }

    refresh(): void {
        this.checker.checkAll().then(result => {
            this.checkResult = result;
            this._onDidChangeTreeData.fire();
        });
    }

    getTreeItem(element: EnvironmentItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: EnvironmentItem): Thenable<EnvironmentItem[]> {
        if (!this.checkResult) {
            return Promise.resolve([
                new EnvironmentItem(vscode.l10n.t('Checking...'), 'loading', false)
            ]);
        }

        const installed = vscode.l10n.t('Installed');
        const notInstalled = vscode.l10n.t('Not Installed');

        const items: EnvironmentItem[] = [
            new EnvironmentItem(
                `Python: ${this.checkResult.pythonInstalled ? '✓ ' + installed : '✗ ' + notInstalled}`,
                this.checkResult.pythonInstalled ? 'pass' : 'error',
                this.checkResult.pythonInstalled,
                this.checkResult.pythonVersion,
                'python'
            ),
            new EnvironmentItem(
                `SCons: ${this.checkResult.sconsInstalled ? '✓ ' + installed : '✗ ' + notInstalled}`,
                this.checkResult.sconsInstalled ? 'pass' : 'error',
                this.checkResult.sconsInstalled,
                this.checkResult.sconsVersion,
                'scons'
            ),
            new EnvironmentItem(
                `GCC: ${this.checkResult.compilerInstalled ? '✓ ' + installed : '✗ ' + notInstalled}`,
                this.checkResult.compilerInstalled ? 'pass' : 'error',
                this.checkResult.compilerInstalled,
                this.checkResult.compilerVersion,
                'gcc'
            )
        ];

        // 仅在 Linux/WSL 下显示 SDL
        if (this.checkResult.sdlInstalled !== undefined) {
            items.push(new EnvironmentItem(
                `SDL2: ${this.checkResult.sdlInstalled ? '✓ ' + installed : '✗ ' + notInstalled}`,
                this.checkResult.sdlInstalled ? 'pass' : 'error',
                this.checkResult.sdlInstalled,
                this.checkResult.sdlVersion,
                'sdl2'
            ));
        }

        items.push(new EnvironmentItem(
            `FFmpeg: ${this.checkResult.ffmpegInstalled ? '✓ ' + installed : '✗ ' + notInstalled}`,
            this.checkResult.ffmpegInstalled ? 'pass' : 'warning',
            this.checkResult.ffmpegInstalled,
            this.checkResult.ffmpegVersion,
            'ffmpeg'
        ));

        return Promise.resolve(items);
    }

    /**
     * 返回当前未安装、且存在安装命令映射的工具 id 列表。
     * 供「一键安装缺失项」命令使用。
     */
    getMissingInstallableToolIds(): string[] {
        const r = this.checkResult;
        if (!r) {
            return [];
        }
        const ids: string[] = [];
        if (!r.pythonInstalled) { ids.push('python'); }
        if (!r.sconsInstalled) { ids.push('scons'); }
        if (!r.compilerInstalled) { ids.push('gcc'); }
        if (r.sdlInstalled === false) { ids.push('sdl2'); }
        if (!r.ffmpegInstalled) { ids.push('ffmpeg'); }
        return ids;
    }

    /**
     * 显示安装指引
     */
    static showInstallGuide(toolId: string): void {
        const guide = INSTALL_GUIDES[toolId];
        if (!guide) return;

        const isWindows = process.platform === 'win32';
        const instruction = isWindows ? guide.windows : guide.linux;

        const copyCmd = vscode.l10n.t('Copy Command');
        const openPage = vscode.l10n.t('Open Download Page');
        const actions: string[] = [copyCmd];
        if (guide.url) {
            actions.push(openPage);
        }

        vscode.window.showInformationMessage(
            vscode.l10n.t('Install {0}: {1}', toolId.toUpperCase(), instruction),
            ...actions
        ).then(selection => {
            if (selection === copyCmd) {
                vscode.env.clipboard.writeText(instruction);
                vscode.window.showInformationMessage(vscode.l10n.t('Copied to clipboard'));
            } else if (selection === openPage && guide.url) {
                vscode.env.openExternal(vscode.Uri.parse(guide.url));
            }
        });
    }
}

class EnvironmentItem extends vscode.TreeItem {
    constructor(
        label: string,
        private status: 'pass' | 'error' | 'warning' | 'loading',
        installed: boolean,
        version?: string,
        public readonly toolId?: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);

        if (version) {
            this.description = version;
        }

        // 未安装时添加点击命令
        if (!installed && toolId) {
            this.command = {
                command: 'honeygui.environment.showGuide',
                title: vscode.l10n.t('Click to view installation instructions'),
                arguments: [toolId]
            };
            this.tooltip = vscode.l10n.t('Click to view installation instructions');
            // 标记为可安装，供右键菜单「安装此项」使用
            this.contextValue = 'installable';
        }

        switch (status) {
            case 'pass':
                this.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
                break;
            case 'error':
                this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
                break;
            case 'warning':
                this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
                break;
            case 'loading':
                this.iconPath = new vscode.ThemeIcon('loading~spin');
                break;
        }
    }
}
