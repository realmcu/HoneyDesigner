import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProjectConfig, DEFAULT_PROJECT_CONFIG } from '../common/ProjectConfig';
import { logger } from './Logger';

/**
 * 项目工具类
 */
export class ProjectUtils {
    /**
     * 获取默认 SDK 路径
     */
    /**
     * 从文件路径向上查找项目根目录（包含project.json的目录）
     * @param filePath 文件路径
     * @returns 项目根目录，如果未找到返回undefined
     */
    static findProjectRoot(filePath: string): string | undefined {
        // 如果传入的是目录且包含 project.json，直接返回
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
            if (fs.existsSync(path.join(filePath, 'project.json'))) {
                return filePath;
            }
        }

        let dir = path.dirname(filePath);
        
        // 向上查找，直到找到包含project.json的目录
        while (dir !== path.dirname(dir)) { // 没到根目录
            const projectJsonPath = path.join(dir, 'project.json');
            if (fs.existsSync(projectJsonPath)) {
                return dir;
            }
            dir = path.dirname(dir);
        }
        
        return undefined;
    }

    /**
     * 在目录中递归向下查找项目根目录（包含project.json的目录）
     * @param dirPath 起始目录路径
     * @param maxDepth 最大搜索深度，默认为3
     * @returns 项目根目录，如果未找到返回undefined
     */
    static findProjectRootRecursive(dirPath: string, maxDepth: number = 3): string | undefined {
        // 检查当前目录是否包含 project.json
        if (fs.existsSync(path.join(dirPath, 'project.json'))) {
            return dirPath;
        }

        // 如果达到最大深度，停止搜索
        if (maxDepth <= 0) {
            return undefined;
        }

        try {
            // 读取目录内容
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            
            // 遍历子目录
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    // 跳过常见的非项目目录
                    const skipDirs = ['node_modules', '.git', '.vscode', 'out', 'dist', 'build', '.kiro'];
                    if (skipDirs.includes(entry.name)) {
                        continue;
                    }

                    const subDirPath = path.join(dirPath, entry.name);
                    const result = this.findProjectRootRecursive(subDirPath, maxDepth - 1);
                    if (result) {
                        return result;
                    }
                }
            }
        } catch (error) {
            // 忽略权限错误等
            logger.error(`递归查找项目根目录失败: ${error}`);
        }

        return undefined;
    }

    /**
     * 读取项目配置
     * @param projectRoot 项目根目录
     * @returns 项目配置，如果读取失败返回默认配置
     */
    static loadProjectConfig(projectRoot: string): ProjectConfig {
        const projectJsonPath = path.join(projectRoot, 'project.json');
        
        try {
            const content = fs.readFileSync(projectJsonPath, 'utf-8');
            const config = JSON.parse(content) as ProjectConfig;
            
            // 合并默认配置
            return {
                ...DEFAULT_PROJECT_CONFIG,
                ...config
            } as ProjectConfig;
        } catch (error) {
            logger.error(`读取项目配置失败: ${error}`);
            return {
                name: path.basename(projectRoot),
                ...DEFAULT_PROJECT_CONFIG
            } as ProjectConfig;
        }
    }

    /**
     * 获取assets目录路径
     * @param projectRoot 项目根目录
     * @returns assets目录的绝对路径
     */
    static getAssetsDir(projectRoot: string): string {
        const config = this.loadProjectConfig(projectRoot);
        return path.join(projectRoot, config.assetsDir || 'assets');
    }

    /**
     * 获取UI目录路径
     * @param projectRoot 项目根目录
     * @returns UI目录的绝对路径
     */
    static getUiDir(projectRoot: string): string {
        const config = this.loadProjectConfig(projectRoot);
        return path.join(projectRoot, config.uiDir || 'ui');
    }

    /**
     * 获取源码目录路径
     * @param projectRoot 项目根目录
     * @returns 源码目录的绝对路径
     */
    static getSrcDir(projectRoot: string): string {
        const config = this.loadProjectConfig(projectRoot);
        return path.join(projectRoot, config.srcDir || 'src');
    }

    /**
     * 获取插件内置的 lib/sim 路径
     * @returns lib/sim 目录的绝对路径
     */
    static getLibSimPath(): string {
        // __dirname 在编译后指向 out/src/utils/，需要向上三级到达插件根目录
        const extensionPath = path.join(__dirname, '..', '..', '..');
        return path.join(extensionPath, 'lib', 'sim');
    }

    /**
     * 获取插件安装根目录
     * @returns 插件根目录的绝对路径
     */
    static getExtensionRoot(): string {
        // __dirname 在编译后指向 out/src/utils/，需要向上三级到达插件根目录
        return path.join(__dirname, '..', '..', '..');
    }

    /**
     * 获取插件内置的预置字符集（.cst）目录
     * @returns tools/font-converter/charset 目录的绝对路径
     */
    static getCharsetDir(): string {
        return path.join(this.getExtensionRoot(), 'tools', 'font-converter', 'charset');
    }

    /**
     * 获取插件内置的预置 CodePage 目录
     * @returns tools/font-converter/CodePage 目录的绝对路径
     */
    static getCodePageDir(): string {
        return path.join(this.getExtensionRoot(), 'tools', 'font-converter', 'CodePage');
    }

    /**
     * 解析分辨率字符串
     * @param resolution 分辨率字符串，如 "480X272"
     * @returns 宽高对象，解析失败返回默认值 480x272
     */
    static parseResolution(resolution?: string): { width: number; height: number } {
        if (!resolution) {
            return { width: 480, height: 272 };
        }
        const parts = resolution.split('X');
        const width = parseInt(parts[0]);
        const height = parseInt(parts[1]);
        if (isNaN(width) || isNaN(height)) {
            return { width: 480, height: 272 };
        }
        return { width, height };
    }

    /**
     * 将 pixelMode 转换为像素位数
     * @param pixelMode 像素格式，如 "RGB565", "RGB888", "ARGB8888"
     * @returns 像素位数，默认 16 (RGB565)
     */
    static getPixelBits(pixelMode?: string): number {
        switch (pixelMode) {
            case 'RGB565':
                return 16;
            case 'RGB888':
                return 24;
            case 'ARGB8888':
                return 32;
            default:
                return 16;  // 默认 RGB565
        }
    }
}
