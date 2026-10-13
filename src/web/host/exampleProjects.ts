import { AVAILABLE_TEMPLATES } from '../../template/TemplateConfig';

// The first web release offers only a checked-in Chat Bot snapshot.
const chatbot = AVAILABLE_TEMPLATES.find(template => template.id === 'chatbot');
if (!chatbot) throw new Error('Chat Bot template is not configured');

export const WEB_EXAMPLES = [{
    id: chatbot.id,
    name: chatbot.name,
    descriptionKey: 'template.chatbot.description',
    archive: 'examples/chatbot.zip',
    thumbnail: 'examples/chatbot.png',
}] as const;
