import React, { useState } from 'react';
import { PropertyPanelProps } from './types';
import { BaseProperties } from './BaseProperties';
import { EventsPanel } from './EventsPanel';
import { CollapsibleGroup } from './CollapsibleGroup';
import { t } from '../../i18n';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '4px 6px',
  marginTop: '4px',
  backgroundColor: 'var(--vscode-input-background)',
  color: 'var(--vscode-input-foreground)',
  border: '1px solid var(--vscode-input-border)',
  borderRadius: '2px',
};

const helpTextStyle: React.CSSProperties = {
  display: 'block',
  marginTop: '2px',
  fontSize: '11px',
  color: 'var(--vscode-descriptionForeground)',
};

export const HgStreamingProperties: React.FC<PropertyPanelProps> = ({ component, onUpdate, components }) => {
  const [activeTab, setActiveTab] = useState<'properties' | 'events'>('properties');

  const handlePropertyChange = (property: string, value: any) => {
    onUpdate({ data: { ...component.data, [property]: value } });
  };

  const d = component.data || {};
  const codec = (d.codec as string) || 'jpeg';
  const transporter = (d.transporter as string) || '';
  const updateInterval = (d.updateInterval as number) ?? 40;
  const dropMode = (d.dropMode as string) || 'none';

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
            <BaseProperties component={component} onUpdate={onUpdate} components={components} />

            {/* 流媒体源 */}
            <CollapsibleGroup title={t('Stream Source')}>
              <div className="property-item">
                <label>{t('Codec')}</label>
                <select
                  value={codec}
                  onChange={(e) => handlePropertyChange('codec', e.target.value)}
                  style={inputStyle}
                >
                  <option value="jpeg">JPEG / MJPEG</option>
                  <option value="msv1">MSV1 (Microsoft Video 1)</option>
                  <option value="cinepak">Cinepak (CVID)</option>
                  <option value="raw">RAW (Uncompressed)</option>
                </select>
                <small style={helpTextStyle}>{t('Encoded frame format delivered by the transport')}</small>
              </div>

              <div className="property-item">
                <label>{t('Transporter Variable')}</label>
                <input
                  type="text"
                  value={transporter}
                  onChange={(e) => handlePropertyChange('transporter', e.target.value)}
                  placeholder="my_transport"
                  style={inputStyle}
                />
                <small style={helpTextStyle}>{t('stp_transport_t * variable name (app-owned, must outlive widget)')}</small>
              </div>
            </CollapsibleGroup>

            {/* 更新策略 */}
            <CollapsibleGroup title={t('Update Policy')}>
              <div className="property-item">
                <label>{t('Update Interval (ms)')}</label>
                <input
                  type="number"
                  min="10"
                  max="5000"
                  value={updateInterval}
                  onChange={(e) => handlePropertyChange('updateInterval', parseInt(e.target.value) || 40)}
                  style={inputStyle}
                />
                <small style={helpTextStyle}>{t('Frame pull interval in milliseconds (default 40 ms = 25 fps)')}</small>
              </div>

              <div className="property-item">
                <label>{t('Drop Mode')}</label>
                <select
                  value={dropMode}
                  onChange={(e) => handlePropertyChange('dropMode', e.target.value)}
                  style={inputStyle}
                >
                  <option value="none">{t('None (oldest-first, never drop)')}</option>
                  <option value="unconditional">{t('Unconditional (jump to newest)')}</option>
                </select>
                <small style={helpTextStyle}>
                  {dropMode === 'unconditional'
                    ? t('Only safe for independently decodable frames (RAW / JPEG)')
                    : t('Default: process frames in order, never skip')}
                </small>
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
