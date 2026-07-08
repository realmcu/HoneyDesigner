import * as fs from 'fs';
import { PNG } from 'pngjs';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * 判断图片数据是否包含「实际的」透明度。
 *
 * 不只看 PNG 的 color type(那只能说明格式支不支持 alpha 通道),而是进一步
 * 解码像素、扫描真实的 alpha 字节,以识破「全不透明 RGBA」——即带了 alpha
 * 通道但每个像素 alpha 都是 255 的图。这类图很常见(Photoshop / Figma / 截图
 * 工具默认吐 RGBA),若只按 color type 判断会误判为有透明度,从而选到更重的
 * 带 alpha 格式(adaptive16→ARGB8565、adaptive24→ARGB8888),白白多占 33~50%。
 *
 * 语义约定(与历史三处保持一致,不扩大范围):
 * - 只有 PNG 才可能带 alpha;非 PNG 一律 false。
 * - 只认 color type 4(灰度+alpha)/ 6(RGBA);palette+tRNS 不在此判断内。
 * - PNG 解码失败时保守返回 true(宁可格式偏大,也不能丢掉真实存在的透明度)。
 */
export function bufferHasAlpha(data: Buffer): boolean {
    // 通过 PNG 签名判断是不是 PNG(比看扩展名更可靠);非 PNG 当作无 alpha
    if (data.length < 26) {
        return false;
    }
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
        if (data[i] !== PNG_SIGNATURE[i]) {
            return false;
        }
    }

    // IHDR 的 color type 在偏移 25 处:只有 4 和 6 带 alpha 通道,其余必然无透明度
    const colorType = data[25];
    if (colorType !== 4 && colorType !== 6) {
        return false;
    }

    // color type 支持 alpha,进一步解码采样真实 alpha 值,识破「全不透明 RGBA」
    try {
        // pngjs 会把任意 color type 统一展开成 8-bit RGBA(每像素 4 字节)
        const png = PNG.sync.read(data);
        const pixels = png.data;
        for (let i = 3; i < pixels.length; i += 4) {
            if (pixels[i] < 255) {
                return true; // 发现第一个非全不透明像素,确有透明度,提前返回
            }
        }
        return false; // 所有像素 alpha 都是 255,是「全不透明 RGBA」,视为无透明度
    } catch {
        // 解码失败(如 pngjs 不支持的 interlace / 16-bit 变体),保守认为有透明度
        return true;
    }
}

/**
 * bufferHasAlpha 的文件路径版本:读取文件后判断。
 * 文件读不到时保守返回 false(与历史行为一致,视为无透明度)。
 */
export function imageFileHasAlpha(imagePath: string): boolean {
    try {
        return bufferHasAlpha(fs.readFileSync(imagePath));
    } catch {
        return false;
    }
}
