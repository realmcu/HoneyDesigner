/**
 * 页面侧的构建 Worker 客户端：发送构建请求、转发进度、返回 project.wasm。
 * Worker 只创建一次并复用，这样目标文件缓存在多次仿真之间保留。
 */
import type { BuildRequest, BuildResult, WorkerMessage } from './protocol';

export interface BuildCallbacks {
    onProgress?(message: Extract<WorkerMessage, { type: 'progress' }>): void;
}

export class BuildClient {
    private worker: Worker | undefined;

    /** createWorker 必须在调用处写成 new Worker(new URL('./buildWorker.ts', import.meta.url))，webpack 才会打包 Worker */
    constructor(private readonly createWorker: () => Worker) {}

    build(request: Omit<BuildRequest, 'cmd'>, callbacks: BuildCallbacks = {}): Promise<BuildResult> {
        const worker = this.ensureWorker();
        return new Promise<BuildResult>((resolve, reject) => {
            const cleanup = () => {
                worker.removeEventListener('message', onMessage);
                worker.removeEventListener('error', onError);
            };
            const onMessage = ({ data }: MessageEvent<WorkerMessage>) => {
                if (data.type === 'progress') {
                    callbacks.onProgress?.(data);
                } else if (data.type === 'done') {
                    cleanup();
                    resolve({ project: data.project, timings: data.timings });
                } else if (data.type === 'error') {
                    cleanup();
                    reject(new Error(data.message));
                }
            };
            const onError = (event: ErrorEvent) => {
                cleanup();
                // Worker 崩溃（通常是内存不足）后丢弃，下次重建；目标文件缓存随之丢失
                this.dispose();
                reject(new Error(event.message || 'Build worker crashed'));
            };
            worker.addEventListener('message', onMessage);
            worker.addEventListener('error', onError);
            worker.postMessage({ cmd: 'build', ...request } satisfies BuildRequest);
        });
    }

    /** 终止构建（用户取消）。丢弃 Worker 即可，缓存会丢，换来立刻停止 */
    cancel(): void {
        this.dispose();
    }

    dispose(): void {
        this.worker?.terminate();
        this.worker = undefined;
    }

    private ensureWorker(): Worker {
        if (!this.worker) {
            this.worker = this.createWorker();
        }
        return this.worker;
    }
}
