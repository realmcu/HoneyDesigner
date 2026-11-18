import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { logger } from '../utils/Logger';
import { ProjectUtils } from '../utils/ProjectUtils';
import { HmlParser } from '../hml/HmlParser';
import { HmlSerializer } from '../hml/HmlSerializer';
import { diffCatalogKeys, exceedsAutoReconcileLimit } from '../project-i18n/catalogDiff';
import { catalogsEqual, mergeCatalogExternalChanges } from '../project-i18n/catalogMerge';
import { readProjectI18nCatalogFile } from '../project-i18n/files';
import type { I18nCatalog } from '../project-i18n/types';
import { PendingWriteRegistry } from './PendingWriteRegistry';

/** 自动对账时允许的 key 变化上限；超过视为批量变化（切分支、整体导入），不改写 HML */
const MAX_AUTO_RECONCILE_KEYS = 8;

export interface HmlI18nRewritePlan {
    /** 旧 key -> 新 key；值为 undefined 表示解绑该组件的 i18nKey */
    replacements: Map<string, string | undefined>;
    /** 解绑时回写组件 text 的文本，按旧 key 索引 */
    fallbackTexts?: Map<string, string>;
}

export interface HmlI18nRewriteResult {
    files: string[];
    components: number;
}

export interface CatalogSaveResolution {
    catalog: I18nCatalog;
    /** 是否与磁盘现值做了三方合并（磁盘在本地快照之后被外部改过） */
    merged: boolean;
    adoptedKeys: string[];
    conflictedKeys: string[];
}

interface ProjectSyncState {
    /** 本宿主最后一次见到的合法 catalog；外部改动与保存合并都以它为基准 */
    lastKnownCatalog?: I18nCatalog;
    /** 已对账过的磁盘内容 hash：多个面板各有一个 watcher，同一份内容只对账一次 */
    lastReconciledHash?: string;
    /** 已提示过非法 JSON 的内容 hash，避免每次写盘都弹窗 */
    lastInvalidWarnHash?: string;
    /** 下发过的 catalog 快照：页面保存时带回来的版本号 → 当时的 catalog */
    catalogByRevision: Map<string, I18nCatalog>;
}

const MAX_REMEMBERED_REVISIONS = 8;

/**
 * 项目级多语言同步：保证「表格（webview 内存）」与「i18n/strings.json（磁盘）」
 * 在外部改动时收敛到同一份数据，并把 key 变化对账到 HML 的 i18nKey 引用。
 *
 * 按项目根目录共享状态，不能挂在 FileManager 上加——同一项目可能有多个设计器面板，
 * 每个面板都有自己的 watcher。
 */
export class ProjectI18nSyncService {
    private static readonly _states = new Map<string, ProjectSyncState>();

    private static _stateFor(projectRoot: string): ProjectSyncState {
        const key = PendingWriteRegistry.normalizePathKey(projectRoot);
        let state = ProjectI18nSyncService._states.get(key);
        if (!state) {
            state = { catalogByRevision: new Map() };
            ProjectI18nSyncService._states.set(key, state);
        }
        return state;
    }

    /**
     * 记录本宿主视为权威的 catalog 快照（读盘、写盘、外部推送后都要更新）。
     *
     * @returns 该快照的版本号；随 catalog 下发给 webview，保存时带回作为合并基准
     */
    public static rememberCatalog(projectRoot: string, catalog: I18nCatalog): string {
        const state = ProjectI18nSyncService._stateFor(projectRoot);
        state.lastKnownCatalog = catalog;

        const revision = createHash('sha1').update(JSON.stringify(catalog), 'utf8').digest('hex');
        state.catalogByRevision.delete(revision);
        state.catalogByRevision.set(revision, catalog);
        while (state.catalogByRevision.size > MAX_REMEMBERED_REVISIONS) {
            const oldest = state.catalogByRevision.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            state.catalogByRevision.delete(oldest);
        }
        return revision;
    }

    /**
     * 磁盘上的 strings.json 被外部改动（Agent 写盘、手工编辑、git 操作）后调用。
     *
     * 除更新缓存外，还会把 key 的删除 / 改名对账到 HML 的 i18nKey 引用上，
     * 与表格内删除、改名按钮的行为保持一致。
     *
     * @returns 需要改写 HML 时的后台任务；无变化、已处理过或超出批量上限时为 undefined
     */
    public static handleExternalCatalogChange(
        projectRoot: string,
        catalog: I18nCatalog,
        contentHash: string | undefined,
    ): Promise<HmlI18nRewriteResult> | undefined {
        const state = ProjectI18nSyncService._stateFor(projectRoot);
        if (contentHash && state.lastReconciledHash === contentHash) {
            return undefined;
        }
        state.lastReconciledHash = contentHash;

        const previous = state.lastKnownCatalog;
        state.lastKnownCatalog = catalog;
        if (!previous) {
            return undefined;
        }

        const changes = diffCatalogKeys(previous, catalog);
        if (changes.removed.length === 0) {
            return undefined;
        }

        if (exceedsAutoReconcileLimit(changes, { maxKeys: MAX_AUTO_RECONCILE_KEYS })) {
            void vscode.window.showWarningMessage(vscode.l10n.t(
                'i18n/strings.json changed {0} keys at once, skipped syncing HML i18n keys automatically.',
                changes.removed.length + changes.added.length,
            ));
            logger.warn(
                `[ProjectI18nSync] 词条变化过多（删除 ${changes.removed.length} / 新增 ${changes.added.length}），` +
                '跳过自动改写 HML',
            );
            return undefined;
        }

        const replacements = new Map<string, string | undefined>();
        for (const rename of changes.renamed) {
            replacements.set(rename.from, rename.to);
        }
        const fallbackTexts = new Map<string, string>();
        for (const key of changes.deleted) {
            replacements.set(key, undefined);
            const fallback = previous.strings[key]?.[previous.defaultLocale];
            if (fallback) {
                fallbackTexts.set(key, fallback);
            }
        }

        return ProjectI18nSyncService.rewriteHmlI18nReferences(projectRoot, {
            replacements,
            fallbackTexts,
        }).then((result) => {
            if (result.components > 0) {
                logger.info(
                    `[ProjectI18nSync] 已按外部词条变化同步 ${result.components} 个组件引用，` +
                    `涉及 ${result.files.length} 个 HML 文件`,
                );
            }
            return result;
        }).catch((error) => {
            logger.warn(`[ProjectI18nSync] 自动同步 HML 词条引用失败: ${error}`);
            return { files: [], components: 0 };
        });
    }

    /**
     * 扫描项目 HML，按 plan 改写组件的 i18nKey。
     *
     * 直接写盘、不登记预期写入：改写属于外部可见变更，打开这些文件的面板应当
     * 收到一次外部改动提示（有未保存改动时由用户决定是否重载）。
     */
    public static async rewriteHmlI18nReferences(
        projectRoot: string,
        plan: HmlI18nRewritePlan,
    ): Promise<HmlI18nRewriteResult> {
        const result: HmlI18nRewriteResult = { files: [], components: 0 };
        if (plan.replacements.size === 0) {
            return result;
        }

        // 先让面板把排队中的自动保存落盘：否则它们随后写出的旧快照会把这里改好的引用改回去
        const { DesignerPanel } = require('./DesignerPanel') as typeof import('./DesignerPanel');
        await DesignerPanel.flushPendingSavesForProject(projectRoot);

        const uiDir = ProjectUtils.getUiDir(projectRoot);
        if (!fs.existsSync(uiDir)) {
            return result;
        }

        const hmlFiles: string[] = [];
        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.hml')) {
                    hmlFiles.push(fullPath);
                }
            }
        };
        walk(uiDir);

        const parser = new HmlParser();
        const serializer = new HmlSerializer();
        for (const file of hmlFiles) {
            try {
                const document = parser.parse(fs.readFileSync(file, 'utf-8'), file);
                const components = document.view?.components || [];
                let changed = false;
                for (const component of components) {
                    const data = component.data as Record<string, unknown> | undefined;
                    const currentKey = String(data?.i18nKey || '').trim();
                    if (!currentKey || !plan.replacements.has(currentKey)) {
                        continue;
                    }

                    const nextKey = plan.replacements.get(currentKey);
                    if (nextKey === undefined) {
                        delete data!.i18nKey;
                        const fallback = plan.fallbackTexts?.get(currentKey);
                        if (fallback) {
                            data!.text = fallback;
                        }
                    } else {
                        data!.i18nKey = nextKey;
                    }
                    changed = true;
                    result.components++;
                }

                if (changed) {
                    await serializer.serializeToFile(document, file);
                    result.files.push(file);
                }
            } catch (error: any) {
                logger.warn(`[ProjectI18nSync] 改写词条引用时跳过文件 ${file}: ${error?.message || error}`);
            }
        }

        return result;
    }

    /**
     * 表格保存前的落盘决策：磁盘在本页面快照之后被外部改过时做三方合并，
     * 否则直接写页面提交的内容。
     *
     * @param baseRevision 页面提交的快照所基于的宿主版本；取不到时退回最近一次已知快照
     */
    public static resolveCatalogForSave(
        projectRoot: string,
        submitted: I18nCatalog,
        baseRevision?: string,
    ): CatalogSaveResolution {
        const state = ProjectI18nSyncService._stateFor(projectRoot);
        const base = (baseRevision ? state.catalogByRevision.get(baseRevision) : undefined)
            ?? state.lastKnownCatalog;
        const disk = readProjectI18nCatalogFile(projectRoot, submitted.defaultLocale);

        // 磁盘内容非法：以页面提交的内容为准覆盖，避免把坏文件留在项目里
        if (!disk.catalog || !base || catalogsEqual(disk.catalog, base) || catalogsEqual(disk.catalog, submitted)) {
            return { catalog: submitted, merged: false, adoptedKeys: [], conflictedKeys: [] };
        }

        const merge = mergeCatalogExternalChanges(base, submitted, disk.catalog);
        if (merge.conflictedKeys.length > 0) {
            logger.warn(
                `[ProjectI18nSync] 词条同时被本地和外部修改，已保留本地输入: ${merge.conflictedKeys.join(', ')}`,
            );
        }
        return {
            catalog: merge.catalog,
            merged: !catalogsEqual(merge.catalog, submitted),
            adoptedKeys: merge.adoptedKeys,
            conflictedKeys: merge.conflictedKeys,
        };
    }

    /** 磁盘上的 strings.json 不是合法 JSON 时提示一次（按内容 hash 去重） */
    public static reportInvalidCatalog(projectRoot: string, error: string | undefined, contentHash?: string): void {
        const state = ProjectI18nSyncService._stateFor(projectRoot);
        if (contentHash && state.lastInvalidWarnHash === contentHash) {
            return;
        }
        state.lastInvalidWarnHash = contentHash;
        logger.warn(`[ProjectI18nSync] i18n/strings.json 不是合法 JSON，保持上一次的目录: ${error}`);
        void vscode.window.showWarningMessage(vscode.l10n.t(
            'i18n/strings.json is not valid JSON, the previous i18n catalog is kept: {0}',
            String(error ?? ''),
        ));
    }
}
