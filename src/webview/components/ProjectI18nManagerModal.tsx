import React from 'react';
import { X, Trash2, Plus, Search, Check } from 'lucide-react';
import { setTranslation, removeLocale, ensureLocale } from '../../project-i18n/catalog';
import {
  LOCALE_PRESETS,
  localeDisplayName,
  matchLocalePreset,
} from '../../project-i18n/localePresets';
import { useDesignerStore } from '../store';
import { t, getLocale } from '../i18n';
import './ProjectI18nManagerModal.css';

const LOCALE_PATTERN = /^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})*$/;
// i18n key 命名：首字符字母/数字，其余允许字母数字与 . _ -（避免空格/特殊字符破坏 HML 属性）
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

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
    previewLocale,
    setPreviewLocale,
  } = useDesignerStore();

  const [query, setQuery] = React.useState('');
  const [mode, setMode] = React.useState<'all' | 'missing' | 'unused' | 'unbound'>('all');
  const [pendingDelete, setPendingDelete] = React.useState<{ key: string; refs: number; fallbackText: string } | null>(null);
  const [pendingLocaleDelete, setPendingLocaleDelete] = React.useState<{ locale: string } | null>(null);
  const refreshTimerRef = React.useRef<number | null>(null);

  const defaultLocale = projectI18nCatalog.defaultLocale;

  // ===== 新建 Key（主动创建入口）=====
  const [isCreateKeyOpen, setIsCreateKeyOpen] = React.useState(false);
  const [newKeyName, setNewKeyName] = React.useState('');
  const [newKeyText, setNewKeyText] = React.useState('');
  const [createKeyError, setCreateKeyError] = React.useState('');
  const newKeyInputRef = React.useRef<HTMLInputElement>(null);

  // 新建后滚动定位并短暂高亮的目标行
  const [highlightKey, setHighlightKey] = React.useState<string | null>(null);
  const highlightRowRef = React.useRef<HTMLTableRowElement | null>(null);
  const highlightTimerRef = React.useRef<number | null>(null);

  // ===== 语言管理（添加/删除均在本弹窗内完成）=====
  const [isLocalePickerOpen, setIsLocalePickerOpen] = React.useState(false);
  const [localeQuery, setLocaleQuery] = React.useState('');
  const [localeError, setLocaleError] = React.useState('');
  const localePickerRef = React.useRef<HTMLDivElement>(null);
  const localeSearchInputRef = React.useRef<HTMLInputElement>(null);

  const uiLocale = getLocale();
  const normalizeLocale = (value: string) => value.trim().replace(/_/g, '-');

  const existingLower = React.useMemo(
    () => new Set(projectI18nCatalog.locales.map((locale) => locale.toLowerCase())),
    [projectI18nCatalog.locales],
  );

  const matchedPresets = React.useMemo(
    () =>
      LOCALE_PRESETS.filter(
        (preset) => !existingLower.has(preset.code.toLowerCase()) && matchLocalePreset(preset, localeQuery),
      ),
    [existingLower, localeQuery],
  );

  const customCode = normalizeLocale(localeQuery);
  const customIsValid = Boolean(customCode) && LOCALE_PATTERN.test(customCode);
  const customAlreadyExists = existingLower.has(customCode.toLowerCase());
  const customMatchesPreset = matchedPresets.some(
    (preset) => preset.code.toLowerCase() === customCode.toLowerCase(),
  );
  const showCustomEntry = Boolean(customCode) && !customMatchesPreset;

  const closeLocalePicker = () => {
    setIsLocalePickerOpen(false);
    setLocaleQuery('');
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
      closeLocalePicker();
      return;
    }

    const nextCatalog = cloneCatalog(projectI18nCatalog);
    ensureLocale(nextCatalog, locale);
    updateProjectI18nCatalog(nextCatalog, { save: true, immediate: true });
    setPreviewLocale(locale);
    closeLocalePicker();
  };

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

  const openCreateKey = () => {
    setNewKeyName('');
    setNewKeyText('');
    setCreateKeyError('');
    setIsCreateKeyOpen(true);
    window.setTimeout(() => newKeyInputRef.current?.focus(), 0);
  };

  const confirmCreateKey = () => {
    const key = newKeyName.trim();
    if (!key) {
      setCreateKeyError(t('I18n key name required'));
      return;
    }
    if (!KEY_PATTERN.test(key)) {
      setCreateKeyError(t('Invalid i18n key'));
      return;
    }
    if (projectI18nCatalog.strings[key]) {
      setCreateKeyError(t('I18n key already exists', key));
      return;
    }

    // 建立 key 条目：默认语言写入初始文本（可为空，key 仍会出现在表格中待补充）
    const nextCatalog = cloneCatalog(projectI18nCatalog);
    setTranslation(nextCatalog, key, defaultLocale, newKeyText);
    updateProjectI18nCatalog(nextCatalog, { save: true, immediate: true });

    setIsCreateKeyOpen(false);
    // 不劫持搜索框：清空过滤条件确保新行可见，随后滚动定位并高亮
    setQuery('');
    setMode('all');
    setHighlightKey(key);
    window.setTimeout(() => loadProjectI18nIndex(), 0);
  };

  const requestDeleteKey = (key: string, referenceCount: number) => {
    const fallbackText = projectI18nCatalog.strings[key]?.[defaultLocale] || '';
    setPendingDelete({ key, refs: referenceCount, fallbackText });
  };

  const confirmDeleteKey = () => {
    if (!pendingDelete) {
      return;
    }

    const key = pendingDelete.key;
    // 删除前取默认语言文本，解绑时回写到组件的 text 字段，
    // 使组件删 key 后仍显示有意义的内容（而非旧占位符）。
    const fallbackText = pendingDelete.fallbackText;

    // 即时解绑当前打开文件中引用该 key 的组件（UI/预览立即同步）；
    // 其他文件的组件由 Extension 侧扫描全项目 HML 统一解绑。
    for (const component of components) {
      if (String((component.data as any)?.i18nKey || '').trim() === key) {
        const nextData = { ...component.data } as Record<string, unknown>;
        delete nextData.i18nKey;
        if (fallbackText) {
          nextData.text = fallbackText;
        }
        updateComponent(component.id, { data: nextData as any });
      }
    }

    // Extension：删除 catalog 条目 + 解绑全项目所有引用组件（含未打开文件），
    // 并把默认语言文本回写到各组件 text 字段。
    deleteProjectI18nKey(key);
    setPendingDelete(null);
    window.setTimeout(() => loadProjectI18nIndex(), 0);
  };

  const requestDeleteLocale = (locale: string) => {
    if (locale === projectI18nCatalog.defaultLocale) {
      return;
    }
    setPendingLocaleDelete({ locale });
  };

  const confirmDeleteLocale = () => {
    if (!pendingLocaleDelete) {
      return;
    }

    const nextCatalog = cloneCatalog(projectI18nCatalog);
    removeLocale(nextCatalog, pendingLocaleDelete.locale);
    // removeLocale 已清理该 locale 下所有翻译值，避免 normalizeCatalog 把语言加回。
    updateProjectI18nCatalog(nextCatalog, { save: true, immediate: true });
    setPendingLocaleDelete(null);
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

  // 语言 picker：外部点击关闭 + 打开时自动聚焦搜索框
  React.useEffect(() => {
    if (!isLocalePickerOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (localePickerRef.current && !localePickerRef.current.contains(event.target as Node)) {
        closeLocalePicker();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.setTimeout(() => localeSearchInputRef.current?.focus(), 0);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isLocalePickerOpen]);

  // 关闭弹窗时一并收起 picker
  React.useEffect(() => {
    if (!isProjectI18nManagerOpen) {
      setIsLocalePickerOpen(false);
      setLocaleQuery('');
      setLocaleError('');
      setHighlightKey(null);
    }
  }, [isProjectI18nManagerOpen]);

  // 新建 key 后：等目标行渲染出来（索引刷新回来）再滚动定位，并在 2.5s 后清除高亮
  React.useEffect(() => {
    if (!highlightKey) {
      return;
    }
    if (highlightRowRef.current) {
      highlightRowRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    if (highlightTimerRef.current) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightKey(null);
      highlightTimerRef.current = null;
    }, 2500);
    return () => {
      if (highlightTimerRef.current) {
        window.clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
    };
  }, [highlightKey, projectI18nIndex]);

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
            <div className="project-i18n-locale-bar">
              <span className="project-i18n-locale-bar-label">{t('Languages')}</span>
              <div className="project-i18n-locale-chips">
                {projectI18nCatalog.locales.map((locale) => {
                  const isDefault = locale === projectI18nCatalog.defaultLocale;
                  return (
                    <span
                      key={locale}
                      className={`project-i18n-locale-chip${isDefault ? ' is-default' : ''}`}
                    >
                      <span className="chip-code">{locale}</span>
                      {isDefault ? (
                        <span className="chip-default-badge" title={t('Default Locale')}>
                          {t('Default')}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="chip-delete"
                          onClick={() => requestDeleteLocale(locale)}
                          title={t('Delete Locale')}
                        >
                          <X size={11} strokeWidth={2} />
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
              <div className="project-i18n-locale-add" ref={localePickerRef}>
                <button
                  type="button"
                  className="project-i18n-locale-add-button"
                  onClick={() => {
                    if (isLocalePickerOpen) {
                      closeLocalePicker();
                    } else {
                      setLocaleQuery('');
                      setLocaleError('');
                      setIsLocalePickerOpen(true);
                    }
                  }}
                  title={t('Add Locale')}
                >
                  <Plus size={13} strokeWidth={1.8} />
                  <span>{t('Add Locale')}</span>
                </button>

                {isLocalePickerOpen && (
                  <div className="project-i18n-locale-picker" role="dialog" aria-label={t('Add Locale')}>
                    <div className="project-i18n-locale-picker-search">
                      <Search size={13} strokeWidth={1.6} />
                      <input
                        ref={localeSearchInputRef}
                        value={localeQuery}
                        placeholder={t('Search language')}
                        onChange={(event) => {
                          setLocaleQuery(event.target.value);
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
                            closeLocalePicker();
                          }
                        }}
                      />
                    </div>

                    {localeError && (
                      <div className="project-i18n-locale-picker-error">{localeError}</div>
                    )}

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
                        <div className="project-i18n-locale-picker-empty">
                          {t('No matching language')}
                        </div>
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
                        {customIsValid && !customAlreadyExists ? (
                          <Check size={13} strokeWidth={1.6} />
                        ) : null}
                      </button>
                    )}
                  </div>
                )}
              </div>
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
              <button
                type="button"
                className="project-i18n-new-key-button"
                onClick={openCreateKey}
                title={t('Create I18n Key')}
              >
                <Plus size={13} strokeWidth={1.8} />
                <span>{t('New I18n Key')}</span>
              </button>
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
                      <th className="key-cell">{t('Localized Key')}</th>
                      {projectI18nIndex.locales.map((locale) => {
                        const isDefault = locale === projectI18nCatalog.defaultLocale;
                        return (
                          <th key={locale} className="translation-cell">
                            <div className="locale-th">
                              <span className="locale-code">{locale}</span>
                              {isDefault && (
                                <span className="locale-default-badge" title={t('Default Locale')}>
                                  {t('Default')}
                                </span>
                              )}
                            </div>
                          </th>
                        );
                      })}
                      <th className="ref-cell">{t('References')}</th>
                      <th className="status-cell">{t('Status')}</th>
                      <th className="action-cell"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => (
                      <tr
                        key={row.key}
                        ref={row.key === highlightKey ? highlightRowRef : undefined}
                        className={`${row.isUnused ? 'unused' : ''}${row.key === highlightKey ? ' highlight' : ''}`.trim()}
                      >
                        <td className="key-cell">{row.key}</td>
                        {projectI18nIndex.locales.map((locale) => (
                          <td key={locale} className="translation-cell">
                            <textarea
                              value={projectI18nCatalog.strings[row.key]?.[locale] || ''}
                              onChange={(event) => handleTranslationChange(row.key, locale, event.target.value)}
                              rows={2}
                            />
                          </td>
                        ))}
                        <td className="ref-cell">{row.references.length}</td>
                        <td className="status-cell">
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
        {isCreateKeyOpen && (
          <div className="i18n-confirm-backdrop">
            <div className="i18n-confirm-dialog i18n-create-dialog">
              <div className="i18n-create-title">{t('Create I18n Key')}</div>
              <div className="i18n-create-field">
                <label>{t('I18n Key Name')}</label>
                <input
                  ref={newKeyInputRef}
                  value={newKeyName}
                  placeholder="pairing.scan_code"
                  onChange={(event) => {
                    setNewKeyName(event.target.value);
                    setCreateKeyError('');
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      confirmCreateKey();
                    }
                    if (event.key === 'Escape') {
                      setIsCreateKeyOpen(false);
                    }
                  }}
                />
              </div>
              <div className="i18n-create-field">
                <label>{`${t('Default Text (optional)')} (${defaultLocale})`}</label>
                <input
                  value={newKeyText}
                  onChange={(event) => setNewKeyText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      confirmCreateKey();
                    }
                    if (event.key === 'Escape') {
                      setIsCreateKeyOpen(false);
                    }
                  }}
                />
              </div>
              {createKeyError && <div className="i18n-create-error">{createKeyError}</div>}
              <div className="i18n-confirm-actions">
                <button type="button" onClick={() => setIsCreateKeyOpen(false)}>
                  {t('Cancel')}
                </button>
                <button type="button" className="primary" onClick={confirmCreateKey}>
                  {t('Create')}
                </button>
              </div>
            </div>
          </div>
        )}
        {pendingDelete && (
          <div className="i18n-confirm-backdrop">
            <div className="i18n-confirm-dialog">
              <div className="i18n-confirm-message">
                {pendingDelete.refs > 0
                  ? t('Delete i18n key confirm with refs', pendingDelete.key, String(pendingDelete.refs))
                  : t('Delete i18n key confirm', pendingDelete.key)}
              </div>
              {pendingDelete.refs > 0 && (
                <div className="i18n-confirm-hint">
                  {pendingDelete.fallbackText
                    ? t('Delete i18n key fallback hint', pendingDelete.fallbackText)
                    : t('Delete i18n key fallback hint empty')}
                </div>
              )}
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
        {pendingLocaleDelete && (
          <div className="i18n-confirm-backdrop">
            <div className="i18n-confirm-dialog">
              <div className="i18n-confirm-message">
                {t('Delete locale confirm', pendingLocaleDelete.locale)}
              </div>
              <div className="i18n-confirm-actions">
                <button type="button" onClick={() => setPendingLocaleDelete(null)}>
                  {t('Cancel')}
                </button>
                <button type="button" className="danger" onClick={confirmDeleteLocale}>
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
