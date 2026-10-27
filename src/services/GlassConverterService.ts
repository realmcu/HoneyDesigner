import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { GlassGenerator } from '../../tools/glass-generator/generator';
import { GlassConfig } from '../../tools/glass-generator/types';

export interface GlassConvertResult {
    success: boolean;
    inputPath: string;
    outputPath: string;
    error?: string;
    width?: number;
    height?: number;
}

export interface GlassPreviewResult {
    success: boolean;
    base64?: string;
    width?: number;
    height?: number;
    error?: string;
}

export interface GlassConvertOptions {
    blurRadius: number;      // 效果区域 (0-100%)
    blurIntensity: number;   // 效果强度 (0-100%)
    width?: number;          // 输出宽度
    height?: number;         // 输出高度
    distortion?: number;     // 扭曲强度 (0-1)
    region?: number;         // 效果区域 (0-1)
}

export class GlassConverterService {
    private bgImagePath: string;

    constructor() {
        // __dirname 在编译后指向 out/src/services/，需要向上三级到达插件根目录
        this.bgImagePath = path.join(__dirname, '../../../tools/glass-generator/bg.png');
    }

    /**
     * 转换单个 SVG 文件为玻璃效果
     */
    async convert(inputPath: string, outputPath: string, options: GlassConvertOptions): Promise<GlassConvertResult> {
        try {
            const config: Partial<GlassConfig> = {
                blurRadius: options.blurRadius || 50,
                blurIntensity: options.blurIntensity || 50,
                width: options.width,
                height: options.height,
                distortion: options.distortion || 0.05,
                region: options.region || 1.0
            };

            const generator = new GlassGenerator(config);
            const result = await generator.generateFromFile(inputPath, outputPath);

            return {
                success: true,
                inputPath,
                outputPath,
                width: result.width,
                height: result.height
            };
        } catch (error: any) {
            return {
                success: false,
                inputPath,
                outputPath,
                error: error.message
            };
        }
    }

    /**
     * 生成预览图片（将玻璃效果渲染到背景图上）
     */
    async generatePreview(svgData: Buffer, options: GlassConvertOptions): Promise<GlassPreviewResult> {
        try {
            // 创建临时文件
            const tempDir = require('os').tmpdir();
            const tempSvgPath = path.join(tempDir, `glass_preview_${Date.now()}.svg`);
            
            // 写入 SVG 数据
            fs.writeFileSync(tempSvgPath, svgData);

            const config: Partial<GlassConfig> = {
                distortion: (options.blurIntensity || 50) / 500,  // 转换为 0-0.2 范围
                region: (options.blurRadius || 50) / 100          // 转换为 0-1 范围
            };

            const generator = new GlassGenerator(config);
            
            // 检查背景图片是否存在
            if (!fs.existsSync(this.bgImagePath)) {
                throw new Error(vscode.l10n.t('Background image does not exist: {0}', this.bgImagePath));
            }

            // 生成预览
            const preview = await generator.generatePreview(tempSvgPath, this.bgImagePath);

            // 清理临时文件
            try { fs.unlinkSync(tempSvgPath); } catch {}

            return {
                success: true,
                base64: preview.base64,
                width: preview.width,
                height: preview.height
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 批量转换
     */
    async convertBatch(items: Array<{ input: string; output: string; options: GlassConvertOptions }>): Promise<GlassConvertResult[]> {
        return Promise.all(items.map(item => this.convert(item.input, item.output, item.options)));
    }
}
