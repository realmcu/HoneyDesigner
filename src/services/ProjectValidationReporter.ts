import * as path from 'path';
import * as vscode from 'vscode';
import type { ProjectIssue } from '../codegen/projectValidation';

/**
 * 代码生成前的整工程校验，结果写进 VS Code 问题面板。
 *
 * 与单文件的 HmlValidationService 互补：这里只查跨文件 / 引擎层面的问题，
 * 也就是会让生成的 C 编译或链接失败、但单文件看不出来的那几类。
 *
 * 全局单例：诊断集合 dispose 后问题面板里的条目会一起消失，所以不能按次创建。
 * 扩展停用时由 ExtensionManager 调 disposeShared()。
 */
export class ProjectValidationReporter {
    private static _shared: ProjectValidationReporter | undefined;

    private readonly _diagnostics: vscode.DiagnosticCollection;
    /** 每个工程根目录上一次写进去的文件，下一次先清掉，避免陈旧问题累积 */
    private readonly _filesByProject = new Map<string, vscode.Uri[]>();

    private constructor() {
        this._diagnostics = vscode.languages.createDiagnosticCollection('honeygui-project');
    }

    public static get shared(): ProjectValidationReporter {
        if (!this._shared) {
            this._shared = new ProjectValidationReporter();
        }
        return this._shared;
    }

    public static disposeShared(): void {
        this._shared?._diagnostics.dispose();
        this._shared = undefined;
    }

    /**
     * 把 CodeGenerator 已经算好的校验结果发布到问题面板。
     * 空列表也要调用：用来清掉上一次生成留下的问题。
     */
    public publish(projectRoot: string, issues: ProjectIssue[]): void {
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

    /** 清掉某个工程的诊断 */
    public clear(projectRoot: string): void {
        const files = this._filesByProject.get(projectRoot);
        files?.forEach(uri => this._diagnostics.delete(uri));
        this._filesByProject.delete(projectRoot);
    }
}
