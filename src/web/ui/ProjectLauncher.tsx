/**
 * 浏览器版启动页：最近工程、新建工程、导入 ZIP、打开本地目录
 *
 * 布局有两种状态：
 * - 没有最近工程：完整 Hero（标题 + 入口 + 设计/代码预览）→ 示例工程 → 最近工程空状态
 * - 有最近工程：紧凑标题与入口 → 最近工程列表 → 示例工程
 * 两种状态共用同一套入口按钮，顺序固定：新建工程 / 打开本地文件夹 / 导入 ZIP。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Folder, Clock, ChevronRight, ChevronDown, ArrowUpRight, ArrowRight, Plus, Github, X } from 'lucide-react';
import {
    StoredProject,
    ProjectSummary,
    listProjects,
    deleteProject,
    clearProjectHistory,
    saveProjectRecord,
    discardProject,
    writeBrowserFiles,
    replaceBrowserProject,
    createProjectId,
    pickProjectDirectory,
    directoryContainsProject,
    readProjectSummary,
} from '../host/projectStore';
import { scaffoldProject, NewProjectOptions, PROJECT_NAME_PATTERN } from '../host/projectScaffold';
import { importProjectZip } from '../host/projectZip';
import { GitHubImportDialog, GitHubImportResult } from './GitHubImportDialog';
import { isDirectoryAccessSupported, getWebLocale, setWebLocale, WebLocale } from '../host/webEnvironment';
import { DEFAULT_ROMFS_BASE_ADDR } from '../../common/ProjectConfig';
import { t, setLocale } from '../../webview/i18n';
import { WEB_EXAMPLES, exampleSourceKey } from '../host/exampleProjects';

const RESOLUTIONS = ['410X502', '480X272', '800X480', '1024X600', '1280X720'];
const MIN_SDKS = ['API 2: HoneyGUI V1.1.0', 'API 3: HoneyGUI V1.2.0', 'API 4: HoneyGUI V2.0.0'];
const PIXEL_MODES = ['ARGB8888', 'RGB565', 'ARGB4444', 'L8'];

const GITHUB_URL = 'https://github.com/realmcu/HoneyDesigner';

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
        <form className="web-card web-form web-modal" onSubmit={submit} role="dialog" aria-label={t('New Project')}>
            <div className="hg-modal-head">
                <h2>{t('New Project')}</h2>
                <button className="hg-icon-btn" type="button" onClick={onCancel} aria-label={t('Cancel')} title={t('Cancel')}>
                    <X size={14} strokeWidth={1.6} aria-hidden="true" />
                </button>
            </div>
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

/** 相对时间；只用现有 updatedAt 字段，不补造数据 */
function formatRelativeTime(timestamp: number, locale: WebLocale): string {
    const diff = Date.now() - timestamp;
    const minute = 60_000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) {
        return t('Just now');
    }
    if (diff < hour) {
        return t('{0} min ago', Math.floor(diff / minute));
    }
    if (diff < day) {
        return t('{0} h ago', Math.floor(diff / hour));
    }
    if (diff < 2 * day) {
        return t('Yesterday');
    }
    return new Date(timestamp).toLocaleDateString(locale === 'zh-cn' ? 'zh-CN' : 'en', { month: 'short', day: 'numeric' });
}

/** 六边形 Logo：沿用站点图标轮廓，配色换成品牌琥珀 */
function BrandMark() {
    return (
        <svg className="hg-brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path d="M16 2.6 27.6 9.3v13.4L16 29.4 4.4 22.7V9.3L16 2.6Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <path d="M16 10.4 21.8 13.7v6.6L16 23.6 10.2 20.3v-6.6L16 10.4Z" fill="currentColor" />
        </svg>
    );
}

/**
 * 设计与代码对应预览。
 * 代码行取自真实生成结果（gui_img_create_from_fs 系列），不展示虚构的构建输出。
 */
function DesignCodePreview() {
    return (
        <div className="hg-preview" aria-label={t('Design and code side by side')}>
            <div className="hg-preview-head">
                <span className="hg-preview-dots" aria-hidden="true"><i /><i /><i /></span>
                <span className="hg-preview-file">src/ui/dashboardMain.c</span>
                <span className="hg-preview-engine">HONEYGUI</span>
            </div>
            <div className="hg-preview-body">
                <div className="hg-preview-canvas">
                    <div className="hg-device">
                        <div className="hg-device-clock">14:51</div>
                        <svg className="hg-device-ring" viewBox="0 0 76 76" fill="none" aria-hidden="true">
                            <circle cx="38" cy="38" r="31" stroke="var(--hg-ring-track)" strokeWidth="6" />
                            <circle
                                cx="38" cy="38" r="31"
                                stroke="var(--hg-amber)" strokeWidth="6" strokeLinecap="round"
                                strokeDasharray="140 195" transform="rotate(-90 38 38)"
                            />
                        </svg>
                        <div className="hg-device-pct">72%</div>
                        <div className="hg-device-btn">Start</div>
                    </div>
                </div>
                <div className="hg-preview-code">
                    <div className="hg-code-caption">{t('Button in code')}</div>
                    <div className="hg-code-line">gui_view_create(</div>
                    <div className="hg-code-line">{'  gui_obj_get_root(),'}</div>
                    <div className="hg-code-line">{'  "dashboardMainView",'}</div>
                    <div className="hg-code-line">{'  0, 0, 0, 0);'}</div>
                    <div className="hg-code-line hg-code-line--hl"><span className="hg-code-mark" />start_engine = gui_rect_create(</div>
                    <div className="hg-code-line hg-code-line--hl"><span className="hg-code-mark" />{'  view, "start_engine",'}</div>
                    <div className="hg-code-line hg-code-line--hl"><span className="hg-code-mark" />{'  24, 132, 84, 26,'}</div>
                    <div className="hg-code-line">{'  13, gui_rgba(245,179,36,36));'}</div>
                    <div className="hg-code-line">gui_rect_set_stroke(start_engine,</div>
                    <div className="hg-code-line">{'  1.5f, gui_rgb(245, 179, 36));'}</div>
                    <div className="hg-code-line">gui_rect_set_glow(start_engine,</div>
                    <div className="hg-code-line">{'  gui_rgba(245,179,36,90), 12);'}</div>
                </div>
            </div>
        </div>
    );
}

function SampleCard({ example, busy, onOpen }: {
    example: typeof WEB_EXAMPLES[number];
    busy: boolean;
    onOpen(): void;
}) {
    return (
        <button className="hg-sample" type="button" disabled={busy} onClick={onOpen}>
            <span className="hg-sample-thumb">
                <img src={new URL(example.thumbnail, document.baseURI).toString()} alt="" />
            </span>
            <span className="hg-sample-info">
                <span className="hg-sample-info-top">
                    <span className="hg-sample-name">{example.name}</span>
                    <span className="hg-sample-tag">{t(example.tagKey)}</span>
                </span>
                <span className="hg-sample-desc">{t(example.descriptionKey)}</span>
                <span className="hg-sample-open">
                    {busy ? t('Loading...') : t('Open Example')}
                    {!busy && <ArrowRight size={13} strokeWidth={1.6} aria-hidden="true" />}
                </span>
            </span>
        </button>
    );
}

export function ProjectLauncher({ onOpen }: ProjectLauncherProps) {
    const [projects, setProjects] = useState<StoredProject[] | undefined>();
    const [summaries, setSummaries] = useState<Record<string, ProjectSummary | undefined>>({});
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | undefined>();
    const [locale, setLocaleState] = useState<WebLocale>(getWebLocale());
    const [loadingExample, setLoadingExample] = useState<string | null>(null);
    const [importingFromGitHub, setImportingFromGitHub] = useState(false);
    const zipInputRef = useRef<HTMLInputElement>(null);

    const loadSummaries = (list: StoredProject[]) => {
        void Promise.all(list.map(async project => [project.id, await readProjectSummary(project)] as const))
            .then(entries => setSummaries(Object.fromEntries(entries)));
    };

    const refresh = () => listProjects()
        .then(list => {
            setProjects(list);
            loadSummaries(list);
        })
        .catch(err => setError(String(err)));

    useEffect(() => {
        void refresh();
    }, []);

    const changeLocale = (next: WebLocale) => {
        setWebLocale(next);
        setLocale(next);
        document.documentElement.lang = next === 'zh-cn' ? 'zh-CN' : 'en';
        setLocaleState(next);
    };

    /**
     * 把一组工程文件落进浏览器存储并打开。
     *
     * 所有导入入口（新建 / ZIP / 示例 / GitHub）都走这里，保证同一套提交语义：
     * 先写文件、再写工程记录，任一步失败就删掉**本次新工程 ID** 下的全部写入，
     * 不会留下「最近工程里有、文件却是空的」这种半成品，也不会碰到已有工程。
     */
    const persistProject = async (
        name: string,
        files: Map<string, Uint8Array>,
        source?: Pick<StoredProject, 'sourceUrl' | 'sourceKey' | 'sourceRevision'>
    ): Promise<StoredProject> => {
        const project: StoredProject = {
            id: createProjectId(),
            name,
            mode: 'browser',
            updatedAt: Date.now(),
            ...source,
        };
        try {
            await writeBrowserFiles(project.id, files);
            await saveProjectRecord(project);
        } catch (err) {
            // 回滚只针对这个新 id；失败也不能影响打开流程之外的已有工程
            await discardProject(project.id).catch(() => undefined);
            throw err;
        }
        onOpen(project);
        return project;
    };

    const createProject = async (options: NewProjectOptions) => {
        try {
            await persistProject(options.name, scaffoldProject(options));
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const importZip = async (file: File) => {
        setError(undefined);
        try {
            const imported = importProjectZip(file.name, new Uint8Array(await file.arrayBuffer()));
            await persistProject(imported.name, imported.files);
        } catch (err) {
            setError(t('Import failed: {0}', err instanceof Error ? err.message : String(err)));
        }
    };

    const openExample = async (example: typeof WEB_EXAMPLES[number]) => {
        if (loadingExample) return;
        setError(undefined);
        setLoadingExample(example.id);
        try {
            const response = await fetch(new URL(example.archive, document.baseURI));
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            const imported = importProjectZip(example.archive, new Uint8Array(await response.arrayBuffer()));
            // 来源标识让示例默认用完整仿真：CI 预编译过，未修改时不需要下载编译器
            await persistProject(imported.name, imported.files, { sourceKey: exampleSourceKey(example.id) });
        } catch (err) {
            setError(t('Example could not be opened: {0}', err instanceof Error ? err.message : String(err)));
        } finally {
            setLoadingExample(null);
        }
    };

    /**
     * GitHub 导入：落库失败向上抛，由弹框显示并允许重试。
     * 覆盖已有副本时沿用原工程 ID，最近工程里仍是同一条记录，不会多出一份。
     */
    const importFromGitHub = async (result: GitHubImportResult) => {
        const source = { sourceUrl: result.sourceUrl, sourceKey: result.sourceKey, sourceRevision: result.sourceRevision };
        if (result.replace) {
            const project: StoredProject = { ...result.replace, name: result.name, updatedAt: Date.now(), ...source };
            await replaceBrowserProject(project, result.files);
            setImportingFromGitHub(false);
            onOpen(project);
            return;
        }
        await persistProject(result.name, result.files, source);
        setImportingFromGitHub(false);
    };

    /** 同一来源只认浏览器副本；本地文件夹工程不参与（它们不是从 GitHub 下载的） */
    const findGitHubCopy = async (sourceKey: string) => {
        const list = await listProjects();
        return list.find(project => project.mode === 'browser' && project.sourceKey === sourceKey);
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

    const clearHistory = async (list: StoredProject[]) => {
        if (!globalThis.confirm(t('Clear the recent project list? Project files are not deleted.'))) {
            return;
        }
        try {
            // 只移除历史记录，工程文件保留（本地文件夹不动，浏览器中的文件也不删）
            await clearProjectHistory(list);
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const hasDirectoryAccess = isDirectoryAccessSupported();
    const hasRecent = (projects?.length ?? 0) > 0;

    const entryActions = (
        <div className="hg-actions">
            <button className="hg-btn hg-btn--primary" type="button" onClick={() => setCreating(true)}>
                <Plus size={15} strokeWidth={2} aria-hidden="true" />
                {t('New Project')}
            </button>
            <button
                className="hg-btn hg-btn--ghost"
                type="button"
                onClick={openDirectory}
                disabled={!hasDirectoryAccess}
                title={hasDirectoryAccess ? undefined : t('Requires a Chromium-based browser (Chrome, Edge)')}
            >
                <Folder size={16} strokeWidth={1.5} aria-hidden="true" />
                {t('Open Local Folder')}
            </button>
            <button className="hg-link-import" type="button" onClick={() => zipInputRef.current?.click()}>
                {t('Or import a ZIP project')}
            </button>
            {/* 次级入口：与 ZIP 导入同级的文字链接，不与「新建工程」争主按钮 */}
            <button className="hg-link-import" type="button" onClick={() => setImportingFromGitHub(true)}>
                {t('Or open a GitHub repository')}
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
    );

    const recentSection = (
        <section className="hg-block hg-recent">
            <div className="hg-block-head">
                <h2 className="hg-block-title">{t('Recent Projects')}</h2>
                {hasRecent && (
                    <button className="hg-clear" type="button" onClick={() => void clearHistory(projects!)}>
                        {t('Clear History')}
                    </button>
                )}
            </div>
            {projects === undefined ? (
                <div className="hg-empty">
                    <Clock size={18} strokeWidth={1.5} aria-hidden="true" />
                    <span className="hg-empty-title">{t('Loading...')}</span>
                </div>
            ) : hasRecent ? (
                <ul className="hg-recent-list">
                    {projects!.map(project => {
                        const summary = summaries[project.id];
                        // 与设计稿一致：只显示入口文件名与画布尺寸，不把 ui/ 目录前缀铺进列表
                        const meta = [
                            summary?.mainHmlFile?.split('/').pop() ?? 'project.json',
                            summary?.resolution?.replace(/X/i, '×'),
                        ].filter(Boolean).join(' · ');
                        return (
                            <li key={project.id} className="hg-recent-item">
                                <button className="hg-recent-open" type="button" onClick={() => onOpen(project)}>
                                    <span className="hg-recent-icon">
                                        <Folder size={15} strokeWidth={1.5} aria-hidden="true" />
                                    </span>
                                    <span className="hg-recent-col">
                                        <span className="hg-recent-name" title={project.name}>{project.name}</span>
                                        <span className="hg-recent-meta" title={meta}>{meta}</span>
                                    </span>
                                    <span className="hg-recent-time">{formatRelativeTime(project.updatedAt, locale)}</span>
                                    <ChevronRight className="hg-recent-chev" size={14} strokeWidth={1.6} aria-hidden="true" />
                                </button>
                                {/* 图标按钮不占行内布局宽度：绝对定位在行尾，悬停或聚焦时才显示，避免层级变大 */}
                                <button
                                    className="hg-recent-remove"
                                    type="button"
                                    title={project.mode === 'directory' ? t('Remove') : t('Delete')}
                                    aria-label={project.mode === 'directory' ? t('Remove') : t('Delete')}
                                    onClick={() => void removeProject(project)}
                                >
                                    <X size={13} strokeWidth={1.6} aria-hidden="true" />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <div className="hg-empty">
                    <Clock size={18} strokeWidth={1.5} aria-hidden="true" />
                    <span className="hg-empty-title">{t('No projects yet')}</span>
                    <span className="hg-empty-desc">{t('Create a project, or start from a sample below')}</span>
                </div>
            )}
        </section>
    );

    const samplesSection = (
        <section className="hg-block hg-samples">
            <div className="hg-block-head">
                <div className="hg-block-head-left">
                    <h2 className="hg-block-title">{t('Example Projects')}</h2>
                    <span className="hg-block-desc">{t('Complete projects, ready to run')}</span>
                </div>
                <a className="hg-block-link" href={GITHUB_URL} target="_blank" rel="noreferrer">
                    {t('View all on GitHub')}
                    <ArrowUpRight size={13} strokeWidth={1.5} aria-hidden="true" />
                </a>
            </div>
            <div className="hg-sample-grid">
                {WEB_EXAMPLES.map(example => (
                    <SampleCard
                        key={example.id}
                        example={example}
                        busy={loadingExample === example.id}
                        onOpen={() => void openExample(example)}
                    />
                ))}
            </div>
        </section>
    );

    return (
        <div className={`hg-shell${hasRecent ? ' hg-shell--recent' : ''}`}>
            <header className="hg-topbar-outer">
                <div className="hg-rail hg-topbar">
                    <div className="hg-brand">
                        <BrandMark />
                        <span className="hg-brand-name">HoneyGUI Designer</span>
                    </div>
                    <div className="hg-top-actions">
                        <label className="hg-lang">
                            <span className="hg-visually-hidden">{t('Language')}</span>
                            <select value={locale} onChange={e => changeLocale(e.target.value as WebLocale)}>
                                <option value="en">English</option>
                                <option value="zh-cn">简体中文</option>
                            </select>
                            <ChevronDown size={12} strokeWidth={1.6} aria-hidden="true" />
                        </label>
                        <a
                            className="hg-icon-btn"
                            href={GITHUB_URL}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={t('GitHub repository')}
                            title={t('GitHub repository')}
                        >
                            <Github size={15} strokeWidth={1.5} aria-hidden="true" />
                        </a>
                    </div>
                </div>
            </header>

            <main className="hg-rail hg-content">
                {error && <div className="hg-banner hg-banner--error" role="alert">{error}</div>}

                {creating ? (
                    <NewProjectForm onCreate={createProject} onCancel={() => setCreating(false)} />
                ) : importingFromGitHub ? (
                    <GitHubImportDialog
                        onCancel={() => setImportingFromGitHub(false)}
                        onImport={importFromGitHub}
                        findExisting={findGitHubCopy}
                        onOpenExisting={project => {
                            setImportingFromGitHub(false);
                            onOpen(project);
                        }}
                    />
                ) : (
                    <>
                        <section className={`hg-hero${hasRecent ? ' hg-hero--compact' : ''}`}>
                            <div className="hg-hero-copy">
                                <div className="hg-eyebrow">
                                    <span className="hg-eyebrow-dot" aria-hidden="true" />
                                    <span className="hg-eyebrow-text">{t('HONEYGUI · Visual Designer')}</span>
                                </div>

                                {hasRecent ? (
                                    <>
                                        <h1 className="hg-headline hg-headline--compact">{t('Start designing a HoneyGUI interface')}</h1>
                                        <p className="hg-lede">{t('Pick up where you left off, or start something new from an example.')}</p>
                                    </>
                                ) : (
                                    <>
                                        <h1 className="hg-headline hg-headline--full">
                                            <span className="hg-headline-line">{t('Drag a HoneyGUI interface together,')}</span>
                                            <span className="hg-headline-line hg-headline-line--accent">{t('get the matching C code.')}</span>
                                        </h1>
                                        <p className="hg-lede">
                                            {t('Turn the controls on the canvas into C code, keeping layout and logic apart.')}
                                            <br />
                                            {t('Simulation and flashing need the VS Code extension.')}
                                        </p>
                                    </>
                                )}

                                {entryActions}
                            </div>
                            {!hasRecent && <DesignCodePreview />}
                        </section>

                        {hasRecent ? (
                            <>
                                {recentSection}
                                {samplesSection}
                            </>
                        ) : (
                            <>
                                {samplesSection}
                                {recentSection}
                            </>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}
