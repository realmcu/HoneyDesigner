import React, { useState } from 'react';
import { PropertyPanelProps } from './types';
import { PropertyEditor } from './PropertyEditor';
import { BaseProperties } from './BaseProperties';
import { EventsPanel } from './EventsPanel';
import { CollapsibleGroup } from './CollapsibleGroup';
import { HelpIcon } from './HelpIcon';
import { NumberInput } from '../NumberInput';
import { componentDefinitions } from '../ComponentLibrary';
import { t } from '../../i18n';

interface GradientStop {
  position: number;  // 0.0 - 1.0
  color: string;     // #RRGGBB
}

export const GeometryProperties: React.FC<PropertyPanelProps> = ({ component, onUpdate, components }) => {
  const [activeTab, setActiveTab] = useState<'properties' | 'events'>('properties');
  const definition = componentDefinitions.find((d) => d.type === component.type);

  // 渐变色标数据（存储在 data.gradientStops 中）
  const gradientStops: GradientStop[] = component.data?.gradientStops || [];
  const useGradient = component.style?.useGradient || false;
  
  // 获取渐变类型/方向的提示文本
  const getGradientHint = () => {
    if (component.type === 'hg_arc') {
      return t('Arc uses angular gradient, color changes along the arc direction');
    } else if (component.type === 'hg_circle') {
      const gradientType = component.style?.gradientType || 'radial';
      if (gradientType === 'radial') {
        return t('Radial gradient: color radiates from center to edge');
      } else {
        return t('Angular gradient: color changes along circumference (requires start/end angle)');
      }
    } else if (component.type === 'hg_rect') {
      const direction = component.style?.gradientDirection || 'horizontal';
      const directionMap: Record<string, string> = {
        'horizontal': t('Horizontal gradient: left to right'),
        'vertical': t('Vertical gradient: top to bottom'),
        'diagonal_tl_br': t('Diagonal gradient: top-left to bottom-right'),
        'diagonal_tr_bl': t('Diagonal gradient: top-right to bottom-left')
      };
      return directionMap[direction] || t('Linear gradient');
    }
    return '';
  };

  const handleStyleChange = (property: string, value: any) => {
    onUpdate({
      style: {
        ...component.style,
        [property]: value,
      },
    });
  };

  const handleDataChange = (property: string, value: any) => {
    onUpdate({
      data: {
        ...component.data,
        [property]: value,
      },
    });
  };

  // 添加渐变色标
  const handleAddGradientStop = () => {
    const newStop: GradientStop = {
      position: gradientStops.length === 0 ? 0 : 1,
      color: '#007acc'
    };
    handleDataChange('gradientStops', [...gradientStops, newStop]);
  };

  // 删除渐变色标
  const handleRemoveGradientStop = (index: number) => {
    const newStops = gradientStops.filter((_, i) => i !== index);
    handleDataChange('gradientStops', newStops);
  };

  // 更新渐变色标
  const handleUpdateGradientStop = (index: number, field: 'position' | 'color', value: any) => {
    const newStops = [...gradientStops];
    newStops[index] = { ...newStops[index], [field]: value };
    handleDataChange('gradientStops', newStops);
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
        {activeTab === 'properties' && (
          <>
            <BaseProperties 
              component={component} 
              onUpdate={onUpdate} 
              components={components}
            />

            {/* Style Properties */}
            {definition && definition.properties.filter(p => p.group === 'style').length > 0 && (
              <CollapsibleGroup title={t('Style')}>
                {definition.properties
                  .filter(p => p.group === 'style')
                  .map((property) => (
                    <div key={property.name} className="property-item">
                      <label>{t(property.label as any)}</label>
                      <PropertyEditor
                        type={property.type as any}
                        value={(component.style as any)?.[property.name]}
                        onChange={(value) => handleStyleChange(property.name, value)}
                        options={property.options as string[]}
                        min={(property as any).min}
                        max={(property as any).max}
                      />
                    </div>
                  ))}
              </CollapsibleGroup>
            )}

            {/* Gradient Settings */}
            {useGradient && (
              <CollapsibleGroup title={t('Gradient Settings')}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                  <button
                    onClick={handleAddGradientStop}
                    style={{
                      padding: '2px 8px',
                      fontSize: '12px',
                      backgroundColor: 'var(--vscode-button-background)',
                      color: 'var(--vscode-button-foreground)',
                      border: 'none',
                      borderRadius: '2px',
                      cursor: 'pointer',
                    }}
                  >
                    + {t('Add Color Stop')}
                  </button>
                </div>

                {/* 渐变类型提示 */}
                <div style={{ 
                  padding: '8px',
                  marginBottom: '8px',
                  backgroundColor: 'var(--vscode-textBlockQuote-background)',
                  borderLeft: '3px solid var(--vscode-textBlockQuote-border)',
                  fontSize: '11px',
                  color: 'var(--vscode-descriptionForeground)'
                }}>
                  {getGradientHint()}
                </div>

                {/* 弧形渐变角度设置 */}
                {component.type === 'hg_arc' && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <div>
                        <label style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>
                          {t('Gradient Start Angle')}
                        </label>
                        <PropertyEditor
                          type="number"
                          value={component.data?.gradientStartAngle ?? component.style?.startAngle ?? 0}
                          onChange={(value) => handleDataChange('gradientStartAngle', value)}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                          {t('Gradient End Angle')}
                          <HelpIcon title={t('Tip: For full arcs (e.g. 270-270), SDK auto-compensates gradient angle for rounded caps')} />
                        </label>
                        <PropertyEditor
                          type="number"
                          value={component.data?.gradientEndAngle ?? component.style?.endAngle ?? 360}
                          onChange={(value) => handleDataChange('gradientEndAngle', value)}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* 圆形角度渐变的额外参数 */}
                {component.type === 'hg_circle' && component.style?.gradientType === 'angular' && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <div>
                        <label style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>
                          {t('Start Angle')}
                        </label>
                        <PropertyEditor
                          type="number"
                          value={component.data?.gradientStartAngle ?? 0}
                          onChange={(value) => handleDataChange('gradientStartAngle', value)}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>
                          {t('End Angle')}
                        </label>
                        <PropertyEditor
                          type="number"
                          value={component.data?.gradientEndAngle ?? 360}
                          onChange={(value) => handleDataChange('gradientEndAngle', value)}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {gradientStops.length === 0 ? (
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
                    {gradientStops.map((stop, index) => (
                      <div 
                        key={index}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '8px',
                          backgroundColor: 'var(--vscode-editor-background)',
                          borderRadius: '4px',
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <label style={{ fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                            {t('Position (0-1)')}
                          </label>
                          <NumberInput
                            min={0}
                            max={1}
                            emptyValue={0}
                            value={stop.position}
                            onChange={(v) => handleUpdateGradientStop(index, 'position', v)}
                            style={{
                              width: '100%',
                              padding: '4px 6px',
                              backgroundColor: 'var(--vscode-input-background)',
                              color: 'var(--vscode-input-foreground)',
                              border: '1px solid var(--vscode-input-border)',
                              borderRadius: '2px',
                            }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label style={{ fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                            {t('Color')}
                          </label>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <input
                              type="color"
                              value={stop.color}
                              onChange={(e) => handleUpdateGradientStop(index, 'color', e.target.value)}
                              style={{ width: '30px', height: '28px', padding: 0, border: 'none' }}
                            />
                            <input
                              type="text"
                              value={stop.color}
                              onChange={(e) => handleUpdateGradientStop(index, 'color', e.target.value)}
                              style={{
                                flex: 1,
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
                          onClick={() => handleRemoveGradientStop(index)}
                          style={{
                            padding: '4px 8px',
                            backgroundColor: 'var(--vscode-button-secondaryBackground)',
                            color: 'var(--vscode-button-secondaryForeground)',
                            border: 'none',
                            borderRadius: '2px',
                            cursor: 'pointer',
                            fontSize: '12px',
                            marginTop: '16px',
                          }}
                          title={t('Delete this color stop')}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {gradientStops.length > 0 && (
                  <div style={{ 
                    marginTop: '8px',
                    padding: '8px',
                    backgroundColor: 'var(--vscode-textBlockQuote-background)',
                    borderLeft: '3px solid var(--vscode-textBlockQuote-border)',
                    fontSize: '11px',
                    color: 'var(--vscode-descriptionForeground)'
                  }}>
                    <strong>{t('Tip')}：</strong>
                    <ul style={{ margin: '4px 0', paddingLeft: '16px' }}>
                      <li>{t('Position value ranges from 0-1, representing gradient start/end position')}</li>
                      <li>{t('At least 2 color stops are required to form a gradient')}</li>
                      {component.type === 'hg_arc' && <li>{t('Arc uses angular gradient (along arc direction)')}</li>}
                      {component.type === 'hg_circle' && component.style?.gradientType === 'radial' && (
                        <li>{t('Radial gradient from center (position 0) to edge (position 1)')}</li>
                      )}
                      {component.type === 'hg_circle' && component.style?.gradientType === 'angular' && (
                        <li>{t('Angular gradient along circumference, from start angle to end angle')}</li>
                      )}
                      {component.type === 'hg_rect' && <li>{t('Linear gradient from start to end in selected direction')}</li>}
                    </ul>
                  </div>
                )}
              </CollapsibleGroup>
            )}

            {/* General Properties - 通用属性（如弧形群组） */}
            {definition && definition.properties.filter(p => p.group === 'general').length > 0 && (
              <CollapsibleGroup title={t('Advanced')} defaultCollapsed={true}>
                {definition.properties
                  .filter(p => p.group === 'general')
                  .map((property) => (
                    <div key={property.name} className="property-item">
                      <label>{t(property.label as any)}</label>
                      <PropertyEditor
                        type={property.type as any}
                        value={(component.data as any)?.[property.name]}
                        onChange={(value) => handleDataChange(property.name, value)}
                        options={property.options as string[]}
                      />
                    </div>
                  ))}
              </CollapsibleGroup>
            )}
          </>
        )}

        {activeTab === 'events' && (
          <EventsPanel component={component} onUpdate={onUpdate} />
        )}
      </div>
    </>
  );
};
