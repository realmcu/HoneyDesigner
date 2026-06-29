import * as vscode from 'vscode';
import { DEFAULT_ROMFS_BASE_ADDR } from '../common/ProjectConfig';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { TemplateManager } from '../template/TemplateManager';
import { ProjectTemplate } from '../template/ProjectTemplate';
import { HmlTemplateManager } from '../hml/HmlTemplateManager';
import { WebviewUtils } from '../common/WebviewUtils';
import { logger } from '../utils/Logger';
import { AVAILABLE_TEMPLATES } from '../template/TemplateConfig';
import { ProjectUtils } from '../utils/ProjectUtils';

/**
 * 项目创建面板管理类
 */
export class CreateProjectPanel {
    public static currentPanel: CreateProjectPanel | undefined;
    public static readonly viewType = 'honeyguiCreateProject';
    
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _context: vscode.ExtensionContext;
    private _disposables: vscode.Disposable[] = [];
    private readonly _templateManager: TemplateManager;

    /**
     * 创建或获取现有的项目创建面板
     */
    public static createOrShow(context: vscode.ExtensionContext): CreateProjectPanel {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // 如果已有面板，则显示并返回
        if (CreateProjectPanel.currentPanel) {
            CreateProjectPanel.currentPanel._panel.reveal(column);
            return CreateProjectPanel.currentPanel;
        }

        // 创建新面板
        const panel = vscode.window.createWebviewPanel(
            CreateProjectPanel.viewType,
            vscode.l10n.t('Create Project'),
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'src', 'designer'),
                    vscode.Uri.joinPath(context.extensionUri, 'out', 'designer')
                ]
            }
        );

        CreateProjectPanel.currentPanel = new CreateProjectPanel(panel, context);
        return CreateProjectPanel.currentPanel;
    }

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        this._panel = panel;
        this._extensionUri = context.extensionUri;
        this._context = context;
        this._templateManager = new TemplateManager(context);

        // 设置Webview内容
        this._update();

        // 处理面板关闭事件
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // 处理面板可见性变化
        this._panel.onDidChangeViewState(
            () => {
                if (this._panel.visible) {
                    this._update();
                }
            },
            null,
            this._disposables
        );

        // 处理来自Webview的消息
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'selectFolder':
                        await this._selectProjectFolder();
                        break;
                    case 'selectTemplateFolder':
                        await this._selectTemplateFolder();
                        break;
                    case 'getTemplates':
                        this._sendTemplates();
                        break;
                    case 'createProject':
                        await this._createProject(message.config);
                        break;
                    case 'createTemplateProject':
                        await this._createTemplateProject(message.config);
                        break;
                    case 'notify':
                        vscode.window.showInformationMessage(message.text);
                        break;
                    case 'error':
                        vscode.window.showErrorMessage(message.text);
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    /**
     * 更新Webview内容
     */
    private _update(): void {
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
    }

    /**
     * 获取Webview的HTML内容
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = this._getNonce();
        const homeDir = os.homedir();
        
        // 读取 HTML 模板
        const templatePath = path.join(this._extensionUri.fsPath, 'src', 'designer', 'templates', 'createProject.html');
        let html = fs.readFileSync(templatePath, 'utf8');
        
        // 准备国际化文本
        const i18n = {
            title: vscode.l10n.t('Create Project'),
            createProject: vscode.l10n.t('Create Project'),
            createEmptyProject: vscode.l10n.t('Create empty project'),
            createTemplateProject: vscode.l10n.t('Create template project'),
            projectName: vscode.l10n.t('Project name'),
            saveLocation: vscode.l10n.t('Save location'),
            appId: vscode.l10n.t('APP ID'),
            appIdHint: vscode.l10n.t('Unique app identifier in reverse-domain format (e.g. com.example.myapp). For identification only — does not affect compilation or runtime.'),
            resolution: vscode.l10n.t('Resolution'),
            custom: vscode.l10n.t('Custom...'),
            width: vscode.l10n.t('Width'),
            height: vscode.l10n.t('Height'),
            screenShape: vscode.l10n.t('Screen Shape'),
            rectangle: vscode.l10n.t('Rectangle (0)'),
            circle: vscode.l10n.t('Circle (-1)'),
            rounded20: vscode.l10n.t('Rounded 20px'),
            rounded40: vscode.l10n.t('Rounded 40px'),
            rounded60: vscode.l10n.t('Rounded 60px'),
            targetEngine: vscode.l10n.t('Target Engine'),
            aiAssets: vscode.l10n.t('Enable AI collaboration assets'),
            aiAssetsHint: vscode.l10n.t('Distribute HML-Spec.md and AI agent guides to the project root for vibe coding. Uncheck for pure drag-and-drop use.'),
            comingSoon: vscode.l10n.t('Coming Soon'),
            minimumSdk: vscode.l10n.t('Minimum SDK'),
            pixelMode: vscode.l10n.t('Pixel Mode'),
            romfsBaseAddr: vscode.l10n.t('Romfs Base Address (for embedded flash)'),
            create: vscode.l10n.t('Create'),
            selectTemplate: vscode.l10n.t('Select Template'),
            createFromTemplate: vscode.l10n.t('Create from Template'),
            invalidRomfsAddr: vscode.l10n.t('Invalid romfs base address. Please use hexadecimal format (e.g., {0})', DEFAULT_ROMFS_BASE_ADDR),
            invalidCustomResolution: vscode.l10n.t('Please enter valid width and height for custom resolution'),
            pleaseSelectTemplate: vscode.l10n.t('Please select a template')
        };
        
        // 替换模板变量
        html = html.replace(/\{\{nonce\}\}/g, nonce);
        html = html.replace(/\{\{cspSource\}\}/g, webview.cspSource);
        html = html.replace(/\{\{homeDir\}\}/g, homeDir);
        html = html.replace(/\{\{defaultRomfsAddr\}\}/g, DEFAULT_ROMFS_BASE_ADDR);
        
        // 替换国际化文本
        Object.entries(i18n).forEach(([key, value]) => {
            const placeholder = `{{i18n_${key}}}`;
            html = html.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
        });
        
        return html;
    }
        

    /**
     * 生成随机nonce值
     */
    // 使用WebviewUtils中的方法替代原有的_getNonce
    private _getNonce(): string {
        return WebviewUtils.generateNonce();
    }

    /**
     * 选择项目文件夹
     */
    private async _selectProjectFolder(): Promise<void> {
        try {
            const options: vscode.OpenDialogOptions = {
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: vscode.l10n.t('Select project location')
            };
            
            const result = await vscode.window.showOpenDialog(options);
            if (result && result.length > 0) {
                this._panel.webview.postMessage({
                    command: 'folderSelected',
                    folderPath: result[0].fsPath
                });
            }
        } catch (error) {
            logger.error(`选择文件夹失败: ${error}`);
            WebviewUtils.handleWebviewError(this._panel.webview, 'Failed to select folder');
        }
    }

    /**
     * 选择模板项目文件夹
     */
    private async _selectTemplateFolder(): Promise<void> {
        try {
            const options: vscode.OpenDialogOptions = {
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: vscode.l10n.t('Select project location')
            };
            
            const result = await vscode.window.showOpenDialog(options);
            if (result && result.length > 0) {
                this._panel.webview.postMessage({
                    command: 'templateFolderSelected',
                    folderPath: result[0].fsPath
                });
            }
        } catch (error) {
            logger.error(`选择文件夹失败: ${error}`);
            WebviewUtils.handleWebviewError(this._panel.webview, 'Failed to select folder');
        }
    }

    /**
     * 创建项目
            });

            // 使用 child_process 执行 git clone
            const { spawn } = await import('child_process');
            const gitProcess = spawn('git', ['clone', '--progress', url, targetPath]);

            gitProcess.stderr.on('data', (data: Buffer) => {
                const output = data.toString();
                // 解析 git clone 进度
                const match = output.match(/Receiving objects:\s+(\d+)%/);
                if (match) {
                    const percent = parseInt(match[1], 10);
                    this._panel.webview.postMessage({
                        command: 'cloneProgress',
                        percent: Math.min(90, 10 + percent * 0.8),
                        text: vscode.l10n.t('Cloning... {0}%', percent)
                    });
                }
            });

            gitProcess.on('close', (code: number) => {
                if (code === 0) {
                    this._panel.webview.postMessage({
                        command: 'cloneProgress',
                        percent: 100,
                        text: vscode.l10n.t('Clone completed!')
                    });
                    setTimeout(() => {
                        this._panel.webview.postMessage({
                            command: 'cloneComplete',
                            sdkPath: targetPath,
                            target: target
                        });
                    }, 500);
                    vscode.window.showInformationMessage(vscode.l10n.t('SDK cloned successfully: {0}', targetPath));
                } else {
                    this._panel.webview.postMessage({
                        command: 'cloneError',
                        text: vscode.l10n.t('Clone failed (exit code: {0})', code),
                        target: target
                    });
                }
            });

            gitProcess.on('error', (err: Error) => {
                logger.error(`克隆 SDK 失败: ${err.message}`);
                this._panel.webview.postMessage({
                    command: 'cloneError',
                    text: vscode.l10n.t('Clone failed: {0}\n\nPlease make sure Git is installed', err.message),
                    target: target
                });
            });

        } catch (error) {
            logger.error(`克隆 SDK 失败: ${error}`);
            this._panel.webview.postMessage({
                command: 'cloneError',
                text: `克隆失败: ${error instanceof Error ? error.message : '未知错误'}`,
                target: target
            });
        }
    }

    /**
     * 发送模板列表到 Webview（带国际化）
     */
    private _sendTemplates(): void {
        // 翻译模板描述
        const templatesWithI18n = AVAILABLE_TEMPLATES.map(template => ({
            ...template,
            description: vscode.l10n.t(template.descriptionKey)
        }));

        this._panel.webview.postMessage({
            command: 'templatesLoaded',
            templates: templatesWithI18n
        });
    }

    /**
     * 创建项目
     */
    private async _createProject(config: any): Promise<void> {
        try {
            const { projectName, saveLocation, appId, resolution, cornerRadius, targetEngine, aiAssets, minSdk, pixelMode, romfsBaseAddr } = config;

            // 记录日志用于调试
            logger.info(`[CreateProjectPanel] Creating project: projectName=${projectName}, saveLocation=${saveLocation}, appId=${appId}, targetEngine=${targetEngine}, romfsBaseAddr=${romfsBaseAddr}, cornerRadius=${cornerRadius}`);

            // 验证必填字段
            if (!projectName || !saveLocation || !appId) {
                logger.error('[CreateProjectPanel] Validation failed: Missing required fields');
                this._panel.webview.postMessage({
                    command: 'error',
                    text: vscode.l10n.t('Please fill in all required fields (Project Name, Save Location, APP ID)')
                });
                return;
            }

            // 验证项目名称格式（必须是合法的 C 变量名）
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(projectName)) {
                logger.error(`[CreateProjectPanel] Invalid project name: ${projectName}`);
                this._panel.webview.postMessage({
                    command: 'error',
                    text: vscode.l10n.t('Project name can only contain letters, numbers, underscores, and must start with a letter or underscore')
                });
                return;
            }

            const projectPath = path.join(saveLocation, projectName);
            logger.info(`[CreateProjectPanel] Full project path: ${projectPath}`);

            // 检查项目路径是否已存在（增强检测）
            try {
                if (fs.existsSync(projectPath)) {
                    const stats = fs.statSync(projectPath);
                    if (stats.isDirectory()) {
                        logger.error(`[CreateProjectPanel] Project directory already exists: ${projectPath}`);
                        this._panel.webview.postMessage({
                            command: 'error',
                            text: vscode.l10n.t('Project already exists: "{0}"\n\nDirectory "{1}" already exists.\n\nPlease choose another name or delete the existing project.', projectName, projectPath)
                        });
                        return;
                    } else {
                        logger.error(`[CreateProjectPanel] Path exists but is not a directory: ${projectPath}`);
                        this._panel.webview.postMessage({
                            command: 'error',
                            text: vscode.l10n.t('Cannot create project: "{0}" exists and is not a directory', projectPath)
                        });
                        return;
                    }
                }
            } catch (error) {
                logger.error(`[CreateProjectPanel] Error checking path existence: ${error}`);
                this._panel.webview.postMessage({
                    command: 'error',
                    text: vscode.l10n.t('Error checking project path: {0}', error instanceof Error ? error.message : vscode.l10n.t('Unknown error'))
                });
                return;
            }
            
            // 使用 withProgress 显示创建进度（完成后自动消失）
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: vscode.l10n.t('Creating project: {0}...', projectName),
                cancellable: false
            }, async () => {
                // 创建项目结构
                await this._createProjectStructure(projectPath, projectName, appId, resolution, cornerRadius, targetEngine || 'honeygui', aiAssets !== false, minSdk, pixelMode, romfsBaseAddr);
            });
            
            // 显示成功消息
            this._panel.webview.postMessage({
                command: 'notify',
                text: vscode.l10n.t('Project created successfully: {0}', projectPath)
            });
            
            // 在打开文件夹前，将项目信息保存到全局存储
            // 这样即使在扩展重新加载后，我们也能知道需要激活哪个项目
            await this._context.globalState.update('pendingProjectActivation', {
                projectPath: projectPath,
                projectName: projectName,
                timestamp: Date.now()
            });

            // 自动打开工作区文件
            const workspaceFile = path.join(projectPath, `${projectName}.code-workspace`);
            await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspaceFile), false);

            // 注意：代码执行到这里，扩展会被重新加载
            // 实际的激活逻辑将在 extension.ts 的 activate 函数中处理
            // 通过检查 globalState 中的 pendingProjectActivation
            
            // 关闭Webview
            this.dispose();
            
        } catch (error) {
            logger.error(`创建项目失败: ${error}`);
            this._panel.webview.postMessage({
                command: 'error',
                text: `Failed to create project: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
        }
    }

    /**
     * 创建项目结构
     */
    private async _createProjectStructure(
        projectPath: string,
        projectName: string,
        appId: string,
        resolution: string,
        cornerRadius: number,
        targetEngine: string,
        aiAssets: boolean,
        minSdk: string,
        pixelMode: string,
        romfsBaseAddr?: string
    ): Promise<void> {
        // 创建目录结构
        fs.mkdirSync(projectPath, { recursive: true });
        fs.mkdirSync(path.join(projectPath, 'ui'), { recursive: true });
        fs.mkdirSync(path.join(projectPath, 'src'), { recursive: true });
        fs.mkdirSync(path.join(projectPath, 'assets'), { recursive: true });

        // fallback/ 目录与默认字体由 ExtensionManager.setupAiAssets 在打开项目时统一分发
        // （受 project.json 的 aiAssets 开关控制，新建后 openFolder 会触发），此处不再重复。

        // 创建 conversion.json 资源转换配置文件
        const isZhCn = vscode.env.language.startsWith('zh');
        const conversionConfigContent = isZhCn ? `{
  "_comment": [
    "资源转换配置文件 - 用于配置图片、视频等资源的转换参数",
    "",
    "【图片默认值】",
    "  format: adaptive16 (自适应16位: 有透明度→ARGB8565, 无透明度→RGB565)",
    "  compression: none (不压缩)",
    "  可选格式: RGB565, RGB888, ARGB8565, ARGB8888, I8, adaptive16, adaptive24",
    "  可选压缩: none, rle, fastlz, yuv, adaptive",
    "",
    "【视频默认值】",
    "  format: MJPEG",
    "  quality: 5 (MJPEG/AVI范围1-31, 1为最高质量; H264范围0-51)",
    "  frameRate: 保持原始帧率",
    "  可选格式: MJPEG, AVI, H264",
    "",
    "【字体默认值】",
    "  输出格式: 位图字体 (.bin)",
    "",
    "【3D模型默认值】",
    "  输出格式: HoneyGUI 3D格式 (.bin)"
  ],
  "version": "1.0",
  "defaultSettings": {
    "format": "adaptive16",
    "compression": "none"
  },
  "items": {}
}` : `{
  "_comment": [
    "Asset conversion config file - Configure conversion parameters for images, videos, etc.",
    "",
    "[Image Defaults]",
    "  format: adaptive16 (Adaptive 16-bit: with alpha→ARGB8565, without alpha→RGB565)",
    "  compression: none",
    "  Available formats: RGB565, RGB888, ARGB8565, ARGB8888, I8, adaptive16, adaptive24",
    "  Available compressions: none, rle, fastlz, yuv, adaptive",
    "",
    "[Video Defaults]",
    "  format: MJPEG",
    "  quality: 5 (MJPEG/AVI range 1-31, 1 is best quality; H264 range 0-51)",
    "  frameRate: Keep original frame rate",
    "  Available formats: MJPEG, AVI, H264",
    "",
    "[Font Defaults]",
    "  Output format: Bitmap font (.bin)",
    "",
    "[3D Model Defaults]",
    "  Output format: HoneyGUI 3D format (.bin)"
  ],
  "version": "1.0",
  "defaultSettings": {
    "format": "adaptive16",
    "compression": "none"
  },
  "items": {}
}`;
        fs.writeFileSync(
            path.join(projectPath, 'assets', 'conversion.json'),
            conversionConfigContent,
            'utf8'
        );

        // 使用HmlTemplateManager生成文件内容
        // 创建 {ProjectName}Main.hml 文件（直接放在 ui/ 下）
        const hmlFileName = `${projectName}Main.hml`;
        const mainHmlContent = HmlTemplateManager.generateMainHml(
            projectName,
            resolution,
            appId,
            minSdk,
            pixelMode
        );
        fs.writeFileSync(path.join(projectPath, 'ui', hmlFileName), mainHmlContent, 'utf8');

        // 创建README文件
        const readmeContent = HmlTemplateManager.generateReadme(
            projectName,
            appId,
            resolution
        );
        fs.writeFileSync(path.join(projectPath, 'README.md'), readmeContent, 'utf8');

        // 创建 project.json 项目配置文件
        const projectConfig = {
            $schema: 'HoneyGUI',
            type: 'Designer',
            version: '1.0.0',
            name: projectName,
            appId: appId,
            resolution: resolution,
            cornerRadius: cornerRadius ?? 0,  // 屏幕形状：0=矩形, -1=圆形, >0=圆角半径
            targetEngine: targetEngine,
            aiAssets: aiAssets,
            minSdk: minSdk,
            pixelMode: pixelMode,
            mainHmlFile: `ui/${hmlFileName}`,
            romfsBaseAddr: romfsBaseAddr || DEFAULT_ROMFS_BASE_ADDR,
            created: new Date().toISOString()
        };

        fs.writeFileSync(
            path.join(projectPath, 'project.json'),
            JSON.stringify(projectConfig, null, 2),
            'utf8'
        );

        // 创建 VSCode 工作区文件
        const workspaceConfig = {
            folders: [
                { path: '.' }
            ],
            settings: {
                'files.associations': {
                    '*.hml': 'xml'
                }
            },
            extensions: {
                recommendations: [
                    'realmcu.honeygui-visual-designer'
                ]
            }
        };
        fs.writeFileSync(
            path.join(projectPath, `${projectName}.code-workspace`),
            JSON.stringify(workspaceConfig, null, 2),
            'utf8'
        );

        logger.info(`[CreateProjectPanel] Project created with target engine: ${targetEngine}, romfs base addr: ${projectConfig.romfsBaseAddr}`);
    }

    /**
     * 创建模板项目
     */
    private async _createTemplateProject(config: any): Promise<void> {
        try {
            const { templateId, projectName, saveLocation, appId, romfsBaseAddr } = config;

            logger.info(`[CreateProjectPanel] Creating template project: templateId=${templateId}, projectName=${projectName}`);

            // 验证必填字段
            if (!templateId || !projectName || !saveLocation || !appId) {
                logger.error('[CreateProjectPanel] Validation failed: Missing required fields');
                this._panel.webview.postMessage({
                    command: 'error',
                    text: vscode.l10n.t('Please fill in all required fields and select a template')
                });
                return;
            }

            // 验证项目名称格式（用于目录名）
            if (!/^[a-zA-Z0-9_-]+$/.test(projectName)) {
                logger.error(`[CreateProjectPanel] Invalid project name: ${projectName}`);
                this._panel.webview.postMessage({
                    command: 'error',
                    text: vscode.l10n.t('Project name can only contain letters, numbers, underscores, and hyphens')
                });
                return;
            }

            const projectPath = path.join(saveLocation, projectName);

            // 检查项目路径是否已存在
            if (fs.existsSync(projectPath)) {
                logger.error(`[CreateProjectPanel] Project directory already exists: ${projectPath}`);
                this._panel.webview.postMessage({
                    command: 'error',
                    text: vscode.l10n.t('Project already exists: "{0}"\n\nDirectory "{1}" already exists.\n\nPlease choose another name or delete the existing project.', projectName, projectPath)
                });
                return;
            }

            // 获取模板配置
            const templateConfig = AVAILABLE_TEMPLATES.find(t => t.id === templateId);
            if (!templateConfig) {
                throw new Error(`Template configuration not found: ${templateId}`);
            }

            // 直接从 Git 仓库克隆到项目目录
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: vscode.l10n.t('Cloning template: {0}...', templateConfig.name),
                cancellable: false
            }, async (progress) => {
                progress.report({ message: vscode.l10n.t('Cloning repository...') });
                
                const { spawn } = await import('child_process');
                
                await new Promise<void>((resolve, reject) => {
                    const gitProcess = spawn('git', ['clone', '--progress', templateConfig.repo, projectPath]);
                    
                    gitProcess.stderr.on('data', (data: Buffer) => {
                        const output = data.toString();
                        const match = output.match(/Receiving objects:\s+(\d+)%/);
                        if (match) {
                            const percent = parseInt(match[1], 10);
                            progress.report({ 
                                message: vscode.l10n.t('Cloning... {0}%', percent),
                                increment: 1
                            });
                        }
                    });
                    
                    gitProcess.on('close', (code: number) => {
                        if (code === 0) {
                            resolve();
                        } else {
                            reject(new Error(`Git clone failed with exit code: ${code}`));
                        }
                    });
                    
                    gitProcess.on('error', (err: Error) => {
                        reject(new Error(`Git clone failed: ${err.message}`));
                    });
                });
                
                // 删除 .git 目录
                progress.report({ message: vscode.l10n.t('Cleaning up...') });
                const gitDir = path.join(projectPath, '.git');
                if (fs.existsSync(gitDir)) {
                    fs.rmSync(gitDir, { recursive: true, force: true });
                }
                
                // 更新 project.json（只更新 appId 和 romfsBaseAddr，保持模板原有的 name）
                progress.report({ message: vscode.l10n.t('Updating configuration...') });
                const projectJsonPath = path.join(projectPath, 'project.json');
                if (fs.existsSync(projectJsonPath)) {
                    const projectConfig = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
                    projectConfig.appId = appId;
                    projectConfig.romfsBaseAddr = romfsBaseAddr || DEFAULT_ROMFS_BASE_ADDR;
                    // 确保必要的字段存在
                    if (!projectConfig.$schema) {
                        projectConfig.$schema = 'HoneyGUI';
                    }
                    if (!projectConfig.type) {
                        projectConfig.type = 'Designer';
                    }
                    fs.writeFileSync(projectJsonPath, JSON.stringify(projectConfig, null, 2), 'utf8');
                    logger.info(`[CreateProjectPanel] Updated project.json: appId=${appId}, romfsBaseAddr=${projectConfig.romfsBaseAddr}`);
                }
                
                // 创建 VSCode 工作区文件（使用用户填写的项目名称）
                const workspaceConfig = {
                    folders: [{ path: '.' }],
                    settings: {
                        'files.associations': { '*.hml': 'xml' }
                    },
                    extensions: {
                        recommendations: ['realmcu.honeygui-visual-designer']
                    }
                };
                fs.writeFileSync(
                    path.join(projectPath, `${projectName}.code-workspace`),
                    JSON.stringify(workspaceConfig, null, 2),
                    'utf8'
                );
            });

            // 显示成功消息
            this._panel.webview.postMessage({
                command: 'notify',
                text: vscode.l10n.t('Template project created successfully: {0}', projectPath)
            });

            // 保存待激活项目信息
            await this._context.globalState.update('pendingProjectActivation', {
                projectPath: projectPath,
                projectName: projectName,
                timestamp: Date.now()
            });

            // 自动打开工作区文件
            const workspaceFile = path.join(projectPath, `${projectName}.code-workspace`);
            await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspaceFile), false);

            // 关闭Webview
            this.dispose();

        } catch (error) {
            logger.error(`创建模板项目失败: ${error}`);
            this._panel.webview.postMessage({
                command: 'error',
                text: `Failed to create template project: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
        }
    }


    /**
     * 清理资源
     */
    public dispose(): void {
        CreateProjectPanel.currentPanel = undefined;
        
        // 清理Webview面板
        this._panel.dispose();
        
        // 清理所有一次性资源
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
