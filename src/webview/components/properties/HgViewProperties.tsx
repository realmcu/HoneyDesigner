import React, { useState, useMemo, useEffect, useRef } from 'react';
import { PropertyPanelProps } from './types';
import { PropertyEditor } from './PropertyEditor';
import { BaseProperties } from './BaseProperties';
import { EventsPanel } from './EventsPanel';
import { CollapsibleGroup } from './CollapsibleGroup';
import { t } from '../../i18n';
import { calculateViewComplexity } from '../../utils/viewComplexity';
import { playEntrancePreview, stopEntrancePreview } from '../../utils/entrancePreview';
import { ENTRANCE_DEFAULTS, readEntranceOptions } from '../../../shared/entranceAnimation';

export const HgViewProperties: React.FC<PropertyPanelProps> = ({ component, onUpdate, components }) => {
  const [activeTab, setActiveTab] = useState<'properties' | 'events'>('properties');
  const [viewFunctions, setViewFunctions] = useState<Array<{ name: string }>>([]);
  const viewFunctionsLoaded = useRef(false);

  useEffect(() => {
    window.vscodeAPI?.postMessage({ command: 'getUserFunctions' });
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === 'userFunctionsLoaded') {
        viewFunctionsLoaded.current = true;
        const fns: Array<{ name: string; type: string }> = message.functions || [];
        setViewFunctions(fns.filter(f => f.type === 'view'));
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    if (!viewFunctionsLoaded.current) return;

    const functionNames = new Set(viewFunctions.map(fn => fn.name));
    const switchOutFunctionName = component.data?.switchOutFunctionName;
    const switchInFunctionName = component.data?.switchInFunctionName;
    const clearSwitchOut = switchOutFunctionName && !functionNames.has(switchOutFunctionName);
    const clearSwitchIn = switchInFunctionName && !functionNames.has(switchInFunctionName);

    if (clearSwitchOut || clearSwitchIn) {
      onUpdate({
        data: {
          ...component.data,
          ...(clearSwitchOut ? { switchOutFunctionName: '' } : {}),
          ...(clearSwitchIn ? { switchInFunctionName: '' } : {}),
        },
      });
    }
  }, [component.id, component.data?.switchOutFunctionName, component.data?.switchInFunctionName, viewFunctions]);

  // 计算默认动画步长（屏幕高度的 1/10）
  const defaultAnimateStep = Math.round(component.position.height / 10);

  // 快照固定按 16 位色深分配一整屏（HoneyGUI gui_view_cache_snapshot_data）
  const snapshotSizeKB = Math.round(component.position.width * component.position.height * 2 / 1024);

  // 计算页面复杂度
  const complexity = useMemo(
    () => calculateViewComplexity(component, components ?? []),
    [component, components]
  );

  const entranceOptions = readEntranceOptions(component.data);
  const entranceEnabled = entranceOptions !== null;

  // 切换页面或关闭入场动画时停掉画布上残留的预览
  useEffect(() => stopEntrancePreview, [component.id]);

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

            {/* 页面入场动画 */}
            <CollapsibleGroup title={t('Entrance Animation')} cacheKey="view-entrance" defaultCollapsed={!entranceEnabled}>
              <div className="property-item">
                <label>{t('Entrance Direction')}</label>
                <select
                  value={entranceEnabled ? component.data?.entranceAnim : 'none'}
                  onChange={(e) => handleDataChange('entranceAnim', e.target.value === 'none' ? undefined : e.target.value)}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{ width: '100%' }}
                >
                  <option value="none">{t('None')}</option>
                  <option value="fromBottom">{t('Bounce in from bottom')}</option>
                  <option value="fromTop">{t('Bounce in from top')}</option>
                  <option value="fromLeft">{t('Bounce in from left')}</option>
                  <option value="fromRight">{t('Bounce in from right')}</option>
                  <option value="fromCenter">{t('Burst out from center')}</option>
                  <option value="rise">{t('Fade in and rise')}</option>
                  <option value="pop">{t('Pop in place')}</option>
                  <option value="spin">{t('Spin in from the side')}</option>
                  <option value="cascade">{t('Cascade from the top')}</option>
                </select>
              </div>
              {entranceEnabled && (
                <>
                  <div className="property-item" title={t('Entrance Duration Tooltip')}>
                    <label>{t('Duration (ms)')}</label>
                    <PropertyEditor
                      type="number"
                      value={component.data?.entranceDuration ?? ENTRANCE_DEFAULTS.duration}
                      onChange={(value) => handleDataChange('entranceDuration', value)}
                      min={200}
                      max={3000}
                    />
                  </div>
                  <div className="property-item" title={t('Entrance Stagger Tooltip')}>
                    <label>{t('Stagger (ms)')}</label>
                    <PropertyEditor
                      type="number"
                      value={component.data?.entranceStagger ?? ENTRANCE_DEFAULTS.stagger}
                      onChange={(value) => handleDataChange('entranceStagger', value)}
                      min={0}
                      max={500}
                    />
                  </div>
                  <div className="property-item" title={t('Entrance Bounce Tooltip')}>
                    <label>{t('Bounce (0-100)')}</label>
                    <PropertyEditor
                      type="number"
                      value={component.data?.entranceBounce ?? ENTRANCE_DEFAULTS.bounce}
                      onChange={(value) => handleDataChange('entranceBounce', value)}
                      min={0}
                      max={100}
                    />
                  </div>
                  <div className="property-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label>{t('Fade In')}</label>
                      <PropertyEditor
                        type="boolean"
                        value={entranceOptions?.fade ?? ENTRANCE_DEFAULTS.fade}
                        onChange={(value) => handleDataChange('entranceFade', value)}
                      />
                    </div>
                  </div>
                  <div className="property-item">
                    <button
                      onClick={() => playEntrancePreview(component, components ?? [])}
                      style={{ width: '100%' }}
                    >
                      {t('Preview Entrance')}
                    </button>
                    <div style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '4px' }}>
                      {t('Entrance Animation Hint')}
                    </div>
                  </div>
                </>
              )}
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
                <div style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '4px' }}>
                  {t('Snapshot Cache Hint', snapshotSizeKB)}
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
              <div className="property-item">
                <label>{t('Switch In Callback')}</label>
                {viewFunctions.length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)' }}>
                    {t('No view functions found, declare in src/user/**_user.h')}
                  </div>
                ) : (
                  <select
                    value={component.data?.switchInFunctionName || ''}
                    onChange={(e) => handleDataChange('switchInFunctionName', e.target.value)}
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{ width: '100%' }}
                  >
                    <option value="">-- {t('None')} --</option>
                    {viewFunctions.map(fn => (
                      <option key={fn.name} value={fn.name}>{fn.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="property-item">
                <label>{t('Switch Out Callback')}</label>
                {viewFunctions.length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)' }}>
                    {t('No view functions found, declare in src/user/**_user.h')}
                  </div>
                ) : (
                  <select
                    value={component.data?.switchOutFunctionName || ''}
                    onChange={(e) => handleDataChange('switchOutFunctionName', e.target.value)}
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{ width: '100%' }}
                  >
                    <option value="">-- {t('None')} --</option>
                    {viewFunctions.map(fn => (
                      <option key={fn.name} value={fn.name}>{fn.name}</option>
                    ))}
                  </select>
                )}
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
