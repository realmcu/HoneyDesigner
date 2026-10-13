import { AVAILABLE_TEMPLATES } from '../../template/TemplateConfig';

// Curated snapshots are bundled with the site; customers never fetch from Gitee.
const chatbot = AVAILABLE_TEMPLATES.find(template => template.id === 'chatbot');
const dashboard = AVAILABLE_TEMPLATES.find(template => template.id === 'dashboard');
if (!chatbot || !dashboard) throw new Error('Web example templates are not configured');

export const WEB_EXAMPLES = [
    {
        id: chatbot.id,
        name: chatbot.name,
        descriptionKey: 'template.chatbot.description',
        archive: 'examples/chatbot.zip',
        thumbnail: 'examples/chatbot.png',
    },
    {
        id: dashboard.id,
        name: dashboard.name,
        descriptionKey: 'template.dashboard.description',
        archive: 'examples/dashboard.zip',
        thumbnail: 'examples/dashboard.png',
    },
] as const;
