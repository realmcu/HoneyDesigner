import * as fs from 'fs';
import * as path from 'path';
import { logger } from './Logger';

/**
 * 工程配置管理器
 *
 * 负责管理根目录下 `config/` 内的多个备选 project.json 配置文件：
 * - 列出可选配置
 * - 判断当前根目录 project.json 匹配哪个备选配置（按内容匹配）
 * - 应用（拷贝备选配置覆盖根目录 project.json）
 * - 以当前配置为模板新建备选配置
 * - 删除备选配置
 *
 * 备选配置以文件名（不含 .json 扩展名）作为其“配置名”。
 */
export class ProjectConfigManager {
    /** 根目录下存放备选配置的目录名 */
    static readonly CONFIG_DIR_NAME = 'config';
    /** 根目录下的主配置文件名 */
    static readonly ROOT_CONFIG_NAME = 'project.json';

    /**
     * 获取存放备选配置的目录路径
     */
    static getConfigDir(projectRoot: string): string {
        return path.join(projectRoot, this.CONFIG_DIR_NAME);
    }

    /**
     * 获取根目录主配置文件路径
     */
    static getRootConfigPath(projectRoot: string): string {
        return path.join(projectRoot, this.ROOT_CONFIG_NAME);
    }

    /**
     * 校验配置名是否合法（防止路径穿越）
     * @returns 合法返回 true
     */
    static isValidConfigName(name: string): boolean {
        if (!name || typeof name !== 'string') {
            return false;
        }
        const trimmed = name.trim();
        if (trimmed.length === 0) {
            return false;
        }
        // 禁止路径分隔符与相对路径片段
        if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
            return false;
        }
        // 禁止 Windows 非法文件名字符
        if (/[<>:"|?*\x00-\x1f]/.test(trimmed)) {
            return false;
        }
        return true;
    }

    /**
     * 列出所有备选配置名（不含 .json 扩展名），按字母排序
     * @param projectRoot 项目根目录
     * @returns 配置名数组；目录不存在时返回空数组
     */
    static listConfigs(projectRoot: string): string[] {
        const configDir = this.getConfigDir(projectRoot);
        try {
            if (!fs.existsSync(configDir)) {
                return [];
            }
            const entries = fs.readdirSync(configDir, { withFileTypes: true });
            const names: string[] = [];
            for (const entry of entries) {
                if (!entry.isFile()) {
                    continue;
                }
                const fileName = entry.name;
                // 跳过隐藏文件
                if (fileName.startsWith('.')) {
                    continue;
                }
                if (!fileName.toLowerCase().endsWith('.json')) {
                    continue;
                }
                names.push(fileName.slice(0, fileName.length - '.json'.length));
            }
            names.sort((a, b) => a.localeCompare(b));
            return names;
        } catch (error) {
            logger.error(`列出工程配置失败: ${error}`);
            return [];
        }
    }

    /**
     * 递归对对象键排序，用于内容规范化比较（忽略键顺序与格式差异）
     */
    private static sortKeysDeep(value: any): any {
        if (Array.isArray(value)) {
            return value.map((item) => this.sortKeysDeep(item));
        }
        if (value !== null && typeof value === 'object') {
            const sorted: Record<string, any> = {};
            for (const key of Object.keys(value).sort()) {
                sorted[key] = this.sortKeysDeep(value[key]);
            }
            return sorted;
        }
        return value;
    }

    /**
     * 将 JSON 文件内容规范化为可比较的字符串（键排序、忽略空白差异）
     * @returns 规范化字符串；读取或解析失败返回 null
     */
    private static canonicalizeFile(filePath: string): string | null {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(content);
            return JSON.stringify(this.sortKeysDeep(parsed));
        } catch (error) {
            logger.error(`规范化配置文件失败 (${filePath}): ${error}`);
            return null;
        }
    }

    /**
     * 判断当前根目录 project.json 内容匹配哪个备选配置
     * @param projectRoot 项目根目录
     * @returns 匹配的配置名；无匹配（含根配置不存在）返回 null
     */
    static getActiveConfigName(projectRoot: string): string | null {
        const rootPath = this.getRootConfigPath(projectRoot);
        if (!fs.existsSync(rootPath)) {
            return null;
        }
        const rootCanonical = this.canonicalizeFile(rootPath);
        if (rootCanonical === null) {
            return null;
        }
        const configDir = this.getConfigDir(projectRoot);
        for (const name of this.listConfigs(projectRoot)) {
            const candidatePath = path.join(configDir, `${name}.json`);
            const candidateCanonical = this.canonicalizeFile(candidatePath);
            if (candidateCanonical !== null && candidateCanonical === rootCanonical) {
                return name;
            }
        }
        return null;
    }

    /**
     * 应用备选配置：拷贝 config/<name>.json 覆盖根目录 project.json
     * @param projectRoot 项目根目录
     * @param name 配置名
     * @throws 配置名非法或源文件不存在时抛出错误
     */
    static applyConfig(projectRoot: string, name: string): void {
        if (!this.isValidConfigName(name)) {
            throw new Error(`非法的配置名: ${name}`);
        }
        const source = path.join(this.getConfigDir(projectRoot), `${name}.json`);
        if (!fs.existsSync(source)) {
            throw new Error(`配置文件不存在: ${name}`);
        }
        const dest = this.getRootConfigPath(projectRoot);
        fs.copyFileSync(source, dest);
    }

    /**
     * 以当前根目录 project.json 为模板，新建备选配置 config/<name>.json
     * @param projectRoot 项目根目录
     * @param name 新配置名
     * @returns 新建配置文件的绝对路径
     * @throws 配置名非法、已存在同名配置、或根配置不存在时抛出错误
     */
    static createConfigFromCurrent(projectRoot: string, name: string): string {
        if (!this.isValidConfigName(name)) {
            throw new Error(`非法的配置名: ${name}`);
        }
        const rootPath = this.getRootConfigPath(projectRoot);
        if (!fs.existsSync(rootPath)) {
            throw new Error('当前工程缺少 project.json，无法作为模板');
        }
        const configDir = this.getConfigDir(projectRoot);
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        const dest = path.join(configDir, `${name.trim()}.json`);
        if (fs.existsSync(dest)) {
            throw new Error(`配置已存在: ${name}`);
        }
        fs.copyFileSync(rootPath, dest);
        return dest;
    }

    /**
     * 删除备选配置 config/<name>.json
     * @param projectRoot 项目根目录
     * @param name 配置名
     * @throws 配置名非法时抛出错误
     */
    static deleteConfig(projectRoot: string, name: string): void {
        if (!this.isValidConfigName(name)) {
            throw new Error(`非法的配置名: ${name}`);
        }
        const target = path.join(this.getConfigDir(projectRoot), `${name}.json`);
        if (fs.existsSync(target)) {
            fs.unlinkSync(target);
        }
    }
}
