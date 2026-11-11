import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../../utils/Logger';
import { ProjectUtils } from '../../utils/ProjectUtils';
import { CodeGenerator } from '../../services/CodeGenerator';
import { CodeGenerationService } from '../../services/CodeGenerationService';
import { HandlerContext } from './HandlerContext';

/**
 * 代码生成相关消息：手动 / 保存后自动生成（合并并发请求）、跳转槽函数、
 * 读取用户 *_user.h 中可绑定的函数列表。
 */
export class CodeGenHandler {
    private _autoCodeGenTimer: NodeJS.Timeout | null = null;
    private _isCodeGenerating: boolean = false;
    private _hasPendingCodeGeneration: boolean = false;
    private _userFuncWatcher: vscode.FileSystemWatcher | undefined;

    constructor(
        private readonly _ctx: HandlerContext,
        private readonly _codeGenerator: CodeGenerator
    ) {}
    /**
     * 生成代码
     */
    public async handleGenerateCode(): Promise<void> {
        if (this._isCodeGenerating) {
            this._hasPendingCodeGeneration = true;
            logger.info('[MessageHandler] 代码生成正在进行，已合并为待处理任务');
            return;
        }

        this._isCodeGenerating = true;
        try {
            do {
                this._hasPendingCodeGeneration = false;
                await CodeGenerationService.generateFromFile(this._ctx.fileManager.currentFilePath, this._codeGenerator);
            } while (this._hasPendingCodeGeneration);
        } finally {
            this._isCodeGenerating = false;
            // 通知前端操作完成
            this._ctx.panel.webview.postMessage({ command: 'operationComplete', operation: 'codegen' });
        }
    }

    /**
     * 调度自动代码生成（带防抖）
     * 保存HML后2秒自动生成代码，如果2秒内再次保存则重置计时器
     */
    public scheduleAutoCodeGeneration(): void {
        // 清除之前的计时器
        if (this._autoCodeGenTimer) {
            clearTimeout(this._autoCodeGenTimer);
        }

        // 设置新的计时器
        this._autoCodeGenTimer = setTimeout(() => {
            logger.info('[MessageHandler] 自动触发代码生成');
            this.handleGenerateCode().catch(err => {
                logger.error(`[MessageHandler] 自动代码生成失败: ${err}`);
            });
        }, 2000); // 2秒延迟
    }

    /**
     * 处理跳转到槽函数
     */
    public async handleGotoSlot(componentId: string, componentName: string): Promise<void> {
        try {
            const currentFile = this._ctx.fileManager.currentFilePath;
            if (!currentFile) {
                vscode.window.showErrorMessage(vscode.l10n.t('Current HML file not found'));
                return;
            }

            // 获取项目根目录
            const projectRoot = ProjectUtils.findProjectRoot(currentFile);
            if (!projectRoot) {
                vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
                return;
            }

            // 获取设计稿名称（从HML文件名提取，不含扩展名）
            const designName = path.basename(currentFile, '.hml');

            // 构建回调文件路径
            const callbackFile = path.join(projectRoot, 'src', 'callbacks', `${designName}_callbacks.c`);

            // 检查文件是否存在，如果不存在则先生成代码
            if (!fs.existsSync(callbackFile)) {
                const result = await vscode.window.showInformationMessage(
                    vscode.l10n.t('The callback file already exists. Do you want to overwrite it?'),
                    vscode.l10n.t('Overwrite'), vscode.l10n.t('Cancel')
                );

                if (result === vscode.l10n.t('Overwrite')) {
                    await this.handleGenerateCode();
                    // 等待一下确保文件生成完成
                    await new Promise(resolve => setTimeout(resolve, 500));
                } else {
                    return;
                }
            }

            // 打开文件
            const document = await vscode.workspace.openTextDocument(callbackFile);
            const editor = await vscode.window.showTextDocument(document);

            // 查找槽函数位置
            const text = document.getText();
            const functionName = `on_${componentName}_click`;
            const regex = new RegExp(`void\\s+${functionName}\\s*\\(`, 'i');
            const match = regex.exec(text);

            if (match) {
                const position = document.positionAt(match.index);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            } else {
                vscode.window.showWarningMessage(vscode.l10n.t('Function {0} not found, please check if code generation is correct', functionName));
            }

        } catch (error) {
            logger.error(`[MessageHandler] 跳转到槽函数失败: ${error}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Jump failed: {0}', String(error)));
        }
    }

    /**
     * 处理获取用户自定义函数列表
     * 解析 src/user/**_user.h 文件，提取函数声明
     */
    public handleGetUserFunctions(): void {
        try {
            const currentFile = this._ctx.fileManager.currentFilePath;
            if (!currentFile) {
                logger.warn('[MessageHandler] 无法获取用户函数：当前文件路径为空');
                this._ctx.panel.webview.postMessage({
                    command: 'userFunctionsLoaded',
                    functions: []
                });
                return;
            }

            const projectRoot = ProjectUtils.findProjectRoot(currentFile);
            if (!projectRoot) {
                logger.warn('[MessageHandler] 无法获取用户函数：未找到项目根目录');
                this._ctx.panel.webview.postMessage({
                    command: 'userFunctionsLoaded',
                    functions: []
                });
                return;
            }

            // 获取设计稿名称（从HML文件名提取，不含扩展名）
            const designName = path.basename(currentFile, '.hml');

            // 构建 user.h 文件路径
            const userHeaderPath = path.join(projectRoot, 'src', 'user', `${designName}_user.h`);

            if (!fs.existsSync(userHeaderPath)) {
                logger.info(`[MessageHandler] user.h 文件不存在: ${userHeaderPath}`);
                this._ctx.panel.webview.postMessage({
                    command: 'userFunctionsLoaded',
                    functions: []
                });
                return;
            }

            // 读取文件内容
            const rawContent = fs.readFileSync(userHeaderPath, 'utf-8');

            // Strip C/C++ comments before parsing to avoid matching commented-out declarations
            const content = rawContent
                .replace(/\/\/.*$/gm, '')       // remove single-line comments
                .replace(/\/\*[\s\S]*?\*\//g, ''); // remove multi-line comments

            // 解析函数声明
            // 匹配模式：void function_name(void *obj, gui_event_t *e)
            //           void function_name(gui_obj_t *obj, const char *topic, void *data, uint16_t len)
            //           void function_name(gui_obj_t *obj, void *param)  <- note_design
            const eventFuncPattern = /void\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*void\s*\*\s*obj\s*,\s*gui_event_t\s*\*\s*e\s*\)/g;
            const msgFuncPattern = /void\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*gui_obj_t\s*\*\s*obj\s*,\s*const\s+char\s*\*\s*topic\s*,\s*void\s*\*\s*data\s*,\s*uint16_t\s+len\s*\)/g;
            const noteDesignFuncPattern = /void\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*gui_obj_t\s*\*\s*obj\s*,\s*void\s*\*\s*param\s*\)/g;
            const viewFuncPattern = /void\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*gui_view_t\s*\*\s*\w+\s*\)/g;

            const functions: Array<{ name: string; type: 'event' | 'message' | 'noteDesign' | 'view' }> = [];

            // 提取事件函数
            let match;
            while ((match = eventFuncPattern.exec(content)) !== null) {
                functions.push({ name: match[1], type: 'event' });
            }

            // 提取消息函数
            while ((match = msgFuncPattern.exec(content)) !== null) {
                functions.push({ name: match[1], type: 'message' });
            }

            // 提取 note_design 函数
            while ((match = noteDesignFuncPattern.exec(content)) !== null) {
                // 避免与 event/message 函数重复
                if (!functions.some(f => f.name === match![1])) {
                    functions.push({ name: match[1], type: 'noteDesign' });
                }
            }

            // 提取 view 生命周期函数 void func(gui_view_t *view)
            while ((match = viewFuncPattern.exec(content)) !== null) {
                if (!functions.some(f => f.name === match![1])) {
                    functions.push({ name: match[1], type: 'view' });
                }
            }

            logger.info(`[MessageHandler] 找到 ${functions.length} 个用户自定义函数`);

            // 发送到前端
            this._ctx.panel.webview.postMessage({
                command: 'userFunctionsLoaded',
                functions
            });

            // Watch _user.h for changes and auto-refresh function list
            if (this._userFuncWatcher) {
                this._userFuncWatcher.dispose();
            }
            const watchPattern = new vscode.RelativePattern(
                vscode.Uri.file(path.dirname(userHeaderPath)),
                path.basename(userHeaderPath)
            );
            this._userFuncWatcher = vscode.workspace.createFileSystemWatcher(watchPattern);
            const refreshFunctions = () => this.handleGetUserFunctions();
            this._userFuncWatcher.onDidChange(refreshFunctions);
            this._userFuncWatcher.onDidCreate(refreshFunctions);
            this._userFuncWatcher.onDidDelete(() => {
                this._ctx.panel.webview.postMessage({
                    command: 'userFunctionsLoaded',
                    functions: []
                });
            });

        } catch (error) {
            logger.error(`[MessageHandler] 获取用户函数失败: ${error}`);
            this._ctx.panel.webview.postMessage({
                command: 'userFunctionsLoaded',
                functions: [],
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    dispose(): void {
        if (this._autoCodeGenTimer) {
            clearTimeout(this._autoCodeGenTimer);
            this._autoCodeGenTimer = null;
        }
        if (this._userFuncWatcher) {
            this._userFuncWatcher.dispose();
            this._userFuncWatcher = undefined;
        }
    }
}
