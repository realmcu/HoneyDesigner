import * as path from 'path';
import * as vscode from 'vscode';
import { HmlController } from '../hml/HmlController';
import { ProjectUtils } from '../utils/ProjectUtils';
import { logger } from '../utils/Logger';
import { validateProject, ProjectDesign, ProjectIssue } from '../codegen/projectValidation';
import { COMPONENT_ENGINE_SUPPORT } from '../codegen/engineSupport';
import type { TargetEngine } from '../codegen/CodeGeneratorFactory';
import type { Component } from '../hml/types';

/**
 * 代码生成前的整工程校验，结果写进 VS Code 问题面板。
 *
 * 与单文件的 HmlValidationService 互补：这里只查跨文件 / 引擎层面的问题，
 * 也就是会让生成的 C 编译或链接失败、但单文件看不出来的那几类。
 * 不阻塞生成——用户可能只想先看到代码，但问题面板会把原因列清楚。
 */
export class ProjectValidationReporter {
    private readonly _diagnostics: vscode.DiagnosticCollection;
    /** 每个工程根目录上一次写进去的文件，下一次先清掉，避免陈旧问题累积 */
    private readonly _filesByProject = new Map<string, vscode.Uri[]>();

    constructor() {
        this._diagnostics = vscode.languages.createDiagnosticCollection('honeygui-project');
    }

    /**
     * 校验工程并刷新问题面板。
     * @returns 发现的 error 数量（0 表示生成结果应当能编译）
     */
    public async validateAndReport(projectRoot: string): Promise<{ errors: number; warnings: number }> {
        const config = ProjectUtils.loadProjectConfig(projectRoot);
        const targetEngine: TargetEngine = config.targetEngine || 'honeygui';

        const designs: ProjectDesign[] = [];
        const hmlFiles = await new CodeGeneratorFiles().scan(projectRoot);
        for (const hmlFile of hmlFiles) {
            try {
                const controller = new HmlController();
                await controller.loadFile(hmlFile);
                designs.push({
                    file: path.relative(projectRoot, hmlFile).split(path.sep).join('/'),
                    designName: path.basename(hmlFile, '.hml'),
                    components: (controller.currentDocument?.view.components || []) as Component[],
                });
            } catch (error) {
                logger.warn(`[ProjectValidation] 跳过无法解析的 HML: ${hmlFile}: ${error}`);
            }
        }

        const result = validateProject(designs, {
            targetEngine,
            unsupportedTypes: COMPONENT_ENGINE_SUPPORT[targetEngine],
        });

        this._publish(projectRoot, result.issues);

        const errors = result.issues.filter(issue => issue.severity === 'error').length;
        const warnings = result.issues.length - errors;
        if (errors > 0 || warnings > 0) {
            logger.info(vscode.l10n.t('Project validation found {0} error(s) and {1} warning(s)', errors, warnings));
        }
        return { errors, warnings };
    }

    /** 清掉某个工程的诊断（例如工程关闭时） */
    public clear(projectRoot: string): void {
        const files = this._filesByProject.get(projectRoot);
        files?.forEach(uri => this._diagnostics.delete(uri));
        this._filesByProject.delete(projectRoot);
    }

    public dispose(): void {
        this._diagnostics.dispose();
    }

    private _publish(projectRoot: string, issues: ProjectIssue[]): void {
        this.clear(projectRoot);

        const byFile = new Map<string, vscode.Diagnostic[]>();
        for (const issue of issues) {
            const list = byFile.get(issue.file) || [];
            list.push(new vscode.Diagnostic(
                // 组件级问题定位不到具体行（HML 解析不保留行号），用整个文件范围，
                // 消息里带组件 id，问题面板仍可点击跳到对应文件
                new vscode.Range(0, 0, 0, 0),
                issue.componentId ? `[${issue.componentId}] ${issue.message}` : issue.message,
                issue.severity === 'error'
                    ? vscode.DiagnosticSeverity.Error
                    : vscode.DiagnosticSeverity.Warning,
            ));
            byFile.set(issue.file, list);
        }

        const uris: vscode.Uri[] = [];
        for (const [file, diagnostics] of byFile) {
            const uri = vscode.Uri.file(path.join(projectRoot, ...file.split('/')));
            this._diagnostics.set(uri, diagnostics);
            uris.push(uri);
        }
        this._filesByProject.set(projectRoot, uris);
    }
}

/** 扫描 ui/ 下所有 HML（与 CodeGenerator.scanHmlFiles 同规则） */
class CodeGeneratorFiles {
    public async scan(projectRoot: string): Promise<string[]> {
        const uiDir = ProjectUtils.getUiDir(projectRoot);
        const fs = await import('fs');
        const files: string[] = [];
        const walk = (dir: string) => {
            if (!fs.existsSync(dir)) {
                return;
            }
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(full);
                } else if (entry.isFile() && entry.name.endsWith('.hml')) {
                    files.push(full);
                }
            }
        };
        walk(uiDir);
        return files.sort();
    }
}
