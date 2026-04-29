import { useState, useEffect, useRef } from 'react';

// 已加载的字体缓存：fontPath -> { fontFamily, fontFace }
const loadedFonts = new Map<string, { fontFamily: string; fontFace: FontFace }>();

// URI 缓存
const uriCache = new Map<string, string>();

/**
 * 获取已缓存的字体 webview URI
 * @param fontPath 字体路径（如 /NotoSansSC_Regular.ttf）
 * @returns webview URI 或 undefined
 */
export function getFontUri(fontPath: string): string | undefined {
  const assetsPath = `assets${fontPath}`;
  return uriCache.get(assetsPath);
}

// 待处理的 URI 请求
const pendingUriRequests = new Map<string, ((uri: string) => void)[]>();

// 监听 URI 转换结果
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.command === 'webviewUriConverted' && message.requestId) {
      const callbacks = pendingUriRequests.get(message.requestId);
      if (callbacks && !message.error) {
        const path = message.requestId.replace('font_uri_', '');
        uriCache.set(path, message.uri);
        callbacks.forEach(cb => cb(message.uri));
      }
      pendingUriRequests.delete(message.requestId);
    }
  });
}

export interface FontLoaderResult {
  fontFamily: string | undefined;
  fontFace: FontFace | undefined;
  isLoading: boolean;
}

/**
 * 获取 webview URI（带重试机制）
 */
function getWebviewUri(fontPath: string, retryCount: number = 0): Promise<string> {
  const assetsPath = `assets${fontPath}`;
  
  if (uriCache.has(assetsPath)) {
    return Promise.resolve(uriCache.get(assetsPath)!);
  }
  
  return new Promise((resolve, reject) => {
    const requestId = `font_uri_${assetsPath}`;
    
    if (pendingUriRequests.has(requestId)) {
      pendingUriRequests.get(requestId)!.push(resolve);
      return;
    }
    
    pendingUriRequests.set(requestId, [resolve]);
    
    // 超时时间：首次 5 秒，重试时 3 秒
    const timeout = retryCount === 0 ? 5000 : 3000;
    
    setTimeout(() => {
      if (pendingUriRequests.has(requestId)) {
        pendingUriRequests.delete(requestId);
        
        // 如果是首次请求且超时，尝试重试一次
        if (retryCount === 0) {
          console.warn(`[useFontLoader] URI 转换超时，尝试重试: ${fontPath}`);
          getWebviewUri(fontPath, 1)
            .then(resolve)
            .catch(reject);
        } else {
          reject(new Error(`URI 转换超时（已重试 ${retryCount} 次）`));
        }
      }
    }, timeout);
    
    if ((window as any).vscodeAPI) {
      (window as any).vscodeAPI.postMessage({
        command: 'convertPathToWebviewUri',
        path: assetsPath,
        requestId
      });
    } else {
      reject(new Error('vscodeAPI 不可用'));
    }
  });
}

/**
 * 验证字体是否仍然有效
 */
function isFontValid(fontFamily: string): boolean {
  let isValid = false;
  document.fonts.forEach((font) => {
    if (font.family === fontFamily) {
      isValid = true;
    }
  });
  return isValid;
}

/**
 * 动态加载字体
 * 关键：加载新字体时保持显示旧字体，避免闪烁
 */
export function useFontLoader(fontPath: string | undefined): FontLoaderResult {
  const [result, setResult] = useState<FontLoaderResult>({
    fontFamily: undefined,
    fontFace: undefined,
    isLoading: false
  });

  const loadIdRef = useRef(0);
  const prevFontFamilyRef = useRef<string | undefined>(undefined);
  const retryCountRef = useRef(0); // 重试计数器

  useEffect(() => {
    if (!fontPath) {
      prevFontFamilyRef.current = undefined;
      retryCountRef.current = 0;
      setResult({ fontFamily: undefined, fontFace: undefined, isLoading: false });
      return;
    }

    const currentLoadId = ++loadIdRef.current;
    retryCountRef.current = 0; // 重置重试计数

    // 检查缓存
    const cached = loadedFonts.get(fontPath);
    if (cached && isFontValid(cached.fontFamily)) {
      prevFontFamilyRef.current = cached.fontFamily;
      setResult({ fontFamily: cached.fontFamily, fontFace: cached.fontFace, isLoading: false });
      return;
    }

    // 缓存失效，删除
    if (cached) {
      loadedFonts.delete(fontPath);
    }

    // 关键：保持显示旧字体，只设置 isLoading 为 true
    // 不清空 fontFamily，避免闪烁
    setResult(prev => ({ 
      fontFamily: prev.fontFamily, // 保持旧字体
      fontFace: prev.fontFace,
      isLoading: true 
    }));

    // 加载字体的内部函数（支持重试）
    const loadFont = (retryCount: number = 0) => {
      // 获取 URI 并加载字体
      getWebviewUri(fontPath, retryCount)
        .then((webviewUri) => {
          if (loadIdRef.current !== currentLoadId) return;

          const fontName = `custom-font-${fontPath.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
          const fontFace = new FontFace(fontName, `url(${webviewUri})`);

          return fontFace.load().then((loadedFace) => {
            if (loadIdRef.current !== currentLoadId) return;

            document.fonts.add(loadedFace);
            loadedFonts.set(fontPath, { fontFamily: fontName, fontFace: loadedFace });
            prevFontFamilyRef.current = fontName;
            retryCountRef.current = 0;
            setResult({ fontFamily: fontName, fontFace: loadedFace, isLoading: false });
          });
        })
        .catch((error) => {
          console.error('[useFontLoader] 加载失败:', fontPath, error, `(尝试 ${retryCount + 1} 次)`);
          
          if (loadIdRef.current !== currentLoadId) return;
          
          // 如果是首次失败，尝试重试一次（延迟 500ms）
          if (retryCount === 0 && retryCountRef.current === 0) {
            retryCountRef.current = 1;
            console.warn('[useFontLoader] 500ms 后重试加载字体:', fontPath);
            setTimeout(() => {
              if (loadIdRef.current === currentLoadId) {
                loadFont(1);
              }
            }, 500);
          } else {
            // 加载失败时也保持旧字体
            setResult(prev => ({ ...prev, isLoading: false }));
          }
        });
    };

    // 开始加载
    loadFont(0);
  }, [fontPath]);

  return result;
}

/**
 * 清除字体缓存
 */
export function clearFontCache(fontPath?: string): void {
  if (fontPath) {
    loadedFonts.delete(fontPath);
  } else {
    loadedFonts.clear();
  }
}

export function useFontLoaderSimple(fontPath: string | undefined): string | undefined {
  const { fontFamily } = useFontLoader(fontPath);
  return fontFamily;
}
