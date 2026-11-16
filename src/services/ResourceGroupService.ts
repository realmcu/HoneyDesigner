import * as fs from 'fs';
import * as path from 'path';
import { ProjectConfig, ResourceGroupConfig } from '../common/ProjectConfig';
import { ProjectUtils } from '../utils/ProjectUtils';
import { ConversionConfigService } from './ConversionConfigService';

/** 分组名必须同时是合法的文件夹名 */
const GROUP_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

/** 十六进制地址，允许 0x 前缀 */
const HEX_ADDR_PATTERN = /^(0x)?[0-9a-fA-F]+$/;

/**
 * 资源分组的增删改。
 *
 * 分组既是 project.json 里的一条声明，也是 assets/ 下一个真实的资源根目录
 * （含自己的 conversion.json 与 user/）。两处必须一起维护，所以集中在这里。
 */
export class ResourceGroupService {
    /** 分组名是否合法（同时作为文件夹名） */
    static isValidGroupName(name: string): boolean {
        return GROUP_NAME_PATTERN.test(name) && name !== '.' && name !== '..';
    }

    /** 地址格式是否合法 */
    static isValidBaseAddr(addr: string): boolean {
        return HEX_ADDR_PATTERN.test(addr.trim());
    }

    /**
     * 把用户输入的地址规范化成 "0xXXXX" 形式。
     * 输入 "70500000" 与 "0x70500000" 都得到 "0x70500000"。
     */
    static normalizeBaseAddr(addr: string): string {
        const trimmed = addr.trim();
        const hex = /^0x/i.test(trimmed) ? trimmed.slice(2) : trimmed;
        return `0x${hex.toUpperCase()}`;
    }

    /** 读取项目的分组列表 */
    static listGroups(projectRoot: string): ResourceGroupConfig[] {
        const config = ProjectUtils.loadProjectConfig(projectRoot);
        return Array.isArray(config.resourceGroups) ? config.resourceGroups : [];
    }

    /**
     * 新建分组：
     * 1. 建 assets/<name>/ 目录
     * 2. 写入该分组自己的 conversion.json
     * 3. 建 assets/<name>/user/
     * 4. 在 project.json 的 resourceGroups 里追加一条
     *
     * @returns 创建后的分组配置
     */
    static createGroup(
        projectRoot: string,
        name: string,
        baseAddr: string,
        description?: string
    ): ResourceGroupConfig {
        if (!this.isValidGroupName(name)) {
            throw new Error(`Invalid group name: ${name}`);
        }
        if (!this.isValidBaseAddr(baseAddr)) {
            throw new Error(`Invalid base address: ${baseAddr}`);
        }

        const existing = this.listGroups(projectRoot);
        if (existing.some(g => g.name === name)) {
            throw new Error(`Resource group already exists: ${name}`);
        }

        const assetsDir = ProjectUtils.getAssetsDir(projectRoot);
        const groupDir = path.join(assetsDir, name);
        if (fs.existsSync(groupDir)) {
            throw new Error(`Directory already exists under assets/: ${name}`);
        }

        // 目录 + user 子目录
        fs.mkdirSync(path.join(groupDir, 'user'), { recursive: true });

        // 分组自己的 conversion.json（与该分组资源根配套）
        ConversionConfigService.getInstance().saveConfigForRoot(groupDir, {
            version: '1.0',
            defaultSettings: {
                format: 'adaptive16',
                compression: 'adaptive',
                dither: false,
                videoFormat: 'MJPEG',
                videoQuality: 5,
            },
            items: {},
        });

        // 写入 project.json
        const group: ResourceGroupConfig = {
            name,
            baseAddr: this.normalizeBaseAddr(baseAddr),
            ...(description ? { description } : {}),
        };
        this.saveGroups(projectRoot, [...existing, group]);

        return group;
    }

    /**
     * 删除分组声明。
     *
     * 只摘除 project.json 里的条目，**不删除磁盘上的目录与资源**：
     * 资源是用户的资产，误删不可恢复。调用方负责把这一点告知用户。
     */
    static removeGroup(projectRoot: string, name: string): boolean {
        const existing = this.listGroups(projectRoot);
        const next = existing.filter(g => g.name !== name);
        if (next.length === existing.length) {
            return false;
        }
        this.saveGroups(projectRoot, next);
        return true;
    }

    /**
     * 新建分组后检查 assets/ 根目录下是否还残留可转换的资源。
     *
     * 有分组后根资源不再参与转换，这些文件会被静默忽略，所以要主动提醒。
     * @returns 被忽略的文件数（0 表示没有残留）
     */
    static countOrphanedRootAssets(projectRoot: string, groupNames: string[]): number {
        const assetsDir = ProjectUtils.getAssetsDir(projectRoot);
        if (!fs.existsSync(assetsDir)) {
            return 0;
        }

        const convertibleExts = new Set([
            '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg',
            '.mp4', '.avi', '.mov', '.mkv', '.webm',
            '.gltf', '.glb', '.obj', '.ttf', '.otf', '.woff', '.woff2',
        ]);
        const groupSet = new Set(groupNames);

        let count = 0;
        const walk = (dir: string, depth: number) => {
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (depth === 0 && groupSet.has(entry.name)) {
                        continue;
                    }
                    if (entry.name === 'user') {
                        continue;
                    }
                    walk(full, depth + 1);
                } else if (convertibleExts.has(path.extname(entry.name).toLowerCase())) {
                    count++;
                }
            }
        };
        walk(assetsDir, 0);
        return count;
    }

    /** 把分组列表写回 project.json（保留其它字段） */
    private static saveGroups(projectRoot: string, groups: ResourceGroupConfig[]): void {
        const configPath = path.join(projectRoot, 'project.json');
        let config: ProjectConfig = {};
        if (fs.existsSync(configPath)) {
            try {
                config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ProjectConfig;
            } catch {
                config = {};
            }
        }
        config.resourceGroups = groups;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    }
}
