import React, { useState } from 'react';
import { PropertyPanelProps } from './types';
import { PropertyEditor } from './PropertyEditor';
import { BaseProperties } from './BaseProperties';
import { EventsPanel } from './EventsPanel';
import { CollapsibleGroup } from './CollapsibleGroup';
import { t } from '../../i18n';

export const HgQbcodeProperties: React.FC<PropertyPanelProps> = ({ component, onUpdate, components }) => {
  const [activeTab, setActiveTab] = useState<'properties' | 'events'>('properties');

  const codeType = component.data?.codeType ?? 'qrcode';
  const isBarcode = codeType === 'barcode';

  const handleDataChange = (property: string, value: any) => {
    const newData: Record<string, any> = {
      ...component.data,
      [property]: value,
    };

    // When switching code type, reset displayMode and encodeMode to valid defaults
    if (property === 'codeType') {
      newData.displayMode = 'section';
      newData.encodeMode = 'text';
    }

    onUpdate({ data: newData });
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
            <BaseProperties component={component} onUpdate={onUpdate} components={components} />

            <CollapsibleGroup title={t('Content')}>
              {/* Code Type */}
              <div className="property-item">
                <label>{t('Code Type')}</label>
                <PropertyEditor
                  type="select"
                  value={codeType}
                  onChange={(value) => handleDataChange('codeType', value)}
                  options={['qrcode', 'barcode']}
                />
              </div>

              {/* Encode Mode (only for QR code) */}
              {!isBarcode && (
                <div className="property-item">
                  <label>{t('Encode Mode')}</label>
                  <PropertyEditor
                    type="select"
                    value={component.data?.encodeMode ?? 'text'}
                    onChange={(value) => handleDataChange('encodeMode', value)}
                    options={['text', 'binary']}
                  />
                </div>
              )}

              {/* Display Mode */}
              <div className="property-item">
                <label>{t('Display Mode')}</label>
                <PropertyEditor
                  type="select"
                  value={component.data?.displayMode ?? 'section'}
                  onChange={(value) => handleDataChange('displayMode', value)}
                  options={['section', 'image']}
                />
              </div>

              {/* Content */}
              <div className="property-item">
                <label>{t('Code Content')}</label>
                <PropertyEditor
                  type="string"
                  value={component.data?.codeContent ?? ''}
                  onChange={(value) => handleDataChange('codeContent', value)}
                />
              </div>

              {/* Border Size */}
              <div className="property-item">
                <label>{t('Border Size')}</label>
                <PropertyEditor
                  type="number"
                  value={component.data?.borderSize ?? 2}
                  onChange={(value) => handleDataChange('borderSize', value)}
                  min={0}
                  max={32}
                />
              </div>

              {/* Display mode hint */}
              <div style={{
                padding: '6px 8px',
                marginTop: '4px',
                backgroundColor: 'var(--vscode-textBlockQuote-background)',
                borderLeft: '3px solid var(--vscode-textBlockQuote-border)',
                fontSize: '11px',
                color: 'var(--vscode-descriptionForeground)',
              }}>
                {component.data?.displayMode === 'image'
                  ? t('Image mode: pre-rendered to psRAM, better performance')
                  : t('Section mode: real-time framebuffer draw')}
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
