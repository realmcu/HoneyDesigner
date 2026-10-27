/**
 * 浮动仿真窗口：构建进度、引擎画布、日志，以及快速预览看不到的内容。
 * 窗口可拖动、可收起；收起后不影响仿真继续运行。
 */
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Home, CornerUpLeft, AlignJustify, Power } from 'lucide-react';
import { simulationUi } from '../sim/simulationUi';
import type { SimulationMode } from '../sim/simulationService';
import type { SimKey } from '../sim/engineHost';
import type { PreviewGap } from '../../simulation/HmlPreviewPrep';
import { t } from '../../webview/i18n';

const STAGE_LABEL: Record<string, string> = {
    codegen: 'Generating code...',
    assets: 'Converting resources...',
    toolchain: 'Loading compiler...',
    compile: 'Compiling...',
    romfs: 'Compiling resource package...',
    link: 'Linking...',
    start: 'Starting simulator...',
};

/** 每类最多列出的名称，其余折叠为「…」 */
const MAX_GAP_NAMES = 6;

export interface SimulationWindowProps {
    /** 仿真画布挂载点：运行时由 browserHost 取走 canvas 交给引擎 */
    onCanvas(canvas: HTMLCanvasElement | null): void;
    onStop(): void;
    /** 以指定方式重新开始仿真 */
    onRestart(mode: SimulationMode): void;
    /** 硬件按键，与桌面模拟器底部的 Home / Back / Menu / Power 一致 */
    onKey(key: SimKey): void;
}

/** 底部硬件按键：图标与桌面模拟器一致，顺序也一致（Home / Back / Menu / Power） */
const HARDWARE_KEYS: Array<{ key: SimKey; icon: React.ComponentType<{ size?: number }>; label: 'Home' | 'Back' | 'Menu' | 'Power'; shortcut: string }> = [
    { key: 'home', icon: Home, label: 'Home', shortcut: 'Home' },
    { key: 'back', icon: CornerUpLeft, label: 'Back', shortcut: 'Esc / Backspace' },
    { key: 'menu', icon: AlignJustify, label: 'Menu', shortcut: 'M' },
    { key: 'power', icon: Power, label: 'Power', shortcut: 'P' },
];

function useDrag(initial: { x: number; y: number }) {
    const [position, setPosition] = useState(initial);
    const drag = useRef<{ dx: number; dy: number } | undefined>(undefined);

    const onPointerDown = (event: React.PointerEvent) => {
        if ((event.target as HTMLElement).closest('button, select')) {
            return;
        }
        drag.current = { dx: event.clientX - position.x, dy: event.clientY - position.y };
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: React.PointerEvent) => {
        if (!drag.current) {
            return;
        }
        const x = Math.min(Math.max(0, event.clientX - drag.current.dx), window.innerWidth - 80);
        const y = Math.min(Math.max(0, event.clientY - drag.current.dy), window.innerHeight - 40);
        setPosition({ x, y });
    };
    const onPointerUp = () => { drag.current = undefined; };

    return { position, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } };
}

/** 窗口除画布外的宽度：左右内边距与边框 */
const WINDOW_CHROME_WIDTH = 22;
const WINDOW_MIN_WIDTH = 280;

/**
 * 画面放大倍数：小屏放大到 2 倍以便看清，但最多占页面宽度的一半（留出设计器），
 * 高度留出标题栏、提示与边距。
 */
function fitScale(width: number, height: number, viewport: { w: number; h: number }): number {
    const availableWidth = Math.min(viewport.w * 0.5, viewport.w - 48);
    const availableHeight = viewport.h - 220;
    const scale = Math.min(2, availableWidth / width, availableHeight / height);
    return Math.max(0.25, Math.floor(scale * 4) / 4);
}

function gapNames(gaps: PreviewGap[], kind: PreviewGap['kind']): string {
    const names = gaps.filter(gap => gap.kind === kind).map(gap => gap.name);
    return names.length > MAX_GAP_NAMES ? `${names.slice(0, MAX_GAP_NAMES).join(', ')} …(+${names.length - MAX_GAP_NAMES})` : names.join(', ');
}

function PreviewGaps({ gaps, onFull }: { gaps: PreviewGap[]; onFull(): void }) {
    const rows: Array<[PreviewGap['kind'], 'Components: {0}' | 'C functions not run: {0}' | 'Attributes ignored: {0}']> = [
        ['component', 'Components: {0}'],
        ['function', 'C functions not run: {0}'],
        ['attribute', 'Attributes ignored: {0}'],
    ];
    return (
        <details className="web-sim-gaps">
            <summary>{t('Not shown in quick preview')} ({gaps.length})</summary>
            {rows.map(([kind, label]) => {
                const names = gapNames(gaps, kind);
                return names ? <div key={kind} className="web-sim-gap-row">{t(label, names)}</div> : null;
            })}
            <button className="web-button" onClick={onFull}>{t('Run full simulation')}</button>
        </details>
    );
}

export function SimulationWindow({ onCanvas, onStop, onRestart, onKey }: SimulationWindowProps) {
    const state = useSyncExternalStore(simulationUi.subscribe, simulationUi.getSnapshot);
    // 初始位置在工具栏下方的右侧，避免盖住工具栏按钮
    const { position, handlers } = useDrag({ x: Math.max(12, window.innerWidth - 560), y: 110 });
    const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });
    useEffect(() => {
        const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    const [showLog, setShowLog] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const logRef = useRef<HTMLPreElement>(null);

    const { phase, open, log, mode, gaps } = state;
    const building = phase.kind === 'building';

    useEffect(() => {
        if (!building) {
            return;
        }
        const started = phase.startedAt;
        setElapsed(0);
        const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
        return () => clearInterval(timer);
    }, [building, building ? phase.startedAt : 0]);

    useEffect(() => {
        if (showLog && logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [showLog, log.length]);

    if (phase.kind === 'idle') {
        return null;
    }

    const close = () => {
        onStop();
        simulationUi.reset();
    };

    const scale = phase.kind === 'running' ? fitScale(phase.width, phase.height, viewport) : 1;
    const canvasSize = phase.kind === 'running' ? { width: phase.width * scale, height: phase.height * scale } : undefined;
    // 放大后的画面不能把窗口（连同标题栏按钮）推出页面右侧
    const windowWidth = Math.max(WINDOW_MIN_WIDTH, (canvasSize?.width ?? 0) + WINDOW_CHROME_WIDTH);
    const left = Math.max(0, Math.min(position.x, viewport.w - windowWidth - 12));

    return (
        <div className="web-sim-window" style={{ left, top: position.y }} role="dialog" aria-label={t('Simulator')}>
            <div className="web-sim-titlebar" {...handlers}>
                <span className="web-sim-title">{t('Simulator')}</span>
                <select
                    className="web-sim-mode"
                    aria-label={t('Simulation mode')}
                    title={mode === 'preview'
                        ? t('Runs the HML directly. Starts in seconds and follows your saves; project C code does not run.')
                        : t('Compiles the project C code in the browser, like the desktop simulator. The first run downloads the compiler (about 105 MB).')}
                    value={mode}
                    disabled={building}
                    onChange={event => onRestart(event.target.value as SimulationMode)}
                >
                    <option value="preview">{t('Quick Preview')}</option>
                    <option value="full">{t('Full Simulation')}</option>
                </select>
                <span className="web-topbar-spacer" />
                <button className="web-icon-button" aria-label={t('Show log')} title={t('Show log')} onClick={() => setShowLog(v => !v)}>≡</button>
                <button className="web-icon-button" aria-label={open ? t('Collapse') : t('Expand')} onClick={() => simulationUi.setOpen(!open)}>{open ? '–' : '□'}</button>
                <button className="web-icon-button" aria-label={t('Stop')} title={t('Stop Simulation')} onClick={close}>×</button>
            </div>

            {/* 收起时只隐藏、不卸载：引擎持有 canvas，卸载会让仿真失去画面 */}
            <div className="web-sim-body" hidden={!open}>
                {building && (
                    <div className="web-sim-progress" role="status">
                        <div className="web-sim-stage">
                            {t(STAGE_LABEL[phase.progress.stage] as never)}
                            {phase.progress.detail ? <span className="web-muted"> {phase.progress.detail}</span> : null}
                        </div>
                        <div className="web-sim-bar"><div className="web-sim-bar-fill" style={{ width: `${Math.round((phase.progress.fraction ?? 0) * 100)}%` }} /></div>
                        <div className="web-muted">{t('Elapsed {0}s', elapsed)}</div>
                        {phase.progress.stage === 'toolchain' && <div className="web-muted">{t('The first build downloads the compiler (about 105 MB). It is cached for next time.')}</div>}
                    </div>
                )}

                {phase.kind === 'error' && (
                    <div className="web-sim-error" role="alert">
                        <div className="web-field-error">{phase.message}</div>
                        <button className="web-button" onClick={() => setShowLog(true)}>{t('Show log')}</button>
                    </div>
                )}

                <canvas
                    ref={onCanvas}
                    className="web-sim-canvas"
                    style={canvasSize ?? { display: 'none' }}
                />

                {phase.kind === 'running' && (
                    <div className="web-sim-keys" role="group" aria-label={t('Hardware keys')}>
                        {HARDWARE_KEYS.map(({ key, icon: Icon, label, shortcut }) => (
                            <button key={key} className="web-sim-key" title={`${t(label)} (${shortcut})`}
                                aria-label={t(label)} onClick={() => onKey(key)}>
                                <Icon size={18} />
                            </button>
                        ))}
                    </div>
                )}

                {phase.kind === 'running' && mode === 'preview' && (
                    <>
                        <div className="web-muted">{t('Updates when you save.')}</div>
                        {gaps.length > 0 && <PreviewGaps gaps={gaps} onFull={() => onRestart('full')} />}
                    </>
                )}

                {showLog && <pre ref={logRef} className="web-sim-log">{log.join('\n')}</pre>}
            </div>
        </div>
    );
}
