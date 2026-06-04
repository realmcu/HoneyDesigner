import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { SimulationRunner, SimulationFlow } from './SimulationRunner';
import { ProjectUtils } from '../utils/ProjectUtils';
import { StatusBarManager } from '../ui/StatusBarManager';

/**
 * 编译仿真服务
 * 管理编译仿真的命令注册、状态管理和用户交互
 */
export class SimulationService {
    private static instance: SimulationService | null = null;
    private context: vscode.ExtensionContext;
    private runner: SimulationRunner | null = null;
    private outputChannel: vscode.OutputChannel;
    private isRunning: boolean = false;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        SimulationService.instance = this;

        // 创建输出通道
        this.outputChannel = vscode.window.createOutputChannel('HoneyGUI Simulation');
    }

    /**
     * 获取仿真运行状态
     */
    public static isSimulationRunning(): boolean {
        return SimulationService.instance?.isRunning || false;
    }

    /**
     * 注册命令
     */
    registerCommands(): void {
        // 启动编译仿真（可携带 flow 配置，缺省时三个阶段全部执行）
        this.context.subscriptions.push(
            vscode.commands.registerCommand('honeygui.simulation', async (options?: { flow?: SimulationFlow }) => {
                await this.startSimulation(options);
            })
        );

        // 调试仿真（跳过代码生成，仅转换资源并运行）
        this.context.subscriptions.push(
            vscode.commands.registerCommand('honeygui.simulation.debug', async () => {
                await this.startSimulation({ flow: { convert: true, codegen: false, simulate: true } });
            })
        );

        // 仅转换资源（独立流程，不生成代码、不编译运行）
        this.context.subscriptions.push(
            vscode.commands.registerCommand('honeygui.convertResource', async () => {
                await this.startSimulation({ flow: { convert: true, codegen: false, simulate: false } });
            })
        );

        // 停止编译仿真
        this.context.subscriptions.push(
            vscode.commands.registerCommand('honeygui.simulation.stop', async () => {
                await this.stopSimulation();
            })
        );

        // 清理编译产物
        this.context.subscriptions.push(
            vscode.commands.registerCommand('honeygui.simulation.clean', async () => {
                const choice = await vscode.window.showInformationMessage(
                    vscode.l10n.t('Select cleanup method'),
                    { modal: true },
                    vscode.l10n.t('Normal Clean'),
                    vscode.l10n.t('Deep Clean')
                );
                
                if (choice === vscode.l10n.t('Normal Clean')) {
                    await this.cleanSimulation(false);
                } else if (choice === vscode.l10n.t('Deep Clean')) {
                    await this.cleanSimulation(true);
                }
            })
        );
    }

    /**
     * 启动编译仿真
     */
    async startSimulation(options?: { flow?: SimulationFlow }): Promise<void> {
        // 解析流程配置（缺省全部启用）
        const flow = {
            convert: options?.flow?.convert ?? true,
            codegen: options?.flow?.codegen ?? true,
            simulate: options?.flow?.simulate ?? true,
        };
        // 不含仿真阶段时，流程结束即完成，不进入"运行中"状态
        const willSimulate = flow.simulate;

        try {
            // 获取项目根目录
            const projectRoot = await this.getProjectRoot();
            if (!projectRoot) {
                vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
                this.broadcastOperationComplete();
                return;
            }

            // 获取插件内置的 lib/sim 路径
            const extensionPath = this.context.extensionPath;
            const libSimPath = path.join(extensionPath, 'lib', 'sim');

            // 停止现有的仿真
            if (this.runner) {
                await this.stopSimulation();
            }

            // 创建新的运行器（使用内置库路径）
            this.runner = new SimulationRunner(projectRoot, libSimPath, this.outputChannel);
            this.setupRunnerListeners(willSimulate);

            // 启动流程
            await this.runner.start({ flow });

            // 不含仿真：转换/生成完成，释放 runner 并通知前端解除忙碌
            if (!willSimulate) {
                this.runner.dispose();
                this.runner = null;
                this.isRunning = false;
                vscode.window.showInformationMessage(vscode.l10n.t('Operation completed'));
                this.broadcastOperationComplete();
            }

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // 用户主动取消不显示错误
            if (message !== 'Simulation cancelled') {
                vscode.window.showErrorMessage(vscode.l10n.t('Compilation failed: {0}', message));
            }
            this.isRunning = false;
            this.notifyStatusChange(false);
            // 非仿真流程不会触发 simulationStatus 清理忙碌态，需显式通知
            if (!willSimulate) {
                this.broadcastOperationComplete();
            }
        }
    }

    /**
     * 停止编译仿真
     */
    async stopSimulation(): Promise<void> {
        if (this.runner) {
            await this.runner.stop();
            this.runner.dispose();
            this.runner = null;
            this.isRunning = false;
            this.notifyStatusChange(false); // 通知状态变化
            vscode.window.showInformationMessage(vscode.l10n.t('Simulation stopped'));
        }
    }

    /**
     * 清理编译产物
     * @param deep 是否深度清理
     */
    async cleanSimulation(deep: boolean = false): Promise<void> {
        // 查找项目根目录
        let projectRoot: string | undefined;

        // 优先使用当前打开的 HML 文件所在项目
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && activeEditor.document.fileName.endsWith('.hml')) {
            projectRoot = ProjectUtils.findProjectRoot(activeEditor.document.fileName);
        }

        // 如果没有，尝试从工作区查找
        if (!projectRoot) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const workspaceRoot = workspaceFolders[0].uri.fsPath;
                
                // 先检查工作区根目录
                if (fs.existsSync(path.join(workspaceRoot, 'project.json'))) {
                    projectRoot = workspaceRoot;
                } else {
                    // 向上查找
                    projectRoot = ProjectUtils.findProjectRoot(workspaceRoot);
                    
                    // 如果向上没找到，尝试向下查找
                    if (!projectRoot) {
                        projectRoot = ProjectUtils.findProjectRootRecursive(workspaceRoot);
                    }
                }
            }
        }

        if (!projectRoot) {
            vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
            return;
        }

        this.outputChannel.show(true);
        const runner = new SimulationRunner(projectRoot, '', this.outputChannel);
        runner.setListener({
            onLog: (message: string) => {
                this.outputChannel.appendLine(message);
            }
        });
        await runner.clean(deep);
        vscode.window.showInformationMessage(deep ? vscode.l10n.t('Deep clean completed') : vscode.l10n.t('Clean completed'));
    }

    /**
     * 获取项目根目录
     */
    private async getProjectRoot(): Promise<string | undefined> {
        // 1. 优先使用当前编辑器所在项目
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const filePath = activeEditor.document.fileName;
            this.outputChannel.appendLine(`[Debug] Active editor file: ${filePath}`);
            const projectRoot = ProjectUtils.findProjectRoot(filePath);
            if (projectRoot) {
                this.outputChannel.appendLine(`[Debug] Found project root from active editor: ${projectRoot}`);
                return projectRoot;
            }
        } else {
            this.outputChannel.appendLine('[Debug] No active editor');
        }

        // 2. 尝试从工作区查找
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage(vscode.l10n.t('No workspace opened'));
            return undefined;
        }

        this.outputChannel.appendLine(`[Debug] Workspace folders count: ${workspaceFolders.length}`);

        // 单个工作区，检查是否是项目根目录或查找项目根目录
        if (workspaceFolders.length === 1) {
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            this.outputChannel.appendLine(`[Debug] Workspace root: ${workspaceRoot}`);
            
            // 先检查工作区根目录本身是否包含 project.json
            const projectJsonPath = path.join(workspaceRoot, 'project.json');
            this.outputChannel.appendLine(`[Debug] Checking: ${projectJsonPath}`);
            
            if (fs.existsSync(projectJsonPath)) {
                this.outputChannel.appendLine(`[Debug] Found project.json in workspace root`);
                return workspaceRoot;
            }
            
            // 如果不是，尝试向上查找
            this.outputChannel.appendLine(`[Debug] project.json not found in workspace root, searching upward...`);
            const foundRootUpward = ProjectUtils.findProjectRoot(workspaceRoot);
            if (foundRootUpward) {
                this.outputChannel.appendLine(`[Debug] Found project root upward: ${foundRootUpward}`);
                return foundRootUpward;
            }

            // 如果向上没找到，尝试递归向下查找
            this.outputChannel.appendLine(`[Debug] Not found upward, searching downward in workspace...`);
            const foundRootDownward = ProjectUtils.findProjectRootRecursive(workspaceRoot);
            if (foundRootDownward) {
                this.outputChannel.appendLine(`[Debug] Found project root downward: ${foundRootDownward}`);
                return foundRootDownward;
            }

            this.outputChannel.appendLine(`[Debug] No project root found`);
            return undefined;
        }

        // 多个工作区，让用户选择
        const items = workspaceFolders.map(folder => {
            const workspaceRoot = folder.uri.fsPath;
            const projectJsonPath = path.join(workspaceRoot, 'project.json');
            const hasProject = fs.existsSync(projectJsonPath);
            return {
                label: folder.name,
                description: folder.uri.fsPath,
                detail: hasProject ? vscode.l10n.t('Contains project.json') : undefined,
                folder
            };
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: vscode.l10n.t('Select project to compile')
        });

        if (!selected) {
            return undefined;
        }

        const workspaceRoot = selected.folder.uri.fsPath;
        const projectJsonPath = path.join(workspaceRoot, 'project.json');
        if (fs.existsSync(projectJsonPath)) {
            return workspaceRoot;
        }
        return ProjectUtils.findProjectRoot(workspaceRoot);
    }

    /**
     * 设置运行器监听器
     */
    private setupRunnerListeners(willSimulate: boolean): void {
        if (!this.runner) {
            return;
        }

        this.runner.setListener({
            onStart: () => {
                this.outputChannel.clear();
                this.outputChannel.show(true);
                // 仅当流程包含仿真阶段时才进入"运行中"状态；
                // 纯转换/生成流程不应让 UI 显示为仿真运行
                if (willSimulate) {
                    this.isRunning = true; // 启动中，立即禁用按钮防止重复点击
                    this.notifyStatusChange(true);
                }
            },
            
            onSuccess: () => {
                this.isRunning = true; // 运行中
                this.notifyStatusChange(true);
            },
            
            onError: (error) => {
                this.outputChannel.appendLine(`[Error] ${error.message}`);
                this.isRunning = false; // 错误，显示为未运行
                this.notifyStatusChange(false);
            },
            
            onExit: (code) => {
                // 清理 runner 引用
                if (this.runner) {
                    this.runner.dispose();
                    this.runner = null;
                }
                
                // 更新状态（必须在清理 runner 之后）
                this.isRunning = false;
                this.notifyStatusChange(false); // 已停止，刷新 UI
                
                // 显示停止提示
                vscode.window.showInformationMessage(vscode.l10n.t('Simulation stopped'));
                
                if (code !== null && code !== 0) {
                    vscode.window.showWarningMessage(vscode.l10n.t('Simulation exited abnormally, exit code: {0}', code));
                }
            },
            
            onLog: (message) => {
                this.outputChannel.appendLine(message);
            }
        });
    }

    /**
     * 通知所有界面更新仿真状态
     */
    private notifyStatusChange(isRunning: boolean): void {
        this.isRunning = isRunning;

        // 更新状态栏显示
        const statusBarManager = StatusBarManager.getInstance();
        if (statusBarManager) {
            statusBarManager.updateSimulationStatus(isRunning);
        }

        // 通知所有打开的设计器 Webview
        vscode.commands.executeCommand('_honeygui.broadcastToWebviews', {
            command: 'simulationStatus',
            isRunning: isRunning
        });

        // 通知 QUICK 面板刷新
        vscode.commands.executeCommand('_honeygui.updateQuickPanel');
    }

    /**
     * 通知所有 Webview 当前操作已完成（用于非仿真流程解除工具栏忙碌态）
     */
    private broadcastOperationComplete(): void {
        vscode.commands.executeCommand('_honeygui.broadcastToWebviews', {
            command: 'operationComplete',
            operation: 'simulation-flow'
        });
    }

    /**
     * 清理资源
     */
    dispose(): void {
        this.stopSimulation();
        this.outputChannel.dispose();
    }
}
