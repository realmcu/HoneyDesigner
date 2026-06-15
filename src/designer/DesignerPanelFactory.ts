import * as vscode from 'vscode';
import * as path from 'path';
import { DesignerPanel } from './DesignerPanel';
import { logger } from '../utils/Logger';
import { ProjectUtils } from '../utils/ProjectUtils';

/**
 * Factory class for creating and managing DesignerPanel instances.
 */
export class DesignerPanelFactory {
    /**
     * Creates or shows the DesignerPanel.
     * @param context The extension context.
     * @param filePath The path to the HML file to load (optional).
     * @returns The DesignerPanel instance.
     */
    public static createOrShow(context: vscode.ExtensionContext, filePath?: string): DesignerPanel {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // Check if panel for this file already exists
        if (filePath) {
            const existingPanel = DesignerPanel.getPanel(filePath);
            if (existingPanel) {
                existingPanel.reveal(column);
                return existingPanel;
            }
        }

        // Fallback: if no filePath, check currentPanel for backward compatibility
        if (!filePath && DesignerPanel.currentPanel) {
            DesignerPanel.currentPanel.reveal(column);
            return DesignerPanel.currentPanel;
        }

        // Create a new panel
        const localRoots: vscode.Uri[] = [
            vscode.Uri.joinPath(context.extensionUri, 'src', 'designer', 'webview'),
            vscode.Uri.joinPath(context.extensionUri, 'out', 'designer', 'webview')
        ];

        logger.info(`[DesignerPanelFactory] Creating panel, filePath: ${filePath}`);

        let projectRoot: string | undefined;
        if (filePath) {
            projectRoot = ProjectUtils.findProjectRoot(filePath);
            if (projectRoot) {
                logger.info(`[DesignerPanelFactory] Found project root: ${projectRoot}`);
                localRoots.push(vscode.Uri.file(projectRoot));
            } else {
                // 如果没找到 project.json，使用文件所在目录的父目录
                const fileDir = path.dirname(filePath);
                const parentDir = path.dirname(fileDir);
                localRoots.push(vscode.Uri.file(parentDir));
                logger.info(`[DesignerPanelFactory] 未找到project.json，使用父目录: ${parentDir}`);
            }
        }

        const panel = vscode.window.createWebviewPanel(
            DesignerPanel.viewType,
            'HoneyGUI 设计器',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: localRoots
            }
        );

        const designerPanel = new DesignerPanel(panel, context);
        DesignerPanel.currentPanel = designerPanel;

        // 创建空白文档
        designerPanel.createNewDocument();

        return designerPanel;
    }
}
