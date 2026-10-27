import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BuildCore, Logger } from './BuildCore';
import { ProjectUtils } from '../utils/ProjectUtils';

/**
 * VSCode 日志适配器
 */
class VSCodeLogger implements Logger {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    log(message: string, isError: boolean = false, isWarning: boolean = false): void {
        let prefix = '[Info]';
        if (isWarning) {
            prefix = '[Warning]';
        } else if (isError) {
            prefix = '[Error]';
        }
        this.outputChannel.appendLine(`${prefix} ${message}`);
    }
}

/**
 * 编译管理器（VSCode 版本）
 */
export class BuildManager extends BuildCore {
    private outputChannel: vscode.OutputChannel;
    private ownsOutputChannel: boolean;

    constructor(projectRoot: string, outputChannel?: vscode.OutputChannel) {
        const channel = outputChannel || vscode.window.createOutputChannel('HoneyGUI Simulation');
        const projectConfig = ProjectUtils.loadProjectConfig(projectRoot);
        const libSimPath = ProjectUtils.getLibSimPath();
        super(projectRoot, libSimPath, projectConfig, new VSCodeLogger(channel));
        this.outputChannel = channel;
        this.ownsOutputChannel = !outputChannel; // 只有自己创建的才负责关闭
    }

    async compile(): Promise<void> {
        this.outputChannel.show(true);
        await super.compile();
    }

    async updateGitignore(): Promise<void> {
        const gitignorePath = path.join(this.projectRoot, '.gitignore');
        const entry = '.honeygui-build/';

        let content = '';
        if (fs.existsSync(gitignorePath)) {
            content = fs.readFileSync(gitignorePath, 'utf-8');
        }

        if (!content.includes(entry)) {
            content += `\n# HoneyGUI build & simulation directory\n${entry}\n`;
            fs.writeFileSync(gitignorePath, content, 'utf-8');
        }
    }

    dispose(): void {
        // 只关闭自己创建的 OutputChannel
        if (this.ownsOutputChannel) {
            this.outputChannel.dispose();
        }
    }
}
