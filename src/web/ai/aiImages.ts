/**
 * AI 面板的图片附件：把粘贴或选择的图片读成 ChatImage
 *
 * 大图先缩到长边不超过 MAX_EDGE 像素再编码，控制请求体积：
 * 模型对图片另有自己的尺寸限制，超出的部分会被裁掉或缩放，多发的像素没有意义。
 */
import type { ChatImage, ChatImageType } from './aiProvider';

/** 单次最多附几张（含画布截图） */
export const MAX_ATTACHED_IMAGES = 3;

/** 缩放后的最大边长；多数视觉模型按这个量级分块，再大也不会识别得更准 */
const MAX_EDGE = 1560;

const ACCEPTED: Record<string, ChatImageType> = {
    'image/png': 'image/png',
    'image/jpeg': 'image/jpeg',
    'image/jpg': 'image/jpeg',
    'image/webp': 'image/webp',
};

function readAsDataUrl(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error('read failed'));
        reader.readAsDataURL(file);
    });
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('decode failed'));
        image.src = src;
    });
}

/**
 * 把一张图片转成附件。格式不支持时返回 undefined 并给出原因，
 * 由调用方决定怎么提示（面板直接显示原因）。
 */
export async function toChatImage(file: Blob): Promise<{ image?: ChatImage; error?: string }> {
    const mediaType = ACCEPTED[file.type];
    if (!mediaType) {
        return { error: file.type || 'unknown' };
    }
    const dataUrl = await readAsDataUrl(file);
    const image = await loadImage(dataUrl);
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    if (scale === 1) {
        // PNG 截图通常已经是合适的尺寸，直接用原始字节，避免重新压缩后文字变糊
        return { image: { mediaType, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) } };
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) {
        return { image: { mediaType, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) } };
    }
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // 缩小后统一转 PNG：截图上多是文字和色块，PNG 不糊，体积也够小
    const out = canvas.toDataURL('image/png');
    return { image: { mediaType: 'image/png', base64: out.slice(out.indexOf(',') + 1) } };
}

/** 从剪贴板事件里取出图片，没有图片时返回空数组 */
export function clipboardImages(event: { clipboardData: DataTransfer | null }): File[] {
    const items = event.clipboardData?.items;
    if (!items) {
        return [];
    }
    const files: File[] = [];
    for (let index = 0; index < items.length; index++) {
        const item = items[index];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
                files.push(file);
            }
        }
    }
    return files;
}
