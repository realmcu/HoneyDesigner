/**
 * 从 GitHub 仓库导入工程（浏览器版）
 *
 * 浏览器无法下载仓库归档包：`codeload.github.com` 的 CORS 白名单写死为 GitHub 自家域，
 * `github.com/*.zip` 也只是 302 到 codeload。因此这里改走「列目录 + 逐文件取正文」：
 *
 *   GET /repos/{o}/{r}                         确认仓库并取默认分支
 *   GET /repos/{o}/{r}/commits?sha={ref}        把 ref 解析成 commit SHA
 *   GET /repos/{o}/{r}/git/trees/{sha}?recursive=1   一次拿到全量路径、大小、mode
 *   GET raw.githubusercontent.com/{o}/{r}/{sha}/{path}  逐文件取正文
 *
 * 所有正文都固定用解析出的 SHA 下载，不用分支名，避免下载途中分支被推新导致文件集不一致。
 *
 * 本模块只负责「取回来并校验」，不碰 IndexedDB 与 UI，便于单测注入假 fetch。
 */
import * as path from 'path';

export const GITHUB_API = 'https://api.github.com';
export const GITHUB_RAW = 'https://raw.githubusercontent.com';
export const JSDELIVR_DATA = 'https://data.jsdelivr.com';
export const JSDELIVR_CDN = 'https://cdn.jsdelivr.net';
/** jsDelivr 拒绝服务大于 50 MB 的包 */
export const JSDELIVR_MAX_PACKAGE_BYTES = 50 * 1024 * 1024;

/** 单次导入的绝对上限，不随预估值放宽 */
export const ABSOLUTE_MAX_BYTES = 200 * 1024 * 1024;
/** 超过此体积需要用户确认 */
export const LARGE_PROJECT_BYTES = 50 * 1024 * 1024;
/** 同时进行的正文请求数 */
export const MAX_CONCURRENCY = 6;
/** Git LFS 指针文件的前缀（命中即说明拿到的是指针而非真实文件） */
const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1';

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

export type GitHubImportErrorCode =
    /** URL 不是本模块能识别的仓库地址 */
    | 'invalid-url'
    /** Gitee 地址：浏览器里没有可用的下载通道，引导用户改用 GitHub 或 ZIP */
    | 'unsupported-host'
    /** 快速通道（jsDelivr）不可用，需要降级到 API */
    | 'channel-unavailable'
    /** 仓库不存在或无法公开访问（GitHub 对两者都返回 404，无法区分） */
    | 'repo-not-found'
    /** 分支、标签或 commit 无法解析 */
    | 'ref-not-found'
    /** 主限额耗尽或触发次级限流 */
    | 'rate-limited'
    /** 403 但不是限流：访问被拒绝 */
    | 'access-denied'
    /** 仓库过大导致 tree 清单不完整 */
    | 'truncated'
    /** 选定工程范围内含子模块 */
    | 'submodule'
    /** 选定工程范围内含符号链接 */
    | 'symlink'
    /** 下载到 Git LFS 指针而不是真实文件 */
    | 'lfs-pointer'
    /** 超过单次导入上限 */
    | 'too-large'
    /** 浏览器存储配额不足 */
    | 'quota'
    /** 用户取消 */
    | 'cancelled'
    /** 网络或服务端错误 */
    | 'network'
    /** 指定范围内没有 project.json */
    | 'no-project'
    /** project.json 无法解析或缺少主 HML */
    | 'invalid-project';

export interface GitHubImportErrorOptions {
    /** 限流：主限额恢复时间（毫秒时间戳） */
    resetAt?: number;
    /** 限流：Retry-After 换算出的等待毫秒数 */
    retryAfterMs?: number;
    /** 限流类型 */
    limitKind?: 'primary' | 'secondary';
    /** 触发拒绝的文件在仓库内的路径 */
    paths?: string[];
    /** 附加上下文，例如实际体积 */
    detail?: string;
    cause?: unknown;
}

export class GitHubImportError extends Error {
    constructor(readonly code: GitHubImportErrorCode, message: string, readonly options: GitHubImportErrorOptions = {}) {
        super(message);
        this.name = 'GitHubImportError';
    }
}

// ---------------------------------------------------------------------------
// 可注入的 fetch（便于单测）
// ---------------------------------------------------------------------------

export interface ReaderLike {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel(reason?: unknown): Promise<void> | void;
}

export interface ResponseLike {
    ok: boolean;
    status: number;
    headers: { get(name: string): string | null };
    text(): Promise<string>;
    json(): Promise<unknown>;
    body?: { getReader(): ReaderLike } | null;
    arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchLike = (
    url: string,
    init: { signal?: AbortSignal; headers?: Record<string, string> }
) => Promise<ResponseLike>;

const defaultFetch: FetchLike = (url, init) => fetch(url, init) as unknown as Promise<ResponseLike>;

// ---------------------------------------------------------------------------
// URL 解析
// ---------------------------------------------------------------------------

export interface GitHubLocation {
    owner: string;
    repo: string;
    /**
     * /tree/ 与 /blob/ 后面的原始路径段，尚未确定哪一段属于 ref。
     * 普通仓库地址为空数组。
     */
    pathSegments: string[];
    /** /blob/ 形式的文件链接 */
    isBlob: boolean;
}

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);

/**
 * Gitee 的下载通道在浏览器里全部被 CORS 挡住：
 * - `gitee.com/{o}/{r}/raw/...` 302 到 raw.giteeusercontent.com，该域不回 ACAO
 * - `repository/archive/{ref}.zip` 的 blazearchive 同样不回 ACAO
 * - `api/v5` 的 trees/contents/blobs 可用，但文件正文按次扣 60 次/小时的限额，
 *   一个模板动辄一两百个文件，走不通
 * 因此识别出来后直接给出可执行建议，而不是让用户等到限额耗尽才失败。
 */
const GITEE_HOSTS = new Set(['gitee.com', 'www.gitee.com']);

/**
 * 解析用户粘贴的仓库地址。
 *
 * 支持：
 * - https://github.com/o/r
 * - https://github.com/o/r.git
 * - https://github.com/o/r/tree/main
 * - https://github.com/o/r/tree/feat/some-branch/ui        （分支名含 /）
 * - https://github.com/o/r/blob/main/ui/AppMain.hml        （文件链接）
 *
 * 这里不判断哪一段是 ref —— 分支名允许包含 `/`，无法从字面区分，
 * 交给 resolveRef 用「最长候选优先 + 接口确认」处理。
 */
export function parseGitHubUrl(input: string): GitHubLocation {
    const trimmed = input.trim();
    if (!trimmed) {
        throw new GitHubImportError('invalid-url', 'Empty GitHub URL');
    }

    let url: URL;
    try {
        url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    } catch (error) {
        throw new GitHubImportError('invalid-url', 'Not a valid URL', { cause: error });
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new GitHubImportError('invalid-url', 'URL must use http or https');
    }
    // host 单独判断：Gitee 是「不支持」，不是「地址格式不对」，提示要能指导用户下一步
    if (GITEE_HOSTS.has(url.hostname.toLowerCase())) {
        throw new GitHubImportError('unsupported-host', 'Gitee is not supported in the browser');
    }
    if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) {
        throw new GitHubImportError('invalid-url', 'Not a github.com URL');
    }

    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (segments.length < 2) {
        throw new GitHubImportError('invalid-url', 'URL does not point to a repository');
    }

    const owner = segments[0];
    const repo = segments[1].replace(/\.git$/i, '');
    if (!owner || !repo) {
        throw new GitHubImportError('invalid-url', 'URL does not point to a repository');
    }

    const rest = segments.slice(2);
    // /tree/ 与 /blob/ 之后才是 ref + 路径；/releases、/issues 等一律忽略，按仓库根处理
    if (rest.length >= 2 && (rest[0] === 'tree' || rest[0] === 'blob')) {
        return {
            owner,
            repo,
            pathSegments: rest.slice(1),
            isBlob: rest[0] === 'blob',
        };
    }

    return { owner, repo, pathSegments: [], isBlob: false };
}

// ---------------------------------------------------------------------------
// 请求与限流
// ---------------------------------------------------------------------------

/**
 * GitHub REST 未认证限额按 IP 每小时 60 次，每次调用都会扣减。
 * 这里不复用「固定调用 N 次」的假设，而是每次响应后重读剩余次数，用完即停。
 */
/** 解析响应头里的数字；缺失或非数字返回 undefined，不能退化成 0 */
function parseHeaderNumber(value: string | null): number | undefined {
    if (value === null) {
        return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

export class RateLimitState {
    private remaining: number | undefined;
    private resetAt: number | undefined;
    private exhausted = false;

    observe(headers: { get(name: string): string | null }): void {
        // 响应头缺失时 get 返回 null，直接 Number(null) 会得到 0 而被误判成「配额耗尽」
        const remaining = parseHeaderNumber(headers.get('x-ratelimit-remaining'));
        const reset = parseHeaderNumber(headers.get('x-ratelimit-reset'));
        if (remaining !== undefined) {
            this.remaining = remaining;
            this.exhausted = remaining <= 0;
        }
        if (reset !== undefined && reset > 0) {
            this.resetAt = reset * 1000;
        }
    }

    /** 每次请求前检查：已经确认耗尽就不再发请求 */
    assertAvailable(): void {
        if (this.exhausted) {
            throw new GitHubImportError('rate-limited', 'GitHub API rate limit exhausted', {
                limitKind: 'primary',
                resetAt: this.resetAt,
            });
        }
    }

    get exhaustedNow(): boolean {
        return this.exhausted;
    }

    /** 剩余次数；未知时为 undefined */
    get remainingCount(): number | undefined {
        return this.remaining;
    }

    /** 主限额恢复时间（毫秒时间戳）；未知时为 undefined */
    get resetTime(): number | undefined {
        return this.resetAt;
    }
}

interface RequestOptions {
    fetchImpl: FetchLike;
    signal?: AbortSignal;
    rateLimit: RateLimitState;
}

function headerValue(response: ResponseLike, name: string): string | undefined {
    const value = response.headers.get(name);
    return value === null ? undefined : value;
}

/**
 * 把失败响应翻译成错误。
 *
 * 403 有三种来源，必须按响应头区分，不能一律当成限流：
 * - Remaining = 0            → 主限额耗尽，用 reset 时间提示恢复
 * - 有 Retry-After 或明确二级限流信息 → 次级限流
 * - 其余 403                 → 访问被拒绝，不编造恢复时间
 *
 * 404 无法区分「不存在」与「私有」，措辞必须同时覆盖两种可能。
 */
async function toHttpError(response: ResponseLike): Promise<GitHubImportError> {
    const status = response.status;
    let body = '';
    try {
        body = await response.text();
    } catch {
        // 正文读不出来就只按状态码判断
    }
    const lower = body.toLowerCase();
    const remaining = parseHeaderNumber(headerValue(response, 'x-ratelimit-remaining') ?? null);
    const resetRaw = parseHeaderNumber(headerValue(response, 'x-ratelimit-reset') ?? null);
    const resetAt = resetRaw !== undefined && resetRaw > 0 ? resetRaw * 1000 : undefined;
    const retryAfterRaw = parseHeaderNumber(headerValue(response, 'retry-after') ?? null);
    const retryAfterMs = retryAfterRaw !== undefined ? retryAfterRaw * 1000 : undefined;

    if (status === 404) {
        return new GitHubImportError('repo-not-found', 'Repository not found or not publicly accessible');
    }

    if (status === 403 || status === 429) {
        if (remaining === 0) {
            return new GitHubImportError('rate-limited', 'GitHub API rate limit exhausted', {
                limitKind: 'primary',
                resetAt,
            });
        }
        if (retryAfterMs !== undefined || lower.includes('secondary rate limit')) {
            return new GitHubImportError('rate-limited', 'GitHub secondary rate limit hit', {
                limitKind: 'secondary',
                retryAfterMs,
            });
        }
        return new GitHubImportError('access-denied', `Access denied (${status})`);
    }

    if (status >= 500) {
        return new GitHubImportError('network', `GitHub server error (${status})`);
    }

    return new GitHubImportError('network', `Unexpected response (${status})`);
}

function abortError(): GitHubImportError {
    return new GitHubImportError('cancelled', 'Import cancelled');
}

/** 发一次 JSON 请求；失败统一转成 GitHubImportError */
async function requestJson(options: RequestOptions, url: string): Promise<unknown> {
    const { fetchImpl, signal, rateLimit } = options;
    rateLimit.assertAvailable();
    if (signal?.aborted) {
        throw abortError();
    }

    let response: ResponseLike;
    try {
        response = await fetchImpl(url, {
            signal,
            headers: { Accept: 'application/vnd.github+json' },
        });
    } catch (error) {
        if (signal?.aborted) {
            throw abortError();
        }
        throw new GitHubImportError('network', `Request failed: ${url}`, { cause: error });
    }

    rateLimit.observe(response.headers);

    if (!response.ok) {
        throw await toHttpError(response);
    }

    try {
        return await response.json();
    } catch (error) {
        throw new GitHubImportError('network', `Malformed JSON from ${url}`, { cause: error });
    }
}

// ---------------------------------------------------------------------------
// ref 解析
// ---------------------------------------------------------------------------

export interface ResolvedRef {
    /** commit SHA，后续所有下载都用它 */
    sha: string;
    /** 实际解析出的 ref（分支名或标签） */
    ref: string;
    /** ref 之后剩余的路径段 */
    rest: string[];
    /** 解析走的通道：jsdelivr 不吃 REST 配额，api 吃 */
    via: 'jsdelivr' | 'api';
}

/**
 * 用 jsDelivr 的清单接口解析 ref，不消耗 REST API 配额。
 *
 * 这是快速通道的主入口：`data.jsdelivr.com` 回 `Access-Control-Allow-Origin: *`，
 * 而 `github.com` 的动态页面（包括 Atom 订阅源）不回这个头，浏览器里必然被挡。
 * 拿清单本身就是第一步，分支/标签/SHA 都在同一个请求里确认。
 *
 * ref 是分支或标签时 jsDelivr 接受但不给 SHA（CDN 的 `X-JSD-Version` 也只回显分支名），
 * 返回的 `sha` 为空，下载按分支名进行，靠清单里每个文件的 sha256 保证正文与清单一致。
 * ref 本身是 40 位十六进制（用户粘了 commit 链接）时按 commit 处理。
 *
 * 只有清单接口返回 404 才回退更短的候选；遇到 403（超大仓库）等错误直接上抛，
 * 由 resolveSource 决定降级，避免把限流类错误误当成「ref 不存在」。
 */
export async function resolveRefViaJsDelivr(
    owner: string,
    repo: string,
    segments: string[],
    options: RequestOptions
): Promise<ResolvedRef & { tree: TreeEntry[] }> {
    const candidates: Array<{ ref: string; rest: string[] }> = segments.length === 0
        ? [{ ref: 'HEAD', rest: [] }]
        : segments.map((_, index) => ({
            ref: segments.slice(0, segments.length - index).join('/'),
            rest: segments.slice(segments.length - index),
        }));

    // 不能写成 options.fetchImpl(...)：传入的是原生 fetch 时，this 会变成 options，
    // 浏览器直接抛 Illegal invocation，快速通道每次都失败并降级到 API
    const { fetchImpl } = options;
    let sawNotFound = false;
    for (const candidate of candidates) {
        let response: ResponseLike;
        try {
            response = await fetchImpl(jsDelivrListingUrl(owner, repo, candidate.ref), { signal: options.signal });
        } catch (error) {
            if (options.signal?.aborted) {
                throw abortError();
            }
            throw new GitHubImportError('network', 'jsDelivr is unavailable', { cause: error });
        }

        if (response.status === 404) {
            sawNotFound = true;
            continue;
        }
        if (response.status === 403) {
            throw new GitHubImportError('channel-unavailable', 'jsDelivr refused this package', { detail: 'jsdelivr' });
        }
        if (!response.ok) {
            throw new GitHubImportError('network', `jsDelivr responded ${response.status}`);
        }

        return {
            sha: COMMIT_SHA.test(candidate.ref) ? candidate.ref : '',
            ref: candidate.ref === 'HEAD' ? '' : candidate.ref,
            rest: candidate.rest,
            via: 'jsdelivr',
            // 确认 ref 的这个请求就是清单本身，不再重取
            tree: await parseJsDelivrListing(response),
        };
    }

    // 404 既可能是仓库不存在，也可能是 ref 不存在。确认仓库本身在不在，
    // 让「仓库地址写错了」和「分支名写错了」给出不同提示。
    if (sawNotFound && !(await jsDelivrRepoExists(owner, repo, options))) {
        throw new GitHubImportError('repo-not-found', 'Repository not found or not publicly accessible');
    }
    throw new GitHubImportError('ref-not-found', 'Could not resolve the branch, tag or commit in the URL');
}

const COMMIT_SHA = /^[0-9a-f]{40}$/i;

/** 取正文用的版本：固定到 commit 时用 SHA，否则退回分支名；地址里没写分支时是默认分支 HEAD */
export function contentVersion(source: { sha: string; ref: string }): string {
    return source.sha || source.ref || 'HEAD';
}

/** 仓库是否存在（不消耗 GitHub API 配额）：不带版本的清单接口对不存在的仓库回 404 */
async function jsDelivrRepoExists(owner: string, repo: string, options: RequestOptions): Promise<boolean> {
    try {
        const { fetchImpl } = options;
        const response = await fetchImpl(`${JSDELIVR_DATA}/v1/packages/gh/${owner}/${repo}`, { signal: options.signal });
        if (response.status === 404) {
            return false;
        }
        // 5xx 等异常不据此断言仓库不存在
        return true;
    } catch {
        return true;
    }
}

/**
 * 把 `/tree/` 或 `/blob/` 后面的路径段解析成 ref + 子路径。
 *
 * 分支名允许包含 `/`，所以不能取第一段当分支，也不能用 tree 的顶层目录反查。
 * 做法是「最长候选优先」：把 [{全部段}, {前 n-1 段}, ...] 依次当作 ref 去
 * commits 接口确认，第一个成功的就是 ref，剩余段是子路径。
 *
 * 关键约束：只有 404 才继续尝试更短的候选。碰到 403/429（限流）必须立刻中止，
 * 否则限流会被误当成「这个 ref 不存在」而一路退到最短路，最终报错方向完全错误。
 */
export async function resolveRef(
    owner: string,
    repo: string,
    segments: string[],
    options: RequestOptions
): Promise<ResolvedRef> {
    if (segments.length === 0) {
        // 没有显式 ref：commits 接口不带 sha 时返回默认分支的最新提交
        const commit = await requestJson(options, `${GITHUB_API}/repos/${owner}/${repo}/commits?per_page=1`);
        const sha = firstCommitSha(commit);
        if (!sha) {
            throw new GitHubImportError('ref-not-found', 'Could not resolve the default branch');
        }
        return { sha, ref: '', rest: [], via: 'api' };
    }

    // 先确认仓库存在，才能把「仓库不存在」和「ref 不存在」区分开
    await requestJson(options, `${GITHUB_API}/repos/${owner}/${repo}`);

    for (let length = segments.length; length >= 1; length--) {
        const candidate = segments.slice(0, length).join('/');
        let commit: unknown;
        try {
            commit = await requestJson(
                options,
                `${GITHUB_API}/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(candidate)}&per_page=1`
            );
        } catch (error) {
            // 只有 404 意味着「这个候选不是 ref」，可以继续尝试更短的
            if (error instanceof GitHubImportError && error.code === 'repo-not-found') {
                continue;
            }
            throw error;
        }
        const sha = firstCommitSha(commit);
        if (!sha) {
            continue;
        }
        return { sha, ref: candidate, rest: segments.slice(length), via: 'api' };
    }

    throw new GitHubImportError('ref-not-found', 'Could not resolve the branch, tag or commit in the URL');
}

function firstCommitSha(payload: unknown): string | undefined {
    if (Array.isArray(payload)) {
        const first = payload[0] as { sha?: unknown } | undefined;
        return typeof first?.sha === 'string' ? first.sha : undefined;
    }
    // 个别端点直接返回一个 commit 对象
    const direct = payload as { sha?: unknown } | undefined;
    return typeof direct?.sha === 'string' ? direct.sha : undefined;
}

// ---------------------------------------------------------------------------
// tree
// ---------------------------------------------------------------------------

export interface TreeEntry {
    path: string;
    mode: string;
    type: 'blob' | 'tree' | 'commit';
    sha: string;
    /** tree 接口给出的「Git 对象大小」；Git LFS 文件在这里是指针大小，不是真实大小 */
    size?: number;
    /** jsDelivr 清单给出的正文 sha256（base64）；只有快速通道有，用于下载后校验 */
    hash?: string;
}

/** 符号链接在 Git 里是 mode 120000 的 blob，不能当普通文件导入 */
export const SYMLINK_MODE = '120000';
/** 子模块是 mode 160000、type commit 的独立仓库引用 */
export const SUBMODULE_MODE = '160000';

export async function fetchTree(
    owner: string,
    repo: string,
    sha: string,
    options: RequestOptions
): Promise<TreeEntry[]> {
    const payload = await requestJson(
        options,
        `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`
    ) as { tree?: unknown; truncated?: unknown };

    if (payload?.truncated === true) {
        throw new GitHubImportError('truncated', 'Repository is too large: the file list is incomplete');
    }
    if (!Array.isArray(payload?.tree)) {
        throw new GitHubImportError('network', 'Unexpected tree response');
    }
    return payload.tree as TreeEntry[];
}

/**
 * 用 jsDelivr 的清单接口取文件列表，不消耗 GitHub REST 配额。
 *
 * 限制：
 * - 包大于 50 MB 时 jsDelivr 直接拒绝（403），调用方应降级到 API 通道
 * - 清单只有 path/size/hash，**没有 Git mode**，因此查不出子模块和符号链接；
 *   走这条路时完整性校验要靠下游的配置校验兜底
 * - `sha` 也可以是不带 commit 的分支名或标签（见 resolveRefViaJsDelivr）
 */
export async function fetchTreeViaJsDelivr(
    owner: string,
    repo: string,
    sha: string,
    options: RequestOptions
): Promise<TreeEntry[]> {
    const url = jsDelivrListingUrl(owner, repo, sha);

    let response: ResponseLike;
    try {
        const { fetchImpl } = options;
        response = await fetchImpl(url, { signal: options.signal });
    } catch (error) {
        if (options.signal?.aborted) {
            throw abortError();
        }
        throw new GitHubImportError('network', 'jsDelivr is unavailable', { cause: error });
    }

    if (response.status === 403) {
        // 大于 50 MB 的包，或 jsDelivr 拒绝服务；由调用方决定是否降级。
        // 用专门的 code 标记，避免和「项目真的超限」混为一谈
        throw new GitHubImportError('channel-unavailable', 'jsDelivr refused this package', { detail: 'jsdelivr' });
    }
    if (!response.ok) {
        throw new GitHubImportError('network', `jsDelivr responded ${response.status}`);
    }
    return parseJsDelivrListing(response);
}

async function parseJsDelivrListing(response: ResponseLike): Promise<TreeEntry[]> {
    let payload: { files?: unknown };
    try {
        payload = await response.json() as { files?: unknown };
    } catch (error) {
        throw new GitHubImportError('network', 'Malformed jsDelivr response', { cause: error });
    }
    if (!Array.isArray(payload.files)) {
        throw new GitHubImportError('network', 'Unexpected jsDelivr response');
    }

    return (payload.files as Array<{ name?: unknown; hash?: unknown; size?: unknown }>)
        .filter(file => typeof file.name === 'string')
        .map(file => ({
            // jsDelivr 的 name 带前导 `/`，统一成仓库内相对路径
            path: (file.name as string).replace(/^\//, ''),
            // jsDelivr 不给 mode，按普通文件处理（已知取舍，见函数注释）
            mode: '100644',
            type: 'blob' as const,
            sha: '',
            size: typeof file.size === 'number' ? file.size : undefined,
            // 正文的 sha256（base64），下载后据此校验，见 downloadFile
            hash: typeof file.hash === 'string' ? file.hash : undefined,
        }));
}

/** jsDelivr 的清单接口地址；ref 可以是分支、标签或 commit SHA */
export function jsDelivrListingUrl(owner: string, repo: string, ref: string): string {
    // 分支名允许含 `/`，必须整段编码，否则 jsDelivr 只取到第一段（实测返回 400）
    return `${JSDELIVR_DATA}/v1/packages/gh/${owner}/${repo}@${encodeURIComponent(ref)}?structure=flat`;
}

/** jsDelivr 上取单个文件正文的 URL；version 是 commit SHA 或分支/标签名 */
export function jsDelivrFileUrl(owner: string, repo: string, version: string, filePath: string): string {
    const encoded = filePath.split('/').map(encodeURIComponent).join('/');
    // 与清单接口相同，含 `/` 的分支名要整段编码，否则 CDN 把第一段当分支、其余当路径
    return `${JSDELIVR_CDN}/gh/${owner}/${repo}@${encodeURIComponent(version)}/${encoded}`;
}

// ---------------------------------------------------------------------------
// 工程发现与校验
// ---------------------------------------------------------------------------

export interface ProjectCandidate {
    /** 工程根在仓库内的路径，'' 表示仓库根 */
    rootPath: string;
    name: string;
    resolution?: string;
    mainHmlFile?: string;
    /** 工程范围内需要下载的文件数 */
    fileCount: number;
    /** 按 tree 大小估算的体积（LFS 文件会低估，落库前还有真实字节刹车） */
    estimatedBytes: number;
}

/**
 * 仓库内某个工程的稳定标识，用来识别「这个工程已经导入过」。
 *
 * 只由仓库和工程根路径决定，不含分支和 SHA：同一个工程换分支或仓库有更新，
 * 都视为同一份副本，由用户选择打开已有副本还是重新下载覆盖，不再生成第二份。
 * GitHub 的 owner/repo 不区分大小写，统一转小写。
 */
export function githubSourceKey(owner: string, repo: string, rootPath: string): string {
    const base = `github.com/${owner.toLowerCase()}/${repo.toLowerCase()}`;
    return rootPath ? `${base}/${rootPath}` : base;
}

export interface ResolvedSource {
    owner: string;
    repo: string;
    sha: string;
    ref: string;
    /** 限定搜索范围（'' 表示仓库根） */
    scopePath: string;
    tree: TreeEntry[];
    candidates: ProjectCandidate[];
    /** 文件正文从哪个通道取 */
    contentChannel: 'jsdelivr' | 'raw';
    /**
     * 是否固定到了某个 commit。false 表示快速通道按分支名取（jsDelivr 不把分支解析成 commit），
     * 下载和链接都用分支名，正文由清单里的 sha256 校验
     */
    pinned: boolean;
}

/**
 * 解析仓库并取文件清单，优先走不消耗 GitHub REST 配额的组合：
 *
 *   ref + 清单 → data.jsdelivr.com  （不吃配额，CORS 放行；清单带每个文件的 sha256）
 *   正文       → cdn.jsdelivr.net   （不吃配额）
 *
 * 分支导入不固定 commit：jsDelivr 没有免配额且放行 CORS 的接口能把分支解析成 SHA。
 *
 * 注意不走 Atom：`github.com` 的动态页面不回 `Access-Control-Allow-Origin`，
 * 浏览器里必然被 CORS 挡住，之前每一步都要靠降级到 API 才能完成。
 *
 * 任一环失败（jsDelivr 包超 50 MB、网络）就整体降级到
 * api.github.com + raw.githubusercontent.com：这条路径每次导入耗 2 次配额，
 * 但能覆盖大仓库和取不到 mode 的场景。
 *
 * `forceApi` 让调用方在需要严格校验（子模块 / 符号链接）时直接走 API。
 */
/** API 配额用尽时的报错：快速通道是因体积被拒的，就报体积原因而不是单纯限流 */
function quotaError(fallbackReason: GitHubImportError | undefined, resetAt: number | undefined): GitHubImportError {
    if (fallbackReason?.code === 'channel-unavailable') {
        return new GitHubImportError(
            'channel-unavailable',
            'This repository is too large for the fast channel and the API quota is used up',
            { resetAt }
        );
    }
    return new GitHubImportError('rate-limited', 'GitHub API rate limit exhausted', {
        limitKind: 'primary',
        resetAt,
    });
}

export async function resolveSource(
    owner: string,
    repo: string,
    segments: string[],
    options: RequestOptions & { forceApi?: boolean }
): Promise<ResolvedSource> {
    let fallbackReason: GitHubImportError | undefined;
    if (!options.forceApi) {
        try {
            const { tree, ...resolved } = await resolveRefViaJsDelivr(owner, repo, segments, options);
            return {
                owner,
                repo,
                sha: resolved.sha,
                ref: resolved.ref,
                scopePath: resolved.rest.join('/'),
                tree,
                candidates: [],
                contentChannel: 'jsdelivr',
                pinned: COMMIT_SHA.test(resolved.sha),
            };
        } catch (error) {
            // 取消要原样向上抛，不能被当成「降级信号」
            if (error instanceof GitHubImportError && error.code === 'cancelled') {
                throw error;
            }
            fallbackReason = error instanceof GitHubImportError ? error : undefined;
        }

        // 降级前先看 API 配额够不够。不够就报真实原因（例如「包太大，且配额已用尽」），
        // 而不是让用户看到一个与体积无关的限流错误
        if (options.rateLimit.exhaustedNow) {
            throw quotaError(fallbackReason, options.rateLimit.resetTime);
        }
    }

    let resolved: ResolvedRef;
    let tree: TreeEntry[];
    try {
        resolved = await resolveRef(owner, repo, segments, options);
        tree = await fetchTree(owner, repo, resolved.sha, options);
    } catch (error) {
        // 配额通常要等第一次 API 调用才知道已用尽；此时同样要报快速通道被拒的真实原因
        if (
            fallbackReason?.code === 'channel-unavailable' &&
            error instanceof GitHubImportError &&
            error.code === 'rate-limited' &&
            error.options.limitKind === 'primary'
        ) {
            throw quotaError(fallbackReason, error.options.resetAt);
        }
        throw error;
    }
    return {
        owner,
        repo,
        sha: resolved.sha,
        ref: resolved.ref,
        scopePath: resolved.rest.join('/'),
        tree,
        candidates: [],
        contentChannel: 'raw',
        pinned: true,
    };
}

/** 仓库内相对路径的 posix 目录名；根目录为 '' */
function parentOf(entryPath: string): string {
    const dir = path.posix.dirname(entryPath);
    return dir === '.' ? '' : dir;
}

function isUnder(entryPath: string, rootPath: string): boolean {
    if (rootPath === '') {
        return true;
    }
    return entryPath === rootPath || entryPath.startsWith(`${rootPath}/`);
}

function relativeTo(entryPath: string, rootPath: string): string {
    return rootPath === '' ? entryPath : entryPath.slice(rootPath.length + 1);
}

/**
 * 主 HML 的判定规则与 `browserHost.findMainHml` 保持一致：
 * 优先 project.json 里的 mainHmlFile，其次取 ui/ 下路径最短的 .hml。
 * 这里只是把同一套规则作用在内存文件集合上，不另行定义「什么算有效工程」。
 */
export function pickMainHml(config: { mainHmlFile?: unknown; uiDir?: unknown }, files: string[]): string | undefined {
    if (typeof config.mainHmlFile === 'string' && files.includes(config.mainHmlFile)) {
        return config.mainHmlFile;
    }
    const uiDir = typeof config.uiDir === 'string' && config.uiDir ? config.uiDir.replace(/\/+$/, '') : 'ui';
    const hmlFiles = files
        .filter(file => file.startsWith(`${uiDir}/`) && file.toLowerCase().endsWith('.hml'))
        .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
    return hmlFiles[0];
}

/**
 * 找出范围内的工程。候选 project.json 的正文需要下载后才能拿到工程名，
 * 这一步只为展示，体积很小；真正的完整性校验在下载完成后再做。
 */
export async function discoverProjects(
    owner: string,
    repo: string,
    sha: string,
    tree: TreeEntry[],
    scopePath: string,
    options: RequestOptions & {
        /** 下载候选 project.json 正文；失败不致命，用目录名兜底 */
        readText?: (entry: TreeEntry) => Promise<string | undefined>;
    }
): Promise<ProjectCandidate[]> {
    const projectJsonEntries = tree.filter(entry =>
        entry.type === 'blob' && path.posix.basename(entry.path) === 'project.json' && isUnder(entry.path, scopePath)
    );

    const readText = options.readText;
    const candidates: ProjectCandidate[] = [];

    for (const entry of projectJsonEntries) {
        const rootPath = parentOf(entry.path);
        const scoped = tree.filter(item => item.type === 'blob' && isUnder(item.path, rootPath));
        const files = scoped.map(item => relativeTo(item.path, rootPath));

        let raw: string | undefined;
        if (readText) {
            try {
                raw = await readText(entry);
            } catch (error) {
                // 读不到正文不影响列出候选，工程名退回目录名
                if (error instanceof GitHubImportError && (error.code === 'cancelled' || error.code === 'rate-limited')) {
                    throw error;
                }
                raw = undefined;
            }
        }

        let config: Record<string, unknown> = {};
        try {
            const parsed = raw ? JSON.parse(raw) : undefined;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                config = parsed as Record<string, unknown>;
            }
        } catch {
            // 解析失败时仍列为候选，由后续校验给出具体原因
        }

        const mainHmlFile = pickMainHml(config, files);
        const name = typeof config.name === 'string' && config.name.trim()
            ? config.name.trim()
            : (rootPath ? path.posix.basename(rootPath) : repo);

        candidates.push({
            rootPath,
            name,
            resolution: typeof config.resolution === 'string' ? config.resolution : undefined,
            mainHmlFile,
            fileCount: scoped.length,
            estimatedBytes: scoped.reduce((total, item) => total + (item.size ?? 0), 0),
        });
    }

    // 浅的先列，便于用户按直觉选择
    return candidates.sort((a, b) =>
        a.rootPath.split('/').length - b.rootPath.split('/').length || a.rootPath.localeCompare(b.rootPath)
    );
}

// ---------------------------------------------------------------------------
// 下载
// ---------------------------------------------------------------------------

export class CancelToken {
    private cancelled = false;
    private readonly controller = new AbortController();

    get signal(): AbortSignal {
        return this.controller.signal;
    }

    get isCancelled(): boolean {
        return this.cancelled;
    }

    cancel(): void {
        if (this.cancelled) {
            return;
        }
        this.cancelled = true;
        // 中止所有在途请求，排队中的请求在发起前检查 isCancelled
        this.controller.abort();
    }

    throwIfCancelled(): void {
        if (this.cancelled) {
            throw abortError();
        }
    }
}

export interface DownloadProgress {
    filesDone: number;
    filesTotal: number;
    bytesDone: number;
    /** tree 估算的总体积；LFS 会低估，只作展示 */
    bytesEstimated: number;
}

export interface DownloadOptions extends RequestOptions {
    token?: CancelToken;
    onProgress?: (progress: DownloadProgress) => void;
    /** 绝对上限，默认 ABSOLUTE_MAX_BYTES；测试可调小 */
    maxBytes?: number;
}

export interface DownloadedProject {
    name: string;
    /** 工程内相对路径 → 内容 */
    files: Map<string, Uint8Array>;
    mainHmlFile: string;
    /** 范围内存在声明 filter=lfs 的 .gitattributes，作为提示；实际判定以指针嗅探为准 */
    lfsDeclared: boolean;
}

/** raw URL 里每个路径段单独编码，中文与空格都能正确取到 */
export function rawFileUrl(owner: string, repo: string, sha: string, filePath: string): string {
    const encoded = filePath.split('/').map(encodeURIComponent).join('/');
    return `${GITHUB_RAW}/${owner}/${repo}/${sha}/${encoded}`;
}

/**
 * 内容通道的 URL。
 * jsDelivr 与 raw 都按 SHA 定位，因此下载期间文件集不会因分支被推新而变化。
 */
function contentUrl(
    channel: 'jsdelivr' | 'raw',
    owner: string,
    repo: string,
    sha: string,
    filePath: string
): string {
    return channel === 'jsdelivr'
        ? jsDelivrFileUrl(owner, repo, sha, filePath)
        : rawFileUrl(owner, repo, sha, filePath);
}

/** 读正文并逐块累计；超过上限立刻取消读取，不等整个文件进内存 */
async function readWithCap(
    response: ResponseLike,
    maxBytes: number,
    state: { bytes: number; aborted: boolean }
): Promise<Uint8Array> {
    if (!response.body) {
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        state.bytes += bytes.byteLength;
        if (state.bytes > maxBytes) {
            state.aborted = true;
            throw new GitHubImportError('too-large', 'Download exceeded the import size limit', {
                detail: String(state.bytes),
            });
        }
        return bytes;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        // 共享的 bytes 计数已能让其它在途流在下一块因超限退出；
        // 这个标记只是让它们省掉那次多余的读取
        if (state.aborted) {
            await reader.cancel();
            throw new GitHubImportError('cancelled', 'Download aborted');
        }
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        if (!value) {
            continue;
        }
        total += value.byteLength;
        state.bytes += value.byteLength;
        if (state.bytes > maxBytes || total > maxBytes) {
            state.aborted = true;
            await reader.cancel();
            throw new GitHubImportError('too-large', 'Download exceeded the import size limit', {
                detail: String(state.bytes),
            });
        }
        chunks.push(value);
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return merged;
}

function startsWithLfsPointer(bytes: Uint8Array): boolean {
    const head = bytes.subarray(0, Math.min(bytes.byteLength, LFS_POINTER_PREFIX.length));
    return new TextDecoder().decode(head) === LFS_POINTER_PREFIX.slice(0, head.byteLength);
}

/** 取单个文件的正文；任何失败都放大成整体失败，不产出残缺工程 */
async function downloadFile(
    source: ResolvedSource,
    entry: TreeEntry,
    options: DownloadOptions,
    state: { bytes: number; aborted: boolean }
): Promise<Uint8Array> {
    const { owner, repo, contentChannel: channel } = source;
    const version = contentVersion(source);
    const { fetchImpl, rateLimit, signal, token } = options;
    token?.throwIfCancelled();
    if (signal?.aborted) {
        throw abortError();
    }

    // raw 不计入 REST 限额的实现细节不作依赖，这里不调用 assertAvailable，
    // 但仍会观察响应头，以便后续 REST 调用准确判断剩余额度
    let response: ResponseLike;
    try {
        response = await fetchImpl(contentUrl(channel, owner, repo, version, entry.path), { signal });
    } catch (error) {
        if (token?.isCancelled || signal?.aborted) {
            throw abortError();
        }
        throw new GitHubImportError('network', `Failed to download ${entry.path}`, {
            paths: [entry.path],
            cause: error,
        });
    }

    rateLimit.observe(response.headers);

    if (!response.ok) {
        const error = await toHttpError(response);
        throw new GitHubImportError(error.code, error.message, { ...error.options, paths: [entry.path] });
    }

    let bytes: Uint8Array;
    try {
        bytes = await readWithCap(response, options.maxBytes ?? ABSOLUTE_MAX_BYTES, state);
    } catch (error) {
        if (error instanceof GitHubImportError && error.code === 'too-large') {
            throw error;
        }
        if (token?.isCancelled || signal?.aborted) {
            throw abortError();
        }
        throw new GitHubImportError('network', `Failed to read ${entry.path}`, {
            paths: [entry.path],
            cause: error,
        });
    }

    if (startsWithLfsPointer(bytes)) {
        throw new GitHubImportError('lfs-pointer', 'Repository stores this file in Git LFS', {
            paths: [entry.path],
        });
    }

    // 快速通道用清单里的 sha256 校验正文。API 通道给出的是 Git blob SHA-1，
    // 算法不同，这里不校验（那条通道的正文由 GitHub 自己保证）
    if (channel === 'jsdelivr' && entry.hash) {
        const actual = await sha256Base64(bytes);
        if (actual !== entry.hash) {
            throw new GitHubImportError('network', `Content check failed for ${entry.path}`, {
                paths: [entry.path],
            });
        }
    }

    return bytes;
}

/** sha256 的 base64 编码，与 jsDelivr 清单里的 hash 格式一致 */
async function sha256Base64(bytes: Uint8Array): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
    const view = new Uint8Array(digest);
    let binary = '';
    for (const byte of view) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

/** 固定并发的任务池；取消后不再派发新任务，但会等已发起的全部结束 */
async function runPool<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>,
    token?: CancelToken
): Promise<void> {
    let index = 0;
    let failure: unknown;
    const runners: Promise<void>[] = [];

    const next = async (): Promise<void> => {
        for (;;) {
            if (failure !== undefined) {
                return;
            }
            if (token?.isCancelled) {
                return;
            }
            const current = index++;
            if (current >= items.length) {
                return;
            }
            try {
                await worker(items[current]);
            } catch (error) {
                if (failure === undefined) {
                    failure = error;
                }
                return;
            }
        }
    };

    const workerCount = Math.max(1, Math.min(concurrency, items.length));
    for (let i = 0; i < workerCount; i++) {
        runners.push(next());
    }
    await Promise.all(runners);

    if (failure !== undefined) {
        throw failure;
    }
    if (token?.isCancelled) {
        throw abortError();
    }
}

/**
 * 下载选定工程的文件集合，并做完整性校验。
 *
 * 校验顺序（任一不满足都不返回结果）：
 * 1. 范围内不得有子模块、符号链接（只看选定工程范围，仓库别处有不影响）
 * 2. 按 tree 估算体积做提前拒绝，并交给调用方决定是否确认
 * 3. 逐个下载，累计真实字节达到绝对上限立即中止
 * 4. 嗅探 LFS 指针，命中即失败
 * 5. project.json 必须能解析且存在主 HML
 */
export async function downloadProject(
    source: ResolvedSource,
    candidate: ProjectCandidate,
    options: DownloadOptions
): Promise<DownloadedProject> {
    const { tree } = source;
    const scope = tree.filter(entry => isUnder(entry.path, candidate.rootPath));

    const submodules = scope.filter(entry => entry.type === 'commit' || entry.mode === SUBMODULE_MODE);
    if (submodules.length > 0) {
        throw new GitHubImportError('submodule', 'The selected project contains git submodules', {
            paths: submodules.map(entry => entry.path),
        });
    }

    const symlinks = scope.filter(entry => entry.type === 'blob' && entry.mode === SYMLINK_MODE);
    if (symlinks.length > 0) {
        throw new GitHubImportError('symlink', 'The selected project contains symbolic links', {
            paths: symlinks.map(entry => entry.path),
        });
    }

    const blobs = scope.filter(entry => entry.type === 'blob');
    if (blobs.length === 0) {
        throw new GitHubImportError('no-project', 'The selected project contains no files');
    }

    const maxBytes = options.maxBytes ?? ABSOLUTE_MAX_BYTES;
    const estimated = blobs.reduce((total, entry) => total + (entry.size ?? 0), 0);
    if (estimated > maxBytes) {
        throw new GitHubImportError('too-large', 'Project exceeds the import size limit', {
            detail: String(estimated),
        });
    }

    const files = new Map<string, Uint8Array>();
    // aborted 是「整次下载作废」的开关：超限或失败时置位，让其余在途请求也尽快停下，
    // 只 cancel 触发上限的那一条流的话，其它 5 路仍会把剩余字节读完
    const state = { bytes: 0, aborted: false };
    let filesDone = 0;
    const report = (): void => {
        options.onProgress?.({
            filesDone,
            filesTotal: blobs.length,
            bytesDone: state.bytes,
            bytesEstimated: estimated,
        });
    };
    report();

    await runPool(blobs, MAX_CONCURRENCY, async entry => {
        if (state.aborted) {
            // 已经在收尾，不必再发起新请求
            throw new GitHubImportError('cancelled', 'Download aborted');
        }
        const bytes = await downloadFile(source, entry, options, state);
        files.set(relativeTo(entry.path, candidate.rootPath), bytes);
        filesDone += 1;
        report();
    }, options.token);

    return finalizeProject(candidate, files);
}

/** 下载完成后的最后一道校验：配置可解析、主 HML 存在 */
export function finalizeProject(
    candidate: ProjectCandidate,
    files: Map<string, Uint8Array>
): DownloadedProject {
    const decoder = new TextDecoder();
    const projectJson = files.get('project.json');
    if (!projectJson) {
        throw new GitHubImportError('invalid-project', 'project.json is missing');
    }

    let config: Record<string, unknown>;
    try {
        const parsed = JSON.parse(decoder.decode(projectJson));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('project.json is not an object');
        }
        config = parsed as Record<string, unknown>;
    } catch (error) {
        throw new GitHubImportError('invalid-project', 'project.json could not be parsed', { cause: error });
    }

    const mainHmlFile = pickMainHml(config, [...files.keys()]);
    if (!mainHmlFile) {
        throw new GitHubImportError('invalid-project', 'No HML file found in the project');
    }

    const attributes = files.get('.gitattributes');
    const lfsDeclared = attributes
        ? decoder.decode(attributes).split('\n').some(line => /(^|\s)filter=lfs(\s|$)/.test(line))
        : false;

    const name = typeof config.name === 'string' && config.name.trim()
        ? config.name.trim()
        : candidate.name;

    return { name, files, mainHmlFile, lfsDeclared };
}

// ---------------------------------------------------------------------------
// 存储容量
// ---------------------------------------------------------------------------

/**
 * 下载前检查站点剩余配额。
 * `navigator.storage.estimate()` 只是估计值，不能替代写入失败处理 ——
 * 调用方仍需捕获落库阶段的实际错误并回滚。
 */
export async function assertStorageCapacity(
    neededBytes: number,
    estimate: () => Promise<{ quota?: number; usage?: number }>
): Promise<void> {
    let quota: number | undefined;
    let usage: number | undefined;
    try {
        const result = await estimate();
        quota = result.quota;
        usage = result.usage;
    } catch {
        // 拿不到估计值就交给实际写入去报错，不阻断导入
        return;
    }
    if (quota === undefined) {
        return;
    }
    const available = quota - (usage ?? 0);
    if (available < neededBytes) {
        throw new GitHubImportError('quota', 'Not enough browser storage for this project', {
            detail: String(available),
        });
    }
}
