import * as http from 'http';
import * as vscode from 'vscode';
import { HmlValidationService, ValidationResult } from './HmlValidationService';

/**
 * 端点配置接口
 */
interface EndpointConfig {
    endpoint: string;      // 如 "POST /api/new-project"
    method: string;        // 如 "POST" 或 "GET"
    command: string;       // 如 "honeygui.newProject"
    title: string;
    description: string;
    args?: string[];       // 参数说明
    needsUI?: boolean;     // 是否需要 UI 交互
}

/**
 * Extension HTTP API Service
 * 暴露 Extension 功能给外部工具（如 Claude Code）通过 HTTP 调用
 *
 * 设计原则：
 * - 每个功能一个独立的 HTTP 端点（一级命令）
 * - 内部统一复用 vscode.commands.executeCommand
 * - 保证功能对齐，零冗余
 * - 单一数据源：所有端点配置在 ENDPOINT_CONFIGS 中维护
 *
 * 如何添加新命令：
 * 1. 在 ENDPOINT_CONFIGS 数组中添加配置
 * 2. 在 handleRequest() 中添加路由匹配
 * 3. 实现对应的 handler 方法（调用 executeCommand）
 * 4. GET /api/commands 会自动包含新命令（无需手动更新）
 */
export class ExtensionApiService implements vscode.Disposable {
    private server: http.Server | undefined;
    private port: number = 38912;
    private context: vscode.ExtensionContext | undefined;
    private hmlValidator: HmlValidationService | undefined;

    /**
     * 端点配置（单一数据源）
     * 新增命令时只需在这里添加配置，handleRequest 和 handleListCommands 会自动同步
     */
    private readonly ENDPOINT_CONFIGS: EndpointConfig[] = [
        // 项目相关
        {
            endpoint: 'POST /api/new-project',
            method: 'POST',
            command: 'honeygui.newProject',
            title: 'Create New Project',
            description: 'Create a new HoneyGUI project',
            needsUI: true
        },
        {
            endpoint: 'POST /api/open-project',
            method: 'POST',
            command: 'honeygui.openProject',
            title: 'Open Project',
            description: 'Open an existing HoneyGUI project',
            needsUI: true
        },
        {
            endpoint: 'POST /api/create-hml',
            method: 'POST',
            command: 'honeygui.createNewHmlInWorkspace',
            title: 'Create New HML File',
            description: 'Create a new HML file in workspace',
            needsUI: false
        },
        // 设计器相关
        {
            endpoint: 'POST /api/open-designer',
            method: 'POST',
            command: 'honeygui.openInDesigner',
            title: 'Open in Designer',
            description: 'Open HML file in visual designer',
            args: ['filePath: string'],
            needsUI: false
        },
        {
            endpoint: 'POST /api/open-text-editor',
            method: 'POST',
            command: 'honeygui.openInTextEditor',
            title: 'Open in Text Editor',
            description: 'Open HML file in text editor',
            args: ['uri: vscode.Uri or string'],
            needsUI: false
        },
        // 代码生成
        {
            endpoint: 'POST /api/codegen',
            method: 'POST',
            command: 'honeygui.codegen',
            title: 'Generate Code',
            description: 'Generate C code from HML',
            needsUI: false
        },
        // 仿真相关
        {
            endpoint: 'POST /api/simulation/run',
            method: 'POST',
            command: 'honeygui.simulation',
            title: 'Run Simulation',
            description: 'Build and run simulation',
            needsUI: false
        },
        {
            endpoint: 'POST /api/simulation/debug',
            method: 'POST',
            command: 'honeygui.simulation.debug',
            title: 'Debug Simulation',
            description: 'Build and debug simulation',
            needsUI: false
        },
        {
            endpoint: 'POST /api/simulation/stop',
            method: 'POST',
            command: 'honeygui.simulation.stop',
            title: 'Stop Simulation',
            description: 'Stop running simulation',
            needsUI: false
        },
        // 工具
        {
            endpoint: 'POST /api/tools',
            method: 'POST',
            command: 'honeygui.tools',
            title: 'Resource Conversion Tools',
            description: 'Open resource conversion tools panel',
            needsUI: true
        },
        {
            endpoint: 'POST /api/map-tools',
            method: 'POST',
            command: 'honeygui.mapTools',
            title: 'Map Tools',
            description: 'Open map tools panel',
            needsUI: true
        },
        // 环境
        {
            endpoint: 'POST /api/environment/refresh',
            method: 'POST',
            command: 'honeygui.environment.refresh',
            title: 'Refresh Environment',
            description: 'Refresh build environment check',
            needsUI: false
        },
        // HML 验证
        {
            endpoint: 'POST /api/validate-hml',
            method: 'POST',
            command: '', // 不复用命令，直接调用服务
            title: 'Validate HML',
            description: 'Validate HML XML content (supports hmlContent or filePath)',
            args: ['hmlContent: string | filePath: string'],
            needsUI: false
        }
    ];

    /**
     * 启动 HTTP API Server
     */
    async start(context: vscode.ExtensionContext): Promise<void> {
        this.context = context;

        // 初始化 HML 验证服务
        try {
            this.hmlValidator = new HmlValidationService();
            console.log('[API] HmlValidationService initialized');
        } catch (error) {
            console.error('[API] Failed to initialize HmlValidationService:', error);
        }

        this.server = http.createServer(async (req, res) => {
            // 设置 CORS 头，允许跨域访问
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            // 处理 OPTIONS 预检请求
            if (req.method === 'OPTIONS') {
                res.statusCode = 200;
                res.end();
                return;
            }

            try {
                await this.handleRequest(req, res);
            } catch (error: any) {
                console.error('API Error:', error);
                res.statusCode = 500;
                res.end(JSON.stringify({
                    success: false,
                    error: {
                        code: 'INTERNAL_ERROR',
                        message: error.message || 'Internal server error',
                    }
                }));
            }
        });

        return new Promise<void>((resolve, reject) => {
            this.server!.listen(this.port, '127.0.0.1', () => {
                const message = `HoneyGUI Extension API Server started on http://localhost:${this.port}`;
                console.log(message);
                vscode.window.showInformationMessage(message);
                resolve();
            });

            this.server!.on('error', (error: any) => {
                if (error.code === 'EADDRINUSE') {
                    const message = `Port ${this.port} is already in use. Extension API Server failed to start.`;
                    console.error(message);
                    vscode.window.showErrorMessage(message);
                } else {
                    console.error('Server error:', error);
                    vscode.window.showErrorMessage(`Extension API Server error: ${error.message}`);
                }
                reject(error);
            });
        });
    }

    /**
     * 处理 HTTP 请求 - 路由分发
     */
    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const url = req.url || '';
        const method = req.method || 'GET';

        console.log(`[API] ${method} ${url}`);

        // 基础端点（仅启用这两个）
        if (method === 'GET' && url === '/health') {
            return this.handleHealth(req, res);
        }
        if (method === 'GET' && url === '/api/version') {
            return this.handleVersion(req, res);
        }

        // HML 验证
        if (method === 'POST' && url === '/api/validate-hml') {
            return this.handleValidateHml(req, res);
        }

        // 其他端点暂时禁用
        // if (method === 'GET' && url === '/api/commands') {
        //     return this.handleListCommands(req, res);
        // }

        // // 项目相关
        // if (method === 'POST' && url === '/api/new-project') {
        //     return this.handleNewProject(req, res);
        // }
        // if (method === 'POST' && url === '/api/open-project') {
        //     return this.handleOpenProject(req, res);
        // }
        // if (method === 'POST' && url === '/api/create-hml') {
        //     return this.handleCreateHml(req, res);
        // }

        // // 设计器相关
        // if (method === 'POST' && url === '/api/open-designer') {
        //     return this.handleOpenDesigner(req, res);
        // }
        // if (method === 'POST' && url === '/api/open-text-editor') {
        //     return this.handleOpenTextEditor(req, res);
        // }

        // // 代码生成
        // if (method === 'POST' && url === '/api/codegen') {
        //     return this.handleCodegen(req, res);
        // }

        // // 仿真相关
        // if (method === 'POST' && url === '/api/simulation/run') {
        //     return this.handleSimulationRun(req, res);
        // }
        // if (method === 'POST' && url === '/api/simulation/debug') {
        //     return this.handleSimulationDebug(req, res);
        // }
        // if (method === 'POST' && url === '/api/simulation/stop') {
        //     return this.handleSimulationStop(req, res);
        // }

        // // 工具
        // if (method === 'POST' && url === '/api/tools') {
        //     return this.handleTools(req, res);
        // }
        // if (method === 'POST' && url === '/api/map-tools') {
        //     return this.handleMapTools(req, res);
        // }

        // // 环境
        // if (method === 'POST' && url === '/api/environment/refresh') {
        //     return this.handleEnvironmentRefresh(req, res);
        // }

        // 404 Not Found
        res.statusCode = 404;
        res.end(JSON.stringify({
            success: false,
            error: {
                code: 'NOT_FOUND',
                message: `Endpoint ${method} ${url} not found`,
            }
        }));
    }

    // ==================== 基础端点 ====================

    /**
     * GET /health - 健康检查
     */
    private async handleHealth(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        res.statusCode = 200;
        res.end(JSON.stringify({
            status: 'ok',
            service: 'HoneyGUI Extension API',
            port: this.port,
            timestamp: new Date().toISOString()
        }));
    }

    /**
     * GET /api/version - 获取版本信息
     */
    private async handleVersion(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const extension = vscode.extensions.getExtension('honeygui-visual-designer.honeygui-visual-designer');
        const packageJson = extension?.packageJSON || {};

        res.statusCode = 200;
        res.end(JSON.stringify({
            success: true,
            data: {
                name: packageJson.displayName || 'HoneyGUI Visual Designer',
                version: packageJson.version || 'unknown',
                description: packageJson.description || '',
                vscodeEngine: packageJson.engines?.vscode || 'unknown',
                apiPort: this.port,
            }
        }));
    }

    /**
     * POST /api/validate-hml - 验证 HML XML 内容
     *
     * 支持两种方式：
     * 1. 传递 HML 内容: { "hmlContent": "<?xml version=\"1.0\"?>..." }
     * 2. 传递文件路径: { "filePath": "ui/main.hml" }
     *
     * 响应: { "valid": true/false, "errors": [...], "warnings": [...], "validationRules": [...] }
     */
    private async handleValidateHml(
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): Promise<void> {
        try {
            const body = await this.readBody(req);

            // 检查参数
            if (!('hmlContent' in body) && !('filePath' in body)) {
                res.statusCode = 400;
                res.end(JSON.stringify({
                    success: false,
                    error: {
                        code: 'INVALID_PARAMETER',
                        message: 'Missing required parameter: hmlContent (HML XML string) or filePath (HML file path)'
                    }
                }));
                return;
            }

            if (!this.hmlValidator) {
                res.statusCode = 500;
                res.end(JSON.stringify({
                    success: false,
                    error: {
                        code: 'SERVICE_UNAVAILABLE',
                        message: 'HML Validation Service is not initialized'
                    }
                }));
                return;
            }

            let hmlContent: string;

            // 方式 1: 从请求体中直接获取 HML 内容
            if ('hmlContent' in body) {
                hmlContent = body.hmlContent;
            }
            // 方式 2: 从文件路径读取 HML 内容
            else {
                const filePath = body.filePath;

                // 解析文件路径（支持相对路径和绝对路径）
                const fs = require('fs');
                const path = require('path');

                let absolutePath: string;

                // 如果是绝对路径，直接使用
                if (path.isAbsolute(filePath)) {
                    absolutePath = filePath;
                } else {
                    // 相对路径，相对于当前工作区
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (!workspaceFolders || workspaceFolders.length === 0) {
                        res.statusCode = 400;
                        res.end(JSON.stringify({
                            success: false,
                            error: {
                                code: 'NO_WORKSPACE',
                                message: 'No workspace folder is open. Please open a workspace or provide an absolute file path.'
                            }
                        }));
                        return;
                    }
                    absolutePath = path.join(workspaceFolders[0].uri.fsPath, filePath);
                }

                // 检查文件是否存在
                if (!fs.existsSync(absolutePath)) {
                    res.statusCode = 404;
                    res.end(JSON.stringify({
                        success: false,
                        error: {
                            code: 'FILE_NOT_FOUND',
                            message: `File not found: ${filePath}`
                        }
                    }));
                    return;
                }

                // 读取文件内容
                try {
                    hmlContent = fs.readFileSync(absolutePath, 'utf-8');
                } catch (readError: any) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({
                        success: false,
                        error: {
                            code: 'FILE_READ_ERROR',
                            message: `Failed to read file: ${readError.message}`
                        }
                    }));
                    return;
                }
            }

            // 验证 HML XML
            const result: ValidationResult = this.hmlValidator.validateHml(hmlContent);

            res.statusCode = 200;
            res.end(JSON.stringify({
                success: true,
                data: result
            }));

        } catch (error: any) {
            console.error('[API] Validation error:', error);
            res.statusCode = 500;
            res.end(JSON.stringify({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: error.message || 'Validation failed'
                }
            }));
        }
    }

    /**
     * GET /api/commands - 列出所有可用的命令和对应的 HTTP 端点
     * 自动从 ENDPOINT_CONFIGS 生成，无需手动维护
     */
    private async handleListCommands(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        res.statusCode = 200;
        res.end(JSON.stringify({
            success: true,
            data: {
                total: this.ENDPOINT_CONFIGS.length,
                commands: this.ENDPOINT_CONFIGS
            }
        }));
    }

    // ==================== 项目相关 ====================

    /**
     * POST /api/new-project - 创建新项目
     * 复用命令: honeygui.newProject
     */
    private async handleNewProject(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        await this.executeCommand('honeygui.newProject', res);
    }

    /**
     * POST /api/open-project - 打开项目
     * 复用命令: honeygui.openProject
     */
    private async handleOpenProject(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        await this.executeCommand('honeygui.openProject', res);
    }

    /**
     * POST /api/create-hml - 创建新 HML 文件
     * 复用命令: honeygui.createNewHmlInWorkspace
     */
    private async handleCreateHml(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        await this.executeCommand('honeygui.createNewHmlInWorkspace', res);
    }

    // ==================== 设计器相关 ====================

    /**
     * POST /api/open-designer - 在设计器中打开
     * 复用命令: honeygui.openInDesigner
     *
     * 请求体: { "filePath": "/path/to/file.hml" }
     */
    private async handleOpenDesigner(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const body = await this.readBody(req);
        const filePath = body.filePath;

        if (!filePath) {
            res.statusCode = 400;
            res.end(JSON.stringify({
                success: false,
                error: {
                    code: 'INVALID_PARAMETER',
                    message: 'Missing required parameter: filePath'
                }
            }));
            return;
        }

        await this.executeCommand('honeygui.openInDesigner', res, [filePath]);
    }

    /**
     * POST /api/open-text-editor - 在文本编辑器中打开
     * 复用命令: honeygui.openInTextEditor
     *
     * 请求体: { "filePath": "/path/to/file.hml" }
     */
    private async handleOpenTextEditor(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const body = await this.readBody(req);
        const filePath = body.filePath;

        if (!filePath) {
            res.statusCode = 400;
            res.end(JSON.stringify({
                success: false,
                error: {
                    code: 'INVALID_PARAMETER',
                    message: 'Missing required parameter: filePath'
                }
            }));
            return;
        }

        const uri = vscode.Uri.file(filePath);
        await this.executeCommand('honeygui.openInTextEditor', res, [uri]);
    }

    // ==================== 代码生成 ====================

    /**
     * POST /api/codegen - 生成 C 代码
     * 复用命令: honeygui.codegen
     */
    private async handleCodegen(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        await this.executeCommand('honeygui.codegen', res);
    }

    // ==================== 仿真相关 ====================

    /**
     * POST /api/simulation/run - 运行仿真
     * 复用命令: honeygui.simulation
     */
    private async handleSimulationRun(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        await this.executeCommand('honeygui.simulation', res);
    }

    /**
     * POST /api/simulation/debug - 调试仿真
     * 复用命令: honeygui.simulation.debug
     */
    private async handleSimulationDebug(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        await this.executeCommand('honeygui.simulation.debug', res);
    }

    /**
     * POST /api/simulation/stop - 停止仿真
     * 复用命令: honeygui.simulation.stop
     */
    private async handleSimulationStop(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        await this.executeCommand('honeygui.simulation.stop', res);
    }

    // ==================== 工具 ====================

    /**
     * POST /api/tools - 打开资源转换工具
     * 复用命令: honeygui.tools
     */
    private async handleTools(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        await this.executeCommand('honeygui.tools', res);
    }

    /**
     * POST /api/map-tools - 打开地图工具
     * 复用命令: honeygui.mapTools
     */
    private async handleMapTools(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        await this.executeCommand('honeygui.mapTools', res);
    }

    // ==================== 环境 ====================

    /**
     * POST /api/environment/refresh - 刷新环境检查
     * 复用命令: honeygui.environment.refresh
     */
    private async handleEnvironmentRefresh(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        await this.executeCommand('honeygui.environment.refresh', res);
    }

    // ==================== 通用方法 ====================

    /**
     * 执行 VSCode 命令（复用核心）
     * 所有端点最终都调用这个方法，保证复用和功能对齐
     */
    private async executeCommand(
        command: string,
        res: http.ServerResponse,
        args: any[] = []
    ): Promise<void> {
        try {
            console.log(`[API] Executing command: ${command}`, args.length > 0 ? args : '');

            // 复用 VSCode 命令实现
            const result = await vscode.commands.executeCommand(command, ...args);

            res.statusCode = 200;
            res.end(JSON.stringify({
                success: true,
                command: command,
                data: result
            }));

        } catch (error: any) {
            console.error(`[API] Command execution error:`, error);
            res.statusCode = 500;
            res.end(JSON.stringify({
                success: false,
                command: command,
                error: {
                    code: 'COMMAND_EXECUTION_ERROR',
                    message: error.message || 'Command execution failed'
                }
            }));
        }
    }

    /**
     * 读取请求体
     */
    private readBody(req: http.IncomingMessage): Promise<any> {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                try {
                    if (body.trim() === '') {
                        resolve({});
                    } else {
                        resolve(JSON.parse(body));
                    }
                } catch (error) {
                    reject(new Error('Invalid JSON in request body'));
                }
            });
            req.on('error', reject);
        });
    }

    /**
     * 释放资源
     */
    dispose(): void {
        if (this.server) {
            this.server.close(() => {
                console.log('Extension API Server stopped');
            });
            this.server = undefined;
        }
    }
}
