import React, { useState } from 'react';
import { PropertyPanelProps } from './types';
import { PropertyEditor } from './PropertyEditor';
import { BaseProperties } from './BaseProperties';
import { EventsPanel } from './EventsPanel';
import { CollapsibleGroup } from './CollapsibleGroup';
import { t } from '../../i18n';

export const HgImageProperties: React.FC<PropertyPanelProps> = ({ component, onUpdate, components }) => {
  const [activeTab, setActiveTab] = useState<'properties' | 'events'>('properties');
  
  // 本地状态用于处理输入中间状态（如负号）
  const [translateXInput, setTranslateXInput] = useState<string>('');
  const [translateYInput, setTranslateYInput] = useState<string>('');
  const [rotationInput, setRotationInput] = useState<string>('');
  
  // 保存当前正在编辑的组件 ID（用于 onBlur 时确保操作应用到正确的组件）
  const componentIdRef = React.useRef(component.id);
  const [proportionalScale, setProportionalScale] = useState(true);
  
  // 组件切换时更新 ref 和输入状态
  React.useEffect(() => {
    componentIdRef.current = component.id;
    const transform = component.style?.transform || {};
    setTranslateXInput(String(transform.translateX ?? 0));
    setTranslateYInput(String(transform.translateY ?? 0));
    setRotationInput(String(transform.rotation ?? 0));
  }, [component.id, component.style?.transform?.translateX, component.style?.transform?.translateY, component.style?.transform?.rotation]);

  const handleDataChange = (property: string, value: any) => {
    onUpdate({
      data: {
        ...component.data,
        [property]: value,
      },
    });
  };

  const handleTransformChange = (property: string, value: any) => {
    const transform = component.style?.transform || {};
    onUpdate({
      style: {
        ...component.style,
        transform: {
          ...transform,
          [property]: value,
        },
      },
    });
  };

  const handleTransformCenterPreset = (x: number | undefined, y: number | undefined) => {
    const transform = component.style?.transform || {};
    onUpdate({
      style: {
        ...component.style,
        transform: {
          ...transform,
          focusX: x,
          focusY: y,
        },
      },
    });
  };

  const handleScaleChange = (axis: 'scaleX' | 'scaleY', val: any) => {
    const value = val === '' ? 1.0 : parseFloat(val);
    const finalVal = isNaN(value) ? 1.0 : Math.max(0, value);
    const transform = component.style?.transform || {};
    if (proportionalScale) {
      onUpdate({
        style: {
          ...component.style,
          transform: { ...transform, scaleX: finalVal, scaleY: finalVal },
        },
      });
    } else {
      handleTransformChange(axis, finalVal);
    }
  };

  const handleSelectImagePath = () => {
    // 直接使用后端的 selectImagePath 命令，让后端处理路径检测和复制
    window.vscodeAPI?.postMessage({
      command: 'selectImagePath',
      componentId: component.id,
      propertyName: 'src'
    });
  };

  const renderImageProperty = (value: any, onChange: (value: any) => void) => {
    return (
      <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => {
            // 失去焦点时获取图片尺寸（使用保存的组件 ID）
            const val = e.target.value;
            if (val && val.startsWith('assets/')) {
              window.vscodeAPI?.postMessage({
                command: 'getImageSizeForComponent',
                componentId: componentIdRef.current,
                imagePath: val
              });
            }
          }}
          placeholder={t('Image Path')}
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
          onClick={handleSelectImagePath}
          style={{
            padding: '4px 8px',
            backgroundColor: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: '2px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
          title={t('Select Image File')}
        >
          📁
        </button>
      </div>
    );
  };

  const transform = component.style?.transform || {};
  
  // 渲染模式选项（对应 BLEND_MODE_TYPE 枚举）
  const blendModeOptions = [
    { value: 'IMG_BYPASS_MODE', label: 'IMG_BYPASS_MODE' },
    { value: 'IMG_FILTER_BLACK', label: 'IMG_FILTER_BLACK' },
    { value: 'IMG_SRC_OVER_MODE', label: 'IMG_SRC_OVER_MODE' },
    { value: 'IMG_COVER_MODE', label: 'IMG_COVER_MODE' },
    { value: 'IMG_RECT', label: 'IMG_RECT' },
    { value: 'IMG_2D_SW_RGB565_ONLY', label: 'IMG_2D_SW_RGB565_ONLY' },
    { value: 'IMG_2D_SW_SRC_OVER_MODE', label: 'IMG_2D_SW_SRC_OVER_MODE' },
    { value: 'IMG_2D_SW_FIX_A8_FG', label: 'IMG_2D_SW_FIX_A8_FG' },
    { value: 'IMG_2D_SW_FIX_A8_BGFG', label: 'IMG_2D_SW_FIX_A8_BGFG' },
  ];

  // 获取当前渲染模式，默认为 IMG_FILTER_BLACK
  const currentBlendMode = component.data?.blendMode || 'IMG_FILTER_BLACK';
  
  // 判断是否需要显示前景色和背景色设置
  const showFgColor = currentBlendMode === 'IMG_2D_SW_FIX_A8_FG' || currentBlendMode === 'IMG_2D_SW_FIX_A8_BGFG';
  const showBgColor = currentBlendMode === 'IMG_2D_SW_FIX_A8_BGFG';

  // 颜色转换函数：将 #RRGGBB 转换为 0xFFRRGGBB 格式
  const hexToArgb = (hex: string): string => {
    if (!hex || !hex.startsWith('#')) return '0xFFFFFFFF';
    const rgb = hex.substring(1).toUpperCase();
    return `0xFF${rgb}`;
  };

  // 颜色转换函数：将 0xFFRRGGBB 转换为 #RRGGBB 格式
  const argbToHex = (argb: string): string => {
    if (!argb || !argb.toLowerCase().startsWith('0x') || argb.length < 8) return '#FFFFFF';
    const hex = argb.substring(4);
    return `#${hex}`;
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
      {activeTab === 'properties' ? (
        <>
          <BaseProperties component={component} onUpdate={onUpdate} components={components} disableSize={true} sizeTooltip={t('Image size is determined by the source file')} />

          {/* 内容 */}
          <CollapsibleGroup title={t('Content')}>
            <div className="property-item">
              <label>{t('Image Path')}</label>
              {renderImageProperty(component.data?.src, (value) => handleDataChange('src', value))}
            </div>
          </CollapsibleGroup>

          {/* 样式 */}
          <CollapsibleGroup title={t('Style')}>
            {/* 透明度 */}
            <div className="property-item">
              <label>{t('Opacity (0-255)')}</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                <input
                  type="range"
                  min="0"
                  max="255"
                  value={transform.opacity ?? 255}
                  onChange={(e) => handleTransformChange('opacity', parseInt(e.target.value))}
                  style={{
                    flex: 1,
                  }}
                />
                <div style={{ width: '60px' }}>
                  <PropertyEditor
                    type="number"
                    value={transform.opacity ?? 255}
                    min={0}
                    max={255}
                    onChange={(value) => {
                      let val = parseInt(value);
                      if (isNaN(val)) {
                        val = 255;
                      } else if (val < 0) {
                        val = 0;
                      } else if (val > 255) {
                        val = 255;
                      }
                      handleTransformChange('opacity', val);
                    }}
                  />
                </div>
              </div>
            </div>
          </CollapsibleGroup>

          {/* Rendering 分组 */}
          <CollapsibleGroup title={t('Rendering')} defaultCollapsed={true}>
            
            {/* 渲染模式 */}
            <div className="property-item">
              <label>{t('Blend Mode')}</label>
              <select
                value={currentBlendMode}
                onChange={(e) => handleDataChange('blendMode', e.target.value)}
                style={{
                  width: '100%',
                  padding: '4px 6px',
                  marginTop: '4px',
                  backgroundColor: 'var(--vscode-input-background)',
                  color: 'var(--vscode-input-foreground)',
                  border: '1px solid var(--vscode-input-border)',
                  borderRadius: '2px',
                }}
              >
                {blendModeOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 前景色设置（仅在 IMG_2D_SW_FIX_A8_FG 或 IMG_2D_SW_FIX_A8_BGFG 模式下显示） */}
            {showFgColor && (
              <>
              {/* 资源格式设置 */}
              <div className="property-item">
                <label>{t('Asset Format')}</label>
                <select
                  value={component.data?.assetFormat || 'A8'}
                  onChange={(e) => handleDataChange('assetFormat', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '4px 6px',
                    marginTop: '4px',
                    backgroundColor: 'var(--vscode-input-background)',
                    color: 'var(--vscode-input-foreground)',
                    border: '1px solid var(--vscode-input-border)',
                    borderRadius: '2px',
                  }}
                >
                  <option value="A8">A8 (8-bit alpha)</option>
                  <option value="A4">A4 (4-bit alpha, MSB)</option>
                  <option value="A2">A2 (2-bit alpha, MSB)</option>
                  <option value="A1">A1 (1-bit alpha, MSB)</option>
                </select>
              </div>

              <div className="property-item">
                <label>{t('Foreground Color')}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                  <input
                    type="color"
                    value={argbToHex(component.data?.fgColor || '0xFFFFFFFF')}
                    onChange={(e) => handleDataChange('fgColor', hexToArgb(e.target.value))}
                    style={{ width: '30px', height: '30px', padding: 0, border: 'none' }}
                  />
                  <input
                    type="text"
                    value={component.data?.fgColor || '0xFFFFFFFF'}
                    onChange={(e) => handleDataChange('fgColor', e.target.value)}
                    placeholder="0xFFRRGGBB"
                    style={{
                      flex: 1,
                      padding: '4px 6px',
                      backgroundColor: 'var(--vscode-input-background)',
                      color: 'var(--vscode-input-foreground)',
                      border: '1px solid var(--vscode-input-border)',
                      borderRadius: '2px',
                    }}
                  />
                </div>
              </div>
              </>
            )}

            {/* 背景色设置（仅在 IMG_2D_SW_FIX_A8_BGFG 模式下显示） */}
            {showBgColor && (
              <div className="property-item">
                <label>{t('Background Color')}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                  <input
                    type="color"
                    value={argbToHex(component.data?.bgColor || '0xFFFFFFFF')}
                    onChange={(e) => handleDataChange('bgColor', hexToArgb(e.target.value))}
                    style={{ width: '30px', height: '30px', padding: 0, border: 'none' }}
                  />
                  <input
                    type="text"
                    value={component.data?.bgColor || '0xFFFFFFFF'}
                    onChange={(e) => handleDataChange('bgColor', e.target.value)}
                    placeholder="0xFFRRGGBB"
                    style={{
                      flex: 1,
                      padding: '4px 6px',
                      backgroundColor: 'var(--vscode-input-background)',
                      color: 'var(--vscode-input-foreground)',
                      border: '1px solid var(--vscode-input-border)',
                      borderRadius: '2px',
                    }}
                  />
                </div>
              </div>
            )}

            {/* 高质量渲染开关 */}
            <div className="property-item">
              <label>{t('High Quality Rendering')}</label>
              <input
                type="checkbox"
                checked={component.data?.highQuality === true}
                onChange={(e) => handleDataChange('highQuality', e.target.checked)}
                style={{ marginTop: '4px' }}
              />
            </div>

            {/* 裁剪开关 */}
            <div className="property-item">
              <label>{t('Enable Clipping')}</label>
              <input
                type="checkbox"
                checked={component.data?.needClip === true}
                onChange={(e) => handleDataChange('needClip', e.target.checked)}
                style={{ marginTop: '4px' }}
              />
            </div>
          </CollapsibleGroup>

          {/* 变换属性 */}
          <CollapsibleGroup title={t('Transform')} defaultCollapsed={true}>
            
            {/* 缩放 */}
            <div className="property-item">
              <label>{t('Scale')}</label>
              <div style={{ display: 'flex', gap: '4px', marginTop: '4px', alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)' }}>X</label>
                  <PropertyEditor
                    type="number"
                    min={0}
                    step={0.1}
                    value={transform.scaleX ?? 1.0}
                    onChange={(val) => handleScaleChange('scaleX', val)}
                  />
                </div>
                <button
                  className={`scale-link-btn${proportionalScale ? ' active' : ''}`}
                  title={proportionalScale ? t('Unlink scale axes') : t('Link scale axes')}
                  onClick={() => setProportionalScale(!proportionalScale)}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    {proportionalScale ? (
                      <>
                        <path d="M4.5 3A1.5 1.5 0 0 0 3 4.5v1a1.5 1.5 0 0 0 1.06 1.44l1.5-1.5A.5.5 0 0 1 5 5.5v-1a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .06.004l1.5-1.5A1.5 1.5 0 0 0 6.5 3h-2z" />
                        <path d="M11.5 13A1.5 1.5 0 0 0 13 11.5v-1a1.5 1.5 0 0 0-1.06-1.44l-1.5 1.5A.5.5 0 0 1 11 10.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.06-.004l-1.5 1.5A1.5 1.5 0 0 0 9.5 13h2z" />
                        <path d="M5.354 10.354l5-5-.708-.708-5 5 .708.708z" />
                      </>
                    ) : (
                      <>
                        <path d="M4.5 3A1.5 1.5 0 0 0 3 4.5v1a1.5 1.5 0 0 0 1.5 1.5h1A1.5 1.5 0 0 0 7 5.5v-1A1.5 1.5 0 0 0 5.5 3h-1zM4 4.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1z" />
                        <path d="M10.5 9A1.5 1.5 0 0 0 9 10.5v1a1.5 1.5 0 0 0 1.5 1.5h1a1.5 1.5 0 0 0 1.5-1.5v-1A1.5 1.5 0 0 0 11.5 9h-1zm-.5 1.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1z" />
                      </>
                    )}
                  </svg>
                </button>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)' }}>Y</label>
                  <PropertyEditor
                    type="number"
                    min={0}
                    step={0.1}
                    value={transform.scaleY ?? 1.0}
                    onChange={(val) => handleScaleChange('scaleY', val)}
                  />
                </div>
              </div>
            </div>

            {/* 旋转 */}
            <div className="property-item">
              <label>{t('Rotation Angle (°)')}</label>
              <PropertyEditor
                type="number"
                value={rotationInput}
                onChange={(val) => {
                  const strVal = String(val);
                  setRotationInput(strVal);
                  const num = parseFloat(strVal);
                  if (!isNaN(num)) {
                    handleTransformChange('rotation', num);
                  }
                }}
              />
            </div>

            {/* 平移 */}
            <div className="property-item">
              <label>{t('Translation')}</label>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)' }}>X</label>
                  <PropertyEditor
                    type="number"
                    value={translateXInput}
                    onChange={(val) => {
                      const strVal = String(val);
                      setTranslateXInput(strVal);
                      const num = parseFloat(strVal);
                      if (!isNaN(num)) {
                        handleTransformChange('translateX', num);
                      }
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)' }}>Y</label>
                  <PropertyEditor
                    type="number"
                    value={translateYInput}
                    onChange={(val) => {
                      const strVal = String(val);
                      setTranslateYInput(strVal);
                      const num = parseFloat(strVal);
                      if (!isNaN(num)) {
                        handleTransformChange('translateY', num);
                      }
                    }}
                  />
                </div>
              </div>
            </div>

            {/* 变换中心点 */}
            <div className="property-item">
              <label>{t('Transform Center')}</label>
              <div className="transform-center-presets">
                {[
                  { label: t('Top-Left'), x: 0, y: 0 },
                  { label: t('Top-Center'), x: Math.round(component.position.width / 2), y: 0 },
                  { label: t('Top-Right'), x: component.position.width, y: 0 },
                  { label: t('Left-Center'), x: 0, y: Math.round(component.position.height / 2) },
                  { label: t('Center'), x: Math.round(component.position.width / 2), y: Math.round(component.position.height / 2) },
                  { label: t('Right-Center'), x: component.position.width, y: Math.round(component.position.height / 2) },
                  { label: t('Bottom-Left'), x: 0, y: component.position.height },
                  { label: t('Bottom-Center'), x: Math.round(component.position.width / 2), y: component.position.height },
                  { label: t('Bottom-Right'), x: component.position.width, y: component.position.height },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    className={`transform-center-preset-btn${
                      transform.focusX === preset.x && transform.focusY === preset.y ? ' active' : ''
                    }`}
                    title={`${preset.label} (${preset.x}, ${preset.y})`}
                    onClick={() => handleTransformCenterPreset(preset.x, preset.y)}
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  className={`transform-center-preset-btn default-btn${
                    transform.focusX === undefined && transform.focusY === undefined ? ' active' : ''
                  }`}
                  title={t('Clear to use default')}
                  onClick={() => handleTransformCenterPreset(undefined, undefined)}
                >
                  {t('Default')}
                </button>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)' }}>X</label>
                  <PropertyEditor
                    type="number"
                    value={transform.focusX ?? ''}
                    placeholder="default"
                    onChange={(value) => handleTransformChange('focusX', value ? parseFloat(value) : undefined)}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)' }}>Y</label>
                  <PropertyEditor
                    type="number"
                    value={transform.focusY ?? ''}
                    placeholder="default"
                    onChange={(value) => handleTransformChange('focusY', value ? parseFloat(value) : undefined)}
                  />
                </div>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', marginTop: '4px' }}>
                {t('Leave empty to use default (rotation: image center, scale: top-left)')}
              </div>
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
