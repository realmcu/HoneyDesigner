import React, { useState } from 'react';
import { PropertyPanelProps } from './types';
import { PropertyEditor } from './PropertyEditor';
import { BaseProperties } from './BaseProperties';
import { EventsPanel } from './EventsPanel';
import { CollapsibleGroup } from './CollapsibleGroup';
import { HelpIcon } from './HelpIcon';
import { getEffectConfig, PARTICLE_EFFECTS } from '../../constants/particleEffects';
import { t } from '../../i18n';

// 效果图标映射
const EFFECT_ICONS: Record<string, string> = {
  snow: '❄️', rain: '🌧️', firework: '🎆', bubble: '🫧',
  fireflies: '✨', galaxy: '🌌', vortex: '🌀', tunnel: '🔦',
  lightning: '⚡', light_beam: '💡', magic_circle: '🔮', rocket: '🚀',
  ripple: '💧', trail: '🖱️', touch: '👆', custom: '⚙️',
};

export const HgParticleProperties: React.FC<PropertyPanelProps> = ({ component, onUpdate, components }) => {
  const [activeTab, setActiveTab] = useState<'properties' | 'events'>('properties');
  const [isPlaying, setIsPlaying] = useState(true);
  const effectType = (component.data as any)?.particleEffect || 'snow';
  const config = getEffectConfig(effectType);
  const isInteractive = !!config?.interactive;
  const interactivePreview = !!(component.data as any)?.interactivePreview;

  const handleDataChange = (property: string, value: any) => {
    onUpdate({ data: { ...component.data, [property]: value } });
  };

  const dispatchControl = (action: string) => {
    window.dispatchEvent(new CustomEvent('particleControl', {
      detail: { componentId: component.id, action },
    }));
  };

  const togglePlayPause = () => {
    const next = !isPlaying;
    setIsPlaying(next);
    dispatchControl(next ? 'play' : 'pause');
  };

  // 构建带翻译名称的 options（隐藏 custom，仅测试用）
  const effectOptions = PARTICLE_EFFECTS
    .filter(e => e.type !== 'custom')
    .map(e => ({
      value: e.type,
      label: `${EFFECT_ICONS[e.type] || '✨'} ${t(e.i18nKey as any)}`,
    }));

  return (
    <>
      <div className="properties-tabs">
        <button className={activeTab === 'properties' ? 'active' : ''} onClick={() => setActiveTab('properties')}>
          {t('Properties')}
        </button>
        <button className={activeTab === 'events' ? 'active' : ''} onClick={() => setActiveTab('events')}>
          {t('Events')}
        </button>
      </div>

      <div className="properties-content">
        {activeTab === 'properties' && (
          <>
            <BaseProperties component={component} onUpdate={onUpdate} components={components} />

            {/* 特效类型选择 */}
            <CollapsibleGroup title={t('Content')}>
              <div className="property-item">
                <label>{t('Effect Type')}</label>
                <PropertyEditor
                  type="select"
                  value={effectType}
                  onChange={(value) => handleDataChange('particleEffect', value)}
                  options={effectOptions}
                />
              </div>
            </CollapsibleGroup>

            {/* 粒子控制 */}
            <CollapsibleGroup title={t('Advanced')} defaultCollapsed={true}>
              {/* 控制按钮行 */}
              <div className="property-item">
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={togglePlayPause}
                    style={{
                      flex: 1,
                      padding: '6px 12px',
                      backgroundColor: isPlaying
                        ? 'var(--vscode-button-secondaryBackground)'
                        : 'var(--vscode-button-background)',
                      color: isPlaying
                        ? 'var(--vscode-button-secondaryForeground)'
                        : 'var(--vscode-button-foreground)',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                    title={isPlaying ? t('Pause preview') : t('Play preview')}
                  >
                    {isPlaying ? '⏸️' : '▶️'} {isPlaying ? t('Pause') : t('Play')}
                  </button>
                  <button
                    onClick={() => dispatchControl('restart')}
                    style={{
                      flex: 1,
                      padding: '6px 12px',
                      backgroundColor: 'var(--vscode-button-secondaryBackground)',
                      color: 'var(--vscode-button-secondaryForeground)',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    🔄 {t('Restart Effect')}
                  </button>
                </div>
              </div>

              {/* 交互预览开关（仅交互效果显示） */}
              {isInteractive && (
                <div className="property-item">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <PropertyEditor
                      type="boolean"
                      value={interactivePreview}
                      onChange={(value) => {
                        handleDataChange('interactivePreview', value);
                        if (!value) {
                          setTimeout(() => dispatchControl('restart'), 50);
                        }
                      }}
                    />
                    <span style={{ fontSize: '12px' }}>{t('Interactive Preview')}</span>
                    <HelpIcon title={t('Enable to use mouse interaction on particle. Alt+Click also works as shortcut.')} />
                  </div>
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
