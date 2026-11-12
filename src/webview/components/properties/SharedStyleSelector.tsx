/**
 * 组件属性面板里的「共享样式」一栏
 *
 * 只做两件事：给组件选一条 styles.json 里的样式，以及把当前组件的样式属性保存成一条新样式。
 * 属性值本身仍由各属性面板编辑：解析时样式已经展开进组件，编辑结果就是覆盖值。
 */
import React, { useState } from 'react';
import { Palette, Plus } from 'lucide-react';
import { useDesignerStore } from '../../store';
import { t } from '../../i18n';
import {
  readComponentStyleValue,
  resolveSharedStyle,
  sharedStyleBucket,
  type SharedStyle,
} from '../../../shared/sharedStyles';
import type { Component } from '../../types';
import { shareablePropertiesFor } from './sharedStyleProperties';

interface SharedStyleSelectorProps {
  component: Component;
  onUpdate: (updates: Partial<Component>) => void;
}

const SELECT_STYLE: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '4px 8px',
  backgroundColor: 'var(--vscode-input-background)',
  color: 'var(--vscode-input-foreground)',
  border: '1px solid var(--vscode-input-border)',
  borderRadius: '2px',
};

/** 组件从样式里继承来、且没有被自己改过的属性名 */
export function inheritedStyleProperties(
  component: Component,
  styles: SharedStyle[],
): string[] {
  const style = resolveSharedStyle(styles.find((item) => item.id === component.styleName), component.type);
  if (!style) {
    return [];
  }
  return Object.keys(style.props).filter(
    (property) => String(readComponentStyleValue(component, property) ?? '') === style.props[property],
  );
}

export const SharedStyleSelector: React.FC<SharedStyleSelectorProps> = ({ component, onUpdate }) => {
  const { sharedStyles, saveSharedStyles, setSharedStylesManagerOpen } = useDesignerStore();
  const [isSaving, setIsSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  // 样式不绑定组件类型：本组件只接收自己支持的属性，其余忽略（发光/阴影只有 rect/circle 有）。
  // 先按组件类型解析主色别名（矩形/圆形上 color 即 fillColor），再判断支持与否。
  const supported = new Set(shareablePropertiesFor(component.type).map((property) => property.name));
  const resolve = (style: SharedStyle | undefined) => resolveSharedStyle(style, component.type);
  const ignoredCount = (style: SharedStyle) =>
    Object.keys(resolve(style)!.props).filter((property) => !supported.has(property)).length;
  // 样式里一个本组件能用的属性都没有时，选了也不会有任何变化，不让选
  const isUsable = (style: SharedStyle) =>
    Object.keys(style.props).length === 0 || ignoredCount(style) < Object.keys(style.props).length;

  const current = sharedStyles.styles.find((item) => item.id === component.styleName);
  const inheritedCount = current ? inheritedStyleProperties(component, sharedStyles.styles).length : 0;
  const currentIgnored = current ? ignoredCount(current) : 0;

  const handleSelect = (value: string) => {
    // 清空引用时把已展开的样式属性一并去掉，否则组件会保留一份「看不见来源」的样式。
    // 只在属性值仍等于样式值时删除：改过的属性属于组件自己的覆盖值。
    const previous = resolve(sharedStyles.styles.find((item) => item.id === component.styleName));
    const style = { ...(component.style ?? {}) };
    const data = { ...(component.data ?? {}) };
    const updates: Partial<Component> = { styleName: value || undefined };

    if (previous) {
      for (const property of Object.keys(previous.props)) {
        const bucket = property in data ? data : style;
        if (String(bucket[property] ?? '') === previous.props[property]) {
          delete bucket[property];
        }
      }
    }

    // 选中样式就是把样式「套用」到组件：样式里的值直接写进组件，覆盖标签上原有的同名属性。
    // 解析时本来的规则是「组件属性优先」，若只挂引用不改值，组件上原有的 color 会把样式顶掉，
    // 用户看不到任何变化。清空选择时不写，保持组件当前外观。
    const next = resolve(sharedStyles.styles.find((item) => item.id === value));
    if (next) {
      for (const [property, propertyValue] of Object.entries(next.props)) {
        if (!supported.has(property)) {
          continue;
        }
        (sharedStyleBucket(property) === 'data' ? data : style)[property] = propertyValue;
      }
    }

    updates.style = style;
    updates.data = data as Component['data'];
    onUpdate(updates);
  };

  // 字体类属性落在 data、其余在 style，切换组件类型后归属可能改变。归属不对时这些值会被
  // 序列化当成组件自己的覆盖值写回 HML，所以按当前类型重新放一次（值本来仍是样式给的那个）。
  React.useEffect(() => {
    const style = resolve(sharedStyles.styles.find((item) => item.id === component.styleName));
    if (!style) {
      return;
    }
    const nextStyle: Record<string, unknown> = { ...(component.style ?? {}) };
    const nextData: Record<string, unknown> = { ...(component.data ?? {}) };
    let moved = false;
    for (const [property, value] of Object.entries(style.props)) {
      const toData = sharedStyleBucket(property) === 'data';
      const target = toData ? nextData : nextStyle;
      const source = toData ? nextStyle : nextData;
      if (target[property] !== undefined) {
        continue; // 已在新位置（或是组件自己的覆盖值）
      }
      if (String(source[property] ?? '') !== value) {
        continue; // 原位置不是样式给的值
      }
      delete source[property];
      target[property] = value;
      moved = true;
    }
    if (moved) {
      onUpdate({ style: nextStyle, data: nextData as Component['data'] });
    }
  }, [component.id, component.type, component.styleName]);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) {
      setError(t('Please enter a style name'));
      return;
    }
    const id = name.replace(/[^A-Za-z0-9_-]/g, '_');
    if (sharedStyles.styles.some((item) => item.id === id)) {
      setError(t('Style name already exists'));
      return;
    }

    // 用组件当前的样式属性建立样式（只取本组件支持的）
    const props: Record<string, string> = {};
    for (const property of supported) {
      const value = readComponentStyleValue(component, property);
      if (value !== undefined && value !== null && value !== '') {
        props[property] = String(value);
      }
    }

    saveSharedStyles(
      { ...sharedStyles, styles: [...sharedStyles.styles, { id, name, props }] },
      { immediate: true },
    );
    onUpdate({ styleName: id });
    setIsSaving(false);
    setNewName('');
    setError('');
  };

  return (
    <div className="property-item" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <label style={{ minWidth: '42px', flexShrink: 0, marginBottom: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Palette size={12} />
          {t('Shared Style')}
        </label>
        <select
          value={component.styleName ?? ''}
          onChange={(event) => handleSelect(event.target.value)}
          style={SELECT_STYLE}
          title={t('Shared Style Hint')}
        >
          <option value="">{t('None')}</option>
          {sharedStyles.styles.map((item) => {
            const usable = isUsable(item);
            const label = item.name && item.name !== item.id ? `${item.name} (${item.id})` : item.id;
            return (
              <option key={item.id} value={item.id} disabled={!usable && item.id !== component.styleName}>
                {usable ? label : `${label} · ${t('No properties apply to this component')}`}
              </option>
            );
          })}
        </select>
        <button
          type="button"
          onClick={() => {
            setIsSaving((value) => !value);
            setError('');
          }}
          title={t('Save current style as new style')}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '4px',
            background: 'var(--vscode-button-secondaryBackground)',
            color: 'var(--vscode-button-secondaryForeground)',
            border: 'none',
            borderRadius: '2px',
            cursor: 'pointer',
          }}
        >
          <Plus size={12} />
        </button>
        <button
          type="button"
          onClick={() => setSharedStylesManagerOpen(true)}
          style={{
            padding: '4px 8px',
            background: 'none',
            border: '1px solid var(--vscode-input-border)',
            borderRadius: '2px',
            color: 'var(--vscode-foreground)',
            fontSize: '11px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {t('Manage')}
        </button>
      </div>

      {isSaving && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '50px' }}>
          <input
            type="text"
            value={newName}
            autoFocus
            placeholder={t('New style name')}
            onChange={(event) => {
              setNewName(event.target.value);
              setError('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleCreate();
              } else if (event.key === 'Escape') {
                setIsSaving(false);
              }
            }}
            style={{ ...SELECT_STYLE, boxSizing: 'border-box' }}
          />
          {error && (
            <span style={{ color: 'var(--vscode-inputValidation-errorForeground, #f44)', fontSize: '11px' }}>{error}</span>
          )}
        </div>
      )}

      {current && currentIgnored > 0 && (
        <div style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', paddingLeft: '50px' }}>
          {t('{0} style properties are not supported by this component and are ignored', currentIgnored)}
        </div>
      )}

      {current && (
        <div style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', paddingLeft: '50px' }}>
          {inheritedCount > 0
            ? t('{0} properties inherited, others overridden', inheritedCount)
            : t('All style properties overridden')}
        </div>
      )}
    </div>
  );
};
