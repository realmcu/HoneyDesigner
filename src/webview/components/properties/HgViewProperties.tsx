import React, { useState, useMemo } from 'react';
import { PropertyPanelProps } from './types';
import { PropertyEditor } from './PropertyEditor';
import { BaseProperties } from './BaseProperties';
import { EventsPanel } from './EventsPanel';
import { CollapsibleGroup } from './CollapsibleGroup';
import { t } from '../../i18n';
import { calculateViewComplexity } from '../../utils/viewComplexity';

export const HgViewProperties: React.FC<PropertyPanelProps> = ({ component, onUpdate, components }) => {
  const [activeTab, setActiveTab] = useState<'properties' | 'events'>('properties');

  // 计算默认动画步长（屏幕高度的 1/10）
  const defaultAnimateStep = Math.round(component.position.height / 10);

  // 计算页面复杂度
  const complexity = useMemo(
    () => calculateViewComplexity(component, components ?? []),
    [component, components]
  );

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
              disableSize={true}
              sizeTooltip={t('hg_view size is determined by project resolution and cannot be modified')}
              hideParent={true}
            />

            {/* Style Properties */}
            <CollapsibleGroup title={t('Style')}>
              <div className="property-item">
                <label>{t('Background Color')}</label>
                <PropertyEditor
                  type="color"
                  value={component.style?.backgroundColor}
                  onChange={(value) => handleStyleChange('backgroundColor', value)}
                />
              </div>
            </CollapsibleGroup>

            {/* Advanced Properties */}
            <CollapsibleGroup title={t('Advanced')} defaultCollapsed={true}>
              <div className="property-item">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>{t('UI Entry View')}</label>
                  <PropertyEditor
                    type="boolean"
                    value={component.data?.entry === true || component.data?.entry === 'true'}
                    onChange={(value) => handleDataChange('entry', value)}
                  />
                </div>
              </div>
              <div className="property-item" style={{ opacity: 0.4, pointerEvents: 'none' }} title="Coming soon">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>{t('Resident Memory')}</label>
                  <PropertyEditor
                    type="boolean"
                    value={component.data?.residentMemory || false}
                    onChange={(value) => handleDataChange('residentMemory', value)}
                  />
                </div>
              </div>
              <div className="property-item" title={t('Snapshot Cache Tooltip')}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>{t('Snapshot Cache')}</label>
                  <PropertyEditor
                    type="boolean"
                    value={component.data?.snapShot === true || component.data?.snapShot === 'true'}
                    onChange={(value) => handleDataChange('snapShot', value)}
                  />
                </div>
              </div>
              <div className="property-item">
                <label>{t('Animation Step')}</label>
                <PropertyEditor
                  type="number"
                  value={component.data?.animateStep ?? defaultAnimateStep}
                  onChange={(value) => handleDataChange('animateStep', value)}
                />
              </div>
              <div className="property-item">
                <label>{t('Opacity (0-255)')}</label>
                <PropertyEditor
                  type="number"
                  value={component.data?.opacity ?? 255}
                  onChange={(value) => handleDataChange('opacity', value)}
                  min={0}
                  max={255}
                />
              </div>
            </CollapsibleGroup>

            {/* 页面统计 */}
            <CollapsibleGroup title={t('Statistics')} cacheKey="view-statistics" defaultCollapsed={false}>
              <div className="property-item">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>{t('Child Components')}</label>
                  <span style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '12px' }}>
                    {complexity.childCount}
                  </span>
                </div>
              </div>
              <div className="property-item">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>{t('Draw Pixels')}</label>
                  <span style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '12px' }}>
                    {Math.round(complexity.totalPixelArea).toLocaleString()}
                  </span>
                </div>
              </div>
              <div className="property-item">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>{t('Page Complexity')}</label>
                  <span style={{
                    color: complexity.drawCoverage > 5 ? 'var(--vscode-errorForeground)' :
                           complexity.drawCoverage > 3 ? 'var(--vscode-editorWarning-foreground)' :
                           'var(--vscode-descriptionForeground)',
                    fontSize: '12px',
                    fontWeight: complexity.drawCoverage > 5 ? 'bold' : 'normal',
                  }}>
                    {complexity.drawCoverage.toFixed(2)}x ({(complexity.drawCoverage * 100).toFixed(0)}%)
                  </span>
                </div>
              </div>
              <div className="property-item">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>{t('Render Cost')}</label>
                  <span style={{
                    color: complexity.complexity > 5 ? 'var(--vscode-errorForeground)' :
                           complexity.complexity > 3 ? 'var(--vscode-editorWarning-foreground)' :
                           'var(--vscode-descriptionForeground)',
                    fontSize: '12px',
                    fontWeight: complexity.complexity > 5 ? 'bold' : 'normal',
                  }}>
                    {complexity.complexity.toFixed(2)}x
                  </span>
                </div>
              </div>
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
