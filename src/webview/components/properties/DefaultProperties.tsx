import React, { useState } from 'react';
import { PropertyPanelProps } from './types';
import { PropertyEditor } from './PropertyEditor';
import { BaseProperties } from './BaseProperties';
import { EventsPanel } from './EventsPanel';
import { CollapsibleGroup } from './CollapsibleGroup';
import { componentDefinitions } from '../ComponentLibrary';
import { useDesignerStore } from '../../store';
import { t } from '../../i18n';

// 字体文件扩展名
const FONT_EXTS = ['ttf', 'otf', 'woff', 'woff2', 'bin'];

// 模块级缓存：保留 activeTab 状态，防止组件重挂载时重置
const activeTabCache = new Map<string, 'properties' | 'events'>();

export const DefaultProperties: React.FC<PropertyPanelProps> = ({ component, onUpdate, components }) => {
  const [activeTab, setActiveTabState] = useState<'properties' | 'events'>(
    activeTabCache.get(component.id) ?? 'properties'
  );
  const setActiveTab = React.useCallback((tab: 'properties' | 'events') => {
    activeTabCache.set(component.id, tab);
    setActiveTabState(tab);
  }, [component.id]);
  const [showFontPicker, setShowFontPicker] = useState<string | null>(null);
  const [fontFiles, setFontFiles] = useState<string[]>([]);
  const [userFunctions, setUserFunctions] = useState<Array<{ name: string; type: 'event' | 'message' }>>([]);
  
  // 保存当前正在编辑的组件 ID（用于异步操作时确保操作应用到正确的组件）
  const componentIdRef = React.useRef(component.id);
  
  // 组件切换时更新 ref
  React.useEffect(() => {
    componentIdRef.current = component.id;
  }, [component.id]);
  
  const definition = componentDefinitions.find((d) => d.type === component.type);
  const syncListItems = useDesignerStore((state) => state.syncListItems);

  const handleStyleChange = (property: string, value: any) => {
    onUpdate({
      style: {
        ...component.style,
        [property]: value,
      },
    });
  };

  const handleDataChange = (property: string, value: any) => {
    let clampedValue = value;

    // slider/progressbar: value 不允许超过 min/max 范围
    if (component.type === 'hg_slider' || component.type === 'hg_progressbar') {
      const data = component.data || {};
      if (property === 'value') {
        const min = Number(data.min ?? 0);
        const max = Number(data.max ?? 100);
        clampedValue = Math.max(min, Math.min(max, Number(clampedValue)));
      } else if (property === 'min') {
        const max = Number(data.max ?? 100);
        const currentValue = Number(data.value ?? 0);
        clampedValue = Math.min(Number(clampedValue), max);
        // min 变大后，如果 value 小于新 min，自动调整 value
        if (currentValue < Number(clampedValue)) {
          onUpdate({
            data: { ...data, [property]: clampedValue, value: clampedValue },
          });
          return;
        }
      } else if (property === 'max') {
        const min = Number(data.min ?? 0);
        const currentValue = Number(data.value ?? 0);
        clampedValue = Math.max(Number(clampedValue), min);
        // max 变小后，如果 value 大于新 max，自动调整 value
        if (currentValue > Number(clampedValue)) {
          onUpdate({
            data: { ...data, [property]: clampedValue, value: clampedValue },
          });
          return;
        }
      }
    }

    onUpdate({
      data: {
        ...component.data,
        [property]: clampedValue,
      },
    });
    
    // 如果是 list 控件的 noteNum 属性被修改，触发 syncListItems
    if (component.type === 'hg_list' && property === 'noteNum') {
      // 使用 setTimeout 确保状态更新后再同步
      setTimeout(() => {
        syncListItems(componentIdRef.current);
      }, 0);
    }
  };

  const handleGeneralChange = (property: string, value: any) => {
    onUpdate({
      data: {
        ...component.data,
        [property]: value,
      },
    });
  };

  const handleSelectImagePath = (propertyName?: string) => {
    window.vscodeAPI?.postMessage({
      command: 'selectImagePath',
      componentId: componentIdRef.current,
      propertyName: propertyName || 'src'
    });
  };

  const handleSelectGlassPath = () => {
    window.vscodeAPI?.postMessage({
      command: 'selectGlassPath',
      componentId: componentIdRef.current
    });
  };

  // 请求字体文件列表（用于 label 下拉选择）
  const handleOpenFontPicker = (propertyName: string) => {
    window.vscodeAPI?.postMessage({ command: 'getFontFiles' });
    setShowFontPicker(propertyName);
  };

  const handleSelectFontPath = () => {
    window.vscodeAPI?.postMessage({
      command: 'selectFontPath',
      componentId: componentIdRef.current
    });
  };

  const handleSelectMapPath = () => {
    window.vscodeAPI?.postMessage({
      command: 'selectMapPath',
      componentId: componentIdRef.current
    });
  };

  // 监听字体文件列表和字体度量信息响应
  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.command === 'fontFilesLoaded') {
        setFontFiles(event.data.fonts || []);
      } else if (event.data.command === 'userFunctionsLoaded') {
        setUserFunctions(event.data.functions || []);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [component.data]);

  // 当 hg_button 被选中时，加载用户自定义函数列表
  React.useEffect(() => {
    if (component.type === 'hg_button') {
      window.vscodeAPI?.postMessage({ command: 'getUserFunctions' });
    }
  }, [component.id, component.type]);

  const renderCallbackSelector = (propertyName: 'onCallback' | 'offCallback' | 'clickCallback') => {
    const value = (component.data as any)?.[propertyName] || '';
    const eventFunctions = userFunctions.filter(f => f.type === 'event');
    return (
      <div style={{ display: 'flex', gap: '4px', marginTop: '4px', alignItems: 'center' }}>
        {eventFunctions.length === 0 ? (
          <div style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', flex: 1 }}>
            {t('No user functions found, declare in src/user/**_user.h')}
          </div>
        ) : (
          <select
            value={value}
            onChange={(e) => handleDataChange(propertyName, e.target.value)}
            style={{
              flex: 1,
              padding: '4px 6px',
              backgroundColor: 'var(--vscode-dropdown-background)',
              color: 'var(--vscode-dropdown-foreground)',
              border: '1px solid var(--vscode-dropdown-border)',
              borderRadius: '2px',
              fontSize: '12px',
            }}
          >
            <option value="">-- {t('None')} --</option>
            {eventFunctions.map(func => (
              <option key={func.name} value={func.name}>{func.name}</option>
            ))}
          </select>
        )}
        {value && (
          <button
            onClick={() => handleDataChange(propertyName, '')}
            style={{
              padding: '4px 6px',
              backgroundColor: 'var(--vscode-button-secondaryBackground)',
              color: 'var(--vscode-button-secondaryForeground)',
              border: 'none',
              borderRadius: '2px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
            title={t('Clear')}
          >
            ✕
          </button>
        )}
      </div>
    );
  };

  const getClawFaceScopeOwner = () => {
    if (component.type !== 'hg_claw_face' || !components) {
      return null;
    }

    let current = component;
    let rootView = current.type === 'hg_view' ? current : null;

    while (current.parent) {
      const parent = components.find(c => c.id === current.parent);
      if (!parent) {
        break;
      }

      if (parent.type === 'hg_window') {
        return parent;
      }

      if (parent.type === 'hg_view') {
        rootView = parent;
      }

      current = parent;
    }

    return rootView;
  };

  const getScopedOpenClawTargets = () => {
    const scopeOwner = getClawFaceScopeOwner();
    if (!scopeOwner || !components) {
      return [] as Array<{ value: string; label: string }>;
    }

    const result: Array<{ value: string; label: string }> = [];
    const visited = new Set<string>();

    const walk = (comp: typeof component) => {
      if (visited.has(comp.id)) {
        return;
      }
      visited.add(comp.id);

      if (comp.type === 'hg_openclaw') {
        result.push({
          value: comp.id,
          label: `${comp.name} (${comp.id})`
        });
      }

      if (comp.children && comp.children.length > 0) {
        comp.children.forEach(childId => {
          const child = components.find(c => c.id === childId);
          if (child) {
            walk(child);
          }
        });
      }
    };

    walk(scopeOwner);
    return result;
  };

  const renderOpenClawTargetSelector = () => {
    const value = (component.data as any)?.openclawTarget || '';
    const scopedTargets = getScopedOpenClawTargets();
    const options: Array<{ value: string; label: string }> = [
      { value: '', label: t('Auto Match First OpenClaw in Scope') }
    ];

    options.push(...scopedTargets);

    if (value && !options.some(option => option.value === value)) {
      options.push({ value, label: `${value} (${t('Out of Scope or Missing')})` });
    }

    return (
      <div>
        <PropertyEditor
          type="select"
          value={value}
          onChange={(nextValue) => handleDataChange('openclawTarget', nextValue)}
          options={options}
          disabled={options.length === 1}
        />
        <div style={{
          fontSize: '10px',
          color: 'var(--vscode-descriptionForeground)',
          marginTop: '4px',
          lineHeight: '1.4'
        }}>
          💡 {options.length === 1 ? t('No OpenClaw targets found in current scope') : t('Only OpenClaw components in the current view or window are available')}
        </div>
      </div>
    );
  };

  const renderClawFaceExpressionSelector = () => {
    const value = (component.data as any)?.initialExpression || 'neutral';
    const options = [
      { value: 'neutral', label: t('Neutral') },
      { value: 'happy', label: t('Happy') },
      { value: 'sad', label: t('Sad') },
      { value: 'angry', label: t('Angry') },
      { value: 'surprised', label: t('Surprised') },
      { value: 'thinking', label: t('Thinking') },
      { value: 'sleeping', label: t('Sleeping') },
      { value: 'love', label: t('Love') },
      { value: 'wink', label: t('Wink') },
    ];

    return (
      <PropertyEditor
        type="select"
        value={value}
        onChange={(nextValue) => handleDataChange('initialExpression', nextValue)}
        options={options}
      />
    );
  };

  const renderImageProperty = (value: any, onChange: (value: any) => void, propertyName?: string) => {
    return (
      <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="图片路径"
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
          onClick={() => handleSelectImagePath(propertyName)}
          style={{
            padding: '4px 8px',
            backgroundColor: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: '2px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
          title="选择图片文件"
        >
          📁
        </button>
      </div>
    );
  };

  const renderGlassProperty = (value: any, onChange: (value: any) => void) => {
    return (
      <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="形状路径 (.glass)"
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
          onClick={handleSelectGlassPath}
          style={{
            padding: '4px 8px',
            backgroundColor: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: '2px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
          title="选择玻璃形状文件"
        >
          📁
        </button>
      </div>
    );
  };

  const renderFontProperty = (value: any, onChange: (value: any) => void, propertyName: string = 'fontFile') => {
    return (
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
          <input
            type="text"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder="字体文件路径"
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
            onClick={() => handleOpenFontPicker(propertyName)}
            style={{
              padding: '4px 8px',
              backgroundColor: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
              border: 'none',
              borderRadius: '2px',
              cursor: 'pointer',
              fontSize: '12px'
            }}
            title="选择字体文件"
          >
            🔤
          </button>
        </div>
        {showFontPicker === propertyName && (
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 100,
            backgroundColor: 'var(--vscode-dropdown-background)',
            border: '1px solid var(--vscode-dropdown-border)',
            borderRadius: '4px',
            maxHeight: '200px',
            overflowY: 'auto',
            marginTop: '4px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
          }}>
            {fontFiles.length === 0 ? (
              <div style={{ padding: '8px', color: 'var(--vscode-descriptionForeground)', fontSize: '12px' }}>
                {t('No font files, please upload to assets directory')}
              </div>
            ) : (
              fontFiles.map((font) => (
                <div
                  key={font}
                  onClick={() => {
                    onChange(font);
                    setShowFontPicker(null);
                  }}
                  style={{
                    padding: '6px 8px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    borderBottom: '1px solid var(--vscode-dropdown-border)',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--vscode-list-hoverBackground)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  🔤 {font}
                </div>
              ))
            )}
            <div
              onClick={() => setShowFontPicker(null)}
              style={{
                padding: '6px 8px',
                cursor: 'pointer',
                fontSize: '12px',
                textAlign: 'center',
                color: 'var(--vscode-descriptionForeground)',
              }}
            >
              {t('Close')}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderMapFileProperty = (value: any, onChange: (value: any) => void) => {
    return (
      <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="地图文件路径 (.trmap)"
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
          onClick={handleSelectMapPath}
          style={{
            padding: '4px 8px',
            backgroundColor: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: '2px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
          title="选择地图文件"
        >
          🗺️
        </button>
      </div>
    );
  };

  // 渲染字符集列表
  const renderCharacterSets = () => {
    const charsets = (component.data as any)?.characterSets || [];
    
    // 处理文件浏览
    const handleBrowseCharsetFile = (index: number, type: 'file' | 'codepage') => {
      window.vscodeAPI?.postMessage({
        command: 'browseCharsetFile',
        componentId: componentIdRef.current,
        charsetIndex: index,
        fileType: type,
        filters: type === 'file' 
          ? { 'Charset文件': ['cst', 'txt'] }
          : {} // CodePage 文件没有后缀，显示所有文件
      });
    };

    // 获取显示值（文件类型显示文件名，其他显示完整值）
    const getDisplayValue = (cs: any) => {
      if ((cs.type === 'file' || cs.type === 'codepage') && cs.value) {
        // 提取文件名
        const parts = cs.value.split('/');
        return parts[parts.length - 1];
      }
      return cs.value || '';
    };
    
    return (
      <div>
        <div style={{
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: '3px',
          maxHeight: '200px',
          overflowY: 'auto',
          marginBottom: '6px'
        }}>
          {charsets.length === 0 ? (
            <div style={{
              padding: '12px',
              textAlign: 'center',
              fontSize: '11px',
              color: 'var(--vscode-descriptionForeground)'
            }}>
              {t('No additional character sets')}
            </div>
          ) : (
            charsets.map((cs: any, index: number) => (
              <div key={index} style={{
                padding: '6px',
                fontSize: '11px',
                borderBottom: index < charsets.length - 1 ? '1px solid var(--vscode-panel-border)' : 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <select
                    value={cs.type || 'range'}
                    onChange={(e) => {
                      const newCharsets = [...charsets];
                      // 切换类型时清空内容
                      newCharsets[index] = { ...cs, type: e.target.value, value: '' };
                      handleDataChange('characterSets', newCharsets);
                    }}
                    style={{
                      minWidth: '70px',
                      padding: '3px 6px',
                      backgroundColor: 'var(--vscode-input-background)',
                      color: 'var(--vscode-input-foreground)',
                      border: '1px solid var(--vscode-input-border)',
                      borderRadius: '2px',
                      fontSize: '11px'
                    }}
                  >
                    <option value="range">{t('Unicode Range')}</option>
                    <option value="string">{t('String')}</option>
                    <option value="file">{t('CST File')}</option>
                    <option value="codepage">{t('CodePage')}</option>
                  </select>
                  <input
                    type="text"
                    value={getDisplayValue(cs)}
                    onChange={(e) => {
                      const newCharsets = [...charsets];
                      newCharsets[index] = { ...cs, value: e.target.value };
                      handleDataChange('characterSets', newCharsets);
                    }}
                    placeholder={
                      cs.type === 'range' ? '0x20-0x7E' :
                      cs.type === 'string' ? 'ABC123' :
                      cs.type === 'file' ? 'charset.cst' :
                      'CP936'
                    }
                    title={cs.value || ''}
                    style={{
                      flex: 1,
                      padding: '3px 6px',
                      backgroundColor: 'var(--vscode-input-background)',
                      color: 'var(--vscode-input-foreground)',
                      border: '1px solid var(--vscode-input-border)',
                      borderRadius: '2px',
                      fontSize: '11px'
                    }}
                  />
                  {(cs.type === 'file' || cs.type === 'codepage') && (
                    <button
                      onClick={() => handleBrowseCharsetFile(index, cs.type)}
                      style={{
                        padding: '3px 6px',
                        backgroundColor: 'var(--vscode-button-background)',
                        color: 'var(--vscode-button-foreground)',
                        border: 'none',
                        borderRadius: '2px',
                        cursor: 'pointer',
                        fontSize: '11px',
                        whiteSpace: 'nowrap'
                      }}
                      title={t('Browse')}
                    >
                      📁
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const newCharsets = charsets.filter((_: any, i: number) => i !== index);
                      handleDataChange('characterSets', newCharsets);
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--vscode-descriptionForeground)',
                      cursor: 'pointer',
                      padding: '2px 4px',
                      fontSize: '12px'
                    }}
                    title={t('Remove')}
                  >
                    ✕
                  </button>
                </div>
                <div style={{
                  fontSize: '9px',
                  color: 'var(--vscode-descriptionForeground)',
                  paddingLeft: '74px'
                }}>
                  {cs.type === 'range' && (
                    <>
                      <div>{t('Unicode character range')}</div>
                      <div>{t('Example: 0x20-0x7E, 0x4E00-0x9FFF')}</div>
                    </>
                  )}
                  {cs.type === 'string' && (
                    <>
                      <div>{t('Extract characters from string')}</div>
                      <div>{t('Example: ABC123你好')}</div>
                    </>
                  )}
                  {cs.type === 'file' && (
                    <>
                      <div>{t('Load characters from CST/TXT file')}</div>
                      <div>{t('Example: charset.cst')}</div>
                    </>
                  )}
                  {cs.type === 'codepage' && (
                    <>
                      <div>{t('Windows CodePage encoding')}</div>
                      <div>{t('Example: CP936')}</div>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
        <button
          onClick={() => {
            const newCharsets = [...charsets, { type: 'range', value: '' }];
            handleDataChange('characterSets', newCharsets);
          }}
          style={{
            padding: '4px 10px',
            fontSize: '11px',
            backgroundColor: 'var(--vscode-button-secondaryBackground)',
            color: 'var(--vscode-button-secondaryForeground)',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            width: '100%'
          }}
        >
          + {t('Add Character Set')}
        </button>
        <div style={{
          fontSize: '10px',
          color: 'var(--vscode-descriptionForeground)',
          marginTop: '6px',
          lineHeight: '1.4'
        }}>
          💡 {t('Additional character sets will be merged with text characters during font conversion')}
        </div>
      </div>
    );
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
              disableSize={component.type === 'hg_list'}
              sizeTooltip={component.type === 'hg_list' ? t('List size is auto-calculated') : undefined}
            />

            {/* Canvas SVG 编辑按钮 */}
            {component.type === 'hg_canvas' && (
              <CollapsibleGroup title={t('Content')}>
                <div className="property-item">
                  <div style={{ 
                    fontSize: '12px', 
                    color: 'var(--vscode-descriptionForeground)',
                    marginBottom: '8px'
                  }}>
                    {(component.data as any)?.svgContent 
                      ? '✓ ' + t('canvasEditor.preview')
                      : '未配置 SVG 内容'
                    }
                  </div>
                  <button
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('openCanvasEditor', {
                        detail: { componentId: componentIdRef.current }
                      }));
                    }}
                    style={{
                      width: '100%',
                      padding: '6px 12px',
                      backgroundColor: 'var(--vscode-button-background)',
                      color: 'var(--vscode-button-foreground)',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    {t('canvasEditor.editSvg')}
                  </button>
                </div>
              </CollapsibleGroup>
            )}

            {/* Style Properties */}
            {definition && definition.properties.filter(p => p.group === 'style').length > 0 && (
              <CollapsibleGroup title={t('Style')}>
                {/* hg_list 特殊处理：项宽度和项高度在一行 */}
                {component.type === 'hg_list' ? (
                  <>
                    <div className="property-item">
                      <label>{t('Item Size')}</label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                        <div>
                          <label style={{ fontSize: '12px' }}>{t('Width')}</label>
                          <PropertyEditor
                            type="number"
                            value={(component.style as any)?.itemWidth ?? 100}
                            onChange={(value) => handleStyleChange('itemWidth', value)}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '12px' }}>{t('Height')}</label>
                          <PropertyEditor
                            type="number"
                            value={(component.style as any)?.itemHeight ?? 100}
                            onChange={(value) => handleStyleChange('itemHeight', value)}
                          />
                        </div>
                      </div>
                    </div>
                    {definition.properties
                      .filter(p => p.group === 'style' && p.name !== 'itemWidth' && p.name !== 'itemHeight')
                      .map((property) => (
                        <div key={property.name} className="property-item">
                          <label>{t(property.label as any)}</label>
                          <PropertyEditor
                            type={property.type as any}
                            value={(component.style as any)?.[property.name]}
                            onChange={(value) => handleStyleChange(property.name, value)}
                            options={property.options as string[]}
                            hint={(property as any).hint ? t((property as any).hint) : undefined}
                          />
                        </div>
                      ))}
                  </>
                ) : component.type === 'hg_label' || component.type === 'hg_time_label' || component.type === 'hg_timer_label' ? (
                  <>
                    {/* hg_label / hg_time_label / hg_timer_label 特殊处理：对齐方式在一行 */}
                    <div className="property-item">
                      <label>{t('Alignment')}</label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                        <div style={{ opacity: (component.data as any)?.enableScroll ? 0.5 : 1 }}>
                          <label style={{ fontSize: '12px' }}>{t('Horizontal')}</label>
                          <PropertyEditor
                            type="select"
                            value={(component.style as any)?.hAlign || 'LEFT'}
                            onChange={(value) => handleStyleChange('hAlign', value)}
                            options={['LEFT', 'CENTER', 'RIGHT']}
                            disabled={(component.data as any)?.enableScroll}
                          />
                          {(component.data as any)?.enableScroll && (
                            <span style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)' }}>
                              ({t('Disabled when scrolling')})
                            </span>
                          )}
                        </div>
                        <div style={{ opacity: (component.data as any)?.enableScroll && (component.data as any)?.scrollDirection === 'vertical' ? 0.5 : 1 }}>
                          <label style={{ fontSize: '12px' }}>{t('Vertical')}</label>
                          <PropertyEditor
                            type="select"
                            value={(component.style as any)?.vAlign || 'TOP'}
                            onChange={(value) => handleStyleChange('vAlign', value)}
                            options={['TOP', 'MID']}
                            disabled={(component.data as any)?.enableScroll && (component.data as any)?.scrollDirection === 'vertical'}
                          />
                          {(component.data as any)?.enableScroll && (component.data as any)?.scrollDirection === 'vertical' && (
                            <span style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)' }}>
                              ({t('Disabled for vertical scroll')})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* 其他样式属性（排除对齐、间距、换行相关） */}
                    {definition.properties
                      .filter(p => p.group === 'style' && !['hAlign', 'vAlign', 'letterSpacing', 'lineSpacing', 'wordWrap', 'wordBreak'].includes(p.name))
                      .map((property) => (
                        <div key={property.name} className="property-item">
                          <label>{t(property.label as any)}</label>
                          <PropertyEditor
                            type={property.type as any}
                            value={(component.style as any)?.[property.name]}
                            onChange={(value) => handleStyleChange(property.name, value)}
                            options={property.options as string[]}
                            hint={(property as any).hint ? t((property as any).hint) : undefined}
                          />
                        </div>
                      ))}
                    {/* Word wrap and word break - 滚动时根据方向自动处理 */}
                    <div className="property-item">
                      <label>{t('Line Break')}</label>
                      <div style={{ display: 'flex', gap: '16px', marginTop: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', opacity: (component.data as any)?.enableScroll ? 0.5 : 1 }}>
                          <PropertyEditor
                            type="boolean"
                            value={(component.data as any)?.enableScroll 
                              ? (component.data as any)?.scrollDirection === 'vertical'
                              : ((component.style as any)?.wordWrap ?? false)}
                            onChange={(value) => handleStyleChange('wordWrap', value)}
                            disabled={(component.data as any)?.enableScroll}
                          />
                          <span style={{ fontSize: '12px' }}>{t('Word Wrap')}</span>
                          {(component.data as any)?.enableScroll && (component.data as any)?.scrollDirection === 'vertical' && (
                            <span style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)' }}>
                              ({t('Auto enabled for vertical scroll')})
                            </span>
                          )}
                          {(component.data as any)?.enableScroll && (component.data as any)?.scrollDirection === 'horizontal' && (
                            <span style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)' }}>
                              ({t('Auto disabled for horizontal scroll')})
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title={t('Break at word boundaries')}>
                          <PropertyEditor
                            type="boolean"
                            value={(component.style as any)?.wordBreak ?? false}
                            onChange={(value) => handleStyleChange('wordBreak', value)}
                          />
                          <span style={{ fontSize: '12px' }}>{t('Word Break')}</span>
                        </div>
                      </div>
                    </div>
                    {/* Letter and line spacing */}
                    <div className="property-item">
                      <label>{t('Spacing')}</label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                        <div>
                          <label style={{ fontSize: '12px' }}>{t('Letter Spacing')}</label>
                          <PropertyEditor
                            type="number"
                            value={(component.style as any)?.letterSpacing ?? 0}
                            onChange={(value) => handleStyleChange('letterSpacing', value)}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '12px' }}>{t('Line Spacing')}</label>
                          <PropertyEditor
                            type="number"
                            value={(component.style as any)?.lineSpacing ?? 0}
                            onChange={(value) => handleStyleChange('lineSpacing', value)}
                          />
                        </div>
                      </div>
                    </div>
                    {/* 启用滚动 - 放在样式组最后 */}
                    <div className="property-item">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <PropertyEditor
                            type="boolean"
                            value={(component.data as any)?.enableScroll ?? false}
                            onChange={(value) => handleDataChange('enableScroll', value)}
                          />
                          <span style={{ fontSize: '12px' }}>{t('Enable Scroll')}</span>
                        </div>
                        {(component.data as any)?.enableScroll && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title={t('Enable scroll animation preview')}>
                            <PropertyEditor
                              type="boolean"
                              value={(component.data as any)?.scrollPreview ?? false}
                              onChange={(value) => handleDataChange('scrollPreview', value)}
                            />
                            <span style={{ fontSize: '12px' }}>{t('Scroll Preview')}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  definition.properties
                    .filter(p => p.group === 'style')
                    .map((property) => (
                      <div key={property.name} className="property-item">
                        <label>{t(property.label as any)}</label>
                        <PropertyEditor
                          type={property.type as any}
                          value={(component.style as any)?.[property.name]}
                          onChange={(value) => handleStyleChange(property.name, value)}
                          options={property.options as string[]}
                          min={property.name === 'opacity' ? 0 : (property as any).min}
                          max={property.name === 'opacity' ? 255 : (property as any).max}
                          hint={(property as any).hint ? t((property as any).hint) : undefined}
                        />
                      </div>
                    ))
                )}
              </CollapsibleGroup>
            )}

            {/* Scroll Properties - 仅对 hg_label / hg_time_label 且启用滚动时显示 */}
            {(component.type === 'hg_label' || component.type === 'hg_time_label') && (component.data as any)?.enableScroll && (
              <CollapsibleGroup title={t('Behavior')}>
                {/* 滚动方向 */}
                <div className="property-item">
                  <label>{t('Scroll Direction')}</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', marginTop: '4px' }}>
                    <select
                      value={(component.data as any)?.scrollDirection || 'horizontal'}
                      onChange={(e) => handleDataChange('scrollDirection', e.target.value)}
                      style={{
                        padding: '4px 6px',
                        backgroundColor: 'var(--vscode-input-background)',
                        color: 'var(--vscode-input-foreground)',
                        border: '1px solid var(--vscode-input-border)',
                        borderRadius: '2px',
                      }}
                    >
                      <option value="horizontal">{t('horizontal' as any)}</option>
                      <option value="vertical">{t('vertical' as any)}</option>
                    </select>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <PropertyEditor
                        type="boolean"
                        value={(component.data as any)?.scrollReverse ?? false}
                        onChange={(value) => handleDataChange('scrollReverse', value)}
                      />
                      <span style={{ fontSize: '12px' }}>{t('Reverse')}</span>
                    </div>
                  </div>
                </div>
                {/* 起始偏移 */}
                <div className="property-item">
                  <label>{t('Start Offset (px)')}</label>
                  <PropertyEditor
                    type="number"
                    value={(component.data as any)?.scrollStartOffset ?? 0}
                    onChange={(value) => handleDataChange('scrollStartOffset', value)}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', marginTop: '2px' }}>
                    {t('Initial blank space before text')}
                  </span>
                </div>
                {/* 结束偏移 */}
                <div className="property-item">
                  <label>{t('End Offset (px)')}</label>
                  <PropertyEditor
                    type="number"
                    value={(component.data as any)?.scrollEndOffset ?? 0}
                    onChange={(value) => handleDataChange('scrollEndOffset', value)}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', marginTop: '2px' }}>
                    {t('Final blank space after text')}
                  </span>
                </div>
                {/* 循环间隔 */}
                <div className="property-item">
                  <label>{t('Loop Interval (ms)')}</label>
                  <PropertyEditor
                    type="number"
                    value={(component.data as any)?.scrollInterval ?? 3000}
                    onChange={(value) => handleDataChange('scrollInterval', value)}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', marginTop: '2px' }}>
                    {t('Time for one complete scroll cycle')}
                  </span>
                </div>
                {/* 总持续时间 */}
                <div className="property-item">
                  <label>{t('Total Duration (ms)')}</label>
                  <PropertyEditor
                    type="number"
                    value={(component.data as any)?.scrollDuration ?? 0}
                    onChange={(value) => handleDataChange('scrollDuration', value)}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', marginTop: '2px' }}>
                    {t('Total scrolling duration, 0 = infinite')}
                  </span>
                </div>
              </CollapsibleGroup>
            )}

            {/* Data Properties */}
            {definition && definition.properties.filter(p => p.group === 'data').length > 0 && (
              <CollapsibleGroup title={t('Content')}>
                {definition.properties
                  .filter(p => p.group === 'data')
                  .filter(p => {
                    // Button: show/hide properties based on toggleMode
                    if (component.type === 'hg_button') {
                      const isToggle = component.data?.toggleMode === true;
                      if (isToggle) {
                        // Toggle mode: hide clickCallback, text
                        if (p.name === 'clickCallback' || p.name === 'text') return false;
                      } else {
                        // Normal mode: hide initialState, onCallback, offCallback
                        if (p.name === 'initialState' || p.name === 'onCallback' || p.name === 'offCallback') return false;
                      }
                    }
                    return true;
                  })
                  .map((property) => (
                    <div key={property.name} className="property-item">
                      <label>{t(property.label as any)}</label>
                      {property.name === 'src' && component.type === 'hg_image' ? (
                        renderImageProperty(
                          (component.data as any)?.[property.name],
                          (value) => handleDataChange(property.name, value),
                          'src'
                        )
                      ) : (property.name === 'imageOn' || property.name === 'imageOff') && component.type === 'hg_button' ? (
                        // 按钮图片选择器（Normal 和 Toggle 共用）
                        renderImageProperty(
                          (component.data as any)?.[property.name],
                          (value) => handleDataChange(property.name, value),
                          property.name
                        )
                      ) : (property.name === 'onCallback' || property.name === 'offCallback' || property.name === 'clickCallback') && component.type === 'hg_button' ? (
                        // 按钮回调函数选择器
                        renderCallbackSelector(property.name as 'onCallback' | 'offCallback' | 'clickCallback')
                      ) : (property.name === 'buttonStateOnImage' || property.name === 'buttonStateOffImage') && component.type === 'hg_image' ? (
                        // Image 组件双态按键的图片选择器
                        renderImageProperty(
                          (component.data as any)?.[property.name],
                          (value) => handleDataChange(property.name, value),
                          property.name
                        )
                      ) : property.name === 'src' && component.type === 'hg_glass' ? (
                        renderGlassProperty(
                          (component.data as any)?.[property.name],
                          (value) => handleDataChange(property.name, value)
                        )
                      ) : property.name === 'fontFile' || property.name === 'emojiFontFile' ? (
                        renderFontProperty(
                          (component.data as any)?.[property.name],
                          (value) => handleDataChange(property.name, value),
                          property.name
                        )
                      ) : property.name === 'mapFile' ? (
                        renderMapFileProperty(
                          (component.data as any)?.[property.name],
                          (value) => handleDataChange(property.name, value)
                        )
                      ) : property.name === 'openclawTarget' && component.type === 'hg_claw_face' ? (
                        renderOpenClawTargetSelector()
                      ) : property.name === 'initialExpression' && component.type === 'hg_claw_face' ? (
                        renderClawFaceExpressionSelector()
                      ) : property.name === 'text' && (component.type === 'hg_timer_label' || component.type === 'hg_time_label') ? (
                        // 计时器标签和时间标签的文本是自动生成的，不显示输入框
                        <div style={{
                          padding: '6px 8px',
                          backgroundColor: 'var(--vscode-input-background)',
                          color: 'var(--vscode-descriptionForeground)',
                          border: '1px solid var(--vscode-input-border)',
                          borderRadius: '2px',
                          fontSize: '12px',
                          fontStyle: 'italic'
                        }}>
                          {component.type === 'hg_timer_label' ? t('Timer text is auto-generated') : t('Time text is auto-generated')}
                        </div>
                      ) : property.name === 'text' && (component.type === 'hg_label' || component.type === 'hg_time_label') && (component.style as any)?.wordWrap ? (
                        // 自动换行开启时，文本输入框变成多行
                        <textarea
                          value={(component.data as any)?.[property.name] || ''}
                          onChange={(e) => handleDataChange(property.name, e.target.value)}
                          rows={3}
                          style={{
                            width: '100%',
                            padding: '4px 6px',
                            backgroundColor: 'var(--vscode-input-background)',
                            color: 'var(--vscode-input-foreground)',
                            border: '1px solid var(--vscode-input-border)',
                            borderRadius: '2px',
                            resize: 'vertical',
                            fontFamily: 'inherit',
                            fontSize: '13px',
                          }}
                        />
                      ) : (
                        <PropertyEditor
                          type={property.type as any}
                          value={(component.data as any)?.[property.name]}
                          onChange={(value) => handleDataChange(property.name, value)}
                          options={property.options as string[]}
                          min={(property as any).min}
                          max={(property as any).max}
                        />
                      )}
                    </div>
                  ))}
                {/* OpenClaw Emoji 字体推荐 */}
                {component.type === 'hg_openclaw' && (
                  <div style={{
                    marginTop: '12px',
                    padding: '8px',
                    backgroundColor: 'var(--vscode-textBlockQuote-background)',
                    borderRadius: '4px',
                    fontSize: '11px',
                    color: 'var(--vscode-descriptionForeground)',
                    lineHeight: 1.5,
                  }}>
                    <div style={{ marginBottom: '4px' }}>💡 {t('Recommended Emoji Font')}</div>
                    <a
                      href="https://fonts.google.com/noto/specimen/Noto+Emoji"
                      style={{
                        color: 'var(--vscode-textLink-foreground)',
                        textDecoration: 'none',
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        window.vscodeAPI?.postMessage({
                          command: 'openExternal',
                          url: 'https://fonts.google.com/noto/specimen/Noto+Emoji'
                        });
                      }}
                    >
                      Noto Emoji ↗
                    </a>
                  </div>
                )}
              </CollapsibleGroup>
            )}

            {/* General Properties */}
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
                        onChange={(value) => handleGeneralChange(property.name, value)}
                        options={property.options as string[]}
                        min={(property as any).min}
                        max={(property as any).max}
                      />
                    </div>
                  ))}
              </CollapsibleGroup>
            )}

            {/* Interaction Properties - 按键效果 */}
            {definition && definition.properties.filter(p => p.group === 'interaction').length > 0 && (
              <CollapsibleGroup title={t('Interaction')}>
                
                {/* 按键模式选择 */}
                <div className="property-item">
                  <label>{t('Button Mode')}</label>
                  <PropertyEditor
                    type="select"
                    value={(component.data as any)?.buttonMode || 'none'}
                    onChange={(value) => {
                      handleDataChange('buttonMode', value);
                      
                      // 如果启用按键效果，自动在 name 中添加 _button_ 标识（如果还没有）
                      if (value !== 'none' && !component.name.includes('_button_')) {
                        const newName = component.name.replace(component.type, `${component.type}_button`);
                        onUpdate({ name: newName });
                      }
                      // 如果禁用按键效果，移除 _button_ 标识
                      else if (value === 'none' && component.name.includes('_button_')) {
                        const newName = component.name.replace('_button_', '_').replace('_button', '');
                        onUpdate({ name: newName });
                      }
                    }}
                    options={['none', 'dual-state', 'opacity']}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', marginTop: '2px' }}>
                    {(component.data as any)?.buttonMode === 'dual-state' && t('Switch between two states on click')}
                    {(component.data as any)?.buttonMode === 'opacity' && t('Change opacity on press/release')}
                    {((component.data as any)?.buttonMode === 'none' || !(component.data as any)?.buttonMode) && t('No button effect')}
                  </span>
                </div>

                {/* 双态模式属性 */}
                {(component.data as any)?.buttonMode === 'dual-state' && (
                  <>
                    {/* 初始状态 */}
                    <div className="property-item">
                      <label>{t('Initial State')}</label>
                      <PropertyEditor
                        type="select"
                        value={(component.data as any)?.buttonInitialState || 'off'}
                        onChange={(value) => handleDataChange('buttonInitialState', value)}
                        options={['on', 'off']}
                      />
                    </div>

                    {/* 几何组件：双态颜色 */}
                    {(component.type === 'hg_rect' || component.type === 'hg_circle') && (
                      <div className="property-item">
                        <label>{t('State Colors')}</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                          <div>
                            <label style={{ fontSize: '12px' }}>{t('On State')}</label>
                            <PropertyEditor
                              type="color"
                              value={(component.data as any)?.buttonStateOnColor || '#00FF00'}
                              onChange={(value) => handleDataChange('buttonStateOnColor', value)}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '12px' }}>{t('Off State')}</label>
                            <PropertyEditor
                              type="color"
                              value={(component.data as any)?.buttonStateOffColor || '#FF0000'}
                              onChange={(value) => handleDataChange('buttonStateOffColor', value)}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* 透明度模式属性 */}
                {(component.data as any)?.buttonMode === 'opacity' && (
                  <div className="property-item">
                    <label>{t('Opacity States')}</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                      <div>
                        <label style={{ fontSize: '12px' }}>{t('Pressed')}</label>
                        <PropertyEditor
                          type="number"
                          value={(component.data as any)?.buttonPressedOpacity ?? 128}
                          onChange={(value) => handleDataChange('buttonPressedOpacity', value)}
                          min={0}
                          max={255}
                        />
                        <span style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)' }}>
                          (0-255)
                        </span>
                      </div>
                      <div>
                        <label style={{ fontSize: '12px' }}>{t('Released')}</label>
                        <PropertyEditor
                          type="number"
                          value={(component.data as any)?.buttonReleasedOpacity ?? 255}
                          onChange={(value) => handleDataChange('buttonReleasedOpacity', value)}
                          min={0}
                          max={255}
                        />
                        <span style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)' }}>
                          (0-255)
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </CollapsibleGroup>
            )}

            {/* Font Properties - 对所有包含 font 组属性的控件显示 */}
            {definition && definition.properties.filter(p => p.group === 'font').length > 0 && (
              <CollapsibleGroup title={t('Font')}>
                {/* 字体文件 */}
                {definition.properties.some(p => p.name === 'fontFile') && (
                <div className="property-item">
                  <label>{t('Font File')}</label>
                  {renderFontProperty(
                    (component.data as any)?.fontFile,
                    (value) => handleDataChange('fontFile', value),
                    'fontFile'
                  )}
                </div>
                )}
                {/* 字体大小 */}
                {definition.properties.some(p => p.name === 'fontSize') && (
                <div className="property-item">
                  <label>{t('Font Size')}</label>
                  <PropertyEditor
                    type="number"
                    value={(component.data as any)?.fontSize ?? 16}
                    onChange={(value) => handleDataChange('fontSize', value)}
                    min={1}
                  />
                </div>
                )}
                {/* 字体类型 - 仅定义了 fontType 属性的控件显示 */}
                {definition.properties.some(p => p.name === 'fontType') && (
                <div className="property-item">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {t('Font Type')}
                    <span
                      title={`${t('Bitmap font')}: ${t('Bitmap font hint')}\n${t('Vector font')}: ${t('Vector font hint')}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '14px',
                        height: '14px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--vscode-badge-background)',
                        color: 'var(--vscode-badge-foreground)',
                        fontSize: '10px',
                        cursor: 'help',
                        fontWeight: 'bold',
                      }}
                    >
                      ?
                    </span>
                  </label>
                  <PropertyEditor
                    type="select"
                    value={(component.data as any)?.fontType || 'bitmap'}
                    onChange={(value) => handleDataChange('fontType', value)}
                    options={[
                      { value: 'bitmap', label: t('Bitmap font') },
                      { value: 'vector', label: t('Vector font') },
                    ]}
                  />
                </div>
                )}
                {/* 渲染模式 - 仅定义了 renderMode 属性且点阵字体时显示 */}
                {definition.properties.some(p => p.name === 'renderMode') && ((component.data as any)?.fontType || 'bitmap') === 'bitmap' && (
                  <div className="property-item">
                    <label>{t('Render Mode')}</label>
                    <PropertyEditor
                      type="select"
                      value={(component.data as any)?.renderMode || '4'}
                      onChange={(value) => handleDataChange('renderMode', value)}
                      options={['1', '2', '4', '8']}
                    />
                    <span style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', marginTop: '2px' }}>
                      {(component.data as any)?.renderMode || '4'}-bit {t('grayscale')}
                    </span>
                  </div>
                )}
                {/* 附加字符集 - 仅定义了 fontType 属性的控件显示（label 系列） */}
                {definition.properties.some(p => p.name === 'fontType') && (
                <div className="property-item">
                  <label>{t('Additional Character Sets')}</label>
                  <div style={{ marginTop: '4px' }}>
                    {renderCharacterSets()}
                  </div>
                </div>
                )}
              </CollapsibleGroup>
            )}

            {/* Timer Properties - 仅对 hg_timer_label 显示 */}
            {definition && component.type === 'hg_timer_label' && definition.properties.filter(p => p.group === 'timer').length > 0 && (
              <CollapsibleGroup title={t('Advanced')} defaultCollapsed={true}>
                {/* 计时器类型 */}
                <div className="property-item">
                  <label>{t('Timer Type')}</label>
                  <PropertyEditor
                    type="select"
                    value={(component.data as any)?.timerType || 'stopwatch'}
                    onChange={(value) => handleDataChange('timerType', value)}
                    options={[
                      { value: 'stopwatch', label: t('Stopwatch') },
                      { value: 'countdown', label: t('Countdown') },
                    ]}
                  />
                </div>
                {/* 显示格式 */}
                <div className="property-item">
                  <label>{t('Display Format')}</label>
                  <PropertyEditor
                    type="select"
                    value={(component.data as any)?.timerFormat || 'HH:MM:SS'}
                    onChange={(value) => handleDataChange('timerFormat', value)}
                    options={['HH:MM:SS', 'MM:SS', 'MM:SS:MS', 'SS']}
                  />
                </div>
                {/* 初始值 */}
                <div className="property-item">
                  <label>{t('Initial Value (ms)')}</label>
                  <PropertyEditor
                    type="number"
                    value={(component.data as any)?.timerInitialValue || 0}
                    onChange={(value) => handleDataChange('timerInitialValue', value)}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', marginTop: '2px' }}>
                    {t('Timer value in milliseconds')}
                  </span>
                </div>
                {/* 自动启动 */}
                <div className="property-item">
                  <label>{t('Auto Start')}</label>
                  <PropertyEditor
                    type="boolean"
                    value={(component.data as any)?.timerAutoStart !== false}
                    onChange={(value) => handleDataChange('timerAutoStart', value)}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', marginTop: '2px' }}>
                    {t('Start timer automatically on load')}
                  </span>
                </div>
              </CollapsibleGroup>
            )}

            {/* Time Properties - 对 hg_time_label 显示 */}
            {definition && component.type === 'hg_time_label' && definition.properties.filter(p => p.group === 'time').length > 0 && (
              <CollapsibleGroup title={t('Advanced')} defaultCollapsed={true}>
                {/* 显示格式 */}
                <div className="property-item">
                  <label>{t('Display Format')}</label>
                  <PropertyEditor
                    type="select"
                    value={(component.data as any)?.timeFormat || 'HH:mm:ss'}
                    onChange={(value) => handleDataChange('timeFormat', value)}
                    options={['HH:mm:ss', 'HH:mm', 'HH', 'mm', 'HH:mm-split', 'YYYY-MM-DD', 'YYYY-MM-DD HH:mm:ss', 'MM-DD HH:mm']}
                  />
                </div>
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
