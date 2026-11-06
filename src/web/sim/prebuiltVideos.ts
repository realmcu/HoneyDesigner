/**
 * CI 预转换的视频：浏览器里没有 FFmpeg，视频的转换结果由 scripts/prebuild-web-videos.js
 * 在部署时用原生 FFmpeg 转好，按键放在 sim/videos/ 下。
 *
 * 两级键：
 * - 原始键（videoKey）：转换参数 + 源文件内容，浏览器算得出来（不需要 FFprobe）；
 * - 产物键（videoOutputKey）：原始键 + FFprobe 换算出的缩放像素尺寸，产物文件名用它。
 *
 * 分成两级是因为百分比缩放的像素尺寸要读视频尺寸才知道，浏览器读不了。
 * 把换算结果并入产物键后，同样参数的产物如果因为 FFprobe 结果不同而不同，
 * 文件名也会不同，不会出现「键相同而内容不对应」。
 */
import { VIDEO_SPEC_FIELDS, type ResolvedScale, type VideoSpec } from '../../simulation/BuildCore';
import { contentKey } from './hash';

/** 预转换视频在 sim/ 下的目录与索引 */
export const VIDEO_DIR = 'videos/';
export const VIDEO_INDEX = 'videos/index.json';

/**
 * 键规则：参与键的 VideoSpec 字段 + 转换实现版本。
 *
 * 字段列表来自 BuildCore 的 VIDEO_SPEC_FIELDS，新增或删除字段时这里自动跟着变，
 * 旧索引也就自动作废，不需要另外维护版本号。CONVERSION_VERSION 只在
 * 「参数没变但产物变了」时递增：FFmpeg 命令、编码参数、后处理（对齐/打包）改动。
 */
const CONVERSION_VERSION = 1;

export function videoKeyVersion(): string {
    return JSON.stringify([VIDEO_SPEC_FIELDS, CONVERSION_VERSION]);
}

/** 一个预转换产物：产物键 + 输出扩展名 */
export interface PrebuiltVideo {
    /** 产物键（videoOutputKey），文件名是 v/<key><ext> */
    key: string;
    /** .mjpeg / .avi / .h264 */
    ext: string;
}

export interface VideoIndex {
    /** 键规则（videoKeyVersion()），对不上则整个索引作废 */
    version: string;
    /** 原始键（videoKey，浏览器可算）→ 产物 */
    videos: Record<string, PrebuiltVideo>;
}

export function emptyVideoIndex(): VideoIndex {
    return { version: videoKeyVersion(), videos: {} };
}

/**
 * 原始键 = 键规则 + 参与转换的字段值 + 源文件内容。
 * 只取 VIDEO_SPEC_FIELDS 里的字段：往 VideoSpec 加不影响转换的字段（例如给界面用的原始配置）不会作废已有产物。
 */
export function videoKey(source: Uint8Array, spec: VideoSpec): Promise<string> {
    const fields = { ...spec } as Record<string, unknown>;
    const values = VIDEO_SPEC_FIELDS.map(name => [name, fields[name]] as const);
    return contentKey([videoKeyVersion(), '\0', JSON.stringify(values), '\0', source]);
}

/**
 * 产物键 = 原始键 + 换算后的缩放尺寸（CI 用 FFprobe 算出，桌面版转换时也一样）。
 * 缩放尺寸只取决于源文件与 FFprobe 的读法，所以这一级不会随浏览器不同而不同。
 */
export function videoOutputKey(key: string, scale: ResolvedScale): Promise<string> {
    return contentKey([key, '\0', JSON.stringify(scale ?? null)]);
}

export function prebuiltVideoPath(video: PrebuiltVideo): string {
    return `${VIDEO_DIR}v/${video.key}${video.ext}`;
}
