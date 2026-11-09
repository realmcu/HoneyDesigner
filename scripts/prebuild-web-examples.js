#!/usr/bin/env node
/**
 * 预编译网页版官方模板与示例工程，产物写到 dist/web/sim/prebuilt/（详见 prebuild-web-examples.ts）。
 * 需要 PATH 中有 git，在 build:web 与 prepare-web-sim.js 之后运行：
 *
 *   node scripts/prebuild-web-examples.js [--cache <目录>]
 *
 * 代码生成与编译规则直接用 src/ 下的 TypeScript，这里用 esbuild 打包成一个 ES 模块再执行：
 * @yowasp/clang 与 binaryen 只提供 ES 模块，并按自身位置加载 wasm，保持外部引用；
 * 代码生成里的 vscode 只用到 l10n.t，换成一个原样返回英文文本的替身。
 */
const path = require('path');
const { pathToFileURL } = require('url');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');

const vscodeStub = {
    name: 'vscode-stub',
    setup(build) {
        build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'vscode-stub' }));
        build.onLoad({ filter: /.*/, namespace: 'vscode-stub' }, () => ({
            contents: `export const l10n = {
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
    // 放在仓库内（out/ 不入库）：外部引用的 @yowasp/clang、binaryen 从仓库的 node_modules 解析
    const outfile = path.join(root, 'out', 'prebuild-web-examples.mjs');
    await esbuild.build({
        entryPoints: [path.join(__dirname, 'prebuild-web-examples.ts')],
        outfile,
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node20',
        external: ['@yowasp/clang', 'binaryen'],
        plugins: [vscodeStub],
        // 打包进来的 CommonJS 依赖仍会 require Node 内置模块；__dirname 指向脚本原位置
        banner: {
            js: [
                "import { createRequire as __createRequire } from 'module';",
                'const require = __createRequire(import.meta.url);',
                `const __dirname = ${JSON.stringify(__dirname)};`,
                `const __filename = ${JSON.stringify(path.join(__dirname, 'prebuild-web-examples.ts'))};`,
            ].join('\n'),
        },
        logLevel: 'warning',
    });
    await import(pathToFileURL(outfile).href);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
