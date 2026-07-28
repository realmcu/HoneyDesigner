/**
 * 导航图扫描（纯逻辑，无 vscode 依赖）。
 *
 * 从 FileManager 抽出（评审 I8）：边采集 / 跨文件 target 解析这条读路径原先埋在
 * vscode 耦合的 FileManager 里，纯逻辑无单测。抽到此独立模块后，可在 plain Node /
 * jest 下用 fixtures 直接驱动断言（跨文件同名 view、name≠id、悬空 target、嵌套剪枝、
 * 定时器 segments 仲裁等最难场景）。行为与原实现逐字一致，FileManager 改为委派。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from '../utils/Logger';
import type { Component } from '../hml/types';
import { forEachLiveTimerSwitchView } from '../hml/timerNav';
import { HmlController } from '../hml/HmlController';
import { ProjectUtils } from '../utils/ProjectUtils';
import type { ViewNavEdge, ControlNavEdge, TimerNavEdge } from '../shared/navContract';

/**
 * 视图节点（导航图数据模型）
 * 旧字段 id/name/file/edges 保持向后兼容；新字段全部可选。
 */
export interface ViewNavNode {
    id: string;
    name: string;
    /** 旧字段：文件名去 .hml（向后兼容；跨目录可能撞名，新逻辑请用 viewKey） */
    file: string;
    edges: ViewNavEdge[];
    /** 复合键：relPath#viewId */
    viewKey?: string;
    /** 所属文件绝对路径 */
    filePath?: string;
    /** 所属文件相对项目根路径（正斜杠） */
    fileRelative?: string;
    /** 扫描时文件 mtime（ms） */
    fileMtime?: number;
    /** 扫描时文件内容 hash（sha1） */
    fileHash?: string;
}

/** 采集边时的单文件上下文 */
interface ViewScanFileContext {
    filePath: string;
    fileRelative: string;
    fileMtime: number;
    fileHash: string;
    viewKey: string;
}

/**
 * 递归扫描目录下所有 HML 文件
 */
export function scanHmlFilesRecursive(
    dir: string,
    projectRoot: string
): Array<{ path: string; name: string; relativePath: string }> {
    const results: Array<{ path: string; name: string; relativePath: string }> = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...scanHmlFilesRecursive(fullPath, projectRoot));
        } else if (entry.isFile() && entry.name.endsWith('.hml')) {
            results.push({
                path: fullPath,
                name: entry.name,
                relativePath: path.relative(projectRoot, fullPath)
            });
        }
    }
    return results;
}

/**
 * 扫描项目中所有 HML 文件
 */
export function scanAllHmlFiles(
    currentFilePath: string
): Array<{ path: string; name: string; relativePath: string }> {
    const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
    if (!projectRoot) {
        return [];
    }

    const uiDir = ProjectUtils.getUiDir(projectRoot);
    return scanHmlFilesRecursive(uiDir, projectRoot);
}

/**
 * 扫描项目中所有 HML 文件的 view（包含跳转关系）
 *
 * 组件是扁平模型（children 是 id 数组、parent 是 id 引用），
 * 这里对每个 hg_view 沿 parent→children 索引向下遍历，
 * 收集自身 + 后代控件（含定时器）的 switchView 边；
 * 遇嵌套 hg_view 剪枝——子屏的边归子屏节点。
 */
export async function scanAllViews(
    currentFilePath: string,
    metrics?: { hmlReads?: number; hmlParses?: number }
): Promise<ViewNavNode[]> {
    const projectRoot = ProjectUtils.findProjectRoot(currentFilePath);
    if (!projectRoot) {
        return [];
    }

    const uiDir = ProjectUtils.getUiDir(projectRoot);
    const hmlFiles = scanHmlFilesRecursive(uiDir, projectRoot);
    const allViews: ViewNavNode[] = [];
    // 全局 viewId / viewName → 复合键列表（第二遍解析 target 有效性/撞名）。
    // 需要双查找的语义根据：codegen 按 view 的 **name** 注册视图
    // （ViewGenerator GUI_VIEW_INSTANCE("${component.name}")），同文件 target
    // 会被 codegen 映射 id→name，跨文件 target 原样透传——运行时按 name 跳转。
    // 手写 HML 中 name≠id 时，target 写 id 或 name 都可能是用户意图，
    // 命中任一且唯一才算 valid；跨 id/name 命中多个 view 视为歧义
    const viewKeysById = new Map<string, string[]>();
    const viewKeysByName = new Map<string, string[]>();
    const pendingEdges: ViewNavEdge[] = [];

    for (const hmlFile of hmlFiles) {
        try {
            const content = fs.readFileSync(hmlFile.path, 'utf-8');
            if (metrics) {
                metrics.hmlReads = (metrics.hmlReads || 0) + 1;
            }
            const fileMtime = fs.statSync(hmlFile.path).mtimeMs;
            const fileHash = crypto.createHash('sha1').update(content, 'utf8').digest('hex');
            const fileRelative = hmlFile.relativePath.replace(/\\/g, '/');
            // 旧字段：文件名去 .hml（向后兼容）
            const fileId = hmlFile.name.replace('.hml', '');

            const tempController = new HmlController();
            const doc = tempController.parseContent(content, hmlFile.path);
            if (metrics) {
                metrics.hmlParses = (metrics.hmlParses || 0) + 1;
            }
            const components: Component[] = doc.view?.components || [];

            // 扁平模型 → id→component 与 parent→children[] 索引（T9 getViewControls 复用）
            const { childrenOf } = buildComponentIndex(components);

            for (const comp of components) {
                if (comp?.type !== 'hg_view') {
                    continue;
                }

                const viewKey = `${fileRelative}#${comp.id}`;
                viewKeysById.set(comp.id, [...(viewKeysById.get(comp.id) || []), viewKey]);
                if (comp.name) {
                    viewKeysByName.set(comp.name, [...(viewKeysByName.get(comp.name) || []), viewKey]);
                }

                const fileCtx: ViewScanFileContext = {
                    filePath: hmlFile.path,
                    fileRelative,
                    fileMtime,
                    fileHash,
                    viewKey,
                };

                const edges: ViewNavEdge[] = [];
                // 1) view 自身（屏手势事件 + 定时器）
                collectComponentSwitchViewEdges(comp, true, fileCtx, edges);
                // 2) 后代控件，遇嵌套 hg_view 剪枝（子屏的边归子屏）
                const queue: Component[] = [...(childrenOf.get(comp.id) || [])];
                while (queue.length > 0) {
                    const child = queue.shift()!;
                    if (child.type === 'hg_view') {
                        continue;
                    }
                    collectComponentSwitchViewEdges(child, false, fileCtx, edges);
                    queue.push(...(childrenOf.get(child.id) || []));
                }

                pendingEdges.push(...edges);
                allViews.push({
                    id: comp.id,
                    name: comp.name || comp.id,
                    file: fileId,
                    edges,
                    viewKey,
                    filePath: hmlFile.path,
                    fileRelative,
                    fileMtime,
                    fileHash,
                });
            }
        } catch (err) {
            logger.warn(`扫描 ${hmlFile.path} 失败: ${err}`);
        }
    }

    // 第二遍：解析 target → 有效性 / 撞名 / 目标复合键。
    // id 与 name 双查找（语义根据见上方 viewKeysByName 注释：运行时按 name
    // 注册/跳转，target 命中 id 或 name 任一且唯一 → valid；同一 view 的
    // id===name 时两个 map 落到相同复合键，用 Set 去重不算歧义）
    // 注：同文件重复 id 已被 parser 静默合并，采集端无法还原（已知限制）
    for (const edge of pendingEdges) {
        const targetKeys = new Set<string>([
            ...(viewKeysById.get(edge.target) || []),
            ...(viewKeysByName.get(edge.target) || []),
        ]);
        edge.isValid = targetKeys.size >= 1;
        edge.targetAmbiguous = targetKeys.size > 1;
        edge.targetViewKey = targetKeys.size === 1 ? [...targetKeys][0] : undefined;
    }

    return allViews;
}

/**
 * 扁平组件表 → id→component 与 parent→children[] 索引（T2/T9 共用）
 */
export function buildComponentIndex(components: Component[]): {
    byId: Map<string, Component>;
    childrenOf: Map<string, Component[]>;
} {
    const byId = new Map<string, Component>();
    const childrenOf = new Map<string, Component[]>();
    for (const comp of components) {
        if (comp?.id) {
            byId.set(comp.id, comp);
        }
    }
    for (const comp of components) {
        if (comp?.parent && byId.has(comp.parent)) {
            const siblings = childrenOf.get(comp.parent);
            if (siblings) {
                siblings.push(comp);
            } else {
                childrenOf.set(comp.parent, [comp]);
            }
        }
    }
    return { byId, childrenOf };
}

/**
 * 采集单个组件上的所有 switchView 边（事件动作 + 定时器动作）
 */
function collectComponentSwitchViewEdges(
    comp: Component,
    sourceIsView: boolean,
    fileCtx: ViewScanFileContext,
    out: ViewNavEdge[]
): void {
    // 事件动作里的 switchView
    (comp.eventConfigs || []).forEach((eventConfig, eventConfigIndex) => {
        (eventConfig.actions || []).forEach((action, actionIndex) => {
            if (action.type !== 'switchView' || !action.target) {
                return;
            }
            out.push(buildNavEdge(comp, fileCtx, {
                target: action.target,
                eventType: eventConfig.type,
                eventConfigIndex,
                actionIndex,
                sourceIsView,
                sourceIsTimer: false,
                switchOutStyle: action.switchOutStyle,
                switchInStyle: action.switchInStyle,
            }));
        });
    });

    // 定时器动作里的 switchView（只读边）。采集谓词与悬空目标校验共享
    // forEachLiveTimerSwitchView（评审 I2：单一事实源，避免两端漂移）——
    // 边显示当且仅当 codegen 实际会生成 gui_obj_create_timer 绑定。
    forEachLiveTimerSwitchView(comp, sourceIsView, ({ action, timerIndex, timerId, segmentIndex, actionIndex }) => {
        out.push(buildNavEdge(comp, fileCtx, {
            target: action.target!,
            eventType: 'timer',
            eventConfigIndex: timerIndex,
            actionIndex,
            sourceIsView,
            sourceIsTimer: true,
            timerId,
            segmentIndex,
            switchOutStyle: action.switchOutStyle,
            switchInStyle: action.switchInStyle,
        }));
    });
}

/**
 * 构造一条导航边，edgeId 由定位字段 hash 生成（跨扫描稳定）
 */
function buildNavEdge(
    comp: Component,
    fileCtx: ViewScanFileContext,
    info: {
        target: string;
        eventType: string;
        eventConfigIndex: number;
        actionIndex: number;
        sourceIsView: boolean;
        sourceIsTimer: boolean;
        timerId?: string;
        segmentIndex?: number;
        switchOutStyle?: string;
        switchInStyle?: string;
    }
): ViewNavEdge {
    const locator = [
        fileCtx.fileRelative,
        fileCtx.viewKey,
        comp.id,
        info.sourceIsTimer ? 'timer' : 'event',
        info.timerId ?? '',
        info.segmentIndex ?? '',
        info.eventType,
        info.eventConfigIndex,
        info.actionIndex,
        info.target,
    ].join('|');
    const edgeId = crypto.createHash('sha1').update(locator, 'utf8').digest('hex').slice(0, 16);

    // 公共快照 / 定位字段（control 与 timer 边一致；isValid / targetAmbiguous /
    // targetViewKey 由第二遍全局解析填充）。
    const common = {
        // 旧字段（向后兼容）
        target: info.target,
        event: info.eventType,
        switchOutStyle: info.switchOutStyle,
        switchInStyle: info.switchInStyle,
        // 新字段
        edgeId,
        sourceFilePath: fileCtx.filePath,
        sourceFileRelative: fileCtx.fileRelative,
        sourceViewKey: fileCtx.viewKey,
        sourceControlId: comp.id,
        sourceControlName: comp.name || comp.id,
        sourceControlType: comp.type,
        sourceIsView: info.sourceIsView,
        eventType: info.eventType,
        eventConfigIndex: info.eventConfigIndex,
        actionIndex: info.actionIndex,
        sourceFileMtime: fileCtx.fileMtime,
        sourceFileHash: fileCtx.fileHash,
    };

    // 判别联合（评审 I6）：定时器边只读、带 timerId/segmentIndex；控件/view 边可编辑。
    if (info.sourceIsTimer) {
        const timerEdge: TimerNavEdge = {
            ...common,
            kind: 'timer',
            sourceIsTimer: true,
            timerId: info.timerId,
            segmentIndex: info.segmentIndex,
        };
        return timerEdge;
    }
    const controlEdge: ControlNavEdge = {
        ...common,
        kind: 'control',
        sourceIsTimer: false,
    };
    return controlEdge;
}
