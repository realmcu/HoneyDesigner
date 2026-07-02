import React from 'react';
import { X, Trash2 } from 'lucide-react';
import { setTranslation } from '../../project-i18n/catalog';
import { useDesignerStore } from '../store';
import { t } from '../i18n';
import './ProjectI18nManagerModal.css';

function cloneCatalog<T>(catalog: T): T {
  return JSON.parse(JSON.stringify(catalog)) as T;
}

const ProjectI18nManagerModal: React.FC = () => {
  const {
    isProjectI18nManagerOpen,
    setProjectI18nManagerOpen,
    loadProjectI18nIndex,
    projectI18nIndex,
    projectI18nIndexErrors,
    projectI18nCatalog,
    updateProjectI18nCatalog,
    deleteProjectI18nKey,
    components,
    currentFilePath,
    updateComponent,
  } = useDesignerStore();

  const [query, setQuery] = React.useState('');
  const [mode, setMode] = React.useState<'all' | 'missing' | 'unused' | 'unbound'>('all');
  const [pendingDelete, setPendingDelete] = React.useState<{ key: string; refs: number } | null>(null);
  const refreshTimerRef = React.useRef<number | null>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredRows = (projectI18nIndex?.rows || []).filter((row) => {
    if (mode === 'missing' && row.missingLocales.length === 0) {
      return false;
    }
    if (mode === 'unused' && !row.isUnused) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return row.key.toLowerCase().includes(normalizedQuery) ||
      Object.values(row.translations).some((text) => (text || '').toLowerCase().includes(normalizedQuery)) ||
      row.references.some((ref) =>
        ref.filePath.toLowerCase().includes(normalizedQuery) ||
        ref.componentId.toLowerCase().includes(normalizedQuery)
      );
  });

  const handleTranslationChange = (key: string, locale: string, value: string) => {
    const nextCatalog = cloneCatalog(projectI18nCatalog);
    setTranslation(nextCatalog, key, locale, value);
    updateProjectI18nCatalog(nextCatalog, { save: true });
  };

  const requestDeleteKey = (key: string, referenceCount: number) => {
    setPendingDelete({ key, refs: referenceCount });
  };

  const confirmDeleteKey = () => {
    if (!pendingDelete) {
      return;
    }

    const key = pendingDelete.key;

    // 即时解绑当前打开文件中引用该 key 的组件（UI/预览立即同步）；
    // 其他文件的组件由 Extension 侧扫描全项目 HML 统一解绑。
    for (const component of components) {
      if (String((component.data as any)?.i18nKey || '').trim() === key) {
        const nextData = { ...component.data } as Record<string, unknown>;
        delete nextData.i18nKey;
        updateComponent(component.id, { data: nextData as any });
      }
    }

    // Extension：删除 catalog 条目 + 解绑全项目所有引用组件（含未打开文件）。
    deleteProjectI18nKey(key);
    setPendingDelete(null);
    window.setTimeout(() => loadProjectI18nIndex(), 0);
  };

  const bindCurrentFileComponent = (componentId: string, key: string, text: string) => {
    const component = components.find((item) => item.id === componentId);
    if (!component) {
      return;
    }

    const nextCatalog = cloneCatalog(projectI18nCatalog);
    setTranslation(nextCatalog, key, projectI18nCatalog.defaultLocale, text);
    updateProjectI18nCatalog(nextCatalog, { save: true, immediate: true });

    updateComponent(componentId, {
      data: {
        ...component.data,
        i18nKey: key,
        text,
      },
    });
    window.setTimeout(() => loadProjectI18nIndex(), 0);
  };

  React.useEffect(() => {
    if (!isProjectI18nManagerOpen) {
      return;
    }

    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = window.setTimeout(() => {
      loadProjectI18nIndex();
      refreshTimerRef.current = null;
    }, 250);

    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [isProjectI18nManagerOpen, projectI18nCatalog, loadProjectI18nIndex]);

  React.useEffect(() => {
    if (!isProjectI18nManagerOpen && refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, [isProjectI18nManagerOpen]);

  if (!isProjectI18nManagerOpen) {
    return null;
  }

  return (
    <div className="project-i18n-manager-backdrop">
      <div className="project-i18n-manager">
        <div className="project-i18n-manager-header">
          <h2>{t('I18n Manager')}</h2>
          <button
            type="button"
            className="toolbar-icon-button"
            onClick={() => setProjectI18nManagerOpen(false)}
            title={t('Close')}
          >
            <X size={16} />
          </button>
        </div>
        {projectI18nIndexErrors && projectI18nIndexErrors.length > 0 && (
          <div className="project-i18n-manager-warning">
            {t('Some HML files could not be scanned')}: {projectI18nIndexErrors.length}
          </div>
        )}
        {!projectI18nIndex ? (
          <div className="project-i18n-manager-empty">{t('Loading...')}</div>
        ) : (
          <>
            <div className="project-i18n-manager-summary">
              {t('I18n keys')}: {projectI18nIndex.rows.length}
              {' · '}
              {t('Unbound texts')}: {projectI18nIndex.unboundTexts.length}
            </div>
            <div className="project-i18n-manager-note">
              {t('Save HML to refresh project-wide binding references')}
            </div>
            <div className="project-i18n-manager-tools">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('Search i18n')}
              />
              {(['all', 'missing', 'unused', 'unbound'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={mode === item ? 'active' : ''}
                  onClick={() => setMode(item)}
                >
                  {t(`i18n.filter.${item}`)}
                </button>
              ))}
            </div>
            {mode === 'unbound' ? (
              <div className="project-i18n-unbound-list">
                {projectI18nIndex.unboundTexts.map((item) => (
                  <div key={`${item.filePath}:${item.componentId}`} className="project-i18n-unbound-item">
                    <div className="unbound-main">{item.text}</div>
                    <div className="unbound-meta">{item.filePath} · {item.componentId}</div>
                    <code>{item.suggestedKey}</code>
                    {currentFilePath?.replace(/\\/g, '/').endsWith(item.filePath) && (
                      <button
                        type="button"
                        onClick={() => bindCurrentFileComponent(item.componentId, item.suggestedKey, item.text)}
                      >
                        {t('Bind current file')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="project-i18n-table-wrap">
                <table className="project-i18n-table">
                  <thead>
                    <tr>
                      <th>{t('Localized Key')}</th>
                      {projectI18nIndex.locales.map((locale) => (
                        <th key={locale}>{locale}</th>
                      ))}
                      <th>{t('References')}</th>
                      <th>{t('Status')}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => (
                      <tr key={row.key} className={row.isUnused ? 'unused' : ''}>
                        <td className="key-cell">{row.key}</td>
                        {projectI18nIndex.locales.map((locale) => (
                          <td key={locale}>
                            <textarea
                              value={projectI18nCatalog.strings[row.key]?.[locale] || ''}
                              onChange={(event) => handleTranslationChange(row.key, locale, event.target.value)}
                              rows={2}
                            />
                          </td>
                        ))}
                        <td>{row.references.length}</td>
                        <td>
                          {row.isUnused && <span className="status-warning">{t('Unused I18n Key')}</span>}
                          {row.missingLocales.length > 0 && <span className="status-warning">{t('Missing Translation')}</span>}
                        </td>
                        <td className="action-cell">
                          <button
                            type="button"
                            className="i18n-delete-button"
                            onClick={() => requestDeleteKey(row.key, row.references.length)}
                            title={t('Delete I18n Key')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {pendingDelete && (
          <div className="i18n-confirm-backdrop">
            <div className="i18n-confirm-dialog">
              <div className="i18n-confirm-message">
                {pendingDelete.refs > 0
                  ? t('Delete i18n key confirm with refs', pendingDelete.key, String(pendingDelete.refs))
                  : t('Delete i18n key confirm', pendingDelete.key)}
              </div>
              <div className="i18n-confirm-actions">
                <button type="button" onClick={() => setPendingDelete(null)}>
                  {t('Cancel')}
                </button>
                <button type="button" className="danger" onClick={confirmDeleteKey}>
                  {t('Delete')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectI18nManagerModal;
