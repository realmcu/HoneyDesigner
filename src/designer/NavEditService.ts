import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { logger } from '../utils/Logger';
import { HmlParser, ComponentRegistry } from '../hml/HmlParser';
import { HmlSerializer } from '../hml/HmlSerializer';
import { scanOpenTags } from '../hml/tagScan';
import type { Document as HmlDocument, Component } from '../hml/types';
import type { Action, EventConfig, EventType } from '../hml/eventTypes';
import { getSupportedEvents } from '../hml/eventTypes';
import { PendingWriteRegistry } from './PendingWriteRegistry';

/**
 * 导航图写事务服务（设计文档 T10）。
 *
 * 统一的 HML 导航跳转写路径：改目标 / 删除 / 新建三种 op，当前文件与跨文件
 * 一律走此路。协议十步（与设计文档一一对应）：
 *   1. 前置校验：目标文件被设计器面板打开且有未保存改动（webview 内存态，
 *      T8 查询），或对应 TextDocument dirty → 返回 fileDirty，提示先保存。
 *   2. 快照校验：边携带的扫描时 hash（mtime 兜底）与磁盘现值比对，不一致
 *      → fileChanged（"文件已变化，请刷新图"）。
 *   3. round-trip 预检：检测序列化器已知的丢失类（注释 / view 子树未知标签，
 *      约束 9），命中且未带 confirmed=true → 返回 needsConfirm，由 webview
 *      弹确认后重发。
 *   4. 精确定位：parse(原文, 路径)（fallback id 带 basename 种子）→ 按
 *      sourceControlId + eventConfigIndex + actionIndex 匹配唯一 action
 *      （新建则定位源控件并校验事件支持/占用），失败 → locateFailed。
 *   5. 备份：原 .hml 内容 + 该文件可能的 canvas SVG 副产物入内存备份。
 *   6. 修改 + 序列化 + 复解析校验：改动落在内存文档上，先序列化为字符串并
 *      复解析验证改动真实存在，失败则中止（此时磁盘未动）。
 *   7. 写盘：写前在 PendingWriteRegistry 登记（抑制各面板 watcher 回灌，
 *      T8；写成后读回落盘内容重登记为带内容 hash——消费端据此只吞真正的
 *      自写回调，失败路径注销登记），经 HmlSerializer.serializeToFile 原子
 *      写；**绝不触发 codegen**
 *      （设计文档约束 11——本服务不 import 任何 codegen 模块，调用方也不得
 *      在写事务路径上调度代码生成）。
 *   8. undo 一致性：目标文件有对应面板时把写前快照 push 进该面板
 *      FileManager undo 栈并同步面板内容；无面板则回执 usedFileHistory=true
 *      （提示用 VS Code 文件历史撤销）。
 *   9. 失败回滚：写盘失败恢复备份（.hml + SVG，逐字节校验），返回具体错误。
 *  10. 成功回执：hintKey 提示"代码将在下次代码生成时更新"；allViews 重扫
 *      回推由调用方（MessageHandler）完成。
 *
 * 依赖注入（NavEditHostHooks）：面板 dirty 查询 / TextDocument dirty 查询 /
 * 面板适配器均由调用方提供——服务本体不 import vscode 与 DesignerPanel，
 * 可在纯 Node 环境下直调验证。
 */

/** 编辑操作类型 */
export type NavEditOp = 'retarget' | 'delete' | 'create';

/** 稳定错误码（webview 侧映射 i18n 文案） */
export type NavEditErrorCode =
    | 'invalidRequest'
    | 'noProjectRoot'
    | 'fileNotFound'
    | 'fileDirty'
    | 'fileChanged'
    | 'timerEdgeReadonly'
    | 'locateFailed'
    | 'eventUnsupported'
    | 'eventOccupied'
    | 'writeFailed'
    | 'rollbackFailed';

/** round-trip 预检检测到的将丢失内容种类 */
export type NavEditConfirmReason = 'comments' | 'unknownTags' | 'nameAttributes';

/** 成功回执固定提示 key（webview t() 渲染："代码将在下次代码生成时更新"） */
export const NAV_EDIT_HINT_CODE_REGEN = 'navEdit.codeWillRegenerate';

/** 新建跳转的默认动画（设计文档决策记录） */
export const NAV_EDIT_DEFAULT_SWITCH_OUT = 'SWITCH_OUT_TO_LEFT_USE_TRANSLATION';
export const NAV_EDIT_DEFAULT_SWITCH_IN = 'SWITCH_IN_FROM_RIGHT_USE_TRANSLATION';

/**
 * 边定位字段（retarget/delete 入参）——T2 边数据模型的定位子集全量。
 * sourceViewKey（relPath#viewId）是路径事实源；快照校验以 hash 为准，
 * hash 缺失时退化用 mtime。
 */
export interface NavEditEdgeLocator {
    sourceViewKey: string;
    sourceControlId: string;
    /** 原始事件类型（eventConfig.type；定时器边为 'timer'，一律拒绝编辑） */
    eventType: string;
    eventConfigIndex: number;
    actionIndex: number;
    /** 旧 target（定位一致性校验用） */
    target: string;
    sourceIsView?: boolean;
    sourceIsTimer?: boolean;
    sourceFileMtime?: number;
    sourceFileHash?: string;
}

/** 新建跳转入参（快照字段取自 ViewNavNode 的 fileMtime/fileHash） */
export interface NavEditCreateSpec {
    sourceViewKey: string;
    sourceControlId: string;
    eventType: string;
    /** 目标 view 裸 id */
    target: string;
    sourceFileMtime?: number;
    sourceFileHash?: string;
}

export interface NavEditRequest {
    op: NavEditOp;
    /** retarget / delete 必填 */
    edge?: NavEditEdgeLocator;
    /** retarget 必填：新目标 view 裸 id */
    newTarget?: string;
    /** create 必填 */
    create?: NavEditCreateSpec;
    /** round-trip 预检差异经用户确认后重发时为 true */
    confirmed?: boolean;
}

export interface NavEditResult {
    success: boolean;
    op?: NavEditOp;
    /** 需要用户确认规范化重写（webview 弹确认后带 confirmed=true 重发） */
    needsConfirm?: boolean;
    confirmReasons?: NavEditConfirmReason[];
    /** needsConfirm 补充信息（如未知标签名列表） */
    confirmDetail?: string;
    errorCode?: NavEditErrorCode;
    /** 错误补充信息（控件 id / 异常消息等，辅助定位） */
    errorDetail?: string;
    /** 目标文件无对应设计器面板：undo 不可用，请用 VS Code 文件历史撤销 */
    usedFileHistory?: boolean;
    /** 成功提示 key：代码将在下次代码生成时更新 */
    hintKey?: string;
}

/** 目标文件对应面板的最小适配面（由调用方基于 DesignerPanel 提供） */
export interface NavEditPanelAdapter {
    /** 把写前快照无防抖地压入该面板 FileManager undo 栈 */
    pushUndoSnapshot(content: string): void;
    /** 用写盘后的内容同步该面板（watcher 回灌已被登记表抑制） */
    reloadFromContent(content: string): Promise<void>;
}

/** 宿主环境钩子（依赖注入，保证服务可在纯 Node 环境直调验证） */
export interface NavEditHostHooks {
    /** T8：此文件是否被某设计器面板打开且有未保存改动（webview 内存态） */
    isFileOpenWithUnsavedChanges(filePath: string): boolean;
    /** 此文件对应 TextDocument 是否 dirty */
    isTextDocumentDirty(filePath: string): boolean;
    /** 此文件对应的设计器面板适配器（无面板返回 undefined） */
    getPanelAdapter(filePath: string): NavEditPanelAdapter | undefined;
}

/** SVG 副产物备份条目（content === null 表示写前不存在，回滚时删除） */
interface SvgBackupEntry {
    filePath: string;
    content: string | null;
}

/** 定位成功后的编辑上下文 */
interface LocatedContext {
    doc: HmlDocument;
    components: Component[];
    comp: Component;
}

export class NavEditService {
    private readonly _hooks: NavEditHostHooks;

    constructor(hooks: NavEditHostHooks) {
        this._hooks = hooks;
    }

    /**
     * 执行一次导航写事务。projectRoot 由调用方解析（当前面板文件所在项目）。
     */
    public async applyNavEdit(request: NavEditRequest, projectRoot: string): Promise<NavEditResult> {
        const op = request?.op;
        const fail = (errorCode: NavEditErrorCode, errorDetail?: string): NavEditResult => {
            logger.warn(`[NavEditService] ${op ?? '?'} 中止: ${errorCode}${errorDetail ? ` (${errorDetail})` : ''}`);
            return { success: false, op, errorCode, errorDetail };
        };

        if (op !== 'retarget' && op !== 'delete' && op !== 'create') {
            return fail('invalidRequest', `unknown op: ${String(op)}`);
        }
        if (!projectRoot) {
            return fail('noProjectRoot');
        }

        // ---- 入参展开与基本校验 ----
        let viewKey: string;
        let controlId: string;
        let eventType: string;
        let snapshotHash: string | undefined;
        let snapshotMtime: number | undefined;
        const edge = request.edge;
        const create = request.create;

        if (op === 'create') {
            if (!create?.sourceViewKey || !create.sourceControlId || !create.eventType || !create.target) {
                return fail('invalidRequest', 'create 缺少必填字段');
            }
            viewKey = create.sourceViewKey;
            controlId = create.sourceControlId;
            eventType = create.eventType;
            snapshotHash = create.sourceFileHash;
            snapshotMtime = create.sourceFileMtime;
        } else {
            if (!edge?.sourceViewKey || !edge.sourceControlId || !edge.eventType || !edge.target
                || !Number.isInteger(edge.eventConfigIndex) || edge.eventConfigIndex < 0
                || !Number.isInteger(edge.actionIndex) || edge.actionIndex < 0) {
                return fail('invalidRequest', 'edge 缺少定位字段');
            }
            if (op === 'retarget' && !request.newTarget) {
                return fail('invalidRequest', '缺少 newTarget');
            }
            // 定时器边只读（设计决策：采集显示、不可编辑）
            if (edge.sourceIsTimer || edge.eventType === 'timer') {
                return fail('timerEdgeReadonly');
            }
            viewKey = edge.sourceViewKey;
            controlId = edge.sourceControlId;
            eventType = edge.eventType;
            snapshotHash = edge.sourceFileHash;
            snapshotMtime = edge.sourceFileMtime;
        }

        // ---- viewKey → 绝对路径（含路径遍历防护） ----
        const hashIdx = viewKey.indexOf('#');
        if (hashIdx <= 0 || hashIdx === viewKey.length - 1) {
            return fail('invalidRequest', `非法 viewKey: ${viewKey}`);
        }
        const fileRelative = viewKey.slice(0, hashIdx);
        const viewId = viewKey.slice(hashIdx + 1);
        const absPath = path.resolve(projectRoot, ...fileRelative.split('/'));
        const rootKey = PendingWriteRegistry.normalizePathKey(projectRoot);
        const fileKey = PendingWriteRegistry.normalizePathKey(absPath);
        if (!fileKey.startsWith(rootKey + path.sep)) {
            return fail('invalidRequest', `目标文件不在项目内: ${fileRelative}`);
        }
        if (!fs.existsSync(absPath)) {
            return fail('fileNotFound', fileRelative);
        }

        // ---- 1. 前置校验：面板内存态 / TextDocument 未保存改动 ----
        if (this._hooks.isFileOpenWithUnsavedChanges(absPath)) {
            return fail('fileDirty', 'designer panel has unsaved changes');
        }
        if (this._hooks.isTextDocumentDirty(absPath)) {
            return fail('fileDirty', 'text document has unsaved changes');
        }

        // ---- 2. 快照校验（hash 为准：内容一致即图不陈旧；hash 缺失退化比 mtime） ----
        let original: string;
        try {
            original = fs.readFileSync(absPath, 'utf-8');
        } catch (err) {
            return fail('fileNotFound', String(err));
        }
        const diskHash = crypto.createHash('sha1').update(original, 'utf8').digest('hex');
        if (snapshotHash) {
            if (diskHash !== snapshotHash) {
                return fail('fileChanged');
            }
        } else if (typeof snapshotMtime === 'number') {
            const diskMtime = fs.statSync(absPath).mtimeMs;
            if (diskMtime !== snapshotMtime) {
                return fail('fileChanged');
            }
        } else {
            return fail('invalidRequest', '缺少快照校验字段（mtime/hash）');
        }

        // ---- 3. round-trip 预检（约束 9：整文件规范化重写的已知丢失类） ----
        if (request.confirmed !== true) {
            const loss = this._detectRoundTripLoss(original);
            if (loss.reasons.length > 0) {
                logger.info(`[NavEditService] round-trip 预检需确认: ${loss.reasons.join(',')} ${loss.detail ?? ''}`);
                return {
                    success: false,
                    op,
                    needsConfirm: true,
                    confirmReasons: loss.reasons,
                    confirmDetail: loss.detail,
                };
            }
        }

        // ---- 4. 精确定位（parse 带路径：fallback id 与扫描端一致） ----
        let doc: HmlDocument;
        try {
            doc = new HmlParser().parse(original, absPath);
        } catch (err) {
            return fail('locateFailed', `解析失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        const components = doc.view?.components || [];
        const matches = components.filter(c => c?.id === controlId);
        if (matches.length === 0) {
            return fail('locateFailed', `控件不存在: ${controlId}`);
        }
        if (matches.length > 1) {
            return fail('locateFailed', `控件 id 不唯一: ${controlId}`);
        }
        const comp = matches[0];
        if (!this._controlBelongsToView(components, comp, viewId)) {
            return fail('locateFailed', `控件 ${controlId} 不属于 view ${viewId}`);
        }
        const ctx: LocatedContext = { doc, components, comp };

        // op 专属定位/校验 + 计算变更（真正修改在第 6 步统一执行）
        let mutate: () => void;
        // 复解析校验用的预期位置（create 在 mutate 后填充）
        let verifyEventConfigIndex: number;
        let verifyActionIndex: number;
        let verifyKind: 'retarget' | 'deleteAction' | 'deleteEventConfig' | 'create';
        let expectedEventConfigCount = 0;
        let expectedActionCount = 0;

        if (op === 'retarget' || op === 'delete') {
            const e = edge!;
            const eventConfigs = comp.eventConfigs || [];
            const eventConfig = eventConfigs[e.eventConfigIndex];
            if (!eventConfig || eventConfig.type !== e.eventType) {
                return fail('locateFailed',
                    `事件配置不匹配: index=${e.eventConfigIndex} type=${eventConfig?.type ?? 'none'} 期望 ${e.eventType}`);
            }
            const actions = eventConfig.actions || [];
            const action = actions[e.actionIndex];
            if (!action || action.type !== 'switchView' || action.target !== e.target) {
                return fail('locateFailed',
                    `action 不匹配: index=${e.actionIndex} type=${action?.type ?? 'none'} target=${action?.target ?? 'none'} 期望 switchView→${e.target}`);
            }

            if (op === 'retarget') {
                const newTarget = request.newTarget!;
                verifyKind = 'retarget';
                verifyEventConfigIndex = e.eventConfigIndex;
                verifyActionIndex = e.actionIndex;
                mutate = () => {
                    action.target = newTarget;
                };
            } else {
                const removeWholeConfig = actions.length === 1;
                verifyKind = removeWholeConfig ? 'deleteEventConfig' : 'deleteAction';
                verifyEventConfigIndex = e.eventConfigIndex;
                verifyActionIndex = e.actionIndex;
                mutate = () => {
                    actions.splice(e.actionIndex, 1);
                    if (actions.length === 0) {
                        // actions 空 → 连事件配置一并删（设计 T10 第 6 步）
                        eventConfigs.splice(e.eventConfigIndex, 1);
                        if (eventConfigs.length === 0) {
                            delete comp.eventConfigs;
                        }
                    }
                    expectedEventConfigCount = comp.eventConfigs?.length ?? 0;
                    expectedActionCount = removeWholeConfig ? 0 : actions.length;
                };
            }
        } else {
            // create：校验事件支持与占用
            const c = create!;
            const supported = getSupportedEvents(comp.type);
            if (!supported.includes(eventType as EventType)) {
                return fail('eventUnsupported', `${comp.type} 不支持 ${eventType}`);
            }
            const eventConfigs = comp.eventConfigs || [];
            const existing = eventConfigs.find(ec => ec.type === eventType);
            if (existing && (existing.actions || []).some(a => a.type === 'switchView')) {
                return fail('eventOccupied', `${controlId}.${eventType} 已配置 switchView`);
            }
            verifyKind = 'create';
            verifyEventConfigIndex = -1;
            verifyActionIndex = -1;
            mutate = () => {
                const action: Action = {
                    type: 'switchView',
                    target: c.target,
                    switchOutStyle: NAV_EDIT_DEFAULT_SWITCH_OUT,
                    switchInStyle: NAV_EDIT_DEFAULT_SWITCH_IN,
                };
                if (existing) {
                    existing.actions = existing.actions || [];
                    existing.actions.push(action);
                    verifyEventConfigIndex = (comp.eventConfigs || []).indexOf(existing);
                    verifyActionIndex = existing.actions.length - 1;
                } else {
                    const newConfig: EventConfig = { type: eventType as EventType, actions: [action] };
                    comp.eventConfigs = [...(comp.eventConfigs || []), newConfig];
                    verifyEventConfigIndex = comp.eventConfigs.length - 1;
                    verifyActionIndex = 0;
                }
            };
        }

        // ---- 5. 备份（.hml 内容 + canvas SVG 副产物，约束 9 的 SVG 副作用） ----
        const svgBackups = this._collectSvgBackups(ctx.components, absPath);

        // ---- 6. 修改 + 序列化 + 复解析校验（此时磁盘未动，失败即无痕中止） ----
        mutate();
        let verifyContent: string;
        try {
            verifyContent = this._serializeForVerify(doc);
        } catch (err) {
            return fail('writeFailed', `序列化失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        const verifyError = this._verifyMutation(
            verifyContent, absPath, controlId, eventType,
            verifyKind, verifyEventConfigIndex, verifyActionIndex,
            expectedEventConfigCount, expectedActionCount,
            op === 'retarget' ? request.newTarget : create?.target
        );
        if (verifyError) {
            return fail('writeFailed', `复解析校验失败: ${verifyError}`);
        }

        // ---- 7. 写盘（登记抑制 watcher 回灌；绝不触发 codegen） ----
        // TOCTOU 收窄：第 1 步 dirty 前置校验与写盘之间隔着解析/序列化（约百毫秒），
        // 期间面板/TextDocument 可能刚产生未保存改动——写盘前紧邻处再查一次
        // （不追求完美原子性，只把盲窗压缩到最小）
        if (this._hooks.isFileOpenWithUnsavedChanges(absPath)) {
            return fail('fileDirty', 'designer panel became dirty before write');
        }
        if (this._hooks.isTextDocumentDirty(absPath)) {
            return fail('fileDirty', 'text document became dirty before write');
        }

        const registry = PendingWriteRegistry.getInstance();
        registry.register(absPath);
        try {
            await new HmlSerializer().serializeToFile(doc, absPath);
        } catch (writeErr) {
            // ---- 9. 失败回滚（.hml + SVG 逐字节恢复） ----
            // 失败路径（含回滚后）必须注销登记：否则 3s 时间窗内真实的外部编辑
            // 会被各面板 watcher 的 consumeIfPending 吞掉，面板静默保留旧内容
            // 与磁盘分叉。回滚自写触发的 watcher 重载会回灌回滚后的原文，无害。
            try {
                const rollbackError = this._rollback(absPath, original, svgBackups);
                if (rollbackError) {
                    return fail('rollbackFailed',
                        `写盘失败且回滚失败: ${rollbackError}; 原始错误: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`);
                }
                return fail('writeFailed', writeErr instanceof Error ? writeErr.message : String(writeErr));
            } finally {
                registry.unregister(absPath);
            }
        }

        // 写盘成功：读回落盘内容，把登记升级为「带内容 hash」（H3）——各面板
        // watcher 消费该登记时会读磁盘现值比对，只吞确实是本次自写内容的回调；
        // 外部方在 watcher 防抖窗内又写了同一文件时（hash 不一致）放行重载。
        // 读回失败则保留写前的纯时间窗登记（退化，不中止事务）。
        let written: string | undefined;
        try {
            written = fs.readFileSync(absPath, 'utf-8');
            registry.register(absPath, PendingWriteRegistry.hashContent(written));
        } catch (readErr) {
            logger.warn(`[NavEditService] 写后读回失败，登记退化为纯时间窗: ${readErr}`);
        }

        // ---- 8. undo 一致性 + 面板同步 ----
        let usedFileHistory = false;
        const adapter = this._hooks.getPanelAdapter(absPath);
        if (adapter) {
            try {
                adapter.pushUndoSnapshot(original);
                await adapter.reloadFromContent(written ?? fs.readFileSync(absPath, 'utf-8'));
            } catch (err) {
                // 面板同步失败不回滚写事务（磁盘已是正确内容），仅记录
                logger.warn(`[NavEditService] 面板同步失败（磁盘内容已正确写入）: ${err}`);
            }
        } else {
            usedFileHistory = true;
        }

        // ---- 10. 成功回执（allViews 重扫回推由调用方完成） ----
        logger.info(`[NavEditService] ${op} 成功: ${fileRelative} ${controlId}.${eventType}`);
        return { success: true, op, usedFileHistory, hintKey: NAV_EDIT_HINT_CODE_REGEN };
    }

    /**
     * round-trip 预检：检测序列化器已知的"解析即丢"内容类。
     * - 注释：HmlParser/HmlSerializer 全程不保留（约束 9）。
     * - view 子树未知标签：非 hg_/custom_ 且非结构标签（events/event/action）
     *   解析即删（HmlParser._parseChildrenOrdered 的 isValidComponent 过滤）。
     * - view 子树组件的 name 属性：序列化器不回写 name（"统一使用 id"），
     *   而 name 可能被其他文件的 switchView 以 name 为 target 引用，丢失
     *   属于语义破坏，必须告知。
     * meta 子树的规范化（如 <title> 不回写）是设计器既有保存行为，视为预期
     * 规范化，不触发确认。
     */
    private _detectRoundTripLoss(original: string): { reasons: NavEditConfirmReason[]; detail?: string } {
        const reasons: NavEditConfirmReason[] = [];
        const details: string[] = [];

        if (/<!--[\s\S]*?-->/.test(original)) {
            reasons.push('comments');
        }

        const start = original.search(/<view[\s>]/);
        const end = original.lastIndexOf('</view>');
        if (start >= 0 && end > start) {
            // 剔除注释后再扫标签，避免注释内容误报。标签扫描必须尊重引号：
            // 属性值含 '>'（如 text="a > b"）时 [^>]* 一类正则会截断标签，
            // 漏检其后的 name 属性——与 validateViewIds 共用 scanOpenTags
            const viewXml = original.slice(start, end).replace(/<!--[\s\S]*?-->/g, '');
            const structural = new Set(['view', 'events', 'event', 'action']);
            const unknown = new Set<string>();
            const namedTags = new Set<string>();
            for (const openTag of scanOpenTags(viewXml)) {
                const tag = openTag.name;
                if (structural.has(tag)) {
                    continue;
                }
                if (!ComponentRegistry.isValidComponent(tag)) {
                    unknown.add(tag);
                } else if (/\sname\s*=\s*["']/.test(openTag.attrsText)) {
                    namedTags.add(tag);
                }
            }
            if (unknown.size > 0) {
                reasons.push('unknownTags');
                details.push(`unknown: ${[...unknown].join(', ')}`);
            }
            if (namedTags.size > 0) {
                reasons.push('nameAttributes');
                details.push(`name on: ${[...namedTags].join(', ')}`);
            }
        }

        return { reasons, detail: details.length > 0 ? details.join('; ') : undefined };
    }

    /**
     * 控件归属校验：controlId 的最近 hg_view 祖先（或自身）必须是 viewId
     * （与 T2 采集 / T9 枚举的剪枝语义一致——嵌套子屏的控件不属于本屏）。
     */
    private _controlBelongsToView(components: Component[], comp: Component, viewId: string): boolean {
        if (comp.type === 'hg_view') {
            return comp.id === viewId;
        }
        const byId = new Map<string, Component>();
        for (const c of components) {
            if (c?.id) {
                byId.set(c.id, c);
            }
        }
        const seen = new Set<string>([comp.id]);
        let cur: Component | undefined = comp;
        while (cur?.parent) {
            const parent = byId.get(cur.parent);
            if (!parent || seen.has(parent.id)) {
                return false;
            }
            if (parent.type === 'hg_view') {
                return parent.id === viewId;
            }
            seen.add(parent.id);
            cur = parent;
        }
        return false;
    }

    /**
     * 收集写前 SVG 副产物备份：serializeToFile 会对每个含 svgContent 的
     * hg_canvas 写 `${hmlBase}_${id}.svg`（并保留既有 svgFile 指向的文件），
     * 两类路径都纳入备份；写前不存在的文件记 content=null，回滚时删除。
     */
    private _collectSvgBackups(components: Component[], hmlPath: string): SvgBackupEntry[] {
        const hmlDir = path.dirname(hmlPath);
        const hmlBase = path.basename(hmlPath, '.hml');
        const candidatePaths = new Set<string>();

        for (const comp of components) {
            if (comp?.type !== 'hg_canvas') {
                continue;
            }
            if (typeof comp.data?.svgFile === 'string' && comp.data.svgFile) {
                candidatePaths.add(path.join(hmlDir, comp.data.svgFile));
            }
            if (comp.data?.svgContent) {
                candidatePaths.add(path.join(hmlDir, `${hmlBase}_${comp.id}.svg`));
            }
        }

        const backups: SvgBackupEntry[] = [];
        for (const filePath of candidatePaths) {
            let content: string | null = null;
            try {
                if (fs.existsSync(filePath)) {
                    content = fs.readFileSync(filePath, 'utf-8');
                }
            } catch (err) {
                logger.warn(`[NavEditService] 备份 SVG 读取失败 ${filePath}: ${err}`);
            }
            backups.push({ filePath, content });
        }
        return backups;
    }

    /**
     * 复解析校验用序列化：深拷贝 + 剔除 data.svgContent（serializeToFile 写盘
     * 前会把 svgContent 落成 .svg 文件并从 data 中删除；直接 serialize 会把
     * 大段 SVG 内联成属性，既不代表落盘内容也污染校验）。
     */
    private _serializeForVerify(doc: HmlDocument): string {
        const clone: HmlDocument = JSON.parse(JSON.stringify(doc));
        for (const comp of clone.view?.components || []) {
            if (comp?.data && 'svgContent' in comp.data) {
                delete comp.data.svgContent;
            }
        }
        return new HmlSerializer().serialize(clone);
    }

    /**
     * 复解析校验：把序列化结果重新 parse，按预期位置确认改动真实存在。
     * 返回 undefined 表示通过；否则返回失败原因。
     */
    private _verifyMutation(
        content: string,
        absPath: string,
        controlId: string,
        eventType: string,
        kind: 'retarget' | 'deleteAction' | 'deleteEventConfig' | 'create',
        eventConfigIndex: number,
        actionIndex: number,
        expectedEventConfigCount: number,
        expectedActionCount: number,
        expectedTarget?: string
    ): string | undefined {
        let reparsed: HmlDocument;
        try {
            reparsed = new HmlParser().parse(content, absPath);
        } catch (err) {
            return `序列化结果不可解析: ${err instanceof Error ? err.message : String(err)}`;
        }
        const comp = (reparsed.view?.components || []).find(c => c?.id === controlId);
        if (!comp) {
            return `序列化结果中控件丢失: ${controlId}`;
        }
        const eventConfigs = comp.eventConfigs || [];

        switch (kind) {
            case 'retarget':
            case 'create': {
                const eventConfig = eventConfigs[eventConfigIndex];
                if (!eventConfig || eventConfig.type !== eventType) {
                    return `事件配置未按预期存在: index=${eventConfigIndex}`;
                }
                const action = (eventConfig.actions || [])[actionIndex];
                if (!action || action.type !== 'switchView' || action.target !== expectedTarget) {
                    return `action 未按预期写入: 期望 switchView→${expectedTarget}, 实际 ${action?.type ?? 'none'}→${action?.target ?? 'none'}`;
                }
                return undefined;
            }
            case 'deleteAction': {
                const eventConfig = eventConfigs[eventConfigIndex];
                if (!eventConfig || eventConfig.type !== eventType) {
                    return `事件配置未按预期保留: index=${eventConfigIndex}`;
                }
                if ((eventConfig.actions || []).length !== expectedActionCount) {
                    return `action 数不符: 期望 ${expectedActionCount}, 实际 ${(eventConfig.actions || []).length}`;
                }
                return undefined;
            }
            case 'deleteEventConfig': {
                if (eventConfigs.length !== expectedEventConfigCount) {
                    return `事件配置数不符: 期望 ${expectedEventConfigCount}, 实际 ${eventConfigs.length}`;
                }
                return undefined;
            }
        }
    }

    /**
     * 失败回滚：恢复 .hml 与 SVG 备份并逐字节校验。
     * 返回 undefined 表示回滚成功；否则返回失败原因。
     */
    private _rollback(absPath: string, original: string, svgBackups: SvgBackupEntry[]): string | undefined {
        const problems: string[] = [];
        try {
            fs.writeFileSync(absPath, original, 'utf-8');
            const readBack = fs.readFileSync(absPath, 'utf-8');
            if (readBack !== original) {
                problems.push(`.hml 回写后内容不一致: ${absPath}`);
            }
        } catch (err) {
            problems.push(`.hml 回写失败: ${err instanceof Error ? err.message : String(err)}`);
        }

        for (const backup of svgBackups) {
            try {
                if (backup.content === null) {
                    // 写前不存在 → 删除本次可能新建的文件
                    if (fs.existsSync(backup.filePath)) {
                        fs.unlinkSync(backup.filePath);
                    }
                } else {
                    fs.writeFileSync(backup.filePath, backup.content, 'utf-8');
                    const readBack = fs.readFileSync(backup.filePath, 'utf-8');
                    if (readBack !== backup.content) {
                        problems.push(`SVG 回写后内容不一致: ${backup.filePath}`);
                    }
                }
            } catch (err) {
                problems.push(`SVG 回滚失败 ${backup.filePath}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        if (problems.length > 0) {
            logger.error(`[NavEditService] 回滚异常: ${problems.join('; ')}`);
            return problems.join('; ');
        }
        logger.info(`[NavEditService] 已回滚: ${absPath}`);
        return undefined;
    }
}
