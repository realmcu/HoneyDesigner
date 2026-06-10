import * as fs from 'fs';
import { logger } from './Logger';

/**
 * 解析 TTF/OTF 字体文件的 cmap 表，返回支持的字符码点集合
 */
export function parseFontCmap(fontPath: string): Set<number> {
    const supportedChars = new Set<number>();

    try {
        const buffer = fs.readFileSync(fontPath);

        const sfntVersion = buffer.readUInt32BE(0);
        // 0x00010000 = TrueType, 0x4F54544F = 'OTTO' (OpenType with CFF)
        if (sfntVersion !== 0x00010000 && sfntVersion !== 0x4F54544F) {
            logger.warn(`[字形检测] 不支持的字体格式: ${sfntVersion.toString(16)}`);
            return supportedChars;
        }

        const numTables = buffer.readUInt16BE(4);

        let cmapOffset = 0;
        for (let i = 0; i < numTables; i++) {
            const tableOffset = 12 + i * 16;
            const tag = buffer.toString('ascii', tableOffset, tableOffset + 4);
            if (tag === 'cmap') {
                cmapOffset = buffer.readUInt32BE(tableOffset + 8);
                break;
            }
        }

        if (cmapOffset === 0) {
            logger.warn(`[字形检测] 未找到 cmap 表`);
            return supportedChars;
        }

        const numSubtables = buffer.readUInt16BE(cmapOffset + 2);

        let bestSubtableOffset = 0;
        let bestPriority = -1;

        for (let i = 0; i < numSubtables; i++) {
            const subtableOffset = cmapOffset + 4 + i * 8;
            const platformID = buffer.readUInt16BE(subtableOffset);
            const encodingID = buffer.readUInt16BE(subtableOffset + 2);
            const offset = buffer.readUInt32BE(subtableOffset + 4);

            // 优先级：Unicode Full (0,4) > Unicode BMP (0,3) > Windows Unicode Full (3,10) > Windows Unicode BMP (3,1)
            let priority = -1;
            if (platformID === 0 && encodingID === 4) { priority = 4; }
            else if (platformID === 0 && encodingID === 3) { priority = 3; }
            else if (platformID === 3 && encodingID === 10) { priority = 2; }
            else if (platformID === 3 && encodingID === 1) { priority = 1; }

            if (priority > bestPriority) {
                bestPriority = priority;
                bestSubtableOffset = cmapOffset + offset;
            }
        }

        if (bestSubtableOffset === 0) {
            logger.warn(`[字形检测] 未找到合适的 cmap 子表`);
            return supportedChars;
        }

        const format = buffer.readUInt16BE(bestSubtableOffset);

        if (format === 4) {
            parseCmapFormat4(buffer, bestSubtableOffset, supportedChars);
        } else if (format === 12) {
            parseCmapFormat12(buffer, bestSubtableOffset, supportedChars);
        } else {
            logger.warn(`[字形检测] 不支持的 cmap 格式: ${format}`);
        }

    } catch (error) {
        logger.error(`[字形检测] 解析字体文件失败: ${error}`);
    }

    return supportedChars;
}

function parseCmapFormat4(buffer: Buffer, offset: number, supportedChars: Set<number>): void {
    const segCountX2 = buffer.readUInt16BE(offset + 6);
    const segCount = segCountX2 / 2;

    const endCodeOffset = offset + 14;
    const startCodeOffset = endCodeOffset + segCountX2 + 2;
    const idDeltaOffset = startCodeOffset + segCountX2;
    const idRangeOffsetOffset = idDeltaOffset + segCountX2;

    for (let i = 0; i < segCount; i++) {
        const endCode = buffer.readUInt16BE(endCodeOffset + i * 2);
        const startCode = buffer.readUInt16BE(startCodeOffset + i * 2);
        const idDelta = buffer.readInt16BE(idDeltaOffset + i * 2);
        const idRangeOffset = buffer.readUInt16BE(idRangeOffsetOffset + i * 2);

        if (startCode === 0xFFFF) { break; }

        for (let charCode = startCode; charCode <= endCode; charCode++) {
            let glyphIndex: number;

            if (idRangeOffset === 0) {
                glyphIndex = (charCode + idDelta) & 0xFFFF;
            } else {
                const glyphIndexOffset = idRangeOffsetOffset + i * 2 + idRangeOffset + (charCode - startCode) * 2;
                if (glyphIndexOffset + 2 > buffer.length) { continue; }
                glyphIndex = buffer.readUInt16BE(glyphIndexOffset);
                if (glyphIndex !== 0) {
                    glyphIndex = (glyphIndex + idDelta) & 0xFFFF;
                }
            }

            if (glyphIndex !== 0) {
                supportedChars.add(charCode);
            }
        }
    }
}

function parseCmapFormat12(buffer: Buffer, offset: number, supportedChars: Set<number>): void {
    const numGroups = buffer.readUInt32BE(offset + 12);

    for (let i = 0; i < numGroups; i++) {
        const groupOffset = offset + 16 + i * 12;
        const startCharCode = buffer.readUInt32BE(groupOffset);
        const endCharCode = buffer.readUInt32BE(groupOffset + 4);
        const startGlyphID = buffer.readUInt32BE(groupOffset + 8);

        for (let charCode = startCharCode; charCode <= endCharCode; charCode++) {
            const glyphID = startGlyphID + (charCode - startCharCode);
            if (glyphID !== 0) {
                supportedChars.add(charCode);
            }
        }
    }
}
