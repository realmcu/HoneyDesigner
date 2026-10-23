/**
 * RLE (Run-Length Encoding) Compression
 * 
 * RLE 节点格式:
 * - RGB565:    [len:1] [pixel:2]
 * - ARGB8565:  [len:1] [pixel:2] [alpha:1]
 * - RGB888:    [len:1] [b:1] [g:1] [r:1]
 * - ARGB8888:  [len:1] [pixel:4]
 * - A8/A4/A2/A1: [len:1] [byte:1]  (子字节格式按字节压缩)
 */

import { CompressionAlgorithm, CompressionResult } from './base';

const COMPRESS_RLE = 0;

export class RLECompression implements CompressionAlgorithm {
  private runLength1: number;
  private runLength2: number;
  private level: number;
  private minRun: number;

  constructor(runLength1: number = 1, runLength2: number = 0, level: number = 1) {
    this.runLength1 = runLength1 & 0x03;
    this.runLength2 = runLength2 & 0x03;
    this.level = level;
    this.minRun = this.runLength1 + 1;
  }

  compress(
    pixelData: Buffer,
    width: number,
    height: number,
    pixelBytes: number,
    bytesPerLine?: number
  ): CompressionResult {
    const lineOffsets: number[] = [];
    // 使用提供的 bytesPerLine，否则按传统方式计算
    const actualBytesPerLine = bytesPerLine ?? (width * pixelBytes);
    // 最坏情况每个像素一个节点（1 字节长度 + 像素），结果不会超过这个大小
    const output = Buffer.alloc(height * Math.ceil(actualBytesPerLine / pixelBytes) * (pixelBytes + 1));
    let length = 0;

    for (let line = 0; line < height; line++) {
      const lineStart = line * actualBytesPerLine;
      const lineEnd = Math.min(lineStart + actualBytesPerLine, pixelData.length);

      // Record offset for this line
      lineOffsets.push(length);

      // Compress line
      length = this.compressLine(pixelData, lineStart, Math.max(lineStart, lineEnd), pixelBytes, output, length);
    }

    return {
      compressedData: output.subarray(0, length),
      lineOffsets,
      params: {
        feature_1: this.runLength1,
        feature_2: this.runLength2,
      },
    };
  }

  /**
   * 压缩 data[start, end) 一行，写入 output[offset...]，返回写入后的偏移。
   * 行尾不足一个像素的字节按一个（较短的）像素处理，与逐像素截取子数组的结果一致。
   */
  private compressLine(data: Buffer, start: number, end: number, pixelBytes: number, output: Buffer, offset: number): number {
    let i = start;

    while (i < end) {
      const pixelEnd = Math.min(i + pixelBytes, end);
      const size = pixelEnd - i;

      // Find consecutive repeated pixels
      let runLength = 1;
      let j = i + pixelBytes;
      while (j < end && runLength < 255 && Math.min(j + pixelBytes, end) - j === size && samePixel(data, i, j, size)) {
        runLength++;
        j += pixelBytes;
      }

      // Write RLE node: [len] [pixel_data]
      output[offset++] = runLength;
      for (let k = i; k < pixelEnd; k++) {
        output[offset++] = data[k];
      }

      i = j;
    }

    return offset;
  }

  getAlgorithmType(): number {
    return COMPRESS_RLE;
  }
}

function samePixel(data: Buffer, a: number, b: number, size: number): boolean {
  for (let k = 0; k < size; k++) {
    if (data[a + k] !== data[b + k]) {
      return false;
    }
  }
  return true;
}
