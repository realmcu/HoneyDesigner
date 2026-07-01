import * as fs from 'fs';
import * as path from 'path';
import { BitmapFontGenerator } from '../../tools/font-converter/src/bitmap-generator';
import { VectorFontGenerator } from '../../tools/font-converter/src/vector-generator';
import { FontConfig, CharacterSetSource } from '../../tools/font-converter/src/types/config';
import { RenderMode, Rotation, IndexMethod } from '../../tools/font-converter/src/types/enums';
import { CharsetProcessor } from '../../tools/font-converter/src/charset-processor';

export interface FontConvertResult {
    success: boolean;
    inputPath: string;
    outputPath: string;
    error?: string;
    processedCount?: number;
    failedCount?: number;
}

export interface CharacterSetItem {
    type: 'range' | 'file' | 'codepage' | 'string';
    value: string;
}

export interface FontConvertOptions {
    fontSize: number;
    renderMode: number;  // 1, 2, 4, 8
    outputFormat: 'bitmap' | 'vector';
    bold?: boolean;
    italic?: boolean;
    characterSets: CharacterSetItem[];  // 多个字符集源，取并集
    crop?: 'auto' | 'true' | 'false';   // 裁剪模式：自动/启用/禁用
}

export class FontConverterService {
    // 字符数阈值：超过此值使用 ADDRESS 模式（直接查表），否则使用 OFFSET 模式（紧凑索引）
    private static readonly INDEX_METHOD_THRESHOLD = 2048;

    constructor() {}

    /**
     * 根据字符数量自动选择最优的 index 和 crop 配置
     * 
     * 策略：
     * - crop 始终开启（节省像素数据空间）
     * - 字符数 > 2048：使用 ADDRESS 模式（65536 × 4B 索引，O(1) 查找）
     * - 字符数 ≤ 2048：使用 OFFSET 模式（N × 6B 索引，节省索引空间）
     */
    private getOptimalIndexConfig(charCount: number): { crop: boolean; indexMethod: IndexMethod } {
        if (charCount > FontConverterService.INDEX_METHOD_THRESHOLD) {
            return { crop: true, indexMethod: IndexMethod.ADDRESS };
        } else {
            return { crop: true, indexMethod: IndexMethod.OFFSET };
        }
    }

    /**
     * 预估字符集中的字符数量
     */
    private estimateCharCount(characterSets: CharacterSetSource[], basePath: string): number {
        try {
            const chars = CharsetProcessor.mergeCharacterSources(characterSets, basePath);
            return chars.length;
        } catch {
            return 1000;
        }
    }

    /**
     * 转换单个字体文件
     */
    async convert(inputPath: string, outputDir: string, options: FontConvertOptions): Promise<FontConvertResult> {
        try {
            // 确保输出目录存在
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            // 构建字符集
            const characterSets: CharacterSetSource[] = options.characterSets
                .filter(item => typeof item.value === 'string' && item.value.trim().length > 0)
                .map(item => ({
                    type: item.type,
                    value: item.value.trim()
                }));

            // 如果没有字符集，默认使用 ASCII
            if (characterSets.length === 0) {
                characterSets.push({ type: 'range', value: '0x20-0x7E' });
            }

            // 预估字符数量，决定 crop 和 indexMethod
            const basePath = path.dirname(inputPath);
            const charCount = this.estimateCharCount(characterSets, basePath);
            
            // 根据 crop 选项决定配置
            let crop: boolean;
            let indexMethod: IndexMethod;
            
            if (options.crop === 'true') {
                crop = true;
                indexMethod = IndexMethod.ADDRESS;
            } else if (options.crop === 'false') {
                crop = false;
                indexMethod = IndexMethod.OFFSET;
            } else {
                // 自动模式：根据字符数量选择
                const autoConfig = this.getOptimalIndexConfig(charCount);
                crop = autoConfig.crop;
                indexMethod = autoConfig.indexMethod;
            }

            // 构建配置
            const config: FontConfig = {
                fontPath: inputPath,
                outputPath: outputDir,
                fontSize: options.fontSize,
                renderMode: this.parseRenderMode(options.renderMode),
                bold: options.bold || false,
                italic: options.italic || false,
                rotation: Rotation.ROTATE_0,
                gamma: 1.0,
                indexMethod,
                crop,
                characterSets,
                outputFormat: options.outputFormat
            };

            // 创建生成器并执行
            const generator = options.outputFormat === 'vector'
                ? new VectorFontGenerator(config)
                : new BitmapFontGenerator(config);

            await generator.generate();

            const processed = generator.getProcessedCharacters();
            const failed = generator.getFailedCharacters();

            generator.cleanup();

            return {
                success: true,
                inputPath,
                outputPath: outputDir,
                processedCount: processed.length,
                failedCount: failed.length
            };
        } catch (error: any) {
            return {
                success: false,
                inputPath,
                outputPath: outputDir,
                error: error.message
            };
        }
    }

    /**
     * 解析渲染模式
     */
    private parseRenderMode(mode: number): RenderMode {
        switch (mode) {
            case 1: return RenderMode.BIT_1;
            case 2: return RenderMode.BIT_2;
            case 4: return RenderMode.BIT_4;
            case 8: return RenderMode.BIT_8;
            default: return RenderMode.BIT_4;
        }
    }

    /**
     * 批量转换
     */
    async convertBatch(items: Array<{ input: string; outputDir: string; options: FontConvertOptions }>): Promise<FontConvertResult[]> {
        return Promise.all(items.map(item => this.convert(item.input, item.outputDir, item.options)));
    }
}
