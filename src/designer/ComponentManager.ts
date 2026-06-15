import * as vscode from 'vscode';
import { logger } from '../utils/Logger';
import { HmlController } from '../hml/HmlController';
import { Component } from '../hml/types';

/**
 * 组件管理器 - 处理组件的增删改查操作
 */
export class ComponentManager {
    private readonly _panel: vscode.WebviewPanel;
    private readonly _hmlController: HmlController;

    constructor(panel: vscode.WebviewPanel, hmlController: HmlController) {
        this._panel = panel;
        this._hmlController = hmlController;
    }

    /**
     * 处理添加组件的请求
     * 注意：前端已经在 store 中添加了组件并随后发送 save 命令持久化，
     * 此处不再重复添加到 HML 模型（避免产生不同 ID 的重复组件）。
     */
    public handleAddComponent(_parentId: string, _componentData: Omit<Component, 'id' | 'children'>): void {
        // 前端的 addComponent → saveToFile 流程已经处理了持久化，
        // 这里不再操作 HML 模型，避免竞态条件导致的重复组件问题。
        logger.debug('[ComponentManager] handleAddComponent: 跳过（由 save 命令统一处理）');
    }

    /**
     * 处理更新组件的请求
     */
    public handleUpdateComponent(componentId: string, updates: any): void {
        try {
            const updatedComponent = this._hmlController.updateComponent(componentId, updates);

            if (updatedComponent) {
                // 通知Webview组件已更新成功
                this._panel.webview.postMessage({
                    command: 'componentUpdated',
                    component: updatedComponent,
                    success: true
                });
            } else {
                this._panel.webview.postMessage({
                    command: 'componentUpdated',
                    success: false,
                    error: '未找到组件'
                });
            }
        } catch (error) {
            logger.error(`更新组件失败: ${error}`);
            this._panel.webview.postMessage({
                command: 'componentUpdated',
                success: false,
                error: error instanceof Error ? error.message : '未知错误'
            });
        }
    }

    /**
     * 处理删除组件的请求
     */
    public handleDeleteComponent(componentId: string): void {
        try {
            const success = this._hmlController.deleteComponent(componentId);

            if (success) {
                // 通知Webview组件已删除成功
                this._panel.webview.postMessage({
                    command: 'componentDeleted',
                    componentId,
                    success: true
                });
            } else {
                this._panel.webview.postMessage({
                    command: 'componentDeleted',
                    success: false,
                    error: '未找到组件'
                });
            }
        } catch (error) {
            logger.error(`删除组件失败: ${error}`);
            this._panel.webview.postMessage({
                command: 'componentDeleted',
                success: false,
                error: error instanceof Error ? error.message : '未知错误'
            });
        }
    }

    /**
     * 更新组件的单个属性
     */
    public updateComponentProperty(componentId: string, propertyName: string, value: any): void {
        try {
            // 构建更新对象
            const updates: any = {
                data: {}
            };
            updates.data[propertyName] = value;

            const updatedComponent = this._hmlController.updateComponent(componentId, updates);

            if (updatedComponent) {
                // 通知Webview组件属性已更新
                this._panel.webview.postMessage({
                    command: 'componentPropertyUpdated',
                    componentId,
                    propertyName,
                    value,
                    component: updatedComponent,
                    success: true
                });
            } else {
                this._panel.webview.postMessage({
                    command: 'componentPropertyUpdated',
                    success: false,
                    error: '未找到组件'
                });
            }
        } catch (error) {
            logger.error(`更新组件属性失败: ${error}`);
            this._panel.webview.postMessage({
                command: 'componentPropertyUpdated',
                success: false,
                error: error instanceof Error ? error.message : '未知错误'
            });
        }
    }
}
