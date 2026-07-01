import { useState, useEffect, useRef } from 'react';

export interface CharsetSource {
  type: string;
  value: string;
}

export interface GlyphStatsResult {
  /** 文本 + 附加字符集合并去重后的字符数 */
  charCount: number;
  /** 预估 font bin 大小（KB，粗估） */
  estimatedSizeKB: number;
  /** 字体文件中不存在的字符 */
  missingChars: string[];
  isLoading: boolean;
}

// 存储待处理的请求回调
const pendingRequests = new Map<
  string,
  (result: { charCount: number; estimatedSizeKB: number; missingChars: string[] }) => void
>();

// 哨兵：防止 HMR 等场景重复注册
let listenerRegistered = false;

if (typeof window !== 'undefined' && !listenerRegistered) {
  listenerRegistered = true;
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.command === 'glyphStatsResult' && message.requestId) {
      const callback = pendingRequests.get(message.requestId);
      if (callback) {
        callback({
          charCount: message.charCount || 0,
          estimatedSizeKB: message.estimatedSizeKB || 0,
          missingChars: message.missingChars || [],
        });
        pendingRequests.delete(message.requestId);
      }
    }
  });
}

/**
 * 统计「组件文本 + 手动字符集 + 自动 i18n 字符集」合并去重后的字符数、预估 font bin 大小，
 * 并检测这些字符在字体文件中是否存在（缺字检测）。
 *
 * Callers are responsible for merging manual component `characterSets` with any
 * generated project-level sources such as the auto i18n charset.
 *
 * 通过后端解析 TTF/OTF 的 cmap 表 + 复用字符集合并逻辑实现。
 * 输入变更后 debounce 300ms 再请求，避免频繁打字时反复触发。
 *
 * @param fontPath       字体文件路径（如 /font/xxx.ttf）
 * @param text           组件显示文本
 * @param characterSets  附加字符集（与转换时一致地参与合并）
 * @param fontSize       字号（用于预估大小）
 * @param bpp            渲染位深 1/2/4/8（用于预估大小）
 */
export function useFontGlyphStats(
  fontPath: string | undefined,
  text: string | undefined,
  characterSets: CharsetSource[] | undefined,
  fontSize: number | undefined,
  bpp: number | undefined
): GlyphStatsResult {
  const [result, setResult] = useState<GlyphStatsResult>({
    charCount: 0,
    estimatedSizeKB: 0,
    missingChars: [],
    isLoading: false,
  });

  const checkIdRef = useRef(0);
  // 数组不能直接作为依赖，序列化后参与比较
  const charsetsKey = JSON.stringify(characterSets || []);

  useEffect(() => {
    const hasText = !!(text && text.length);
    const hasCharsets = !!(characterSets && characterSets.length);

    // 没有字体或没有任何字符来源 → 不显示
    if (!fontPath || (!hasText && !hasCharsets)) {
      setResult({ charCount: 0, estimatedSizeKB: 0, missingChars: [], isLoading: false });
      return;
    }

    const currentCheckId = ++checkIdRef.current;
    const requestId = `glyph-stats-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // debounce 300ms 后再请求
    const debounceTimer = setTimeout(() => {
      setResult((prev) => ({ ...prev, isLoading: true }));

      pendingRequests.set(requestId, (statsResult) => {
        if (checkIdRef.current === currentCheckId) {
          setResult({ ...statsResult, isLoading: false });
        }
      });

      const vscodeAPI = (window as any).vscodeAPI;
      if (vscodeAPI) {
        vscodeAPI.postMessage({
          command: 'getGlyphStats',
          fontPath,
          text: text || '',
          characterSets: characterSets || [],
          fontSize: fontSize || 16,
          bpp: bpp || 4,
          requestId,
        });
      } else {
        pendingRequests.delete(requestId);
        setResult((prev) => ({ ...prev, isLoading: false }));
      }
    }, 300);

    // 超时保护（请求后 5 秒）
    const timeout = setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        if (checkIdRef.current === currentCheckId) {
          setResult((prev) => ({ ...prev, isLoading: false }));
        }
      }
    }, 5300);

    return () => {
      clearTimeout(debounceTimer);
      clearTimeout(timeout);
      pendingRequests.delete(requestId);
    };
  }, [fontPath, text, charsetsKey, fontSize, bpp]);

  return result;
}
