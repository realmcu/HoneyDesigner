import React, { useEffect, useState } from 'react';
import * as path from 'path';
import { FileCode2, FileText, Folder, FolderOpen, FolderPlus, Plus, Trash2 } from 'lucide-react';
import { HmlTemplateManager } from '../../hml/HmlTemplateManager';
import { useDesignerStore } from '../../webview/store';
import { t } from '../../webview/i18n';
import * as fs from '../shims/fs';

interface ProjectExplorerProps {
    root: string;
    projectName: string;
    onOpenFile(filePath: string): void;
    onDeleteFile(filePath: string): Promise<boolean>;
    mainHmlPath: string;
}

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function ProjectExplorer({ root, projectName, onOpenFile, onDeleteFile, mainHmlPath }: ProjectExplorerProps) {
    const [version, setVersion] = useState(0);
    const [selectedDir, setSelectedDir] = useState('ui');
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['', 'ui']));
    const [creating, setCreating] = useState<'hml' | 'folder' | null>(null);
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);
    const currentFilePath = useDesignerStore(state => state.currentFilePath);

    const deleteFile = async (filePath: string) => {
        if (deleting) return;
        setDeleting(true);
        try {
            if (await onDeleteFile(filePath)) setSelectedFile(null);
        } finally {
            setDeleting(false);
        }
    };

    useEffect(() => {
        let frame: number | undefined;
        const unsubscribe = fs.vfs.onChange(change => {
            if (change.path.startsWith(`${root}/`) && frame === undefined) {
                frame = requestAnimationFrame(() => {
                    frame = undefined;
                    setVersion(value => value + 1);
                });
            }
        });
        return () => {
            unsubscribe();
            if (frame !== undefined) cancelAnimationFrame(frame);
        };
    }, [root]);

    useEffect(() => {
        if (!currentFilePath?.startsWith(`${root}/`)) return;
        setSelectedFile(currentFilePath);
        const relativeDir = path.posix.dirname(path.posix.relative(root, currentFilePath));
        setSelectedDir(relativeDir);
        setExpanded(current => {
            const next = new Set(current);
            let directory = relativeDir;
            while (directory !== '.' && directory !== '') {
                next.add(directory);
                directory = path.posix.dirname(directory);
            }
            next.add('');
            return next.size === current.size ? current : next;
        });
    }, [currentFilePath, root]);

    const uiDir = path.posix.join(root, 'ui');
    const hmlDir = selectedDir === 'ui' || selectedDir.startsWith('ui/')
        ? path.posix.join(root, selectedDir)
        : uiDir;

    const create = (event: React.FormEvent) => {
        event.preventDefault();
        const base = creating === 'hml' ? name.trim().replace(/\.hml$/i, '') : name.trim();
        if (creating === 'hml' && !NAME_PATTERN.test(base)) {
            setError(t('Use letters, numbers and underscores; start with a letter or underscore.'));
            return;
        }
        if (creating === 'folder' && (!base || base === '.' || base === '..'
            || /[<>:"/\\|?*\u0000-\u001f]/.test(base) || /[. ]$/.test(base))) {
            setError(t('Invalid folder name.'));
            return;
        }
        const parent = creating === 'hml' ? hmlDir : path.posix.join(root, selectedDir);
        const target = path.posix.join(parent, creating === 'hml' ? `${base}.hml` : base);
        if (fs.existsSync(target)) {
            setError(t('A file or folder with this name already exists.'));
            return;
        }
        if (creating === 'hml' && fs.vfs.listFiles(uiDir).some(file =>
            path.posix.basename(file).toLowerCase() === `${base.toLowerCase()}.hml`)) {
            setError(t('An HML file with this name already exists in ui/.'));
            return;
        }
        try {
            if (creating === 'hml') {
                const config = useDesignerStore.getState().projectConfig;
                fs.mkdirSync(parent, { recursive: true });
                fs.writeFileSync(target, HmlTemplateManager.generateMainHml(
                    base,
                    config?.resolution || '480X272',
                    config?.appId,
                    config?.minSdk,
                    config?.pixelMode,
                    false
                ), 'utf8');
                const relativeDir = path.posix.relative(root, parent);
                setExpanded(current => new Set([...current, '', 'ui', relativeDir]));
                onOpenFile(target);
            } else {
                fs.mkdirSync(target);
                const relativeDir = path.posix.relative(root, parent);
                setExpanded(current => new Set([...current, relativeDir]));
                setSelectedDir(path.posix.relative(root, target));
            }
            setCreating(null);
            setName('');
            setError('');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
    };

    const renderDirectory = (directory: string, depth: number): React.ReactNode => {
        const relative = path.posix.relative(root, directory);
        const isOpen = expanded.has(relative);
        const entries = (fs.readdirSync(directory, { withFileTypes: true }) as fs.Dirent[])
            .filter(entry => depth > 0 || !entry.name.startsWith('.'))
            .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
        return (
            <React.Fragment key={directory}>
                <div className={`web-explorer-row web-explorer-folder ${selectedDir === relative ? 'selected' : ''}`}
                    style={{ paddingLeft: 8 + depth * 14 }}>
                    <button className="web-explorer-toggle"
                        aria-label={isOpen ? t('Collapse folder') : t('Expand folder')}
                        onClick={() => setExpanded(current => {
                            const next = new Set(current);
                            if (next.has(relative)) next.delete(relative);
                            else next.add(relative);
                            return next;
                        })}>
                        {isOpen ? '▾' : '▸'}
                    </button>
                    <button className="web-explorer-item" title={directory}
                        onClick={() => {
                            setSelectedFile(null);
                            setSelectedDir(relative);
                            setExpanded(current => new Set([...current, relative]));
                        }}>
                        {isOpen ? <FolderOpen size={15} /> : <Folder size={15} />}
                        <span>{relative ? path.posix.basename(directory) : projectName}</span>
                    </button>
                </div>
                {isOpen && entries.map(entry => {
                    const full = path.posix.join(directory, entry.name);
                    if (entry.isDirectory()) return renderDirectory(full, depth + 1);
                    const isHml = entry.name.toLowerCase().endsWith('.hml');
                    return (
                        <div key={full} className={`web-explorer-row web-explorer-file ${currentFilePath === full ? 'active' : ''} ${selectedFile === full ? 'selected-file' : ''}`}
                            style={{ paddingLeft: 30 + depth * 14 }}>
                            <button className="web-explorer-item" title={path.posix.relative(root, full)}
                                disabled={!isHml} onClick={() => {
                                    setSelectedFile(full);
                                    setSelectedDir(path.posix.relative(root, directory));
                                    onOpenFile(full);
                                }}>
                                {isHml ? <FileCode2 size={15} /> : <FileText size={15} />}
                                <span>{entry.name}</span>
                            </button>
                            {isHml && selectedFile === full && (
                                <button className="web-explorer-delete" type="button"
                                    title={full === mainHmlPath ? t('The main HML file cannot be deleted.') : t('Delete HML File')}
                                    aria-label={full === mainHmlPath ? t('The main HML file cannot be deleted.') : t('Delete HML File')}
                                    disabled={deleting || full === mainHmlPath}
                                    onClick={() => void deleteFile(full)}>
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    );
                })}
            </React.Fragment>
        );
    };

    return (
        <aside className="web-explorer" aria-label={t('Project Files')} onKeyDown={event => {
            const target = event.target as HTMLElement;
            if (event.key !== 'Delete' || target.matches('input, textarea, select') || target.isContentEditable) return;
            event.stopPropagation();
            if (!selectedFile || deleting || creating || event.repeat || event.ctrlKey || event.metaKey) return;
            event.preventDefault();
            if (selectedFile !== mainHmlPath) void deleteFile(selectedFile);
        }}>
            <div className="web-explorer-header">
                <span>{t('Project Files')}</span>
                <div className="web-explorer-actions">
                    <button className="web-icon-button" title={t('New HML File')} aria-label={t('New HML File')}
                        onClick={() => { setCreating('hml'); setName(''); setError(''); }}>
                        <Plus size={16} />
                    </button>
                    <button className="web-icon-button" title={t('New Folder')} aria-label={t('New Folder')}
                        onClick={() => { setCreating('folder'); setName(''); setError(''); }}>
                        <FolderPlus size={16} />
                    </button>
                </div>
            </div>
            {creating && (
                <form className="web-explorer-create" onSubmit={create}>
                    <label htmlFor="web-explorer-name">{creating === 'hml' ? t('New HML File') : t('New Folder')}</label>
                    <input id="web-explorer-name" className="web-input" autoFocus value={name}
                        onChange={event => { setName(event.target.value); setError(''); }}
                        onKeyDown={event => { if (event.key === 'Escape') setCreating(null); }} />
                    <span className="web-muted">{path.posix.relative(root, creating === 'hml' ? hmlDir : path.posix.join(root, selectedDir))}/</span>
                    {error && <span className="web-field-error">{error}</span>}
                    <div className="web-explorer-create-actions">
                        <button type="button" className="web-button" onClick={() => setCreating(null)}>{t('Cancel')}</button>
                        <button type="submit" className="web-button primary">{t('Create')}</button>
                    </div>
                </form>
            )}
            <div className="web-explorer-list" key={version}>{renderDirectory(root, 0)}</div>
        </aside>
    );
}
