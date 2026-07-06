#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
// 'vscode' 是宿主进程运行时注入的特殊模块，没有对应的 node_modules 包，不需要校验
const BUILTINS = new Set([...Module.builtinModules, 'vscode']);
const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

// TODO: ToolsPanel.js 用 require('sharp') 做 PNG Alpha 通道精确检测，缺失时
// 已有 try/catch 保守 fallback（当作没有透明度），不会崩，但可能误判。是否要
// 把 sharp（原生库，预编译二进制通常 20-30MB+）正式加为依赖待评估，先放行
// 让打包不被这一项拦住。
const KNOWN_MISSING_DEPS = ['sharp'];

/**
 * 用 vsce ls 拿到「真正会随插件打包」的文件清单（不生成 vsix，只是 dry-run）。
 * 必须在 compile + build:webview 之后跑，否则看到的是上一次的旧产物。
 */
function getPackagedFiles() {
    // 直接用 node 跑 vsce 包自己的入口脚本，绕开 .bin/vsce(.cmd) 的 shell 包装
    // （Windows 上 execFileSync 调 .cmd 需要 shell: true，Node 会为此发安全警告）。
    const vsceEntry = path.join(ROOT, 'node_modules', '@vscode', 'vsce', 'vsce');
    const output = execFileSync(process.execPath, [vsceEntry, 'ls'], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 20,
    });
    return output.split('\n').map(line => line.trim()).filter(Boolean);
}

/**
 * "node_modules/fabric/dist/index.js" -> "fabric"
 * "node_modules/@resvg/resvg-wasm/index.js" -> "@resvg/resvg-wasm"
 */
function topLevelPackageOf(relPath) {
    const parts = relPath.split('/');
    if (parts[0] !== 'node_modules') return null;
    return parts[1].startsWith('@') ? `${parts[1]}/${parts[2]}` : parts[1];
}

/**
 * require('@scope/pkg/sub/path') -> "@scope/pkg"，require('./foo') -> null（相对路径不校验）
 */
function packageNameFromRequireArg(arg) {
    if (!arg || arg.startsWith('.') || path.isAbsolute(arg)) return null;
    const parts = arg.split('/');
    return arg.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

/**
 * 只扫描「我们自己的打包产物」（out/**、tools/lv-font-conv/** 等，排除 node_modules
 * 内部文件）里的 require() 调用，找出 extension host 直接依赖的第三方包名。
 * 不扫 node_modules 内部文件的原因：库自己嵌套的 node_modules 会被 Node 自身的
 * 向上查找机制满足，不需要（也不应该）靠正则扫压缩后的库源码去验证，容易把
 * license 注释、内部工具脚本里提到的包名误判成真实运行时依赖。
 * webview 走 webpack 单文件打包，require() 早被替换成内部模块 id，扫不到包名，
 * 天然就不会被计入「直接依赖」——这正是用来识别 webview-only 依赖的关键。
 */
function collectDirectlyRequired(files) {
    const required = new Set();
    for (const file of files) {
        if (!file.endsWith('.js') || file.startsWith('node_modules/')) continue;
        const fullPath = path.join(ROOT, file);
        if (!fs.existsSync(fullPath)) continue;

        const content = fs.readFileSync(fullPath, 'utf8');
        let match;
        while ((match = REQUIRE_RE.exec(content)) !== null) {
            const pkg = packageNameFromRequireArg(match[1]);
            if (pkg && !BUILTINS.has(pkg)) {
                required.add(pkg);
            }
        }
    }
    return required;
}

/**
 * 读某个已打包顶层依赖自己的 package.json，拿它自己声明的 dependencies。
 * 只看 dependencies，不看 devDependencies/optionalDependencies —— 那两类不保证被安装。
 */
function ownDependenciesOf(pkgName) {
    const pkgJsonPath = path.join(ROOT, 'node_modules', pkgName, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) return [];
    try {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        return Object.keys(pkgJson.dependencies || {});
    } catch {
        return [];
    }
}

function checkDependencies() {
    const files = getPackagedFiles();

    const shipped = new Set();
    for (const file of files) {
        const pkg = topLevelPackageOf(file);
        if (pkg) shipped.add(pkg);
    }

    const directlyRequired = collectDirectlyRequired(files);

    // 从「自己代码直接 require、且确实被打包」的依赖出发，沿着各包自己
    // package.json 里的 dependencies 字段做 BFS，得到整棵「真正需要」的闭包。
    const reachable = new Set();
    const queue = [...directlyRequired].filter(pkg => shipped.has(pkg));
    while (queue.length > 0) {
        const pkg = queue.shift();
        if (reachable.has(pkg)) continue;
        reachable.add(pkg);
        for (const dep of ownDependenciesOf(pkg)) {
            if (shipped.has(dep) && !reachable.has(dep)) {
                queue.push(dep);
            }
        }
    }

    const missing = [...directlyRequired]
        .filter(pkg => !shipped.has(pkg) && !KNOWN_MISSING_DEPS.includes(pkg))
        .sort();
    const unused = [...shipped].filter(pkg => !reachable.has(pkg)).sort();

    if (missing.length > 0) {
        console.error('❌ 以下模块被 require() 但没有随插件打包，运行时会 "Cannot find module":');
        missing.forEach(pkg => console.error(`  - ${pkg}`));
        console.error('\n请在 .vscodeignore 的 node_modules 白名单里补上:');
        missing.forEach(pkg => console.error(`!node_modules/${pkg}/**`));
    }

    if (unused.length > 0) {
        console.error(`${missing.length > 0 ? '\n' : ''}⚠️  以下依赖打包了，但既不被任何打包的 .js 直接 require()，也不是其他已打包依赖自身声明的 dependency（多余体积，很可能是 webview-only 依赖误加进了白名单，或是已经没人用的死依赖):`);
        unused.forEach(pkg => console.error(`  - ${pkg}`));
        console.error('\n请从 .vscodeignore 的 node_modules 白名单里删掉这些行；如果 package.json 里也没人 import，顺手从 dependencies 里删掉。');
    }

    if (missing.length === 0 && unused.length === 0) {
        console.log('✅ 打包依赖校验通过：require() 用到的模块和实际打包的 node_modules 完全对齐');
        return;
    }

    process.exit(1);
}

checkDependencies();
