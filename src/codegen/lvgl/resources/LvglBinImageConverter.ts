/**
 * LVGL binary image resource converter
 * Converts project images to LVGL binary format for external-bin deployment mode
 *
 * Uses HoneyGUI TypeScript ImageConverter to produce .bin files,
 * then parses the HoneyGUI binary header to extract metadata for lv_img_dsc_list generation.
 * The generated bin files are packaged into romfs.bin by LvglRomfsPackager
 * and referenced via lv_image_dsc_t descriptors in lv_img_dsc_list.c/h
 */
import * as fs from 'fs';
import * as path from 'path';
import { ImageConverter } from '../../../../tools/image-converter/converter';
import { PixelFormat } from '../../../../tools/image-converter/types';
import { RLECompression } from '../../../../tools/image-converter/compress/rle';

/**
 * Input image info for external-bin conversion
 */
export interface ExternalBinImage {
    /** Source path relative to assets directory */
    sourcePath: string;
    /** Resolved color format from conversion.json */
    resolvedFormat: string;
    /** Resolved compression method from conversion.json */
    resolvedCompression?: string;
}

/**
 * Output bin image metadata
 */
export interface BinImageInfo {
    /** Original image source path relative to assets */
    sourcePath: string;
    /** Bin file relative path within build/root/ */
    binRelPath: string;
    /** Bin file absolute path */
    binAbsPath: string;
    /** Image width in pixels */
    width: number;
    /** Image height in pixels */
    height: number;
    /** Stride in bytes (row length in pixel data) */
    stride: number;
    /** LVGL color format enum name (e.g., "LV_COLOR_FORMAT_RGB565"), mapped from HoneyGUI PixelFormat */
    colorFormat: string;
    /**
     * Value to write into `lv_image_dsc_t.data_size`.
     * - Uncompressed: pixel data size (file size - RGBDataHeader)
     * - Compressed (RLE): full bin file size, so the custom USER1 decoder
     *   receives the complete blob (RGBDataHeader + IMDC + offset table + data)
     */
    dataSize: number;
    /**
     * Byte offset added to the romfs macro to form `lv_image_dsc_t.data`.
     * - Uncompressed: 8 (skip RGBDataHeader, so .data points to raw pixels)
     * - Compressed (RLE): 0 (point to bin file start; the custom decoder parses headers)
     */
    headerSize: number;
    /** Whether the image was compressed (HoneyGUI compression: RLE/FastLZ/YUV) */
    compressed: boolean;
    /** C variable descriptor name (e.g., "bg", "weather_day_scr_bg") */
    descriptorName: string;
    /** Macro name in ui_resource.h (e.g., "BG_BIN") */
    macroName: string;
}

/**
 * Map HoneyGUI PixelFormat to LVGL color format enum name.
 * Only maps formats supported by both engines; unmapped formats fall back to LV_COLOR_FORMAT_RAW.
 */
const HONEYGUI_TO_LVGL_FORMAT_MAP: Record<number, string> = {
    [PixelFormat.RGB565]:      'LV_COLOR_FORMAT_RGB565',
    [PixelFormat.ARGB8565]:    'LV_COLOR_FORMAT_ARGB8565',
    [PixelFormat.RGB888]:      'LV_COLOR_FORMAT_RGB888',
    [PixelFormat.ARGB8888]:    'LV_COLOR_FORMAT_ARGB8888',
    [PixelFormat.XRGB8888]:    'LV_COLOR_FORMAT_XRGB8888',
    [PixelFormat.A8]:          'LV_COLOR_FORMAT_A8',
    [PixelFormat.A4]:          'LV_COLOR_FORMAT_A4',
    [PixelFormat.A2]:          'LV_COLOR_FORMAT_A2',
    [PixelFormat.A1]:          'LV_COLOR_FORMAT_A1',
    [PixelFormat.I8]:          'LV_COLOR_FORMAT_I8',
    [PixelFormat.I4]:          'LV_COLOR_FORMAT_I4',
    [PixelFormat.I2]:          'LV_COLOR_FORMAT_I2',
    [PixelFormat.I1]:          'LV_COLOR_FORMAT_I1',
};

/**
 * Bytes per pixel for each HoneyGUI PixelFormat (used for stride calculation).
 * Sub-byte formats (A1/A2/A4/I1/I2/I4) use fractional values.
 */
const PIXEL_FORMAT_BYTES_PER_PIXEL: Record<number, number> = {
    [PixelFormat.RGB565]:      2,
    [PixelFormat.ARGB8565]:    3,
    [PixelFormat.RGB888]:      3,
    [PixelFormat.ARGB8888]:    4,
    [PixelFormat.XRGB8888]:    4,
    [PixelFormat.A8]:          1,
    [PixelFormat.A4]:          0.5,
    [PixelFormat.A2]:          0.25,
    [PixelFormat.A1]:          0.125,
    [PixelFormat.I8]:          1,
    [PixelFormat.I4]:          0.5,
    [PixelFormat.I2]:          0.25,
    [PixelFormat.I1]:          0.125,
    [PixelFormat.GRAY]:        1,
};

/**
 * LVGL binary image converter
 * Converts images to HoneyGUI bin format (with optional RLE compression)
 * for LVGL external-bin deployment mode.
 */
export class LvglBinImageConverter {
    /** HoneyGUI RGBDataHeader size in bytes */
    private static readonly HONEYGUI_HEADER_SIZE = 8;

    /** HoneyGUI IMDCFileHeader size in bytes (compressed images only) */
    private static readonly IMDC_HEADER_SIZE = 12;

    /** Image extensions that can be converted */
    private static readonly CONVERTIBLE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.webp']);

    /**
     * Color formats the LVGL runtime RLE decoder (lv_idu.c::decompress_rle_data)
     * can handle. RLE compression is disabled for any image whose color format
     * is outside this set.
     */
    private static readonly RLE_RUNTIME_FORMATS = new Set([
        'LV_COLOR_FORMAT_RGB565',
        'LV_COLOR_FORMAT_RGB888',
        'LV_COLOR_FORMAT_ARGB8565',
        'LV_COLOR_FORMAT_ARGB8888',
    ]);

    /** Bin image info map (source key -> BinImageInfo) */
    private binImageInfoMap: Map<string, BinImageInfo> = new Map();

    /** All bin image infos */
    private binImageInfos: BinImageInfo[] = [];

    /**
     * Get bin image info by source path
     */
    getBinImageInfo(source: string): BinImageInfo | undefined {
        return this.binImageInfoMap.get(this.normalizeSourceKey(source));
    }

    /**
     * Get all bin image infos
     */
    getBinImageInfos(): BinImageInfo[] {
        return this.binImageInfos;
    }

    /**
     * Check if there are any external-bin images
     */
    hasBinImages(): boolean {
        return this.binImageInfos.length > 0;
    }

    /**
     * Map conversion.json format string → LVGL color format enum + HoneyGUI PixelFormat + bytes per pixel.
     * Returns null for unsupported formats.
     *
     * Note: Index formats (I8/I4/I2/I1) are intentionally NOT supported in
     * external-bin mode. Reasons:
     *   - HoneyGUI I8 bin layout (header + info + palette + indices) differs
     *     from what LVGL's stock decoder expects; pointer math would land
     *     inside the palette.
     *   - I4/I2/I1 bit-packed writers aren't implemented in ImageConverter.
     * Re-introduce only after both writer and parser are aligned with LVGL's
     * expected layout (see review #3).
     */
    private resolveFormatInfo(formatStr: string): { pixelFormat: PixelFormat; lvglColorFormat: string; bytesPerPixel: number } | null {
        const normalized = formatStr.trim().toUpperCase();
        const map: Record<string, { pf: PixelFormat; lvgl: string; bpp: number }> = {
            'RGB565':   { pf: PixelFormat.RGB565,   lvgl: 'LV_COLOR_FORMAT_RGB565',   bpp: 2 },
            'ARGB8565': { pf: PixelFormat.ARGB8565, lvgl: 'LV_COLOR_FORMAT_ARGB8565', bpp: 3 },
            'RGB888':   { pf: PixelFormat.RGB888,   lvgl: 'LV_COLOR_FORMAT_RGB888',   bpp: 3 },
            'ARGB8888': { pf: PixelFormat.ARGB8888, lvgl: 'LV_COLOR_FORMAT_ARGB8888', bpp: 4 },
            'XRGB8888': { pf: PixelFormat.XRGB8888, lvgl: 'LV_COLOR_FORMAT_XRGB8888', bpp: 4 },
            'A8':       { pf: PixelFormat.A8,       lvgl: 'LV_COLOR_FORMAT_A8',       bpp: 1 },
            'A4':       { pf: PixelFormat.A4,       lvgl: 'LV_COLOR_FORMAT_A4',       bpp: 0.5 },
            'A2':       { pf: PixelFormat.A2,       lvgl: 'LV_COLOR_FORMAT_A2',       bpp: 0.25 },
            'A1':       { pf: PixelFormat.A1,       lvgl: 'LV_COLOR_FORMAT_A1',       bpp: 0.125 },
        };
        const entry = map[normalized];
        if (!entry) return null;
        return { pixelFormat: entry.pf, lvglColorFormat: entry.lvgl, bytesPerPixel: entry.bpp };
    }

    /**
     * Prepare external-bin images (incremental conversion)
     * - Converts images using HoneyGUI TypeScript ImageConverter
     * - Skips images whose bin file is newer than source AND format matches
     * - Removes orphaned bin files
     */
    async prepare(
        images: ExternalBinImage[],
        projectRoot: string,
        outputRootDir: string
    ): Promise<BinImageInfo[]> {
        this.binImageInfoMap.clear();
        this.binImageInfos = [];

        if (images.length === 0) {
            return [];
        }

        // Ensure output directory exists
        if (!fs.existsSync(outputRootDir)) {
            fs.mkdirSync(outputRootDir, { recursive: true });
        }

        // Build set of needed bin paths for orphan cleanup
        const neededBinPaths = new Set<string>();

        for (const img of images) {
            // Resolve format info from conversion config (not from bin header!)
            const fmtInfo = this.resolveFormatInfo(img.resolvedFormat);
            if (!fmtInfo) {
                console.warn(`Unsupported format for LVGL external-bin: ${img.resolvedFormat}, skipping ${img.sourcePath}`);
                continue;
            }

            const inputPath = this.resolveImagePath(projectRoot, img.sourcePath);
            if (!inputPath) {
                console.warn(`Image file not found, skipping: ${img.sourcePath}`);
                continue;
            }

            // Generate bin output path maintaining directory structure
            const binRelPath = this.sourceToBinRelPath(img.sourcePath);
            const binAbsPath = path.join(outputRootDir, binRelPath);
            neededBinPaths.add(path.normalize(binAbsPath).toLowerCase());

            // Ensure bin directory exists
            const binDir = path.dirname(binAbsPath);
            if (!fs.existsSync(binDir)) {
                fs.mkdirSync(binDir, { recursive: true });
            }

            // Whether RLE compression is requested for this image
            let useRle = (img.resolvedCompression || '').toLowerCase() === 'rle';

            // LVGL runtime RLE decoder (lv_idu.c::decompress_rle_data) only handles
            // RGB565 / RGB888 / ARGB8565 / ARGB8888. For other formats we silently
            // disable RLE to avoid producing un-decodable bin files.
            if (useRle && !LvglBinImageConverter.RLE_RUNTIME_FORMATS.has(fmtInfo.lvglColorFormat)) {
                console.warn(
                    `[LvglBinImageConverter] RLE not supported for ${fmtInfo.lvglColorFormat} ` +
                    `(${img.sourcePath}); falling back to uncompressed.`
                );
                useRle = false;
            }

            // Incremental check: skip if bin exists AND is newer than source AND
            // both format and compression match
            if (this.isUpToDate(inputPath, binAbsPath)) {
                // Verify the existing bin format & compression match the requested config
                const existingInfo = this.parseBinFile(binAbsPath, img.sourcePath, binRelPath);
                if (existingInfo
                    && existingInfo.colorFormat === fmtInfo.lvglColorFormat
                    && existingInfo.compressed === useRle) {
                    // Format & compression match, reuse existing bin
                    const key = this.normalizeSourceKey(img.sourcePath);
                    this.binImageInfoMap.set(key, existingInfo);
                    this.binImageInfos.push(existingInfo);
                    continue;
                }
                // Format or compression mismatch, need to re-convert
                console.log(`[LvglBinImageConverter] Config changed, re-converting: ${img.sourcePath}`);
            }

            // Convert image to HoneyGUI bin format using TypeScript ImageConverter
            const success = await this.convertImageToBin(
                inputPath,
                binAbsPath,
                img.resolvedFormat,
                useRle
            );

            if (success) {
                const info = this.parseBinFile(binAbsPath, img.sourcePath, binRelPath);
                if (info) {
                    const key = this.normalizeSourceKey(img.sourcePath);
                    this.binImageInfoMap.set(key, info);
                    this.binImageInfos.push(info);
                }
            }
        }

        // Cleanup orphaned bin files
        this.cleanupOrphanedBinFiles(outputRootDir, neededBinPaths);

        return this.binImageInfos;
    }

    /**
     * Convert image source path to bin relative path
     * e.g., "assets/weather/bg.png" -> "weather/bg.bin"
     */
    private sourceToBinRelPath(sourcePath: string): string {
        let normalized = sourcePath.replace(/\\/g, '/').trim();
        normalized = normalized.replace(/^A:/i, '').replace(/^\/+/, '');

        // Remove assets/ prefix if present
        if (normalized.startsWith('assets/')) {
            normalized = normalized.substring('assets/'.length);
        }

        // Change extension to .bin
        const baseName = normalized.replace(/\.[^.]+$/, '');
        return `${baseName}.bin`;
    }

    /**
     * Normalize source path for Map lookup
     */
    private normalizeSourceKey(source: string): string {
        return source
            .replace(/\\/g, '/')
            .replace(/^A:/i, '')
            .replace(/^\/+/, '')
            .trim()
            .toLowerCase();
    }

    /**
     * Check if the output bin file is up-to-date relative to the source file
     */
    private isUpToDate(sourcePath: string, outputPath: string): boolean {
        try {
            if (!fs.existsSync(outputPath)) {
                return false;
            }
            const srcStat = fs.statSync(sourcePath);
            const outStat = fs.statSync(outputPath);
            return outStat.mtimeMs >= srcStat.mtimeMs;
        } catch {
            return false;
        }
    }

    /**
     * Resolve absolute path for an image
     */
    private resolveImagePath(projectRoot: string, source: string): string | null {
        let normalized = source.replace(/\\/g, '/').trim();
        normalized = normalized.replace(/^A:/i, '').replace(/^\/+/, '');

        const relativePath = normalized.startsWith('assets/')
            ? normalized.substring('assets/'.length)
            : normalized;

        const fullPath = path.join(projectRoot, 'assets', relativePath);
        if (fs.existsSync(fullPath)) {
            return fullPath;
        }

        const altPath = path.join(projectRoot, normalized);
        if (fs.existsSync(altPath)) {
            return altPath;
        }

        return null;
    }

    /**
     * Convert image to HoneyGUI bin format using TypeScript ImageConverter.
     *
     * Uncompressed output: RGBDataHeader (8 bytes) + pixel data.
     * RLE-compressed output: RGBDataHeader (8) + IMDCFileHeader (12) + offset table
     *                        ((height+1)*4 bytes) + RLE-compressed pixel data.
     *
     * The compressed bin format uses HoneyGUI's RLE layout. On the LVGL side the
     * resulting `lv_image_dsc_t` is tagged with `LV_IMAGE_FLAGS_USER1` (see
     * `LvglImgDscListGenerator.generateFlags`) so a custom decoder can recognize
     * the HoneyGUI RLE format.
     *
     * FastLZ / YUV are not exposed to LVGL external-bin and not handled here.
     */
    private async convertImageToBin(
        inputPath: string,
        outputPath: string,
        colorFormat: string,
        useRle: boolean = false
    ): Promise<boolean> {
        try {
            const pixelFormat = this.resolvePixelFormat(colorFormat);
            if (pixelFormat === null) {
                console.warn(`[LvglBinImageConverter] Unsupported format: ${colorFormat}, skipping ${inputPath}`);
                return false;
            }

            const converter = new ImageConverter();
            if (useRle) {
                // HoneyGUI RLE compressor; ImageConverter sets compress flag bit
                // in RGBDataHeader and writes IMDCFileHeader + offset table + data.
                converter.setCompressor(new RLECompression());
            }
            await converter.convert(inputPath, outputPath, pixelFormat);

            if (fs.existsSync(outputPath)) {
                console.log(`[LvglBinImageConverter] Converted${useRle ? ' (RLE)' : ''}: ${inputPath} -> ${outputPath}`);
                return true;
            }

            console.warn(`[LvglBinImageConverter] No output: ${inputPath}`);
            return false;
        } catch (error) {
            console.warn(`[LvglBinImageConverter] Failed: ${inputPath}`, error);
            return false;
        }
    }

    /**
     * Map conversion.json format string to HoneyGUI PixelFormat enum.
     * Index formats (I8/I4/I2/I1) are not supported in external-bin mode;
     * see `resolveFormatInfo` for rationale.
     */
    private resolvePixelFormat(formatStr: string): PixelFormat | null {
        const normalized = formatStr.trim().toUpperCase();
        const map: Record<string, PixelFormat> = {
            'RGB565':   PixelFormat.RGB565,
            'ARGB8565': PixelFormat.ARGB8565,
            'RGB888':   PixelFormat.RGB888,
            'ARGB8888': PixelFormat.ARGB8888,
            'XRGB8888': PixelFormat.XRGB8888,
            'A8':       PixelFormat.A8,
            'A4':       PixelFormat.A4,
            'A2':       PixelFormat.A2,
            'A1':       PixelFormat.A1,
        };
        return map[normalized] ?? null;
    }

    /**
     * Parse HoneyGUI bin file header to extract metadata.
     *
     * HoneyGUI bin format:
     *   RGBDataHeader (8 bytes):
     *     byte 0:    flags (bit0=scan, bit1=align, bit2-3=resize, bit4=compress, ...)
     *     byte 1:    type (PixelFormat enum value)
     *     bytes 2-3: width (int16 LE)
     *     bytes 4-5: height (int16 LE)
     *     bytes 6-7: version + rsvd2
     *
     *   If compressed (flags bit4=1):
     *     IMDCFileHeader (12 bytes) + offset table ((height+1)*4 bytes) + compressed data
     *
     *   If uncompressed:
     *     pixel data starts immediately after RGBDataHeader
     */
    private parseBinFile(
        binAbsPath: string,
        sourcePath: string,
        binRelPath: string
    ): BinImageInfo | null {
        let fd: number | null = null;
        try {
            fd = fs.openSync(binAbsPath, 'r');
            const header = Buffer.alloc(LvglBinImageConverter.HONEYGUI_HEADER_SIZE);
            fs.readSync(fd, header, 0, header.length, 0);

            // Parse RGBDataHeader fields
            const flags = header.readUInt8(0);
            const honeyguiFormat = header.readUInt8(1);
            const width = header.readInt16LE(2);
            const height = header.readInt16LE(4);

            // Check compress flag (bit 4 in HoneyGUI RGBDataHeader byte 0)
            const compressed = (flags & 0x10) !== 0;

            // Map HoneyGUI PixelFormat to LVGL color format enum
            const colorFormat = HONEYGUI_TO_LVGL_FORMAT_MAP[honeyguiFormat] || 'LV_COLOR_FORMAT_RAW';

            // Calculate stride from format and width
            const bpp = PIXEL_FORMAT_BYTES_PER_PIXEL[honeyguiFormat] || 1;
            const stride = Math.ceil(width * bpp);

            // Determine the (headerOffset, dataSize) pair written into lv_image_dsc_t.
            //
            // Uncompressed images:
            //   .data points past RGBDataHeader (8) to raw pixel bytes;
            //   .data_size = file size - 8.
            //
            // Compressed images (HoneyGUI RLE -> LV_IMAGE_FLAGS_USER1):
            //   The custom USER1 decoder needs the full HoneyGUI bin (RGBDataHeader
            //   + IMDCFileHeader + offset table + compressed data) to parse line
            //   offsets and algorithm params. Therefore .data points to the file
            //   start and .data_size covers the full file.
            const stat = fs.statSync(binAbsPath);
            const headerOffset = compressed ? 0 : LvglBinImageConverter.HONEYGUI_HEADER_SIZE;
            const dataSize = compressed ? stat.size : stat.size - LvglBinImageConverter.HONEYGUI_HEADER_SIZE;

            const descriptorName = this.generateDescriptorName(sourcePath);
            const macroName = this.generateMacroName(sourcePath);

            return {
                sourcePath,
                binRelPath,
                binAbsPath,
                width,
                height,
                stride,
                colorFormat,
                dataSize,
                headerSize: headerOffset,
                compressed,
                descriptorName,
                macroName,
            };
        } catch (err) {
            console.warn(`[LvglBinImageConverter] Failed to parse bin file: ${binAbsPath}`, err);
            return null;
        } finally {
            // Always close the file descriptor, even if parsing threw
            if (fd !== null) {
                try { fs.closeSync(fd); } catch { /* ignore */ }
            }
        }
    }

    /**
     * Generate C descriptor variable name from source path
     * e.g., "assets/weather/bg.png" -> "weather_bg" or just "bg" if simple
     */
    private generateDescriptorName(sourcePath: string): string {
        let normalized = sourcePath.replace(/\\/g, '/').trim();
        normalized = normalized.replace(/^A:/i, '').replace(/^\/+/, '');

        if (normalized.startsWith('assets/')) {
            normalized = normalized.substring('assets/'.length);
        }

        // Remove extension
        const baseName = normalized.replace(/\.[^.]+$/, '');

        // Convert path to variable name: replace slashes and special chars with underscore
        let varName = baseName.replace(/[/]+/g, '_').replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_');

        // Remove leading/trailing underscores
        varName = varName.replace(/^_+|_+$/g, '');

        // Ensure starts with letter or underscore
        if (/^[0-9]/.test(varName)) {
            varName = '_' + varName;
        }

        return varName.toLowerCase();
    }

    /**
     * Generate macro name for ui_resource.h
     *
     * IMPORTANT: This MUST match mkromfs_for_honeygui.py's macro naming, because
     * the macros referenced in lv_img_dsc_list.c must resolve to the #define lines
     * mkromfs writes into ui_resource.h. mkromfs uses ONLY the bin file basename:
     *
     *   macro_base = ''.join(ch if ch.isalnum() else '_' for ch in basename)
     *   macro      = macro_base.upper()
     *   if first char is digit: prefix 'F_'
     *
     * Examples:
     *   "assets/applist/app_camera.png"       -> "APP_CAMERA_BIN"
     *   "assets/weather/bg.png"               -> "BG_BIN"
     *   "assets/123foo.png"                   -> "F_123FOO_BIN"
     *
     * Note: subdirectory info is intentionally dropped to mirror mkromfs.
     * If two source images share the same basename in different subdirs,
     * mkromfs itself would emit duplicate #define lines (C redefinition error),
     * so this is a structural limitation of the romfs format, not introduced here.
     */
    private generateMacroName(sourcePath: string): string {
        let normalized = sourcePath.replace(/\\/g, '/').trim();
        normalized = normalized.replace(/^A:/i, '').replace(/^\/+/, '');

        // Take basename only (mkromfs flattens macro names)
        const baseNameNoExt = path.basename(normalized).replace(/\.[^.]+$/, '');
        // The bin file's basename ends in ".bin" - mirror that for macro derivation
        const binBasename = `${baseNameNoExt}.bin`;

        // Replicate mkromfs char transform: non-alphanumeric -> '_'
        let macro = '';
        for (const ch of binBasename) {
            macro += /[a-zA-Z0-9]/.test(ch) ? ch : '_';
        }
        macro = macro.toUpperCase();

        // Mirror mkromfs digit-prefix rule
        if (/^[0-9]/.test(macro)) {
            macro = 'F_' + macro;
        }

        return macro;
    }

    /**
     * Remove orphaned bin files that are no longer referenced
     */
    private cleanupOrphanedBinFiles(rootDir: string, neededPaths: Set<string>): void {
        if (!fs.existsSync(rootDir)) {
            return;
        }

        const cleanup = (dir: string) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    cleanup(fullPath);
                    // Remove empty directories
                    const subEntries = fs.readdirSync(fullPath);
                    if (subEntries.length === 0) {
                        try {
                            fs.rmdirSync(fullPath);
                            console.log(`[LvglBinImageConverter] Removed empty directory: ${fullPath}`);
                        } catch { /* ignore */ }
                    }
                } else if (entry.isFile() && entry.name.endsWith('.bin')) {
                    const normalizedPath = path.normalize(fullPath).toLowerCase();
                    if (!neededPaths.has(normalizedPath)) {
                        console.log(`[LvglBinImageConverter] Removing orphaned bin: ${fullPath}`);
                        try {
                            fs.unlinkSync(fullPath);
                        } catch { /* ignore */ }
                    }
                }
            }
        };

        cleanup(rootDir);
    }
}
