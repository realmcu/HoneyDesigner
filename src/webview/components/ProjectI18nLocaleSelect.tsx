import React from 'react';
import { Languages, Plus, Search, Check } from 'lucide-react';
import { ensureLocale } from '../../project-i18n/catalog';
import {
  LOCALE_PRESETS,
  localeDisplayName,
  matchLocalePreset,
} from '../../project-i18n/localePresets';
import { useDesignerStore } from '../store';
import { t, getLocale } from '../i18n';

const LOCALE_PATTERN = /^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})*$/;

function cloneCatalog<T>(catalog: T): T {
  return JSON.parse(JSON.stringify(catalog)) as T;
}

const ProjectI18nLocaleSelect: React.FC = () => {
  const {
    projectI18nCatalog,
    previewLocale,
    setPreviewLocale,
    updateProjectI18nCatalog,
  } = useDesignerStore();

  const [isPickerOpen, setIsPickerOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [localeError, setLocaleError] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const uiLocale = getLocale();
  const normalizeLocale = (value: string) => value.trim().replace(/_/g, '-');

  const existingLower = React.useMemo(
    () => new Set(projectI18nCatalog.locales.map((locale) => locale.toLowerCase())),
    [projectI18nCatalog.locales],
  );

  const matchedPresets = React.useMemo(
    () =>
      LOCALE_PRESETS.filter(
        (preset) => !existingLower.has(preset.code.toLowerCase()) && matchLocalePreset(preset, query),
      ),
    [existingLower, query],
  );

  // 用户输入的、不在预置命中列表里的合法自定义代码 → 提供“添加自定义”入口
  const customCode = normalizeLocale(query);
  const customIsValid = Boolean(customCode) && LOCALE_PATTERN.test(customCode);
  const customAlreadyExists = existingLower.has(customCode.toLowerCase());
  const customMatchesPreset = matchedPresets.some(
    (preset) => preset.code.toLowerCase() === customCode.toLowerCase(),
  );
  const showCustomEntry = Boolean(customCode) && !customMatchesPreset;

  const closePicker = () => {
    setIsPickerOpen(false);
    setQuery('');
    setLocaleError('');
  };

  const addLocale = (raw: string) => {
    const locale = normalizeLocale(raw);
    if (!locale) {
      return;
    }

    if (!LOCALE_PATTERN.test(locale)) {
      setLocaleError(t('Invalid locale code'));
      return;
    }

    // 已存在：直接切到该语言预览即可
    if (existingLower.has(locale.toLowerCase())) {
      const existing = projectI18nCatalog.locales.find(
        (item) => item.toLowerCase() === locale.toLowerCase(),
      );
      setPreviewLocale(existing || locale);
      closePicker();
      return;
    }

    const nextCatalog = cloneCatalog(projectI18nCatalog);
    ensureLocale(nextCatalog, locale);
    updateProjectI18nCatalog(nextCatalog, { save: true, immediate: true });
    setPreviewLocale(locale);
    closePicker();
  };

  // 外部点击关闭
  React.useEffect(() => {
    if (!isPickerOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closePicker();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isPickerOpen]);

  React.useEffect(() => {
    if (isPickerOpen) {
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [isPickerOpen]);

  return (
    <div className="project-i18n-locale-select" ref={containerRef} title={t('Preview Language')}>
      <Languages size={14} strokeWidth={1.5} />
      <select
        aria-label={t('Preview Language')}
        value={previewLocale}
        onChange={(event) => setPreviewLocale(event.target.value)}
      >
        {projectI18nCatalog.locales.map((locale) => (
          <option key={locale} value={locale}>
            {locale}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="toolbar-icon-button project-i18n-add-locale"
        onClick={() => {
          if (isPickerOpen) {
            closePicker();
          } else {
            setQuery('');
            setLocaleError('');
            setIsPickerOpen(true);
          }
        }}
        title={t('Add Locale')}
      >
        <Plus size={14} strokeWidth={1.6} />
      </button>

      {isPickerOpen && (
        <div className="project-i18n-locale-picker" role="dialog" aria-label={t('Add Locale')}>
          <div className="project-i18n-locale-picker-search">
            <Search size={13} strokeWidth={1.6} />
            <input
              ref={searchInputRef}
              value={query}
              placeholder={t('Search language')}
              onChange={(event) => {
                setQuery(event.target.value);
                setLocaleError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  if (showCustomEntry && customIsValid) {
                    addLocale(customCode);
                  } else if (matchedPresets.length === 1) {
                    addLocale(matchedPresets[0].code);
                  }
                }
                if (event.key === 'Escape') {
                  closePicker();
                }
              }}
            />
          </div>

          {localeError && <div className="project-i18n-locale-picker-error">{localeError}</div>}

          <div className="project-i18n-locale-picker-list">
            {matchedPresets.map((preset) => (
              <button
                key={preset.code}
                type="button"
                className="project-i18n-locale-picker-item"
                onClick={() => addLocale(preset.code)}
              >
                <span className="picker-name">{localeDisplayName(preset, uiLocale)}</span>
                <span className="picker-code">{preset.code}</span>
              </button>
            ))}

            {matchedPresets.length === 0 && !showCustomEntry && (
              <div className="project-i18n-locale-picker-empty">{t('No matching language')}</div>
            )}
          </div>

          {showCustomEntry && (
            <button
              type="button"
              className={`project-i18n-locale-picker-custom ${customIsValid ? '' : 'invalid'}`}
              disabled={customAlreadyExists}
              onClick={() => addLocale(customCode)}
              title={customIsValid ? '' : t('Invalid locale code')}
            >
              {customIsValid ? <Plus size={13} strokeWidth={1.6} /> : null}
              <span className="picker-custom-label">
                {customAlreadyExists
                  ? t('Locale already added', customCode)
                  : t('Add custom locale', customCode)}
              </span>
              {customIsValid && !customAlreadyExists ? <Check size={13} strokeWidth={1.6} /> : null}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ProjectI18nLocaleSelect;
