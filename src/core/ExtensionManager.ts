import * as vscode from 'vscode';
import { logger } from '../utils/Logger';
import { CommandManager } from './CommandManager';
import { HmlEditorProvider } from '../hml/HmlEditorProvider';
import { EnvironmentViewProvider } from '../ui/EnvironmentViewProvider';
import { StatusBarManager } from '../ui/StatusBarManager';
import * as path from 'path';
import * as fs from 'fs';

/**
 * HoneyGUI扩展管理器
 * 负责扩展的初始化、配置和生命周期管理
 */
export class ExtensionManager {
    private commandManager: CommandManager;
    private hmlEditorProvider: HmlEditorProvider;
    private disposables: vscode.Disposable[] = [];

    constructor(private context: vscode.ExtensionContext) {
        this.commandManager = new CommandManager(context);
        this.hmlEditorProvider = new HmlEditorProvider(context);
    }

    /**
     * 初始化扩展
     */
    async initialize(): Promise<void> {
        logger.info('HoneyGUI扩展初始化开始...');

        // 优先注册命令（确保基本功能可用）
        try {
            this.commandManager.registerCommands();
        } catch (error) {
            logger.error(`命令注册失败: ${error instanceof Error ? error.message : String(error)}`);
        }

        // 注册视图提供者（确保侧边栏视图可用）
        try {
            this.registerViewProviders();
        } catch (error) {
            logger.error(`视图提供者注册失败: ${error instanceof Error ? error.message : String(error)}`);
        }

        // 初始化状态栏管理器
        try {
            StatusBarManager.getInstance(this.context);
        } catch (error) {
            logger.error(`状态栏管理器初始化失败: ${error instanceof Error ? error.message : String(error)}`);
        }

        try {
            // 注册编译仿真服务
            const simulationServiceModule = await import('../simulation/SimulationService');
            const SimulationService = simulationServiceModule.SimulationService;
            const simulationService = new SimulationService(this.context);
            simulationService.registerCommands();
            this.disposables.push(simulationService);

            // 注册 UART 下载服务
            const uartServiceModule = await import('../services/UartDownloadService');
            const UartDownloadService = uartServiceModule.UartDownloadService;
            const uartService = new UartDownloadService(this.context);
            uartService.registerCommands();
            this.disposables.push(uartService);

            // 注册HML编辑器提供者
            this.registerHmlEditorProvider();

            // 注册文件关联
            this.registerFileAssociations();

            // 检查环境
            await this.checkEnvironment();

            logger.info('HoneyGUI扩展初始化完成');
            
            // 显示欢迎信息（仅在首次激活时）
            this.showWelcomeMessage();

        } catch (error) {
            logger.error(`扩展初始化失败: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * 注册HML编辑器提供者
     */
    private registerHmlEditorProvider(): void {
        const providerRegistration = vscode.window.registerCustomEditorProvider(
            'honeygui.hmlEditor',  // 修正为与package.json一致的viewType
            this.hmlEditorProvider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                },
                supportsMultipleEditorsPerDocument: false
            }
        );

        this.disposables.push(providerRegistration);
        this.context.subscriptions.push(providerRegistration);
        logger.info('HML编辑器提供者注册完成，viewType: honeygui.hmlEditor');
    }

    /**
     * 注册文件关联
     */
    private registerFileAssociations(): void {
        // HML文件的语言支持已在package.json中配置
        logger.info('文件关联注册完成');
    }

    /**
     * 检查环境
     */
    private async checkEnvironment(): Promise<void> {
        try {
            // 检查工作区
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                logger.warn('没有打开的工作区');
                return;
            }

            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            logger.info(`工作区根目录: ${workspaceRoot}`);

            // 检查项目配置
            const projectConfigPath = path.join(workspaceRoot, 'project.json');
            if (fs.existsSync(projectConfigPath)) {
                const config = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
                logger.info(`检测到项目配置: ${config.name || '未命名项目'}`);

                // 分发 AI 协作资产（HML-Spec.md / skill / AGENTS.md / CLAUDE.md）
                const targetEngine = config.targetEngine === 'lvgl' ? 'lvgl' : 'honeygui';
                this.setupAiAssets(workspaceRoot, targetEngine);
            } else {
                logger.info('未检测到项目配置文件');
            }

        } catch (error) {
            logger.warn(`环境检查失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 分发 AI 协作资产到项目根目录，供任意 AI agent（vibe coding）生成 HML 时参考：
     *   ① HML-Spec.md            —— 规范副本（顶部注入当前引擎说明）
     *   ② .claude/skills/...     —— HoneyGUI Designer skill（Claude 生态自动加载）
     *   ③ AGENTS.md              —— 通用 agent 协作约定（不存在才写）
     *   ④ CLAUDE.md              —— 引用 AGENTS.md（不存在则写，存在则补引用）
     * 各步骤独立 try，单步失败不影响其余分发。
     */
    private setupAiAssets(projectRoot: string, targetEngine: 'honeygui' | 'lvgl'): void {
        this.copyHmlSpecToProject(projectRoot, targetEngine);
        this.copySkillToProject(projectRoot);
        this.writeAgentsMd(projectRoot, targetEngine);
        this.writeOrUpdateClaudeMd(projectRoot);
    }

    /**
     * 将插件内置的 HML-Spec.md 拷贝到项目根目录，并在顶部注入当前引擎说明
     * （按 §5 计划：过滤视图先用"全量 + 引擎头注释"，组件矩阵已含引擎标注，agent 据此过滤）
     */
    private copyHmlSpecToProject(projectRoot: string, targetEngine: 'honeygui' | 'lvgl'): void {
        try {
            const srcSpec = path.join(this.context.extensionPath, 'vibe-designer', 'skills', 'honeygui-designer', 'references', 'hml-spec.md');
            const destSpec = path.join(projectRoot, 'HML-Spec.md');

            if (!fs.existsSync(srcSpec)) {
                logger.warn(`HML-Spec.md 不存在: ${srcSpec}`);
                return;
            }

            const header =
                `<!--\n` +
                `  本文件由 HoneyGUI Visual Designer 自动分发，请勿手动编辑（每次打开项目会按需覆盖）。\n` +
                `  当前项目 targetEngine = ${targetEngine}。\n` +
                `  生成 HML 时：仅使用下方组件矩阵中标注 ${targetEngine} 为 ready(✓) 的组件；\n` +
                `  标注 planned / unsupported 的组件在本引擎不可用，一律勿用。\n` +
                `-->\n\n`;
            const specContent = fs.readFileSync(srcSpec, 'utf8');
            const expected = header + specContent;

            // 按内容（含引擎头）比对，不同才重写：既覆盖 spec 内容更新，也覆盖 targetEngine 切换。
            // 不能用 mtime——首次写出后目标恒新于源，会永久漏掉引擎切换导致引擎头陈旧。
            if (fs.existsSync(destSpec) && fs.readFileSync(destSpec, 'utf8') === expected) {
                return;
            }
            fs.writeFileSync(destSpec, expected, 'utf8');
            logger.info(`HML-Spec.md 已分发到项目（engine=${targetEngine}）: ${destSpec}`);
        } catch (error) {
            logger.warn(`分发 HML-Spec.md 失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 将插件内置的 honeygui-designer skill 整目录拷贝到项目的 .claude/skills/ 下
     * （Claude Code 等生态会自动加载）。逐文件 mtime 较新才覆盖。
     */
    private copySkillToProject(projectRoot: string): void {
        try {
            const srcSkill = path.join(
                this.context.extensionPath,
                'vibe-designer', 'skills', 'honeygui-designer'
            );
            const destSkill = path.join(projectRoot, '.claude', 'skills', 'honeygui-designer');

            if (!fs.existsSync(srcSkill)) {
                logger.warn(`skill 目录不存在: ${srcSkill}`);
                return;
            }

            // 排除 references/hml-spec.md：规范由 copyHmlSpecToProject 带引擎头单独分发到项目根，
            // skill 副本里不再保留无引擎头的重复版（避免两份不一致）。
            this.copyDirWithMtime(srcSkill, destSkill, (rel) => rel === 'references/hml-spec.md');
            logger.info(`honeygui-designer skill 已分发到项目: ${destSkill}`);
        } catch (error) {
            logger.warn(`分发 skill 失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 将 srcDir 镜像到 destDir：逐文件按 mtime 增量覆盖（源更新或目标缺失才写），
     * 并剪除目标端在源中已不存在（或被 skip 显式排除）的条目，保持目标为有效源的精确镜像
     * ——否则 skill 升级时被删除/改名的旧文件（如废弃的 components.md / hml-syntax.md）
     * 会残留，让 agent 读到过期错误规范。
     *
     * @param skip 接收相对 srcDir 的路径（以 '/' 分隔），返回 true 则该条目既不拷贝、
     *             目标端同名条目也会被剪除。用于排除由专门通道分发的文件（如 hml-spec.md）。
     */
    private copyDirWithMtime(
        srcDir: string,
        destDir: string,
        skip?: (relPath: string) => boolean,
        baseRel: string = ''
    ): void {
        fs.mkdirSync(destDir, { recursive: true });

        const relOf = (name: string) => (baseRel ? `${baseRel}/${name}` : name);
        const srcEntries = fs.readdirSync(srcDir, { withFileTypes: true });
        // 有效源条目：排除调用方显式跳过的（如 references/hml-spec.md
        // ——它由 copyHmlSpecToProject 专门带引擎头分发到项目根，skill 副本里不再保留无头重复版）
        const keptEntries = srcEntries.filter(e => !(skip && skip(relOf(e.name))));
        const keptNames = new Set(keptEntries.map(e => e.name));

        // 先剪除目标端多余条目（源已移除或被排除），保持目标为有效源的精确镜像
        for (const destEntry of fs.readdirSync(destDir, { withFileTypes: true })) {
            if (!keptNames.has(destEntry.name)) {
                fs.rmSync(path.join(destDir, destEntry.name), { recursive: true, force: true });
            }
        }

        for (const entry of keptEntries) {
            const srcPath = path.join(srcDir, entry.name);
            const destPath = path.join(destDir, entry.name);
            if (entry.isDirectory()) {
                this.copyDirWithMtime(srcPath, destPath, skip, relOf(entry.name));
            } else if (entry.isFile()) {
                const needCopy = !fs.existsSync(destPath) ||
                    fs.statSync(srcPath).mtimeMs > fs.statSync(destPath).mtimeMs;
                if (needCopy) {
                    fs.copyFileSync(srcPath, destPath);
                }
            }
        }
    }

    /**
     * 在项目根写入面向通用 agent 的 AGENTS.md。
     * 不覆盖用户定制：仅当目标缺失、或目标内容恰为本扩展生成的另一引擎版本（即未被用户改动）时才写，
     * 后者用于 targetEngine 切换后刷新引擎提示——否则陈旧的 targetEngine 会误导 agent。
     */
    private writeAgentsMd(projectRoot: string, targetEngine: 'honeygui' | 'lvgl'): void {
        try {
            const destAgents = path.join(projectRoot, 'AGENTS.md');
            const expected = this.buildAgentsMdContent(targetEngine);

            if (fs.existsSync(destAgents)) {
                const existing = fs.readFileSync(destAgents, 'utf8');
                if (existing === expected) {
                    return; // 已是当前引擎版本
                }
                // 内容不等于任一引擎的原始模板 ⇒ 视为用户已定制，保留不动
                const otherEngine = targetEngine === 'honeygui' ? 'lvgl' : 'honeygui';
                if (existing !== this.buildAgentsMdContent(otherEngine)) {
                    return;
                }
                // 落到这里：现有内容是另一引擎的原始模板 ⇒ 引擎已切换，刷新为当前引擎版本
            }
            fs.writeFileSync(destAgents, expected, 'utf8');
            logger.info(`AGENTS.md 已写入项目（engine=${targetEngine}）: ${destAgents}`);
        } catch (error) {
            logger.warn(`写入 AGENTS.md 失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 生成 AGENTS.md 内容（含当前 targetEngine 提示）
     */
    private buildAgentsMdContent(targetEngine: 'honeygui' | 'lvgl'): string {
        return `# HoneyGUI 项目 — AI 协作指南

本项目使用 HoneyGUI HML（XML-based UI 标记）描述嵌入式 GUI。
目标引擎（targetEngine）：**${targetEngine}**（见 project.json，每个项目锁定一个引擎）。

## 规范（唯一真相源）

生成 / 修改 HML 前**必读**：[./HML-Spec.md](./HML-Spec.md)

- 仅使用规范中标注当前引擎 ${targetEngine} 为 ready(✓) 的组件；标注 planned / unsupported 的一律勿用。
- \`hg_view\` 不可嵌套；非容器组件不可有子组件。
- 资源路径必须以 \`/\` 开头（从 assets 目录起算）；\`hg_label\` 必须有 \`fontFile\`，且字体须在 assets/ 中。
- 事件用 \`<events><event><action>\` 结构，不用内联 \`onXxx\` 属性。
- 尺寸用 \`width\`/\`height\`（不是 \`w\`/\`h\`）；对齐用 \`hAlign\`/\`vAlign\`（不是 \`textAlign\`）。
- 绝不存在、永远勿用的组件：\`hg_container\`、\`hg_grid\`、\`hg_tab\`。

## 生成后必做（验证闭环）

调用 Extension HTTP API 验证（设计器运行时监听 38912）：

\`\`\`bash
curl -X POST http://localhost:38912/api/validate-hml \\
  -H "Content-Type: application/json" \\
  -d '{"filePath":"ui/xxx.hml"}'
\`\`\`

修复所有 errors 后再继续。注意：验证器只查 8 条结构规则，**不校验组件白名单 / 属性名**，
\`valid:true\` 仅必要不充分——仍须对照 HML-Spec.md 人工核对组件在当前引擎可用、属性名正确。

## 看效果（仿真）

在 VSCode 中打开本项目（已安装 HoneyGUI Visual Designer 扩展）：
点击 HoneyGUI 侧边栏的 **Simulate（🚀）**，或命令面板执行 \`HoneyGUI: Simulate\`，
扩展会自动完成 codegen → SCons 编译 → 仿真器运行。
`;
    }

    /**
     * 写入 / 更新项目根 CLAUDE.md：不存在则写含 @AGENTS.md 引用；
     * 已存在但未引用 AGENTS.md 时仅追加引用，绝不覆盖用户已有内容。
     */
    private writeOrUpdateClaudeMd(projectRoot: string): void {
        try {
            const destClaude = path.join(projectRoot, 'CLAUDE.md');

            if (!fs.existsSync(destClaude)) {
                const content =
                    `# CLAUDE.md\n\n` +
                    `本项目的 AI 协作约定见 AGENTS.md（HML 规范、验证闭环、仿真）：\n\n` +
                    `@AGENTS.md\n`;
                fs.writeFileSync(destClaude, content, 'utf8');
                logger.info(`CLAUDE.md 已写入项目: ${destClaude}`);
                return;
            }

            const existing = fs.readFileSync(destClaude, 'utf8');
            if (!existing.includes('@AGENTS.md')) {
                const appended = existing.replace(/\s*$/, '') +
                    `\n\n## AI 协作指南\n\n@AGENTS.md\n`;
                fs.writeFileSync(destClaude, appended, 'utf8');
                logger.info(`CLAUDE.md 已追加 @AGENTS.md 引用: ${destClaude}`);
            }
        } catch (error) {
            logger.warn(`写入 / 更新 CLAUDE.md 失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 注册视图提供者
     */
    private registerViewProviders(): void {
        // 注册环境检查视图
        const envProvider = new EnvironmentViewProvider();
        const envRegistration = vscode.window.registerTreeDataProvider('honeygui.environment', envProvider);
        this.disposables.push(envRegistration);
        this.context.subscriptions.push(envRegistration);

        // 注册刷新命令
        const refreshCommand = vscode.commands.registerCommand('honeygui.environment.refresh', () => {
            envProvider.refresh();
        });
        this.disposables.push(refreshCommand);
        this.context.subscriptions.push(refreshCommand);

        // 注册显示安装指引命令
        const guideCommand = vscode.commands.registerCommand('honeygui.environment.showGuide', (toolId: string) => {
            EnvironmentViewProvider.showInstallGuide(toolId);
        });
        this.disposables.push(guideCommand);
        this.context.subscriptions.push(guideCommand);

        // 注册消息转发命令（用于 SimulationService 向 Webview 发送消息）
        const sendMessageCommand = vscode.commands.registerCommand('honeygui.sendMessageToWebview', (message: any) => {
            // 通过 HmlEditorProvider 的静态方法广播消息
            vscode.commands.executeCommand('_honeygui.broadcastToWebviews', message);
        });
        this.disposables.push(sendMessageCommand);
        this.context.subscriptions.push(sendMessageCommand);

        // 注册快速操作视图提供者
        const quickProvider = new QuickViewDataProvider();
        const quickRegistration = vscode.window.registerTreeDataProvider('honeygui.quick', quickProvider);
        this.disposables.push(quickRegistration);
        this.context.subscriptions.push(quickRegistration);

        logger.info('视图提供者注册完成');
    }

    /**
     * 显示欢迎信息（仅首次激活时显示）
     */
    private showWelcomeMessage(): void {
        // 使用globalState持久化存储，防止重复显示
        const hasShownWelcome = this.context.globalState.get<boolean>('honeygui.welcomeMessageShown', false);
        
        if (hasShownWelcome) {
            return;
        }

        // 标记为已显示
        this.context.globalState.update('honeygui.welcomeMessageShown', true);
        
        vscode.window.showInformationMessage(
            'HoneyGUI设计器已启动！使用 Ctrl+Shift+P 搜索 "HoneyGUI" 开始创建项目。',
            '创建项目',
            '查看文档'
        ).then(selection => {
            switch (selection) {
                case '创建项目':
                    vscode.commands.executeCommand('honeygui.newProject');
                    break;
                case '查看文档':
                    vscode.env.openExternal(vscode.Uri.parse('https://gitee.com/realmcu/honeygui-design'));
                    break;
            }
        });
    }

    /**
     * 清理资源
     */
    dispose(): void {
        logger.info('HoneyGUI扩展正在清理资源...');
        
        this.commandManager.dispose();
        this.disposables.forEach(disposable => disposable.dispose());
        
        logger.info('HoneyGUI扩展已清理完成');
    }
}

/**
 * 快速操作视图数据提供者
 */
class QuickViewDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor() {
        // 监听仿真状态变化
        vscode.commands.registerCommand('_honeygui.updateQuickPanel', () => {
            this.refresh();
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: vscode.TreeItem | undefined): vscode.ProviderResult<vscode.TreeItem[]> {
        const quickItems: vscode.TreeItem[] = [];
        
        // 从 SimulationService 获取状态
        const SimulationService = require('../simulation/SimulationService').SimulationService;
        const isRunning = SimulationService.isSimulationRunning();
        
        // 编译仿真 / 停止仿真（根据状态切换）
        if (isRunning) {
            const stopItem = new vscode.TreeItem(vscode.l10n.t('Stop'), vscode.TreeItemCollapsibleState.None);
            stopItem.command = { command: 'honeygui.simulation.stop', title: vscode.l10n.t('Stop') };
            stopItem.iconPath = new vscode.ThemeIcon('debug-stop');
            stopItem.tooltip = vscode.l10n.t('Stop running simulation');
            quickItems.push(stopItem);
        } else {
            const simulationItem = new vscode.TreeItem(vscode.l10n.t('Simulate'), vscode.TreeItemCollapsibleState.None);
            simulationItem.command = { command: 'honeygui.simulation', title: vscode.l10n.t('Simulate') };
            simulationItem.iconPath = new vscode.ThemeIcon('rocket');
            simulationItem.tooltip = vscode.l10n.t('Compile and run simulation');
            quickItems.push(simulationItem);
        }
        
        // 清理编译
        const cleanItem = new vscode.TreeItem(vscode.l10n.t('Clean'), vscode.TreeItemCollapsibleState.None);
        cleanItem.command = { command: 'honeygui.simulation.clean', title: vscode.l10n.t('Clean') };
        cleanItem.iconPath = new vscode.ThemeIcon('trash');
        cleanItem.tooltip = vscode.l10n.t('Clean build artifacts');
        quickItems.push(cleanItem);
        
        // UART 下载
        const uartItem = new vscode.TreeItem(vscode.l10n.t('Download'), vscode.TreeItemCollapsibleState.None);
        uartItem.command = { command: 'honeygui.uartDownload', title: vscode.l10n.t('Download') };
        uartItem.iconPath = new vscode.ThemeIcon('cloud-download');
        uartItem.tooltip = vscode.l10n.t('Download to board via UART');
        quickItems.push(uartItem);
        
        return quickItems;
    }
}
