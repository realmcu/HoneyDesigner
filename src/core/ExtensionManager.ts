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

                // 分发 AI 协作资产（.claude/skills/ 全量 + 根 AGENTS.md 门面）。
                // 受项目级开关 aiAssets 控制：默认开启（未设置或非 false 即分发）；
                // 纯拖拽、不使用 AI 的用户可在 project.json 设 "aiAssets": false 关闭，
                // 此时自动清理已存在的分发产物。
                // 默认字体是运行时刚需：AI 与手动拖拽的用户都需要字体给 hg_label 用，
                // 故不受 aiAssets 开关控制。仅当 assets 无任何字体时补一份默认字体（见 ensureDefaultFont）。
                setImmediate(() => this.ensureDefaultFont(workspaceRoot));

                if (config.aiAssets === false) {
                    this.cleanupAiAssets(workspaceRoot);
                } else {
                    const targetEngine = config.targetEngine === 'lvgl' ? 'lvgl' : 'honeygui';
                    // 推迟到当前事件循环结束后执行，不阻塞扩展初始化关键路径
                    setImmediate(() => this.setupAiAssets(workspaceRoot, targetEngine));
                }
            } else {
                logger.info('未检测到项目配置文件');
            }

        } catch (error) {
            logger.warn(`环境检查失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 分发 AI 协作资产，供任意 AI agent（vibe coding）生成 HML 时参考：
     *   ① .claude/skills/honeygui-designer/  —— skill 全量（Claude Code 原生自动加载）
     *   ② references/hml-spec.md             —— 完整规范，注入当前引擎头（唯一真相源）
     *   ③ AGENTS.md（根）                     —— 中性门面：内联铁律 + 跳转 skill/spec，供其它 agent 手动 @
     * 各步骤独立 try，单步失败不影响其余分发。
     *
     * 不主动改 .gitignore：是否纳入版本控制完全交给用户——新建项目时用户已通过
     * aiAssets 开关表态；旧项目首次打开会"凭空"出现这些文件，正是让用户察觉新功能，
     * 不想要就把 project.json 的 aiAssets 设为 false 或自行 .gitignore。
     */
    private setupAiAssets(projectRoot: string, targetEngine: 'honeygui' | 'lvgl'): void {
        this.migrateLegacyAiAssets(projectRoot);
        this.copySkillToProject(projectRoot);
        this.copyHmlSpecToProject(projectRoot, targetEngine);
        this.writeAgentsMd(projectRoot);
    }

    /**
     * 迁移旧版分发方案的残留（旧版把 HML-Spec.md / CLAUDE.md 分发到项目根）。
     * 幂等：残留清除后再次调用即空操作。规范现已移入 skill 内，CLAUDE.md 入口由 AGENTS.md 取代。
     */
    private migrateLegacyAiAssets(projectRoot: string): void {
        // 旧版根目录 HML-Spec.md（规范已移入 .claude/skills/.../references/hml-spec.md）
        try {
            const legacySpec = path.join(projectRoot, 'HML-Spec.md');
            if (fs.existsSync(legacySpec)) {
                const c = fs.readFileSync(legacySpec, 'utf8');
                if (c.includes('本文件由 HoneyGUI Visual Designer 自动分发')) {
                    fs.rmSync(legacySpec);
                    logger.info('migrate: 已删除旧版根目录 HML-Spec.md（规范已移入 skill）');
                }
            }
        } catch (e) { logger.warn(`migrate: 处理旧 HML-Spec.md 失败: ${e}`); }

        // 旧版写入/追加的 CLAUDE.md（现以 AGENTS.md 为入口，移除本扩展的贡献）
        try {
            const claudePath = path.join(projectRoot, 'CLAUDE.md');
            if (fs.existsSync(claudePath)) {
                const content = fs.readFileSync(claudePath, 'utf8');
                const autoGenFull =
                    `# CLAUDE.md\n\n` +
                    `本项目的 AI 协作约定见 AGENTS.md（HML 规范、验证闭环、仿真）：\n\n` +
                    `@AGENTS.md\n`;
                if (content === autoGenFull) {
                    fs.rmSync(claudePath);
                    logger.info('migrate: 已删除旧版自动生成的 CLAUDE.md');
                } else {
                    const cleaned = content.replace(/\n\n## AI 协作指南\n\n@AGENTS\.md\n?/g, '');
                    if (cleaned !== content) {
                        fs.writeFileSync(claudePath, cleaned.replace(/\s*$/, '') + '\n', 'utf8');
                        logger.info('migrate: 已从 CLAUDE.md 移除旧版 @AGENTS.md 引用块');
                    }
                }
            }
        } catch (e) { logger.warn(`migrate: 处理 CLAUDE.md 失败: ${e}`); }
    }

    /**
     * 清理已分发的 AI 协作产物（当 project.json 的 aiAssets === false 时调用）。
     *
     * 删除策略按安全等级分类：
     *   - .claude/skills/honeygui-designer/：整目录删除（可再生）。
     *   - AGENTS.md：剥离本扩展的托管区块；文件若仅含该块则删除，用户自有正文一律保留。
     *   - 旧版根 HML-Spec.md / CLAUDE.md 残留交由 migrateLegacyAiAssets 处理。
     * 不动 .gitignore：本扩展从不写它，是否忽略由用户自行决定。
     */
    private cleanupAiAssets(projectRoot: string): void {
        this.migrateLegacyAiAssets(projectRoot);

        // ① .claude/skills/honeygui-designer/：整目录删除
        try {
            const skillPath = path.join(projectRoot, '.claude', 'skills', 'honeygui-designer');
            if (fs.existsSync(skillPath)) {
                fs.rmSync(skillPath, { recursive: true, force: true });
                logger.info('cleanupAiAssets: 已删除 .claude/skills/honeygui-designer/');
            }
        } catch (e) { logger.warn(`cleanupAiAssets: 删除 skill 目录失败: ${e}`); }

        // ② AGENTS.md：剥离托管区块，用户自有正文保留；若整文件都是我们的则删除
        try {
            const agentsPath = path.join(projectRoot, 'AGENTS.md');
            if (fs.existsSync(agentsPath)) {
                const existing = fs.readFileSync(agentsPath, 'utf8');
                const stripped = this.stripAgentsBlock(existing);
                if (stripped === null) {
                    logger.info('cleanupAiAssets: AGENTS.md 无本扩展托管块，保留');
                } else if (stripped.trim().length === 0) {
                    fs.rmSync(agentsPath);
                    logger.info('cleanupAiAssets: 已删除 AGENTS.md（仅含本扩展托管块）');
                } else {
                    fs.writeFileSync(agentsPath, stripped, 'utf8');
                    logger.info('cleanupAiAssets: 已从 AGENTS.md 剥离托管块，保留用户正文');
                }
            }
        } catch (e) { logger.warn(`cleanupAiAssets: 处理 AGENTS.md 失败: ${e}`); }
    }

    /**
     * 将插件内置的 HML-Spec.md 拷贝到项目根目录，并在顶部注入当前引擎说明
     * （按 §5 计划：过滤视图先用"全量 + 引擎头注释"，组件矩阵已含引擎标注，agent 据此过滤）
     */
    private copyHmlSpecToProject(projectRoot: string, targetEngine: 'honeygui' | 'lvgl'): void {
        try {
            const srcSpec = path.join(this.context.extensionPath, 'vibe-designer', 'skills', 'honeygui-designer', 'references', 'hml-spec.md');
            const destSpec = path.join(projectRoot, '.claude', 'skills', 'honeygui-designer', 'references', 'hml-spec.md');

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

            // 跳过条件：目标文件存在 且 源未更新 且 引擎头匹配。
            // 引擎切换时 engineTag 不匹配，强制重写；扩展升级时源 mtime 更新，正常覆盖。
            // 避免每次都读两个完整文件做全量字符串比对（hml-spec.md 较大时开销显著）。
            const engineTag = `targetEngine = ${targetEngine}`;
            if (fs.existsSync(destSpec)) {
                const srcMtime = fs.statSync(srcSpec).mtimeMs;
                const destMtime = fs.statSync(destSpec).mtimeMs;
                if (srcMtime <= destMtime) {
                    // mtime 未变，只需确认引擎头正确（廉价：只读文件头部约 200 字节）
                    const fd = fs.openSync(destSpec, 'r');
                    const buf = Buffer.alloc(256);
                    fs.readSync(fd, buf, 0, 256, 0);
                    fs.closeSync(fd);
                    if (buf.toString('utf8').includes(engineTag)) {
                        return;
                    }
                }
            }

            const specContent = fs.readFileSync(srcSpec, 'utf8');
            fs.mkdirSync(path.dirname(destSpec), { recursive: true });
            fs.writeFileSync(destSpec, header + specContent, 'utf8');
            logger.info(`hml-spec.md 已分发到 skill（engine=${targetEngine}）: ${destSpec}`);
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

            // 整目录镜像（含 references/hml-spec.md 的无头原版）；随后 copyHmlSpecToProject
            // 会按当前引擎把该文件覆盖为带引擎头的版本，故此处无需排除。
            this.copyDirWithMtime(srcSkill, destSkill);
            logger.info(`honeygui-designer skill 已分发到项目: ${destSkill}`);
        } catch (error) {
            logger.warn(`分发 skill 失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 确保项目 assets/ 里有可用字体：仅当 assets（含子目录）没有任何字体源时，
     * 复制内置的默认字体 NotoSansSC-Medium.ttf（Noto Sans 简体中文，覆盖 CJK+拉丁+数字）
     * 进 assets/，让 hg_label 开箱即用。由扩展用 extensionPath 可靠定位字体源。
     *
     * 「默认字体」语义而非「保证存在」：用户加了自己的字体后即可删掉这份默认字体、
     * 不会被重新塞回（assets 已有字体就不再补）。assets 里的字体只有被 HML 的 fontFile
     * 引用才会在 build 时转换进固件，未引用的不进固件，故放一份默认字体无固件代价。
     */
    private ensureDefaultFont(projectRoot: string): void {
        try {
            const assetsDir = path.join(projectRoot, 'assets');
            if (!fs.existsSync(assetsDir)) {
                return;
            }
            const fontExts = new Set(['.ttf', '.otf', '.woff', '.woff2']);
            if (this.hasFontFile(assetsDir, fontExts)) {
                return;
            }
            const fontName = 'NotoSansSC-Medium.ttf';
            const srcFont = path.join(this.context.extensionPath, 'lib', 'font', fontName);
            if (!fs.existsSync(srcFont)) {
                logger.warn(`默认字体源不存在: ${srcFont}`);
                return;
            }
            fs.copyFileSync(srcFont, path.join(assetsDir, fontName));
            logger.info(`assets 无字体，已放入默认字体: ${fontName}`);
        } catch (error) {
            logger.warn(`放置默认字体失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /** 递归判断目录下是否存在任意字体源文件。 */
    private hasFontFile(dir: string, exts: Set<string>): boolean {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return false;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (this.hasFontFile(full, exts)) {
                    return true;
                }
            } else if (exts.has(path.extname(entry.name).toLowerCase())) {
                return true;
            }
        }
        return false;
    }

    /**
     * 将 srcDir 镜像到 destDir：逐文件按 mtime 增量覆盖（源更新或目标缺失才写），
     * 并剪除目标端在源中已不存在的条目，保持目标为源的精确镜像
     * ——否则 skill 升级时被删除/改名的旧文件（如废弃的 components.md / hml-syntax.md）
     * 会残留，让 agent 读到过期错误规范。
     */
    private copyDirWithMtime(srcDir: string, destDir: string): void {
        fs.mkdirSync(destDir, { recursive: true });

        const srcEntries = fs.readdirSync(srcDir, { withFileTypes: true });
        const srcNames = new Set(srcEntries.map(e => e.name));

        // 先剪除目标端多余条目（源已移除），保持目标为源的精确镜像
        for (const destEntry of fs.readdirSync(destDir, { withFileTypes: true })) {
            if (!srcNames.has(destEntry.name)) {
                fs.rmSync(path.join(destDir, destEntry.name), { recursive: true, force: true });
            }
        }

        for (const entry of srcEntries) {
            const srcPath = path.join(srcDir, entry.name);
            const destPath = path.join(destDir, entry.name);
            if (entry.isDirectory()) {
                this.copyDirWithMtime(srcPath, destPath);
            } else if (entry.isFile()) {
                const needCopy = !fs.existsSync(destPath) ||
                    fs.statSync(srcPath).mtimeMs > fs.statSync(destPath).mtimeMs;
                if (needCopy) {
                    fs.copyFileSync(srcPath, destPath);
                }
            }
        }
    }

    // AGENTS.md 中本扩展托管区块的起止标记。用标记包裹，使我们能在不触碰
    // 用户自有正文的前提下，幂等地更新自己的那一段。
    private static readonly AGENTS_BLOCK_START =
        '<!-- BEGIN HoneyGUI AI 设计指南（自动维护，请勿编辑本区块） -->';
    private static readonly AGENTS_BLOCK_END =
        '<!-- END HoneyGUI AI 设计指南 -->';

    /**
     * 在项目根维护中性门面 AGENTS.md，采用"托管区块"模型，绝不覆盖用户自有正文：
     *   - 文件不存在        ⇒ 新建，仅含我们的托管区块。
     *   - 已含我们的区块    ⇒ 只刷新区块内容（幂等），区块外用户正文原样保留。
     *   - 用户已有 AGENTS.md ⇒ 在文末追加我们的区块，不动其原有内容。
     *   - 旧版整文件自动生成 ⇒ 迁移为托管区块格式。
     * 区块内容为静态（不含具体引擎名——引擎信息只活在 hml-spec.md 头部），切引擎时无需刷新。
     */
    private writeAgentsMd(projectRoot: string): void {
        try {
            const destAgents = path.join(projectRoot, 'AGENTS.md');
            const block = this.buildAgentsMdBlock();

            if (!fs.existsSync(destAgents)) {
                fs.writeFileSync(destAgents, block, 'utf8');
                logger.info(`AGENTS.md 已写入项目: ${destAgents}`);
                return;
            }

            const existing = fs.readFileSync(destAgents, 'utf8');
            const start = existing.indexOf(ExtensionManager.AGENTS_BLOCK_START);
            const end = existing.indexOf(ExtensionManager.AGENTS_BLOCK_END);

            // a) 已含托管区块 ⇒ 原地替换区块（幂等），区块外用户正文不动
            if (start !== -1 && end !== -1 && end > start) {
                const before = existing.slice(0, start);
                const after = existing.slice(end + ExtensionManager.AGENTS_BLOCK_END.length);
                const updated = before + block.trim() + after;
                if (updated !== existing) {
                    fs.writeFileSync(destAgents, updated, 'utf8');
                    logger.info(`AGENTS.md 托管区块已刷新: ${destAgents}`);
                }
                return;
            }

            // b) 旧版整文件自动生成（引擎变体或旧无标记静态版）⇒ 迁移为托管区块格式
            if (this.isLegacyAutoGenAgents(existing)
                || existing.trimEnd() === this.buildAgentsMdContent().trimEnd()) {
                fs.writeFileSync(destAgents, block, 'utf8');
                logger.info(`AGENTS.md 已迁移为托管区块格式: ${destAgents}`);
                return;
            }

            // c) 用户自有 AGENTS.md（无我们的区块）⇒ 文末追加，保留其原有内容
            const appended = existing.replace(/\s*$/, '') + '\n\n' + block;
            fs.writeFileSync(destAgents, appended, 'utf8');
            logger.info(`AGENTS.md 已存在，已追加本扩展托管区块: ${destAgents}`);
        } catch (error) {
            logger.warn(`写入 AGENTS.md 失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /** 用起止标记包裹静态门面内容，构成 AGENTS.md 中本扩展的托管区块。 */
    private buildAgentsMdBlock(): string {
        return `${ExtensionManager.AGENTS_BLOCK_START}\n\n` +
            this.buildAgentsMdContent() +
            `\n${ExtensionManager.AGENTS_BLOCK_END}\n`;
    }

    /**
     * 从 AGENTS.md 内容中剥离本扩展的托管区块，返回应保留的剩余内容：
     *   - 含起止标记      ⇒ 删除该区块，返回区块外的用户正文（可能为空字符串）。
     *   - 旧版整文件自动生成 ⇒ 返回 ''（整文件都是我们的，应删除）。
     *   - 用户自有文件     ⇒ 返回 null（不含我们的块，调用方应保留不动）。
     */
    private stripAgentsBlock(content: string): string | null {
        const start = content.indexOf(ExtensionManager.AGENTS_BLOCK_START);
        const end = content.indexOf(ExtensionManager.AGENTS_BLOCK_END);
        if (start !== -1 && end !== -1 && end > start) {
            const before = content.slice(0, start).replace(/\s*$/, '');
            const after = content.slice(end + ExtensionManager.AGENTS_BLOCK_END.length)
                .replace(/^\s*/, '');
            const rest = (before && after ? before + '\n\n' + after : before + after)
                .replace(/\s*$/, '');
            return rest.length ? rest + '\n' : '';
        }
        if (this.isLegacyAutoGenAgents(content)
            || content.trimEnd() === this.buildAgentsMdContent().trimEnd()) {
            return '';
        }
        return null;
    }

    /**
     * 判断 AGENTS.md 是否为旧版自动生成的引擎变体（用户极不可能手写出该精确头部），
     * 用于迁移时安全地刷新为新静态版。
     */
    private isLegacyAutoGenAgents(content: string): boolean {
        return content.startsWith('# HoneyGUI 项目 — AI 协作指南')
            && /目标引擎（targetEngine）：\*\*(honeygui|lvgl)\*\*/.test(content);
    }

    /**
     * 生成中性门面 AGENTS.md 的静态内容：内联致命铁律 + 跳转完整规范（skill 内 hml-spec.md）。
     * 供 Codex / Cursor / Copilot / Trae 等手动 @；Claude Code 另会自动加载同目录 skill。
     * 不含具体引擎名——具体引擎由 hml-spec.md 头部声明，避免切引擎时本文件陈旧。
     */
    private buildAgentsMdContent(): string {
        return `# HoneyGUI 项目 — AI 设计指南

> 用任意 AI agent（Claude Code / Cursor / Codex / Copilot / Trae 等）生成或修改本项目的
> HML 界面时，请先 \`@\` 引用本文件；Claude Code 还会自动加载 honeygui-designer skill。

## 生成 HML 前必读完整规范

\`.claude/skills/honeygui-designer/references/hml-spec.md\`

（该文件由扩展按当前项目引擎自动维护，顶部注明了 targetEngine 与各组件可用性。）

## 不读规范也必须守的底线

- 只用规范中标注当前 targetEngine 为 ready(✓) 的组件；planned / unsupported 一律勿用。
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

修复所有 errors 后再继续。注意：验证器只查结构规则，**不校验组件白名单 / 属性名**，
\`valid:true\` 仅必要不充分——仍须对照 hml-spec.md 人工核对组件在当前引擎可用、属性名正确。

## 看效果（仿真）

在 VSCode 中打开本项目（已安装 HoneyGUI Visual Designer 扩展）：
点击 HoneyGUI 侧边栏的 **Simulate（🚀）**，或命令面板执行 \`HoneyGUI: Simulate\`，
扩展会自动完成 codegen → SCons 编译 → 仿真器运行。
`;
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
