import React from 'react';
import { Languages, Plus } from 'lucide-react';
import { ensureLocale } from '../../project-i18n/catalog';
import { useDesignerStore } from '../store';
import { t } from '../i18n';

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

  const [isAddingLocale, setIsAddingLocale] = React.useState(false);
  const [newLocale, setNewLocale] = React.useState('');
  const [localeError, setLocaleError] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  const normalizeLocale = (value: string) => value.trim().replace(/_/g, '-');

  const commitNewLocale = () => {
    const locale = normalizeLocale(newLocale);
    if (!locale) {
      setIsAddingLocale(false);
      setLocaleError('');
      setNewLocale('');
      return;
    }

    if (!LOCALE_PATTERN.test(locale)) {
      setLocaleError(t('Invalid locale code'));
      return;
    }

    if (projectI18nCatalog.locales.includes(locale)) {
      setPreviewLocale(locale);
      setIsAddingLocale(false);
      setLocaleError('');
      setNewLocale('');
      return;
    }

    const nextCatalog = cloneCatalog(projectI18nCatalog);
    ensureLocale(nextCatalog, locale);
    updateProjectI18nCatalog(nextCatalog, { save: true, immediate: true });
    setPreviewLocale(locale);
    setIsAddingLocale(false);
    setLocaleError('');
    setNewLocale('');
  };

  React.useEffect(() => {
    if (isAddingLocale) {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isAddingLocale]);

  return (
    <div className="project-i18n-locale-select" title={t('Preview Language')}>
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
      {isAddingLocale ? (
        <input
          ref={inputRef}
          className={`project-i18n-locale-input ${localeError ? 'invalid' : ''}`}
          value={newLocale}
          placeholder="zh-CN"
          title={localeError || t('Enter locale code')}
          onChange={(event) => {
            setNewLocale(event.target.value);
            setLocaleError('');
          }}
          onBlur={commitNewLocale}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitNewLocale();
            }
            if (event.key === 'Escape') {
              setIsAddingLocale(false);
              setLocaleError('');
              setNewLocale('');
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="toolbar-icon-button project-i18n-add-locale"
          onClick={() => {
            setNewLocale('');
            setLocaleError('');
            setIsAddingLocale(true);
          }}
          title={t('Add Locale')}
        >
          <Plus size={14} strokeWidth={1.6} />
        </button>
      )}
    </div>
  );
};

export default ProjectI18nLocaleSelect;
