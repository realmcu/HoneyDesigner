import * as vscode from 'vscode';
import { logger } from './utils/Logger';
import { ExtensionManager } from './core/ExtensionManager';
import { ExtensionApiService } from './services/ExtensionApiService';

/**
 * HoneyGUI Visual Designer Extension Entry
 * Offline VSCode extension for HoneyGUI embedded GUI framework visual design
 */

let extensionManager: ExtensionManager | undefined;
let apiService: ExtensionApiService | undefined;

/**
 * Extension activation function
 * Called by VSCode when the extension is first loaded
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    try {
        logger.info(vscode.l10n.t('Extension activating'));
        
        // Create extension manager
        extensionManager = new ExtensionManager(context);
        
        // Initialize extension
        await extensionManager.initialize();

        // Start Extension HTTP API Service
        apiService = new ExtensionApiService();
        try {
            await apiService.start(context);
            context.subscriptions.push(apiService);
        } catch (error) {
            logger.error(`Failed to start Extension API Service: ${error}`);
            // API Service 启动失败不影响 Extension 主要功能，继续执行
        }

        // Check for pending new project activation
        const pendingActivation = context.globalState.get<{
            projectPath: string;
            projectName: string;
            timestamp: number;
        }>('pendingProjectActivation');
        
        if (pendingActivation) {
            // Clear the flag
            await context.globalState.update('pendingProjectActivation', undefined);
            
            // Check timestamp to avoid processing expired activation requests (valid within 5 minutes)
            if (Date.now() - pendingActivation.timestamp < 5 * 60 * 1000) {
                // Delay opening main HML file, wait for VSCode to fully load
                setTimeout(async () => {
                    try {
                        const { ProjectUtils } = await import('./utils/ProjectUtils');
                        const projectConfig = ProjectUtils.loadProjectConfig(pendingActivation.projectPath);
                        if (projectConfig.mainHmlFile) {
                            const mainHmlPath = vscode.Uri.file(
                                require('path').join(pendingActivation.projectPath, projectConfig.mainHmlFile)
                            );
                            await vscode.commands.executeCommand('honeygui.openInDesigner', mainHmlPath);
                        }

                        // 自动执行一次代码生成，确保新项目有初始代码
                        try {
                            const { CodeGenerationService } = await import('./services/CodeGenerationService');
                            const { CodeGenerator } = await import('./services/CodeGenerator');
                            const codeGenerator = new CodeGenerator();
                            await CodeGenerationService.generate(pendingActivation.projectPath, codeGenerator);
                            logger.info('新项目自动代码生成完成');
                        } catch (codegenErr) {
                            logger.warn(`新项目自动代码生成失败（不影响使用）: ${codegenErr}`);
                        }
                    } catch (err) {
                        logger.error(vscode.l10n.t('Failed to open main design file: {0}', String(err)));
                    }
                }, 1000);
            }
        }

        logger.info(vscode.l10n.t('Extension activated'));
        
    } catch (error) {
        logger.error(vscode.l10n.t('Activation failed: {0}', error instanceof Error ? error.message : String(error)));
        vscode.window.showErrorMessage(
            vscode.l10n.t('Activation failed: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error'))
        );
        throw error;
    }
}

/**
 * Extension deactivation function
 * Called by VSCode when the extension is deactivated
 */
export function deactivate(): void {
    logger.info(vscode.l10n.t('Extension deactivating'));

    if (apiService) {
        apiService.dispose();
        apiService = undefined;
    }

    if (extensionManager) {
        extensionManager.dispose();
        extensionManager = undefined;
    }

    logger.info(vscode.l10n.t('Extension deactivated'));
}
