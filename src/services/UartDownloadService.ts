import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, exec } from 'child_process';
import { ProjectUtils } from '../utils/ProjectUtils';
import { DEFAULT_ROMFS_BASE_ADDR } from '../common/ProjectConfig';
import { RomfsConfig } from '../common/RomfsConfig';

export interface UartConfig {
    port: string;
    baudRate: number;
    chipType?: string;      // 芯片类型: RTL87X3E, RTL87X3EP, RTL87X3D, RTL87X3G
    flashAddress?: string;  // Flash 地址，默认使用 romfsBaseAddr
}

const SUPPORTED_CHIPS = ['RTL87X3E', 'RTL87X3EP', 'RTL87X3D', 'RTL87X3G'];

/**
 * UART 下载服务
 * 使用 mpcli 工具下载 romfs.bin 到开发板
 */
export class UartDownloadService {
    private outputChannel: vscode.OutputChannel;
    private isDownloading = false;
    private mpcliPath: string;

    constructor(private context: vscode.ExtensionContext) {
        // mpcli 工具路径（相对于扩展目录）
        this.mpcliPath = path.join(context.extensionPath, 'tools', 'mpcli_meta_tool_py_v4.0.0.4');

        // 移除状态栏按钮，功能移至设计器工具栏
        // this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        // this.statusBarItem.text = `$(cloud-download) ${vscode.l10n.t('UART Download')}`;
        // this.statusBarItem.command = 'honeygui.uartDownload';
        // this.statusBarItem.tooltip = vscode.l10n.t('UART download romfs.bin to board');
        // this.statusBarItem.show();

        this.outputChannel = vscode.window.createOutputChannel('HoneyGUI UART');
    }

    registerCommands(): void {
        this.context.subscriptions.push(
            vscode.commands.registerCommand('honeygui.uartDownload', () => this.showDownloadDialog()),
            vscode.commands.registerCommand('honeygui.uartDownload.quick', () => this.quickDownload()),
            vscode.commands.registerCommand('honeygui.scanSerialPorts', async () => this.scanPorts())
        );
    }

    /**
     * 扫描可用串口
     */
    async scanPorts(): Promise<string[]> {
        return new Promise((resolve) => {
            if (process.platform === 'win32') {
                // Windows: 使用注册表查询（最可靠）
                exec('powershell -Command "Get-ItemProperty -Path HKLM:\\HARDWARE\\DEVICEMAP\\SERIALCOMM -ErrorAction SilentlyContinue | Select-Object -ExpandProperty PSObject | Select-Object -ExpandProperty Properties | Select-Object -ExpandProperty Value"', (err, stdout) => {
                    if (!err && stdout.trim()) {
                        const ports = stdout.trim().split('\n').map(p => p.trim()).filter(p => p.startsWith('COM'));
                        if (ports.length > 0) {
                            resolve(ports.sort());
                            return;
                        }
                    }
                    // 备用方案1：使用 .NET SerialPort
                    exec('powershell -Command "[System.IO.Ports.SerialPort]::GetPortNames()"', (err2, stdout2) => {
                        if (!err2 && stdout2.trim()) {
                            const ports = stdout2.trim().split('\n').map(p => p.trim()).filter(p => p.startsWith('COM'));
                            if (ports.length > 0) {
                                resolve(ports.sort());
                                return;
                            }
                        }
                        // 备用方案2：使用 WMI
                        exec('powershell -Command "Get-WMIObject Win32_SerialPort | Select-Object -ExpandProperty DeviceID"', (err3, stdout3) => {
                            if (!err3 && stdout3.trim()) {
                                const ports = stdout3.trim().split('\n').map(p => p.trim()).filter(p => p);
                                resolve(ports.sort());
                            } else {
                                resolve([]);
                            }
                        });
                    });
                });
            } else {
                // Linux/macOS
                exec('ls /dev/tty* 2>/dev/null | grep -E "(USB|ACM|serial)"', (err, stdout) => {
                    if (err) { resolve([]); return; }
                    resolve(stdout.trim().split('\n').filter(p => p));
                });
            }
        });
    }

    /**
     * 显示下载配置对话框 - 使用下拉框方式
     */
    async showDownloadDialog(): Promise<void> {
        const projectRoot = await this.getProjectRoot();
        if (!projectRoot) {
            vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
            return;
        }

        // 读取项目配置（用于定位带基地址后缀的 romfs.bin）
        const config = ProjectUtils.loadProjectConfig(projectRoot);

        // 检查 romfs.bin（文件名带基地址后缀，例如 app_romfs_0x70536400.bin）
        const romfsPath = path.join(projectRoot, 'build', RomfsConfig.getBinFileName(config.romfsBaseAddr || DEFAULT_ROMFS_BASE_ADDR));
        if (!fs.existsSync(romfsPath)) {
            const choice = await vscode.window.showErrorMessage(
                vscode.l10n.t('romfs.bin does not exist, please compile the project first'),
                vscode.l10n.t('Compile Project')
            );
            if (choice === vscode.l10n.t('Compile Project')) {
                vscode.commands.executeCommand('honeygui.simulation');
            }
            return;
        }

        // 读取保存的配置
        const savedConfig = this.getSavedUartConfig();

        // 扫描串口
        const ports = await this.scanPorts();

        // 创建 QuickPick 界面
        const quickPick = vscode.window.createQuickPick();
        quickPick.title = 'UART 下载配置';
        quickPick.ignoreFocusOut = true;

        // 当前选择状态
        let selectedChip = savedConfig.chipType || 'RTL87X3G';
        let selectedBaud = savedConfig.baudRate?.toString() || '115200';
        let selectedPort = savedConfig.port || (ports.length > 0 ? ports[0] : '');

        const BAUD_RATES = ['3000000', '2000000', '921600', '460800', '230400', '115200', '57600'];

        // 更新选项列表
        const updateItems = () => {
            const items: vscode.QuickPickItem[] = [
                { label: vscode.l10n.t('Chip Type'), kind: vscode.QuickPickItemKind.Separator },
                ...SUPPORTED_CHIPS.map(c => ({
                    label: c,
                    description: c === selectedChip ? '✓' : '',
                    picked: c === selectedChip
                })),
                { label: vscode.l10n.t('Baud Rate'), kind: vscode.QuickPickItemKind.Separator },
                ...BAUD_RATES.map(b => ({
                    label: b,
                    description: b === selectedBaud ? '✓' : '',
                    picked: b === selectedBaud
                })),
                { label: vscode.l10n.t('Serial Port'), kind: vscode.QuickPickItemKind.Separator },
                ...ports.map(p => ({
                    label: p,
                    description: p === selectedPort ? '✓' : '',
                    picked: p === selectedPort
                })),
                {
                    label: `$(edit) ${vscode.l10n.t('Manual Input...')}`,
                    alwaysShow: true
                },
                { label: '', kind: vscode.QuickPickItemKind.Separator },
                {
                    label: `$(play) ${vscode.l10n.t('Start Download')}`,
                    description: `${selectedChip} | ${selectedPort} | ${selectedBaud}`,
                    alwaysShow: true
                }
            ];
            quickPick.items = items;
        };

        updateItems();

        quickPick.onDidAccept(async () => {
            const selected = quickPick.selectedItems[0];
            if (!selected) return;

            const label = selected.label;

            // 点击开始下载
            if (label.includes(vscode.l10n.t('Start Download'))) {
                if (!selectedPort) {
                    vscode.window.showWarningMessage(vscode.l10n.t('Please select or enter a serial port'));
                    return;
                }
                quickPick.hide();

                const uartConfig: UartConfig = {
                    port: selectedPort,
                    baudRate: parseInt(selectedBaud),
                    chipType: selectedChip,
                    flashAddress: config.romfsBaseAddr || DEFAULT_ROMFS_BASE_ADDR
                };
                await this.saveUartConfig(uartConfig);
                await this.download(projectRoot, uartConfig);
                return;
            }

            // 手动输入串口
            if (label.includes(vscode.l10n.t('Manual Input...'))) {
                quickPick.hide();
                const inputPort = await vscode.window.showInputBox({
                    prompt: vscode.l10n.t('Enter serial port'),
                    placeHolder: process.platform === 'win32' ? 'COM3' : '/dev/ttyUSB0',
                    value: selectedPort
                });
                if (inputPort) {
                    selectedPort = inputPort;
                    if (!ports.includes(inputPort)) {
                        ports.push(inputPort);
                    }
                }
                quickPick.show();
                updateItems();
                return;
            }

            // 选择芯片
            if (SUPPORTED_CHIPS.includes(label)) {
                selectedChip = label;
                updateItems();
                return;
            }

            // 选择波特率
            if (BAUD_RATES.includes(label)) {
                selectedBaud = label;
                updateItems();
                return;
            }

            // 选择串口
            if (ports.includes(label)) {
                selectedPort = label;
                updateItems();
                return;
            }
        });

        quickPick.show();
    }

    /**
     * 快速下载（使用上次配置）
     */
    async quickDownload(): Promise<void> {
        const projectRoot = await this.getProjectRoot();
        if (!projectRoot) {
            vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
            return;
        }

        const savedConfig = this.getSavedUartConfig();
        if (!savedConfig.port || !savedConfig.chipType) {
            await this.showDownloadDialog();
            return;
        }

        // 验证串口
        const ports = await this.scanPorts();
        if (!ports.includes(savedConfig.port)) {
            vscode.window.showWarningMessage(vscode.l10n.t('Please select or enter a serial port'));
            await this.showDownloadDialog();
            return;
        }

        const config = ProjectUtils.loadProjectConfig(projectRoot);
        await this.download(projectRoot, {
            port: savedConfig.port,
            baudRate: 115200,
            chipType: savedConfig.chipType,
            flashAddress: config.romfsBaseAddr || DEFAULT_ROMFS_BASE_ADDR
        });
    }

    /**
     * 执行下载
     */
    async download(projectRoot: string, uartConfig: UartConfig): Promise<void> {
        if (this.isDownloading) {
            vscode.window.showWarningMessage(vscode.l10n.t('Download in progress'));
            return;
        }

        // 文件名带基地址后缀（与编译产物一致），例如 app_romfs_0x70536400.bin
        const romfsPath = path.join(projectRoot, 'build', RomfsConfig.getBinFileName(uartConfig.flashAddress || DEFAULT_ROMFS_BASE_ADDR));
        if (!fs.existsSync(romfsPath)) {
            vscode.window.showErrorMessage(vscode.l10n.t('romfs.bin does not exist, please compile the project first'));
            return;
        }

        // 检查 mpcli 工具
        if (!fs.existsSync(this.mpcliPath)) {
            vscode.window.showErrorMessage(vscode.l10n.t('mpcli tool not found: {0}', this.mpcliPath));
            return;
        }

        this.isDownloading = true;
        this.updateStatusBar('$(sync~spin) Downloading...');
        this.outputChannel.show(true);
        this.outputChannel.clear();

        const fileSize = fs.statSync(romfsPath).size;
        this.log(`===== UART Download =====`);
        this.log(`Chip: ${uartConfig.chipType}`);
        this.log(`Port: ${uartConfig.port}`);
        this.log(`Address: ${uartConfig.flashAddress}`);
        this.log(`File: ${romfsPath}`);
        this.log(`Size: ${(fileSize / 1024).toFixed(2)} KB`);
        this.log(`---------------------`);

        try {
            await this.downloadWithMpcli(romfsPath, uartConfig);
            this.log(`---------------------`);
            this.log('Download completed!');
            vscode.window.showInformationMessage(vscode.l10n.t('UART download completed'));
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.log(`Download failed: ${msg}`, true);
            vscode.window.showErrorMessage(vscode.l10n.t('Download failed: {0}', msg));
        } finally {
            this.isDownloading = false;
            this.updateStatusBar('$(cloud-download) UART Download');
        }
    }

    /**
     * 使用 mpcli 工具下载
     */
    private async downloadWithMpcli(romfsPath: string, config: UartConfig): Promise<void> {
        return new Promise((resolve, reject) => {
            const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
            
            // mpcli 命令参数
            // python mpcli -T <芯片> -c <串口> -p -A <地址> -F <文件> -M 5 -r -u
            const args = [
                this.mpcliPath,
                '-T', config.chipType || 'RTL87X3G',
                '-c', config.port,
                '-p',
                '-A', config.flashAddress || DEFAULT_ROMFS_BASE_ADDR,
                '-F', romfsPath,
                '-M', '5',
                '-r',
                '-u'
            ];

            this.log(`执行: ${pythonCmd} ${args.join(' ')}`);

            const proc = spawn(pythonCmd, args, {
                shell: true,
                cwd: this.mpcliPath
            });

            let buffer = '';

            proc.stdout?.on('data', (data) => {
                const text = data.toString();
                buffer += text;
                
                // 只有包含换行符时才输出
                if (buffer.includes('\n')) {
                    const lines = buffer.split('\n');
                    // 最后一个元素可能是不完整的行，保留到 buffer
                    buffer = lines.pop() || '';
                    
                    lines.forEach((line: string) => {
                        if (line.trim()) this.log(line.trim());
                    });
                }
            });

            proc.stderr?.on('data', (data) => {
                const text = data.toString();
                buffer += text;
                
                // 只有包含换行符时才输出
                if (buffer.includes('\n')) {
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    
                    lines.forEach((line: string) => {
                        if (line.trim()) this.log(line.trim());
                    });
                }
            });

            proc.on('close', (code) => {
                // 输出剩余的缓冲内容
                if (buffer.trim()) {
                    this.log(buffer.trim());
                }
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`mpcli 退出码: ${code}`));
                }
            });

            proc.on('error', (err) => {
                reject(new Error(`无法执行 mpcli: ${err.message}\n请确保已安装 Python 和 pyserial 库`));
            });
        });
    }

    private async saveUartConfig(uartConfig: UartConfig): Promise<void> {
        // 使用 globalState 存储，不写入 project.json
        await this.context.globalState.update('honeygui.uart.port', uartConfig.port);
        await this.context.globalState.update('honeygui.uart.chipType', uartConfig.chipType);
        await this.context.globalState.update('honeygui.uart.baudRate', uartConfig.baudRate);
    }

    private getSavedUartConfig(): { port?: string; chipType?: string; baudRate?: number } {
        return {
            port: this.context.globalState.get<string>('honeygui.uart.port'),
            chipType: this.context.globalState.get<string>('honeygui.uart.chipType'),
            baudRate: this.context.globalState.get<number>('honeygui.uart.baudRate')
        };
    }

    private async getProjectRoot(): Promise<string | undefined> {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const root = ProjectUtils.findProjectRoot(activeEditor.document.fileName);
            if (root) return root;
        }
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders?.length) {
            return ProjectUtils.findProjectRoot(workspaceFolders[0].uri.fsPath);
        }
        return undefined;
    }

    private updateStatusBar(text: string): void {
        // 状态栏已移除
    }

    private log(message: string, isError = false): void {
        this.outputChannel.appendLine(message);
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}
