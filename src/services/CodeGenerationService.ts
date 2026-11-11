import * as vscode from 'vscode';
import { CodeGenerator } from './CodeGenerator';
import { ProjectUtils } from '../utils/ProjectUtils';
import { ProjectValidationReporter } from './ProjectValidationReporter';
import { logger } from '../utils/Logger';
import { takeDroppedProtectedAreas } from '../codegen/protectedAreaReport';
import type { ProjectIssue } from '../codegen/projectValidation';

export class CodeGenerationService {
    /**
     * 从文件路径生成代码
     */
    public static async generateFromFile(
        filePath: string | undefined,
        codeGenerator: CodeGenerator
    ): Promise<void> {
        if (!filePath) {
            vscode.window.showErrorMessage(vscode.l10n.t('Please open an HML file first'));
            return;
        }

        const projectRoot = ProjectUtils.findProjectRoot(filePath);
        if (!projectRoot) {
            vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
            return;
        }

        await this.generate(projectRoot, codeGenerator);
    }

    /**
     * 从项目根目录生成代码
     */
    public static async generate(
        projectRoot: string,
        codeGenerator: CodeGenerator
    ): Promise<void> {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: vscode.l10n.t('Code generation completed'),
                cancellable: false
            },
            async (progress) => {
                // 生成前清空缓冲，保证这里拿到的都是本次生成产生的
                takeDroppedProtectedAreas();

                const result = await codeGenerator.generate(projectRoot, (prog) => {
                    progress.report({
                        increment: 100 / prog.total,
                        message: `${prog.designName} (${prog.current}/${prog.total})...`
                    });
                });

                // 校验在 CodeGenerator 内部完成（三条生成路径共用），这里只负责展示。
                // Generate Code 不拦截：用户可能就是想先看到生成的代码
                const issues = result.validationIssues ?? [];
                ProjectValidationReporter.shared.publish(projectRoot, issues);
                this.notifyValidationErrors(projectRoot, issues);

                // 保护区代码丢失（组件改名或删掉了对应的回调）。以前只写日志，
                // 用户在界面上看不到，手写代码就静默消失了
                const dropped = takeDroppedProtectedAreas();
                if (dropped.length > 0) {
                    this.reportDroppedProtectedAreas(dropped);
                }

                if (result.success) {
                    vscode.window.showInformationMessage(
                        vscode.l10n.t('Code generated successfully, {0} files written', result.totalFiles)
                    );
                } else {
                    const errorMsg = result.errors.map(e => `${e.designName}: ${e.error}`).join('\n');
                    vscode.window.showWarningMessage(
                        vscode.l10n.t('Code generated with warnings: {0}', `${result.successCount}/${result.successCount + result.errors.length}`),
                        vscode.l10n.t('View Documentation')
                    ).then(selection => {
                        if (selection === vscode.l10n.t('View Documentation')) {
                            vscode.window.showErrorMessage(errorMsg, { modal: true });
                        }
                    });
                }

                // 检测并提示清理孤立文件
                if (result.orphanedDesigns && result.orphanedDesigns.length > 0) {
                    await this.promptOrphanCleanup(projectRoot, result.orphanedDesigns);
                }
            }
        );
    }

    /** 每个工程上一次提示过的错误集合；保存后自动生成也走这里，错误没变就不重复弹 */
    private static lastNotifiedErrors = new Map<string, string>();

    /**
     * 校验有 error 时弹提示，带跳转问题面板的按钮；只有 warning 时不打扰
     */
    private static notifyValidationErrors(projectRoot: string, issues: ProjectIssue[]): void {
        const errorIssues = issues.filter(issue => issue.severity === 'error');
        const errors = errorIssues.length;
        const signature = errorIssues.map(issue => `${issue.file}|${issue.message}`).join('\n');
        if (this.lastNotifiedErrors.get(projectRoot) === signature) {
            return;
        }
        this.lastNotifiedErrors.set(projectRoot, signature);
        if (errors === 0) {
            return;
        }
        logger.warn(vscode.l10n.t('Project validation found {0} error(s) and {1} warning(s)',
            errors, issues.length - errors));
        const showProblems = vscode.l10n.t('Show Problems');
        void vscode.window.showWarningMessage(
            vscode.l10n.t('Project validation found {0} error(s); generated C may not compile', errors),
            showProblems,
        ).then(selection => {
            if (selection === showProblems) {
                void vscode.commands.executeCommand('workbench.actions.view.problems');
            }
        });
    }

    /**
     * 保护区代码丢失：写进输出通道并提示用户。这类丢失不可恢复，必须让用户知道。
     */
    public static reportDroppedProtectedAreas(dropped: Array<{ id: string; file?: string }>): void {
        const unique = [...new Set(dropped.map(entry => entry.id))];
        logger.warn('[CodeGenerationService] 保护区代码丢失: ' + unique.join(', '));
        dropped.forEach(entry => {
            logger.warn(`[CodeGenerationService] 保护区 "${entry.id}"${entry.file ? ` (${entry.file})` : ''} 在生成结果中不存在，其中的手写代码已丢失`);
        });
        void vscode.window.showWarningMessage(
            vscode.l10n.t('Hand-written code for {0} was dropped because its component or event no longer exists: {1}',
                unique.length, unique.join(', ')),
        );
    }

    /**
     * 提示用户清理孤立的生成文件
     */
    public static async promptOrphanCleanup(projectRoot: string, orphanedDesigns: string[]): Promise<void> {
        const srcDir = ProjectUtils.getSrcDir(projectRoot);
        const nameList = orphanedDesigns.join(', ');

        const deleteAll = vscode.l10n.t('Delete All');
        const selectItems = vscode.l10n.t('Select Items');
        const ignore = vscode.l10n.t('Ignore');

        const choice = await vscode.window.showWarningMessage(
            vscode.l10n.t(
                'Detected orphaned generated files (HML deleted/renamed): {0}. Clean up?',
                nameList
            ),
            { modal: true },
            deleteAll,
            selectItems,
            ignore
        );

        if (choice === deleteAll) {
            const result = CodeGenerator.cleanOrphanedFiles(srcDir, orphanedDesigns);
            vscode.window.showInformationMessage(
                vscode.l10n.t('Cleaned {0} orphaned files', result.deleted.length)
            );
        } else if (choice === selectItems) {
            const items = orphanedDesigns.map(name => ({
                label: name,
                description: vscode.l10n.t('ui + callbacks + user (up to 9 files)'),
                picked: true
            }));

            const selected = await vscode.window.showQuickPick(items, {
                canPickMany: true,
                placeHolder: vscode.l10n.t('Select designs to clean up')
            });

            if (selected && selected.length > 0) {
                const selectedNames = selected.map(s => s.label);
                const result = CodeGenerator.cleanOrphanedFiles(srcDir, selectedNames);
                vscode.window.showInformationMessage(
                    vscode.l10n.t('Cleaned {0} orphaned files', result.deleted.length)
                );
            }
        }
        // ignore: do nothing
    }
}
