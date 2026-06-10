import * as vscode from 'vscode';

export class StatusBarManager {
    private static instance: StatusBarManager | null = null;
    private simulationStatusBarItem: vscode.StatusBarItem;

    private constructor(context: vscode.ExtensionContext) {
        // 创建仿真状态栏项（优先级 100，显示在右侧）
        this.simulationStatusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );

        // 设置初始状态
        this.updateSimulationStatus(false);

        // 显示状态栏项
        this.simulationStatusBarItem.show();

        // 注册到 context 以便自动清理
        context.subscriptions.push(this.simulationStatusBarItem);
    }

    public static getInstance(context?: vscode.ExtensionContext): StatusBarManager {
        if (!StatusBarManager.instance) {
            if (!context) {
                throw new Error('StatusBarManager requires context on first initialization');
            }
            StatusBarManager.instance = new StatusBarManager(context);
        }
        return StatusBarManager.instance;
    }

    /**
     * 更新仿真状态显示
     * @param isRunning 是否正在运行
     */
    public updateSimulationStatus(isRunning: boolean): void {
        if (isRunning) {
            // 运行中：显示停止按钮
            this.simulationStatusBarItem.text = `$(debug-stop) ${vscode.l10n.t('Stop Simulation')}`;
            this.simulationStatusBarItem.tooltip = vscode.l10n.t('Click to stop simulation (Ctrl+Shift+F5)');
            this.simulationStatusBarItem.command = 'honeygui.simulation.stop';
            this.simulationStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            // 未运行：显示启动按钮
            this.simulationStatusBarItem.text = `$(rocket) ${vscode.l10n.t('Simulate')}`;
            this.simulationStatusBarItem.tooltip = vscode.l10n.t('Click to compile and simulate');
            this.simulationStatusBarItem.command = 'honeygui.simulation';
            this.simulationStatusBarItem.backgroundColor = undefined;
        }
    }

    /**
     * 清理资源
     */
    public dispose(): void {
        this.simulationStatusBarItem.dispose();
    }
}
