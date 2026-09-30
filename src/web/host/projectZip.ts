/**
 * 工程 ZIP 导入 / 导出
 */
import * as path from 'path';
import { unzipSync, zipSync, Zippable } from 'fflate';
import { vfs } from '../shims/fs';

/** 导出时跳过的目录（仿真编译产物等浏览器版不会产生，但导入的工程里可能存在） */
const EXPORT_SKIPPED_DIRECTORIES = new Set(['build', 'node_modules', '.git']);

export interface ImportedZip {
    /** 工程名：project.json 的 name，缺省为 ZIP 顶层目录名或文件名 */
    name: string;
    /** 工程内相对路径 → 内容 */
    files: Map<string, Uint8Array>;
}

/**
 * 解析 ZIP，定位 project.json 所在目录作为工程根。
 * 兼容「ZIP 根目录就是工程」和「ZIP 内含一层工程目录」两种打包方式。
 */
export function importProjectZip(zipName: string, data: Uint8Array): ImportedZip {
    const entries = unzipSync(data);
    const paths = Object.keys(entries).filter(p => !p.startsWith('__MACOSX/'));
    const projectJson = paths
        .filter(p => path.posix.basename(p) === 'project.json')
        .sort((a, b) => a.split('/').length - b.split('/').length)[0];
    if (!projectJson) {
        throw new Error('project.json not found in ZIP');
    }

    const prefix = path.posix.dirname(projectJson) === '.' ? '' : `${path.posix.dirname(projectJson)}/`;
    const files = new Map<string, Uint8Array>();
    for (const entryPath of paths) {
        if (!entryPath.startsWith(prefix) || entryPath.endsWith('/')) {
            continue;
        }
        const relative = entryPath.slice(prefix.length);
        if (relative.split('/').some(segment => segment === '..')) {
            continue;
        }
        files.set(relative, entries[entryPath]);
    }

    let name = prefix ? path.posix.basename(prefix) : zipName.replace(/\.zip$/i, '');
    try {
        const config = JSON.parse(new TextDecoder().decode(files.get('project.json')));
        if (typeof config.name === 'string' && config.name.trim()) {
            name = config.name.trim();
        }
    } catch {
        // project.json 解析失败时沿用目录名，打开后由宿主代码报告配置错误
    }
    return { name, files };
}

/** 把内存文件系统中的工程目录打包成 ZIP（ZIP 内含一层以工程名命名的目录） */
export function exportProjectZip(root: string, projectName: string): Uint8Array {
    const tree: Zippable = {};
    for (const absolute of vfs.listFiles(root)) {
        const relative = path.posix.relative(root, absolute);
        if (EXPORT_SKIPPED_DIRECTORIES.has(relative.split('/')[0])) {
            continue;
        }
        const data = vfs.readBytes(absolute);
        if (data) {
            tree[`${projectName}/${relative}`] = data;
        }
    }
    for (const dir of vfs.listDirs(root)) {
        const relative = path.posix.relative(root, dir);
        const hasFiles = Object.keys(tree).some(key => key.startsWith(`${projectName}/${relative}/`));
        if (!hasFiles && !EXPORT_SKIPPED_DIRECTORIES.has(relative.split('/')[0])) {
            tree[`${projectName}/${relative}/`] = new Uint8Array(0);
        }
    }
    return zipSync(tree, { level: 6 });
}

export function downloadBlob(data: Uint8Array, fileName: string, mimeType = 'application/zip'): void {
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mimeType }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
