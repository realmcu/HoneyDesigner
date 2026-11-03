#!/usr/bin/env node
/**
 * 一键启动带本机终端的浏览器版设计器（开发预览）：
 *   1. webpack dev server（npm run serve:web，http://localhost:3100）
 *   2. tools/web-terminal 终端服务（只放行开发地址），并打开设计器页面
 * Ctrl+C 同时停止两者。
 *
 * 用法：npm run dev:web-terminal [-- --cwd <终端起始目录>]
 * 起始目录会被记住，下次可以省略。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TERMINAL_DIR = path.join(ROOT, 'tools', 'web-terminal');
const SITE = 'http://localhost:3100';

if (!fs.existsSync(path.join(TERMINAL_DIR, 'node_modules', 'node-pty'))) {
    console.error('The terminal service dependencies are not installed. Run first:\n  cd tools/web-terminal && npm install');
    process.exit(1);
}

const terminal = require(path.join(TERMINAL_DIR, 'server.js'));

async function main() {
    const args = terminal.parseArgs(process.argv.slice(2));
    const service = await terminal.startServer({ cwd: terminal.resolveCwd(args.cwd), site: SITE });

    const webpackCli = path.join(ROOT, 'node_modules', 'webpack-cli', 'bin', 'cli.js');
    const devServer = spawn(process.execPath, [webpackCli, 'serve', '--config', 'webpack.web.config.js', '--mode', 'development'], {
        cwd: ROOT,
        stdio: 'inherit',
    });

    console.log(`\nDesigner: ${SITE}\n`);
    // dev server 首次编译完成前，浏览器会等待页面响应
    if (args.open) {
        terminal.openBrowser(SITE);
    }

    let stopping = false;
    const stop = code => {
        if (stopping) {
            return;
        }
        stopping = true;
        devServer.kill();
        void service.close().then(() => process.exit(code));
    };
    devServer.on('exit', code => stop(code ?? 0));
    process.on('SIGINT', () => stop(0));
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
