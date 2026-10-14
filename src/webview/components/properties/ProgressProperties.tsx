import React, { useState } from 'react';
import type { PropertyPanelProps } from './types';
import { BaseProperties } from './BaseProperties';
import { CollapsibleGroup } from './CollapsibleGroup';
import { PropertyEditor } from './PropertyEditor';
import { EventsPanel } from './EventsPanel';
import { progressConfig } from '../../../shared/progressConfig';
import { t } from '../../i18n';

export const ProgressProperties: React.FC<PropertyPanelProps> = ({ component, onUpdate, components }) => {
  const [tab, setTab] = useState<'properties' | 'events'>('properties');
  const config = progressConfig(component.data, component.style);
  const update = (key: string, value: unknown) => onUpdate({ data: { ...component.data, [key]: value } });
  const fields = [
    { key: 'min', label: t('Min'), value: config.min },
    { key: 'max', label: t('Max'), value: config.max },
    { key: 'value', label: t('Value'), value: config.value },
  ];

  return (
    <>
      <div className="properties-tabs">
        <button className={tab === 'properties' ? 'active' : ''} onClick={() => setTab('properties')}>{t('Properties')}</button>
        <button className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}>{t('Events')}</button>
      </div>
      <div className="properties-content">
        {tab === 'properties' ? (
          <>
            <BaseProperties component={component} onUpdate={onUpdate} components={components} />
            <CollapsibleGroup title={t('Content')}>
              {fields.map(field => (
                <div className="property-item" key={field.key}>
                  <label>{field.label}</label>
                  <PropertyEditor type="number" value={field.value} onChange={value => update(field.key, value)} />
                </div>
              ))}
            </CollapsibleGroup>
            <CollapsibleGroup title={t('Style')}>
              <div className="property-item">
                <label>{t('Progress Mode')}</label>
                <PropertyEditor type="select" value={config.mode}
                  options={[{ value: 'linear', label: t('Linear') }, { value: 'segmented', label: t('Segmented') }]}
                  onChange={value => update('progressMode', value)} />
              </div>
              {config.mode === 'segmented' && (
                <>
                  <div className="property-item">
                    <label>{t('Segment Count')}</label>
                    <PropertyEditor type="number" value={config.count} min={1} max={64}
                      onChange={value => update('segmentCount', Math.round(value))} />
                  </div>
                  <div className="property-item">
                    <label>{t('Segment Gap')}</label>
                    <PropertyEditor type="number" value={config.gap} min={0}
                      onChange={value => update('segmentGap', Math.round(value))} />
                  </div>
                </>
              )}
              <div className="property-item">
                <label>{t('Border Radius')}</label>
                <PropertyEditor type="number" value={config.cornerRadius} min={0}
                  onChange={value => onUpdate({ style: { ...component.style, borderRadius: Math.round(value) } })} />
              </div>
              <div className="property-item">
                <label>{t('Orientation')}</label>
                <PropertyEditor type="select" value={config.vertical ? 'vertical' : 'horizontal'}
                  options={[
                    { value: 'horizontal', label: t('Horizontal') },
                    { value: 'vertical', label: t('Vertical') },
                  ]}
                  onChange={value => {
                    if ((value === 'vertical') === config.vertical) return;
                    onUpdate({
                      data: {
                        ...component.data,
                        fillStart: value === 'vertical'
                          ? (config.fillStart === 'right' ? 'top' : 'bottom')
                          : (config.fillStart === 'top' ? 'right' : 'left'),
                      },
                      style: { ...component.style, orientation: value },
                      position: {
                        ...component.position,
                        width: component.position.height,
                        height: component.position.width,
                      },
                    });
                  }} />
              </div>
              <div className="property-item">
                <label>{t('Fill Start')}</label>
                <PropertyEditor type="select" value={config.fillStart}
                  options={config.vertical
                    ? [{ value: 'bottom', label: t('Bottom') }, { value: 'top', label: t('Top') }]
                    : [{ value: 'left', label: t('Left') }, { value: 'right', label: t('Right') }]}
                  onChange={value => update('fillStart', value)} />
              </div>
              <div className="property-item">
                <label>{t('Active Color')}</label>
                <PropertyEditor type="color" value={config.activeColor} onChange={value => update('activeColor', value)} />
              </div>
              <div className="property-item">
                <label>{t('Active Opacity')}</label>
                <PropertyEditor type="number" value={config.activeOpacity} min={0} max={255}
                  onChange={value => update('activeOpacity', value)} />
              </div>
              <div className="property-item">
                <label>{t('Inactive Color')}</label>
                <PropertyEditor type="color" value={config.inactiveColor} onChange={value => update('inactiveColor', value)} />
              </div>
              <div className="property-item">
                <label>{t('Inactive Opacity')}</label>
                <PropertyEditor type="number" value={config.inactiveOpacity} min={0} max={255}
                  onChange={value => update('inactiveOpacity', value)} />
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
