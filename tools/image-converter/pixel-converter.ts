/**
 * Pixel Format Converter
 */

import { PixelFormat } from './types';

interface RGBA {
    r: number;
    g: number;
    b: number;
    a: number;
}

/**
 * 计算 A4/A2/A1 格式每行需要的字节数（向上取整到整字节）
 * @param width 图像宽度（像素数）
 * @param bitsPerPixel 每像素位数 (4, 2, 1)
 * @returns 每行字节数
 */
function calcRowBytes(width: number, bitsPerPixel: number): number {
    const totalBits = width * bitsPerPixel;
    return Math.ceil(totalBits / 8);
}

/**
 * 计算 A4/A2/A1 格式每行需要补齐到的像素数（使每行为整字节）
 * A4: 2个像素/字节，补齐到偶数
 * A2: 4个像素/字节，补齐到4的倍数
 * A1: 8个像素/字节，补齐到8的倍数
 * @param width 原始宽度
 * @param bitsPerPixel 每像素位数
 * @returns 补齐后的宽度
 */
function calcPaddedWidth(width: number, bitsPerPixel: number): number {
    const pixelsPerByte = 8 / bitsPerPixel;
    return Math.ceil(width / pixelsPerByte) * pixelsPerByte;
}

function rgbToRgb565(r: number, g: number, b: number): number {
    return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

export interface ConvertOptions {
    dither?: boolean;
}

function clamp(v: number): number {
    return Math.max(0, Math.min(255, Math.round(v)));
}

function floydSteinbergDither(pixels: RGBA[], width: number): RGBA[] {
    const height = Math.ceil(pixels.length / width);
    // Create a copy to avoid modifying the original array
    const dithered = pixels.map(p => ({ ...p }));

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (idx >= dithered.length) break;

            const p = dithered[idx];
            
            // Calculate quantization error for RGB565
            // RGB565: R=5bits, G=6bits, B=5bits
            
            // Quantized values (simulating what happens in rgbToRgb565)
            const oldR = p.r;
            const oldG = p.g;
            const oldB = p.b;
            
            const newR = (oldR >> 3) << 3;
            const newG = (oldG >> 2) << 2;
            const newB = (oldB >> 3) << 3;
            
            // We update the current pixel to the quantized value?
            // Actually, convertPixels will do the quantization (truncation).
            // But for error diffusion, we need to know the error between "what we have" and "what we will get".
            // So yes, the error is old - new.
            
            const errR = oldR - newR;
            const errG = oldG - newG;
            const errB = oldB - newB;

            // Distribute error to neighbors
            // Right
            if (x + 1 < width) {
                const nid = idx + 1;
                if (nid < dithered.length) {
                    dithered[nid].r = clamp(dithered[nid].r + errR * 7 / 16);
                    dithered[nid].g = clamp(dithered[nid].g + errG * 7 / 16);
                    dithered[nid].b = clamp(dithered[nid].b + errB * 7 / 16);
                }
            }
            
            // Bottom Left
            if (x - 1 >= 0 && y + 1 < height) {
                const nid = idx + width - 1;
                if (nid < dithered.length) {
                    dithered[nid].r = clamp(dithered[nid].r + errR * 3 / 16);
                    dithered[nid].g = clamp(dithered[nid].g + errG * 3 / 16);
                    dithered[nid].b = clamp(dithered[nid].b + errB * 3 / 16);
                }
            }
            
            // Bottom
            if (y + 1 < height) {
                const nid = idx + width;
                if (nid < dithered.length) {
                    dithered[nid].r = clamp(dithered[nid].r + errR * 5 / 16);
                    dithered[nid].g = clamp(dithered[nid].g + errG * 5 / 16);
                    dithered[nid].b = clamp(dithered[nid].b + errB * 5 / 16);
                }
            }
            
            // Bottom Right
            if (x + 1 < width && y + 1 < height) {
                const nid = idx + width + 1;
                if (nid < dithered.length) {
                    dithered[nid].r = clamp(dithered[nid].r + errR * 1 / 16);
                    dithered[nid].g = clamp(dithered[nid].g + errG * 1 / 16);
                    dithered[nid].b = clamp(dithered[nid].b + errB * 1 / 16);
                }
            }
        }
    }
    return dithered;
}

/**
 * 对不带 Alpha 通道的目标格式，将半透明像素与黑色背景混合
 * 公式: outColor = srcColor * alpha / 255
 */
function premultiplyAlphaBlack(pixels: RGBA[]): RGBA[] {
    return pixels.map(p => {
        if (p.a === 0xFF) {
            return p; // 完全不透明，无需处理
        }
        const alpha = p.a / 255;
        return {
            r: clamp(p.r * alpha),
            g: clamp(p.g * alpha),
            b: clamp(p.b * alpha),
            a: 0xFF
        };
    });
}

export function convertPixels(pixels: RGBA[], width: number, format: PixelFormat, options?: ConvertOptions): Buffer {
    // 对不带 Alpha 的格式（RGB565, RGB888），先做透明度预混合（与黑色背景混合）
    const isOpaqueFormat = (format === PixelFormat.RGB565 || format === PixelFormat.RGB888);
    let processedPixels = isOpaqueFormat ? premultiplyAlphaBlack(pixels) : pixels;

    // Apply dithering if enabled and target format is 16-bit
    if (options?.dither && (format === PixelFormat.RGB565 || format === PixelFormat.ARGB8565)) {
        processedPixels = floydSteinbergDither(processedPixels, width);
    }

    // 逐像素写入一块预分配的缓冲区（每像素单独分配 Buffer 再拼接，大图要慢一个数量级）
    const count = processedPixels.length;
    switch (format) {
        case PixelFormat.RGB565: {
            const out = Buffer.alloc(count * 2);
            for (let i = 0; i < count; i++) {
                const { r, g, b } = processedPixels[i];
                out.writeUInt16LE(rgbToRgb565(r, g, b), i * 2);
            }
            return out;
        }

        case PixelFormat.RGB888: {
            const out = Buffer.alloc(count * 3);
            for (let i = 0, o = 0; i < count; i++) {
                const { r, g, b } = processedPixels[i];
                out[o++] = b;  // BGR order
                out[o++] = g;
                out[o++] = r;
            }
            return out;
        }

        case PixelFormat.ARGB8888: {
            const out = Buffer.alloc(count * 4);
            for (let i = 0, o = 0; i < count; i++) {
                const { r, g, b, a } = processedPixels[i];
                out[o++] = b;  // BGRA order
                out[o++] = g;
                out[o++] = r;
                out[o++] = a;
            }
            return out;
        }

        case PixelFormat.ARGB8565: {
            const out = Buffer.alloc(count * 3);
            for (let i = 0; i < count; i++) {
                const { r, g, b, a } = processedPixels[i];
                out.writeUInt16LE(rgbToRgb565(r, g, b), i * 3);  // RGB565 first
                out[i * 3 + 2] = a;  // Alpha last
            }
            return out;
        }

        case PixelFormat.A8: {
            const out = Buffer.alloc(count);
            for (let i = 0; i < count; i++) {
                out[i] = processedPixels[i].a;
            }
            return out;
        }

        case PixelFormat.A4:
            // A4: 4 bits per pixel, 2 pixels per byte
            // 每行需要补齐到整字节（2像素的倍数）
            return convertToSubByteAlpha(processedPixels, width, 4);

        case PixelFormat.A2:
            // A2: 2 bits per pixel, 4 pixels per byte
            // 每行需要补齐到整字节（4像素的倍数）
            return convertToSubByteAlpha(processedPixels, width, 2);

        case PixelFormat.A1:
            // A1: 1 bit per pixel, 8 pixels per byte
            // 每行需要补齐到整字节（8像素的倍数）
            return convertToSubByteAlpha(processedPixels, width, 1);

        default:
            throw new Error(`Unsupported format: ${format}`);
    }
}

/**
 * 将像素数据转换为子字节 Alpha 格式 (A4/A2/A1)
 * 每行独立处理，补齐到整字节边界
 * @param pixels 像素数组
 * @param width 图像宽度
 * @param bitsPerPixel 每像素位数 (4, 2, 1)
 * @returns 转换后的 Buffer
 */
function convertToSubByteAlpha(pixels: RGBA[], width: number, bitsPerPixel: number): Buffer {
    const height = Math.ceil(pixels.length / width);
    const pixelsPerByte = 8 / bitsPerPixel;
    const paddedWidth = calcPaddedWidth(width, bitsPerPixel);
    const bytesPerRow = paddedWidth / pixelsPerByte;
    const maxValue = (1 << bitsPerPixel) - 1;  // A4=15, A2=3, A1=1
    
    const result: number[] = [];
    
    for (let y = 0; y < height; y++) {
        const rowStart = y * width;
        
        for (let byteIdx = 0; byteIdx < bytesPerRow; byteIdx++) {
            let byteValue = 0;
            
            for (let pixelInByte = 0; pixelInByte < pixelsPerByte; pixelInByte++) {
                const x = byteIdx * pixelsPerByte + pixelInByte;
                const pixelIdx = rowStart + x;
                
                // 获取 alpha 值，超出宽度的像素用 0 填充
                let alpha = 0;
                if (x < width && pixelIdx < pixels.length) {
                    // 将 8 位 alpha 量化到目标位数
                    alpha = Math.round(pixels[pixelIdx].a * maxValue / 255);
                }
                
                // 将 alpha 值打包到字节中（低位在前）
                // 例如 A4: 第一个像素在低4位(bit0-3)，第二个像素在高4位(bit4-7)
                // A2: 第一个像素在bit0-1，第二个在bit2-3，第三个在bit4-5，第四个在bit6-7
                // A1: 第一个像素在bit0，第二个在bit1，...，第八个在bit7
                const shift = pixelInByte * bitsPerPixel;
                byteValue |= (alpha << shift);
            }
            
            result.push(byteValue);
        }
    }
    
    return Buffer.from(result);
}
