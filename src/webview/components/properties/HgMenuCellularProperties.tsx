import React, { useState } from 'react';
import { PropertyPanelProps } from './types';
import { PropertyEditor } from './PropertyEditor';
import { BaseProperties } from './BaseProperties';
import { EventsPanel } from './EventsPanel';
import { CollapsibleGroup } from './CollapsibleGroup';
import { NumberInput } from '../NumberInput';
import { t } from '../../i18n';
import { SWITCH_OUT_STYLES, SWITCH_IN_STYLES } from '../../../hml/eventTypes';
import { useDesignerStore } from '../../store';

interface IconAction {
  target?: string;
  switchOutStyle?: string;
  switchInStyle?: string;
}

export const HgMenuCellularProperties: React.FC<PropertyPanelProps> = ({ component, onUpdate, components }) => {
  const [activeTab, setActiveTab] = useState<'properties' | 'events'>('properties');
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragIndexRef = React.useRef<number | null>(null);

  const allViews = useDesignerStore((state) => state.allViews || []);
  const currentViews = (components || []).filter(c => c.type === 'hg_view');

  // 合并当前文件 view + 其他文件 view
  const views = React.useMemo(() => {
    const currentViewIds = new Set(currentViews.map(v => v.id));
    const otherViews = allViews.filter(v => !currentViewIds.has(v.id));
    return [
      ...currentViews.map(v => ({ id: v.id, name: v.name || v.id, file: 'current' })),
      ...otherViews.map(v => ({ id: v.id, name: v.name, file: v.file })),
    ];
  }, [currentViews, allViews]);

  const data = component.data || {};
  const iconImages: string[] = Array.isArray(data.iconImages) ? data.iconImages : [];
  const iconActions: IconAction[] = Array.isArray(data.iconActions) ? data.iconActions : [];
  const iconSize: number = typeof data.iconSize === 'number' ? data.iconSize : 64;
  const offsetX: number = typeof data.offsetX === 'number' ? data.offsetX : 0;
  const offsetY: number = typeof data.offsetY === 'number' ? data.offsetY : 0;

  const handleDataChange = (property: string, value: any) => {
    onUpdate({ data: { ...component.data, [property]: value } });
  };

  const handleSelectFolder = () => {
    window.vscodeAPI?.postMessage({ command: 'selectFolderPath', componentId: component.id });
  };

  const handleAddImage = () => {
    window.vscodeAPI?.postMessage({ command: 'selectImagePath', componentId: component.id, propertyName: 'iconImages' });
  };

  const handleRemoveImage = (index: number) => {
    const newImages = iconImages.filter((_, i) => i !== index);
    const newActions = iconActions.filter((_, i) => i !== index);
    onUpdate({ data: { ...component.data, iconImages: newImages, iconActions: newActions } });
  };

  const handleDragStart = (index: number) => {
    dragIndexRef.current = index;
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const dragIndex = dragIndexRef.current;
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragOverIndex(null);
      return;
    }
    const newImages = [...iconImages];
    const newActions = [...iconActions];
    // 补齐 actions 长度
    while (newActions.length < newImages.length) { newActions.push({}); }

    const [imgItem] = newImages.splice(dragIndex, 1);
    const [actItem] = newActions.splice(dragIndex, 1);
    newImages.splice(dropIndex, 0, imgItem);
    newActions.splice(dropIndex, 0, actItem);

    dragIndexRef.current = null;
    setDragOverIndex(null);
    onUpdate({ data: { ...component.data, iconImages: newImages, iconActions: newActions } });
  };

  const handleDragEnd = () => {
    dragIndexRef.current = null;
    setDragOverIndex(null);
  };

  const handleActionChange = (index: number, field: keyof IconAction, value: string) => {
    const newActions = [...iconActions];
    while (newActions.length <= index) { newActions.push({}); }
    newActions[index] = { ...newActions[index], [field]: value };
    handleDataChange('iconActions', newActions);
  };

  const getAction = (index: number): IconAction => iconActions[index] || {};

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '4px 6px',
    backgroundColor: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-input-border)',
    borderRadius: '2px',
    fontSize: '12px',
    boxSizing: 'border-box',
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: 'pointer',
  };

  const buttonStyle: React.CSSProperties = {
    padding: '4px 8px',
    backgroundColor: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    border: 'none',
    borderRadius: '2px',
    cursor: 'pointer',
    fontSize: '12px',
    whiteSpace: 'nowrap',
  };

  const secondaryButtonStyle: React.CSSProperties = {
    padding: '4px 8px',
    backgroundColor: 'var(--vscode-button-secondaryBackground)',
    color: 'var(--vscode-button-secondaryForeground)',
    border: 'none',
    borderRadius: '2px',
    cursor: 'pointer',
    fontSize: '12px',
  };

  return (
    <>
      <div className="properties-tabs">
        <button
          className={activeTab === 'properties' ? 'active' : ''}
          onClick={() => setActiveTab('properties')}
        >
          {t('Properties')}
        </button>
        <button
          className={activeTab === 'events' ? 'active' : ''}
          onClick={() => setActiveTab('events')}
        >
          {t('Events')}
        </button>
      </div>

      <div className="properties-content">
      {activeTab === 'properties' ? (
        <>
          {/* 基础属性 - 坐标/宽高只读 */}
          <BaseProperties
            component={component}
            onUpdate={onUpdate}
            components={components}
            disableSize={true}
            disablePosition={true}
            positionTooltip={t('hg_menu_cellular position is fixed at (0,0) and cannot be modified')}
            sizeTooltip={t('hg_menu_cellular size is determined by project resolution and cannot be modified')}
          />

          {/* 图标配置 */}
          <CollapsibleGroup title={t('Content')}>

            <div className="property-item">
              <label>{t('Icon Folder')}</label>
              <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                <input
                  type="text"
                  value={data.iconFolder || ''}
                  onChange={(e) => handleDataChange('iconFolder', e.target.value)}
                  placeholder="icons/menu"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button onClick={handleSelectFolder} style={buttonStyle} title={t('Select Folder')}>
                  📁
                </button>
              </div>
            </div>

            <div className="property-item">
              <button onClick={handleAddImage} style={{ ...secondaryButtonStyle, width: '100%' }}>
                + {t('Add Image')}
              </button>
            </div>

            <div className="property-item">
              <span style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)' }}>
                {t('Icon Count').replace('{count}', String(iconImages.length))}
              </span>
            </div>

            {/* 图标列表 + 每个图标的跳转配置 */}
            {iconImages.length > 0 && (
              <div className="property-item">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {iconImages.map((imgPath, index) => {
                    const action = getAction(index);
                    return (
                      <div
                        key={index}
                        draggable
                        onDragStart={() => handleDragStart(index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDrop={(e) => handleDrop(e, index)}
                        onDragEnd={handleDragEnd}
                        style={{
                          border: `1px solid ${dragOverIndex === index ? 'var(--vscode-focusBorder)' : 'var(--vscode-widget-border, #444)'}`,
                          borderRadius: '3px',
                          padding: '6px',
                          backgroundColor: 'var(--vscode-editor-background)',
                          cursor: 'grab',
                          opacity: dragIndexRef.current === index ? 0.5 : 1,
                        }}
                      >
                        {/* 图标路径行 */}
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginBottom: '6px' }}>
                          <span style={{
                            fontSize: '11px',
                            color: 'var(--vscode-descriptionForeground)',
                            minWidth: '18px',
                            textAlign: 'right',
                          }}>
                            {index}
                          </span>
                          <input
                            type="text"
                            value={imgPath}
                            readOnly
                            style={{ ...inputStyle, flex: 1, fontSize: '11px' }}
                            title={imgPath}
                          />
                          <button
                            onClick={() => handleRemoveImage(index)}
                            style={{
                              padding: '2px 6px',
                              backgroundColor: 'var(--vscode-button-secondaryBackground)',
                              color: 'var(--vscode-errorForeground, #f44)',
                              border: 'none',
                              borderRadius: '2px',
                              cursor: 'pointer',
                              fontSize: '12px',
                            }}
                            title={t('Delete')}
                          >
                            ✕
                          </button>
                        </div>

                        {/* 跳转目标 */}
                        <div style={{ marginBottom: '4px' }}>
                          <label style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', display: 'block', marginBottom: '2px' }}>
                            {t('Target View')}
                          </label>
                          <select
                            value={action.target || ''}
                            onChange={(e) => handleActionChange(index, 'target', e.target.value)}
                            style={selectStyle}
                          >
                            <option value="">-- {t('None')} --</option>
                            {views.map(v => (
                              <option key={v.id} value={v.id}>
                                {v.name} {v.file !== 'current' ? `(${v.file})` : `(${t('Current File')})`}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* 仅当选了目标时显示动画选项 */}
                        {action.target && action.target.trim() !== '' && (
                          <>
                            <div style={{ marginBottom: '4px' }}>
                              <label style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', display: 'block', marginBottom: '2px' }}>
                                {t('Exit Animation')}
                              </label>
                              <select
                                value={action.switchOutStyle || 'SWITCH_OUT_TO_LEFT_USE_TRANSLATION'}
                                onChange={(e) => handleActionChange(index, 'switchOutStyle', e.target.value)}
                                style={selectStyle}
                              >
                                {SWITCH_OUT_STYLES.map(s => (
                                  <option key={s.value} value={s.value}>{t(s.labelKey as any)}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', display: 'block', marginBottom: '2px' }}>
                                {t('Enter Animation')}
                              </label>
                              <select
                                value={action.switchInStyle || 'SWITCH_IN_FROM_RIGHT_USE_TRANSLATION'}
                                onChange={(e) => handleActionChange(index, 'switchInStyle', e.target.value)}
                                style={selectStyle}
                              >
                                {SWITCH_IN_STYLES.map(s => (
                                  <option key={s.value} value={s.value}>{t(s.labelKey as any)}</option>
                                ))}
                              </select>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CollapsibleGroup>

          {/* 样式（图标尺寸 + 偏移量） */}
          <CollapsibleGroup title={t('Style')}>
            <div className="property-item">
              <label>icon_size</label>
              <PropertyEditor
                type="number"
                value={iconSize}
                min={1}
                onChange={(val) => {
                  const num = parseInt(String(val));
                  if (!isNaN(num) && num >= 1) { handleDataChange('iconSize', num); }
                }}
              />
            </div>
            <div className="property-item">
              <label>offset_x</label>
              <NumberInput
                integer
                emptyValue={0}
                value={offsetX}
                onChange={(v) => handleDataChange('offsetX', v)}
                style={{ ...inputStyle, marginTop: '4px' }}
              />
            </div>
            <div className="property-item">
              <label>offset_y</label>
              <NumberInput
                integer
                emptyValue={0}
                value={offsetY}
                onChange={(v) => handleDataChange('offsetY', v)}
                style={{ ...inputStyle, marginTop: '4px' }}
              />
            </div>
          </CollapsibleGroup>
        </>
      ) : (
        <EventsPanel component={component} onUpdate={onUpdate} />
      )}
      </div>
    </>
  );
};
