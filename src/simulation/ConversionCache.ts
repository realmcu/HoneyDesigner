import * as fs from 'fs';

/**
 * 资源转换结果缓存：输出文件仍存在且输入指纹未变时跳过转换。
 *
 * 浏览器版快速预览在每次保存后都会重新准备资源，图片和字体若每次全量转换，
 * 大工程要数秒。指纹由调用方给出（输入文件大小 + 修改时间 + 转换参数），
 * 只在一次会话内有效；桌面版不使用，每次都完整转换。
 */
export class ConversionCache {
    private readonly keys = new Map<string, string>();

    isFresh(outputPath: string, key: string): boolean {
        return this.keys.get(outputPath) === key && fs.existsSync(outputPath);
    }

    remember(outputPath: string, key: string): void {
        this.keys.set(outputPath, key);
    }

    clear(): void {
        this.keys.clear();
    }

    /** 输入文件的指纹部分：大小 + 修改时间（文件不存在时返回 undefined，调用方不缓存） */
    static fileKey(filePath: string): string | undefined {
        try {
            const stat = fs.statSync(filePath);
            return `${stat.size}:${stat.mtimeMs}`;
        } catch {
            return undefined;
        }
    }
}
