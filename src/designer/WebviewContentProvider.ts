import * as vscode from 'vscode';
import * as fs from 'fs';
import { logger } from '../utils/Logger';
import { WebviewUtils } from '../common/WebviewUtils';

/**
 * Webview内容提供者 - 负责生成Webview的HTML内容
 */
export class WebviewContentProvider {
    private readonly _extensionUri: vscode.Uri;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
    }

    /**
     * 获取Webview的HTML内容
     */
    public getHtmlForWebview(webview: vscode.Webview): string {
        try {
            // 1. 首先尝试从构建目录加载
            const buildPath = vscode.Uri.joinPath(
                this._extensionUri,
                'out',
                'designer',
                'webview'
            );
            
            // 2. 同时准备源码目录作为备选
            const sourcePath = vscode.Uri.joinPath(
                this._extensionUri,
                'src',
                'designer',
                'webview'
            );
            
            // 3. 确定使用哪个路径
            let htmlPath: vscode.Uri;
            let onDiskPath: vscode.Uri;

            if (fs.existsSync(vscode.Uri.joinPath(buildPath, 'index.html').fsPath)) {
                onDiskPath = buildPath;
                htmlPath = vscode.Uri.joinPath(buildPath, 'index.html');
            } else if (fs.existsSync(vscode.Uri.joinPath(sourcePath, 'index.html').fsPath)) {
                onDiskPath = sourcePath;
                htmlPath = vscode.Uri.joinPath(sourcePath, 'index.html');
            } else {
                // 如果都不存在，使用内置的最小HTML模板
                logger.warn(`[HoneyGUI Designer] 未找到HTML文件，使用内置最小模板`);
                return this.getMinimalHtmlTemplate(webview);
            }

            // 读取HTML文件内容
            let htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf8');

            // 4. 查找并处理资源文件（JS和CSS）
            let stylesUri: vscode.Uri | undefined;
            let scriptUri: vscode.Uri | undefined;
            
            try {
                if (fs.existsSync(onDiskPath.fsPath)) {
                    const files = fs.readdirSync(onDiskPath.fsPath);
                    
                    // 尝试查找带哈希的文件或普通文件名
                    const jsFile = files.find(f => /^main\..+\.js$/.test(f)) || 
                                  files.find(f => f === 'webview.js') || 
                                  files.find(f => f.endsWith('.js'));
                    
                    const cssFile = files.find(f => /^main\..+\.css$/.test(f)) || 
                                   files.find(f => f === 'styles.css') || 
                                   files.find(f => f.endsWith('.css'));

                    if (jsFile) {
                        scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(onDiskPath, jsFile));
                    }
                    
                    if (cssFile) {
                        stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(onDiskPath, cssFile));
                    }
                }
            } catch (e) {
                logger.warn(`[HoneyGUI Designer] 无法读取资源文件列表: ${e}`);
            }

            // 5. 替换资源URL
            if (stylesUri) {
                // 删除所有CSS引用并添加正确的Webview URI
                htmlContent = htmlContent.replace(/<link href=".+\.css"[^>]*>/g, '');
                htmlContent = htmlContent.replace('</head>', `<link href="${stylesUri}" rel="stylesheet"></head>`);
            }
            
            if (scriptUri) {
                // 删除所有JS引用并添加正确的Webview URI
                htmlContent = htmlContent.replace(/<script src=".+\.js".*><\/script>/g, '');
                htmlContent = htmlContent.replace('</body>', `<script src="${scriptUri}"></script></body>`);
            }

            logger.debug(`[HoneyGUI Designer] Webview 初始化:`);
            logger.debug(`  使用路径: ${onDiskPath.toString()}`);
            if (stylesUri) logger.debug(`  Styles: ${stylesUri.toString()}`);
            if (scriptUri) logger.debug(`  Script: ${scriptUri.toString()}`);

            // 6. 添加CSP meta标签（严格的CSP策略）
            const nonce = this.getNonce();
            const cspMetaTag = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data: vscode-resource: vscode-webview-resource:; media-src ${webview.cspSource} vscode-resource: vscode-webview-resource:; script-src ${webview.cspSource} 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; connect-src ${webview.cspSource};">`;

            // 将 nonce 添加到所有 script 标签（包括性能埋点的内联脚本）
            htmlContent = htmlContent.replace(/<script(?![^>]*\bnonce=)([^>]*)>/g, `<script$1 nonce="${nonce}">`);

            // 确保CSP标签被添加，如果已经有则替换
            if (htmlContent.includes('<meta http-equiv="Content-Security-Policy"')) {
                htmlContent = htmlContent.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, cspMetaTag);
            } else {
                htmlContent = htmlContent.replace('</head>', `${cspMetaTag}</head>`);
            }

            return htmlContent;
        } catch (error) {
            logger.error(`[HoneyGUI Designer] 加载HTML内容时出错: ${error}`);
            
            // 无论发生什么错误，都返回最小可用的HTML模板
            return this.getMinimalHtmlTemplate(webview, error instanceof Error ? error.message : '未知错误');
        }
    }

    /**
     * 获取最小化的HTML模板，作为最后的回退方案
     */
    public getMinimalHtmlTemplate(webview: vscode.Webview, errorMessage?: string): string {
        const nonce = this.getNonce();
        const cspMetaTag = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">`;
        
        return `
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>HoneyGUI 设计器</title>
            ${cspMetaTag}
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    margin: 0;
                    padding: 20px;
                    background-color: #1e1e1e;
                    color: #d4d4d4;
                    min-height: 100vh;
                }
                .container {
                    max-width: 800px;
                    margin: 0 auto;
                    padding: 20px;
                    background-color: #252526;
                    border-radius: 8px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                }
                h1 {
                    color: #007acc;
                    margin-top: 0;
                }
                .message {
                    margin: 20px 0;
                    padding: 15px;
                    border-radius: 4px;
                    background-color: #1e1e1e;
                }
                .error {
                    border-left: 4px solid #f44336;
                    color: #f87474;
                }
                .info {
                    border-left: 4px solid #007acc;
                }
                button {
                    background-color: #007acc;
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                }
                button:hover {
                    background-color: #005a9e;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>HoneyGUI 设计器</h1>
                ${errorMessage ? 
                    `<div class="message error">
                        <strong>加载警告:</strong> ${errorMessage}<br>
                        <strong>解决方案:</strong> 请确保已正确构建项目。尝试运行: <code>npm run build</code>
                    </div>` : 
                    '<div class="message info">设计器基础界面已加载。部分高级功能可能不可用。</div>'
                }
                <div class="message">
                    <p>基础功能可用。您可以尝试:</p>
                    <ul>
                        <li>创建新的HML文档</li>
                        <li>保存设计内容</li>
                        <li>与VSCode扩展通信</li>
                    </ul>
                </div>
                <button onclick="sendMessage('save', {content: '<?xml version=\"1.0\" encoding=\"UTF-8\"?><hml><hg_view id=\"mainView\"></hg_view></hml>'});">测试保存</button>
            </div>
            
            <script nonce="${nonce}">
                // 基础的VSCode消息通信功能
                const vscode = acquireVsCodeApi();

                function sendMessage(command, data) {
                    vscode.postMessage({
                        command: command,
                        ...data
                    });
                }

                window.addEventListener('message', event => {
                    const message = event.data;
                    console.log("[Webview] VSCode message:", JSON.stringify(message));
                });
            </script>
        </body>
        </html>
        `;
    }

    /**
     * 生成随机nonce值
     */
    private getNonce(): string {
        return WebviewUtils.generateNonce();
    }
}