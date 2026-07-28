import { performance } from 'perf_hooks';

export interface HmlHostPerformanceMetrics {
    htmlMs?: number;
    currentParseMs?: number;
    webviewBootMs?: number;
    projectConfigMs?: number;
    projectScanMs?: number;
    loadPrepareMs?: number;
    retryWaitMs?: number;
    hmlReads?: number;
    hmlParses?: number;
    prepareFrontendCalls?: number;
}

export interface HmlLoadPerformanceContext {
    loadId: string;
    filePath: string;
    startedAt: number;
    htmlCompletedAt?: number;
    metrics: HmlHostPerformanceMetrics;
}

let nextLoadSequence = 0;

export function createHmlLoadPerformanceContext(filePath: string): HmlLoadPerformanceContext | undefined {
    if (process.env.HONEYGUI_PERF_TEST !== '1') {
        return undefined;
    }

    nextLoadSequence += 1;
    return {
        loadId: `${process.pid}-${nextLoadSequence}`,
        filePath,
        startedAt: performance.now(),
        metrics: {
            retryWaitMs: 0,
            hmlReads: 0,
            hmlParses: 0,
            prepareFrontendCalls: 0,
        },
    };
}

export function measurePerformance<T>(callback: () => T): { value: T; durationMs: number } {
    const startedAt = performance.now();
    const value = callback();
    return { value, durationMs: performance.now() - startedAt };
}
