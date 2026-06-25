import React, { useState } from 'react';
import { PropertyPanelProps } from './types';
import { BaseProperties } from './BaseProperties';
import { PropertyEditor } from './PropertyEditor';
import { EventsPanel } from './EventsPanel';
import { CollapsibleGroup } from './CollapsibleGroup';
import { HelpIcon } from './HelpIcon';
import { t } from '../../i18n';

export const HgWindowProperties: React.FC<PropertyPanelProps> = ({ component, onUpdate, components }) => {
  const [activeTab, setActiveTab] = useState<'properties' | 'events'>('properties');
  const enableBlur = component.data?.enableBlur ?? false;
  const blurDegree = component.data?.blurDegree ?? 225;
  const showBackground = component.style?.showBackground ?? false;
  const backgroundColor = component.style?.backgroundColor ?? '#808080';

  const handleStyleChange = (property: string, value: any) => {
    onUpdate({
      style: {
        ...component.style,
        [property]: value,
      },
    });
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

            {/* 样式属性（合并背景 + 模糊） */}
            <CollapsibleGroup title={t('Style')}>
              <div className="property-item">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>{t('Show Background')}</label>
                  <PropertyEditor
                    type="boolean"
                    value={showBackground}
                    onChange={(value) => handleStyleChange('showBackground', value)}
                  />
                </div>
              </div>

              {showBackground && (
                <div className="property-item">
                  <label>{t('Background Color')}</label>
                  <PropertyEditor
                    type="color"
                    value={backgroundColor}
                    onChange={(value) => handleStyleChange('backgroundColor', value)}
                  />
                </div>
              )}

              <div className="property-item">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>{t('Enable Blur')}</label>
                  <PropertyEditor
                    type="boolean"
                    value={enableBlur}
                    onChange={(value) => onUpdate({ data: { ...component.data, enableBlur: value } })}
                  />
                </div>
              </div>

              {enableBlur && (
                <div className="property-item">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>{t('Blur Degree')} (0-255) <HelpIcon title={t('Default value: 225')} /></label>
                  <PropertyEditor
                    type="number"
                    value={blurDegree}
                    onChange={(value) => {
                      const clampedValue = Math.max(0, Math.min(255, value));
                      onUpdate({ data: { ...component.data, blurDegree: clampedValue } });
                    }}
                  />
                </div>
              )}
            </CollapsibleGroup>
          </>
        )}

        {activeTab === 'events' && (
          <EventsPanel component={component} onUpdate={onUpdate} />
        )}
      </div>
    </>
  );
};
