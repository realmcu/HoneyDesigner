/**
 * 共享样式管理弹窗（styles.json）
 *
 * 只编辑样式本身（名字 + 一组白名单视觉属性）。改完后宿主重新解析 HML 并下发组件，
 * 所有引用该样式的组件立刻跟着变；组件上单独改过的属性不受影响。
 */
import React, { useMemo, useState } from 'react';
import { X, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { useDesignerStore } from '../store';
import { t } from '../i18n';
import {
  STYLE_ID_PATTERN,
  type SharedStyle,
  type SharedStyleLibrary,
} from '../../shared/sharedStyles';
import { PropertyEditor } from './properties/PropertyEditor';
import { stylePropertyOptions } from './properties/sharedStyleProperties';
import type { PropertyDefinition } from '../types';
import './SharedStylesManagerModal.css';

/** 支持该属性的组件列表（属性名旁的提示），太长时截断 */
function supportedByText(supportedBy: string[]): string {
  const names = supportedBy.map((name) => t(name as any));
  return names.length > 4 ? `${names.slice(0, 4).join(', ')}…` : names.join(', ');
}

type EditorType = 'string' | 'number' | 'boolean' | 'color' | 'select';

/** 样式里存的是字符串，编辑器按属性定义的类型显示（颜色带取色器、开关是勾选框） */
function editorTypeOf(definition: PropertyDefinition | undefined): EditorType {
  const type = definition?.type;
  return type === 'number' || type === 'boolean' || type === 'color' || type === 'select' ? type : 'string';
}

function toEditorValue(type: EditorType, raw: string): unknown {
  if (type === 'boolean') {
    return raw === 'true';
  }
  if (type === 'number') {
    return raw === '' ? '' : Number(raw);
  }
  return raw;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const SharedStylesManagerModal: React.FC = () => {
  const {
    isSharedStylesManagerOpen,
    setSharedStylesManagerOpen,
    sharedStyles,
    sharedStylesErrors,
    saveSharedStyles,
    components,
    updateComponent,
  } = useDesignerStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SharedStyle | null>(null);
  const [error, setError] = useState('');
  const [unusedWarning, setUnusedWarning] = useState<SharedStyle | null>(null);

  // 每一条样式被多少个组件引用（决定删除时要不要提醒）
  const usage = useMemo(() => {
    const map = new Map<string, number>();
    for (const component of components) {
      if (component.styleName) {
        map.set(component.styleName, (map.get(component.styleName) ?? 0) + 1);
      }
    }
    return map;
  }, [components]);

  if (!isSharedStylesManagerOpen) {
    return null;
  }

  const close = () => {
    setSelectedId(null);
    setDraft(null);
    setError('');
    setUnusedWarning(null);
    setSharedStylesManagerOpen(false);
  };

  const select = (style: SharedStyle) => {
    setSelectedId(style.id);
    setDraft(clone(style));
    setError('');
  };

  const commit = (nextStyle: SharedStyle, library: SharedStyleLibrary = sharedStyles) => {
    if (!STYLE_ID_PATTERN.test(nextStyle.id)) {
      setError(t('Style id may only contain letters, numbers, underline and hyphen'));
      return;
    }
    if (library.styles.some((item) => item.id === nextStyle.id && item.id !== selectedId)) {
      setError(t('Style name already exists'));
      return;
    }

    const styles = library.styles.map((item) =>
      item.id === selectedId ? { ...nextStyle, name: nextStyle.name?.trim() || nextStyle.id } : item,
    );
    saveSharedStyles({ ...library, styles }, { immediate: true });

    // 改 id 时，引用旧 id 的组件要一起改，否则它们会找不到样式
    if (selectedId && nextStyle.id !== selectedId) {
      for (const component of components) {
        if (component.styleName === selectedId) {
          updateComponent(component.id, { styleName: nextStyle.id }, { save: false });
        }
      }
    }

    setSelectedId(nextStyle.id);
    setDraft(clone(nextStyle));
    setError('');
  };

  const handleCreate = () => {
    let index = 1;
    while (sharedStyles.styles.some((item) => item.id === `new_style_${index}`)) {
      index += 1;
    }
    const style: SharedStyle = { id: `new_style_${index}`, name: t('New Style'), props: {} };
    saveSharedStyles(
      { version: 1, styles: [...sharedStyles.styles, style] },
      { immediate: true },
    );
    select(style);
  };

  const handleDelete = (style: SharedStyle) => {
    const refs = usage.get(style.id) ?? 0;
    if (refs > 0) {
      setUnusedWarning(style);
      return;
    }
    removeStyle(style);
  };

  const removeStyle = (style: SharedStyle) => {
    const styles = sharedStyles.styles.filter((item) => item.id !== style.id);
    saveSharedStyles({ version: 1, styles }, { immediate: true });
    // 解除所有组件的引用；已展开的样式属性保留为组件自己的值，组件外观不会突然变化
    for (const component of components) {
      if (component.styleName === style.id) {
        updateComponent(component.id, { styleName: undefined }, { save: false });
      }
    }
    setUnusedWarning(null);
    if (selectedId === style.id) {
      setSelectedId(null);
      setDraft(null);
    }
  };

  // 属性值改动直接保存（防抖）：取色器拖动时会连续触发，不能每次都让宿主重新解析。
  // 只在 id 未被改动（草稿与已保存样式对得上）时保存，改 id 走 commit 的校验。
  const setPropValue = (property: string, value: unknown) => {
    if (!draft) {
      return;
    }
    const next = { ...draft, props: { ...draft.props, [property]: value === undefined || value === null ? '' : String(value) } };
    setDraft(next);
    if (draft.id === selectedId) {
      saveSharedStyles({
        ...sharedStyles,
        styles: sharedStyles.styles.map((item) => (item.id === selectedId ? { ...item, props: next.props } : item)),
      });
    }
  };

  const propertyOptions = stylePropertyOptions();
  const optionOf = (property: string) => propertyOptions.find((item) => item.name === property);
  const definitionOf = (property: string): PropertyDefinition | undefined => optionOf(property)?.definition;
  const addableProperties = propertyOptions.filter((item) => !(item.name in (draft?.props ?? {})));

  return (
    <div className="shared-style-overlay" role="dialog" aria-label={t('Shared Styles')}>
      <div className="shared-style-modal">
        <div className="shared-style-header">
          <h3>{t('Shared Styles')}</h3>
          <button type="button" className="shared-style-icon-button" onClick={close} title={t('Close')}>
            <X size={14} />
          </button>
        </div>

        {sharedStylesErrors.length > 0 && (
          <div className="shared-style-errors">
            <AlertTriangle size={12} />
            <span>{t('styles.json has issues: {0}', sharedStylesErrors.join('; '))}</span>
          </div>
        )}

        <div className="shared-style-body">
          <div className="shared-style-list">
            <div className="shared-style-list-header">
              <span>{t('Style name')}</span>
              <button type="button" className="shared-style-icon-button" onClick={handleCreate} title={t('New Style')}>
                <Plus size={14} />
              </button>
            </div>
            <div className="shared-style-list-items">
              {sharedStyles.styles.length === 0 && (
                <div className="shared-style-empty">{t('No shared styles yet')}</div>
              )}
              {sharedStyles.styles.map((style) => {
                const refs = usage.get(style.id) ?? 0;
                return (
                  <button
                    key={style.id}
                    type="button"
                    className={`shared-style-list-item ${selectedId === style.id ? 'active' : ''}`}
                    onClick={() => select(style)}
                    title={style.id}
                  >
                    <span className="shared-style-list-name">{style.name || style.id}</span>
                    <span className="shared-style-list-meta">
                      {t('{0} properties', Object.keys(style.props).length)} · {t('{0} refs', refs)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="shared-style-editor">
            {draft ? (
              <>
                <div className="shared-style-field">
                  <label>{t('Style name')}</label>
                  <input
                    type="text"
                    value={draft.name ?? ''}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    onBlur={() => commit(draft)}
                    style={{ flex: 1 }}
                  />
                </div>
                <div className="shared-style-field">
                  <label>id</label>
                  <input
                    type="text"
                    value={draft.id}
                    onChange={(event) => setDraft({ ...draft, id: event.target.value.trim() })}
                    onBlur={() => commit(draft)}
                    style={{ flex: 1, fontFamily: 'monospace' }}
                  />
                </div>

                <div className="shared-style-props">
                  {Object.entries(draft.props).length === 0 && (
                    <div className="shared-style-empty">{t('No properties yet')}</div>
                  )}
                  {Object.entries(draft.props).map(([property, value]) => {
                    const definition = definitionOf(property);
                    const type = editorTypeOf(definition);
                    const supportedBy = optionOf(property)?.supportedBy ?? [];
                    return (
                    <div key={property} className="shared-style-prop-row">
                      <span
                        className="shared-style-prop-name"
                        title={`${property} · ${t('Supported by: {0}', supportedBy.map((name) => t(name as any)).join(', '))}`}
                      >
                        {definition ? t(definition.label as any) : property}
                      </span>
                      <PropertyEditor
                        type={type}
                        value={toEditorValue(type, value)}
                        onChange={(next) => setPropValue(property, next)}
                        options={definition?.options as string[] | undefined}
                        min={definition?.min}
                        max={definition?.max}
                      />
                      <button
                        type="button"
                        className="shared-style-icon-button"
                        onClick={() => {
                          const props = { ...draft.props };
                          delete props[property];
                          const next = { ...draft, props };
                          setDraft(next);
                          commit(next);
                        }}
                        title={t('Delete')}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    );
                  })}
                </div>

                <div className="shared-style-field">
                  <select
                    value=""
                    onChange={(event) => {
                      if (!event.target.value) {
                        return;
                      }
                      // 新属性先填组件定义里的默认值，空值保存时会被丢掉
                      const property = event.target.value;
                      const defaultValue = definitionOf(property)?.defaultValue;
                      const next = {
                        ...draft,
                        props: { ...draft.props, [property]: defaultValue === undefined ? '' : String(defaultValue) },
                      };
                      setDraft(next);
                      commit(next);
                    }}
                    title={t('A style can combine several properties')}
                  >
                    <option value="">{t('Add property')}</option>
                    {addableProperties.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.definition ? t(item.definition.label as any) : item.name}
                        {item.supportedBy.length > 0 ? ` — ${supportedByText(item.supportedBy)}` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="shared-style-danger"
                    onClick={() => handleDelete(draft)}
                  >
                    <Trash2 size={12} />
                    <span>{t('Delete Style')}</span>
                  </button>
                </div>

                {error && <div className="shared-style-error-text">{error}</div>}
              </>
            ) : (
              <div className="shared-style-empty">{t('Select a style to edit')}</div>
            )}
          </div>
        </div>

        {unusedWarning && (
          <div className="shared-style-confirm">
            <span>{t('{0} components use this style. Delete anyway?', usage.get(unusedWarning.id) ?? 0)}</span>
            <div className="shared-style-confirm-actions">
              <button type="button" onClick={() => setUnusedWarning(null)}>{t('Cancel')}</button>
              <button type="button" className="shared-style-danger" onClick={() => removeStyle(unusedWarning)}>
                {t('Delete')}
              </button>
            </div>
          </div>
        )}

        <div className="shared-style-footer">
          <span className="shared-style-hint">{t('Shared styles are saved to styles.json in the project root.')}</span>
          <button type="button" onClick={close}>{t('Close')}</button>
        </div>
      </div>
    </div>
  );
};

export default SharedStylesManagerModal;
