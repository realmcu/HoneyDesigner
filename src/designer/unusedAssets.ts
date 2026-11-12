/**
 * 未使用资源检测：列出 assets/ 下没有被任何 HML、C 源码引用，也没有标记为强制转换的文件。
 *
 * 只依赖 fs / path，浏览器版通过 shims 复用同一份实现。
 *
 * 判定为「已使用」的来源：
 * - HML 任一属性值等于资源路径（`assets/x.png`、`/x.ttf`、`x.png`），或在 JSON 值
 *   （timers、iconImages 等）里出现 `assets/...`
 * - `iconFolder` 指向的文件夹下的全部文件
 * - src/ 下 C 源码字符串字面量里的转换产物路径（`"/image/a.bin"` 对应 `image/a.*`，
 *   字体 `x_size16_..._bitmap.bin` 对应 `x.ttf`，模型 `desc_x.bin` / `gltf_desc_x.bin`）
 * - conversion.json 的 alwaysConvert（精确路径或 glob）
 * - 已使用 3D 模型的 .mtl 贴图、glTF 的 buffers / images
 *
 * assets/user/ 原样拷贝，不参与检测。C 代码运行时拼出来的路径检测不到，删除前必须让用户确认。
 */
import * as fs from 'fs';
import * as path from 'path';
import { minimatch } from 'minimatch';
import { ProjectUtils } from '../utils/ProjectUtils';
import { ConversionConfigService } from '../services/ConversionConfigService';
import { scanOpenTags, parseTagAttributes } from '../hml/tagScan';

export interface UnusedAsset {
    /** 相对 assets/ 的路径（'/' 分隔） */
    path: string;
    /** 文件大小，含随模型一起删除的 .mtl / .bin */
    size: number;
    /** 随模型一起删除的隐藏依赖（.mtl / .bin），相对 assets/ */
    sidecars: string[];
}

export interface UnusedAssetsResult {
    files: UnusedAsset[];
    totalSize: number;
}

/** 与 AssetManager.scanAssetsDirectory 在资源面板显示的类型一致（trmap 构建时全量拷贝，不检测） */
const ASSET_EXTS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg',
    '.mp4', '.avi', '.mov', '.mkv', '.webm',
    '.gltf', '.glb', '.obj',
    '.ttf', '.otf', '.woff', '.woff2',
    '.glass', '.lottie', '.json',
]);
const NON_ASSET_JSON = new Set(['project.json', 'package.json', 'tsconfig.json', 'conversion.json']);
const FONT_EXTS = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const SOURCE_EXTS = new Set(['.c', '.h', '.cpp', '.hpp']);
const SIDECAR_EXTS = new Set(['.mtl', '.bin']);
const MTL_MAP_TYPES = ['map_Kd', 'map_Ka', 'map_Ks', 'map_Ns', 'map_d', 'map_bump', 'bump'];

const toPosix = (p: string): string => p.replace(/\\/g, '/');
const stripExt = (rel: string): string => rel.slice(0, rel.length - path.posix.extname(rel).length);

function walk(dir: string, onFile: (abs: string) => void, skipDir?: (abs: string) => boolean): void {
    if (!fs.existsSync(dir)) {
        return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!skipDir?.(abs)) {
                walk(abs, onFile, skipDir);
            }
        } else {
            onFile(abs);
        }
    }
}

function readText(file: string): string | undefined {
    try {
        return fs.readFileSync(file, 'utf-8');
    } catch {
        return undefined;
    }
}

/** 3D 模型依赖（绝对路径）：OBJ 的同名 .mtl 及其贴图，glTF 的 buffers / images */
function modelDependencies(modelAbs: string): string[] {
    const ext = path.extname(modelAbs).toLowerCase();
    const dir = path.dirname(modelAbs);
    const deps: string[] = [];
    if (ext === '.obj') {
        const mtl = path.join(dir, path.basename(modelAbs, path.extname(modelAbs)) + '.mtl');
        const text = readText(mtl);
        if (text === undefined) {
            return deps;
        }
        deps.push(mtl);
        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (MTL_MAP_TYPES.some(type => trimmed.startsWith(type + ' '))) {
                const file = trimmed.split(/\s+/).pop();
                if (file && !file.startsWith('-')) {
                    deps.push(path.join(dir, file));
                }
            }
        }
    } else if (ext === '.gltf') {
        const text = readText(modelAbs);
        if (text === undefined) {
            return deps;
        }
        try {
            const gltf = JSON.parse(text);
            for (const item of [...(gltf.buffers || []), ...(gltf.images || [])]) {
                if (typeof item?.uri === 'string' && !item.uri.startsWith('data:')) {
                    let uri = item.uri;
                    try { uri = decodeURIComponent(uri); } catch { /* 保留原样 */ }
                    deps.push(path.join(dir, uri));
                }
            }
        } catch {
            // glTF 解析失败：当作没有依赖
        }
    }
    return deps;
}

export function findUnusedAssets(projectRoot: string): UnusedAssetsResult {
    const assetsDir = ProjectUtils.getAssetsDir(projectRoot);
    const relOf = (abs: string): string | undefined => {
        const rel = toPosix(path.relative(assetsDir, abs));
        return rel && !rel.startsWith('../') && rel !== '..' && !path.isAbsolute(rel) ? rel : undefined;
    };

    // 候选：assets/ 下资源面板可见的文件，跳过 user/
    const candidates = new Map<string, number>();
    walk(assetsDir, abs => {
        const name = path.basename(abs);
        const ext = path.extname(name).toLowerCase();
        if (!ASSET_EXTS.has(ext) || (ext === '.json' && NON_ASSET_JSON.has(name))) {
            return;
        }
        const rel = relOf(abs);
        if (rel) {
            candidates.set(rel, fs.statSync(abs)?.size ?? 0);
        }
    }, abs => relOf(abs) === 'user');

    const used = new Set<string>();
    const usedFolders: string[] = [];
    const mark = (raw: string) => {
        let p = toPosix(raw.trim()).replace(/^\.\//, '');
        if (p.startsWith('assets/')) {
            p = p.slice('assets/'.length);
        } else if (p.startsWith('/')) {
            p = p.slice(1);
        }
        if (candidates.has(p)) {
            used.add(p);
        }
    };

    // HML：ui/ 递归 + 项目根目录下的 .hml
    const hmlFiles: string[] = [];
    walk(ProjectUtils.getUiDir(projectRoot), abs => {
        if (abs.toLowerCase().endsWith('.hml')) {
            hmlFiles.push(abs);
        }
    });
    if (fs.existsSync(projectRoot)) {
        for (const name of fs.readdirSync(projectRoot) as string[]) {
            if (name.toLowerCase().endsWith('.hml')) {
                hmlFiles.push(path.join(projectRoot, name));
            }
        }
    }
    const assetRef = /assets\/[^"'<>\r\n,\]}]+/g;
    for (const file of hmlFiles) {
        const content = readText(file)?.replace(/<!--[\s\S]*?-->/g, '');
        if (!content) {
            continue;
        }
        for (const tag of scanOpenTags(content)) {
            for (const [name, value] of parseTagAttributes(tag.attrsText)) {
                if (!value) {
                    continue;
                }
                mark(value);
                let m: RegExpExecArray | null;
                assetRef.lastIndex = 0;
                while ((m = assetRef.exec(value)) !== null) {
                    mark(m[0]);
                }
                if (name === 'iconFolder') {
                    const folder = toPosix(value).replace(/^assets\//, '').replace(/^\/+|\/+$/g, '');
                    if (folder) {
                        usedFolders.push(folder + '/');
                    }
                }
            }
        }
    }

    // C 源码：字符串字面量里的资源或转换产物路径，按去扩展名后的路径匹配
    const sourceStems = new Set<string>();
    walk(ProjectUtils.getSrcDir(projectRoot), abs => {
        if (!SOURCE_EXTS.has(path.extname(abs).toLowerCase())) {
            return;
        }
        const text = readText(abs);
        if (!text) {
            return;
        }
        const literal = /"([^"\r\n]+)"/g;
        let m: RegExpExecArray | null;
        while ((m = literal.exec(text)) !== null) {
            const value = m[1];
            if (!path.posix.extname(value)) {
                continue;
            }
            mark(value);
            sourceStems.add(stripExt(toPosix(value).replace(/^assets\//, '').replace(/^\/+/, '')));
        }
    });

    let acPatterns: string[] = [];
    const alwaysConvert = ConversionConfigService.getInstance().loadConfig(projectRoot).alwaysConvert;
    if (alwaysConvert) {
        acPatterns = [
            ...(alwaysConvert.images || []),
            ...(alwaysConvert.videos || []),
            ...(alwaysConvert.models || []),
            ...(alwaysConvert.fonts || []),
        ].filter((p): p is string => typeof p === 'string' && p !== '');
    }

    const stems = [...sourceStems];
    for (const rel of candidates.keys()) {
        if (used.has(rel)) {
            continue;
        }
        const stem = stripExt(rel);
        const ext = path.posix.extname(rel).toLowerCase();
        const dir = path.posix.dirname(rel);
        const inDir = (name: string) => (dir === '.' ? name : `${dir}/${name}`);
        const base = path.posix.basename(stem);
        if (
            usedFolders.some(folder => rel.startsWith(folder)) ||
            acPatterns.some(pattern => pattern === rel || minimatch(rel, pattern)) ||
            sourceStems.has(stem) ||
            (FONT_EXTS.has(ext) && stems.some(s => s.startsWith(stem + '_size'))) ||
            sourceStems.has(inDir(`desc_${base}`)) ||
            sourceStems.has(inDir(`gltf_desc_${base}`))
        ) {
            used.add(rel);
        }
    }

    // 已使用模型的依赖也算已使用；记下其中的 .mtl / .bin，避免随未使用模型一起删掉
    const keptSidecars = new Set<string>();
    for (const rel of [...used]) {
        for (const dep of modelDependencies(path.join(assetsDir, rel))) {
            const depRel = relOf(dep);
            if (depRel) {
                mark(depRel);
                keptSidecars.add(depRel);
            }
        }
    }

    const files: UnusedAsset[] = [];
    let totalSize = 0;
    for (const [rel, fileSize] of candidates) {
        if (used.has(rel)) {
            continue;
        }
        let size = fileSize;
        const sidecars: string[] = [];
        for (const dep of modelDependencies(path.join(assetsDir, rel))) {
            const depRel = relOf(dep);
            if (depRel && SIDECAR_EXTS.has(path.posix.extname(depRel).toLowerCase())
                && !keptSidecars.has(depRel) && !sidecars.includes(depRel) && fs.existsSync(dep)) {
                sidecars.push(depRel);
                size += fs.statSync(dep)?.size ?? 0;
            }
        }
        files.push({ path: rel, size, sidecars });
        totalSize += size;
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, totalSize };
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
