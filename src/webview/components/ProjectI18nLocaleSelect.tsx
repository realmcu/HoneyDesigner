import React from 'react';
import { Languages } from 'lucide-react';
import { useDesignerStore } from '../store';
import { t } from '../i18n';

// 预览语言切换器。语言的添加/删除已统一收敛到 I18n Manager 弹窗，
// 本组件只负责在已有语言之间切换预览。
const ProjectI18nLocaleSelect: React.FC = () => {
  const {
    projectI18nCatalog,
    previewLocale,
    setPreviewLocale,
  } = useDesignerStore();

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
    </div>
  );
};

export default ProjectI18nLocaleSelect;
