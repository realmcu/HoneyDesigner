#!/usr/bin/env node
/**
 * 预转换网页版用到的视频，产物写到 dist/web/sim/videos/（详见 prebuild-web-videos.ts）。
 * 需要 PATH 中有 ffmpeg / ffprobe 和 git，在 prepare-web-sim.js 之后运行：
 *
 *   node scripts/prebuild-web-videos.js [--cache <目录>]
 *
 * 转换规则直接用 src/ 下的 TypeScript，这里用 esbuild 打包后执行；
 * 其中的 vscode 只用到 l10n.t，换成一个原样返回英文文本的替身。
 */
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');

const vscodeStub = {
    name: 'vscode-stub',
    setup(build) {
        build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'vscode-stub' }));
        build.onLoad({ filter: /.*/, namespace: 'vscode-stub' }, () => ({
            contents: `module.exports.l10n = {
                t(message, ...args) {
                    const text = typeof message === 'string' ? message : message.message;
                    return text.replace(/\\{(\\d+)\\}/g, (match, i) => i < args.length ? String(args[i]) : match);
                },
            };`,
            loader: 'js',
        }));
    },
};

async function main() {
    // 放在仓库内（out/ 不入库）：外部依赖从仓库的 node_modules 解析
    const outfile = path.join(root, 'out', 'prebuild-web-videos.cjs');
    await esbuild.build({
        entryPoints: [path.join(__dirname, 'prebuild-web-videos.ts')],
        outfile,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        plugins: [vscodeStub],
        // __dirname 指向脚本原位置（脚本按它找仓库根）
        define: { __dirname: JSON.stringify(__dirname) },
        logLevel: 'warning',
    });
    require(outfile);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
