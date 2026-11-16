/**
 * 资源分组：路径归一化、资源根枚举与分组配置隔离。
 *
 * 这里守护的是本方案的核心前提：
 * - 有分组时只枚举分组目录，根 assets 不参与转换；
 * - HML / alwaysConvert 里的 "ota/x.png" 在分组转换时必须落到分组目录下的 "x.png"，
 *   否则会拼成 assets/ota/ota/x.png 而找不到资源。
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

import { BuildCore } from '../../simulation/BuildCore';
import { ConversionConfigService, ASSET_ROOT_ID_ROOT } from '../../services/ConversionConfigService';

type ProjectJson = Record<string, unknown>;

function makeProject(projectJson: ProjectJson, files: Record<string, string> = {}): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'res-groups-'));
    const write = (rel: string, data: string) => {
        const full = path.join(root, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, data);
    };
    write('project.json', JSON.stringify(projectJson));
    write('ui/main.hml', '<hml><hg_view id="main"/></hml>');
    for (const [rel, data] of Object.entries(files)) {
        write(rel, data);
    }
    return root;
}

/** 取 BuildCore 的私有方法/字段做直接调用（测试关注纯函数行为） */
function callPrivate<T>(core: BuildCore, name: string, ...args: unknown[]): T {
    return (core as unknown as Record<string, (...a: unknown[]) => T>)[name](...args);
}

const BASE_PROJECT = { name: 'Demo', resolution: '360X360', targetEngine: 'honeygui', pixelMode: 'RGB565' };

describe('listAssetRoots', () => {
    const service = ConversionConfigService.getInstance();

    it('returns a single root asset when no groups are declared', () => {
        const root = makeProject(BASE_PROJECT);
        const roots = service.listAssetRoots(root);
        expect(roots).toHaveLength(1);
        expect(roots[0].id).toBe(ASSET_ROOT_ID_ROOT);
        expect(roots[0].isGroup).toBe(false);
        expect(roots[0].mountPoint).toBe('/');
        expect(service.hasResourceGroups(root)).toBe(false);
    });

    it('returns only the declared groups when groups exist (root assets excluded)', () => {
        const root = makeProject({
            ...BASE_PROJECT,
            romfsBaseAddr: '0x704D1000',
            resourceGroups: [
                { name: 'ota', baseAddr: '0x70500000', description: 'OTA assets' },
                { name: 'extra', baseAddr: '0x70600000' },
            ],
        });
        const roots = service.listAssetRoots(root);
        expect(roots.map(r => r.id)).toEqual(['ota', 'extra']);
        expect(roots[0]).toMatchObject({ mountPoint: '/ota', isGroup: true, baseAddr: '0x70500000' });
        expect(roots[1]).toMatchObject({ mountPoint: '/extra', isGroup: true });
        expect(service.hasResourceGroups(root)).toBe(true);
    });
});

describe('conversion config per resource root', () => {
    const service = ConversionConfigService.getInstance();

    it("reads a group's own conversion.json instead of the root one", () => {
        const root = makeProject(
            { ...BASE_PROJECT, resourceGroups: [{ name: 'ota', baseAddr: '0x70500000' }] },
            {
                'assets/conversion.json': JSON.stringify({
                    version: '1.0',
                    defaultSettings: { format: 'RGB888', compression: 'none' },
                    items: { 'root-only.png': { format: 'A8' } },
                }),
                'assets/ota/conversion.json': JSON.stringify({
                    version: '1.0',
                    defaultSettings: { format: 'RGB565', compression: 'rle' },
                    items: { 'bg.png': { format: 'ARGB8888' } },
                }),
            }
        );

        const groupConfig = service.loadConfigForRoot(path.join(root, 'assets', 'ota'));
        expect(groupConfig.defaultSettings.format).toBe('RGB565');
        expect(groupConfig.defaultSettings.compression).toBe('rle');
        expect(Object.keys(groupConfig.items)).toEqual(['bg.png']);
    });
});

describe('group path normalization', () => {
    it('strips the group prefix so HML references resolve inside the group dir', () => {
        const root = makeProject({ ...BASE_PROJECT, resourceGroups: [{ name: 'ota', baseAddr: '0x70500000' }] });
        const core = new BuildCore(root, '', BASE_PROJECT as never, { log: () => {} });

        // 无当前根时原样返回
        expect(callPrivate<string>(core, 'stripGroupPrefix', 'ota/bg.png')).toBe('ota/bg.png');

        // 切到分组后剥掉前缀
        (core as unknown as Record<string, unknown>).currentRoot = {
            id: 'ota', dir: path.join(root, 'assets', 'ota'), mountPoint: '/ota', isGroup: true,
        };
        expect(callPrivate<string>(core, 'stripGroupPrefix', 'ota/bg.png')).toBe('bg.png');
        // 已经在分组内、没有前缀的路径保持原样
        expect(callPrivate<string>(core, 'stripGroupPrefix', 'bg.png')).toBe('bg.png');
        // 反斜杠与首尾斜杠一并归一化
        expect(callPrivate<string>(core, 'stripGroupPrefix', '/ota\\bg.png')).toBe('bg.png');
        // 其他分组的前缀不动（不应误剥）
        expect(callPrivate<string>(core, 'stripGroupPrefix', 'other/bg.png')).toBe('other/bg.png');
    });

    it('resolves a group font path to the real file on disk', () => {
        // 回归：fontFile 是相对 assets/ 的 VFS 路径（/ota/x.ttf），
        // 分组转换时曾拼成 assets/ota/ota/x.ttf 导致"字体文件不存在"。
        const root = makeProject(
            { ...BASE_PROJECT, resourceGroups: [{ name: 'ota', baseAddr: '0x70500000' }] },
            { 'assets/ota/font/MiSans-Medium-ota.ttf': 'fake-font' }
        );
        const groupDir = path.join(root, 'assets', 'ota');
        const core = new BuildCore(root, '', BASE_PROJECT as never, { log: () => {} });
        (core as unknown as Record<string, unknown>).currentRoot = {
            id: 'ota', dir: groupDir, mountPoint: '/ota', isGroup: true,
        };

        const stripped = callPrivate<string>(core, 'stripGroupPrefix', 'ota/font/MiSans-Medium-ota.ttf');
        expect(stripped).toBe('font/MiSans-Medium-ota.ttf');
        expect(fs.existsSync(path.join(groupDir, stripped))).toBe(true);

        // 未剥前缀时的错误路径确实不存在，证明这条回归有意义
        expect(fs.existsSync(path.join(groupDir, 'ota/font/MiSans-Medium-ota.ttf'))).toBe(false);
    });

    it('ignores fonts that belong to another resource group', () => {
        // 回归：HML 同时引用两个分组的字体时，转换 A 组曾去 A 目录下找 B 组的字体，
        // 报"字体文件不存在"。归属应按「文件是否真的在根目录下」判定。
        const root = makeProject(
            {
                ...BASE_PROJECT,
                resourceGroups: [
                    { name: 'ota', baseAddr: '0x70500000' },
                    { name: 'theme', baseAddr: '0x70600000' },
                ],
            },
            {
                'assets/ota/font/A.ttf': 'a',
                'assets/theme/font/B.ttf': 'b',
            }
        );
        const core = new BuildCore(root, '', BASE_PROJECT as never, { log: () => {} });
        (core as unknown as Record<string, unknown>).currentRoot = {
            id: 'ota', dir: path.join(root, 'assets', 'ota'), mountPoint: '/ota', isGroup: true,
        };

        const belongs = (p: string) => callPrivate<boolean>(core, 'belongsToCurrentRoot', p);
        // 本组字体：两种写法都算
        expect(belongs('ota/font/A.ttf')).toBe(true);
        expect(belongs('font/A.ttf')).toBe(true);
        // 他组字体：排除，由 theme 那一轮处理
        expect(belongs('theme/font/B.ttf')).toBe(false);
        // 根 assets 没有的路径：不属于本组
        expect(belongs('nowhere/C.ttf')).toBe(false);
    });
});

describe('fontPathInRoot', () => {
    it('maps each font to the resource root that actually holds it', () => {
        // 回归：仿真前 findStaleFontAsset 曾用根 assets 去拼分组字体路径，
        // 得到不存在的文件，每轮都判"已过期"，最后报「字体资源准备失败」。
        const root = makeProject(
            {
                ...BASE_PROJECT,
                resourceGroups: [
                    { name: 'general', baseAddr: '0x7054F400' },
                    { name: 'ota', baseAddr: '0x70536400' },
                ],
            },
            {
                'assets/general/MiSans-Medium.ttf': 'g',
                'assets/ota/Small.ttf': 'o',
            }
        );
        const core = new BuildCore(root, '', BASE_PROJECT as never, { log: () => {} });
        const groupIds = ['general', 'ota'];
        const inRoot = (fontFile: string, rootId: string) =>
            callPrivate<string | undefined>(
                core, 'fontPathInRoot', fontFile, rootId, groupIds, path.join(root, 'assets', rootId)
            );

        // 带组前缀：归对应分组，路径剥掉前缀
        expect(inRoot('general/MiSans-Medium.ttf', 'general')).toBe('MiSans-Medium.ttf');
        expect(inRoot('general/MiSans-Medium.ttf', 'ota')).toBeUndefined();
        // 不带前缀：谁目录里真有就归谁（分组 conversion.json 里的写法）
        expect(inRoot('MiSans-Medium.ttf', 'general')).toBe('MiSans-Medium.ttf');
        expect(inRoot('MiSans-Medium.ttf', 'ota')).toBeUndefined();
        // 文件不存在 → 谁都不认领
        expect(inRoot('Missing.ttf', 'general')).toBeUndefined();
        expect(inRoot('Missing.ttf', 'ota')).toBeUndefined();
    });
});

describe('no-group projects behave exactly as before', () => {
    const service = ConversionConfigService.getInstance();

    it('loadConfigForRoot keeps the alwaysConvert migration from project.json', () => {
        // 回归：无分组工程也走 loadConfigForRoot，若它不做历史迁移，
        // 老工程放在 project.json 的 alwaysConvert 会静默丢失（强制转换失效）。
        const root = makeProject(
            {
                ...BASE_PROJECT,
                alwaysConvert: { images: ['icon.png'], fonts: ['NotoSansSC-Medium.ttf'] },
            },
            {
                // 故意不写 alwaysConvert，模拟迁移前的老工程
                'assets/conversion.json': JSON.stringify({
                    version: '1.0',
                    defaultSettings: { format: 'adaptive16' },
                    items: {},
                }),
            }
        );

        const assetsDir = path.join(root, 'assets');
        const config = service.loadConfigForRoot(assetsDir);
        expect(config.alwaysConvert?.images).toEqual(['icon.png']);
        expect(config.alwaysConvert?.fonts).toEqual(['NotoSansSC-Medium.ttf']);

        // 迁移结果应已回写磁盘，后续读取无需再迁移
        const onDisk = JSON.parse(fs.readFileSync(path.join(assetsDir, 'conversion.json'), 'utf-8'));
        expect(onDisk.alwaysConvert?.images).toEqual(['icon.png']);
    });

    it('loadConfigForRoot still migrates legacy assets/ prefixed keys', () => {
        const root = makeProject(BASE_PROJECT, {
            'assets/conversion.json': JSON.stringify({
                version: '1.0',
                defaultSettings: { format: 'adaptive16' },
                items: { 'assets/icon.png': { format: 'A8' } },
            }),
        });
        const config = service.loadConfigForRoot(path.join(root, 'assets'));
        expect(config.items['icon.png']).toEqual({ format: 'A8' });
        expect(config.items['assets/icon.png']).toBeUndefined();
    });

    it('does not run root migrations for a group root', () => {
        const root = makeProject(
            { ...BASE_PROJECT, resourceGroups: [{ name: 'ota', baseAddr: '0x70500000' }] },
            {
                'assets/ota/conversion.json': JSON.stringify({
                    version: '1.0',
                    defaultSettings: { format: 'adaptive16' },
                    // 分组配置里带 assets/ 的 key 不该被改写（它不是历史遗留）
                    items: { 'assets/bg.png': { format: 'A8' } },
                }),
            }
        );
        const config = service.loadConfigForRoot(path.join(root, 'assets', 'ota'));
        expect(config.items['assets/bg.png']).toBeDefined();
    });

    it('normalizes items only for group roots, leaving root config untouched', () => {
        const root = makeProject(BASE_PROJECT);
        const core = new BuildCore(root, '', BASE_PROJECT as never, { log: () => {} });
        const config = {
            version: '1.0',
            defaultSettings: { format: 'adaptive16' as const },
            items: { 'ota/bg.png': { format: 'A8' as const }, 'icon.png': { format: 'RGB888' as const } },
        };

        // 根资源：原样返回，不剥任何前缀
        const forRoot = callPrivate<typeof config>(core, 'normalizeConfigForRoot', config, ASSET_ROOT_ID_ROOT);
        expect(forRoot.items).toEqual(config.items);

        // 分组：剥掉该组前缀，其余保持
        const forGroup = callPrivate<typeof config>(core, 'normalizeConfigForRoot', config, 'ota');
        const groupItems = forGroup.items as Record<string, { format: string }>;
        expect(groupItems['bg.png']).toEqual({ format: 'A8' });
        expect(groupItems['icon.png']).toEqual({ format: 'RGB888' });
    });
});

describe('font freshness check uses the same paths as conversion', () => {
    it('does not report a freshly converted group font as stale', () => {
        // 回归：转换时按「相对分组根」的路径存指纹，检查时若用「相对 assets/」的
        // 路径去算（拼成 assets/general/general/x.ttf），指纹永远不等，
        // 于是转换成功也会立刻被判定过期，卡在「字体资源准备失败」。
        //
        // 这里直接验证两个 private 方法对同一字体的输入一致：
        // 分别是转换链路（groupInRoot）与检查链路（fontPathInRoot + groupInRoot）。
        const root = makeProject(
            {
                ...BASE_PROJECT,
                resourceGroups: [{ name: 'general', baseAddr: '0x7054F400' }],
            },
            {
                'assets/general/MiSans-Medium.ttf': 'font-bytes',
                'ui/main.hml': '<hml><hg_view id="main"><hg_label fontFile="/general/MiSans-Medium.ttf" text="Hi"/></hg_view></hml>',
            }
        );
        const core = new BuildCore(root, '', BASE_PROJECT as never, { log: () => {} });
        const groupIds = ['general'];
        const groupDir = path.join(root, 'assets', 'general');

        // 检查链路：fontFile 来自 HML，带分组前缀
        const checked = callPrivate<string | undefined>(
            core, 'fontPathInRoot', '/general/MiSans-Medium.ttf', 'general', groupIds, groupDir
        );
        expect(checked).toBe('MiSans-Medium.ttf');

        // 转换链路：stripGroupPrefix 在分组上下文里给出同一个结果
        (core as unknown as Record<string, unknown>).currentRoot = {
            id: 'general', dir: groupDir, mountPoint: '/general', isGroup: true,
        };
        const converted = callPrivate<string>(core, 'stripGroupPrefix', 'general/MiSans-Medium.ttf');
        expect(converted).toBe(checked);

        // 两条链路算出的产物路径必须相同
        const baseGroup = {
            fontFile: 'MiSans-Medium.ttf', fontSize: 24, fontType: 'vector' as const, renderMode: 4,
        };
        const outFromCheck = callPrivate<string>(
            core, 'fontGroupOutputPath', baseGroup, path.join(root, 'build', 'assets', 'general')
        );
        const outFromConvert = callPrivate<string>(
            core, 'fontGroupOutputPath',
            { ...baseGroup, fontFile: converted },
            path.join(root, 'build', 'assets', 'general')
        );
        expect(outFromCheck).toBe(outFromConvert);
        expect(outFromCheck).toContain('MiSans_Medium_vector.bin');
    });
});

describe('findAssetRootForPath', () => {
    const service = ConversionConfigService.getInstance();

    it('routes a group asset path to that group, not the root', () => {
        // 回归：面板保存配置时永远写根 conversion.json，分组里的设置转换时读不到。
        const root = makeProject(
            {
                ...BASE_PROJECT,
                resourceGroups: [
                    { name: 'ota', baseAddr: '0x70500000' },
                    { name: 'general', baseAddr: '0x70600000' },
                ],
            },
            { 'assets/general/bg.png': 'g', 'assets/ota/icon.png': 'o' }
        );

        expect(service.findAssetRootForPath(root, 'ota/icon.png')?.id).toBe('ota');
        expect(service.findAssetRootForPath(root, 'assets/ota/icon.png')?.id).toBe('ota');
        expect(service.findAssetRootForPath(root, 'general/bg.png')?.id).toBe('general');
        // 没有分组前缀时按文件真实位置判定
        expect(service.findAssetRootForPath(root, 'bg.png')?.id).toBe('general');
    });

    it('has no group to route to when the project declares none', () => {
        const root = makeProject(BASE_PROJECT, { 'assets/icon.png': 'i' });
        const found = service.findAssetRootForPath(root, 'icon.png');
        expect(found?.isGroup).toBe(false);
        expect(found?.id).toBe(ASSET_ROOT_ID_ROOT);
    });
});

describe('font manifest is shared across resource roots', () => {
    it('keeps entries written by a previous root instead of overwriting them', () => {
        // 回归：每个资源根转换结束时都会 saveFontManifest 一次。若直接整体覆盖，
        // 转完 general 再转 ota，general 的条目就被冲掉，检查阶段立刻判它过期
        // （用户看到的就是 bin 明明生成了，却报「字体资源准备失败」）。
        const { loadFontManifest, saveFontManifest } = require('../../simulation/FontManifest');
        const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-'));

        // 第一轮：general 写入自己的条目
        saveFontManifest(buildDir, {
            version: 1,
            groups: { 'general/MiSans-Medium.ttf|vector': { fingerprint: 'fp-g', chars: 'Hi', precision: 24 } },
        });

        // 第二轮（模拟 ota 的合并写入）：读回现有内容再合并
        const onDisk = loadFontManifest(buildDir);
        saveFontManifest(buildDir, {
            version: 1,
            groups: { ...onDisk.groups, 'ota/Small.ttf|vector': { fingerprint: 'fp-o', chars: 'Ok', precision: 16 } },
        });

        const final = loadFontManifest(buildDir);
        // 两个根的条目都在
        expect(final.groups['general/MiSans-Medium.ttf|vector']).toBeDefined();
        expect(final.groups['ota/Small.ttf|vector']).toBeDefined();
        expect(final.groups['general/MiSans-Medium.ttf|vector'].fingerprint).toBe('fp-g');
    });
});

describe('EntryFileGenerator group mounts', () => {
    const { EntryFileGenerator } = require('../../codegen/EntryFileGenerator');

    function genAndRead(groups?: Array<{ name: string; baseAddr: string }>): string {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-'));
        const srcDir = path.join(root, 'src');
        const file = EntryFileGenerator.generate(srcDir, 'Demo', 'DemoMain', '0x704D1000', groups);
        return fs.readFileSync(file, 'utf-8');
    }

    it('mounts "/" and nothing else when no groups are declared', () => {
        const code = genAndRead(undefined);
        expect(code).toContain('gui_vfs_mount_romfs("/", (void *)0x704D1000, 0);');
    });

    it('drops the "/" mount and mounts each group when groups exist', () => {
        const code = genAndRead([
            { name: 'ota', baseAddr: '0x70500000' },
            { name: 'extra', baseAddr: '0x70600000' },
        ]);
        // 有分组时不应再挂 "/"：资源全在分组里，根 romfs 是空的
        expect(code).not.toContain('gui_vfs_mount_romfs("/",');
        expect(code).toContain('gui_vfs_mount_romfs("/ota", (void *)0x70500000, 0);');
        expect(code).toContain('gui_vfs_mount_romfs("/extra", (void *)0x70600000, 0);');
    });
});
