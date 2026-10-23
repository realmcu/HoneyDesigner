#!/usr/bin/env node
/**
 * 准备浏览器版仿真所需的静态文件，输出到 dist/web/sim/（由 build:web 之后调用）：
 *
 *   sim/engine/           预编译的引擎主模块 gui.js / gui.wasm 与 web_sim.js（快速预览只需要它）
 *   sim/clang/            WASM 版 clang / wasm-ld（来自 npm 包 @yowasp/clang，约 105 MB，完整仿真按需下载）
 *   sim/binaryen/         binaryen.js（来自 npm 包 binaryen），对链接产物做 Asyncify 变换
 *   sim/toolchain.pack    编译用头文件：引擎头文件 + 系统 C 头文件 + clang 内置头文件
 *   sim/toolchain.json    上面头文件包的统计
 *
 * 引擎来自 HoneyGUI 的 simulator/web（.config_engine + -DWEB_SIM_MAIN_MODULE=ON），由
 * scripts/build-web-engine.js 构建到 lib/web-sim/。路径也可以用环境变量指定：
 *
 *   HONEYGUI_WEB_ENGINE   含 gui.js、gui.wasm、web_sim.js 的目录
 *   HONEYGUI_WEB_INCLUDE  引擎头文件目录（lib/emscripten/install/include 或 lib/web-sim/include）
 *   HONEYGUI_EMSDK_SYSROOT_INCLUDE  Emscripten 的 sysroot/include（取其中的 C 头文件）
 *
 * --preview-only：只部署引擎（快速预览），不打包编译器与头文件；页面中的完整仿真不可用。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist', 'web', 'sim');
const previewOnly = process.argv.includes('--preview-only');

const engineDir = process.env.HONEYGUI_WEB_ENGINE || path.join(root, 'lib', 'web-sim', 'engine');
const engineInclude = process.env.HONEYGUI_WEB_INCLUDE || path.join(root, 'lib', 'web-sim', 'include');
const sysrootInclude = process.env.HONEYGUI_EMSDK_SYSROOT_INCLUDE || path.join(root, 'lib', 'web-sim', 'sysroot-include');

/**
 * clang 内置头文件里，C 代码会用到的只有「独立环境」那一小组（stddef / stdint / stdbool / float / limits ...）。
 * 其余约 200 个是各种 SIMD / GPU 内联函数头文件，单个就有几百 KB，对这个引擎的 C 代码无用。
 */
const CLANG_BUILTIN_HEADERS = /^include\/(__stddef_.*|__float_.*|stddef|stdint|stdbool|stdarg|float|limits|iso646|inttypes|stdalign|stdnoreturn|varargs|endian|unwind|wasm_simd128)\.h$/;

/** 浏览器里用不到的头文件目录：C++ 标准库、图形/窗口系统等 */
const SKIPPED_SYSROOT_DIRS = new Set(['c++', 'SDL', 'GL', 'GLES', 'GLES2', 'GLES3', 'GLFW', 'X11', 'sanitizer', 'AL', 'EGL', 'KHR', 'html5', 'emscripten', 'fakesdl', 'xcb', 'webgl']);

function copyFile(src, dst) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
}

/** 单个文件（不是目录）缺失：诊断信息由 hint 给出，然后退出 */
function requireFile(file, what, hint) {
    if (!fs.existsSync(file)) {
        console.error(`prepare-web-sim: ${what} not found: ${file}`);
        hint();
        process.exit(1);
    }
}

function walk(dir, visit, base = dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, visit, base);
        } else {
            visit(full, path.relative(base, full).split(path.sep).join('/'));
        }
    }
}

function requireDir(dir, what, hint) {
    if (!fs.existsSync(dir)) {
        console.error(`prepare-web-sim: ${what} not found: ${dir}\n  ${hint}`);
        process.exit(1);
    }
}

function size(dir) {
    let total = 0;
    walk(dir, full => { total += fs.statSync(full).size; });
    return (total / 1048576).toFixed(1);
}

function copyEngine() {
    requireDir(engineDir, 'engine build', 'Run "node scripts/build-web-engine.js", or set HONEYGUI_WEB_ENGINE.');
    for (const file of ['gui.js', 'gui.wasm', 'web_sim.js']) {
        const src = path.join(engineDir, file);
        if (!fs.existsSync(src)) {
            console.error(`prepare-web-sim: missing engine file ${src}`);
            process.exit(1);
        }
        copyFile(src, path.join(out, 'engine', file));
    }
}

function copyCompiler() {
    requireDir(engineInclude, 'engine headers', 'Run "node scripts/build-web-engine.js", or set HONEYGUI_WEB_INCLUDE.');
    requireDir(sysrootInclude, 'system headers', 'Point HONEYGUI_EMSDK_SYSROOT_INCLUDE at emsdk upstream/emscripten/cache/sysroot/include.');

    // 包的 exports 没有开放 package.json，直接按 node_modules 的位置找
    const clangGen = path.join(root, 'node_modules', '@yowasp', 'clang', 'gen');
    requireDir(clangGen, '@yowasp/clang', 'Run "npm install".');

    // 1. 编译器（原样复制 bundle 与 wasm / 资源包，Worker 按相对路径加载）
    const clangFiles = ['bundle.js', 'llvm.core.wasm', 'llvm.core2.wasm', 'llvm.core3.wasm', 'llvm.core4.wasm', 'llvm-resources.tar'];
    for (const file of clangFiles) {
        requireFile(path.join(clangGen, file), `@yowasp/clang gen/${file}`, () => {
            console.error('prepare-web-sim: upgrading @yowasp/clang may have moved its files; update clangFiles here and the loader paths in src/web/sim/buildWorker.ts.');
        });
        copyFile(path.join(clangGen, file), path.join(out, 'clang', file));
    }

    // 链接后给 project.wasm 做 Asyncify 变换的 binaryen.js（单文件 ES 模块，约 15 MB）
    const binaryen = path.join(root, 'node_modules', 'binaryen', 'index.js');
    requireFile(binaryen, 'binaryen', () => {
        console.error('  Run "npm install".');
    });
    copyFile(binaryen, path.join(out, 'binaryen', 'index.js'));

    // 2. 头文件：engine/ sysroot/ clangres/（buildWorker 里 -I / -isystem 的目录名）
    const index = [];
    const put = (src, rel) => {
        copyFile(src, path.join(out, 'toolchain', rel));
        index.push(rel);
    };
    walk(engineInclude, (full, rel) => put(full, `engine/${rel}`));
    walk(sysrootInclude, (full, rel) => {
        if (!SKIPPED_SYSROOT_DIRS.has(rel.split('/')[0])) {
            put(full, `sysroot/include/${rel}`);
        }
    });
    // clang 内置头文件（stddef.h、stdint.h、stdbool.h ...）在 llvm-resources.tar 的 include/ 下，
    // 编译器运行时会把它挂在 /usr；这里另存一份，供 -nostdinc 的最小头文件路径使用。
    const resources = unpackTar(fs.readFileSync(path.join(clangGen, 'llvm-resources.tar')));
    for (const [name, data] of resources) {
        if (CLANG_BUILTIN_HEADERS.test(name)) {
            const dst = path.join(out, 'toolchain', 'clangres', name);
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.writeFileSync(dst, data);
            index.push(`clangres/${name}`);
        }
    }
    // 打成一个归档：几百个小文件的请求在 GitHub Pages 上很慢，一个压缩过的包只要一次请求
    const archive = packHeaders(path.join(out, 'toolchain'), index.sort());
    fs.rmSync(path.join(out, 'toolchain'), { recursive: true, force: true });
    fs.writeFileSync(path.join(out, 'toolchain.pack'), archive);
    fs.writeFileSync(path.join(out, 'toolchain.json'), JSON.stringify({ files: index.length, bytes: archive.length }));
    return { headers: index.length, packed: archive.length };
}

/**
 * 把引擎加入 Service Worker 的预缓存清单（webpack 生成，不知道 sim/ 的存在），离线时也能快速预览。
 * 版本号并入引擎内容的哈希：只换引擎时 Service Worker 也会更新缓存。
 * 编译器（约 105 MB）不预缓存，完整仿真用到时才下载。
 */
function addEngineToPrecache() {
    const manifestPath = path.join(root, 'dist', 'web', 'precache-manifest.json');
    if (!fs.existsSync(manifestPath)) {
        console.warn('prepare-web-sim: precache-manifest.json not found, run "npm run build:web" first; the engine will not work offline');
        return;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const hash = require('crypto').createHash('sha256');
    const engineFiles = ['gui.js', 'gui.wasm', 'web_sim.js'].map(file => {
        hash.update(fs.readFileSync(path.join(out, 'engine', file)));
        return `./sim/engine/${file}`;
    });
    manifest.files = [...new Set([...manifest.files.filter(file => !file.startsWith('./sim/')), ...engineFiles])];
    manifest.version = `${String(manifest.version).split('-')[0]}-${hash.digest('hex').slice(0, 16)}`;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

function main() {
    fs.rmSync(out, { recursive: true, force: true });
    copyEngine();
    addEngineToPrecache();
    if (previewOnly) {
        console.log(`prepare-web-sim: engine ${size(path.join(out, 'engine'))} MB (preview only, no compiler)`);
        return;
    }
    const { headers, packed } = copyCompiler();
    console.log(`prepare-web-sim: clang ${size(path.join(out, 'clang'))} MB, headers ${headers} files -> ${(packed / 1024).toFixed(0)} KiB packed, engine ${size(path.join(out, 'engine'))} MB`);
}

/**
 * 头文件包格式（buildWorker 里 unpackHeaders 解析）：
 *   [4 字节小端: 文件数] 然后每个文件 [2 字节路径长度][路径 UTF-8][4 字节内容长度][内容]
 * 整个包再整体 deflate 压缩，由服务器的 gzip 之外再减一次体积并免去解析 tar 的代码。
 */
function packHeaders(dir, files) {
    const zlib = require('zlib');
    const parts = [];
    const count = Buffer.alloc(4);
    count.writeUInt32LE(files.length);
    parts.push(count);
    for (const rel of files) {
        const name = Buffer.from(rel, 'utf8');
        const data = fs.readFileSync(path.join(dir, rel));
        const head = Buffer.alloc(2);
        head.writeUInt16LE(name.length);
        const size = Buffer.alloc(4);
        size.writeUInt32LE(data.length);
        parts.push(head, name, size, data);
    }
    return zlib.deflateRawSync(Buffer.concat(parts), { level: 9 });
}

/** 解析 ustar 归档，返回 [路径, 内容]（只处理普通文件；足够读取 llvm-resources.tar） */
function unpackTar(buffer) {
    const entries = new Map();
    let offset = 0;
    while (offset + 512 <= buffer.length) {
        const header = buffer.subarray(offset, offset + 512);
        if (header.every(b => b === 0)) { break; }
        const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
        const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
        const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8);
        const type = String.fromCharCode(header[156] || 48);
        offset += 512;
        if (type === '0' || type === '\0') {
            entries.set(prefix ? `${prefix}/${name}` : name, buffer.subarray(offset, offset + size));
        }
        offset += Math.ceil(size / 512) * 512;
    }
    return entries;
}

main();
