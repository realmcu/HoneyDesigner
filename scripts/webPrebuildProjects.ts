/**
 * 网页版预构建脚本（prebuild-web-examples / prebuild-web-videos）共用的工程清单：
 * 官方模板（GitHub 镜像，与「从 GitHub 打开」的下拉一致）与内置示例。
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { unzipSync } from 'fflate';
import { GITHUB_TEMPLATES } from '../src/web/host/exampleProjects';

export interface PrebuildProject {
    label: string;
    root: string;
    /** template：外部仓库，出错只告警；example：随站点发布，出错必须修 */
    kind: 'template' | 'example';
}

const examplesDir = path.resolve(__dirname, '..', 'src', 'web', 'examples');

/** 与 src/web/host/projectZip.ts 相同：最浅的 project.json 所在目录是工程根 */
export function findProjectRoot(dir: string): string | undefined {
    let level = [dir];
    while (level.length > 0) {
        const hit = level.find(d => fs.existsSync(path.join(d, 'project.json')));
        if (hit) {
            return hit;
        }
        level = level.flatMap(d => fs.readdirSync(d, { withFileTypes: true })
            .filter(e => e.isDirectory() && e.name !== '.git' && e.name !== 'node_modules' && e.name !== '__MACOSX')
            .map(e => path.join(d, e.name)));
    }
    return undefined;
}

function unzipTo(zip: string, dest: string): void {
    for (const [entry, data] of Object.entries(unzipSync(new Uint8Array(fs.readFileSync(zip))))) {
        if (entry.endsWith('/') || entry.startsWith('__MACOSX/')) {
            continue;
        }
        const file = path.join(dest, entry);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, data);
    }
}

/**
 * 克隆官方模板、解开内置示例到 work 下。
 * 模板克隆失败只告警（只影响这个模板在浏览器里的预构建产物），不让整个部署失败。
 */
export function collectProjects(work: string, logPrefix: string): PrebuildProject[] {
    const projects: PrebuildProject[] = [];
    for (const template of GITHUB_TEMPLATES) {
        const dest = path.join(work, `template-${template.id}`);
        try {
            execFileSync('git', ['clone', '--depth', '1', '--quiet', `${template.url}.git`, dest], { stdio: 'inherit' });
        } catch {
            console.warn(`${logPrefix}: warning: failed to clone ${template.url}, skipped`);
            continue;
        }
        const root = findProjectRoot(dest);
        if (root) {
            projects.push({ label: template.id, root, kind: 'template' });
        }
    }
    if (fs.existsSync(examplesDir)) {
        for (const zip of fs.readdirSync(examplesDir).filter(name => name.endsWith('.zip')).sort()) {
            const dest = path.join(work, `example-${path.basename(zip, '.zip')}`);
            unzipTo(path.join(examplesDir, zip), dest);
            const root = findProjectRoot(dest);
            if (root) {
                projects.push({ label: `example ${zip}`, root, kind: 'example' });
            }
        }
    }
    return projects;
}
