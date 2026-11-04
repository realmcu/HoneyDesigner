/**
 * GitHub 导入的纯逻辑与边界：URL 解析、ref 解析顺序、限流与 403 分类、
 * tree 截断、子模块/符号链接拒绝、LFS 指针嗅探、字节刹车。
 *
 * 全部使用注入的假 fetch，不打真实网络。
 */
import {
    ABSOLUTE_MAX_BYTES,
    CancelToken,
    DownloadProgress,
    FetchLike,
    GitHubImportError,
    RateLimitState,
    ResponseLike,
    TreeEntry,
    assertStorageCapacity,
    discoverProjects,
    downloadProject,
    fetchTree,
    fetchTreeViaJsDelivr,
    finalizeProject,
    githubSourceKey,
    parseGitHubUrl,
    pickMainHml,
    rawFileUrl,
    resolveRef,
    resolveRefViaAtom,
    resolveSource,
} from '../../web/host/githubImport';
import { GITHUB_TEMPLATES } from '../../web/host/exampleProjects';
import { AVAILABLE_TEMPLATES } from '../../template/TemplateConfig';
import en from '../../webview/i18n/locales/en';
import zhCN from '../../webview/i18n/locales/zh-cn';

// ---------------------------------------------------------------------------
// 假 fetch
// ---------------------------------------------------------------------------

interface FakeResponseInit {
    status?: number;
    headers?: Record<string, string>;
    body?: string;
    json?: unknown;
    /** 分块返回，用于验证流式累计 */
    chunks?: Uint8Array[];
    /** 模拟读取过程中抛错 */
    readError?: unknown;
}

function makeResponse(init: FakeResponseInit): ResponseLike {
    const status = init.status ?? 200;
    const headers = new Map(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const text = init.body ?? (init.json !== undefined ? JSON.stringify(init.json) : '');

    const base: ResponseLike = {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: name => headers.get(name.toLowerCase()) ?? null },
        text: async () => text,
        json: async () => (init.json !== undefined ? init.json : JSON.parse(text)),
        arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
    };

    if (init.chunks) {
        let index = 0;
        base.body = {
            getReader: () => ({
                read: async () => {
                    if (init.readError !== undefined && index === init.chunks!.length) {
                        throw init.readError;
                    }
                    if (index >= init.chunks!.length) {
                        return { done: true };
                    }
                    return { done: false, value: init.chunks![index++] };
                },
                cancel: () => undefined,
            }),
        };
    }

    return base;
}

interface Call {
    url: string;
    signal?: AbortSignal;
}

/** 按 URL 匹配返回响应；记录调用顺序 */
function makeFetch(routes: Array<{ match: RegExp | string; response: FakeResponseInit | (() => FakeResponseInit) }>): {
    fetchImpl: FetchLike;
    calls: Call[];
} {
    const calls: Call[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
        calls.push({ url, signal: init.signal });
        for (const route of routes) {
            const hit = typeof route.match === 'string' ? url.includes(route.match) : route.match.test(url);
            if (hit) {
                const value = typeof route.response === 'function' ? route.response() : route.response;
                // json 优先，其次 body；都为空的 200 视为空正文
                if (value.json !== undefined) {
                    return makeResponse({ ...value, status: value.status ?? 200 });
                }
                return makeResponse({ status: 200, ...value });
            }
        }
        return makeResponse({ status: 500, body: `unmatched ${url}` });
    };
    return { fetchImpl, calls };
}

const noop = (): RateLimitState => new RateLimitState();

// ---------------------------------------------------------------------------
// URL 解析
// ---------------------------------------------------------------------------

describe('parseGitHubUrl', () => {
    it('解析普通仓库地址', () => {
        expect(parseGitHubUrl('https://github.com/realmcu/HoneyDesigner')).toEqual({
            owner: 'realmcu',
            repo: 'HoneyDesigner',
            pathSegments: [],
            isBlob: false,
        });
    });

    it('去掉 .git 后缀、容忍结尾斜杠与空格', () => {
        expect(parseGitHubUrl('  https://github.com/owner/repo.git/  ')).toEqual({
            owner: 'owner',
            repo: 'repo',
            pathSegments: [],
            isBlob: false,
        });
    });

    it('省略协议时补 https', () => {
        expect(parseGitHubUrl('github.com/owner/repo').repo).toBe('repo');
    });

    it('保留 /tree/ 后的全部路径段，不在这里切分 ref', () => {
        // 分支名可以是 feat/x，无法从字面判断哪一段是 ref
        const location = parseGitHubUrl('https://github.com/owner/repo/tree/feat/some-branch/ui');
        expect(location.pathSegments).toEqual(['feat', 'some-branch', 'ui']);
    });

    it('识别 /blob/ 文件链接', () => {
        const location = parseGitHubUrl('https://github.com/owner/repo/blob/main/ui/AppMain.hml');
        expect(location.isBlob).toBe(true);
        expect(location.pathSegments).toEqual(['main', 'ui', 'AppMain.hml']);
    });

    it('中文与空格路径正确解码', () => {
        const location = parseGitHubUrl('https://github.com/owner/repo/tree/main/%E7%95%8C%E9%9D%A2%20files');
        expect(location.pathSegments).toEqual(['main', '界面 files']);
    });

    it('非 github.com 域名拒绝', () => {
        expect(() => parseGitHubUrl('https://gitlab.com/owner/repo'))
            .toThrow(expect.objectContaining({ code: 'invalid-url' }));
    });

    it('Gitee 地址归为「不支持」而不是「地址格式错误」', () => {
        // 浏览器里 Gitee 的 raw 与 archive 都不回 ACAO，api/v5 逐文件又受 60 次/小时限额，
        // 因此要能和「URL 写错了」区分开，提示才给得出下一步
        for (const url of [
            'https://gitee.com/realmcu/honeygui-template-chatbot',
            'https://www.gitee.com/realmcu/honeygui-template-chatbot',
        ]) {
            expect(() => parseGitHubUrl(url))
                .toThrow(expect.objectContaining({ code: 'unsupported-host' }));
        }
    });

    it('只给到 owner 的地址拒绝', () => {
        expect(() => parseGitHubUrl('https://github.com/owner'))
            .toThrow(expect.objectContaining({ code: 'invalid-url' }));
    });

    it('/releases 之类的子页面按仓库根处理', () => {
        expect(parseGitHubUrl('https://github.com/owner/repo/releases').pathSegments).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// ref 解析
// ---------------------------------------------------------------------------

describe('resolveRef', () => {
    it('没有显式 ref 时取默认分支的最新提交', async () => {
        const { fetchImpl, calls } = makeFetch([
            { match: /\/commits\?per_page=1$/, response: { json: [{ sha: 'defaultsha' }] } },
        ]);
        const resolved = await resolveRef('o', 'r', [], { fetchImpl, rateLimit: noop() });
        expect(resolved.sha).toBe('defaultsha');
        expect(resolved.rest).toEqual([]);
        expect(calls).toHaveLength(1);
    });

    it('最长候选优先：含 / 的分支名不会被拆错', async () => {
        const { fetchImpl, calls } = makeFetch([
            { match: /\/repos\/o\/r$/, response: { json: { default_branch: 'main' } } },
            {
                match: /commits\?sha=feat%2Fnew-ui%2Fui&/,
                response: { json: [{ sha: 'sha-full' }] },
            },
        ]);
        const resolved = await resolveRef('o', 'r', ['feat', 'new-ui', 'ui'], { fetchImpl, rateLimit: noop() });
        // 最长候选 feat/new-ui/ui 命中，剩余路径为空
        expect(resolved.ref).toBe('feat/new-ui/ui');
        expect(resolved.rest).toEqual([]);
        expect(resolved.sha).toBe('sha-full');
        // 先确认仓库，再试最长候选；不应继续尝试更短的候选
        expect(calls.filter(c => c.url.includes('/commits?')).length).toBe(1);
    });

    it('最长候选不存在时依次回退到更短的候选', async () => {
        const { fetchImpl, calls } = makeFetch([
            { match: /\/repos\/o\/r$/, response: { json: {} } },
            { match: /sha=feat%2Fui%2Fsub&/, response: { status: 404, json: { message: 'Not Found' } } },
            { match: /sha=feat%2Fui&/, response: { json: [{ sha: 'sha-feat-ui' }] } },
        ]);
        const resolved = await resolveRef('o', 'r', ['feat', 'ui', 'sub'], { fetchImpl, rateLimit: noop() });
        expect(resolved.ref).toBe('feat/ui');
        expect(resolved.rest).toEqual(['sub']);
        expect(calls.filter(c => c.url.includes('/commits?')).length).toBe(2);
    });

    it('限流时立即中止，不能当作 ref 不存在继续回退', async () => {
        const rateLimit = new RateLimitState();
        const { fetchImpl, calls } = makeFetch([
            { match: /\/repos\/o\/r$/, response: { json: {} } },
            {
                match: /\/commits\?/,
                response: {
                    status: 403,
                    headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' },
                    json: { message: 'API rate limit exceeded' },
                },
            },
        ]);

        await expect(resolveRef('o', 'r', ['a', 'b'], { fetchImpl, rateLimit }))
            .rejects.toMatchObject({ code: 'rate-limited', options: { limitKind: 'primary' } });
        // 关键：只试了一次，没有继续退到 'a'
        expect(calls.filter(c => c.url.includes('/commits?')).length).toBe(1);
    });

    it('所有候选都不存在时报 ref-not-found', async () => {
        const { fetchImpl } = makeFetch([
            { match: /\/repos\/o\/r$/, response: { json: {} } },
            { match: /\/commits\?/, response: { status: 404, json: { message: 'Not Found' } } },
        ]);
        await expect(resolveRef('o', 'r', ['nope', 'sub'], { fetchImpl, rateLimit: noop() }))
            .rejects.toMatchObject({ code: 'ref-not-found' });
    });

    it('仓库不存在时报 repo-not-found，不继续试 ref', async () => {
        const { fetchImpl, calls } = makeFetch([
            { match: /\/repos\/o\/r$/, response: { status: 404, json: { message: 'Not Found' } } },
        ]);
        await expect(resolveRef('o', 'r', ['main'], { fetchImpl, rateLimit: noop() }))
            .rejects.toMatchObject({ code: 'repo-not-found' });
        expect(calls).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// atom 通道（不消耗 REST 配额）
// ---------------------------------------------------------------------------

function atomXml(sha: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Recent Commits to repo:master</title>
  <entry>
    <id>tag:github.com,2008:Grit::Commit/${sha}</id>
  </entry>
</feed>`;
}

describe('parseAtomSha / resolveRefViaAtom', () => {
    it('从 Atom 订阅源解析出 commit SHA', async () => {
        const { fetchImpl, calls } = makeFetch([
            { match: /commits\/HEAD\.atom/, response: { body: atomXml('a'.repeat(40)) } },
        ]);
        const resolved = await resolveRefViaAtom('o', 'r', [], { fetchImpl, rateLimit: noop() });
        expect(resolved.sha).toBe('a'.repeat(40));
        expect(resolved.via).toBe('atom');
        expect(calls[0].url).toContain('github.com/o/r/commits/HEAD.atom');
    });

    it('带 / 的分支名整段作为 ref，不做拆分', async () => {
        const { fetchImpl } = makeFetch([
            { match: /commits\/feat%2Fnew-ui\.atom|commits\/feat\/new-ui\.atom/, response: { body: atomXml('b'.repeat(40)) } },
        ]);
        const resolved = await resolveRefViaAtom('o', 'r', ['feat', 'new-ui'], { fetchImpl, rateLimit: noop() });
        expect(resolved.ref).toBe('feat/new-ui');
        expect(resolved.rest).toEqual([]);
    });

    it('最长候选 404 时回退到更短的候选', async () => {
        const { fetchImpl, calls } = makeFetch([
            { match: /commits\/feat\/ui\/sub\.atom/, response: { status: 404, body: 'nope' } },
            { match: /commits\/feat\/ui\.atom/, response: { body: atomXml('c'.repeat(40)) } },
        ]);
        const resolved = await resolveRefViaAtom('o', 'r', ['feat', 'ui', 'sub'], { fetchImpl, rateLimit: noop() });
        expect(resolved.ref).toBe('feat/ui');
        expect(resolved.rest).toEqual(['sub']);
        expect(calls).toHaveLength(2);
    });

    it('全部候选 404 时报 ref-not-found', async () => {
        const { fetchImpl } = makeFetch([
            { match: /\.atom/, response: { status: 404, body: 'nope' } },
        ]);
        await expect(resolveRefViaAtom('o', 'r', ['x', 'y'], { fetchImpl, rateLimit: noop() }))
            .rejects.toMatchObject({ code: 'ref-not-found' });
    });

    it('订阅源里没有 commit id 时抛错，交由 API 兜底', async () => {
        const { fetchImpl } = makeFetch([
            { match: /\.atom/, response: { body: '<feed><title>no commits</title></feed>' } },
        ]);
        await expect(resolveRefViaAtom('o', 'r', [], { fetchImpl, rateLimit: noop() }))
            .rejects.toMatchObject({ code: 'network' });
    });
});

// ---------------------------------------------------------------------------
// jsDelivr 清单
// ---------------------------------------------------------------------------

describe('fetchTreeViaJsDelivr', () => {
    it('把 jsDelivr 的前导斜杠去掉，转成仓库内相对路径', async () => {
        const { fetchImpl, calls } = makeFetch([
            {
                match: /data\.jsdelivr\.com/,
                response: {
                    json: {
                        files: [
                            { name: '/project.json', size: 40 },
                            { name: '/ui/Main.hml', size: 60 },
                        ],
                    },
                },
            },
        ]);
        const tree = await fetchTreeViaJsDelivr('o', 'r', 'deadbeef', { fetchImpl, rateLimit: noop() });
        expect(tree.map(e => e.path)).toEqual(['project.json', 'ui/Main.hml']);
        expect(tree.every(e => e.type === 'blob')).toBe(true);
        expect(tree[0].size).toBe(40);
        // 按 SHA 取，不是按分支名
        expect(calls[0].url).toContain('@deadbeef');
    });

    it('403 时用 channel-unavailable 标记，供上层降级', async () => {
        const { fetchImpl } = makeFetch([
            { match: /data\.jsdelivr\.com/, response: { status: 403, body: 'Package size exceeded' } },
        ]);
        await expect(fetchTreeViaJsDelivr('o', 'r', 'sha', { fetchImpl, rateLimit: noop() }))
            .rejects.toMatchObject({ code: 'channel-unavailable', options: { detail: 'jsdelivr' } });
    });
});

// ---------------------------------------------------------------------------
// 双通道选择
// ---------------------------------------------------------------------------

describe('resolveSource 通道选择', () => {
    const jsdelivrOk = (): Array<{ match: RegExp; response: FakeResponseInit | (() => FakeResponseInit) }> => [
        { match: /commits\/HEAD\.atom/, response: { body: atomXml('d'.repeat(40)) } },
        {
            match: /data\.jsdelivr\.com/,
            response: { json: { files: [{ name: '/project.json', size: 10 }] } },
        },
    ];

    it('默认走 atom + jsDelivr，不碰 api.github.com', async () => {
        const { fetchImpl, calls } = makeFetch(jsdelivrOk());
        const source = await resolveSource('o', 'r', [], { fetchImpl, rateLimit: noop() });
        expect(source.contentChannel).toBe('jsdelivr');
        expect(source.sha).toBe('d'.repeat(40));
        expect(calls.some(c => c.url.includes('api.github.com'))).toBe(false);
    });

    it('jsDelivr 拒绝大包时降级到 API 通道', async () => {
        const { fetchImpl, calls } = makeFetch([
            { match: /commits\/HEAD\.atom/, response: { body: atomXml('e'.repeat(40)) } },
            { match: /data\.jsdelivr\.com/, response: { status: 403, body: 'too big' } },
            // 降级后的 API 路径
            { match: /api\.github\.com\/repos\/o\/r\/commits/, response: { json: [{ sha: 'f'.repeat(40) }] } },
            { match: /api\.github\.com\/repos\/o\/r\/git\/trees/, response: { json: { truncated: false, tree: [blob('project.json')] } } },
        ]);
        const source = await resolveSource('o', 'r', [], { fetchImpl, rateLimit: noop() });
        expect(source.contentChannel).toBe('raw');
        expect(source.sha).toBe('f'.repeat(40));
        expect(calls.some(c => c.url.includes('data.jsdelivr.com'))).toBe(true);
        expect(calls.some(c => c.url.includes('api.github.com'))).toBe(true);
    });

    it('atom 不可用时也降级', async () => {
        const { fetchImpl } = makeFetch([
            { match: /commits\/HEAD\.atom/, response: { status: 500, body: 'boom' } },
            { match: /api\.github\.com\/repos\/o\/r\/commits/, response: { json: [{ sha: 'g'.repeat(40) }] } },
            { match: /api\.github\.com\/repos\/o\/r\/git\/trees/, response: { json: { truncated: false, tree: [blob('project.json')] } } },
        ]);
        const source = await resolveSource('o', 'r', [], { fetchImpl, rateLimit: noop() });
        expect(source.contentChannel).toBe('raw');
    });

    it('forceApi 时直接走 API，不试 jsDelivr', async () => {
        const { fetchImpl, calls } = makeFetch([
            { match: /api\.github\.com\/repos\/o\/r\/commits/, response: { json: [{ sha: 'h'.repeat(40) }] } },
            { match: /api\.github\.com\/repos\/o\/r\/git\/trees/, response: { json: { truncated: false, tree: [blob('project.json')] } } },
        ]);
        const source = await resolveSource('o', 'r', [], { fetchImpl, rateLimit: noop(), forceApi: true });
        expect(source.contentChannel).toBe('raw');
        expect(calls.some(c => c.url.includes('.atom'))).toBe(false);
        expect(calls.some(c => c.url.includes('jsdelivr'))).toBe(false);
    });

    it('包过大且配额已耗尽时，报体积问题而不是误报限流', async () => {
        // 之前的行为：jsDelivr 拒绝后退到 API，API 又限流，用户看到的是
        // 「API 次数用尽」这种和体积无关的错误，完全误导
        const rateLimit = new RateLimitState();
        const { fetchImpl, calls } = makeFetch([
            // 必须是合法十六进制，否则 atom 解析会失败而不是走到降级判断
            { match: /commits\/HEAD\.atom/, response: { body: atomXml('1'.repeat(40)) } },
            { match: /data\.jsdelivr\.com/, response: { status: 403, body: 'too big' } },
            // 让配额先变成「已耗尽」
            {
                match: /api\.github\.com/,
                response: { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' }, json: {} },
            },
        ]);
        rateLimit.observe({ get: name => (name === 'x-ratelimit-remaining' ? '0' : null) });

        await expect(resolveSource('o', 'r', [], { fetchImpl, rateLimit }))
            .rejects.toMatchObject({ code: 'channel-unavailable' });
        // 配额已耗尽时不应再发 API 请求
        expect(calls.some(c => c.url.includes('api.github.com'))).toBe(false);
    });

    it('配额在第一次 API 调用时才发现耗尽，仍报体积问题', async () => {
        // 实际使用中每次导入都是新的 RateLimitState，快速通道不碰 API，降级前无从得知配额
        const { fetchImpl } = makeFetch([
            { match: /commits\/HEAD\.atom/, response: { body: atomXml('1'.repeat(40)) } },
            { match: /data\.jsdelivr\.com/, response: { status: 403, body: 'too big' } },
            {
                match: /api\.github\.com/,
                response: { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' }, json: {} },
            },
        ]);

        await expect(resolveSource('o', 'r', [], { fetchImpl, rateLimit: new RateLimitState() }))
            .rejects.toMatchObject({ code: 'channel-unavailable', options: { resetAt: 1800000000 * 1000 } });
    });

    it('快速通道非体积原因失败、API 又限流时，报限流', async () => {
        const { fetchImpl } = makeFetch([
            { match: /commits\/HEAD\.atom/, response: { status: 500, body: '' } },
            {
                match: /api\.github\.com/,
                response: { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' }, json: {} },
            },
        ]);

        await expect(resolveSource('o', 'r', [], { fetchImpl, rateLimit: new RateLimitState() }))
            .rejects.toMatchObject({ code: 'rate-limited' });
    });

    it('取消不会被当成降级信号继续走 API', async () => {
        const token = new CancelToken();
        const fetchImpl: FetchLike = async () => {
            token.cancel();
            throw new DOMException('aborted', 'AbortError');
        };
        await expect(resolveSource('o', 'r', [], {
            fetchImpl,
            rateLimit: noop(),
            signal: token.signal,
        })).rejects.toMatchObject({ code: 'cancelled' });
    });
});

// ---------------------------------------------------------------------------
// 错误分类
// ---------------------------------------------------------------------------

describe('错误分类', () => {
    const classify = async (response: FakeResponseInit): Promise<GitHubImportError> => {
        const { fetchImpl } = makeFetch([
            { match: /\/repos\/o\/r\/commits/, response },
        ]);
        try {
            await resolveRef('o', 'r', [], { fetchImpl, rateLimit: noop() });
        } catch (error) {
            return error as GitHubImportError;
        }
        throw new Error('expected failure');
    };

    it('404 同时覆盖「不存在」与「私有」，措辞不武断', async () => {
        const error = await classify({ status: 404, json: { message: 'Not Found' } });
        expect(error.code).toBe('repo-not-found');
        expect(error.message).toMatch(/not publicly accessible/i);
    });

    it('403 且 Remaining=0 → 主限额耗尽并带恢复时间', async () => {
        const error = await classify({
            status: 403,
            headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' },
            json: { message: 'API rate limit exceeded' },
        });
        expect(error.code).toBe('rate-limited');
        expect(error.options.limitKind).toBe('primary');
        expect(error.options.resetAt).toBe(1800000000 * 1000);
    });

    it('429 带 Retry-After → 次级限流', async () => {
        const error = await classify({
            status: 429,
            headers: { 'retry-after': '30' },
            json: { message: 'You have exceeded a secondary rate limit' },
        });
        expect(error.code).toBe('rate-limited');
        expect(error.options.limitKind).toBe('secondary');
        expect(error.options.retryAfterMs).toBe(30000);
    });

    it('403 无任何限流信息 → 访问被拒绝，不编造恢复时间', async () => {
        const error = await classify({ status: 403, headers: {}, json: { message: 'Forbidden' } });
        expect(error.code).toBe('access-denied');
        expect(error.options.resetAt).toBeUndefined();
        expect(error.options.retryAfterMs).toBeUndefined();
    });

    it('5xx 归为网络错误', async () => {
        const error = await classify({ status: 502, body: 'bad gateway' });
        expect(error.code).toBe('network');
    });

    it('主限额已耗尽时不再发起请求', async () => {
        const rateLimit = new RateLimitState();
        const { fetchImpl, calls } = makeFetch([
            {
                match: /\/repos/,
                response: { status: 403, headers: { 'x-ratelimit-remaining': '0' }, json: {} },
            },
        ]);
        await expect(resolveRef('o', 'r', [], { fetchImpl, rateLimit })).rejects.toMatchObject({ code: 'rate-limited' });
        const firstCount = calls.length;
        await expect(resolveRef('o', 'r', [], { fetchImpl, rateLimit })).rejects.toMatchObject({ code: 'rate-limited' });
        expect(calls.length).toBe(firstCount);
    });
});

// ---------------------------------------------------------------------------
// tree
// ---------------------------------------------------------------------------

describe('fetchTree', () => {
    const options = (fetchImpl: FetchLike) => ({ fetchImpl, rateLimit: noop() });

    it('truncated 的仓库直接拒绝，不返回残缺清单', async () => {
        const { fetchImpl } = makeFetch([
            { match: /git\/trees/, response: { json: { truncated: true, tree: [] } } },
        ]);
        await expect(fetchTree('o', 'r', 'sha', options(fetchImpl)))
            .rejects.toMatchObject({ code: 'truncated' });
    });

    it('正常返回条目', async () => {
        const { fetchImpl } = makeFetch([
            {
                match: /git\/trees/,
                response: {
                    json: {
                        truncated: false,
                        tree: [{ path: 'project.json', mode: '100644', type: 'blob', sha: 'x', size: 10 }],
                    },
                },
            },
        ]);
        const tree = await fetchTree('o', 'r', 'sha', options(fetchImpl));
        expect(tree).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// 工程发现
// ---------------------------------------------------------------------------

function blob(path: string, size = 10, mode = '100644'): TreeEntry {
    return { path, mode, type: 'blob', sha: `sha-${path}`, size };
}

function submodule(path: string): TreeEntry {
    return { path, mode: '160000', type: 'commit', sha: `sub-${path}` };
}

describe('findMainHml', () => {
    it('优先使用 project.json 的 mainHmlFile', () => {
        expect(pickMainHml({ mainHmlFile: 'ui/B.hml' }, ['ui/A.hml', 'ui/B.hml'])).toBe('ui/B.hml');
    });

    it('mainHmlFile 不在集合里时退回 ui/ 下最浅的 .hml', () => {
        expect(pickMainHml({ mainHmlFile: 'ui/Gone.hml' }, ['ui/sub/Deep.hml', 'ui/Top.hml']))
            .toBe('ui/Top.hml');
    });

    it('尊重自定义 uiDir', () => {
        expect(pickMainHml({ uiDir: 'screens' }, ['ui/A.hml', 'screens/Main.hml'])).toBe('screens/Main.hml');
    });

    it('没有 HML 时返回 undefined', () => {
        expect(pickMainHml({}, ['project.json', 'README.md'])).toBeUndefined();
    });
});

describe('discoverProjects', () => {
    const tree = [
        blob('project.json', 100),
        blob('ui/Main.hml', 20),
        blob('packages/app/project.json', 200),
        blob('packages/app/ui/App.hml', 30),
        blob('packages/other/README.md', 5),
    ];

    it('仓库根与子目录的工程都被列出，按层级排序', async () => {
        const { fetchImpl } = makeFetch([{ match: /./, response: { body: '{"name":"app"}' } }]);
        const candidates = await discoverProjects('o', 'r', 'sha', tree, '', {
            fetchImpl,
            rateLimit: noop(),
            readText: async () => '{"name":"from-config","resolution":"480X272"}',
        });
        expect(candidates.map(c => c.rootPath)).toEqual(['', 'packages/app']);
        expect(candidates[0].name).toBe('from-config');
    });

    it('统计体积只算工程范围内的文件', async () => {
        const candidates = await discoverProjects('o', 'r', 'sha', tree, '', {
            fetchImpl: makeFetch([]).fetchImpl,
            rateLimit: noop(),
        });
        // 根工程的范围是整个仓库：project.json + ui/Main.hml + packages 下三个文件
        const root = candidates.find(c => c.rootPath === '')!;
        expect(root.estimatedBytes).toBe(100 + 20 + 200 + 30 + 5);
        expect(root.fileCount).toBe(5);
        // 子工程只算自己目录下的文件
        const nested = candidates.find(c => c.rootPath === 'packages/app')!;
        expect(nested.estimatedBytes).toBe(230);
        expect(nested.fileCount).toBe(2);
    });

    it('限定范围内只列该范围下的工程', async () => {
        const candidates = await discoverProjects('o', 'r', 'sha', tree, 'packages', {
            fetchImpl: makeFetch([]).fetchImpl,
            rateLimit: noop(),
        });
        expect(candidates.map(c => c.rootPath)).toEqual(['packages/app']);
    });

    it('project.json 读取失败时用目录名兜底，不中断', async () => {
        const candidates = await discoverProjects('o', 'r', 'sha', tree, '', {
            fetchImpl: makeFetch([]).fetchImpl,
            rateLimit: noop(),
            readText: async () => { throw new Error('boom'); },
        });
        expect(candidates).toHaveLength(2);
        expect(candidates.find(c => c.rootPath === 'packages/app')!.name).toBe('app');
    });

    it('读取被取消时向上传播，不吞掉', async () => {
        await expect(discoverProjects('o', 'r', 'sha', tree, '', {
            fetchImpl: makeFetch([]).fetchImpl,
            rateLimit: noop(),
            readText: async () => { throw new GitHubImportError('cancelled', 'cancelled'); },
        })).rejects.toMatchObject({ code: 'cancelled' });
    });
});

// ---------------------------------------------------------------------------
// 下载
// ---------------------------------------------------------------------------

const PROJECT_FILES = [
    blob('proj/project.json', 40),
    blob('proj/ui/Main.hml', 60),
    blob('proj/assets/logo.png', 100),
];

function source(entries: TreeEntry[] = PROJECT_FILES) {
    return {
        owner: 'o',
        repo: 'r',
        sha: 'deadbeef',
        ref: 'main',
        scopePath: '',
        tree: entries,
        candidates: [],
        contentChannel: 'raw' as const,
    };
}

const candidate = {
    rootPath: 'proj',
    name: 'proj',
    fileCount: 3,
    estimatedBytes: 200,
};

/** 每条 raw 请求按路径返回指定正文 */
function rawFetch(bodies: Record<string, string | Uint8Array>, extra: FakeResponseInit = {}) {
    return makeFetch([
        {
            match: /raw\.githubusercontent\.com/,
            response: () => ({ ...extra }),
        },
    ]);
}

function rawFetchByPath(map: Record<string, string>): { fetchImpl: FetchLike; calls: Call[] } {
    const calls: Call[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
        calls.push({ url, signal: init.signal });
        const rel = decodeURIComponent(url.split('/deadbeef/')[1] ?? '');
        if (!(rel in map)) {
            return makeResponse({ status: 404, body: 'not found' });
        }
        return makeResponse({ body: map[rel] });
    };
    return { fetchImpl, calls };
}

const PROJECT_JSON = JSON.stringify({ name: 'Demo', mainHmlFile: 'ui/Main.hml' });

describe('downloadProject', () => {
    it('按相对路径写入，并固定使用 commit SHA', async () => {
        const { fetchImpl, calls } = rawFetchByPath({
            'proj/project.json': PROJECT_JSON,
            'proj/ui/Main.hml': '<view/>',
            'proj/assets/logo.png': 'PNG',
        });
        const project = await downloadProject(source(), candidate, { fetchImpl, rateLimit: noop() });

        expect([...project.files.keys()].sort()).toEqual(['assets/logo.png', 'project.json', 'ui/Main.hml']);
        expect(project.name).toBe('Demo');
        expect(project.mainHmlFile).toBe('ui/Main.hml');
        // 每一条都是 /o/r/<sha>/...
        expect(calls.every(c => c.url.includes('/o/r/deadbeef/'))).toBe(true);
    });

    it('中文与空格路径编码后能取到文件', async () => {
        const entries = [blob('proj/project.json', 10), blob('proj/ui/界面 主页.hml', 20)];
        const { fetchImpl } = rawFetchByPath({
            'proj/project.json': JSON.stringify({ name: 'x', mainHmlFile: 'ui/界面 主页.hml' }),
            'proj/ui/界面 主页.hml': '<view/>',
        });
        const project = await downloadProject(source(entries), { ...candidate, fileCount: 2 }, {
            fetchImpl,
            rateLimit: noop(),
        });
        expect(project.files.has('ui/界面 主页.hml')).toBe(true);
    });

    it('工程范围内的符号链接被拒绝并列出路径', async () => {
        const entries = [
            ...PROJECT_FILES,
            blob('proj/assets/link.png', 16, '120000'),
        ];
        const { fetchImpl } = rawFetchByPath({});
        await expect(downloadProject(source(entries), candidate, { fetchImpl, rateLimit: noop() }))
            .rejects.toMatchObject({
                code: 'symlink',
                options: { paths: ['proj/assets/link.png'] },
            });
    });

    it('工程范围内的子模块被拒绝', async () => {
        const entries = [
            ...PROJECT_FILES,
            submodule('proj/vendor/lib'),
        ];
        const { fetchImpl } = rawFetchByPath({});
        await expect(downloadProject(source(entries), candidate, { fetchImpl, rateLimit: noop() }))
            .rejects.toMatchObject({ code: 'submodule', options: { paths: ['proj/vendor/lib'] } });
    });

    it('仓库其它目录的子模块不影响当前工程', async () => {
        const entries = [
            ...PROJECT_FILES,
            submodule('other/vendor/lib'),
        ];
        const { fetchImpl } = rawFetchByPath({
            'proj/project.json': PROJECT_JSON,
            'proj/ui/Main.hml': '<view/>',
            'proj/assets/logo.png': 'PNG',
        });
        await expect(downloadProject(source(entries), candidate, { fetchImpl, rateLimit: noop() }))
            .resolves.toMatchObject({ name: 'Demo' });
    });

    it('下载到 LFS 指针时整体失败', async () => {
        const { fetchImpl } = rawFetchByPath({
            'proj/project.json': PROJECT_JSON,
            'proj/ui/Main.hml': '<view/>',
            'proj/assets/logo.png': 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12345\n',
        });
        await expect(downloadProject(source(), candidate, { fetchImpl, rateLimit: noop() }))
            .rejects.toMatchObject({ code: 'lfs-pointer', options: { paths: ['proj/assets/logo.png'] } });
    });

    it('任一文件 404 时整体失败，不返回部分结果', async () => {
        const { fetchImpl } = rawFetchByPath({
            'proj/project.json': PROJECT_JSON,
            // ui/Main.hml 缺失
            'proj/assets/logo.png': 'PNG',
        });
        await expect(downloadProject(source(), candidate, { fetchImpl, rateLimit: noop() }))
            .rejects.toBeInstanceOf(GitHubImportError);
    });

    it('tree 估算超过上限时在下载前就拒绝', async () => {
        const big = [
            blob('proj/project.json', 10),
            blob('proj/ui/Main.hml', 10),
            blob('proj/assets/huge.mp4', 500),
        ];
        const { fetchImpl, calls } = rawFetchByPath({});
        await expect(downloadProject(source(big), { ...candidate, fileCount: 3 }, {
            fetchImpl,
            rateLimit: noop(),
            maxBytes: 100,
        })).rejects.toMatchObject({ code: 'too-large' });
        expect(calls).toHaveLength(0);
    });

    it('实际字节超过绝对上限时中止，且不放宽到 1.2 倍', async () => {
        // tree 低估：估算 200，但实际内容远超
        const { fetchImpl } = rawFetchByPath({
            'proj/project.json': PROJECT_JSON,
            'proj/ui/Main.hml': 'x'.repeat(80),
            'proj/assets/logo.png': 'y'.repeat(80),
        });
        await expect(downloadProject(source(), candidate, {
            fetchImpl,
            rateLimit: noop(),
            maxBytes: 100,
        })).rejects.toMatchObject({ code: 'too-large' });
    });

    it('流式读取时逐块累计，达到上限立刻取消', async () => {
        let cancelled = false;
        const chunk = new Uint8Array(40).fill(1);
        const fetchImpl: FetchLike = async () => ({
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: async () => '',
            json: async () => ({}),
            arrayBuffer: async () => new ArrayBuffer(0),
            body: {
                getReader: () => {
                    let reads = 0;
                    return {
                        read: async () => {
                            reads += 1;
                            // 每块 40 字节，上限 100：第 3 块触发中止
                            return { done: false, value: chunk };
                        },
                        cancel: () => { cancelled = true; },
                    };
                },
            },
        });

        await expect(downloadProject(
            source([blob('proj/project.json', 10), blob('proj/ui/Main.hml', 10)]),
            { ...candidate, fileCount: 2 },
            { fetchImpl, rateLimit: noop(), maxBytes: 100 }
        )).rejects.toMatchObject({ code: 'too-large' });
        expect(cancelled).toBe(true);
    });

    it('超限后其余在途下载也停下，不会把剩余字节读完', async () => {
        // 6 路并发，全部返回永不结束的大流。共享的累计字节数让每一路在下一块就发现超限，
        // 因此总读取次数应远小于「把所有文件的流读完」的量级。
        let totalReads = 0;
        const fetchImpl: FetchLike = async () => ({
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: async () => '',
            json: async () => ({}),
            arrayBuffer: async () => new ArrayBuffer(0),
            body: {
                getReader: () => ({
                    read: async () => {
                        totalReads += 1;
                        // 每块 60 字节，上限 100，两到三块必然触发
                        return { done: false, value: new Uint8Array(60).fill(7) };
                    },
                    cancel: () => undefined,
                }),
            },
        });

        const entries = Array.from({ length: 12 }, (_, i) => blob(`proj/f${i}.dat`, 1));
        await expect(downloadProject(source(entries), { ...candidate, fileCount: 12 }, {
            fetchImpl,
            rateLimit: noop(),
            maxBytes: 100,
        })).rejects.toMatchObject({ code: 'too-large' });

        expect(totalReads).toBeLessThan(30);
    });

    it('project.json 缺失时报 invalid-project', async () => {
        const files = new Map<string, Uint8Array>([
            ['ui/Main.hml', new TextEncoder().encode('<view/>')],
        ]);
        expect(() => finalizeProject(candidate, files))
            .toThrow(expect.objectContaining({ code: 'invalid-project' }));
    });

    it('project.json 解析失败时报 invalid-project', async () => {
        const files = new Map<string, Uint8Array>([
            ['project.json', new TextEncoder().encode('{ not json')],
        ]);
        expect(() => finalizeProject(candidate, files))
            .toThrow(expect.objectContaining({ code: 'invalid-project' }));
    });

    it('没有主 HML 时报 invalid-project', async () => {
        const files = new Map<string, Uint8Array>([
            ['project.json', new TextEncoder().encode('{"name":"x"}')],
            ['README.md', new TextEncoder().encode('hi')],
        ]);
        expect(() => finalizeProject(candidate, files))
            .toThrow(expect.objectContaining({ code: 'invalid-project' }));
    });

    it('.gitattributes 声明 filter=lfs 时作为提示，不单独拒绝', async () => {
        const { fetchImpl } = rawFetchByPath({
            'proj/project.json': PROJECT_JSON,
            'proj/ui/Main.hml': '<view/>',
            'proj/assets/logo.png': 'PNG',
            'proj/.gitattributes': '*.psd filter=lfs diff=lfs merge=lfs -text\n',
        });
        const entries = [...PROJECT_FILES, blob('proj/.gitattributes', 40)];
        const project = await downloadProject(source(entries), { ...candidate, fileCount: 4 }, {
            fetchImpl,
            rateLimit: noop(),
        });
        expect(project.lfsDeclared).toBe(true);
    });

    it('进度按已完成文件数与累计字节数上报', async () => {
        const { fetchImpl } = rawFetchByPath({
            'proj/project.json': PROJECT_JSON,
            'proj/ui/Main.hml': '<view/>',
            'proj/assets/logo.png': 'PNG',
        });
        const progress: DownloadProgress[] = [];
        await downloadProject(source(), candidate, {
            fetchImpl,
            rateLimit: noop(),
            onProgress: p => progress.push({ ...p }),
        });
        const last = progress[progress.length - 1];
        expect(last.filesDone).toBe(3);
        expect(last.filesTotal).toBe(3);
        expect(last.bytesDone).toBeGreaterThan(0);
        expect(last.bytesEstimated).toBe(200);
    });
});

// ---------------------------------------------------------------------------
// 取消
// ---------------------------------------------------------------------------

describe('取消', () => {
    it('取消后停止排队，且不产生结果', async () => {
        const token = new CancelToken();
        let started = 0;
        const fetchImpl: FetchLike = async (url, init) => {
            started += 1;
            if (started === 1) {
                token.cancel();
            }
            if (init.signal?.aborted) {
                throw new DOMException('aborted', 'AbortError');
            }
            return makeResponse({ body: PROJECT_JSON });
        };

        const entries = Array.from({ length: 20 }, (_, i) => blob(`proj/f${i}.txt`, 1));
        await expect(downloadProject(source(entries), { ...candidate, fileCount: 20 }, {
            fetchImpl,
            rateLimit: noop(),
            token,
        })).rejects.toMatchObject({ code: 'cancelled' });

        // 取消后不再派发全部 20 个请求
        expect(started).toBeLessThan(20);
    });

    it('取消令牌会中止在途请求的 signal', async () => {
        const token = new CancelToken();
        const { fetchImpl, calls } = rawFetchByPath({});
        token.cancel();
        await expect(downloadProject(source(), candidate, {
            fetchImpl,
            rateLimit: noop(),
            token,
        })).rejects.toMatchObject({ code: 'cancelled' });
        expect(calls).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// 存储容量
// ---------------------------------------------------------------------------

describe('assertStorageCapacity', () => {
    it('剩余配额不足时拒绝', async () => {
        await expect(assertStorageCapacity(1000, async () => ({ quota: 5000, usage: 4500 })))
            .rejects.toMatchObject({ code: 'quota' });
    });

    it('剩余配额充足时放行', async () => {
        await expect(assertStorageCapacity(100, async () => ({ quota: 5000, usage: 4500 })))
            .resolves.toBeUndefined();
    });

    it('estimate 不可用时不阻断，交给实际写入报错', async () => {
        await expect(assertStorageCapacity(100, async () => { throw new Error('nope'); }))
            .resolves.toBeUndefined();
    });

    it('低于 50 MB 也要检查容量', async () => {
        // 小工程同样走这条检查：这里刻意让 1 字节都放不下
        await expect(assertStorageCapacity(1, async () => ({ quota: 100, usage: 100 })))
            .rejects.toMatchObject({ code: 'quota' });
    });
});

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

describe('上限常量', () => {
    it('绝对上限就是 200 MB，不是预估值放大后的数字', () => {
        expect(ABSOLUTE_MAX_BYTES).toBe(200 * 1024 * 1024);
    });
});

describe('重复导入识别', () => {
    it('来源标识只由仓库和工程根决定，不含分支和 SHA', () => {
        expect(githubSourceKey('realmcu', 'honeygui-template-chatbot', ''))
            .toBe('github.com/realmcu/honeygui-template-chatbot');
        expect(githubSourceKey('o', 'r', 'packages/app')).toBe('github.com/o/r/packages/app');
    });

    it('owner/repo 不区分大小写，同一仓库换种大小写写法仍算已导入', () => {
        expect(githubSourceKey('RealMCU', 'HoneyGUI-Template-EBadge', ''))
            .toBe(githubSourceKey('realmcu', 'honeygui-template-ebadge', ''));
    });

    it('同一仓库的不同子工程是不同来源', () => {
        expect(githubSourceKey('o', 'r', 'a')).not.toBe(githubSourceKey('o', 'r', 'b'));
    });
});

describe('模板下拉', () => {
    it('每个官方模板都给出 GitHub 镜像地址（Gitee 地址在浏览器里取不到）', () => {
        expect(GITHUB_TEMPLATES).toHaveLength(AVAILABLE_TEMPLATES.length);
        for (const template of GITHUB_TEMPLATES) {
            expect(template.url).toMatch(/^https:\/\/github\.com\/realmcu\/honeygui-template-[\w-]+$/);
            // 地址本身必须能被导入流程解析
            expect(() => parseGitHubUrl(template.url)).not.toThrow();
        }
    });

    it('下拉里显示的模板描述在两份 locale 中都有', () => {
        for (const template of GITHUB_TEMPLATES) {
            expect(en).toHaveProperty([template.descriptionKey]);
            expect(zhCN).toHaveProperty([template.descriptionKey]);
        }
    });

    it('Gitee 地址换成同名 GitHub 仓库', () => {
        expect(GITHUB_TEMPLATES.find(template => template.id === 'chatbot')?.url)
            .toBe('https://github.com/realmcu/honeygui-template-chatbot');
        expect(GITHUB_TEMPLATES.find(template => template.id === 'ebadge')?.url)
            .toBe('https://github.com/realmcu/honeygui-template-EBadge');
    });
});
