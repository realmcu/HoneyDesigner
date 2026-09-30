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

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const manifest = await loadManifest();
        const keep = new Set([RUNTIME_CACHE, manifest ? `${CACHE_PREFIX}${manifest.version}` : '']);
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

/** 网络优先，离线时回退到预缓存/运行时缓存 */
async function networkFirst(request: Request): Promise<Response> {
    try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
            const cache = await caches.open(RUNTIME_CACHE);
            void cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        const cached = await caches.match(request, { ignoreSearch: request.mode === 'navigate' });
        if (cached) {
            return cached;
        }
        if (request.mode === 'navigate') {
            const shell = await caches.match(new URL('./', self.registration.scope).toString());
            if (shell) {
                return shell;
            }
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
    event.respondWith(networkFirst(request));
});
