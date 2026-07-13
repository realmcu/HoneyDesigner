export type LocaleCode = string;
export type I18nKey = string;

export interface I18nCatalog {
    version: 1;
    defaultLocale: LocaleCode;
    locales: LocaleCode[];
    strings: Record<I18nKey, Partial<Record<LocaleCode, string>>>;
    /** 当前生效语言：驱动 Designer 画布预览与代码生成使用的文本语言。缺失/非法时回退 defaultLocale。 */
    activeLocale?: LocaleCode;
}

export type LocalizedTextSource = 'locale' | 'defaultLocale' | 'componentText' | 'componentName';

export interface LocalizedTextResolution {
    text: string;
    source: LocalizedTextSource;
    locale: LocaleCode;
    key?: I18nKey;
}

export type I18nDiagnosticSeverity = 'warning' | 'error';

export interface I18nDiagnostic {
    severity: I18nDiagnosticSeverity;
    code:
        | 'invalid-catalog'
        | 'empty-default-locale'
        | 'empty-locale'
        | 'empty-key'
        | 'missing-default-locale-translation'
        | 'missing-locale-translation'
        | 'unused-key';
    message: string;
    key?: I18nKey;
    locale?: LocaleCode;
}
