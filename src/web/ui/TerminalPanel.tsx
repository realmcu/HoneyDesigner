/**
 * 工作台底部的本机终端面板：xterm.js 渲染，经 WebSocket 连接 tools/web-terminal 启动的本机 shell。
 * 协议见 tools/web-terminal/server.js。连不上本机服务时显示安装引导。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { t } from '../../webview/i18n';
import {
    TERMINAL_PORT,
    TERMINAL_PROTOCOL,
    TERMINAL_DOWNLOAD_URL,
    NODE_DOWNLOAD_URL,
    loadTerminalCredential,
    saveTerminalCredential,
    clearTerminalCredential,
} from '../host/terminalConnection';

interface TerminalPanelProps {
    height: number;
    onResizeStart(event: React.PointerEvent): void;
    onClose(): void;
}

type Status =
    | { kind: 'connecting' }
    | { kind: 'pairing' }
    | { kind: 'connected'; cwd: string }
    | { kind: 'unreachable' }
    | { kind: 'closed'; reason: string };

/** 与 server.js 的 CLOSE 一致 */
const CLOSE_PAIRING_REJECTED = 4002;
const CLOSE_PAIRING_BUSY = 4003;
const CLOSE_PROTOCOL_MISMATCH = 4005;

/** 与 web.css 中的 Dark Modern 主题一致 */
const THEME = {
    background: '#181818',
    foreground: '#cccccc',
    cursor: '#cccccc',
    selectionBackground: '#264f78',
};

function closeReason(code: number): string {
    switch (code) {
        case 1000: return t('The shell has exited.');
        case CLOSE_PAIRING_REJECTED: return t('Pairing was rejected on this computer.');
        case CLOSE_PAIRING_BUSY: return t('Another pairing request is pending or was just rejected. Try again shortly.');
        case CLOSE_PROTOCOL_MISMATCH: return t('The terminal service is outdated. Download the latest package.');
        default: return t('Disconnected from the terminal service.');
    }
}

function InstallGuide({ onRetry }: { onRetry(): void }) {
    return (
        <div className="web-terminal-guide">
            <p className="web-terminal-guide-title">{t('Terminal service not detected')}</p>
            <p className="web-muted">{t('The terminal runs commands on this computer through a small local service. Windows only for now.')}</p>
            <ol>
                <li>{t('Install Node.js 18 or later.')} <a href={NODE_DOWNLOAD_URL} target="_blank" rel="noreferrer">nodejs.org</a></li>
                <li>{t('Download and extract the HoneyGUI Terminal package.')} <a href={TERMINAL_DOWNLOAD_URL}>{t('Download')}</a></li>
                <li>{t('Double-click "Start HoneyGUI Terminal.cmd" in the extracted folder and keep its window open.')}</li>
                <li>{t('Click Retry. Allow local access if the browser asks, then confirm pairing in the dialog on this computer.')}</li>
            </ol>
            <button className="web-button primary" onClick={onRetry}>{t('Retry')}</button>
        </div>
    );
}

export function TerminalPanel({ height, onResizeStart, onClose }: TerminalPanelProps) {
    const hostRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<{ term: Terminal; fit: FitAddon } | null>(null);
    const [status, setStatus] = useState<Status>({ kind: 'connecting' });
    const [session, setSession] = useState(0);

    // xterm 只在终端打开时按需加载，不进入设计器首屏
    useEffect(() => {
        let disposed = false;
        let created: { term: Terminal; fit: FitAddon } | null = null;
        void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(([{ Terminal }, { FitAddon }]) => {
            if (disposed || !hostRef.current) {
                return;
            }
            const term = new Terminal({
                fontFamily: 'Consolas, "Cascadia Mono", "Courier New", monospace',
                fontSize: 13,
                cursorBlink: true,
                theme: THEME,
            });
            const fit = new FitAddon();
            term.loadAddon(fit);
            term.open(hostRef.current);
            fit.fit();
            created = { term, fit };
            termRef.current = created;
            setSession(n => n + 1);
        });
        return () => {
            disposed = true;
            created?.term.dispose();
            termRef.current = null;
        };
    }, []);

    // session 变化时（终端就绪、点击重试）建立一次新连接，对应本机一个新 shell
    useEffect(() => {
        const current = termRef.current;
        if (!current || session === 0) {
            return;
        }
        const { term, fit } = current;
        const socket = new WebSocket(`ws://127.0.0.1:${TERMINAL_PORT}`);
        let opened = false;
        const send = (message: object) => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify(message));
            }
        };
        setStatus({ kind: 'connecting' });
        term.reset();

        socket.onopen = () => {
            opened = true;
            send({ type: 'hello', protocol: TERMINAL_PROTOCOL, credential: loadTerminalCredential(), cols: term.cols, rows: term.rows });
        };
        socket.onmessage = event => {
            let message: { type?: unknown; data?: unknown; cwd?: unknown; credential?: unknown };
            try {
                message = JSON.parse(String(event.data));
            } catch {
                return;
            }
            if (message.type === 'output' && typeof message.data === 'string') {
                term.write(message.data);
            } else if (message.type === 'ready') {
                setStatus({ kind: 'connected', cwd: String(message.cwd) });
                fit.fit();
                term.focus();
            } else if (message.type === 'pairing') {
                setStatus({ kind: 'pairing' });
            } else if (message.type === 'paired' && typeof message.credential === 'string') {
                saveTerminalCredential(message.credential);
            }
        };
        // 服务未运行，或用户在浏览器的本机访问授权中点了屏蔽，连接都会在打开前失败
        socket.onclose = event => setStatus(opened ? { kind: 'closed', reason: closeReason(event.code) } : { kind: 'unreachable' });
        const input = term.onData(data => send({ type: 'input', data }));
        const resize = term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));
        return () => {
            input.dispose();
            resize.dispose();
            socket.onclose = null;
            socket.close();
        };
    }, [session]);

    // 面板高度或窗口尺寸变化时重新计算终端行列数
    useEffect(() => {
        const host = hostRef.current;
        if (!host) {
            return;
        }
        const observer = new ResizeObserver(() => termRef.current?.fit.fit());
        observer.observe(host);
        return () => observer.disconnect();
    }, []);

    const reconnect = useCallback(() => setSession(n => n + 1), []);

    /** 清除本页面保存的凭证并断开；下次连接需要重新在本机确认 */
    const unpair = useCallback(() => {
        if (globalThis.confirm(t('Unpair this browser from the terminal service? Next time you will need to confirm on this computer again.'))) {
            clearTerminalCredential();
            setSession(n => n + 1);
        }
    }, []);

    const statusText = status.kind === 'connecting' ? t('Connecting...')
        : status.kind === 'pairing' ? t('Waiting for confirmation on this computer...')
        : status.kind === 'connected' ? status.cwd
        : status.kind === 'unreachable' ? t('Terminal service not detected')
        : status.reason;

    return (
        <div className="web-terminal" style={{ height }}>
            <div className="web-terminal-resizer" onPointerDown={onResizeStart} />
            <div className="web-terminal-header">
                <span className="web-terminal-title">{t('Terminal')}</span>
                <span className={`web-terminal-status web-terminal-status-${status.kind}`} title={statusText}>{statusText}</span>
                <span className="web-topbar-spacer" />
                {status.kind === 'closed' && (
                    <button className="web-button" onClick={reconnect}>{t('Reconnect')}</button>
                )}
                {status.kind === 'connected' && loadTerminalCredential() && (
                    <button className="web-button" onClick={unpair}>{t('Unpair')}</button>
                )}
                <button className="web-icon-button" aria-label={t('Close')} title={t('Close')} onClick={onClose}>×</button>
            </div>
            <div className="web-terminal-body">
                <div className="web-terminal-xterm" ref={hostRef} />
                {status.kind === 'unreachable' && <InstallGuide onRetry={reconnect} />}
            </div>
        </div>
    );
}
