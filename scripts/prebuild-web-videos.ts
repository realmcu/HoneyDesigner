/**
 * 预转换网页版用到的视频（由 scripts/prebuild-web-videos.js 用 esbuild 打包后运行）。
 *
 * 浏览器里没有 FFmpeg。这里用原生 FFmpeg 按桌面版的同一套规则（BuildCore.planVideos /
 * convertVideo）转换官方模板与内置示例里的视频，产物写到 dist/web/sim/videos/：
 *   v/<键><扩展名>   转换结果；键见 src/web/sim/prebuiltVideos.ts（源文件内容 + 转换参数）
 *   index.json       键 → 扩展名
 *
 * CINEPAK 一段几秒的视频要转一分多钟，已转过的键从缓存目录（--cache，CI 里由 actions/cache 保留）
 * 直接复用；缓存里本次没用到的文件会被删掉，避免越积越多。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BuildCore } from '../src/simulation/BuildCore';
import { VideoConverterService } from '../src/services/VideoConverterService';
import { ProjectUtils } from '../src/utils/ProjectUtils';
import { collectProjects } from './webPrebuildProjects';
import {
    VIDEO_DIR,
    VIDEO_INDEX,
    PrebuiltVideo,
    VideoIndex,
    emptyVideoIndex,
    prebuiltVideoPath,
    videoKey,
    videoOutputKey,
} from '../src/web/sim/prebuiltVideos';

const repo = path.resolve(__dirname, '..');
const simDir = path.join(repo, 'dist', 'web', 'sim');
const outDir = path.join(simDir, VIDEO_DIR);

function fail(message: string): never {
    console.error(`prebuild-web-videos: ${message}`);
    process.exit(1);
}

function argValue(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
    if (!fs.existsSync(simDir)) {
        fail('dist/web/sim not found; run "node scripts/prepare-web-sim.js" first');
    }
    const cacheDir = argValue('--cache');
    const converter = new VideoConverterService();
    if (!await converter.checkFFmpegAvailable()) {
        fail('ffmpeg not found in PATH');
    }

    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'honeygui-videos-'));
    fs.rmSync(outDir, { recursive: true, force: true });
    const index: VideoIndex = emptyVideoIndex();
    let converted = 0;
    let reused = 0;
    try {
        for (const { label, root } of collectProjects(work, 'prebuild-web-videos')) {
            const config = ProjectUtils.loadProjectConfig(root);
            if ((config.targetEngine || 'honeygui') !== 'honeygui') {
                continue;
            }
            const core = new BuildCore(root, '', config, { log: () => undefined });
            for (const plan of await core.planVideos()) {
                const key = await videoKey(new Uint8Array(fs.readFileSync(plan.input)), plan.spec);
                if (index.videos[key]) {
                    continue;
                }
                // 与桌面版转换使用同一个换算结果：产物键里带上 FFprobe 读出的尺寸
                const scale = await core.resolveScale(converter, plan);
                const outputKey = await videoOutputKey(key, scale);
                const ext = path.extname(plan.output);
                const video: PrebuiltVideo = { key: outputKey, ext };
                const target = path.join(simDir, prebuiltVideoPath(video));
                const cached = cacheDir && path.join(cacheDir, `${outputKey}${ext}`);
                fs.mkdirSync(path.dirname(target), { recursive: true });
                if (cached && fs.existsSync(cached)) {
                    fs.copyFileSync(cached, target);
                    reused++;
                } else {
                    const started = Date.now();
                    const result = await core.convertVideo(converter, plan, scale);
                    if (!result.success) {
                        fail(`${label}: ${plan.relativePath}: ${result.error}`);
                    }
                    fs.copyFileSync(plan.output, target);
                    if (cached) {
                        fs.mkdirSync(cacheDir, { recursive: true });
                        fs.copyFileSync(plan.output, cached);
                    }
                    converted++;
                    console.log(`prebuild-web-videos: ${label}: ${plan.relativePath} -> ${plan.spec.format} ${((Date.now() - started) / 1000).toFixed(1)} s`);
                }
                index.videos[key] = video;
            }
        }
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }

    if (cacheDir && fs.existsSync(cacheDir)) {
        // 缓存目录按产物键命名，与索引里的产物键直接比对
        const used = new Set(Object.values(index.videos).map(video => `${video.key}${video.ext}`));
        for (const name of fs.readdirSync(cacheDir)) {
            if (!used.has(name)) {
                fs.rmSync(path.join(cacheDir, name), { force: true });
            }
        }
    }
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(simDir, VIDEO_INDEX), JSON.stringify(index));
    console.log(`prebuild-web-videos: ${Object.keys(index.videos).length} videos (${converted} converted, ${reused} from cache)`);
}

main().catch(error => fail(error instanceof Error ? (error.stack || error.message) : String(error)));
