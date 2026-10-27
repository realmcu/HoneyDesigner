import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { ProjectUtils } from '../utils/ProjectUtils';

const execAsync = promisify(exec);

/**
 * 环境检查结果
 */
export interface EnvironmentCheckResult {
    success: boolean;
    pythonInstalled: boolean;
    pythonVersion?: string;
    sconsInstalled: boolean;
    sconsVersion?: string;
    compilerInstalled: boolean;
    compilerVersion?: string;
    sdlInstalled?: boolean;
    sdlVersion?: string;
    ffmpegInstalled: boolean;
    ffmpegVersion?: string;
    libSimValid: boolean;
    errors: string[];
}

/**
 * 环境检查工具
 * 检查编译仿真所需的工具链
 */
export class EnvironmentChecker {
    /**
     * 检查完整环境
     */
    async checkAll(): Promise<EnvironmentCheckResult> {
        const libSimPath = ProjectUtils.getLibSimPath();
        const result: EnvironmentCheckResult = {
            success: true,
            pythonInstalled: false,
            sconsInstalled: false,
            compilerInstalled: false,
            ffmpegInstalled: false,
            libSimValid: false,
            errors: []
        };

        // 检查 Python
        const pythonCheck = await this.checkPython();
        result.pythonInstalled = pythonCheck.installed;
        result.pythonVersion = pythonCheck.version;
        if (!result.pythonInstalled) {
            result.errors.push(vscode.l10n.t('Python is not installed. Please download from https://www.python.org/'));
            result.success = false;
        }

        // 检查 SCons
        const sconsCheck = await this.checkSCons();
        result.sconsInstalled = sconsCheck.installed;
        result.sconsVersion = sconsCheck.version;
        if (!result.sconsInstalled) {
            result.errors.push(vscode.l10n.t('SCons is not installed. Please run: pip install scons'));
            result.success = false;
        }

        // 检查编译器
        const compilerCheck = await this.checkCompiler();
        result.compilerInstalled = compilerCheck.installed;
        result.compilerVersion = compilerCheck.version;
        if (!result.compilerInstalled) {
            const compilerName = process.platform === 'win32' ? 'MinGW' : 'GCC';
            result.errors.push(vscode.l10n.t('{0} is not installed. Please install C compiler.', compilerName));
            result.success = false;
        }

        // 检查 SDL (仅 Linux/WSL)
        if (process.platform === 'linux') {
            const sdlCheck = await this.checkSDL();
            result.sdlInstalled = sdlCheck.installed;
            result.sdlVersion = sdlCheck.version;
            if (!result.sdlInstalled) {
                result.errors.push(vscode.l10n.t('SDL2 is not installed. Please run: sudo apt-get install libsdl2-dev'));
                result.success = false;
            }
        }

        // 检查 FFmpeg
        const ffmpegCheck = await this.checkFFmpeg();
        result.ffmpegInstalled = ffmpegCheck.installed;
        result.ffmpegVersion = ffmpegCheck.version;
        if (!result.ffmpegInstalled) {
            result.errors.push(vscode.l10n.t('FFmpeg is not installed. Video conversion will not be available.'));
        }

        // 检查内置库路径
        result.libSimValid = this.checkLibSimPath(libSimPath);
        if (!result.libSimValid) {
            result.errors.push(vscode.l10n.t('Invalid built-in library path: {0}', libSimPath));
            result.success = false;
        }

        return result;
    }

    private async checkPython(): Promise<{ installed: boolean; version?: string }> {
        try {
            const { stdout } = await execAsync('python --version', { windowsHide: true });
            return { installed: true, version: stdout.trim() };
        } catch {
            try {
                const { stdout } = await execAsync('python3 --version', { windowsHide: true });
                return { installed: true, version: stdout.trim() };
            } catch {
                return { installed: false };
            }
        }
    }

    private async checkSCons(): Promise<{ installed: boolean; version?: string }> {
        try {
            const { stdout } = await execAsync('scons --version', { windowsHide: true });
            const match = stdout.match(/SCons.*?(\d+\.\d+\.\d+)/);
            return { installed: true, version: match ? match[1] : stdout.split('\n')[0] };
        } catch {
            return { installed: false };
        }
    }

    private async checkCompiler(): Promise<{ installed: boolean; version?: string }> {
        try {
            const { stdout } = await execAsync('gcc --version', { windowsHide: true });
            const match = stdout.match(/gcc.*?(\d+\.\d+\.\d+)/i);
            return { installed: true, version: match ? match[1] : stdout.split('\n')[0] };
        } catch {
            return { installed: false };
        }
    }

    private async checkSDL(): Promise<{ installed: boolean; version?: string }> {
        try {
            const { stdout } = await execAsync('pkg-config --modversion sdl2', { windowsHide: true });
            return { installed: true, version: stdout.trim() };
        } catch {
            return { installed: false };
        }
    }

    private async checkFFmpeg(): Promise<{ installed: boolean; version?: string }> {
        try {
            const { stdout } = await execAsync('ffmpeg -version', { windowsHide: true });
            const match = stdout.match(/ffmpeg version (\S+)/);
            return { installed: true, version: match ? match[1] : stdout.split('\n')[0] };
        } catch {
            return { installed: false };
        }
    }

    /**
     * 检查内置库路径是否有效
     */
    private checkLibSimPath(libSimPath: string): boolean {
        if (!libSimPath || !fs.existsSync(libSimPath)) {
            return false;
        }

        // 检查关键目录/文件是否存在
        const win32sim = fs.existsSync(`${libSimPath}/win32_sim`);
        const include = fs.existsSync(`${libSimPath}/include`);

        return win32sim && include;
    }

    /**
     * 生成安装指南
     */
    getInstallGuide(result: EnvironmentCheckResult): string {
        const lines: string[] = [vscode.l10n.t('Environment check failed, please install the following tools:') + '\n'];

        if (!result.pythonInstalled) {
            lines.push('1. Python');
            lines.push(`   ${vscode.l10n.t('Download URL')}: https://www.python.org/`);
            lines.push('');
        }

        if (!result.sconsInstalled) {
            lines.push(`2. ${vscode.l10n.t('SCons build tool')}`);
            lines.push(`   ${vscode.l10n.t('Install command')}: pip install scons`);
            lines.push('');
        }

        if (!result.compilerInstalled) {
            if (process.platform === 'win32') {
                lines.push(`3. ${vscode.l10n.t('MinGW compiler')}`);
                lines.push(`   ${vscode.l10n.t('Download URL')}: https://www.mingw-w64.org/`);
            } else {
                lines.push(`3. ${vscode.l10n.t('GCC compiler')}`);
                lines.push(`   ${vscode.l10n.t('Install command')}: sudo apt-get install build-essential (Ubuntu/Debian)`);
                lines.push(`   ${vscode.l10n.t('Install command')}: sudo yum groupinstall "Development Tools" (CentOS/RHEL)`);
            }
            lines.push('');
        }

        if (result.sdlInstalled === false) {
            lines.push(`4. ${vscode.l10n.t('SDL2 development library')}`);
            lines.push(`   ${vscode.l10n.t('Install command')}: sudo apt-get install libsdl2-dev (Ubuntu/Debian)`);
            lines.push(`   ${vscode.l10n.t('Install command')}: sudo yum install SDL2-devel (CentOS/RHEL)`);
            lines.push('');
        }

        if (!result.ffmpegInstalled) {
            lines.push(`5. ${vscode.l10n.t('FFmpeg (optional, for video conversion)')}`);
            lines.push(`   ${vscode.l10n.t('Download URL')}: https://ffmpeg.org/`);
            lines.push('');
        }

        if (!result.libSimValid) {
            lines.push(`6. ${vscode.l10n.t('Built-in library files missing')}`);
            lines.push(`   ${vscode.l10n.t('Please reinstall the extension')}`);
            lines.push('');
        }

        return lines.join('\n');
    }
}
