import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../utils/Logger';
import { HmlController } from '../hml/HmlController';
import { HmlContentComparator } from '../utils/HmlContentComparator';

/**
 * 保存事务状态
 */
interface SaveTransaction {
    id: number;
    startTime: number;
    filePath: string;
    contentSnapshot: string;
}

/**
 * 保存管理器 - 处理HML文件的保存逻辑
 * 将保存相关的职责从DesignerPanel中分离出来
 */
export class SaveManager {
    private _currentTransaction: SaveTransaction | null = null;
    private _hmlController: HmlController;
    private _saveOutputChannel: vscode.OutputChannel | null = null;

    constructor(hmlController: HmlController) {
        this._hmlController = hmlController;
    }

    /**
     * 开始新的保存事务
     */
    public beginTransaction(filePath: string, contentSnapshot: string): number {
        // 结束之前的任何未完成事务
        if (this._currentTransaction) {
            logger.warn(`结束未完成的保存事务: ${this._currentTransaction.id}`);
            this.endTransaction();
        }

        const transactionId = Date.now(); // 使用时间戳作为事务ID
        this._currentTransaction = {
            id: transactionId,
            startTime: Date.now(),
            filePath,
            contentSnapshot
        };

        logger.info(`[SaveManager] 开始保存事务 ID: ${transactionId}, 文件: ${path.basename(filePath)}`);
        return transactionId;
    }

    /**
     * 结束当前事务
     */
    public endTransaction(): void {
        if (this._currentTransaction) {
            const duration = Date.now() - this._currentTransaction.startTime;
            logger.info(`[SaveManager] 保存事务 ${this._currentTransaction.id} 完成，耗时: ${duration}ms`);
            this._currentTransaction = null;
        }
    }

    /**
     * 验证事务ID是否有效（是否匹配当前事务）
     */
    public validateTransaction(transactionId: number): boolean {
        const isValid = this._currentTransaction?.id === transactionId;
        if (!isValid) {
            logger.warn(`[SaveManager] 事务验证失败 - 提供ID: ${transactionId}, 当前ID: ${this._currentTransaction?.id ?? 'none'}`);
        }
        return isValid;
    }

    /**
     * 获取当前事务ID（0表示没有事务）
     */
    public getCurrentTransactionId(): number {
        return this._currentTransaction?.id ?? 0;
    }

    /**
     * 是否正在保存事务中
     */
    public isInTransaction(): boolean {
        return this._currentTransaction !== null;
    }

    /**
     * 获取或创建保存操作的OutputChannel（复用）
     */
    private getOrCreateSaveChannel(): vscode.OutputChannel {
        if (!this._saveOutputChannel) {
            this._saveOutputChannel = vscode.window.createOutputChannel('HoneyGUI Save');
        }
        return this._saveOutputChannel;
    }

    /**
     * 执行保存操作
     */
    public async executeSave(
        filePath: string,
        content: string,
        transactionId: number
    ): Promise<void> {
        try {
            // 验证事务
            if (!this.validateTransaction(transactionId)) {
                throw new Error(`无效的保存事务ID: ${transactionId}`);
            }

            logger.info(`[SaveManager] 执行保存: ${path.basename(filePath)}, 事务ID: ${transactionId}`);

            // 1. 验证HML内容（传目标路径：解析结果会被 saveDocument 序列化落盘，
            // 无 id 组件的 fallback id 必须带 basename 种子，避免无种子 id 永久写盘）
            try {
                this._hmlController.parseContent(content, filePath);
                logger.debug('[SaveManager] HML内容验证通过');
            } catch (parseError) {
                logger.error(`[SaveManager] HML内容验证失败: ${parseError}`);
                throw new Error(`HML内容格式错误: ${parseError instanceof Error ? parseError.message : '未知错误'}`);
            }

            // 2. 保存文档
            const startTime = Date.now();
            await this._hmlController.saveDocument(filePath);
            const duration = Date.now() - startTime;

            // 3. 更新VSCode文件系统缓存
            await vscode.workspace.fs.stat(vscode.Uri.file(filePath));

            // 4. 记录保存日志
            this.logSaveSuccess(filePath, duration, transactionId);

            // 5. 结束事务
            this.endTransaction();

            // 6. 通知用户
            vscode.window.showInformationMessage(vscode.l10n.t('Design saved to {0}', path.basename(filePath)));

        } catch (error) {
            logger.error(`[SaveManager] 保存失败: ${error}`);
            throw error;
        }
    }

    /**
     * 提示用户选择保存位置
     */
    public async promptSaveLocation(content: string, defaultFileName?: string): Promise<string | null> {
        const fileName = defaultFileName || 'design.hml';

        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(fileName),
            filters: {
                'HML Files': ['hml'],
                'All Files': ['*']
            },
            saveLabel: '保存HML文件'
        });

        if (saveUri) {
            // 确保文件扩展名为.hml
            let filePath = saveUri.fsPath;
            if (!filePath.endsWith('.hml')) {
                filePath += '.hml';
            }

            logger.info(`[SaveManager] 用户选择保存位置: ${filePath}`);
            return filePath;
        }

        return null;
    }

    /**
     * 智能对比磁盘内容和内存快照
     */
    public smartCompareContent(diskContent: string, snapshot: string): boolean {
        const comparison = HmlContentComparator.smartCompare(diskContent, snapshot);

        if (comparison.isEqual) {
            logger.debug('[SaveManager] 智能对比：内容与内存快照一致');
            return true;
        } else {
            logger.debug(`[SaveManager] 智能对比：内容有差异 - ${comparison.reason}`);
            return false;
        }
    }

    /**
     * 在独立的OutputChannel中记录保存成功日志
     */
    private logSaveSuccess(filePath: string, duration: number, transactionId: number): void {
        try {
            const channel = this.getOrCreateSaveChannel();
            const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

            channel.appendLine(`[${timestamp}] ======================================`);
            channel.appendLine(`[${timestamp}] 保存成功: ${path.basename(filePath)}`);
            channel.appendLine(`[${timestamp}] 完整路径: ${filePath}`);
            channel.appendLine(`[${timestamp}] 事务ID: ${transactionId}`);
            channel.appendLine(`[${timestamp}] 耗时: ${duration}ms`);
            channel.appendLine(`[${timestamp}] ======================================`);

            logger.debug(`[SaveManager] 保存详情已记录到 OutputChannel`);
        } catch (error) {
            logger.error(`[SaveManager] 记录保存日志失败: ${error}`);
        }
    }

    /**
     * 清理资源
     */
    public dispose(): void {
        if (this._currentTransaction) {
            logger.warn(`[SaveManager] 清理时存在未完成的保存事务: ${this._currentTransaction.id}`);
            this.endTransaction();
        }

        if (this._saveOutputChannel) {
            this._saveOutputChannel.dispose();
            this._saveOutputChannel = null;
        }
    }
}
