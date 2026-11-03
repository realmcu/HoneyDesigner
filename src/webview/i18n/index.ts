/**
 * Webview i18n - 简单的国际化工具
 * 通过 Extension 传递 locale 来切换语言
 */

import en from './locales/en';
import zhCN from './locales/zh-cn';

type LocaleMessages = typeof en;
export type LocaleKey = keyof LocaleMessages;

const locales: Record<string, LocaleMessages> = {
  'en': en,
  'zh-cn': zhCN,
  'zh-CN': zhCN,
};

let currentLocale = 'en';

/**
 * 设置当前语言
 */
export function setLocale(locale: string): void {
  currentLocale = locale.toLowerCase();
}

/**
 * 获取当前语言
 */
export function getLocale(): string {
  return currentLocale;
}

/**
 * 翻译函数
 * @param key 翻译键
 * @param args 替换参数 {0}, {1} 等
 */
export function t(key: LocaleKey, ...args: (string | number)[]): string {
  const messages = locales[currentLocale] || locales['en'];
  let text = messages[key] || en[key] || key;
  
  // 替换参数。使用函数式 replacement，避免参数中的 $&、$' 等被当作替换模式。
  args.forEach((arg, index) => {
    text = text.replace(`{${index}}`, () => String(arg));
  });

  return text;
}

export default { t, setLocale, getLocale };
