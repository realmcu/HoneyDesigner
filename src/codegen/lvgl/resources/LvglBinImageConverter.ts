/**
 * LVGL binary image resource converter
 * Converts project images to LVGL binary format for external-bin deployment mode
 *
 * The generated bin files are packaged into romfs.bin by LvglRomfsPackager
 * and referenced via lv_image_dsc_t descriptors in lv_img_dsc_list.c/h
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

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
    /** Stride in bytes */
    stride: number;
    /** LVGL color format enum name (e.g., "LV_COLOR_FORMAT_RGB565") */
    colorFormat: string;
    /** Pixel data size (excluding header) */
    dataSize: number;
    /** Bin header size (always 12 bytes for LVGL v9 bin format) */
    headerSize: number;
    /** Whether the image is compressed */
    compressed: boolean;
    /** C variable descriptor name (e.g., "bg", "weather_day_scr_bg") */
    descriptorName: string;
    /** Macro name in ui_resource.h (e.g., "BG_BIN") */
    macroName: string;
}

/**
 * Color format mapping from format string to LVGL enum name
 */
const COLOR_FORMAT_MAP: Record<string, string> = {
    'L8': 'LV_COLOR_FORMAT_L8',
    'I1': 'LV_COLOR_FORMAT_I1',
    'I2': 'LV_COLOR_FORMAT_I2',
    'I4': 'LV_COLOR_FORMAT_I4',
    'I8': 'LV_COLOR_FORMAT_I8',
    'A1': 'LV_COLOR_FORMAT_A1',
    'A2': 'LV_COLOR_FORMAT_A2',
    'A4': 'LV_COLOR_FORMAT_A4',
    'A8': 'LV_COLOR_FORMAT_A8',
    'AL88': 'LV_COLOR_FORMAT_AL88',
    'ARGB8888': 'LV_COLOR_FORMAT_ARGB8888',
    'XRGB8888': 'LV_COLOR_FORMAT_XRGB8888',
    'RGB565': 'LV_COLOR_FORMAT_RGB565',
    'RGB565_SWAPPED': 'LV_COLOR_FORMAT_RGB565_SWAPPED',
    'ARGB8565': 'LV_COLOR_FORMAT_ARGB8565',
    'RGB565A8': 'LV_COLOR_FORMAT_RGB565A8',
    'RGB888': 'LV_COLOR_FORMAT_RGB888',
};

/**
 * LVGL binary image converter
 * Converts images to LVGL bin format using LVGLImage.py
 */
export class LvglBinImageConverter {
    /** LVGL bin header size in bytes (magic + cf + flags + w + h + stride + reserved) */
    private static readonly LVGL_BIN_HEADER_SIZE = 12;

    /** Magic number for LVGL v9 bin format */
    private static readonly LVGL_BIN_MAGIC = 0x19;

    /** Image extensions that can be converted */
    private static readonly CONVERTIBLE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.webp']);

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
     * Prepare external-bin images (incremental conversion)
     * - Converts images to LVGL bin format
     * - Skips images whose bin file is newer than source
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

        const toolPath = this.findLvglImageTool();
        if (!toolPath) {
            console.warn('LVGL image conversion tool not found, skipping bin image conversion');
            return [];
        }

        // Ensure output directory exists
        if (!fs.existsSync(outputRootDir)) {
            fs.mkdirSync(outputRootDir, { recursive: true });
        }

        // Build set of needed bin paths for orphan cleanup
        const neededBinPaths = new Set<string>();

        for (const img of images) {
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

            // Incremental check: skip if bin exists and is newer than source
            if (this.isUpToDate(inputPath, binAbsPath)) {
                // Parse existing bin file to get metadata
                const info = this.parseBinFile(binAbsPath, img.sourcePath, binRelPath);
                if (info) {
                    const key = this.normalizeSourceKey(img.sourcePath);
                    this.binImageInfoMap.set(key, info);
                    this.binImageInfos.push(info);
                }
                continue;
            }

            // Convert image to bin format
            const success = await this.convertImageToBin(
                toolPath,
                inputPath,
                binAbsPath,
                img.resolvedFormat
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
     * Find LVGLImage.py conversion tool
     */
    private findLvglImageTool(): string | null {
        const candidates = [
            process.env.HONEYGUI_LVGL_IMAGE_TOOL,
            path.resolve(__dirname, '../../../../../lvgl-pc/lvgl-official-tools/scripts/LVGLImage.py'),
            path.join(process.cwd(), 'lvgl-pc', 'lvgl-official-tools', 'scripts', 'LVGLImage.py'),
        ].filter((c): c is string => !!c);

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        return null;
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
     * Convert image to LVGL bin format using LVGLImage.py
     */
    private async convertImageToBin(
        toolPath: string,
        inputPath: string,
        outputPath: string,
        colorFormat: string
    ): Promise<boolean> {
        const ext = path.extname(inputPath).toLowerCase();

        let actualInputPath = inputPath;
        let tempPngPath: string | null = null;
        let cf = colorFormat || 'RGB565';

        // Convert non-PNG images to PNG first
        if (ext !== '.png') {
            tempPngPath = path.join(path.dirname(outputPath), `_temp_${path.basename(outputPath, '.bin')}.png`);
            const convertSuccess = this.convertToPng(inputPath, tempPngPath);
            if (!convertSuccess) {
                console.warn(`Image format conversion failed: ${inputPath}`);
                return false;
            }
            actualInputPath = tempPngPath;
        }

        // Build LVGLImage.py command
        const outputDir = path.dirname(outputPath);
        const baseName = path.basename(outputPath, '.bin');

        const baseArgs = [
            toolPath,
            '--ofmt', 'BIN',
            '--cf', cf,
            '-o', outputDir,
            '--name', baseName,
            actualInputPath
        ];

        const pythonCommands = ['python', 'python3', 'py'];
        let success = false;

        for (const pyCmd of pythonCommands) {
            const args = pyCmd === 'py' ? ['-3', ...baseArgs] : baseArgs;
            const result = spawnSync(pyCmd, args, { encoding: 'utf-8', windowsHide: true });

            if (result.status === 0) {
                // LVGLImage.py creates .bin file directly
                if (fs.existsSync(outputPath)) {
                    success = true;
                    break;
                }
            }
        }

        // Cleanup temp PNG
        if (tempPngPath && fs.existsSync(tempPngPath)) {
            try { fs.unlinkSync(tempPngPath); } catch { /* ignore */ }
        }

        if (!success) {
            console.warn(`Image bin conversion failed: ${inputPath}`);
        }
        return success;
    }

    /**
     * Convert image to PNG format using Pillow
     */
    private convertToPng(inputPath: string, outputPath: string): boolean {
        const script = `from PIL import Image; img = Image.open(r'${inputPath.replace(/'/g, "\\'")}'); img.convert('RGBA').save(r'${outputPath.replace(/'/g, "\\'")}', 'PNG')`;

        const pythonCommands = ['python', 'python3', 'py'];

        for (const pyCmd of pythonCommands) {
            const args = pyCmd === 'py' ? ['-3', '-c', script] : ['-c', script];
            const result = spawnSync(pyCmd, args, { encoding: 'utf-8', windowsHide: true });

            if (result.status === 0 && fs.existsSync(outputPath)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Parse LVGL bin file header to extract metadata
     *
     * LVGL v9 bin header format (12 bytes):
     * - byte 0: magic (0x19)
     * - byte 1: color format
     * - byte 2-3: flags (16 bits)
     * - byte 4-5: width (16 bits)
     * - byte 6-7: height (16 bits)
     * - byte 8-9: stride (16 bits)
     * - byte 10-11: reserved (16 bits)
     */
    private parseBinFile(
        binAbsPath: string,
        sourcePath: string,
        binRelPath: string
    ): BinImageInfo | null {
        try {
            const fd = fs.openSync(binAbsPath, 'r');
            const header = Buffer.alloc(LvglBinImageConverter.LVGL_BIN_HEADER_SIZE);
            fs.readSync(fd, header, 0, header.length, 0);
            fs.closeSync(fd);

            // Validate magic number
            const magic = header.readUInt8(0);
            if (magic !== LvglBinImageConverter.LVGL_BIN_MAGIC) {
                console.warn(`Invalid LVGL bin magic: ${magic.toString(16)} in ${binAbsPath}`);
                return null;
            }

            // Parse header fields
            const cfValue = header.readUInt8(1) & 0x1f;  // color format (lower 5 bits)
            const flags = header.readUInt16LE(2);
            const width = header.readUInt16LE(4);
            const height = header.readUInt16LE(6);
            const stride = header.readUInt16LE(8);

            // Get color format enum name
            const colorFormatName = this.cfValueToEnumName(cfValue);

            // Check if compressed (bit 0 of flags)
            const compressed = (flags & 0x01) !== 0;

            // Calculate data size
            const stat = fs.statSync(binAbsPath);
            const dataSize = stat.size - LvglBinImageConverter.LVGL_BIN_HEADER_SIZE;

            // Generate descriptor name and macro name
            const descriptorName = this.generateDescriptorName(sourcePath);
            const macroName = this.generateMacroName(sourcePath);

            return {
                sourcePath,
                binRelPath,
                binAbsPath,
                width,
                height,
                stride,
                colorFormat: colorFormatName,
                dataSize,
                headerSize: LvglBinImageConverter.LVGL_BIN_HEADER_SIZE,
                compressed,
                descriptorName,
                macroName,
            };
        } catch (err) {
            console.warn(`Failed to parse bin file: ${binAbsPath}`, err);
            return null;
        }
    }

    /**
     * Convert color format value to LVGL enum name
     */
    private cfValueToEnumName(cfValue: number): string {
        // Color format values from LVGLImage.py
        const cfNames: Record<number, string> = {
            0x00: 'LV_COLOR_FORMAT_UNKNOWN',
            0x01: 'LV_COLOR_FORMAT_RAW',
            0x02: 'LV_COLOR_FORMAT_RAW_ALPHA',
            0x06: 'LV_COLOR_FORMAT_L8',
            0x07: 'LV_COLOR_FORMAT_I1',
            0x08: 'LV_COLOR_FORMAT_I2',
            0x09: 'LV_COLOR_FORMAT_I4',
            0x0A: 'LV_COLOR_FORMAT_I8',
            0x0B: 'LV_COLOR_FORMAT_A1',
            0x0C: 'LV_COLOR_FORMAT_A2',
            0x0D: 'LV_COLOR_FORMAT_A4',
            0x0E: 'LV_COLOR_FORMAT_A8',
            0x0F: 'LV_COLOR_FORMAT_RGB888',
            0x10: 'LV_COLOR_FORMAT_ARGB8888',
            0x11: 'LV_COLOR_FORMAT_XRGB8888',
            0x12: 'LV_COLOR_FORMAT_RGB565',
            0x13: 'LV_COLOR_FORMAT_ARGB8565',
            0x14: 'LV_COLOR_FORMAT_RGB565A8',
            0x15: 'LV_COLOR_FORMAT_AL88',
            0x1A: 'LV_COLOR_FORMAT_ARGB8888_PREMULTIPLIED',
            0x1B: 'LV_COLOR_FORMAT_RGB565_SWAPPED',
        };

        return cfNames[cfValue] || `LV_COLOR_FORMAT_UNKNOWN`;
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
