import { AVAILABLE_TEMPLATES } from '../../template/TemplateConfig';
import type { LocaleKey } from '../../webview/i18n';

// Curated snapshots are bundled with the site; customers never fetch from Gitee.
const chatbot = AVAILABLE_TEMPLATES.find(template => template.id === 'chatbot');
const dashboard = AVAILABLE_TEMPLATES.find(template => template.id === 'dashboard');
if (!chatbot || !dashboard) throw new Error('Web example templates are not configured');

export const WEB_EXAMPLES = [
    {
        id: chatbot.id,
        name: chatbot.name,
        tagKey: 'Multi-page',
        descriptionKey: 'template.chatbot.description',
        archive: 'examples/chatbot.zip',
        thumbnail: 'examples/chatbot.png',
    },
    {
        id: dashboard.id,
        name: dashboard.name,
        tagKey: 'Dashboard',
        descriptionKey: 'template.dashboard.description',
        archive: 'examples/dashboard.zip',
        thumbnail: 'examples/dashboard.png',
    },
] as const;

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
