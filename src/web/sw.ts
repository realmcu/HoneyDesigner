/**
 * HoneyGUI Designer Web 的 Service Worker
 *
 * 1. `/__vfs/*`：工程文件存在于页面内存中，这里向发起请求的页面索取内容后返回
 * 2. 其余同源 GET 请求：网络优先、失败时回退缓存，首次访问后可离线使用
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
        const keep = new Set([RUNTIME_CACHE, META_CACHE, ...versions]);
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
    if (cached || request.mode !== 'navigate') {
        return cached;
    }
    return caches.match(new URL('./', self.registration.scope).toString());
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

function rejectAfter(timeoutMs: number): Promise<never> {
    return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs));
}

/**
 * 网络优先，离线时回退到缓存。
 * 页面导航额外带超时：弱网下超过 NAVIGATION_TIMEOUT_MS 先用缓存打开，网络请求继续
 * 在后台完成并刷新缓存，新版本在下次打开时生效。没有缓存（首次访问）时等待网络。
 */
async function networkFirst(request: Request): Promise<Response> {
    const network = fetch(request).then(response => {
        putInRuntimeCache(request, response);
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
    event.respondWith(HASHED_ASSET.test(pathname) ? cacheFirst(request) : networkFirst(request));
});
