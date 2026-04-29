import { useState, useEffect } from 'react';
import { getFontUri } from './useFontLoader';

/**
 * 字体排版 metrics（来自 OS/2 表的 typo 字段）
 *
 * 用于计算默认行高，对齐 Figma / HoneyGUI V3 的排版模型。
 * 浏览器 line-height: normal 使用的是 Win metrics（usWinAscent/usWinDescent），
 * 对 CJK 字体来说值偏大。Figma 和 V3 使用的是 typo metrics，所以我们直接解析字体文件。
 */
export interface FontTypoMetrics {
  unitsPerEm: number;
  typoAscender: number;
  typoDescender: number;  // 负值
  typoLineGap: number;
  // hhea 表的值（用于对比）
  hheaAscender?: number;
  hheaDescender?: number;
  hheaLineGap?: number;
  // OS/2 Win metrics（浏览器使用的）
  winAscent?: number;
  winDescent?: number;
}

// 全局缓存：fontPath -> metrics
const metricsCache = new Map<string, FontTypoMetrics | null>();

/**
 * 从 OpenType/TrueType 字体的 ArrayBuffer 中解析 typo metrics。
 *
 * 解析 head 表（unitsPerEm）和 OS/2 表（sTypoAscender, sTypoDescender, sTypoLineGap）。
 */
function parseFontMetrics(buffer: ArrayBuffer): FontTypoMetrics | null {
  const view = new DataView(buffer);

  if (buffer.byteLength < 12) { return null; }

  const sfVersion = view.getUint32(0);
  const isTTC = sfVersion === 0x74746366;

  let tableOffset = 12;
  let numTables = view.getUint16(4);

  if (isTTC) {
    // TTC: read first font's offset
    if (buffer.byteLength < 16) { return null; }
    const firstFontOffset = view.getUint32(12);
    numTables = view.getUint16(firstFontOffset + 4);
    tableOffset = firstFontOffset + 12;
  }

  // 查找 head、OS/2 和 hhea 表
  let headOffset = -1;
  let os2Offset = -1;
  let hheaOffset = -1;

  for (let i = 0; i < numTables; i++) {
    const entryOffset = tableOffset + i * 16;
    if (entryOffset + 16 > buffer.byteLength) { break; }

    const tag = String.fromCharCode(
      view.getUint8(entryOffset),
      view.getUint8(entryOffset + 1),
      view.getUint8(entryOffset + 2),
      view.getUint8(entryOffset + 3)
    );

    const offset = view.getUint32(entryOffset + 8);

    if (tag === 'head') { headOffset = offset; }
    if (tag === 'OS/2') { os2Offset = offset; }
    if (tag === 'hhea') { hheaOffset = offset; }
  }

  if (headOffset < 0 || os2Offset < 0) { return null; }

  // head 表：unitsPerEm 在偏移 18 处（uint16）
  if (headOffset + 20 > buffer.byteLength) { return null; }
  const unitsPerEm = view.getUint16(headOffset + 18);

  // OS/2 表：sTypoAscender(int16) @68, sTypoDescender(int16) @70, sTypoLineGap(int16) @72
  // usWinAscent(uint16) @74, usWinDescent(uint16) @76
  if (os2Offset + 78 > buffer.byteLength) { return null; }
  const typoAscender = view.getInt16(os2Offset + 68);
  const typoDescender = view.getInt16(os2Offset + 70);
  const typoLineGap = view.getInt16(os2Offset + 72);
  const winAscent = view.getUint16(os2Offset + 74);
  const winDescent = view.getUint16(os2Offset + 76);

  // hhea 表：ascender(int16) @4, descender(int16) @6, lineGap(int16) @8
  let hheaAscender: number | undefined;
  let hheaDescender: number | undefined;
  let hheaLineGap: number | undefined;
  if (hheaOffset >= 0 && hheaOffset + 10 <= buffer.byteLength) {
    hheaAscender = view.getInt16(hheaOffset + 4);
    hheaDescender = view.getInt16(hheaOffset + 6);
    hheaLineGap = view.getInt16(hheaOffset + 8);
  }

  if (unitsPerEm === 0) { return null; }

  return { unitsPerEm, typoAscender, typoDescender, typoLineGap, hheaAscender, hheaDescender, hheaLineGap, winAscent, winDescent };
}

/**
 * 根据字体 metrics 计算默认行高（像素），对齐 Figma / V3。
 *
 * 使用 hhea 表的 ascender/descender/lineGap（和 opentype.js / font-tool / V3 一致）。
 * 公式：round((hheaAscender - hheaDescender + hheaLineGap) * fontSize / unitsPerEm)
 *
 * 注意：不使用 OS/2 的 sTypoAscender/sTypoDescender（CJK 字体值偏小），
 * 也不使用 OS/2 的 usWinAscent/usWinDescent（浏览器用的，CJK 字体值偏大）。
 */
export function calcTypoLineHeight(metrics: FontTypoMetrics, fontSize: number): number {
  const { unitsPerEm } = metrics;
  // 优先使用 hhea 表（和 V3 / Figma 一致）
  const asc = metrics.hheaAscender ?? metrics.typoAscender;
  const desc = metrics.hheaDescender ?? metrics.typoDescender;
  const gap = metrics.hheaLineGap ?? metrics.typoLineGap;
  return Math.round((asc - desc + gap) * fontSize / unitsPerEm);
}

/**
 * 从字体 URL fetch 并解析 metrics
 */
async function fetchAndParseMetrics(fontPath: string, url: string): Promise<FontTypoMetrics | null> {
  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const metrics = parseFontMetrics(buffer);
    metricsCache.set(fontPath, metrics);
    return metrics;
  } catch (e) {
    console.warn('[useFontMetrics] 解析字体 metrics 失败:', fontPath, e);
    metricsCache.set(fontPath, null);
    return null;
  }
}

/**
 * Hook：获取字体的 typo metrics 行高。
 *
 * 从字体文件的 OS/2 表解析 sTypoAscender/sTypoDescender/sTypoLineGap，
 * 计算行高，对齐 Figma 和 HoneyGUI V3。
 *
 * @param fontPath 字体文件路径（如 /NotoSansSC_Regular.ttf）
 * @param fontFamily 已加载的字体族名（用于判断字体是否已加载）
 * @param fontSize 字号
 * @returns typo metrics 计算的行高（像素），未解析时返回 fontSize * 1.2 作为 fallback
 */
export function useTypoLineHeight(fontPath: string | undefined, fontFamily: string | undefined, fontSize: number): number {
  const fallback = Math.round(fontSize * 1.2);
  const [typoLH, setTypoLH] = useState(fallback);

  useEffect(() => {
    if (!fontPath || !fontFamily) {
      setTypoLH(fallback);
      return;
    }

    // 检查缓存
    const cached = metricsCache.get(fontPath);
    if (cached !== undefined) {
      setTypoLH(cached ? calcTypoLineHeight(cached, fontSize) : fallback);
      return;
    }

    // 从 useFontLoader 的 URI 缓存获取字体 URL
    const uri = getFontUri(fontPath);
    if (!uri) {
      setTypoLH(fallback);
      return;
    }

    fetchAndParseMetrics(fontPath, uri).then((metrics) => {
      if (metrics) {
        const lh = calcTypoLineHeight(metrics, fontSize);
        setTypoLH(lh);
      } else {
        setTypoLH(fallback);
      }
    });
  }, [fontPath, fontFamily, fontSize, fallback]);

  return typoLH;
}
