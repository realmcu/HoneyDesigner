import type { LocaleCode } from './types';

/**
 * 预置语言集合（locale）项。
 *
 * - code:    BCP 47 语言代码（如 pt-PT），写入 catalog 的实际值
 * - nameEn:  英文名（设计器 UI 为英文时显示 / 用于英文搜索）
 * - nameZh:  中文名（设计器 UI 为中文时显示 / 用于中文搜索）
 * - endonym: 语言的本地写法（如 Português），仅用于搜索匹配，可选
 */
export interface LocalePreset {
    code: LocaleCode;
    nameEn: string;
    nameZh: string;
    endonym?: string;
}

/**
 * 主流语言预置表（BCP 47）。覆盖常见地区变体，方便不熟悉标准代码的用户直接挑选。
 * 列表之外的语言仍可在下拉里手动输入自定义代码。
 */
export const LOCALE_PRESETS: LocalePreset[] = [
    { code: 'en-US', nameEn: 'English (US)', nameZh: '英语（美国）', endonym: 'English' },
    { code: 'en-GB', nameEn: 'English (UK)', nameZh: '英语（英国）', endonym: 'English' },
    { code: 'zh-CN', nameEn: 'Chinese (Simplified)', nameZh: '简体中文', endonym: '简体中文' },
    { code: 'zh-TW', nameEn: 'Chinese (Traditional, Taiwan)', nameZh: '繁体中文（台湾）', endonym: '繁體中文' },
    { code: 'zh-HK', nameEn: 'Chinese (Traditional, Hong Kong)', nameZh: '繁体中文（香港）', endonym: '繁體中文' },
    { code: 'ja-JP', nameEn: 'Japanese', nameZh: '日语', endonym: '日本語' },
    { code: 'ko-KR', nameEn: 'Korean', nameZh: '韩语', endonym: '한국어' },
    { code: 'fr-FR', nameEn: 'French', nameZh: '法语', endonym: 'Français' },
    { code: 'de-DE', nameEn: 'German', nameZh: '德语', endonym: 'Deutsch' },
    { code: 'es-ES', nameEn: 'Spanish (Spain)', nameZh: '西班牙语（西班牙）', endonym: 'Español' },
    { code: 'es-MX', nameEn: 'Spanish (Mexico)', nameZh: '西班牙语（墨西哥）', endonym: 'Español' },
    { code: 'pt-PT', nameEn: 'Portuguese (Portugal)', nameZh: '葡萄牙语（葡萄牙）', endonym: 'Português' },
    { code: 'pt-BR', nameEn: 'Portuguese (Brazil)', nameZh: '葡萄牙语（巴西）', endonym: 'Português' },
    { code: 'it-IT', nameEn: 'Italian', nameZh: '意大利语', endonym: 'Italiano' },
    { code: 'ru-RU', nameEn: 'Russian', nameZh: '俄语', endonym: 'Русский' },
    { code: 'nl-NL', nameEn: 'Dutch', nameZh: '荷兰语', endonym: 'Nederlands' },
    { code: 'pl-PL', nameEn: 'Polish', nameZh: '波兰语', endonym: 'Polski' },
    { code: 'tr-TR', nameEn: 'Turkish', nameZh: '土耳其语', endonym: 'Türkçe' },
    { code: 'ar-SA', nameEn: 'Arabic', nameZh: '阿拉伯语', endonym: 'العربية' },
    { code: 'he-IL', nameEn: 'Hebrew', nameZh: '希伯来语', endonym: 'עברית' },
    { code: 'hi-IN', nameEn: 'Hindi', nameZh: '印地语', endonym: 'हिन्दी' },
    { code: 'bn-BD', nameEn: 'Bengali', nameZh: '孟加拉语', endonym: 'বাংলা' },
    { code: 'ta-IN', nameEn: 'Tamil', nameZh: '泰米尔语', endonym: 'தமிழ்' },
    { code: 'te-IN', nameEn: 'Telugu', nameZh: '泰卢固语', endonym: 'తెలుగు' },
    { code: 'ur-PK', nameEn: 'Urdu', nameZh: '乌尔都语', endonym: 'اردو' },
    { code: 'fa-IR', nameEn: 'Persian', nameZh: '波斯语', endonym: 'فارسی' },
    { code: 'th-TH', nameEn: 'Thai', nameZh: '泰语', endonym: 'ไทย' },
    { code: 'vi-VN', nameEn: 'Vietnamese', nameZh: '越南语', endonym: 'Tiếng Việt' },
    { code: 'id-ID', nameEn: 'Indonesian', nameZh: '印尼语', endonym: 'Bahasa Indonesia' },
    { code: 'ms-MY', nameEn: 'Malay', nameZh: '马来语', endonym: 'Bahasa Melayu' },
    { code: 'fil-PH', nameEn: 'Filipino', nameZh: '菲律宾语', endonym: 'Filipino' },
    { code: 'sv-SE', nameEn: 'Swedish', nameZh: '瑞典语', endonym: 'Svenska' },
    { code: 'da-DK', nameEn: 'Danish', nameZh: '丹麦语', endonym: 'Dansk' },
    { code: 'nb-NO', nameEn: 'Norwegian', nameZh: '挪威语', endonym: 'Norsk' },
    { code: 'fi-FI', nameEn: 'Finnish', nameZh: '芬兰语', endonym: 'Suomi' },
    { code: 'cs-CZ', nameEn: 'Czech', nameZh: '捷克语', endonym: 'Čeština' },
    { code: 'sk-SK', nameEn: 'Slovak', nameZh: '斯洛伐克语', endonym: 'Slovenčina' },
    { code: 'hu-HU', nameEn: 'Hungarian', nameZh: '匈牙利语', endonym: 'Magyar' },
    { code: 'ro-RO', nameEn: 'Romanian', nameZh: '罗马尼亚语', endonym: 'Română' },
    { code: 'el-GR', nameEn: 'Greek', nameZh: '希腊语', endonym: 'Ελληνικά' },
    { code: 'uk-UA', nameEn: 'Ukrainian', nameZh: '乌克兰语', endonym: 'Українська' },
    { code: 'bg-BG', nameEn: 'Bulgarian', nameZh: '保加利亚语', endonym: 'Български' },
    { code: 'hr-HR', nameEn: 'Croatian', nameZh: '克罗地亚语', endonym: 'Hrvatski' },
    { code: 'sr-RS', nameEn: 'Serbian', nameZh: '塞尔维亚语', endonym: 'Српски' },
    { code: 'ca-ES', nameEn: 'Catalan', nameZh: '加泰罗尼亚语', endonym: 'Català' },
    { code: 'sw-KE', nameEn: 'Swahili', nameZh: '斯瓦希里语', endonym: 'Kiswahili' },
];

const PRESET_BY_CODE = new Map<string, LocalePreset>(
    LOCALE_PRESETS.map((preset) => [preset.code.toLowerCase(), preset]),
);

/** 根据代码查找预置项（大小写不敏感）。 */
export function findLocalePreset(code: string): LocalePreset | undefined {
    return PRESET_BY_CODE.get(code.trim().toLowerCase());
}

/** 依设计器 UI 语言返回显示名（中文 UI 用中文名，其它用英文名）。 */
export function localeDisplayName(preset: LocalePreset, uiLocale: string): string {
    return uiLocale.toLowerCase().startsWith('zh') ? preset.nameZh : preset.nameEn;
}

/** 搜索匹配：代码 / 中文名 / 英文名 / 本地名 任一命中（大小写不敏感）。 */
export function matchLocalePreset(preset: LocalePreset, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) {
        return true;
    }
    return (
        preset.code.toLowerCase().includes(q) ||
        preset.nameEn.toLowerCase().includes(q) ||
        preset.nameZh.toLowerCase().includes(q) ||
        (preset.endonym ? preset.endonym.toLowerCase().includes(q) : false)
    );
}
