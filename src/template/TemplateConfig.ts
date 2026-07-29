/**
 * 模板配置
 */
export interface TemplateInfo {
    id: string;
    name: string;
    description: string;
    descriptionKey: string;  // 国际化 key
    repo: string;
    size?: string;
}

/**
 * 可用模板列表
 */
export const AVAILABLE_TEMPLATES: TemplateInfo[] = [
    {
        id: 'smartwatch',
        name: 'Smart Watch',
        description: '智能手表界面，包含完整资源（字体、图片、3D模型、视频）',
        descriptionKey: 'template.smartwatch.description',
        repo: 'https://gitee.com/realmcu/honeygui-template-smartwatch.git',
        size: '20 MB'
    },
    {
        id: 'dashboard',
        name: 'Car Dashboard',
        description: '汽车仪表盘界面，包含仪表盘UI资源',
        descriptionKey: 'template.dashboard.description',
        repo: 'https://gitee.com/realmcu/honeygui-template-dashboard.git',
        size: '20 MB'
    },
    {
        id: 'chatbot',
        name: 'Chat Bot',
        description: '聊天机器人界面（轻量级）',
        descriptionKey: 'template.chatbot.description',
        repo: 'https://gitee.com/realmcu/honeygui-template-chatbot.git',
        size: '20 MB'
    },
    {
        id: 'rotary',
        name: 'Rotary Knob',
        description: '旋钮控制界面（轻量级）',
        descriptionKey: 'template.rotary.description',
        repo: 'https://gitee.com/realmcu/honeygui-template-rotary.git',
        size: '20 MB'
    },
    {
        id: 'settings',
        name: 'Settings',
        description: '设置界面（轻量级）',
        descriptionKey: 'template.settings.description',
        repo: 'https://gitee.com/realmcu/honeygui-template-settings.git',
        size: '20 MB'
    },
    {
        id: 'ebadge',
        name: 'E-Badge',
        description: '电子胸牌界面，包含蓝牙连接、菜单、分享页面及动画视频资源',
        descriptionKey: 'template.ebadge.description',
        repo: 'https://github.com/realmcu/honeygui-template-EBadge.git',
        size: '20 MB'
    }
];

/**
 * 模板缓存目录
 */
export const TEMPLATE_CACHE_DIR = '.honeygui/templates';
