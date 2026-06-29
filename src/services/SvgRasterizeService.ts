import * as fs from 'fs';
import * as path from 'path';
import { Resvg, initWasm } from '@resvg/resvg-wasm';

/**
 * SVG 栅格化服务（图标取材管线的栅格化段）
 *
 * 职责：把 SVG 字符串栅格化为 PNG，写入项目 assets/，返回供 HML 引用的路径。
 * - 栅格化引擎：@resvg/resvg-wasm（Rust resvg 编译的 WASM，平台无关，离线）。
 * - 产物到 PNG 即止：PNG → .bin 由仿真/构建期 ImageConverterService 处理，本服务不碰。
 * - assetPath 统一为 `assets/<name>.png`（相对 projectRoot），三处兼容：
 *   webview 预览（path.join(projectRoot, src)）、codegen（自动 .png→.bin）、真实 HML。
 */

/** wasm 全进程只能 initWasm 一次，用 module 级 promise 守护幂等；失败置空以允许重试。 */
let wasmInitPromise: Promise<void> | null = null;

function ensureWasmInit(): Promise<void> {
    if (!wasmInitPromise) {
        wasmInitPromise = (async () => {
            // require.resolve 在扩展 runtime 与打包后的 vsix 里都能定位到 node_modules 下的 wasm
            const wasmPath = require.resolve('@resvg/resvg-wasm/index_bg.wasm');
            const wasmBuffer = fs.readFileSync(wasmPath);
            await initWasm(wasmBuffer);
            console.log('[SvgRasterize] wasm initialized');
        })().catch((e) => {
            wasmInitPromise = null;
            throw e;
        });
    }
    return wasmInitPromise;
}

/** 带错误码的服务异常，便于 HTTP 层映射状态码与 error.code。 */
export class SvgRasterizeError extends Error {
    constructor(public readonly code: string, message: string) {
        super(message);
        this.name = 'SvgRasterizeError';
    }
}

export interface RasterizeOptions {
    /** 输出 PNG 宽度(px)，主导尺寸 */
    width: number;
    /** 可选高度(px)；省略则按 SVG viewBox 宽高比 */
    height?: number;
    /** 注入字体的绝对路径列表（供含 <text> 的 SVG 用；图标取材的矢量图标用不到） */
    fontPaths?: string[];
}

export interface SvgToAssetOptions extends RasterizeOptions {
    /** 同名资源已存在时是否覆盖，默认 false */
    overwrite?: boolean;
    /**
     * 自动扫描 projectRoot/assets/*.ttf 并注入为可用字体，默认 true。
     * 设为 false 时只使用 fontPaths 显式传入的字体。
     */
    autoLoadProjectFonts?: boolean;
}

export interface SvgAssetResult {
    /** 供 HML 引用的路径，相对 projectRoot，如 assets/icon_bluetooth.png */
    assetPath: string;
    absolutePath: string;
    width: number;
    height: number;
    bytes: number;
    /** 本次渲染注入的字体文件名列表（去扩展名）。兼容字段，图标取材一般为默认 fallback 字体 */
    loadedFonts: string[];
}

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export class SvgRasterizeService {
    /**
     * SVG 字符串 → PNG buffer。width 主导，height 省略则按宽高比。
     * 若提供 height，则按宽高同时拉伸到目标尺寸（用 viewBox 缩放）。
     */
    async rasterize(svg: string, opts: RasterizeOptions): Promise<{ png: Buffer; width: number; height: number }> {
        if (!svg || typeof svg !== 'string' || !svg.includes('<svg')) {
            throw new SvgRasterizeError('RASTERIZE_FAILED', 'Invalid SVG content');
        }
        if (!Number.isFinite(opts.width) || opts.width <= 0) {
            throw new SvgRasterizeError('INVALID_PARAMETER', 'width must be a positive number');
        }

        await ensureWasmInit();

        // 读取字体 buffer 列表（路径不存在的静默跳过，不中断渲染）
        const fontBuffers: Uint8Array[] = [];
        for (const fp of opts.fontPaths ?? []) {
            try {
                fontBuffers.push(new Uint8Array(fs.readFileSync(fp)));
            } catch {
                // 字体文件缺失不致命，resvg 会用内置 fallback
            }
        }

        try {
            const resvgOpts: Record<string, unknown> = {
                fitTo: { mode: 'width', value: Math.round(opts.width) },
                font: { loadSystemFonts: false, ...(fontBuffers.length > 0 ? { fontBuffers } : {}) },
            };
            const resvg = new Resvg(svg, resvgOpts);
            const rendered = resvg.render();
            const png = Buffer.from(rendered.asPng());
            const width = rendered.width;
            const height = rendered.height;
            (rendered as unknown as { free?: () => void }).free?.();
            (resvg as unknown as { free?: () => void }).free?.();
            return { png, width, height };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new SvgRasterizeError('RASTERIZE_FAILED', `resvg render failed: ${msg}`);
        }
    }

    /**
     * SVG → PNG → 写入 <projectRoot>/assets/<name>.png，返回供 HML 引用的相对路径。
     */
    async svgToAsset(
        svg: string,
        projectRoot: string,
        name: string,
        opts: SvgToAssetOptions
    ): Promise<SvgAssetResult> {
        if (!name || !NAME_PATTERN.test(name)) {
            throw new SvgRasterizeError('INVALID_NAME', 'name must match [a-zA-Z0-9_-]+ (no extension, no path separators)');
        }

        const assetsDir = path.join(projectRoot, 'assets');
        const fileName = `${name}.png`;
        const absolutePath = path.join(assetsDir, fileName);

        // 双保险防目录穿越：name 已白名单，确认最终路径仍在 assets/ 内
        const normalizedAssets = path.resolve(assetsDir);
        if (path.dirname(path.resolve(absolutePath)) !== normalizedAssets) {
            throw new SvgRasterizeError('INVALID_NAME', 'resolved path escapes assets directory');
        }

        if (fs.existsSync(absolutePath) && !opts.overwrite) {
            throw new SvgRasterizeError('ASSET_EXISTS', `Asset already exists: assets/${fileName} (set overwrite=true to replace)`);
        }

        // 自动扫描 assets/*.ttf，与调用方显式传入的 fontPaths 合并
        const autoLoadFonts = opts.autoLoadProjectFonts !== false;
        const projectTtfs: string[] = [];
        if (autoLoadFonts && fs.existsSync(assetsDir)) {
            for (const f of fs.readdirSync(assetsDir)) {
                if (f.toLowerCase().endsWith('.ttf')) {
                    projectTtfs.push(path.join(assetsDir, f));
                }
            }
        }
        const mergedFontPaths = [...(opts.fontPaths ?? []), ...projectTtfs];
        const loadedFonts = mergedFontPaths.map(fp => path.basename(fp, path.extname(fp)));

        const { png, width, height } = await this.rasterize(svg, { ...opts, fontPaths: mergedFontPaths });

        if (!fs.existsSync(assetsDir)) {
            fs.mkdirSync(assetsDir, { recursive: true });
        }
        fs.writeFileSync(absolutePath, png);
        console.log(`[SvgRasterize] wrote assets/${fileName} (${width}x${height}, ${png.length} bytes, fonts: ${loadedFonts.join(', ') || 'none'})`);

        return {
            assetPath: `assets/${fileName}`,
            absolutePath,
            width,
            height,
            bytes: png.length,
            loadedFonts,
        };
    }
}
