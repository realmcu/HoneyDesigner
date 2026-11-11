import * as vscode from 'vscode';
import { FileManager } from '../FileManager';
import { ProjectUtils } from '../../utils/ProjectUtils';

/**
 * MessageHandler 拆出的各功能处理器共用的面板上下文。
 * 每个设计器面板一份，项目根目录按当前文件实时解析（切换文件后会变）。
 */
export interface HandlerContext {
    readonly panel: vscode.WebviewPanel;
    readonly fileManager: FileManager;
    /** 获取项目根目录，找不到时返回 undefined */
    getProjectRoot(): string | undefined;
    /** 获取项目根目录，找不到时显示错误消息并返回 null */
    requireProjectRoot(): string | null;
}

export function createHandlerContext(panel: vscode.WebviewPanel, fileManager: FileManager): HandlerContext {
    const getProjectRoot = (): string | undefined =>
        fileManager.currentFilePath
            ? ProjectUtils.findProjectRoot(fileManager.currentFilePath)
            : undefined;
    return {
        panel,
        fileManager,
        getProjectRoot,
        requireProjectRoot: () => {
            const root = getProjectRoot();
            if (!root) {
                vscode.window.showErrorMessage(vscode.l10n.t('Cannot find project root (project.json)'));
                return null;
            }
            return root;
        },
    };
}
