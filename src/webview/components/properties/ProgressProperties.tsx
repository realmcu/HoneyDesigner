import React, { useState } from 'react';
import { FolderOpen } from 'lucide-react';
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
              <div className="property-item">
                <label>{t('Show Value Label')}</label>
                <PropertyEditor type="boolean" value={config.showValueLabel}
                  onChange={value => update('showValueLabel', value)} />
              </div>
              {config.showValueLabel && (
                <>
                  <div className="property-item">
                    <label>{t('Value Label Format')}</label>
                    <PropertyEditor type="select" value={config.valueLabelFormat}
                      options={[
                        { value: 'percent', label: t('Percentage') },
                        { value: 'value', label: t('Current Value') },
                      ]}
                      onChange={value => update('valueLabelFormat', value)} />
                  </div>
                  <div className="property-item">
                    <label>{t('Value Label Color')}</label>
                    <PropertyEditor type="color" value={config.valueLabelColor}
                      onChange={value => update('valueLabelColor', value)} />
                  </div>
                  <div className="property-item">
                    <label>{t('Value Label Font Size')}</label>
                    <PropertyEditor type="number" value={config.valueLabelFontSize} min={1} max={255}
                      onChange={value => update('fontSize', Math.round(value))} />
                  </div>
                  <div className="property-item">
                    <label>{t('Font File')}</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <PropertyEditor type="string" value={component.data?.fontFile ?? ''}
                          onChange={value => update('fontFile', value)} />
                      </div>
                      <button type="button"
                        onClick={() => window.vscodeAPI?.postMessage({
                          command: 'selectFontPath',
                          componentId: component.id,
                        })}
                        title={t('Font File')}
                        aria-label={t('Font File')}
                        style={{
                          flex: '0 0 28px', width: 28, height: 28, marginTop: 4,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          backgroundColor: 'var(--vscode-button-background)',
                          color: 'var(--vscode-button-foreground)',
                          border: 'none', borderRadius: 2, cursor: 'pointer',
                        }}>
                        <FolderOpen size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="property-item">
                    <label>{t('Font Type')}</label>
                    <PropertyEditor type="select" value={component.data?.fontType || 'bitmap'}
                      options={[
                        { value: 'bitmap', label: t('Bitmap font') },
                        { value: 'vector', label: t('Vector font') },
                      ]}
                      onChange={value => update('fontType', value)} />
                  </div>
                  <div className="property-item">
                    <label>{t('Value Label Offset X')}</label>
                    <PropertyEditor type="number" value={config.valueLabelOffsetX}
                      onChange={value => update('valueLabelOffsetX', Math.round(value))} />
                  </div>
                  <div className="property-item">
                    <label>{t('Value Label Offset Y')}</label>
                    <PropertyEditor type="number" value={config.valueLabelOffsetY}
                      onChange={value => update('valueLabelOffsetY', Math.round(value))} />
                  </div>
                </>
              )}
            </CollapsibleGroup>
            <CollapsibleGroup title={t('Style')}>
              <div className="property-item">
                <label>{t('Progress Mode')}</label>
                <PropertyEditor type="select" value={config.mode}
                  options={[
                    { value: 'linear', label: t('Linear') },
                    { value: 'segmented', label: t('Segmented') },
                    { value: 'arc', label: t('Arc Progress') },
                    { value: 'arc-segmented', label: t('Segmented Arc') },
                  ]}
                  onChange={value => {
                    const wasArc = config.mode.startsWith('arc');
                    const isArc = String(value).startsWith('arc');
                    const { width, height } = component.position;
                    const isDefaultSize = wasArc
                      ? width === 100 && height === 100
                      : config.vertical ? width === 24 && height === 220 : width === 220 && height === 24;
                    const longestSide = Math.max(width, height);
                    const nextSize = isDefaultSize
                      ? (isArc ? { width: 100, height: 100 }
                        : config.vertical ? { width: 24, height: 220 } : { width: 220, height: 24 })
                      : (isArc ? { width: longestSide, height: longestSide }
                        : config.vertical ? { width: 24, height: longestSide } : { width: longestSide, height: 24 });
                    onUpdate({
                      data: { ...component.data, progressMode: value },
                      ...(wasArc !== isArc ? {
                        position: { ...component.position, ...nextSize },
                      } : {}),
                    });
                  }} />
              </div>
              {(config.mode === 'segmented' || config.mode === 'arc-segmented') && (
                <>
                  <div className="property-item">
                    <label>{t('Segment Count')}</label>
                    <PropertyEditor type="number" value={config.count} min={1} max={64}
                      onChange={value => update('segmentCount', Math.round(value))} />
                  </div>
                  {config.mode === 'segmented' && <div className="property-item">
                    <label>{t('Segment Gap')}</label>
                    <PropertyEditor type="number" value={config.gap} min={0}
                      onChange={value => update('segmentGap', Math.round(value))} />
                  </div>}
                </>
              )}
              {config.mode.startsWith('arc') && (
                <>
                  <div className="property-item">
                    <label>{t('Arc Direction')}</label>
                    <PropertyEditor type="select" value={config.arcDirection}
                      options={[
                        { value: 'clockwise', label: t('Clockwise') },
                        { value: 'counterclockwise', label: t('Counterclockwise') },
                      ]}
                      onChange={value => update('arcDirection', value)} />
                  </div>
                  {([
                    ['arcStartAngle', 'Arc Start Angle', config.arcStartAngle, -360, 360],
                    ['arcSweepAngle', 'Arc Sweep Angle', config.arcSweepAngle, 1, 360],
                    ['arcStrokeWidth', 'Arc Stroke Width', config.arcStrokeWidth, 1, 10000],
                    ...(config.mode === 'arc-segmented'
                      ? [['arcSegmentGap', 'Arc Segment Gap', config.arcSegmentGap, 0, 360]]
                      : []),
                  ] as Array<[string, string, number, number, number]>).map(([key, label, value, min, max]) => (
                    <div className="property-item" key={key}>
                      <label>{t(label as Parameters<typeof t>[0])}</label>
                      <PropertyEditor type="number" value={value} min={min} max={max}
                        onChange={next => update(key, next)} />
                    </div>
                  ))}
                </>
              )}
              {!config.mode.startsWith('arc') && <>
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
              </>}
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
