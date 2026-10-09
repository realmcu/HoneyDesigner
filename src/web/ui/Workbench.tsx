/**
 * 浏览器版工作台：顶部工程栏 + 复用的 React 设计器
 */
import React, { useEffect, useRef, useState } from 'react';
import * as path from 'path';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import App from '../../webview/App';
import { useDesignerStore } from '../../webview/store';
import { clearUriCache } from '../../webview/hooks/useWebviewUri';
import { clearFontCache } from '../../webview/hooks/useFontLoader';
import { t } from '../../webview/i18n';
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
import * as vscode from '../shims/vscode';
import { ProjectExplorer } from './ProjectExplorer';

interface WorkbenchProps {
    project: StoredProject;
    onClose(): void;
}

type Phase =
    | { kind: 'permission' }
    | { kind: 'loading' }
    | { kind: 'ready'; opened: OpenedDesigner; sync: ProjectSync }
    | { kind: 'error'; message: string };

/** 关闭或切换工程前清空内存文件系统中的工程目录，避免多个工程的文件残留 */
function unloadProjectFiles(root: string): void {
    fs.rmSync(root, { recursive: true, force: true });
}

export function Workbench({ project, onClose }: WorkbenchProps) {
    const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
    const [syncState, setSyncState] = useState<SyncState>('idle');
    const [attempt, setAttempt] = useState(0);
    const [explorerVisible, setExplorerVisible] = useState(true);
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

    const openFile = (filePath: string) => {
        if (phase.kind !== 'ready' || filePath === currentFilePath) return;
        if (useDesignerStore.getState().isDirty
            && !globalThis.confirm(t('The design has unsaved changes. Switch files and discard them?'))) {
            return;
        }
        useDesignerStore.getState().clearSelection();
        useDesignerStore.getState().setSelectedAsset(null);
        window.vscodeAPI?.postMessage({ command: 'switchFile', filePath });
    };

    const deleteFile = async (filePath: string): Promise<boolean> => {
        if (phase.kind !== 'ready') return false;
        const root = phase.opened.projectRoot;
        const uiDir = path.posix.join(root, 'ui');
        if (!filePath.startsWith(`${uiDir}/`) || !filePath.toLowerCase().endsWith('.hml')
            || !fs.existsSync(filePath)) return false;

        const mainHmlPath = findMainHml(root);
        if (filePath === mainHmlPath) {
            void hostUi.showMessage('warning', t('The main HML file cannot be deleted.'), [], false);
            return false;
        }
        const current = phase.opened.designer.currentFilePath === filePath;
        const message = current && useDesignerStore.getState().isDirty
            ? t('Delete "{0}"? Unsaved changes in this file will be lost.', path.posix.basename(filePath))
            : t('Delete HML file "{0}"? This cannot be undone.', path.posix.basename(filePath));
        if (!globalThis.confirm(message)) return false;

        let switchedToMain = false;
        try {
            if (current) {
                if (!mainHmlPath) throw new Error(t('No HML file found in the ui/ folder'));
                const document = await vscode.workspace.openTextDocument(vscode.Uri.file(mainHmlPath));
                await phase.opened.designer.loadFromDocument(document as unknown as import('vscode').TextDocument);
                if (phase.opened.designer.currentFilePath !== mainHmlPath) {
                    throw new Error(t('Failed to switch to the main HML file.'));
                }
                switchedToMain = true;
                useDesignerStore.getState().clearSelection();
                useDesignerStore.getState().setSelectedAsset(null);
            }
            fs.unlinkSync(filePath);
            if (current || !useDesignerStore.getState().isDirty) {
                phase.opened.designer.reloadCurrentDocument();
            } else {
                useDesignerStore.getState().refreshNavGraph();
            }
            return true;
        } catch (cause) {
            if (switchedToMain) phase.opened.designer.reloadCurrentDocument();
            void hostUi.showMessage('error', t('Failed to delete HML file: {0}', cause instanceof Error ? cause.message : String(cause)), [], false);
            return false;
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
                {phase.kind === 'ready' && (
                    <button className="web-icon-button" onClick={() => setExplorerVisible(value => !value)}
                        title={explorerVisible ? t('Hide Project Files') : t('Show Project Files')}
                        aria-label={explorerVisible ? t('Hide Project Files') : t('Show Project Files')}>
                        {explorerVisible ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
                    </button>
                )}
                <span className="web-topbar-title">{project.name}</span>
                {phase.kind === 'ready' && currentFilePath && (
                    <span className="web-topbar-file" title={path.posix.relative(phase.opened.projectRoot, currentFilePath)}>
                        {path.posix.relative(phase.opened.projectRoot, currentFilePath)}
                    </span>
                )}
                <span className={`web-sync web-sync-${syncState}`}>{syncLabel}</span>
                <span className="web-topbar-spacer" />
                <button className="web-button" onClick={showCode} disabled={phase.kind !== 'ready'}>{t('Generated Code')}</button>
                <button className="web-button primary" onClick={exportZip} disabled={phase.kind !== 'ready'}>{t('Export ZIP')}</button>
            </div>
            <div className="web-designer-host">
                {phase.kind === 'ready' && (
                    <div className="web-workspace">
                        {explorerVisible && (
                            <ProjectExplorer root={phase.opened.projectRoot} projectName={project.name}
                                mainHmlPath={findMainHml(phase.opened.projectRoot) || phase.opened.hmlPath}
                                onOpenFile={openFile} onDeleteFile={deleteFile} />
                        )}
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
