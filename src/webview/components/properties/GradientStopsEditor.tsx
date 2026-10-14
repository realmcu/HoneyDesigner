import React from 'react';
import { NumberInput } from '../NumberInput';
import { t } from '../../i18n';

export interface GradientStop {
  position: number;  // 0.0 - 1.0
  color: string;     // #RRGGBB
}

interface GradientStopsEditorProps {
  stops: GradientStop[];
  onChange: (stops: GradientStop[]) => void;
  /** 新增色标的默认颜色 */
  defaultColor?: string;
  /** 色标数量上限，达到后禁用添加按钮 */
  maxStops?: number;
  /** 渲染在添加按钮与色标列表之间（提示、角度等附加设置） */
  children?: React.ReactNode;
}

/**
 * 渐变色标列表编辑器（添加 / 修改位置与颜色 / 删除）
 */
export const GradientStopsEditor: React.FC<GradientStopsEditorProps> = ({ stops, onChange, defaultColor = '#007acc', maxStops, children }) => {
  const canAdd = maxStops === undefined || stops.length < maxStops;

  const handleAdd = () => {
    if (!canAdd) {
      return;
    }
    onChange([...stops, { position: stops.length === 0 ? 0 : 1, color: defaultColor }]);
  };

  const handleRemove = (index: number) => {
    onChange(stops.filter((_, i) => i !== index));
  };

  const handleUpdate = (index: number, field: 'position' | 'color', value: any) => {
    const next = [...stops];
    next[index] = { ...next[index], [field]: value };
    onChange(next);
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
        <button
          onClick={handleAdd}
          disabled={!canAdd}
          title={canAdd ? undefined : t('Maximum color stops reached', String(maxStops))}
          style={{
            padding: '2px 8px',
            fontSize: '12px',
            backgroundColor: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: '2px',
            cursor: canAdd ? 'pointer' : 'not-allowed',
            opacity: canAdd ? 1 : 0.5,
          }}
        >
          + {t('Add Color Stop')}
        </button>
      </div>

      {children}

      {stops.length === 0 ? (
        <div style={{
          padding: '12px',
          color: 'var(--vscode-descriptionForeground)',
          fontSize: '12px',
          textAlign: 'center'
        }}>
          {t('Click Add Color Stop to configure gradient')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {stops.map((stop, index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: '8px',
                padding: '8px',
                backgroundColor: 'var(--vscode-editor-background)',
                borderRadius: '4px',
              }}
            >
              <div style={{ flex: '1 1 0', minWidth: 0 }}>
                <label style={{ fontSize: '11px', display: 'block', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t('Position (0-1)')}
                </label>
                <NumberInput
                  min={0}
                  max={1}
                  emptyValue={0}
                  value={stop.position}
                  onChange={(v) => handleUpdate(index, 'position', v)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '4px 6px',
                    backgroundColor: 'var(--vscode-input-background)',
                    color: 'var(--vscode-input-foreground)',
                    border: '1px solid var(--vscode-input-border)',
                    borderRadius: '2px',
                  }}
                />
              </div>
              <div style={{ flex: '2 1 0', minWidth: 0 }}>
                <label style={{ fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                  {t('Color')}
                </label>
                <div style={{ display: 'flex', gap: '4px', minWidth: 0 }}>
                  <input
                    type="color"
                    value={stop.color}
                    onChange={(e) => handleUpdate(index, 'color', e.target.value)}
                    style={{ flex: '0 0 30px', width: '30px', height: '28px', padding: 0, border: 'none' }}
                  />
                  <input
                    type="text"
                    value={stop.color}
                    onChange={(e) => handleUpdate(index, 'color', e.target.value)}
                    style={{
                      flex: '1 1 0',
                      width: 0,
                      minWidth: 0,
                      boxSizing: 'border-box',
                      padding: '4px 6px',
                      backgroundColor: 'var(--vscode-input-background)',
                      color: 'var(--vscode-input-foreground)',
                      border: '1px solid var(--vscode-input-border)',
                      borderRadius: '2px',
                    }}
                  />
                </div>
              </div>
              <button
                onClick={() => handleRemove(index)}
                style={{
                  padding: '4px 8px',
                  backgroundColor: 'var(--vscode-button-secondaryBackground)',
                  color: 'var(--vscode-button-secondaryForeground)',
                  border: 'none',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  flex: '0 0 auto',
                  height: '28px',
                }}
                title={t('Delete this color stop')}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
};
