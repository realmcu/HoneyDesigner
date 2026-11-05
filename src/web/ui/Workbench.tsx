/**
 * 浏览器版工作台：顶部工程栏 + 复用的 React 设计器
 */
import React, { useEffect, useRef, useState } from 'react';
import * as path from 'path';
import App from '../../webview/App';
import { useDesignerStore } from '../../webview/store';
import { clearUriCache } from '../../webview/hooks/useWebviewUri';
import { clearFontCache } from '../../webview/hooks/useFontLoader';
import { t } from '../../webview/i18n';
import { HmlTemplateManager } from '../../hml/HmlTemplateManager';
import {
    StoredProject,
    ProjectSync,
    SyncState,
    loadProjectIntoVfs,
    hasDirectoryPermission,
    requestDirectoryPermission,
} from '../host/projectStore';
import { openDesigner, findMainHml, OpenedDesigner } from '../host/browserHost';
import { exportProjectZip, downloadBlob } from '../host/projectZip';
import { hostUi } from '../host/hostUi';
import * as fs from '../shims/fs';

interface WorkbenchProps {
    project: StoredProject;
    onClose(): void;
}

type Phase =
    | { kind: 'permission' }
    | { kind: 'loading' }
    | { kind: 'ready'; opened: OpenedDesigner; sync: ProjectSync }
    | { kind: 'error'; message: string };

/** 新建 HML 文件的文件名规则：与组件 id 命名一致，避免生成非法控件名 */
const HML_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 关闭或切换工程前清空内存文件系统中的工程目录，避免多个工程的文件残留 */
function unloadProjectFiles(root: string): void {
    fs.rmSync(root, { recursive: true, force: true });
}

export function Workbench({ project, onClose }: WorkbenchProps) {
    const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
    const [syncState, setSyncState] = useState<SyncState>('idle');
    const [attempt, setAttempt] = useState(0);
    const currentFilePath = useDesignerStore(state => state.currentFilePath);
    const openedRef = useRef<{ opened?: OpenedDesigner; sync?: ProjectSync; root?: string }>({});

    useEffect(() => {
        let cancelled = false;

        const start = async () => {
            if (project.mode === 'directory' && project.handle && !(await hasDirectoryPermission(project.handle))) {
                setPhase({ kind: 'permission' });
                return;
            }
            setPhase({ kind: 'loading' });
            try {
                const root = await loadProjectIntoVfs(project);
                openedRef.current.root = root;
                const hmlPath = findMainHml(root);
                if (!hmlPath) {
                    throw new Error(t('No HML file found in the ui/ folder'));
                }
                const sync = new ProjectSync(project, root);
                sync.onStateChange(state => setSyncState(state));
                const opened = await openDesigner(root, hmlPath, project.id);
                if (cancelled) {
                    opened.dispose();
                    sync.dispose();
                    return;
                }
                // App 在挂载时读取 window.vscodeAPI 并发送 ready
                window.vscodeAPI = opened.panel.createDesignerApi();
                openedRef.current = { opened, sync, root };
                setPhase({ kind: 'ready', opened, sync });
            } catch (error) {
                if (!cancelled) {
                    setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
                }
            }
        };
        void start();

        return () => {
            cancelled = true;
            const { opened, sync, root } = openedRef.current;
            opened?.dispose();
            void sync?.flush().finally(() => {
                sync.dispose();
                if (root) {
                    unloadProjectFiles(root);
                }
            });
            if (!sync && root) {
                unloadProjectFiles(root);
            }
            openedRef.current = {};
            window.vscodeAPI = undefined;
            // 资源 URI 缓存以工程内相对路径为键，切换工程后必须失效
            clearUriCache();
            clearFontCache();
            // 重置设计器内存状态，下次打开工程时从空白开始
            useDesignerStore.setState(useDesignerStore.getInitialState(), true);
        };
    }, [project, attempt]);

    const grantPermission = async () => {
        if (project.handle && await requestDirectoryPermission(project.handle)) {
            setAttempt(n => n + 1);
        }
    };

    const exportZip = async () => {
        if (phase.kind !== 'ready') {
            return;
        }
        await phase.sync.flush();
        const zip = exportProjectZip(phase.opened.projectRoot, project.name);
        downloadBlob(zip, `${project.name}.zip`);
    };

    const showCode = () => {
        if (phase.kind === 'ready') {
            void hostUi.showCode('');
        }
    };

    /** 在 ui/ 下新建 HML 文件并切换过去（工程文件树的替代入口） */
    const createHmlFile = async () => {
        if (phase.kind !== 'ready') {
            return;
        }
        const root = phase.opened.projectRoot;
        const uiDir = path.posix.join(root, 'ui');
        const existing = new Set(fs.vfs.listFiles(uiDir)
            .map(file => path.posix.basename(file).toLowerCase()));

        const name = await hostUi.showInput({
            prompt: t('New HML File'),
            placeHolder: t('HML file name'),
            validateInput: value => {
                const base = value.trim().replace(/\.hml$/i, '');
                // 尚未输入时不报错，交由确认按钮的空值检查拦截
                if (!base) {
                    return undefined;
                }
                if (!HML_NAME_PATTERN.test(base)) {
                    return t('Use letters, numbers and underscores; start with a letter or underscore.');
                }
                return existing.has(`${base.toLowerCase()}.hml`) ? t('An HML file with this name already exists in ui/.') : undefined;
            },
        });
        const fileName = name?.trim().replace(/\.hml$/i, '');
        if (!fileName) {
            return;
        }
        if (useDesignerStore.getState().isDirty
            && !globalThis.confirm(t('The design has unsaved changes. Switch files and discard them?'))) {
            return;
        }

        const target = path.posix.join(uiDir, `${fileName}.hml`);
        try {
            const config = useDesignerStore.getState().projectConfig;
            fs.mkdirSync(uiDir, { recursive: true });
            fs.writeFileSync(target, HmlTemplateManager.generateMainHml(
                fileName,
                config?.resolution || '480X272',
                config?.appId,
                config?.minSdk,
                config?.pixelMode,
                false
            ), 'utf8');
        } catch (cause) {
            void hostUi.showMessage('error', t('Failed to create HML file: {0}', cause instanceof Error ? cause.message : String(cause)), [], false);
            return;
        }

        useDesignerStore.getState().clearSelection();
        useDesignerStore.getState().setSelectedAsset(null);
        window.vscodeAPI?.postMessage({ command: 'switchFile', filePath: target });
    };

    /**
     * 删除当前打开的 HML 文件。
     *
     * 拦截三种情况，避免删出「工程打不开」或「跳转全断」：
     * ① project.json 指定的 mainHmlFile —— 删掉它等于毁了工程入口；
     * ② ui/ 下最后一个 HML —— 设计器没有可打开的文件；
     * ③ 被其它 HML 的 switchView 引用的 view —— 删除后跳转变成断链。
     * 前两条直接拒绝；第三条列出被谁引用，用户确认后才删。
     */
    const confirmDeleteHml = (target: string): boolean => {
        const sel = useDesignerStore.getState();
        const root = phase.kind === 'ready' ? phase.opened.projectRoot : '';
        const rel = path.posix.relative(root, target);

        // mainHmlFile 不在 ProjectConfig 接口里（各工程自行扩展），直接读 project.json
        let mainHml: unknown;
        try {
            const raw = fs.readFileSync(path.posix.join(root, 'project.json'), 'utf8') as string;
            mainHml = (JSON.parse(raw) as { mainHmlFile?: unknown }).mainHmlFile;
        } catch {
            // 读不到就当没有主文件声明，继续走后面的检查
        }
        if (typeof mainHml === 'string' && path.posix.normalize(mainHml) === path.posix.normalize(rel)) {
            void hostUi.showMessage('warning', t('Cannot delete the main HML file declared in project.json. Set another mainHmlFile first.'), [], true);
            return false;
        }
        if ((sel.allHmlFiles || []).filter(f => f.path !== target).length === 0) {
            void hostUi.showMessage('warning', t('This is the only HML file in the project. Create another one before deleting it.'), [], true);
            return false;
        }

        // 被引用：其它文件里的 switchView 以本文件某个 view 为 target
        const doomed = (sel.allViews || []).filter(v => v.filePath && path.posix.resolve(v.filePath) === path.posix.resolve(target));
        const doomedKeys = new Set(doomed.map(v => v.viewKey ?? v.id));
        const doomedNames = new Set(doomed.map(v => v.id).concat(doomed.map(v => v.name)));
        const inbound = new Set<string>();
        for (const view of sel.allViews || []) {
            if (doomedKeys.has(view.viewKey ?? view.id)) {
                continue;
            }
            for (const edge of view.edges || []) {
                const hits = edge.targetViewKey
                    ? doomedKeys.has(edge.targetViewKey)
                    : doomedNames.has(edge.target);
                if (hits) {
                    inbound.add(`${view.fileRelative ?? view.file}#${view.id}`);
                }
            }
        }

        const prompt = inbound.size > 0
            ? t('The following views link to "{0}": {1}. Deleting it will break those jumps. Delete anyway?', rel, [...inbound].join(', '))
            : t('Delete "{0}"? This cannot be undone.', rel);
        return globalThis.confirm(prompt);
    };

    const deleteHmlFile = async () => {
        if (phase.kind !== 'ready' || !currentFilePath) {
            return;
        }
        const target = currentFilePath;
        const sel = useDesignerStore.getState();

        if (sel.isDirty && !globalThis.confirm(t('The design has unsaved changes. Switch files and discard them?'))) {
            return;
        }
        if (!confirmDeleteHml(target)) {
            return;
        }

        try {
            // 先把待同步的改动落盘，避免删除后残留脏队列又把它写回去
            await phase.sync.flush();
            fs.rmSync(target);

            const root = phase.opened.projectRoot;
            const fallback = (sel.allHmlFiles || [])
                .map(f => f.path)
                .filter(p => p !== target)
                .sort((a, b) => path.posix.relative(root, a).split('/').length - path.posix.relative(root, b).split('/').length
                    || a.localeCompare(b))[0];
            if (!fallback) {
                // 理论到不了这里（confirmDeleteHml 已拦截），兜底防崩
                return;
            }

            sel.clearSelection();
            sel.setSelectedAsset(null);
            window.vscodeAPI?.postMessage({ command: 'switchFile', filePath: fallback });
            void hostUi.showMessage('info', t('Deleted "{0}".', path.posix.relative(root, target)), [], false);
        } catch (cause) {
            void hostUi.showMessage('error', t('Failed to delete HML file: {0}', cause instanceof Error ? cause.message : String(cause)), [], false);
        }
    };

    const close = async () => {
        if (phase.kind === 'ready') {
            if (useDesignerStore.getState().isDirty && !globalThis.confirm(t('The design has unsaved changes. Close anyway?'))) {
                return;
            }
            await phase.sync.flush();
        }
        onClose();
    };

    const syncLabel = syncState === 'saving' ? t('Saving...')
        : syncState === 'error' ? t('Save failed')
        : project.mode === 'directory' ? t('Local folder') : t('Browser storage');

    return (
        <div className="web-workbench">
            <div className="web-topbar">
                <button className="web-button" onClick={close}>← {t('Back to Projects')}</button>
                <span className="web-topbar-title">{project.name}</span>
                {phase.kind === 'ready' && currentFilePath && (
                    <span className="web-topbar-file" title={path.posix.relative(phase.opened.projectRoot, currentFilePath)}>
                        {path.posix.relative(phase.opened.projectRoot, currentFilePath)}
                    </span>
                )}
                <span className={`web-sync web-sync-${syncState}`}>{syncLabel}</span>
                <span className="web-topbar-spacer" />
                <button className="web-button" onClick={() => void createHmlFile()} disabled={phase.kind !== 'ready'}>{t('New HML File')}</button>
                <button
                    className="web-button"
                    onClick={() => void deleteHmlFile()}
                    disabled={phase.kind !== 'ready' || !currentFilePath}
                    title={currentFilePath ? path.posix.relative(phase.kind === 'ready' ? phase.opened.projectRoot : '', currentFilePath) : undefined}
                >
                    {t('Delete HML File')}
                </button>
                <button className="web-button" onClick={showCode} disabled={phase.kind !== 'ready'}>{t('Generated Code')}</button>
                <button className="web-button primary" onClick={exportZip} disabled={phase.kind !== 'ready'}>{t('Export ZIP')}</button>
            </div>
            <div className="web-designer-host">
                {phase.kind === 'ready' && (
                    <div className="web-workspace">
                        <div className="web-workspace-designer"><App key={project.id} /></div>
                    </div>
                )}
                {phase.kind === 'loading' && <div className="web-center web-muted">{t('Loading...')}</div>}
                {phase.kind === 'permission' && (
                    <div className="web-center">
                        <p>{t('The browser needs permission to access the local folder "{0}".', project.name)}</p>
                        <button className="web-button primary" onClick={grantPermission}>{t('Grant Access')}</button>
                    </div>
                )}
                {phase.kind === 'error' && (
                    <div className="web-center">
                        <p className="web-field-error">{phase.message}</p>
                        <button className="web-button" onClick={onClose}>{t('Back to Projects')}</button>
                    </div>
                )}
            </div>
        </div>
    );
}
