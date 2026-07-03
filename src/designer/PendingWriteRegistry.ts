import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 预期写入登记条目
 */
interface PendingWriteEntry {
    /** 登记时间戳（ms） */
    registeredAt: number;
    /** 首次被消费的时间戳（ms）；未消费则为 undefined */
    consumedAt?: number;
    /**
     * 自写内容的 hash（hashContent）。带 hash 的登记在消费时会读磁盘现值
     * 比对——只吞「磁盘就是我们写的内容」的回调；不带 hash 退化为纯时间窗。
     */
    contentHash?: string;
}

/**
 * 跨面板「预期写入登记表」（单例）。
 *
 * 用途（T8 → T10）：宿主写事务（如导航图边编辑）直接写盘前，先按规范化
 * 文件路径登记；各设计器面板的 fileWatcher 重载回调在真正回灌前查询本表，
 * 命中（时间窗内）则跳过本次重载并消费该登记——避免宿主自写触发面板
 * 无条件重载、冲掉面板刚被写事务同步好的状态。
 *
 * 设计约束（设计文档约束 7）：不复用 SaveManager 的单事务槽——SaveManager
 * 的 beginTransaction 会顶掉进行中的事务，且其抑制只对本面板生效；本表按
 * 文件路径登记、对所有面板生效，多文件写事务可并存。
 *
 * 消费语义：
 * - 时间窗（默认 3s）：登记只在窗口内有效，过期自动清除——陈旧登记不会
 *   抑制之后真正的外部编辑重载。
 * - 内容校验（H3）：登记可携带自写内容的 hash。纯时间窗是「盲窗」——外部方
 *   （AI agent / git checkout）在 watcher ~1s 防抖窗内再写同一文件时，两次
 *   写事件合并成一次回调，会连外部更新一起吞掉。带 hash 的登记在消费时读
 *   磁盘现值比对：一致（磁盘就是我们写的）才吞；不一致视为外部变更，删除
 *   登记并放行重载。读盘失败按不一致处理（宁可多重载，不可吞更新）。
 * - 首次命中即标记消费；但同一次磁盘写入可能触发多路 watcher 回调
 *   （FileSystemWatcher 与 onDidChangeTextDocument 各自防抖 1s 后几乎同时
 *   落进同一个重载入口），因此消费后保留一个短暂宽限期（默认 750ms），
 *   宽限期内的重复命中同样返回「跳过」；宽限期外的命中视为新的外部变更，
 *   删除条目并放行重载。
 */
export class PendingWriteRegistry {
    /** 默认时间窗：登记后多久内的重载会被抑制 */
    public static readonly DEFAULT_WINDOW_MS = 3000;
    /** 默认消费宽限期：首次消费后，重复 watcher 回调仍被抑制的时长 */
    public static readonly DEFAULT_CONSUME_GRACE_MS = 750;

    private static _instance: PendingWriteRegistry | undefined;

    private readonly _entries = new Map<string, PendingWriteEntry>();
    private readonly _windowMs: number;
    private readonly _graceMs: number;
    private readonly _now: () => number;
    private readonly _readFileText: (filePath: string) => string;

    /**
     * @param options 仅测试用：可注入时间窗/宽限期/时钟/读盘函数
     */
    public constructor(options?: {
        windowMs?: number;
        graceMs?: number;
        now?: () => number;
        readFileText?: (filePath: string) => string;
    }) {
        this._windowMs = options?.windowMs ?? PendingWriteRegistry.DEFAULT_WINDOW_MS;
        this._graceMs = options?.graceMs ?? PendingWriteRegistry.DEFAULT_CONSUME_GRACE_MS;
        this._now = options?.now ?? Date.now;
        this._readFileText = options?.readFileText ?? ((filePath: string) => fs.readFileSync(filePath, 'utf-8'));
    }

    /** 获取全局单例 */
    public static getInstance(): PendingWriteRegistry {
        if (!PendingWriteRegistry._instance) {
            PendingWriteRegistry._instance = new PendingWriteRegistry();
        }
        return PendingWriteRegistry._instance;
    }

    /**
     * 规范化文件路径为索引键：绝对化 + path.normalize；Windows 下不区分大小写
     * （盘符/路径大小写在 VS Code 各入口来源不一致）。
     * 同时是 DesignerPanel 面板路径索引的键规范。
     */
    public static normalizePathKey(filePath: string): string {
        const resolved = path.resolve(filePath);
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    }

    /** 内容 hash（sha1 hex）：register 的 contentHash 参数与磁盘现值比对共用 */
    public static hashContent(content: string): string {
        return crypto.createHash('sha1').update(content, 'utf8').digest('hex');
    }

    /**
     * 写盘前登记「即将由宿主自写该文件」。
     * 重复登记同一路径会重置时间窗并清除已消费标记。
     *
     * @param contentHash 自写内容的 hash（hashContent）。提供时消费端会读磁盘
     *   现值比对，只吞磁盘确实是该内容的回调（见类注释「内容校验」）；写盘
     *   前内容未知可先不带 hash 登记，写成后用读回内容重登记升级。
     */
    public register(filePath: string, contentHash?: string): void {
        this._prune();
        this._entries.set(PendingWriteRegistry.normalizePathKey(filePath), {
            registeredAt: this._now(),
            contentHash,
        });
    }

    /** 写事务失败回滚等场景下撤销登记 */
    public unregister(filePath: string): void {
        this._entries.delete(PendingWriteRegistry.normalizePathKey(filePath));
    }

    /**
     * 重载回调命中查询：返回 true 表示该文件在登记时间窗内有宿主预期写入，
     * 调用方应跳过本次重载回灌；本次命中即消费该登记（见类注释的消费语义）。
     */
    public consumeIfPending(filePath: string): boolean {
        this._prune();
        const key = PendingWriteRegistry.normalizePathKey(filePath);
        const entry = this._entries.get(key);
        if (!entry) {
            return false;
        }
        // 内容校验（H3）：带 hash 的登记只吞「磁盘现值就是我们写的内容」的
        // 回调。外部方在防抖窗内又写了同一文件（两次写合并成一次回调）时
        // hash 不一致——删除登记并放行重载，外部更新不会被吞。
        if (entry.contentHash !== undefined) {
            let diskHash: string | undefined;
            try {
                diskHash = PendingWriteRegistry.hashContent(this._readFileText(filePath));
            } catch {
                diskHash = undefined; // 读盘失败按不一致处理：宁可多重载，不可吞更新
            }
            if (diskHash !== entry.contentHash) {
                this._entries.delete(key);
                return false;
            }
        }
        const now = this._now();
        if (entry.consumedAt === undefined) {
            entry.consumedAt = now;
            return true;
        }
        if (now - entry.consumedAt <= this._graceMs) {
            // 同一次写入的重复 watcher 回调（多路防抖几乎同时到达），继续抑制
            return true;
        }
        // 已消费且过了宽限期：视为新的外部变更，删除条目并放行
        this._entries.delete(key);
        return false;
    }

    /** 是否存在未过期登记（不消费，仅查询；调试/测试用） */
    public hasPending(filePath: string): boolean {
        this._prune();
        return this._entries.has(PendingWriteRegistry.normalizePathKey(filePath));
    }

    /** 清除所有过期条目 */
    private _prune(): void {
        const now = this._now();
        for (const [key, entry] of this._entries) {
            if (now - entry.registeredAt > this._windowMs) {
                this._entries.delete(key);
            }
        }
    }
}
