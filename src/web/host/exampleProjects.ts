import { AVAILABLE_TEMPLATES } from '../../template/TemplateConfig';
import type { LocaleKey } from '../../webview/i18n';

/**
 * 首页「示例工程」卡片：覆盖全部官方模板。
 *
 * chatbot / dashboard 的快照随站点打包（archive），点开直接导入；其余模板没有内置包，
 * 点开时走「从 GitHub 打开」的下载流程。缩略图统一放在 src/web/examples/<id>.png，
 * 缺图时卡片显示占位。
 */
const BUNDLED_ARCHIVES: Record<string, string> = {
    chatbot: 'examples/chatbot.zip',
    dashboard: 'examples/dashboard.zip',
};

const EXAMPLE_TAGS: Record<string, LocaleKey> = {
    smartwatch: 'Wearable',
    dashboard: 'Dashboard',
    chatbot: 'Multi-page',
    rotary: 'Knob',
    ebadge: 'Badge',
};

export interface WebExample {
    id: string;
    name: string;
    tagKey: LocaleKey;
    descriptionKey: LocaleKey;
    thumbnail: string;
    /** 内置快照；为空表示需要从 GitHub 下载 */
    archive?: string;
    /** GitHub 镜像地址，供下载流程使用 */
    url: string;
}

export const WEB_EXAMPLES: WebExample[] = AVAILABLE_TEMPLATES.map(template => ({
    id: template.id,
    name: template.name,
    tagKey: EXAMPLE_TAGS[template.id] ?? 'Multi-page',
    // TemplateConfig 里是普通 string；这些 key 在两份 locale 中都已存在
    descriptionKey: template.descriptionKey as LocaleKey,
    thumbnail: `examples/${template.id}.png`,
    archive: BUNDLED_ARCHIVES[template.id],
    url: toGitHubMirrorUrl(template.repo),
}));

// 内置包缺了说明模板 id 改过，构建期就报出来
for (const id of Object.keys(BUNDLED_ARCHIVES)) {
    if (!WEB_EXAMPLES.some(example => example.id === id)) throw new Error(`Web example template "${id}" is not configured`);
}

/** 从内置示例打开的工程记下的来源标识（StoredProject.sourceKey） */
const EXAMPLE_SOURCE_PREFIX = 'example:';

export function exampleSourceKey(id: string): string {
    return `${EXAMPLE_SOURCE_PREFIX}${id}`;
}

/**
 * 内置示例或从 GitHub 下载的官方模板。两者都由 CI 预编译过（prebuild-web-examples），
 * 默认用完整仿真；快速预览不执行工程 C 代码，模板里靠代码实现的效果会缺失。
 */
export function isExampleProject(project: { sourceKey?: string }): boolean {
    const key = project.sourceKey?.toLowerCase();
    if (!key) return false;
    if (key.startsWith(EXAMPLE_SOURCE_PREFIX)) return true;
    // 与 githubSourceKey 的格式一致：github.com/<owner>/<repo>[/<rootPath>]
    return GITHUB_TEMPLATES.some(template => {
        const base = template.url.replace(/^https:\/\//, '').toLowerCase();
        return key === base || key.startsWith(`${base}/`);
    });
}

/**
 * 「从 GitHub 打开」下拉里的官方模板。
 *
 * 直接复用 AVAILABLE_TEMPLATES，不另外维护一份清单：Gitee 地址在浏览器里取不到，
 * 统一换成 GitHub 上同名的 realmcu 镜像（与 CI 克隆模板用的地址一致）。
 */
export const GITHUB_TEMPLATES = AVAILABLE_TEMPLATES.map(template => ({
    id: template.id,
    name: template.name,
    // TemplateConfig 里是普通 string；这些 key 在两份 locale 中都已存在
    descriptionKey: template.descriptionKey as LocaleKey,
    url: toGitHubMirrorUrl(template.repo),
}));

function toGitHubMirrorUrl(repo: string): string {
    const name = repo.replace(/\.git$/i, '').split('/').pop() ?? '';
    return `https://github.com/realmcu/${name}`;
}
