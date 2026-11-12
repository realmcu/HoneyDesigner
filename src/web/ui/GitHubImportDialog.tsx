/**
 * 从 GitHub 仓库导入工程
 *
 * 交互分三步：
 * 1. 输入地址 → 解析 ref → 取 tree → 列出候选工程
 * 2. 选定工程后显示体积，超过阈值要求确认
 * 3. 下载并显示进度，可随时取消
 *
 * 任何一步失败都不落库；落库阶段的失败由调用方回滚本次新工程 ID 下的写入。
 */
import React, { useEffect, useRef, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { t } from '../../webview/i18n';
import {
    ABSOLUTE_MAX_BYTES,
    CancelToken,
    DownloadProgress,
    FetchLike,
    GitHubImportError,
    GitHubLocation,
    LARGE_PROJECT_BYTES,
    ProjectCandidate,
    RateLimitState,
    ResolvedSource,
    assertStorageCapacity,
    contentVersion,
    discoverProjects,
    downloadProject,
    githubSourceKey,
    jsDelivrFileUrl,
    parseGitHubUrl,
    rawFileUrl,
    resolveSource,
} from '../host/githubImport';
import type { StoredProject } from '../host/projectStore';
import { GITHUB_TEMPLATES } from '../host/exampleProjects';

/**
 * 原生 fetch 必须以 window 为 this 调用；它会被放进 options 对象、以 options.fetchImpl(...)
 * 的形式调用，不绑定就抛 Illegal invocation
 */
const boundFetch = ((input: string, init?: RequestInit) => fetch(input, init)) as never;

/** 候选工程的 project.json 正文读取：只在列工程名时用，失败不致命 */
function makeReadText(
    fetchImpl: FetchLike,
    owner: string,
    repo: string,
    version: string,
    channel: 'jsdelivr' | 'raw'
) {
    return async (entry: { path: string }): Promise<string | undefined> => {
        // 与正文下载走同一个通道，避免列出工程名时又去碰 raw
        const url = channel === 'jsdelivr'
            ? jsDelivrFileUrl(owner, repo, version, entry.path)
            : rawFileUrl(owner, repo, version, entry.path);
        const response = await fetchImpl(url, {});
        return response.ok ? response.text() : undefined;
    };
}

/** GitHubImportDialog 只负责取数据；落库由调用方通过 onImport 完成 */
export interface GitHubImportResult {
    candidate: ProjectCandidate;
    source: ResolvedSource;
    files: Map<string, Uint8Array>;
    name: string;
    sourceUrl: string;
    /** 识别重复导入用的来源标识，见 githubSourceKey */
    sourceKey: string;
    /** 本次下载的 commit SHA */
    sourceRevision: string;
    /** 用户选择「重新下载并覆盖」时要被替换的已有副本；为空表示新建 */
    replace?: StoredProject;
}

interface GitHubImportDialogProps {
    onCancel(): void;
    onImport(result: GitHubImportResult): Promise<void>;
    /** 查找同一来源已导入的浏览器副本 */
    findExisting(sourceKey: string): Promise<StoredProject | undefined>;
    /** 直接打开已有副本，不下载 */
    onOpenExisting(project: StoredProject): void;
    /** 预填的仓库地址；给出时打开弹框就开始读取（首页示例卡片用） */
    initialUrl?: string;
}

type Step =
    | { kind: 'url'; error?: string }
    | { kind: 'loading'; label: string }
    | { kind: 'choose'; source: ResolvedSource; candidates: ProjectCandidate[]; error?: string }
    | { kind: 'existing'; source: ResolvedSource; candidate: ProjectCandidate; existing: StoredProject }
    | { kind: 'confirm'; source: ResolvedSource; candidate: ProjectCandidate; replace?: StoredProject; error?: string }
    | { kind: 'downloading'; source: ResolvedSource; candidate: ProjectCandidate; progress: DownloadProgress };

function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (bytes >= 1024) {
        return `${Math.round(bytes / 1024)} KB`;
    }
    return `${bytes} B`;
}

/** 把错误翻译成可读文案；限流给出具体恢复时间 */
function describeError(error: unknown): string {
    if (!(error instanceof GitHubImportError)) {
        return error instanceof Error ? error.message : String(error);
    }
    switch (error.code) {
        case 'invalid-url':
            return t('Enter a GitHub repository URL, for example https://github.com/owner/repo');
        case 'unsupported-host':
            return t('Gitee cannot be opened directly in the browser. Use the GitHub mirror (github.com/realmcu/…) or export the project as a ZIP.');
        case 'repo-not-found':
            return t('Repository not found, or it is not publicly accessible.');
        case 'ref-not-found':
            return t('The branch, tag or commit in the URL could not be found.');
        case 'rate-limited': {
            if (error.options.limitKind === 'secondary' && error.options.retryAfterMs) {
                const seconds = Math.ceil(error.options.retryAfterMs / 1000);
                return t('GitHub is rate limiting requests. Try again in about {0} seconds.', seconds);
            }
            if (error.options.resetAt) {
                const time = new Date(error.options.resetAt).toLocaleTimeString();
                return t('GitHub API request limit reached. It resets at {0}.', time);
            }
            return t('GitHub API request limit reached. Please try again later.');
        }
        case 'channel-unavailable': {
            // 快速通道拒绝了（仓库超过 jsDelivr 的 50 MB 上限），而 API 通道配额已用完
            if (error.options.resetAt) {
                const time = new Date(error.options.resetAt).toLocaleTimeString();
                return t('This repository is too large for the fast download channel, and the GitHub API request limit is used up. Try again after {0}.', time);
            }
            return t('This repository is too large for the fast download channel, and the GitHub API request limit is used up. Please try again later.');
        }
        case 'access-denied':
            return t('GitHub denied the request.');
        case 'truncated':
            return t('This repository is too large to list completely, so it cannot be imported safely.');
        case 'submodule':
            return t('This project uses git submodules, which the web version cannot import.');
        case 'symlink':
            return t('This project contains symbolic links, which the web version cannot import.');
        case 'lfs-pointer':
            return t('This project stores files in Git LFS, which the web version cannot import.');
        case 'too-large': {
            // detail 可能是字节数，也可能是 jsdelivr 之类的通道标记
            const numeric = error.options.detail && /^\d+$/.test(error.options.detail)
                ? Number(error.options.detail)
                : undefined;
            const actual = numeric !== undefined ? formatBytes(numeric) : undefined;
            return actual
                ? t('This project is {0}, above the {1} limit for importing in the browser. Open it in VS Code instead.', actual, formatBytes(ABSOLUTE_MAX_BYTES))
                : t('This project is above the {0} limit for importing in the browser. Open it in VS Code instead.', formatBytes(ABSOLUTE_MAX_BYTES));
        }
        case 'quota':
            return t('The browser does not have enough storage left for this project.');
        case 'cancelled':
            return t('Import cancelled.');
        case 'no-project':
            return t('No project.json was found at this address.');
        case 'invalid-project':
            return t('The project is incomplete: project.json could not be read, or it has no HML file.');
        default:
            return error.message;
    }
}

/** 来源地址：指向本次实际下载的 commit，方便用户核对下的是哪个仓库、哪个版本 */
function SourceLink({ source, candidate }: { source: ResolvedSource; candidate: ProjectCandidate }) {
    const repoPath = `${source.owner}/${source.repo}`;
    const version = contentVersion(source);
    const href = `https://github.com/${repoPath}/tree/${version}${candidate.rootPath ? `/${candidate.rootPath}` : ''}`;
    const label = `github.com/${repoPath}${candidate.rootPath ? `/${candidate.rootPath}` : ''}`;
    // 没解析出 commit 时只显示分支名，不能编一个短 SHA
    const revision = source.sha
        ? `${source.ref ? `${source.ref} · ` : ''}${source.sha.slice(0, 7)}`
        : source.ref || t('Latest version');
    return (
        <p className="hg-import-source">
            <a href={href} target="_blank" rel="noreferrer noopener" title={href}>{label}</a>
            <span className="hg-import-source-rev">{revision}</span>
        </p>
    );
}

export function GitHubImportDialog({ onCancel, onImport, findExisting, onOpenExisting, initialUrl }: GitHubImportDialogProps) {
    const [url, setUrl] = useState(initialUrl ?? '');
    const [step, setStep] = useState<Step>({ kind: 'url' });
    const [saving, setSaving] = useState(false);
    const cancelTokenRef = useRef<CancelToken | undefined>(undefined);
    const rateLimitRef = useRef(new RateLimitState());

    // 关掉弹框时中止所有在途请求
    useEffect(() => () => cancelTokenRef.current?.cancel(), []);

    // 预填地址时直接开始读取，省去再点一次「继续」
    useEffect(() => {
        if (initialUrl) {
            void resolveAndImport(initialUrl);
        }
    }, []);

    // 下拉框的值由地址推出来：地址等于某个模板就选中它，手动改过就回到「自定义地址」
    const selectedTemplate = GITHUB_TEMPLATES.find(template => template.url === url.trim())?.id ?? '';

    /** 体积检查：超绝对上限只给提示，超确认阈值要用户确认，其余直接下载 */
    const downloadOrConfirm = async (source: ResolvedSource, candidate: ProjectCandidate, replace?: StoredProject) => {
        if (candidate.estimatedBytes > ABSOLUTE_MAX_BYTES) {
            setStep({
                kind: 'confirm',
                source,
                candidate,
                replace,
                error: describeError(new GitHubImportError('too-large', '', { detail: String(candidate.estimatedBytes) })),
            });
            return;
        }
        if (candidate.estimatedBytes > LARGE_PROJECT_BYTES) {
            setStep({ kind: 'confirm', source, candidate, replace });
            return;
        }
        await startDownload(source, candidate, replace);
    };

    /** 选定工程后先查是否已导入过：有副本就让用户决定打开还是覆盖，不生成第二份 */
    const selectCandidate = async (source: ResolvedSource, candidate: ProjectCandidate) => {
        const existing = await findExisting(githubSourceKey(source.owner, source.repo, candidate.rootPath))
            .catch(() => undefined);
        if (existing) {
            setStep({ kind: 'existing', source, candidate, existing });
            return;
        }
        await downloadOrConfirm(source, candidate);
    };

    const startDownload = async (source: ResolvedSource, candidate: ProjectCandidate, replace?: StoredProject) => {
        const token = new CancelToken();
        cancelTokenRef.current = token;
        const fetchImpl = boundFetch;

        setStep({
            kind: 'downloading',
            source,
            candidate,
            progress: { filesDone: 0, filesTotal: candidate.fileCount, bytesDone: 0, bytesEstimated: candidate.estimatedBytes },
        });

        try {
            // 下载前查一次剩余配额；estimate 只是估计值，落库失败仍由调用方回滚
            await assertStorageCapacity(candidate.estimatedBytes, () => navigator.storage.estimate());

            const project = await downloadProject(source, candidate, {
                fetchImpl,
                rateLimit: rateLimitRef.current,
                signal: token.signal,
                token,
                onProgress: progress => setStep(current =>
                    current.kind === 'downloading' ? { ...current, progress } : current
                ),
            });

            // 下载完成后再问一次是否需要保存（落库由父组件做，失败时它负责回滚）
            setSaving(true);
            await onImport({
                candidate,
                source,
                files: project.files,
                name: project.name,
                sourceUrl: url.trim(),
                sourceKey: githubSourceKey(source.owner, source.repo, candidate.rootPath),
                sourceRevision: contentVersion(source),
                replace,
            });
        } catch (error) {
            if (token.isCancelled) {
                setStep({ kind: 'url', error: describeError(error) });
            } else if (error instanceof GitHubImportError && !isRecoverable(error)) {
                setStep({ kind: 'url', error: describeError(error) });
            } else {
                setStep({ kind: 'confirm', source, candidate, replace, error: describeError(error) });
            }
        } finally {
            setSaving(false);
            cancelTokenRef.current = undefined;
        }
    };

    const beginImport = (event: React.FormEvent) => {
        event.preventDefault();
        if (step.kind === 'loading') {
            return;
        }
        void resolveAndImport(url);
    };

    const resolveAndImport = async (targetUrl: string) => {
        rateLimitRef.current = new RateLimitState();
        let location: GitHubLocation;
        try {
            location = parseGitHubUrl(targetUrl);
        } catch (error) {
            setStep({ kind: 'url', error: describeError(error) });
            return;
        }

        setStep({ kind: 'loading', label: t('Reading repository…') });
        const fetchImpl = boundFetch;
        const options = { fetchImpl, rateLimit: rateLimitRef.current };

        try {
            // 优先走 jsDelivr（不吃 GitHub 配额），失败自动降级到 API
            const resolvedSource = await resolveSource(location.owner, location.repo, location.pathSegments, options);

            // 文件链接（/blob/）按文件所在目录限定范围；/tree/ 按剩余路径限定
            const scopeSegments = location.isBlob
                ? resolvedSource.scopePath.split('/').filter(Boolean).slice(0, -1)
                : resolvedSource.scopePath.split('/').filter(Boolean);
            const scopePath = scopeSegments.join('/');

            const candidates = await discoverProjects(
                location.owner,
                location.repo,
                resolvedSource.sha,
                resolvedSource.tree,
                scopePath,
                {
                    ...options,
                    readText: makeReadText(
                        fetchImpl,
                        location.owner,
                        location.repo,
                        contentVersion(resolvedSource),
                        resolvedSource.contentChannel
                    ),
                }
            );

            if (candidates.length === 0) {
                setStep({ kind: 'url', error: t('No project.json was found at this address.') });
                return;
            }

            const source: ResolvedSource = { ...resolvedSource, scopePath, candidates };

            if (candidates.length === 1) {
                await selectCandidate(source, candidates[0]);
                return;
            }

            setStep({ kind: 'choose', source, candidates });
        } catch (error) {
            setStep({ kind: 'url', error: describeError(error) });
        }
    };

    const header = (
        <div className="hg-modal-head">
            <h2>{t('Open from GitHub')}</h2>
            <button className="hg-icon-btn" type="button" onClick={onCancel} aria-label={t('Cancel')} title={t('Cancel')}>
                <X size={14} strokeWidth={1.6} aria-hidden="true" />
            </button>
        </div>
    );

    if (step.kind === 'loading') {
        return (
            <div className="web-card web-form web-modal" role="dialog" aria-label={t('Open from GitHub')}>
                {header}
                <div className="hg-import-status">
                    <Loader2 size={15} className="hg-spin" aria-hidden="true" />
                    <span>{step.label}</span>
                </div>
            </div>
        );
    }

    if (step.kind === 'choose') {
        return (
            <div className="web-card web-form web-modal" role="dialog" aria-label={t('Open from GitHub')}>
                {header}
                <p className="hg-import-hint">{t('This repository contains more than one project. Choose one to import.')}</p>
                <ul className="hg-import-list">
                    {step.candidates.map(candidate => (
                        <li key={candidate.rootPath}>
                            <button
                                className="hg-import-option"
                                type="button"
                                onClick={() => void selectCandidate(step.source, candidate)}
                            >
                                <span className="hg-import-option-name">{candidate.name}</span>
                                <span className="hg-import-option-meta">
                                    {candidate.rootPath || t('Repository root')}
                                    {' · '}
                                    {t('{0} files', candidate.fileCount)}
                                    {' · '}
                                    {formatBytes(candidate.estimatedBytes)}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
                {step.error && <p className="web-field-error">{step.error}</p>}
                <div className="web-modal-actions">
                    <button className="web-button" type="button" onClick={() => setStep({ kind: 'url' })}>{t('Back')}</button>
                </div>
            </div>
        );
    }

    if (step.kind === 'existing') {
        const { existing, source, candidate } = step;
        // 副本记录的是下载时的 commit；与这次解析出的 SHA 相同说明仓库没有更新。
        // 解析不出 commit 时只能按分支名比较，此时「相同」只说明分支名没变
        const upToDate = Boolean(source.sha) && existing.sourceRevision === source.sha;
        return (
            <div className="web-card web-form web-modal" role="dialog" aria-label={t('Open from GitHub')}>
                {header}
                <SourceLink source={source} candidate={candidate} />
                <p className="hg-import-hint">
                    {t('This project is already in this browser as "{0}" (last saved {1}).', existing.name, new Date(existing.updatedAt).toLocaleString())}
                </p>
                <p className="hg-import-hint">
                    {upToDate
                        ? t('It was downloaded from the current version of the repository.')
                        : t('The repository has changed since it was downloaded.')}
                    {' '}
                    {t('Downloading again replaces the existing copy, including any changes made in the browser.')}
                </p>
                <div className="web-modal-actions">
                    <button className="web-button primary" type="button" onClick={() => onOpenExisting(existing)}>
                        {t('Open Existing Copy')}
                    </button>
                    <button
                        className="web-button"
                        type="button"
                        onClick={() => void downloadOrConfirm(source, candidate, existing)}
                    >
                        {t('Download Again and Replace')}
                    </button>
                    <button className="web-button" type="button" onClick={() => setStep({ kind: 'url' })}>{t('Back')}</button>
                </div>
            </div>
        );
    }

    if (step.kind === 'confirm') {
        const tooLarge = step.candidate.estimatedBytes > ABSOLUTE_MAX_BYTES;
        return (
            <div className="web-card web-form web-modal" role="dialog" aria-label={t('Open from GitHub')}>
                {header}
                <SourceLink source={step.source} candidate={step.candidate} />
                <p className="hg-import-hint">
                    {t('{0} has {1} files and is about {2}.', step.candidate.name, step.candidate.fileCount, formatBytes(step.candidate.estimatedBytes))}
                </p>
                <p className="hg-import-hint">
                    {step.replace
                        ? t('It replaces the existing copy "{0}" in this browser.', step.replace.name)
                        : t('It is downloaded into this browser. Simulation and flashing still require the VS Code extension.')}
                </p>
                {step.error && <p className="web-field-error">{step.error}</p>}
                <div className="web-modal-actions">
                    <button
                        className="web-button primary"
                        type="button"
                        disabled={tooLarge}
                        onClick={() => void startDownload(step.source, step.candidate, step.replace)}
                    >
                        {step.replace ? t('Replace') : t('Import')}
                    </button>
                    <button className="web-button" type="button" onClick={() => setStep({ kind: 'url' })}>{t('Back')}</button>
                </div>
            </div>
        );
    }

    if (step.kind === 'downloading') {
        const { progress } = step;
        const percent = progress.filesTotal > 0
            ? Math.round((progress.filesDone / progress.filesTotal) * 100)
            : 0;
        return (
            <div className="web-card web-form web-modal" role="dialog" aria-label={t('Open from GitHub')}>
                {header}
                <SourceLink source={step.source} candidate={step.candidate} />
                <div className="hg-import-progress">
                    <div className="hg-import-progress-track">
                        <div className="hg-import-progress-bar" style={{ width: `${percent}%` }} />
                    </div>
                    <div className="hg-import-progress-text">
                        <span>{t('{0} of {1} files', progress.filesDone, progress.filesTotal)}</span>
                        <span>{formatBytes(progress.bytesDone)}</span>
                    </div>
                </div>
                <div className="web-modal-actions">
                    <button
                        className="web-button"
                        type="button"
                        disabled={saving}
                        onClick={() => cancelTokenRef.current?.cancel()}
                    >
                        {t('Cancel')}
                    </button>
                </div>
            </div>
        );
    }

    // 输入地址
    return (
        <form className="web-card web-form web-modal" onSubmit={beginImport} role="dialog" aria-label={t('Open from GitHub')}>
            {header}
            <label className="web-field">
                <span className="web-field-label">{t('Template')}</span>
                <select
                    className="web-input"
                    value={selectedTemplate}
                    onChange={e => {
                        const template = GITHUB_TEMPLATES.find(item => item.id === e.target.value);
                        // 选「自定义地址」时清空，让用户直接粘贴
                        setUrl(template?.url ?? '');
                        if (step.kind === 'url' && step.error) {
                            setStep({ kind: 'url' });
                        }
                    }}
                >
                    <option value="">{t('Custom URL')}</option>
                    {GITHUB_TEMPLATES.map(template => (
                        <option key={template.id} value={template.id}>
                            {template.name} — {t(template.descriptionKey)}
                        </option>
                    ))}
                </select>
            </label>
            <label className="web-field">
                <span className="web-field-label">{t('GitHub repository URL')}</span>
                <input
                    className="web-input"
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo"
                    autoFocus
                    spellCheck={false}
                />
            </label>
            <p className="hg-import-hint">
                {t('The repository must be public. The project is downloaded into this browser and can be exported as a ZIP.')}
            </p>
            {step.kind === 'url' && step.error && <p className="web-field-error">{step.error}</p>}
            <div className="web-modal-actions">
                <button className="web-button primary" type="submit" disabled={!url.trim()}>{t('Continue')}</button>
                <button className="web-button" type="button" onClick={onCancel}>{t('Cancel')}</button>
            </div>
        </form>
    );
}

/** 下载阶段的错误是否值得回到「确认」再试一次（网络类值得，结构性错误不值得） */
function isRecoverable(error: GitHubImportError): boolean {
    return error.code === 'network' || error.code === 'rate-limited';
}
