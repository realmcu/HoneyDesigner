/**
 * HoneyDesigner Web 的 Service Worker
 *
 * 1. `/__vfs/*`：工程文件存在于页面内存中，这里向发起请求的页面索取内容后返回
 * 2. 编译工具链（sim/clang、sim/binaryen、toolchain.json|pack）：缓存优先，
 *    按 toolchain.json 的 id 失效（见 TOOLCHAIN_CACHE）
 * 3. 预编译产物（sim/prebuilt/o|p）：按键命名，缓存优先，随工具链 id 失效
 * 4. 带内容哈希的 JS/CSS：缓存优先
 * 5. 其余同源 GET 请求（含 sim/prebuilt/index.json）：网络优先、失败时回退缓存，
 *    首次访问后可离线使用
 *
 * 与页面代码共用一个 TypeScript 工程（DOM lib），因此 Service Worker 专有类型按最小形状声明。
 */
export {};

interface SwClient {
    postMessage(message: unknown, transfer: Transferable[]): void;
}

interface SwFetchEvent extends Event {
    readonly request: Request;
    readonly clientId: string;
    respondWith(response: Promise<Response> | Response): void;
}

interface SwExtendableEvent extends Event {
    waitUntil(promise: Promise<unknown>): void;
}

interface SwGlobalScope {
    readonly location: Location;
    readonly registration: { readonly scope: string };
    readonly clients: {
        get(id: string): Promise<SwClient | undefined>;
        matchAll(options: { type: 'window' }): Promise<SwClient[]>;
        claim(): Promise<void>;
    };
    skipWaiting(): Promise<void>;
    addEventListener(type: 'install' | 'activate', listener: (event: SwExtendableEvent) => void): void;
    addEventListener(type: 'fetch', listener: (event: SwFetchEvent) => void): void;
}

declare const self: SwGlobalScope;

const VFS_PREFIX = '/__vfs/';
const CACHE_PREFIX = 'honeygui-web-';
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime`;
const VFS_READ_TIMEOUT_MS = 10000;

/**
 * 编译工具链缓存。编译器约 30 MB，走「网络优先」每次都要重下，
 * 慢速链路上一次断线整次仿真就失败了，所以这些文件改为缓存优先。
 *
 * 文件名不带内容哈希，靠 toolchain.json 的 id 判断是否过期：id 随编译器、binaryen
 * 与头文件包变化（scripts/prepare-web-sim.js），变了就整体丢掉重下。
 *
 * CI 预编译的产物（sim/prebuilt/）也存在这里，但只在工具链 id 变化时清掉：
 * 工程改动不换工具链，按键存放的产物不会互相覆盖，清掉只会让编译器重新下载。
 */
const TOOLCHAIN_CACHE = `${CACHE_PREFIX}toolchain`;
const TOOLCHAIN_ID_KEY = new URL('__toolchain-id', self.location.href).toString();
/**
 * 不带内容哈希、但由工具链 id 兜底失效的文件：缓存优先。
 * pathname 是去掉 scope 后的形式，仍保留前导 `/`（部署在子路径下时同样如此）。
 */
const CACHE_FIRST_PATH = /^\/?sim\/(clang|binaryen|toolchain\.(json|pack))$/;
/** 预编译产物按键（单元键、工程键）命名，同名即同内容，可以一直缓存 */
const PREBUILT_ARTIFACT_PATH = /^\/?sim\/prebuilt\/[po]\//;
/**
 * 预编译索引不是按内容命名的：站点每次部署都可能新增工程，不能缓存优先，
 * 否则浏览器永远看不到新工程，每次都要现场编译（也就要下载编译器）。
 */
const PREBUILT_INDEX_PATH = /^\/?sim\/prebuilt\/index\.json$/;
/** 大文件下载失败时重试的次数（只影响缓存未命中的首次下载） */
const FETCH_ATTEMPTS = 3;
let toolchainChecked = false;

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const manifest = await loadManifest();
        if (manifest) {
            const cache = await caches.open(`${CACHE_PREFIX}${manifest.version}`);
            await cache.addAll(manifest.files.map(file => new URL(file, self.registration.scope).toString()));
        }
        await self.skipWaiting();
    })());
});

/** 构建时生成的静态资源清单（webpack.web.config.js 的 PrecacheManifestPlugin） */
interface PrecacheManifest {
    version: string;
    files: string[];
}

async function loadManifest(): Promise<PrecacheManifest | undefined> {
    try {
        const response = await fetch(new URL('precache-manifest.json', self.registration.scope).toString(), { cache: 'no-store' });
        return response.ok ? await response.json() as PrecacheManifest : undefined;
    } catch {
        return undefined;
    }
}

/** 记录当前与上一个激活版本的缓存名 */
const META_CACHE = `${CACHE_PREFIX}meta`;
const ACTIVE_VERSIONS_KEY = new URL('__active-versions', self.location.href).toString();

async function readActiveVersions(): Promise<string[]> {
    const response = await (await caches.open(META_CACHE)).match(ACTIVE_VERSIONS_KEY);
    return response ? await response.json() as string[] : [];
}

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const manifest = await loadManifest();
        // 保留上一个版本的预缓存：新版本激活时，旧页面可能还没刷新，
        // 仍会按需加载旧的带哈希 chunk，而服务器上已经没有这些文件
        let versions = await readActiveVersions();
        if (manifest) {
            const current = `${CACHE_PREFIX}${manifest.version}`;
            versions = [current, ...versions.filter(v => v !== current)].slice(0, 2);
            await (await caches.open(META_CACHE)).put(ACTIVE_VERSIONS_KEY, new Response(JSON.stringify(versions)));
        }
        // 工具链缓存单独按 toolchain.json 的 id 失效（prepareToolchain），这里不能清
        const keep = new Set([RUNTIME_CACHE, META_CACHE, TOOLCHAIN_CACHE, ...versions]);
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && !keep.has(key)).map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});

async function findClient(clientId: string): Promise<SwClient | undefined> {
    if (clientId) {
        const client = await self.clients.get(clientId);
        if (client) {
            return client;
        }
    }
    const windows = await self.clients.matchAll({ type: 'window' });
    return windows[0];
}

async function serveVfs(event: SwFetchEvent, filePath: string): Promise<Response> {
    const client = await findClient(event.clientId);
    if (!client) {
        return new Response('No client available', { status: 503 });
    }
    const channel = new MessageChannel();
    const reply = new Promise<{ ok: boolean; mime?: string; bytes?: ArrayBuffer } | null>(resolve => {
        const timer = setTimeout(() => resolve(null), VFS_READ_TIMEOUT_MS);
        channel.port1.onmessage = message => {
            clearTimeout(timer);
            resolve(message.data);
        };
    });
    client.postMessage({ type: 'honeygui-vfs-read', path: filePath }, [channel.port2]);
    const result = await reply;
    if (!result || !result.ok || !result.bytes) {
        return new Response('Not found', { status: 404 });
    }
    return new Response(result.bytes, {
        status: 200,
        headers: {
            'Content-Type': result.mime || 'application/octet-stream',
            'Cache-Control': 'no-store',
        },
    });
}

/**
 * 生产构建的 JS/CSS 文件名带内容哈希（如 main.ed25873fb4c2f3de3ad8.js），同名即同内容，
 * 可以直接用缓存。开发构建的 main.js 没有哈希，不匹配，仍走网络优先以便看到最新改动。
 */
const HASHED_ASSET = /\.[0-9a-f]{16,}(\.chunk)?\.(js|css)$/;
/** 弱网时 index.html 最多等这么久，超时就先用缓存打开（新版本在下次打开时生效） */
const NAVIGATION_TIMEOUT_MS = 3000;

/** 必须在把 response 交给页面之前同步调用：clone 要早于页面读取 body */
function putInRuntimeCache(request: Request, response: Response): void {
    if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        void caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy));
    }
}

async function cachedFallback(request: Request): Promise<Response | undefined> {
    const cached = await caches.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (cached) {
        return cached;
    }
    // 预编译索引存在工具链缓存里（见 rememberPrebuiltIndex），caches.match 覆盖不到
    if (PREBUILT_INDEX_PATH.test(new URL(request.url).pathname)) {
        return (await caches.open(TOOLCHAIN_CACHE)).match(request);
    }
    if (request.mode !== 'navigate') {
        return undefined;
    }
    return caches.match(new URL('./', self.registration.scope).toString());
}

/** 预编译索引存进工具链缓存：随工具链 id 一起失效，离线时作为回退 */
function rememberPrebuiltIndex(request: Request, response: Response): void {
    if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        void caches.open(TOOLCHAIN_CACHE).then(cache => cache.put(request, copy)).catch(() => { /* 超出配额时下次重取 */ });
    }
}

/** 缓存优先：命中预缓存/运行时缓存时不发网络请求 */
async function cacheFirst(request: Request): Promise<Response> {
    const cached = await caches.match(request);
    if (cached) {
        return cached;
    }
    const response = await fetch(request);
    putInRuntimeCache(request, response);
    return response;
}

async function toolchainId(): Promise<string | undefined> {
    try {
        const cached = await (await caches.open(TOOLCHAIN_CACHE)).match(TOOLCHAIN_ID_KEY);
        return cached ? (await cached.json() as { id: string }).id : undefined;
    } catch {
        return undefined;
    }
}

/**
 * 站点更新后编译器换了（toolchain.json 的 id 变了），旧缓存整体丢掉重下。
 * 每个 Service Worker 生命周期只检查一次。
 */
async function prepareToolchain(scope: string): Promise<void> {
    if (toolchainChecked) {
        return;
    }
    toolchainChecked = true;
    try {
        const response = await fetch(new URL('sim/toolchain.json', scope).toString(), { cache: 'no-store' });
        if (!response.ok) {
            return;
        }
        const id = (await response.json() as { id?: string }).id;
        if (!id || id === await toolchainId()) {
            return;
        }
        await caches.delete(TOOLCHAIN_CACHE);
        const cache = await caches.open(TOOLCHAIN_CACHE);
        await cache.put(TOOLCHAIN_ID_KEY, new Response(JSON.stringify({ id })));
    } catch {
        // 离线或站点异常：沿用现有缓存
    }
}

/**
 * 工具链文件专用：缓存优先 + 失败重试。
 * 命中缓存时直接返回（离线也能编译）；未命中时取网络，失败重试几次，
 * 避免慢速链路上的一次断线就让整次仿真失败。
 */
async function toolchainFetch(request: Request): Promise<Response> {
    const cache = await caches.open(TOOLCHAIN_CACHE);
    const cached = await cache.match(request);
    if (cached) {
        return cached;
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
        try {
            const response = await fetch(request);
            if (response.ok && response.type === 'basic') {
                // response.clone() 必须在返回响应之前同步取出，否则页面读走 body 后没法再克隆
                const copy = response.clone();
                void cache.put(request, copy).catch(() => { /* 超出配额时下次重下 */ });
            }
            return response;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError instanceof Error ? lastError : new Error('Failed to fetch');
}

function rejectAfter(timeoutMs: number): Promise<never> {
    return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs));
}

/**
 * 网络优先，离线时回退到缓存。
 * 页面导航额外带超时：弱网下超过 NAVIGATION_TIMEOUT_MS 先用缓存打开，网络请求继续
 * 在后台完成并刷新缓存，新版本在下次打开时生效。没有缓存（首次访问）时等待网络。
 * 预编译索引放这里：离线时用上次的索引，仍能加载已缓存的预编译产物。
 */
async function networkFirst(request: Request): Promise<Response> {
    const network = fetch(request).then(response => {
        if (PREBUILT_INDEX_PATH.test(new URL(request.url).pathname)) {
            rememberPrebuiltIndex(request, response);
        } else {
            putInRuntimeCache(request, response);
        }
        return response;
    });
    try {
        if (request.mode !== 'navigate') {
            return await network;
        }
        try {
            return await Promise.race([network, rejectAfter(NAVIGATION_TIMEOUT_MS)]);
        } catch (error) {
            const cached = await cachedFallback(request);
            if (cached) {
                network.catch(() => { /* 离线：后台请求失败可忽略 */ });
                return cached;
            }
            return await network;
        }
    } catch (error) {
        const cached = await cachedFallback(request);
        if (cached) {
            return cached;
        }
        throw error;
    }
}

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') {
        return;
    }
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) {
        return;
    }
    const scopePath = new URL(self.registration.scope).pathname.replace(/\/$/, '');
    const pathname = url.pathname.startsWith(scopePath) ? url.pathname.slice(scopePath.length) : url.pathname;
    if (pathname.startsWith(VFS_PREFIX)) {
        const filePath = pathname.slice(VFS_PREFIX.length - 1).split('/').map(decodeURIComponent).join('/');
        event.respondWith(serveVfs(event, filePath));
        return;
    }
    if (CACHE_FIRST_PATH.test(pathname) || PREBUILT_ARTIFACT_PATH.test(pathname)) {
        event.respondWith((async () => {
            await prepareToolchain(self.registration.scope);
            return toolchainFetch(request);
        })());
        return;
    }
    event.respondWith(HASHED_ASSET.test(pathname) ? cacheFirst(request) : networkFirst(request));
});
