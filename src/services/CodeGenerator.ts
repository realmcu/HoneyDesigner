import * as path from 'path';
import * as fs from 'fs';
import { ProjectUtils } from '../utils/ProjectUtils';
import { HmlController } from '../hml/HmlController';
import { CodeGenOptions } from '../codegen/ICodeGenerator';
import { CodeGeneratorFactory, TargetEngine } from '../codegen/CodeGeneratorFactory';
import { EntryFileGenerator } from '../codegen/EntryFileGenerator';
import { LvglResourceManager } from '../codegen/lvgl/LvglResourceManager';
import { Component } from '../hml/types';
import { logger } from '../utils/Logger';
import { loadProjectI18nCatalog } from '../project-i18n/files';

export interface GenerationResult {
    success: boolean;
    successCount: number;
    totalFiles: number;
    errors: Array<{ designName: string; error: string }>;
    orphanedDesigns?: string[];
}

export interface GenerationProgress {
    current: number;
    total: number;
    designName: string;
}

export class CodeGenerator {
    /**
     * 扫描项目中的所有 HML 文件
     */
    public async scanHmlFiles(projectRoot: string): Promise<string[]> {
        const uiDir = ProjectUtils.getUiDir(projectRoot);

        if (!fs.existsSync(uiDir)) {
            throw new Error(`UI目录不存在: ${uiDir}`);
        }

        // 递归扫描 ui/ 下所有 .hml 文件
        const hmlFiles: string[] = [];
        const scanDir = (dir: string) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isFile() && entry.name.endsWith('.hml')) {
                    hmlFiles.push(fullPath);
                } else if (entry.isDirectory()) {
                    scanDir(fullPath);
                }
            }
        };
        scanDir(uiDir);

        return hmlFiles;
    }

    /**
     * 生成代码
     */
    public async generate(
        projectRoot: string,
        onProgress?: (progress: GenerationProgress) => void
    ): Promise<GenerationResult> {
        const hmlFiles = await this.scanHmlFiles(projectRoot);

        if (hmlFiles.length === 0) {
            return {
                success: true,
                successCount: 0,
                totalFiles: 0,
                errors: []
            };
        }

        const config = ProjectUtils.loadProjectConfig(projectRoot);
        const srcDir = ProjectUtils.getSrcDir(projectRoot);
        const targetEngine: TargetEngine = config.targetEngine || 'honeygui';

        // 生成项目入口文件（仅 HoneyGUI 引擎需要）
        if (targetEngine === 'honeygui') {
            try {
                // 从 HML 文件中查找 entry view 的 ID
                const entryViewId = await this.findEntryViewId(hmlFiles);
                const entryFile = EntryFileGenerator.generate(srcDir, config.name || 'HoneyGUI', entryViewId, config.romfsBaseAddr);
                logger.info(`入口文件: ${path.basename(entryFile)}`);
            } catch (error) {
                logger.error(`生成入口文件失败: ${error}`);
            }
        }

        // LVGL 引擎：先收集所有 HML 的组件，统一做资源转换，避免多个 HML 互相清理资源
        let sharedResourceManager: LvglResourceManager | undefined;
        let allDesignNames: string[] | undefined;
        let lvglEntryViewId: string | undefined;
        if (targetEngine === 'lvgl' && hmlFiles.length > 1) {
            const allComponents: Component[] = [];
            allDesignNames = [];
            // 按 design 分组记录组件，用于查找 entry view
            const componentsByDesign = new Map<string, Component[]>();
            for (const hmlFile of hmlFiles) {
                try {
                    const hmlController = new HmlController();
                    await hmlController.loadFile(hmlFile);
                    const components = hmlController.currentDocument?.view.components || [];
                    const designName = path.basename(hmlFile, '.hml');
                    allComponents.push(...(components as Component[]));
                    allDesignNames.push(designName);
                    componentsByDesign.set(designName, components as Component[]);
                } catch {
                    // 跳过解析失败的文件
                }
            }

            // 统一执行一次资源转换（图片 + 字体）
            // NOTE: 必须 await，prepare() 是异步的（内部要跑 LVGLImage.py 把 png 转成 bin 并解析头），
            // 不 await 会导致后续 generateSingle 拿到空的资源信息，external-bin 资源被当成 c-array。
            sharedResourceManager = new LvglResourceManager();
            const lvglDir = path.join(srcDir, 'lvgl');
            if (!fs.existsSync(lvglDir)) {
                fs.mkdirSync(lvglDir, { recursive: true });
            }
            await sharedResourceManager.prepare(allComponents, srcDir, lvglDir);

            // 确定入口 view：从所有 design 中查找唯一的 entry="true" view
            lvglEntryViewId = this.findLvglEntryViewId(componentsByDesign);

            logger.info(`LVGL 多设计资源统一转换完成 (${allDesignNames.length} 个设计, ${allComponents.length} 个组件, entry: ${lvglEntryViewId || 'auto'})`);
        }

        let successCount = 0;
        let totalFiles = 0;
        const errors: Array<{ designName: string; error: string }> = [];

        for (let i = 0; i < hmlFiles.length; i++) {
            const hmlFile = hmlFiles[i];
            // 使用 HML 文件名（不含扩展名）作为 designName
            const designName = path.basename(hmlFile, '.hml');

            onProgress?.({
                current: i + 1,
                total: hmlFiles.length,
                designName
            });

            try {
                const result = await this.generateSingle(hmlFile, srcDir, designName, sharedResourceManager, allDesignNames, lvglEntryViewId);
                successCount++;
                totalFiles += result.fileCount;
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : '未知错误';
                errors.push({
                    designName,
                    error: errorMsg
                });
                logger.error(`生成 ${designName} 失败: ${errorMsg}`);
            }
        }

        return {
            success: errors.length === 0,
            successCount,
            totalFiles,
            errors,
            orphanedDesigns: this.detectOrphanedDesigns(srcDir, hmlFiles)
        };
    }

    /**
     * 检测孤立的生成文件（HML 已删除/重命名但生成文件仍存在）
     */
    public detectOrphanedDesigns(srcDir: string, hmlFiles: string[]): string[] {
        const validDesignNames = new Set(
            hmlFiles.map(f => path.basename(f, '.hml'))
        );

        const uiDir = path.join(srcDir, 'ui');
        if (!fs.existsSync(uiDir)) {
            return [];
        }

        // 从 src/ui/ 目录中提取已生成的 designName
        const existingDesignNames = new Set<string>();
        try {
            const files = fs.readdirSync(uiDir);
            for (const file of files) {
                const match = file.match(/^(.+)_ui\.c$/);
                if (match) {
                    existingDesignNames.add(match[1]);
                }
            }
        } catch {
            return [];
        }

        // 差集：已生成但无对应 HML 的 designName
        const orphaned: string[] = [];
        for (const name of existingDesignNames) {
            if (!validDesignNames.has(name)) {
                orphaned.push(name);
            }
        }

        return orphaned;
    }

    /**
     * 删除指定 designName 的所有生成文件
     */
    public static cleanOrphanedFiles(srcDir: string, designNames: string[]): { deleted: string[]; failed: string[] } {
        const deleted: string[] = [];
        const failed: string[] = [];

        for (const name of designNames) {
            const filesToDelete = [
                path.join(srcDir, 'ui', `${name}_ui.h`),
                path.join(srcDir, 'ui', `${name}_ui.c`),
                path.join(srcDir, 'ui', `${name}_ui.o`),
                path.join(srcDir, 'callbacks', `${name}_callbacks.h`),
                path.join(srcDir, 'callbacks', `${name}_callbacks.c`),
                path.join(srcDir, 'callbacks', `${name}_callbacks.o`),
                path.join(srcDir, 'user', `${name}_user.h`),
                path.join(srcDir, 'user', `${name}_user.c`),
                path.join(srcDir, 'user', `${name}_user.o`),
            ];

            for (const filePath of filesToDelete) {
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                        deleted.push(filePath);
                        logger.info(`已删除孤立文件: ${filePath}`);
                    }
                } catch (error) {
                    failed.push(filePath);
                    logger.error(`删除失败: ${filePath}, ${error}`);
                }
            }
        }

        return { deleted, failed };
    }

    /**
     * 从 HML 文件列表中查找 entry view 的 ID
     */
    private async findEntryViewId(hmlFiles: string[]): Promise<string | undefined> {
        for (const hmlFile of hmlFiles) {
            try {
                const hmlController = new HmlController();
                const doc = await hmlController.loadFile(hmlFile);
                const components = doc.view.components || [];
                const entryView = components.find(
                    c => c.type === 'hg_view' && (c.data?.entry === true || c.data?.entry === 'true')
                );
                if (entryView) {
                    return entryView.id;
                }
            } catch {
                // 跳过解析失败的文件
            }
        }
        return undefined;
    }

    /**
     * 查找 LVGL 多设计项目的入口 view ID
     * 从所有 design 中查找第一个 entry="true" 的 view（整个项目应只有一个）
     */
    private findLvglEntryViewId(componentsByDesign: Map<string, Component[]>): string | undefined {
        for (const [, components] of componentsByDesign) {
            const entryView = components.find(
                c => c.type === 'hg_view' && (c.data?.entry === true || c.data?.entry === 'true')
            );
            if (entryView) {
                return entryView.id;
            }
        }

        return undefined;
    }

    /**
     * 生成单个 HML 文件的代码
     */
    private async generateSingle(
        hmlFile: string,
        srcDir: string,
        designName: string,
        sharedResourceManager?: LvglResourceManager,
        allDesignNames?: string[],
        entryViewId?: string
    ): Promise<{ fileCount: number }> {
        const hmlController = new HmlController();
        await hmlController.loadFile(hmlFile);

        // 获取项目配置中的目标引擎
        const projectRoot = ProjectUtils.findProjectRoot(path.dirname(hmlFile));
        const config = projectRoot ? ProjectUtils.loadProjectConfig(projectRoot) : {};
        const targetEngine: TargetEngine = config.targetEngine || 'honeygui';
        const projectI18nCatalog = projectRoot ? loadProjectI18nCatalog(projectRoot) : undefined;

        const generatorOptions: CodeGenOptions = {
            srcDir,
            designName,
            enableProtectedAreas: true,
            allDesignNames,
            entryViewId,
            sharedResourceManager,
            skipResourcePrepare: !!sharedResourceManager,
            projectRoot,
            projectI18nCatalog,
            romfsBaseAddr: config.romfsBaseAddr,
        };

        // 使用工厂创建代码生成器
        const components = hmlController.currentDocument?.view.components || [];
        const generator = CodeGeneratorFactory.create(targetEngine, components as any, generatorOptions);
        const result = await generator.generate();

        if (!result.success) {
            throw new Error(result.errors?.[0] || '生成失败');
        }

        return { fileCount: result.files?.length || 0 };
    }
}
