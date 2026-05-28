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

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginTop: '8px',
  marginBottom: '2px',
  fontSize: '12px',
  color: 'var(--vscode-foreground)',
};

const helpTextStyle: React.CSSProperties = {
  display: 'block',
  marginTop: '2px',
  fontSize: '11px',
  color: 'var(--vscode-descriptionForeground)',
};

export const HgVideoProperties: React.FC<PropertyPanelProps> = ({ component, onUpdate, components }) => {
  const [activeTab, setActiveTab] = useState<'properties' | 'events'>('properties');
  
  // 保存当前正在编辑的组件 ID（用于异步操作时确保操作应用到正确的组件）
  const componentIdRef = React.useRef(component.id);
  
  // 组件切换时更新 ref
  React.useEffect(() => {
    componentIdRef.current = component.id;
  }, [component.id]);

  const handlePropertyChange = (property: string, value: any) => {
    const newData = {
      ...component.data,
      [property]: value
    };
    
    // 当视频路径改变时，请求获取视频尺寸（使用保存的组件 ID）
    if (property === 'src' && value) {
      const vscodeAPI = (window as any).vscodeAPI;
      if (vscodeAPI) {
        vscodeAPI.postMessage({
          command: 'getVideoSizeForProperty',
          videoPath: value,
          componentId: componentIdRef.current
        });
      }
    }
    
    onUpdate({ data: newData });
  };

  const videoData = component.data || {};
  const src = videoData.src || '';
  const frameRate = videoData.frameRate || 30;
  const autoPlay = videoData.autoPlay !== false;
  const loop = videoData.loop === true;
  const useMsv1 = videoData.useMsv1 === true || videoData.useMsv1 === 'true';

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
            <BaseProperties component={component} onUpdate={onUpdate} components={components} disableSize={true} sizeTooltip={t('Video size is determined by source file')} />
            
            {/* 内容 */}
            <CollapsibleGroup title={t('Content')}>
              <div className="property-item">
                <label>{t('Video Path')}</label>
                <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                  <input
                    type="text"
                    value={src}
                    onChange={(e) => handlePropertyChange('src', e.target.value)}
                    placeholder="assets/video.mp4"
                    style={{
                      flex: 1,
                      padding: '4px 6px',
                      backgroundColor: 'var(--vscode-input-background)',
                      color: 'var(--vscode-input-foreground)',
                      border: '1px solid var(--vscode-input-border)',
                      borderRadius: '2px',
                    }}
                  />
                  <button
                    onClick={() => {
                      window.vscodeAPI?.postMessage({
                        command: 'selectVideoPath',
                        componentId: component.id,
                      });
                    }}
                    style={{
                      padding: '4px 8px',
                      backgroundColor: 'var(--vscode-button-background)',
                      color: 'var(--vscode-button-foreground)',
                      border: 'none',
                      borderRadius: '2px',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                    title={t('Select Video File')}
                  >
                    📁
                  </button>
                </div>
              </div>

              <div className="property-item">
                <label>{t('Frame Rate (FPS)')}</label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={frameRate}
                  onChange={(e) => handlePropertyChange('frameRate', parseInt(e.target.value) || 30)}
                  style={inputStyle}
                />
                <small style={helpTextStyle}>{t('Output video frame rate')}</small>
              </div>

              <div className="property-item">
                <div style={{
                  padding: '8px',
                  background: 'var(--vscode-textBlockQuote-background)',
                  border: '1px solid var(--vscode-textBlockQuote-border)',
                  borderRadius: '4px',
                  fontSize: '11px',
                  color: 'var(--vscode-descriptionForeground)'
                }}>
                  <strong>{t('Format Note')}:</strong>
                  <p style={{ margin: '4px 0 0 0' }}>{t('Video format is configured in Assets panel. Select video file to set output format (MJPEG/AVI/H264).')}</p>
                </div>
              </div>
            </CollapsibleGroup>

            {/* 行为 */}
            <CollapsibleGroup title={t('Behavior')}>
              <div className="property-item">
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={autoPlay}
                    onChange={(e) => handlePropertyChange('autoPlay', e.target.checked)}
                    style={{ marginRight: '8px' }}
                  />
                  {t('Autoplay')}
                </label>
                <small style={helpTextStyle}>{t('Start playing automatically after creation')}</small>
              </div>

              <div className="property-item">
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={loop}
                    onChange={(e) => handlePropertyChange('loop', e.target.checked)}
                    style={{ marginRight: '8px' }}
                  />
                  {t('Loop')}
                </label>
                <small style={helpTextStyle}>{t('Restart automatically when playback ends')}</small>
              </div>

              <div className="property-item">
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={useMsv1}
                    onChange={(e) => handlePropertyChange('useMsv1', e.target.checked)}
                    style={{ marginRight: '8px' }}
                  />
                  {t('Mini Video (MSV1)')}
                </label>
                <small style={helpTextStyle}>{t('Use MSV1 API for video rendering')}</small>
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
