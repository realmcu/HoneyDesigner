import { AVAILABLE_TEMPLATES } from '../../template/TemplateConfig';

const chatbot = AVAILABLE_TEMPLATES.find(template => template.id === 'chatbot');
if (!chatbot) throw new Error('Chat Bot template is not configured');

// Curated, checked-in snapshots only; never fetch template repositories from the browser.
export const WEB_EXAMPLES = [
    {
        id: chatbot.id,
        name: chatbot.name,
        descriptionKey: chatbot.descriptionKey,
        archive: 'examples/chatbot.zip',
        thumbnail: 'examples/chatbot.png',
    },
] as const;
