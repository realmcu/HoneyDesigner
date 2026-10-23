/**
 * 仿真窗口的状态存储：命令处理（browserHost）写入，SimulationWindow 订阅渲染。
 * 与 hostUi 同样的极简订阅模式，避免为一个浮动窗口引入额外的状态库。
 */
import type { SimulationMode, SimulationProgress } from './simulationService';
import type { PreviewGap } from '../../simulation/HmlPreviewPrep';

export type SimulationPhase =
    | { kind: 'idle' }
    | { kind: 'building'; progress: SimulationProgress; startedAt: number }
    | { kind: 'running'; width: number; height: number }
    | { kind: 'error'; message: string };

export interface SimulationState {
    phase: SimulationPhase;
    mode: SimulationMode;
    /** 快速预览中看不到的内容（完整仿真为空） */
    gaps: PreviewGap[];
    /** 引擎与构建日志（最近若干行） */
    log: string[];
    /** 窗口是否展开（构建中、运行中都可以收起；出错时强制展开） */
    open: boolean;
}

const MAX_LOG_LINES = 400;

let state: SimulationState = { phase: { kind: 'idle' }, mode: 'preview', gaps: [], log: [], open: false };
const listeners = new Set<() => void>();

function set(next: Partial<SimulationState>): void {
    state = { ...state, ...next };
    listeners.forEach(listener => listener());
}

export const simulationUi = {
    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },

    getSnapshot(): SimulationState {
        return state;
    },

    begin(mode: SimulationMode): void {
        set({
            phase: { kind: 'building', progress: { stage: mode === 'full' ? 'codegen' : 'assets' }, startedAt: Date.now() },
            mode,
            gaps: [],
            log: [],
            open: true,
        });
    },

    progress(progress: SimulationProgress): void {
        if (state.phase.kind === 'building') {
            set({ phase: { ...state.phase, progress } });
        }
    },

    running(width: number, height: number, mode: SimulationMode, gaps: PreviewGap[]): void {
        set({ phase: { kind: 'running', width, height }, mode, gaps });
    },

    setGaps(gaps: PreviewGap[]): void {
        set({ gaps });
    },

    fail(message: string): void {
        set({ phase: { kind: 'error', message }, open: true });
    },

    reset(): void {
        set({ phase: { kind: 'idle' }, gaps: [], open: false });
    },

    setOpen(open: boolean): void {
        set({ open });
    },

    appendLog(text: string): void {
        const log = state.log.length >= MAX_LOG_LINES ? state.log.slice(-MAX_LOG_LINES + 1) : state.log.slice();
        log.push(text);
        set({ log });
    },
};
