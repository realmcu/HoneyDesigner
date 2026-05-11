/**
 * LVGL ROMFS packager
 * Packages binary image files into romfs.bin for external-bin deployment mode
 *
 * Uses mkromfs_for_honeygui.py to create the ROM filesystem and ui_resource.h
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { BinImageInfo } from './LvglBinImageConverter';

/**
 * Resource entry parsed from ui_resource.h
 */
export interface ResourceEntry {
    /** Macro name (e.g., "WEATHER_BG_BIN") */
    macroName: string;
    /** Offset from resource_root (hex string, e.g., "0x00000100") */
    offset: string;
}

/**
 * Result of packaging operation
 */
export interface PackageResult {
    /** Whether packaging was successful */
    success: boolean;
    /** Path to generated romfs.bin */
    romfsBinPath?: string;
    /** Path to generated ui_resource.h */
    uiResourceHeaderPath?: string;
    /** Resource entries parsed from ui_resource.h */
    resourceEntries?: ResourceEntry[];
    /** Error message if failed */
    error?: string;
}

/**
 * Default ROMFS base address
 */
const DEFAULT_ROMFS_BASE_ADDR = '0x704D1400';

/**
 * ROMFS packager for LVGL external binary mode
 */
export class LvglRomfsPackager {
    /**
     * Package bin files into romfs.bin and generate ui_resource.h
     *
     * @param rootDir       Directory containing bin files (build/root/)
     * @param outputDir     Directory for romfs.bin output (build/)
     * @param codeDir       Directory for ui_resource.h output (src/lvgl/)
     * @param baseAddr      ROMFS base address (hex string, e.g., "0x704D1400")
     * @param binImageInfos Bin image info list (for building resource map)
     */
    async package(
        rootDir: string,
        outputDir: string,
        codeDir: string,
        baseAddr: string,
        binImageInfos: BinImageInfo[]
    ): Promise<PackageResult> {
        // Check if rootDir exists and has files
        if (!fs.existsSync(rootDir)) {
            return {
                success: false,
                error: `Root directory does not exist: ${rootDir}`
            };
        }

        // Sync font glyph bitmap files to rootDir (for fonts using --extract-glyph-bitmap)
        this.syncFontBitmapFiles(codeDir, rootDir);

        // Check if there are any bin files to package (after font sync)
        const hasBinFiles = this.hasBinFiles(rootDir);
        if (!hasBinFiles) {
            console.log('[LvglRomfsPackager] No bin files found, skipping packaging');
            return {
                success: true,
                romfsBinPath: undefined,
                uiResourceHeaderPath: undefined,
                resourceEntries: []
            };
        }

        // Find mkromfs script
        const mkromfsScript = this.findMkromfsScript();
        if (!mkromfsScript) {
            return {
                success: false,
                error: 'mkromfs_for_honeygui.py not found'
            };
        }

        // Ensure output directories exist
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        if (!fs.existsSync(codeDir)) {
            fs.mkdirSync(codeDir, { recursive: true });
        }

        const romfsBinPath = path.join(outputDir, 'romfs.bin');
        const tempHeaderPath = path.join(outputDir, 'ui_resource.h');
        const finalHeaderPath = path.join(codeDir, 'ui_resource.h');

        // Build command
        // mkromfs_for_honeygui.py -i <rootDir> -o <output.bin> -a <baseAddr> -b
        const pythonCommands = ['python', 'python3', 'py'];
        let success = false;
        let errorMsg = '';

        for (const pyCmd of pythonCommands) {
            try {
                const args = this.buildCommandArgs(mkromfsScript, rootDir, romfsBinPath, baseAddr, pyCmd);
                const result = spawnSync(pyCmd, args, {
                    cwd: rootDir,
                    encoding: 'utf-8',
                    windowsHide: true,
                    timeout: 60000  // 60 second timeout
                });

                if (result.status === 0) {
                    // Check if romfs.bin was generated
                    if (fs.existsSync(romfsBinPath)) {
                        success = true;
                        break;
                    } else {
                        errorMsg = 'mkromfs completed but romfs.bin was not generated';
                    }
                } else {
                    errorMsg = result.stderr || result.stdout || `mkromfs exited with code ${result.status}`;
                }
            } catch (err) {
                errorMsg = `Failed to run mkromfs: ${err}`;
            }
        }

        if (!success) {
            return {
                success: false,
                error: errorMsg || 'Failed to run mkromfs'
            };
        }

        // Check if ui_resource.h was generated (in outputDir, same as romfs.bin)
        if (!fs.existsSync(tempHeaderPath)) {
            return {
                success: false,
                error: 'ui_resource.h was not generated by mkromfs'
            };
        }

        // Move ui_resource.h to codeDir
        if (tempHeaderPath !== finalHeaderPath) {
            fs.copyFileSync(tempHeaderPath, finalHeaderPath);
            console.log(`[LvglRomfsPackager] Copied ui_resource.h to ${finalHeaderPath}`);
        }

        // Parse ui_resource.h to extract resource entries
        const resourceEntries = this.parseUiResourceHeader(finalHeaderPath);

        // Build macro name -> offset map from binImageInfos and resourceEntries
        const resourceMap = this.buildResourceMap(binImageInfos, resourceEntries);

        console.log(`[LvglRomfsPackager] Packaged ${resourceEntries.length} resources into romfs.bin`);

        return {
            success: true,
            romfsBinPath,
            uiResourceHeaderPath: finalHeaderPath,
            resourceEntries
        };
    }

    /**
     * Check if there are any bin files in the root directory
     */
    private hasBinFiles(rootDir: string): boolean {
        const checkDir = (dir: string): boolean => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (checkDir(fullPath)) {
                        return true;
                    }
                } else if (entry.isFile() && entry.name.endsWith('.bin')) {
                    return true;
                }
            }
            return false;
        };
        return checkDir(rootDir);
    }

    /**
     * Find mkromfs_for_honeygui.py script
     * Priority: HoneyGUI/tool/mkromfs/ > tools/
     */
    private findMkromfsScript(): string | null {
        const candidates = [
            // Environment variable override
            process.env.HONEYGUI_MKROMFS_SCRIPT,
            // HoneyGUI submodule
            path.resolve(__dirname, '../../../../../HoneyGUI/tool/mkromfs/mkromfs_for_honeygui.py'),
            // Tools directory
            path.resolve(__dirname, '../../../../../tools/mkromfs_for_honeygui.py'),
            // Workspace root relative
            path.join(process.cwd(), 'HoneyGUI', 'tool', 'mkromfs', 'mkromfs_for_honeygui.py'),
            path.join(process.cwd(), 'tools', 'mkromfs_for_honeygui.py'),
        ].filter((c): c is string => !!c);

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    /**
     * Build command arguments for mkromfs
     */
    private buildCommandArgs(
        scriptPath: string,
        rootDir: string,
        outputPath: string,
        baseAddr: string,
        _pyCmd: string
    ): string[] {
        // Use absolute paths
        const absRootDir = path.resolve(rootDir);
        const absOutputPath = path.resolve(outputPath);

        return [
            scriptPath,
            '-i', absRootDir,
            '-o', absOutputPath,
            '-a', baseAddr,
            '-b'  // Binary output
        ];
    }

    /**
     * Parse ui_resource.h to extract macro name and offset mappings
     *
     * Example header format:
     * #if defined _HONEYGUI_SIMULATOR_
     * extern unsigned char *resource_root;
     * #define   WEATHER_BG_BIN                          (void *)(resource_root + 0x00000100)
     * #else
     * #define   WEATHER_BG_BIN                          (void *)(0x704D1500)
     * #endif
     */
    private parseUiResourceHeader(headerPath: string): ResourceEntry[] {
        const entries: ResourceEntry[] = [];

        try {
            const content = fs.readFileSync(headerPath, 'utf-8');
            const lines = content.split('\n');

            let inSimulatorBlock = false;
            for (const line of lines) {
                const trimmed = line.trim();

                // Track which block we're in
                if (trimmed.startsWith('#if defined _HONEYGUI_SIMULATOR_')) {
                    inSimulatorBlock = true;
                    continue;
                }
                if (trimmed === '#else') {
                    inSimulatorBlock = false;
                    continue;
                }
                if (trimmed === '#endif') {
                    inSimulatorBlock = false;
                    continue;
                }

                // Only parse defines from the simulator block (resource_root + offset)
                if (!inSimulatorBlock) {
                    continue;
                }

                // Parse #define lines
                const defineMatch = trimmed.match(/^#define\s+(\w+)\s+\(void\s*\*\)\(resource_root\s*\+\s*(0x[0-9a-fA-F]+)\)/);
                if (defineMatch) {
                    entries.push({
                        macroName: defineMatch[1],
                        offset: defineMatch[2]
                    });
                }
            }
        } catch (err) {
            console.warn(`[LvglRomfsPackager] Failed to parse ui_resource.h: ${err}`);
        }

        return entries;
    }

    /**
     * Build resource map by matching binImageInfos with parsed resourceEntries
     * This is used by LvglImgDscListGenerator to get the correct macro for each image
     */
    private buildResourceMap(
        binImageInfos: BinImageInfo[],
        resourceEntries: ResourceEntry[]
    ): Map<string, ResourceEntry> {
        const map = new Map<string, ResourceEntry>();

        for (const info of binImageInfos) {
            // Find matching entry by macro name
            const entry = resourceEntries.find(e => e.macroName === info.macroName);
            if (entry) {
                map.set(info.sourcePath, entry);
            }
        }

        return map;
    }

    /**
     * Get default ROMFS base address
     */
    static getDefaultBaseAddr(): string {
        return DEFAULT_ROMFS_BASE_ADDR;
    }

    /**
     * Sync font glyph bitmap files (*_glyph_bitmap.bin) from fonts dir to rootDir.
     * These are generated by lv_font_conv --extract-glyph-bitmap and need to be
     * packaged into romfs.bin alongside image bin files.
     */
    private syncFontBitmapFiles(codeDir: string, rootDir: string): void {
        const fontsDir = path.join(codeDir, 'fonts');
        if (!fs.existsSync(fontsDir)) {
            return;
        }

        const entries = fs.readdirSync(fontsDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('_glyph_bitmap.bin')) {
                const srcPath = path.join(fontsDir, entry.name);
                const dstPath = path.join(rootDir, entry.name);

                // Skip if already up-to-date
                if (fs.existsSync(dstPath)) {
                    const srcStat = fs.statSync(srcPath);
                    const dstStat = fs.statSync(dstPath);
                    if (dstStat.mtimeMs >= srcStat.mtimeMs) {
                        continue;
                    }
                }

                if (!fs.existsSync(rootDir)) {
                    fs.mkdirSync(rootDir, { recursive: true });
                }

                fs.copyFileSync(srcPath, dstPath);
                console.log(`[LvglRomfsPackager] Synced font bitmap: ${entry.name}`);
            }
        }
    }
}
