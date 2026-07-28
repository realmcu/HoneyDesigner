import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

interface PerfSample {
    totalMs: number;
    hostMetrics: Record<string, number>;
    webviewMetrics: Record<string, number>;
}

interface PerfReport {
    schema: number;
    fixture: string;
    scenario: string;
    warmupRuns: number;
    samples: PerfSample[];
    summary: Record<string, number>;
    stages?: Record<string, { medianMs: number; p90Ms: number }>;
    counts?: Record<string, { median: number; p90: number }>;
    environment: Record<string, string>;
    projectSnapshot?: Record<string, string | number>;
}

interface PerfProject {
    path: string;
    entry?: string;
    injectSharedAssets: boolean;
    external: boolean;
}

const FIXTURES: Record<string, string> = {
    tiny: 'minimal-project',
    small: 'perf-small-project',
    medium: 'perf-medium-project',
    large: 'perf-large-project',
};

const EXTERNAL_PROJECTS: Record<string, { path: string; entry: string }> = {
    dashboard: {
        path: 'honeygui-template-dashboard',
        entry: 'ui/DashboardMain.hml',
    },
};

const EXTERNAL_COPY_EXCLUDES = new Set([
    '.git',
    '.github',
    '.claude',
    '.vscode',
    'build',
    'src',
]);

function argument(name: string, fallback: string): string {
    const index = process.argv.indexOf(name);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function readProjectEntry(projectPath: string): string | undefined {
    try {
        const config = JSON.parse(fs.readFileSync(path.join(projectPath, 'project.json'), 'utf8')) as {
            mainHmlFile?: string;
        };
        return config.mainHmlFile;
    } catch {
        return undefined;
    }
}

function resolveProject(extensionRoot: string, fixtureName: string): PerfProject {
    const projectArgument = argument('--project', '');
    if (projectArgument) {
        const projectPath = path.resolve(extensionRoot, projectArgument);
        return {
            path: projectPath,
            entry: argument('--entry', '') || readProjectEntry(projectPath),
            injectSharedAssets: false,
            external: true,
        };
    }

    const fixtureDir = FIXTURES[fixtureName];
    if (fixtureDir) {
        return {
            path: path.join(extensionRoot, 'src', 'test', 'fixtures', fixtureDir),
            entry: argument('--entry', '') || undefined,
            injectSharedAssets: true,
            external: false,
        };
    }

    const externalProject = EXTERNAL_PROJECTS[fixtureName];
    if (externalProject) {
        return {
            path: path.join(extensionRoot, externalProject.path),
            entry: argument('--entry', '') || externalProject.entry,
            injectSharedAssets: false,
            external: true,
        };
    }

    throw new Error(`未知 fixture: ${fixtureName}，可选值：${[
        ...Object.keys(FIXTURES),
        ...Object.keys(EXTERNAL_PROJECTS),
    ].join(', ')}，也可通过 --project 指定路径`);
}

function copyProject(sourcePath: string, targetPath: string, external: boolean): void {
    fs.cpSync(sourcePath, targetPath, {
        recursive: true,
        filter: source => !external || source === sourcePath ||
            !EXTERNAL_COPY_EXCLUDES.has(path.basename(source)),
    });
}

function gitValue(projectPath: string, args: string[]): string {
    const result = spawnSync('git', ['-C', projectPath, ...args], {
        encoding: 'utf8',
        windowsHide: true,
    });
    return result.status === 0 ? result.stdout.trim() : 'unknown';
}

function countProjectStructure(projectPath: string): { hmlFiles: number; components: number } {
    let hmlFiles = 0;
    let components = 0;
    const visit = (directory: string): void => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                visit(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.hml')) {
                hmlFiles += 1;
                const content = fs.readFileSync(fullPath, 'utf8');
                components += (content.match(/<hg_[a-z0-9_]+\b/g) || []).length;
            }
        }
    };
    const uiPath = path.join(projectPath, 'ui');
    if (fs.existsSync(uiPath)) {
        visit(uiPath);
    }
    return { hmlFiles, components };
}

function percentile(values: number[], ratio: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * ratio) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function summarize(values: number[]): Record<string, number> {
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

function aggregateStages(samples: PerfSample[]): Record<string, { medianMs: number; p90Ms: number }> {
    const values = new Map<string, number[]>();
    for (const sample of samples) {
        for (const metrics of [sample.hostMetrics, sample.webviewMetrics]) {
            for (const [name, value] of Object.entries(metrics || {})) {
                if (!name.endsWith('Ms') || typeof value !== 'number') { continue; }
                const list = values.get(name) || [];
                list.push(value);
                values.set(name, list);
            }
        }
    }
    return Object.fromEntries([...values].map(([name, stageValues]) => [name, {
        medianMs: percentile(stageValues, 0.5),
        p90Ms: percentile(stageValues, 0.9),
    }]));
}

function aggregateCounts(samples: PerfSample[]): Record<string, { median: number; p90: number }> {
    const names = ['hmlReads', 'hmlParses', 'prepareFrontendCalls'];
    return Object.fromEntries(names.map(name => {
        const values = samples.map(sample => sample.hostMetrics?.[name] || 0);
        return [name, {
            median: percentile(values, 0.5),
            p90: percentile(values, 0.9),
        }];
    }));
}

function runOne(
    extensionRoot: string,
    fixtureName: string,
    project: PerfProject,
    scenario: 'warm-fresh-panel' | 'cold-session',
    outputPath: string
): PerfReport {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), `honeygui-perf-${fixtureName}-`));
    copyProject(project.path, workspacePath, project.external);
    const sharedAssetsPath = path.join(extensionRoot, 'src', 'test', 'assets');
    if (project.injectSharedAssets && fs.existsSync(sharedAssetsPath)) {
        fs.cpSync(sharedAssetsPath, path.join(workspacePath, 'assets'), { recursive: true });
    }
    try {
        fs.rmSync(outputPath, { force: true });
        const child = spawnSync(
            process.execPath,
            [path.join(__dirname, 'runTest.js'), '--perf'],
            {
                cwd: extensionRoot,
                stdio: 'inherit',
                env: {
                    ...process.env,
                    TEST_WORKSPACE: workspacePath,
                    HONEYGUI_PERF_FIXTURE: fixtureName,
                    HONEYGUI_PERF_SCENARIO: scenario,
                    HONEYGUI_PERF_OUTPUT: outputPath,
                    HONEYGUI_PERF_ENTRY: project.entry || '',
                    HONEYGUI_PERF_EXTERNAL: project.external ? '1' : '0',
                },
            }
        );
        if (child.status !== 0) {
            throw new Error(`性能测试子进程失败，退出码 ${child.status}`);
        }
        return JSON.parse(fs.readFileSync(outputPath, 'utf8')) as PerfReport;
    } finally {
        fs.rmSync(workspacePath, { recursive: true, force: true });
    }
}

function compareReport(current: PerfReport, baselinePath: string): void {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as PerfReport;
    const oldMedian = baseline.summary.medianMs;
    const newMedian = current.summary.medianMs;
    const savedMs = oldMedian - newMedian;
    const improvement = oldMedian === 0 ? 0 : savedMs / oldMedian * 100;
    console.log(`[perf] 对比 median: ${oldMedian.toFixed(1)}ms → ${newMedian.toFixed(1)}ms，` +
        `减少 ${savedMs.toFixed(1)}ms，提升 ${improvement.toFixed(1)}%`);
}

function main(): void {
    delete process.env.ELECTRON_RUN_AS_NODE;
    const extensionRoot = path.resolve(__dirname, '../../..');
    const fixtureKey = argument('--fixture', 'tiny');
    const project = resolveProject(extensionRoot, fixtureKey);
    const scenarioArg = argument('--scenario', 'warm');
    if (scenarioArg !== 'warm' && scenarioArg !== 'cold') {
        throw new Error(`未知场景: ${scenarioArg}，可选值：warm, cold`);
    }
    const scenario = scenarioArg === 'cold' ? 'cold-session' : 'warm-fresh-panel';
    if (!fs.existsSync(project.path)) {
        throw new Error(`测试项目不存在: ${project.path}`);
    }
    if (!fs.existsSync(path.join(project.path, 'project.json'))) {
        throw new Error(`测试项目缺少 project.json: ${project.path}`);
    }
    if (project.entry && !fs.existsSync(path.join(project.path, project.entry))) {
        throw new Error(`测试入口不存在: ${path.join(project.path, project.entry)}`);
    }

    const structure = countProjectStructure(project.path);
    const projectSnapshot: Record<string, string | number> = {
        sourcePath: project.path,
        entry: project.entry || '',
        hmlFiles: structure.hmlFiles,
        components: structure.components,
    };
    if (project.external) {
        projectSnapshot.gitBranch = gitValue(project.path, ['branch', '--show-current']);
        projectSnapshot.gitCommit = gitValue(project.path, ['rev-parse', 'HEAD']);
        projectSnapshot.gitDirty = gitValue(project.path, ['status', '--porcelain']) ? 'true' : 'false';
    }

    const reportDir = path.join(extensionRoot, '.perf-results');
    fs.mkdirSync(reportDir, { recursive: true });
    const finalOutput = path.join(reportDir, `${fixtureKey}-${scenarioArg}.json`);

    let report: PerfReport;
    if (scenario === 'warm-fresh-panel') {
        report = runOne(extensionRoot, fixtureKey, project, scenario, finalOutput);
    } else {
        const samples: PerfSample[] = [];
        let environment: Record<string, string> = {};
        for (let run = 0; run < 7; run++) {
            const sampleOutput = path.join(reportDir, `.${fixtureKey}-cold-${run + 1}.json`);
            console.log(`[perf] cold session ${run + 1}/7`);
            const childReport = runOne(extensionRoot, fixtureKey, project, scenario, sampleOutput);
            samples.push(...childReport.samples);
            environment = childReport.environment;
            fs.rmSync(sampleOutput, { force: true });
        }
        report = {
            schema: 1,
            fixture: fixtureKey,
            scenario,
            warmupRuns: 0,
            samples,
            summary: summarize(samples.map(sample => sample.totalMs)),
            stages: aggregateStages(samples),
            counts: aggregateCounts(samples),
            environment,
        };
        fs.writeFileSync(finalOutput, JSON.stringify(report, null, 2), 'utf8');
    }

    report.projectSnapshot = projectSnapshot;
    fs.writeFileSync(finalOutput, JSON.stringify(report, null, 2), 'utf8');

    console.log(`[perf] project=${projectSnapshot.sourcePath} entry=${projectSnapshot.entry} ` +
        `hmlFiles=${projectSnapshot.hmlFiles} components=${projectSnapshot.components}`);
    if (project.external) {
        console.log(`[perf] source=${projectSnapshot.gitBranch}@${projectSnapshot.gitCommit} ` +
            `dirty=${projectSnapshot.gitDirty}`);
    }
    console.log(`[perf] ${fixtureKey}/${scenarioArg}: median=${report.summary.medianMs.toFixed(1)}ms ` +
        `p90=${report.summary.p90Ms.toFixed(1)}ms CV=${(report.summary.cv * 100).toFixed(1)}%`);
    console.log(`[perf] report=${finalOutput}`);

    const baselineOutput = argument('--save-baseline', '');
    if (baselineOutput) {
        if (report.summary.cv > 0.15) {
            throw new Error(`CV ${(report.summary.cv * 100).toFixed(1)}% > 15%，拒绝保存不稳定基线`);
        }
        const target = path.resolve(baselineOutput);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(finalOutput, target);
        console.log(`[perf] baseline=${target}`);
    }

    const baselinePath = argument('--compare', '');
    if (baselinePath) {
        compareReport(report, path.resolve(baselinePath));
    }
}

main();
