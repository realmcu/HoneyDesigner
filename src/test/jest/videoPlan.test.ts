/**
 * 视频转换计划与 CI 预转换：浏览器版没有 FFmpeg，靠 BuildCore 算出的计划和键去取
 * scripts/prebuild-web-videos.ts 预先转好的结果，两边的计划必须一致且不依赖 FFmpeg。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({
    l10n: {
        t: (message: string, ...args: unknown[]) =>
            message.replace(/\{(\d+)\}/g, (match, i) => (Number(i) < args.length ? String(args[Number(i)]) : match)),
    },
}), { virtual: true });

import { BuildCore, VIDEO_SPEC_FIELDS, VideoPlan } from '../../simulation/BuildCore';
import { ConversionCache } from '../../simulation/ConversionCache';
import { emptyVideoIndex, videoKey, videoKeyVersion, videoOutputKey } from '../../web/sim/prebuiltVideos';

const PROJECT_JSON = { name: 'Demo', resolution: '360X360', targetEngine: 'honeygui', pixelMode: 'RGB565' };

/** 与 E-Badge 模板相同的配置：默认 MJPEG，三个视频和一张当作视频的 GIF 用 CINEPAK */
const CONVERSION_JSON = {
    version: '1.0',
    defaultSettings: { format: 'adaptive16', videoFormat: 'MJPEG', videoQuality: 5 },
    items: {
        'video/coin.webm': { videoFormat: 'cinepak', videoFrameRate: 20 },
        'image/stick.gif': { gifAsVideo: true, videoFormat: 'cinepak', videoScale: { mode: 'pixels', width: 360, height: 360 } },
    },
};

function makeProject(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-plan-'));
    const write = (rel: string, data: string | Uint8Array) => {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), data);
    };
    write('project.json', JSON.stringify(PROJECT_JSON));
    write('assets/conversion.json', JSON.stringify(CONVERSION_JSON));
    write('ui/main.hml', '<hml><hg_view id="main"/></hml>');
    write('assets/video/coin.webm', new Uint8Array([1, 2, 3, 4]));
    write('assets/video/intro.mp4', new Uint8Array([5, 6, 7]));
    write('assets/image/stick.gif', new Uint8Array([8, 9]));
    return root;
}

function makeCore(root: string, logs: string[] = []): BuildCore {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'project.json'), 'utf8'));
    return new BuildCore(root, '', config, { log: message => { logs.push(message); } });
}

function byPath(plans: VideoPlan[]): Record<string, VideoPlan> {
    return Object.fromEntries(plans.map(plan => [plan.relativePath, plan]));
}

describe('BuildCore.planVideos', () => {
    let root: string;
    beforeEach(() => { root = makeProject(); });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('resolves format, frame rate and output path without FFmpeg', async () => {
        const plans = byPath(await makeCore(root).planVideos());
        expect(Object.keys(plans).sort()).toEqual(['image/stick.gif', 'video/coin.webm', 'video/intro.mp4']);

        expect(plans['video/coin.webm'].spec).toMatchObject({ format: 'avi_cinepak', frameRate: 20 });
        expect(plans['video/coin.webm'].outputRelative).toBe('video/coin.avi');
        expect(plans['image/stick.gif'].spec.scale).toEqual({ mode: 'pixels', width: 360, height: 360 });
        expect(plans['video/intro.mp4'].spec).toMatchObject({ format: 'mjpeg', frameRate: 30 });
        expect(plans['video/intro.mp4'].output).toBe(path.join(root, 'build', 'assets', 'video', 'intro.mjpeg'));
    });

    it('keys change with the source and with the conversion settings', async () => {
        const plan = byPath(await makeCore(root).planVideos())['video/coin.webm'];
        const source = new Uint8Array(fs.readFileSync(plan.input));
        const key = await videoKey(source, plan.spec);

        expect(await videoKey(source, { ...plan.spec })).toBe(key);
        expect(await videoKey(new Uint8Array([1, 2, 3, 5]), plan.spec)).not.toBe(key);
        expect(await videoKey(source, { ...plan.spec, frameRate: 25 })).not.toBe(key);
    });

    it('keys the spec by the declared field list, so unlisted fields do not invalidate anything', async () => {
        const plan = byPath(await makeCore(root).planVideos())['video/coin.webm'];
        const source = new Uint8Array(fs.readFileSync(plan.input));
        const key = await videoKey(source, plan.spec);

        // 只有 VIDEO_SPEC_FIELDS 里的字段参与键：临时加一个不影响转换的字段，键不变、已有产物照用
        expect(await videoKey(source, { ...plan.spec, ...{ uiNote: 'x' } } as never)).toBe(key);
        // 字段名同时进版本串：字段列表一变，旧索引整体作废
        expect(videoKeyVersion()).toContain(JSON.stringify(VIDEO_SPEC_FIELDS));
    });

    it('reports a key version that matches the index it produces', () => {
        expect(emptyVideoIndex()).toEqual({ version: videoKeyVersion(), videos: {} });
    });

    it('folds the FFprobe-resolved scale into the output key, which the browser never has to compute', async () => {
        const plan = byPath(await makeCore(root).planVideos())['video/coin.webm'];
        const source = new Uint8Array(fs.readFileSync(plan.input));
        const key = await videoKey(source, plan.spec);

        // 原始键浏览器算得出来；产物键多带一份换算结果
        expect(await videoOutputKey(key, undefined)).not.toBe(key);
        expect(await videoOutputKey(key, { width: 360, height: 360 }))
            .not.toBe(await videoOutputKey(key, { width: 180, height: 180 }));
        expect(await videoOutputKey(key, { width: 360, height: 360 }))
            .toBe(await videoOutputKey(key, { width: 360, height: 360 }));
    });
});

describe('BuildCore.convertAssets with a video source', () => {
    let root: string;
    beforeEach(() => { root = makeProject(); });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('writes supplied videos, skips missing ones and removes their stale output', async () => {
        const stale = path.join(root, 'build', 'assets', 'video', 'intro.mjpeg');
        fs.mkdirSync(path.dirname(stale), { recursive: true });
        fs.writeFileSync(stale, 'old');

        const logs: string[] = [];
        const requested: string[] = [];
        await makeCore(root, logs).convertAssets({
            packRomfs: false,
            videoSource: async plan => {
                requested.push(plan.relativePath);
                return plan.relativePath === 'video/intro.mp4' ? undefined : new TextEncoder().encode(plan.relativePath);
            },
        });

        expect(requested.sort()).toEqual(['image/stick.gif', 'video/coin.webm', 'video/intro.mp4']);
        expect(fs.readFileSync(path.join(root, 'build', 'assets', 'video', 'coin.avi'), 'utf8')).toBe('video/coin.webm');
        expect(fs.readFileSync(path.join(root, 'build', 'assets', 'image', 'stick.avi'), 'utf8')).toBe('image/stick.gif');
        expect(fs.existsSync(stale)).toBe(false);
        expect(logs).toContain('Videos from prebuilt conversions: 2, skipped: 1');
    });

    it('reuses cached outputs without asking the source again', async () => {
        const cache = new ConversionCache();
        const source = jest.fn(async (plan: VideoPlan) => new TextEncoder().encode(plan.relativePath));
        const first = makeCore(root);
        first.setConversionCache(cache);
        await first.convertAssets({ packRomfs: false, videoSource: source });
        expect(source).toHaveBeenCalledTimes(3);

        const second = makeCore(root);
        second.setConversionCache(cache);
        await second.convertAssets({ packRomfs: false, videoSource: source });
        expect(source).toHaveBeenCalledTimes(3);
    });
});
