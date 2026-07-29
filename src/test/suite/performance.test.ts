import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

interface CanvasReadyReport {
    loadId: string;
    filePath: string;
    hostStartedAt: number;
    hostMetrics: Record<string, number>;
    webviewMetrics: Record<string, number>;
}

interface PerformanceSample extends CanvasReadyReport {
    totalMs: number;
}

function percentile(values: number[], ratio: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * ratio) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function summarize(values: number[]) {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
    const stddev = Math.sqrt(variance);
    return {
        medianMs: percentile(values, 0.5),
        p90Ms: percentile(values, 0.9),
        meanMs: mean,
        stddevMs: stddev,
        cv: mean === 0 ? 0 : stddev / mean,
    };
}

function aggregateCounts(samples: PerformanceSample[]) {
    const names = ['hmlReads', 'hmlParses', 'prepareFrontendCalls'];
    return Object.fromEntries(names.map(name => {
        const values = samples.map(sample => sample.hostMetrics?.[name] || 0);
        return [name, {
            median: percentile(values, 0.5),
            p90: percentile(values, 0.9),
        }];
    }));
}

function aggregateStages(samples: PerformanceSample[]) {
    const stages = new Map<string, number[]>();
    for (const sample of samples) {
        for (const metrics of [sample.hostMetrics, sample.webviewMetrics]) {
            for (const [name, value] of Object.entries(metrics || {})) {
                if (!name.endsWith('Ms') || typeof value !== 'number') { continue; }
                const values = stages.get(name) || [];
                values.push(value);
                stages.set(name, values);
            }
        }
    }
    return Object.fromEntries([...stages].map(([name, values]) => [name, {
        medianMs: percentile(values, 0.5),
        p90Ms: percentile(values, 0.9),
    }]));
}

async function measureOpen(hmlFile: vscode.Uri, run: number, runs: number): Promise<PerformanceSample> {
    const reportPromise = new Promise<CanvasReadyReport>((resolve, reject) => {
        const timeout = setTimeout(() => {
            disposable.dispose();
            reject(new Error(`等待 canvasReady 超时（run ${run + 1}/${runs}）`));
        }, 30000);
        const disposable = vscode.commands.registerCommand(
            '_honeygui.perf.canvasReady',
            (report: CanvasReadyReport) => {
                clearTimeout(timeout);
                disposable.dispose();
                resolve(report);
            }
        );
    });

    const openedAt = performance.now();
    await vscode.commands.executeCommand(
        'vscode.openWith',
        hmlFile,
        'honeygui.hmlEditor',
        vscode.ViewColumn.One
    );
    const report = await reportPromise;
    return { ...report, totalMs: performance.now() - openedAt };
}

suite('HML Canvas Performance', function () {
    this.timeout(180000);

    const enabled = process.env.HONEYGUI_PERF_TEST === '1';
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

    test('measure canvas ready', async function () {
        if (!enabled) { this.skip(); }

        const scenario = process.env.HONEYGUI_PERF_SCENARIO || 'warm-fresh-panel';
        const fixture = process.env.HONEYGUI_PERF_FIXTURE || path.basename(workspacePath);
        const hmlFiles = (await vscode.workspace.findFiles('ui/**/*.hml'))
            .sort((left, right) => left.fsPath.localeCompare(right.fsPath));
        assert.ok(hmlFiles.length > 0, '性能测试工作区必须包含 HML 文件');
        const configuredEntry = process.env.HONEYGUI_PERF_ENTRY;
        const entryFile = configuredEntry
            ? vscode.Uri.file(path.join(workspacePath, configuredEntry))
            : hmlFiles[0];
        assert.ok(fs.existsSync(entryFile.fsPath), `性能测试入口不存在: ${entryFile.fsPath}`);

        const expectedStructure: Record<string, { files: number; components: number }> = {
            tiny: { files: 1, components: 2 },
            small: { files: 1, components: 31 },
            medium: { files: 3, components: 113 },
            large: { files: 10, components: 331 },
        };
        const expected = expectedStructure[fixture];
        if (expected) {
            assert.strictEqual(hmlFiles.length, expected.files, `${fixture} fixture 的 HML 文件数发生变化`);
            const componentCount = hmlFiles.reduce((count, file) => {
                const content = fs.readFileSync(file.fsPath, 'utf8');
                return count + (content.match(/<hg_[a-z0-9_]+\b/g) || []).length;
            }, 0);
            assert.strictEqual(componentCount, expected.components, `${fixture} fixture 的组件数发生变化`);
        }

        const isCold = scenario === 'cold-session';
        // Webview bundle 的 JIT 在本机前 2～3 次仍有明显下降；Dashboard 图片较多，
        // 使用 30 个正式样本提高 p90 的稳定性，其他 fixture 保持 10 个正式样本。
        const warmupRuns = isCold ? 0 : 3;
        const measuredRuns = fixture === 'dashboard' ? 30 : 10;
        const runs = isCold ? 1 : warmupRuns + measuredRuns;
        const samples: PerformanceSample[] = [];

        for (let run = 0; run < runs; run++) {
            const sample = await measureOpen(entryFile, run, runs);
            samples.push(sample);
            console.log(`[perf] run ${run + 1}/${runs}: ${sample.totalMs.toFixed(1)}ms`);
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            await new Promise(resolve => setTimeout(resolve, 250));
        }

        const measured = samples.slice(warmupRuns);
        const summary = summarize(measured.map(sample => sample.totalMs));
        for (const sample of measured) {
            const webviewMetrics = sample.webviewMetrics || {};
            assert.strictEqual(webviewMetrics.imageTimedOut, false, '首屏图片等待超时');
            assert.strictEqual(webviewMetrics.imageFailed, 0, '首屏存在加载失败的图片');
            assert.strictEqual(
                webviewMetrics.imageCompleted,
                webviewMetrics.imageExpected,
                'canvasReady 前存在未完成加载或解码的首屏图片'
            );
        }

        const report = {
            schema: 1,
            fixture,
            scenario,
            warmupRuns,
            samples: measured,
            summary,
            stages: aggregateStages(measured),
            counts: aggregateCounts(measured),
            environment: {
                platform: process.platform,
                arch: process.arch,
                vscodeVersion: vscode.version,
                nodeVersion: process.version,
                cpu: os.cpus()[0]?.model || 'unknown',
                memoryBytes: os.totalmem(),
            },
        };

        const outputPath = process.env.HONEYGUI_PERF_OUTPUT ||
            path.join(workspacePath, '.perf', 'hml-canvas-load.json');
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');

        console.log(`[perf] median=${summary.medianMs.toFixed(1)}ms p90=${summary.p90Ms.toFixed(1)}ms ` +
            `cv=${(summary.cv * 100).toFixed(1)}%`);
        console.log(`[perf] report=${outputPath}`);
        if (!isCold && summary.cv > 0.15) {
            console.warn(`[perf] 环境不稳定：CV ${(summary.cv * 100).toFixed(1)}% > 15%，` +
                '报告已保留，但不能用于验收或覆盖基线');
        }
    });
});
