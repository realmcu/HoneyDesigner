/**
 * 浏览器版启动页：最近工程、新建工程、导入 ZIP、打开本地目录
 */
import React, { useEffect, useRef, useState } from 'react';
import {
    StoredProject,
    listProjects,
    deleteProject,
    saveProjectRecord,
    writeBrowserFiles,
    createProjectId,
    pickProjectDirectory,
    directoryContainsProject,
} from '../host/projectStore';
import { scaffoldProject, NewProjectOptions, PROJECT_NAME_PATTERN } from '../host/projectScaffold';
import { importProjectZip } from '../host/projectZip';
import { isDirectoryAccessSupported, getWebLocale, setWebLocale, WebLocale } from '../host/webEnvironment';
import { DEFAULT_ROMFS_BASE_ADDR } from '../../common/ProjectConfig';
import { t, setLocale } from '../../webview/i18n';

const RESOLUTIONS = ['410X502', '480X272', '800X480', '1024X600', '1280X720'];
const MIN_SDKS = ['API 2: HoneyGUI V1.1.0', 'API 3: HoneyGUI V1.2.0', 'API 4: HoneyGUI V2.0.0'];
const PIXEL_MODES = ['ARGB8888', 'RGB565', 'ARGB4444', 'L8'];

interface ProjectLauncherProps {
    onOpen(project: StoredProject): void;
}

function NewProjectForm({ onCreate, onCancel }: { onCreate(options: NewProjectOptions): Promise<void>; onCancel(): void }) {
    const [name, setName] = useState('NewProject');
    const [appId, setAppId] = useState('com.example.NewProject');
    const [resolution, setResolution] = useState('480X272');
    const [customWidth, setCustomWidth] = useState(480);
    const [customHeight, setCustomHeight] = useState(272);
    const [cornerRadius, setCornerRadius] = useState(20);
    const [targetEngine, setTargetEngine] = useState<'honeygui' | 'lvgl'>('honeygui');
    const [minSdk, setMinSdk] = useState(MIN_SDKS[0]);
    const [pixelMode, setPixelMode] = useState(PIXEL_MODES[0]);
    const [romfsBaseAddr, setRomfsBaseAddr] = useState(DEFAULT_ROMFS_BASE_ADDR);
    const [busy, setBusy] = useState(false);

    const nameValid = PROJECT_NAME_PATTERN.test(name);
    const finalResolution = resolution === 'custom' ? `${customWidth}X${customHeight}` : resolution;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!nameValid || !appId.trim() || busy) {
            return;
        }
        setBusy(true);
        try {
            await onCreate({
                name,
                appId: appId.trim(),
                resolution: finalResolution,
                cornerRadius,
                targetEngine,
                minSdk,
                pixelMode,
                romfsBaseAddr: romfsBaseAddr.trim() || undefined,
                locale: getWebLocale(),
            });
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="web-card web-form" onSubmit={submit}>
            <h2>{t('New Project')}</h2>
            <label className="web-field">
                <span className="web-field-label">{t('Project Name')}</span>
                <input className="web-input" value={name} onChange={e => setName(e.target.value)} autoFocus />
                {!nameValid && <span className="web-field-error">{t('Project name can only contain letters, numbers and underscores, and must start with a letter or underscore')}</span>}
            </label>
            <label className="web-field">
                <span className="web-field-label">APP ID</span>
                <input className="web-input" value={appId} onChange={e => setAppId(e.target.value)} placeholder="com.example.myapp" />
            </label>
            <div className="web-field-row">
                <label className="web-field">
                    <span className="web-field-label">{t('Resolution')}</span>
                    <select className="web-input" value={resolution} onChange={e => setResolution(e.target.value)}>
                        {RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                        <option value="custom">{t('Custom')}</option>
                    </select>
                </label>
                {resolution === 'custom' && (
                    <>
                        <label className="web-field">
                            <span className="web-field-label">{t('Width')}</span>
                            <input className="web-input" type="number" min={1} value={customWidth} onChange={e => setCustomWidth(Number(e.target.value) || 1)} />
                        </label>
                        <label className="web-field">
                            <span className="web-field-label">{t('Height')}</span>
                            <input className="web-input" type="number" min={1} value={customHeight} onChange={e => setCustomHeight(Number(e.target.value) || 1)} />
                        </label>
                    </>
                )}
            </div>
            <div className="web-field-row">
                <label className="web-field">
                    <span className="web-field-label">{t('Screen Shape')}</span>
                    <select className="web-input" value={cornerRadius} onChange={e => setCornerRadius(Number(e.target.value))}>
                        <option value={0}>{t('Rectangle')}</option>
                        <option value={-1}>{t('Circle')}</option>
                        <option value={20}>{t('Rounded {0}px', 20)}</option>
                        <option value={40}>{t('Rounded {0}px', 40)}</option>
                        <option value={60}>{t('Rounded {0}px', 60)}</option>
                    </select>
                </label>
                <label className="web-field">
                    <span className="web-field-label">{t('Target Engine')}</span>
                    <select className="web-input" value={targetEngine} onChange={e => setTargetEngine(e.target.value as 'honeygui' | 'lvgl')}>
                        <option value="honeygui">HoneyGUI</option>
                        <option value="lvgl">LVGL</option>
                    </select>
                </label>
            </div>
            <div className="web-field-row">
                <label className="web-field">
                    <span className="web-field-label">{t('Minimum SDK')}</span>
                    <select className="web-input" value={minSdk} onChange={e => setMinSdk(e.target.value)}>
                        {MIN_SDKS.map(sdk => <option key={sdk} value={sdk}>{sdk}</option>)}
                    </select>
                </label>
                <label className="web-field">
                    <span className="web-field-label">{t('Pixel Format')}</span>
                    <select className="web-input" value={pixelMode} onChange={e => setPixelMode(e.target.value)}>
                        {PIXEL_MODES.map(mode => <option key={mode} value={mode}>{mode}</option>)}
                    </select>
                </label>
            </div>
            <label className="web-field">
                <span className="web-field-label">{t('ROMFS Base Address')}</span>
                <input className="web-input" value={romfsBaseAddr} onChange={e => setRomfsBaseAddr(e.target.value)} placeholder={DEFAULT_ROMFS_BASE_ADDR} />
            </label>
            <div className="web-modal-actions">
                <button type="submit" className="web-button primary" disabled={!nameValid || !appId.trim() || busy}>{t('Create')}</button>
                <button type="button" className="web-button" onClick={onCancel}>{t('Cancel')}</button>
            </div>
        </form>
    );
}

export function ProjectLauncher({ onOpen }: ProjectLauncherProps) {
    const [projects, setProjects] = useState<StoredProject[] | undefined>();
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | undefined>();
    const [locale, setLocaleState] = useState<WebLocale>(getWebLocale());
    const zipInputRef = useRef<HTMLInputElement>(null);

    const refresh = () => listProjects().then(setProjects).catch(err => setError(String(err)));

    useEffect(() => {
        void refresh();
    }, []);

    const changeLocale = (next: WebLocale) => {
        setWebLocale(next);
        setLocale(next);
        document.documentElement.lang = next === 'zh-cn' ? 'zh-CN' : 'en';
        setLocaleState(next);
    };

    const createProject = async (options: NewProjectOptions) => {
        try {
            const project: StoredProject = { id: createProjectId(), name: options.name, mode: 'browser', updatedAt: Date.now() };
            await writeBrowserFiles(project.id, scaffoldProject(options));
            await saveProjectRecord(project);
            onOpen(project);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const importZip = async (file: File) => {
        setError(undefined);
        try {
            const imported = importProjectZip(file.name, new Uint8Array(await file.arrayBuffer()));
            const project: StoredProject = { id: createProjectId(), name: imported.name, mode: 'browser', updatedAt: Date.now() };
            await writeBrowserFiles(project.id, imported.files);
            await saveProjectRecord(project);
            onOpen(project);
        } catch (err) {
            setError(t('Import failed: {0}', err instanceof Error ? err.message : String(err)));
        }
    };

    const openDirectory = async () => {
        setError(undefined);
        try {
            const handle = await pickProjectDirectory();
            if (!handle) {
                return;
            }
            if (!(await directoryContainsProject(handle))) {
                setError(t('The selected folder does not contain project.json'));
                return;
            }
            const project: StoredProject = { id: createProjectId(), name: handle.name, mode: 'directory', updatedAt: Date.now(), handle };
            await saveProjectRecord(project);
            onOpen(project);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const removeProject = async (project: StoredProject) => {
        const message = project.mode === 'directory'
            ? t('Remove "{0}" from the list? Files in the local folder are not deleted.', project.name)
            : t('Delete project "{0}"? This cannot be undone.', project.name);
        if (!globalThis.confirm(message)) {
            return;
        }
        await deleteProject(project.id);
        await refresh();
    };

    return (
        <div className="web-launcher">
            <header className="web-launcher-header">
                <div>
                    <h1>HoneyGUI Designer <span className="web-badge">Web</span></h1>
                    <p className="web-muted">{t('Design HoneyGUI / LVGL interfaces in the browser and generate C code. Simulation and flashing require the VS Code extension.')}</p>
                </div>
                <label className="web-locale-select">
                    <span>{t('Language')}</span>
                    <select className="web-input" value={locale} onChange={e => changeLocale(e.target.value as WebLocale)}>
                        <option value="en">English</option>
                        <option value="zh-cn">简体中文</option>
                    </select>
                </label>
            </header>

            {error && <div className="web-banner web-banner-error" role="alert">{error}</div>}

            {creating ? (
                <NewProjectForm onCreate={createProject} onCancel={() => setCreating(false)} />
            ) : (
                <>
                    <div className="web-launcher-actions">
                        <button className="web-action-card" onClick={() => setCreating(true)}>
                            <span className="web-action-title">{t('New Project')}</span>
                            <span className="web-muted">{t('Stored in this browser')}</span>
                        </button>
                        <button className="web-action-card" onClick={() => zipInputRef.current?.click()}>
                            <span className="web-action-title">{t('Import ZIP')}</span>
                            <span className="web-muted">{t('A zipped project folder containing project.json')}</span>
                        </button>
                        <button
                            className="web-action-card"
                            onClick={openDirectory}
                            disabled={!isDirectoryAccessSupported()}
                            title={isDirectoryAccessSupported() ? undefined : t('Requires a Chromium-based browser (Chrome, Edge)')}
                        >
                            <span className="web-action-title">{t('Open Local Folder')}</span>
                            <span className="web-muted">
                                {isDirectoryAccessSupported() ? t('Edit files on disk directly') : t('Requires a Chromium-based browser (Chrome, Edge)')}
                            </span>
                        </button>
                        <input
                            ref={zipInputRef}
                            type="file"
                            accept=".zip"
                            hidden
                            onChange={e => {
                                const file = e.target.files?.[0];
                                e.target.value = '';
                                if (file) {
                                    void importZip(file);
                                }
                            }}
                        />
                    </div>

                    <section className="web-card">
                        <h2>{t('Recent Projects')}</h2>
                        {projects === undefined && <p className="web-muted">{t('Loading...')}</p>}
                        {projects?.length === 0 && <p className="web-muted">{t('No projects yet')}</p>}
                        <ul className="web-project-list">
                            {projects?.map(project => (
                                <li key={project.id} className="web-project-item">
                                    <button className="web-project-open" onClick={() => onOpen(project)}>
                                        <span className="web-project-name">{project.name}</span>
                                        <span className="web-muted">
                                            {project.mode === 'directory' ? t('Local folder') : t('Browser storage')}
                                            {' · '}
                                            {new Date(project.updatedAt).toLocaleString(locale === 'zh-cn' ? 'zh-CN' : 'en')}
                                        </span>
                                    </button>
                                    <button className="web-button" onClick={() => removeProject(project)}>
                                        {project.mode === 'directory' ? t('Remove') : t('Delete')}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                </>
            )}
        </div>
    );
}
