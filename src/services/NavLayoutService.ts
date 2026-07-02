import * as path from 'path';
import * as fs from 'fs';

/**
 * 导航图节点单点布局坐标。
 */
export interface NavLayoutEntry {
    x: number;
    y: number;
}

/**
 * 复合键（relPath#viewId）→ 坐标。
 * 与 src/webview/types.ts 的 NavLayoutMap 保持同步。
 */
export type NavLayoutMap = Record<string, NavLayoutEntry>;

/**
 * 视图导航关系图的节点布局持久化服务。
 *
 * 存储位置：`<projectRoot>/.honeygui/nav-layout.json`
 * 模型：`{ [viewKey复合键]: {x,y} }`
 *
 * 写入语义：read-modify-write **按 key 合并**——只覆盖本次传入 patch 携带的 key，
 * 不会因为某个面板只发了部分节点就把其余节点的已保存坐标抹掉（防多面板互相覆盖）。
 *
 * 并发语义：同一 projectRoot 的写入以内存 Promise 链串行化；不同 projectRoot 互不影响。
 * 前一次写入失败不会卡死后续写入（链本身总是 resolve，失败只反映在调用方拿到的 Promise 上）。
 */
export class NavLayoutService {
    private static instance: NavLayoutService;

    /** 每个 projectRoot 一条写入队列（Promise 链），保证同项目内写入按到达顺序串行执行 */
    private readonly writeChains = new Map<string, Promise<void>>();

    private constructor() {}

    static getInstance(): NavLayoutService {
        if (!NavLayoutService.instance) {
            NavLayoutService.instance = new NavLayoutService();
        }
        return NavLayoutService.instance;
    }

    /**
     * 布局文件完整路径。
     */
    getLayoutPath(projectRoot: string): string {
        return path.join(projectRoot, '.honeygui', 'nav-layout.json');
    }

    /**
     * 读取当前布局。文件不存在、内容非法或读取失败一律回退空对象，不抛错。
     */
    loadLayout(projectRoot: string): NavLayoutMap {
        const layoutPath = this.getLayoutPath(projectRoot);
        try {
            if (!fs.existsSync(layoutPath)) {
                return {};
            }
            const content = fs.readFileSync(layoutPath, 'utf-8');
            const parsed = JSON.parse(content);
            return this.sanitize(parsed);
        } catch {
            // 读失败 → 回退空对象（约束：不影响弹窗打开，节点退回种子布局）
            return {};
        }
    }

    /**
     * 保存本次变更的 key（按 projectRoot 串行化，read-modify-write 合并）。
     * 空 patch 直接跳过，不产生写入。
     *
     * @throws 写入失败时 reject（调用方负责非阻塞地提示用户，不应向上抛出中断主流程）
     */
    async saveLayoutPatch(projectRoot: string, patch: NavLayoutMap): Promise<void> {
        if (!patch || Object.keys(patch).length === 0) {
            return;
        }

        const previous = this.writeChains.get(projectRoot) || Promise.resolve();
        // 前一次写入失败不应阻塞本次排队；链本身总是 resolve
        const queued = previous.catch(() => undefined).then(() => this.writeMerge(projectRoot, patch));
        // 链尾同样吞掉失败，保证后续调用仍能排上队；真实结果通过返回值 queued 传给本次调用方
        this.writeChains.set(projectRoot, queued.catch(() => undefined));

        return queued;
    }

    private async writeMerge(projectRoot: string, patch: NavLayoutMap): Promise<void> {
        const layoutPath = this.getLayoutPath(projectRoot);
        const dir = path.dirname(layoutPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const current = this.loadLayout(projectRoot);
        const merged: NavLayoutMap = { ...current, ...this.sanitize(patch) };
        fs.writeFileSync(layoutPath, JSON.stringify(merged, null, 2), 'utf-8');
    }

    /**
     * 过滤非法条目（非对象 / x,y 非 number），防止损坏文件或恶意 payload 写入垃圾数据。
     */
    private sanitize(raw: unknown): NavLayoutMap {
        const result: NavLayoutMap = {};
        if (!raw || typeof raw !== 'object') {
            return result;
        }
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
            const entry = value as Partial<NavLayoutEntry> | null | undefined;
            if (entry && typeof entry.x === 'number' && typeof entry.y === 'number'
                && Number.isFinite(entry.x) && Number.isFinite(entry.y)) {
                result[key] = { x: entry.x, y: entry.y };
            }
        }
        return result;
    }
}
