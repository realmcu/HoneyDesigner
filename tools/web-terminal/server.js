#!/usr/bin/env node
/**
 * HoneyGUI 浏览器版设计器的本机终端服务（开发预览）
 *
 * 设计器页面通过 WebSocket 连接本服务，本服务用 node-pty 在本机启动 shell 并转发输入输出。
 * 只监听 127.0.0.1，连接必须同时满足：
 * - Host 是本服务地址（防 DNS rebinding）
 * - Origin 是启动时指定的设计器站点（WebSocket 不受 CORS 约束，必须在升级阶段自己校验）
 * - 首条消息携带已配对的凭证；没有凭证时由本机用户在弹窗中确认配对，确认后下发长期凭证
 *
 * 协议（JSON 文本帧），协议版本不一致时以 4005 关闭：
 *   页面 -> 服务  { type: 'hello', protocol, credential?, cols, rows } 必须是第一条消息
 *                 { type: 'input', data } / { type: 'resize', cols, rows }
 *   服务 -> 页面  { type: 'pairing' } 等待本机确认 / { type: 'paired', credential }
 *                 { type: 'ready', cwd, shell } / { type: 'output', data } / { type: 'exit', code }
 *
 * 用法：node server.js [--cwd <目录>] [--site <设计器地址>] [--no-open]
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');

/** 与页面 src/web/ui/TerminalPanel.tsx 一致，页面写死了端口和协议版本 */
const PORT = 38913;
const PROTOCOL_VERSION = 1;
const DEFAULT_SITE = 'https://realmcu.github.io/HoneyDesigner/';
const HELLO_TIMEOUT_MS = 5000;
const PAIRING_TIMEOUT_MS = 60 * 1000;
/** 拒绝配对后的冷却时间，避免页面反复弹窗 */
const PAIRING_COOLDOWN_MS = 10 * 1000;
const MAX_CREDENTIALS = 20;
const MAX_INPUT_CHARS = 64 * 1024;
const CONFIG_FILE = path.join(os.homedir(), '.honeygui', 'web-terminal.json');

const CLOSE = {
    BAD_MESSAGE: 4000,
    HELLO_TIMEOUT: 4001,
    PAIRING_REJECTED: 4002,
    PAIRING_BUSY: 4003,
    PROTOCOL_MISMATCH: 4005,
};

function loadConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function updateConfig(changes) {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...loadConfig(), ...changes }, null, 2));
}

function isDirectory(dir) {
    return fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true;
}

/** shell 起始目录：命令行参数 > 上次记住的目录 > 用户主目录。命令行指定的目录会被记住 */
function resolveCwd(requested) {
    if (requested) {
        const dir = path.resolve(requested);
        if (!isDirectory(dir)) {
            throw new Error(`Not a directory: ${dir}`);
        }
        updateConfig({ cwd: dir });
        return dir;
    }
    const remembered = loadConfig().cwd;
    return typeof remembered === 'string' && isDirectory(remembered) ? remembered : os.homedir();
}

/** localhost 与 127.0.0.1 是不同的 origin，设计器从任一地址打开都放行 */
function siteOrigins(site) {
    const url = new URL(site);
    const origins = new Set([url.origin]);
    const alias = { localhost: '127.0.0.1', '127.0.0.1': 'localhost' }[url.hostname];
    if (alias) {
        url.hostname = alias;
        origins.add(url.origin);
    }
    return origins;
}

function defaultShell() {
    return process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/bash');
}

/**
 * 经 npm run 启动时，环境里带有 npm_* 变量，PATH 前面还插入了设计器仓库的 node_modules/.bin。
 * 不去掉的话，终端里执行的 npm、tsc 等命令会受设计器仓库影响。
 */
function shellEnv() {
    const env = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (/^npm_/i.test(key) || key === 'INIT_CWD') {
            continue;
        }
        env[key] = /^path$/i.test(key)
            ? value.split(path.delimiter).filter(dir => !/([\\/]node_modules[\\/]\.bin|node-gyp-bin)[\\/]?$/i.test(dir)).join(path.delimiter)
            : value;
    }
    return env;
}

const hashCredential = credential => crypto.createHash('sha256').update(credential).digest();

/** 配置文件只保存凭证的 SHA-256，泄露配置文件不等于泄露凭证 */
function isPairedCredential(credential) {
    if (typeof credential !== 'string' || !credential) {
        return false;
    }
    const actual = hashCredential(credential);
    const stored = loadConfig().credentials;
    return Array.isArray(stored) && stored.some(entry => {
        const expected = Buffer.from(String(entry?.sha256 ?? ''), 'hex');
        return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    });
}

function addCredential(origin) {
    const credential = crypto.randomBytes(32).toString('base64url');
    const stored = loadConfig().credentials;
    const credentials = [...(Array.isArray(stored) ? stored : []), {
        sha256: hashCredential(credential).toString('hex'),
        origin,
        createdAt: new Date().toISOString(),
    }].slice(-MAX_CREDENTIALS);
    updateConfig({ credentials });
    return credential;
}

/**
 * 请本机用户确认配对，返回 { result: Promise<boolean>, cancel() }。
 * Windows 弹出置顶确认框；其他系统在服务控制台询问。
 */
function askPairing(origin) {
    const message = `网页 ${origin} 请求使用本机终端。\n`
        + '允许后，该网页可以用你的身份执行任意命令。只有在你本人刚刚点击了设计器的“终端”按钮时才允许。\n\n'
        + `The web page ${origin} is requesting a terminal on this computer. `
        + 'Once allowed, it can run any command as you. Allow only if you just clicked Terminal in the designer yourself.';
    if (process.platform === 'win32') {
        // 文本经环境变量传入，不拼进 PowerShell 脚本
        const script = 'Add-Type -AssemblyName System.Windows.Forms;'
            + '[System.Windows.Forms.MessageBox]::Show($env:HONEYGUI_PAIR_MESSAGE, $env:HONEYGUI_PAIR_TITLE,'
            + ' "YesNo", "Warning", "Button2", "DefaultDesktopOnly")';
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
            env: { ...process.env, HONEYGUI_PAIR_MESSAGE: message, HONEYGUI_PAIR_TITLE: 'HoneyGUI Terminal' },
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
        });
        let output = '';
        child.stdout.on('data', chunk => output += chunk);
        const result = new Promise(resolve => {
            child.on('error', () => resolve(false));
            child.on('close', () => resolve(output.trim() === 'Yes'));
        });
        return { result, cancel: () => child.kill() };
    }
    if (!process.stdin.isTTY) {
        return { result: Promise.resolve(false), cancel() {} };
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const result = new Promise(resolve => {
        rl.question(`\n${message}\nAllow? [y/N] `, answer => resolve(/^y(es)?$/i.test(answer.trim())));
        rl.on('close', () => resolve(false));
    });
    return { result: result.finally(() => rl.close()), cancel: () => rl.close() };
}

const isTerminalSize = value => Number.isInteger(value) && value > 0 && value <= 1000;

/**
 * 启动终端服务。
 * @param {{ cwd: string, site?: string, log?: (message: string) => void }} options
 * @returns {Promise<{ close(): Promise<void> }>}
 */
function startServer({ cwd, site = DEFAULT_SITE, log = console.log }) {
    const origins = siteOrigins(site);
    const hosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
    const sockets = new Set();
    let pairingInProgress = false;
    let pairingBlockedUntil = 0;

    const server = http.createServer((req, res) => {
        res.writeHead(404);
        res.end();
    });
    const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

    server.on('upgrade', (req, socket, head) => {
        const reason = !hosts.has(req.headers.host) ? `host ${req.headers.host}`
            : !origins.has(req.headers.origin) ? `origin ${req.headers.origin}`
            : null;
        if (reason) {
            log(`Rejected connection: ${reason}`);
            socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
            return;
        }
        wss.handleUpgrade(req, socket, head, ws => {
            sockets.add(ws);
            ws.on('close', () => sockets.delete(ws));
            acceptSession(ws, req.headers.origin);
        });
    });

    const send = (ws, message) => {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(message));
        }
    };

    function acceptSession(ws, origin) {
        let term;
        let exited = false;
        let greeted = false;
        let pairing;
        const helloTimer = setTimeout(() => ws.close(CLOSE.HELLO_TIMEOUT, 'hello timeout'), HELLO_TIMEOUT_MS);

        const startShell = (cols, rows) => {
            const shell = defaultShell();
            term = pty.spawn(shell, [], { name: 'xterm-256color', cols, rows, cwd, env: shellEnv() });
            log(`Shell started (pid ${term.pid}) in ${cwd}`);
            send(ws, { type: 'ready', cwd, shell });
            term.onData(data => send(ws, { type: 'output', data }));
            term.onExit(({ exitCode }) => {
                exited = true;
                log(`Shell exited (pid ${term.pid}, code ${exitCode})`);
                send(ws, { type: 'exit', code: exitCode });
                ws.close(1000);
            });
        };

        const pair = async (cols, rows) => {
            if (pairingInProgress || Date.now() < pairingBlockedUntil) {
                ws.close(CLOSE.PAIRING_BUSY, 'pairing busy');
                return;
            }
            pairingInProgress = true;
            log(`Pairing requested by ${origin}`);
            send(ws, { type: 'pairing' });
            pairing = askPairing(origin);
            const timer = setTimeout(() => pairing.cancel(), PAIRING_TIMEOUT_MS);
            const approved = await pairing.result;
            clearTimeout(timer);
            pairing = undefined;
            pairingInProgress = false;
            if (ws.readyState !== ws.OPEN) {
                return;
            }
            if (!approved) {
                pairingBlockedUntil = Date.now() + PAIRING_COOLDOWN_MS;
                log('Pairing rejected');
                ws.close(CLOSE.PAIRING_REJECTED, 'pairing rejected');
                return;
            }
            log(`Paired with ${origin}`);
            send(ws, { type: 'paired', credential: addCredential(origin) });
            startShell(cols, rows);
        };

        ws.on('message', raw => {
            let message;
            try {
                message = JSON.parse(raw.toString());
            } catch {
                ws.close(CLOSE.BAD_MESSAGE, 'bad message');
                return;
            }
            if (!greeted) {
                greeted = true;
                clearTimeout(helloTimer);
                if (message?.type !== 'hello') {
                    ws.close(CLOSE.BAD_MESSAGE, 'expected hello');
                    return;
                }
                if (message.protocol !== PROTOCOL_VERSION) {
                    log(`Rejected connection: protocol ${message.protocol}, expected ${PROTOCOL_VERSION}`);
                    ws.close(CLOSE.PROTOCOL_MISMATCH, `protocol ${PROTOCOL_VERSION}`);
                    return;
                }
                const cols = isTerminalSize(message.cols) ? message.cols : 80;
                const rows = isTerminalSize(message.rows) ? message.rows : 24;
                if (isPairedCredential(message.credential)) {
                    startShell(cols, rows);
                } else {
                    void pair(cols, rows);
                }
                return;
            }
            if (!term) {
                return;
            }
            if (message?.type === 'input' && typeof message.data === 'string' && message.data.length <= MAX_INPUT_CHARS) {
                term.write(message.data);
            } else if (message?.type === 'resize' && isTerminalSize(message.cols) && isTerminalSize(message.rows)) {
                term.resize(message.cols, message.rows);
            }
        });

        ws.on('close', () => {
            clearTimeout(helloTimer);
            pairing?.cancel();
            if (term && !exited) {
                term.kill();
            }
        });
    }

    return new Promise((resolve, reject) => {
        server.once('error', error => reject(error.code === 'EADDRINUSE'
            ? new Error(`Port ${PORT} is in use. Is another terminal service running?`)
            : error));
        server.listen(PORT, '127.0.0.1', () => {
            log(`Terminal service listening on 127.0.0.1:${PORT}, shell directory: ${cwd}`);
            log(`Accepting pages from: ${[...origins].join(', ')}`);
            resolve({
                close: () => new Promise(done => {
                    sockets.forEach(ws => ws.close(1001));
                    server.close(() => done());
                }),
            });
        });
    });
}

function openBrowser(url) {
    const [command, args] = process.platform === 'win32' ? ['cmd.exe', ['/c', 'start', '""', `"${url}"`]]
        : process.platform === 'darwin' ? ['open', [url]]
        : ['xdg-open', [url]];
    spawn(command, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: process.platform === 'win32' })
        .on('error', () => console.log(`Could not open the browser. Open this link manually: ${url}`))
        .unref();
}

function parseArgs(argv) {
    const args = { open: true };
    for (let i = 0; i < argv.length; i++) {
        const name = argv[i];
        if (name === '--no-open') {
            args.open = false;
        } else if (['--cwd', '--site'].includes(name) && i + 1 < argv.length) {
            args[name.slice(2)] = argv[++i];
        } else {
            throw new Error(`Unknown argument: ${name}`);
        }
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const site = args.site || DEFAULT_SITE;
    await startServer({ cwd: resolveCwd(args.cwd), site });
    console.log(`Keep this window open while using the terminal. Designer: ${site}`);
    if (args.open) {
        openBrowser(site);
    }
    process.on('SIGINT', () => process.exit(0));
}

if (require.main === module) {
    main().catch(error => {
        console.error(error.message);
        process.exit(1);
    });
}

module.exports = { startServer, resolveCwd, openBrowser, parseArgs };
