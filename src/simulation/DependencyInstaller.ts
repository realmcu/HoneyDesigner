import * as vscode from 'vscode';
import { getInstallCommands, needsRestart } from './dependencyCommands';

const TERMINAL_NAME = 'HoneyGUI 环境安装';

/**
 * 依赖安装器：把平台安装命令发送到 VS Code 集成终端执行。
 * 插件本身不发起网络请求；所有下载由终端命令完成（offline-first）。
 * 全部惰性触发——仅在用户点击安装命令时调用，无激活开销。
 */
export class DependencyInstaller {
    private static findOrCreateTerminal(): vscode.Terminal {
        const existing = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME);
        return existing ?? vscode.window.createTerminal(TERMINAL_NAME);
    }

    /**
     * 将给定工具的安装命令逐条发送到终端。无可用命令的工具会被跳过。
     */
    static installInTerminal(toolIds: string[]): void {
        const commands: string[] = [];
        for (const id of toolIds) {
            commands.push(...getInstallCommands(id, process.platform));
        }
        if (commands.length === 0) {
            return;
        }
        const terminal = this.findOrCreateTerminal();
        terminal.show();
        for (const cmd of commands) {
            terminal.sendText(cmd, true);
        }
    }

    static willNeedRestart(toolIds: string[]): boolean {
        return needsRestart(toolIds, process.platform);
    }
}
