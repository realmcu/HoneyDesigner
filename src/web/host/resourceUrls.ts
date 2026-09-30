/**
 * 把内存文件系统中的工程文件暴露成浏览器可加载的 URL（webview.asWebviewUri 的浏览器实现）
 *
 * 优先使用 Service Worker：`/__vfs/<绝对路径>` 由 sw.ts 拦截，再向本页面索取文件内容。
 * 这样 URL 保留目录结构，three.js 的 GLTF/OBJ/MTL 加载器按相对路径加载贴图等依赖也能工作。
 * 没有 Service Worker 时（例如非安全上下文）退回 blob: URL。
 */
import * as path from 'path';
import { vfs } from '../shims/fs';

export const VFS_URL_PREFIX = '/__vfs';

const MIME_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.json': 'application/json',
    '.lottie': 'application/zip',
    '.gltf': 'model/gltf+json',
    '.glb': 'model/gltf-binary',
    '.obj': 'text/plain',
    '.mtl': 'text/plain',
    '.hml': 'application/xml',
    '.xml': 'application/xml',
    '.c': 'text/plain',
    '.h': 'text/plain',
    '.txt': 'text/plain',
};

export function mimeTypeOf(filePath: string): string {
    return MIME_TYPES[path.posix.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

let serviceWorkerActive = false;
const blobUrls = new Map<string, { url: string; mtime: number }>();

export function setServiceWorkerActive(active: boolean): void {
    serviceWorkerActive = active;
}

export function resourceUrlFor(fsPath: string): string {
    const normalized = vfs.normalize(fsPath);
    if (serviceWorkerActive) {
        const encoded = normalized.split('/').map(encodeURIComponent).join('/');
        // 相对当前页面目录解析，部署在子路径（如 GitHub Pages）时仍落在 SW 作用域内
        return new URL(`.${VFS_URL_PREFIX}${encoded}`, globalThis.location.href).toString();
    }

    const bytes = vfs.readBytes(normalized);
    if (!bytes) {
        return new URL(`.${VFS_URL_PREFIX}${normalized}`, globalThis.location.href).toString();
    }
    const mtime = vfs.mtime(normalized) || 0;
    const cached = blobUrls.get(normalized);
    if (cached && cached.mtime === mtime) {
        return cached.url;
    }
    if (cached) {
        URL.revokeObjectURL(cached.url);
    }
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeTypeOf(normalized) }));
    blobUrls.set(normalized, { url, mtime });
    return url;
}

interface VfsReadRequest {
    type: 'honeygui-vfs-read';
    path: string;
}

/** 响应 Service Worker 的读文件请求 */
function handleServiceWorkerMessage(event: MessageEvent): void {
    const data = event.data as VfsReadRequest | undefined;
    const port = event.ports[0];
    if (!data || data.type !== 'honeygui-vfs-read' || !port) {
        return;
    }
    const bytes = vfs.readBytes(data.path);
    if (!bytes) {
        port.postMessage({ ok: false });
        return;
    }
    const copy = bytes.slice().buffer;
    port.postMessage({ ok: true, mime: mimeTypeOf(data.path), bytes: copy }, [copy]);
}

/**
 * 注册 Service Worker 并等待它接管本页面。
 * 返回 false 表示不可用（调用方退回 blob: URL）。
 */
export async function setupServiceWorker(scriptUrl: string): Promise<boolean> {
    if (!('serviceWorker' in navigator) || !globalThis.isSecureContext) {
        return false;
    }
    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
    try {
        await navigator.serviceWorker.register(scriptUrl);
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
            // 首次安装：等待 sw 的 clients.claim() 接管当前页面
            await new Promise<void>(resolve => {
                const timer = setTimeout(resolve, 3000);
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    clearTimeout(timer);
                    resolve();
                }, { once: true });
            });
        }
        const active = !!navigator.serviceWorker.controller;
        setServiceWorkerActive(active);
        return active;
    } catch (error) {
        console.warn('[HoneyGUI Web] Service worker unavailable, falling back to blob URLs:', error);
        return false;
    }
}
