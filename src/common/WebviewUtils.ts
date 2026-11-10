import * as vscode from 'vscode';

/**
 * Webview工具类，提供共享的Webview相关功能
 */
export class WebviewUtils {
    /**
     * 生成随机nonce值，用于Webview的内容安全策略
     */
    public static generateNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        
        return text;
    }

    /**
     * 配置Webview的基础选项
     */
    public static getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
        return {
            // 允许加载本地资源
            enableScripts: true,
            localResourceRoots: [extensionUri],
            // 启用严格的内容安全策略
            enableForms: true
        };
    }

    /**
     * 创建安全的HTML内容，包含nonce和内容安全策略
     */
    public static createSafeHtml(webview: vscode.Webview, extensionUri: vscode.Uri, nonce: string, body: string): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
            <title>HoneyDesigner</title>
        </head>
        <body>
            ${body}
        </body>
        </html>`;
    }

    /**
     * 处理Webview消息错误
     */
    public static handleWebviewError(webview: vscode.Webview, message: string): void {
        webview.postMessage({
            command: 'error',
            text: message
        });
    }
}
