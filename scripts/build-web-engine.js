#!/usr/bin/env node
/**
 * 从 HoneyGUI SDK 构建浏览器仿真引擎，输出到 lib/web-sim/（之后由 prepare-web-sim.js 部署）：
 *
 *   lib/web-sim/engine/           gui.js / gui.wasm / web_sim.js（引擎主模块，含 HML 运行时）
 *   lib/web-sim/include/          完整仿真编译工程用的引擎头文件
 *   lib/web-sim/sysroot-include/  Emscripten 的 C 头文件（同上）
 *   lib/web-sim/VERSION           SDK 提交与 emsdk 版本
 *
 * 用法：node scripts/build-web-engine.js <HoneyGUI SDK 目录>
 * 需要已激活的 emsdk（emcmake / emcc 在 PATH 中，或设置 EMSDK）、CMake 与 Ninja。
 * 构建配置固定为 SDK 的 simulator/web/.config_engine + WEB_SIM_MAIN_MODULE=ON。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const sdk = path.resolve(process.argv[2] || process.env.HONEYGUI_SDK || '');
const out = path.join(root, 'lib', 'web-sim');
const isWindows = process.platform === 'win32';

function fail(message) {
    console.error(`build-web-engine: ${message}`);
    process.exit(1);
}

function run(command, args, options = {}) {
    console.log(`> ${command} ${args.join(' ')}`);
    execFileSync(command, args, { stdio: 'inherit', shell: isWindows, ...options });
}

function capture(command, args, options = {}) {
    return execFileSync(command, args, { encoding: 'utf8', shell: isWindows, ...options }).trim();
}

/** 浏览器里编译 C 工程用不到的 sysroot 头文件目录（与 prepare-web-sim.js 一致） */
const SKIPPED_SYSROOT_DIRS = new Set(['c++', 'SDL', 'GL', 'GLES', 'GLES2', 'GLES3', 'GLFW', 'X11', 'sanitizer', 'AL', 'EGL', 'KHR', 'html5', 'emscripten', 'fakesdl', 'xcb', 'webgl']);

/** 复制目录；filter 收到相对 src 的 POSIX 路径，返回 false 的文件不复制 */
function copyDir(src, dst, filter = () => true, base = src) {
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const from = path.join(src, entry.name);
        const to = path.join(dst, entry.name);
        if (entry.isDirectory()) {
            copyDir(from, to, filter, base);
        } else if (filter(path.relative(base, from).split(path.sep).join('/'))) {
            fs.mkdirSync(dst, { recursive: true });
            fs.copyFileSync(from, to);
        }
    }
}

/** emcc 所在目录（emsdk 激活后在 PATH 中；否则从 EMSDK 推出） */
function emscriptenDir() {
    if (process.env.EMSDK) {
        const dir = path.join(process.env.EMSDK, 'upstream', 'emscripten');
        if (fs.existsSync(dir)) {
            return dir;
        }
    }
    try {
        const found = capture(isWindows ? 'where' : 'which', ['emcc']).split(/\r?\n/)[0];
        return path.dirname(found);
    } catch {
        return fail('emcc not found. Activate emsdk (emsdk_env) or set EMSDK.');
    }
}

function main() {
    const webSim = path.join(sdk, 'simulator', 'web');
    if (!fs.existsSync(path.join(webSim, 'CMakeLists.txt'))) {
        fail(`HoneyGUI SDK not found: ${sdk || '(not given)'}\n  Usage: node scripts/build-web-engine.js <HoneyGUI SDK directory>`);
    }
    // 先看构建规则在不在：更早的 SDK 先要装 emsdk、构建完才发现装不出引擎
    if (!fs.readFileSync(path.join(webSim, 'CMakeLists.txt'), 'utf8').includes('install(FILES')) {
        fail(`${sdk} has no engine install rules in simulator/web/CMakeLists.txt: the HoneyGUI commit with the web simulator engine is not upstream yet`);
    }
    const emDir = emscriptenDir();
    // Windows 上 emsdk 提供 .exe 启动器
    const tool = name => {
        const file = path.join(emDir, isWindows ? `${name}.exe` : name);
        return fs.existsSync(file) ? file : name;
    };
    const emcmake = tool('emcmake');
    const buildDir = path.join(sdk, 'simulator', 'web', 'build-engine');
    const installDir = path.join(buildDir, 'install');

    // main.c 用 __DATE__/__TIME__ 打印构建时间。固定成 SDK 提交的时间，同一份源码才
    // 构建出相同的引擎（lib/web-sim 才比较得出「有没有变化」）
    let sdkCommit = 'unknown';
    const buildEnv = { ...process.env };
    try {
        sdkCommit = capture('git', ['-C', sdk, 'rev-parse', 'HEAD']);
        buildEnv.SOURCE_DATE_EPOCH = capture('git', ['-C', sdk, 'log', '-1', '--format=%ct']);
    } catch {
        // 不是 git 仓库：保留环境里的值（CI 会自己设置）
    }

    fs.rmSync(buildDir, { recursive: true, force: true });
    run(emcmake, [
        'cmake', '-S', webSim, '-B', buildDir, '-G', 'Ninja',
        `-DWEB_SIM_CONFIG=${path.join(webSim, '.config_engine')}`, '-DWEB_SIM_MAIN_MODULE=ON',
        // 去掉产物里的 SDK 检出路径：同一份源码在不同目录构建出相同引擎，lib/web-sim 才比较得出「有没有变化」
        `-DWEB_SIM_SOURCE_PREFIX_MAP=${sdk}`,
    ], { env: buildEnv });
    run('cmake', ['--build', buildDir], { env: buildEnv });
    run('cmake', ['--install', buildDir, '--prefix', installDir]);

    // 安装规则与 HML 接口（web_sim_load_hml，快速预览需要）一起加入 SDK，更早的 SDK 装不出可用的引擎。
    // 先检查再替换 lib/web-sim：失败时保留原来的引擎，CI 也不会提交坏的引擎
    const engineJs = path.join(installDir, 'engine', 'gui.js');
    if (!fs.existsSync(engineJs) || !fs.readFileSync(engineJs, 'utf8').includes('_web_sim_load_hml')) {
        fs.rmSync(buildDir, { recursive: true, force: true });
        fail(`${sdk} gave no engine with the HML runtime (web_sim_load_hml): its simulator/web predates the install rules, or .config_engine turns CONFIG_REALTEK_BUILD_XML_LOADER off`);
    }

    fs.rmSync(out, { recursive: true, force: true });
    copyDir(path.join(installDir, 'engine'), path.join(out, 'engine'));
    copyDir(path.join(installDir, 'include'), path.join(out, 'include'));

    // 完整仿真需要的 C 头文件。C++ 标准库、图形/窗口库与 SIMD 内联函数头文件（arm_neon.h
    // 一个就有 5 MB）用不到：生成代码与引擎头文件都不包含它们
    const sysroot = path.join(emDir, 'cache', 'sysroot', 'include');
    if (!fs.existsSync(sysroot)) {
        fail(`Emscripten sysroot not found: ${sysroot}`);
    }
    copyDir(sysroot, path.join(out, 'sysroot-include'), rel => {
        const top = rel.split('/')[0];
        return !SKIPPED_SYSROOT_DIRS.has(top) && !/^compat\/(arm_neon|\w*intrin)\.h$/.test(rel);
    });

    const emVersion = capture(tool('emcc'), ['--version']).split(/\r?\n/)[0];
    fs.writeFileSync(path.join(out, 'VERSION'), `HoneyGUI ${sdkCommit}\n${emVersion}\n`);
    fs.rmSync(buildDir, { recursive: true, force: true });
    console.log(`build-web-engine: done -> ${path.relative(root, out)}`);
}

main();
