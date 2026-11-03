import React from 'react';
import { t } from '../../i18n';
import { WidgetProps } from './types';
import { useWebviewUri } from '../../hooks/useWebviewUri';
import { useDesignerStore } from '../../store';

export const ButtonWidget: React.FC<WidgetProps> = ({ component, style, handlers }) => {
  const toggleMode = component.data?.toggleMode === true;
  const [isOn, setIsOn] = React.useState(component.data?.initialState === 'on');
  const [isPressed, setIsPressed] = React.useState(false);
  const updateComponent = useDesignerStore(s => s.updateComponent);

  React.useEffect(() => {
    setIsOn(component.data?.initialState === 'on');
  }, [component.data?.initialState]);

  const imageOn = component.data?.imageOn || '';
  const imageOff = component.data?.imageOff || '';

  // Toggle 模式：根据开关状态选图；Normal 模式：根据按下状态选图
  const currentImage = toggleMode
    ? (isOn ? imageOn : imageOff)
    : (isPressed ? imageOn : imageOff);

  const displayImage = currentImage || (toggleMode ? (isOn ? imageOff : imageOn) : (isPressed ? imageOff : imageOn));
  const hasImages = !!(imageOn || imageOff);
  const webviewUri = useWebviewUri(hasImages ? displayImage : '');

  const handleMouseDown = (e: React.MouseEvent) => {
    if (toggleMode) {
      setIsOn(!isOn);
    } else if (hasImages) {
      setIsPressed(true);
    }
    handlers.onMouseDown(e);
  };

  const handleMouseUp = () => {
    if (!toggleMode && hasImages) {
      setIsPressed(false);
    }
  };

  React.useEffect(() => {
    if (!toggleMode && isPressed) {
      const handleGlobalUp = () => setIsPressed(false);
      window.addEventListener('mouseup', handleGlobalUp);
      return () => window.removeEventListener('mouseup', handleGlobalUp);
    }
    return undefined;
  }, [toggleMode, isPressed]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;
    if (naturalW > 0 && naturalH > 0) {
      if (component.position.width !== naturalW || component.position.height !== naturalH) {
        updateComponent(component.id, {
          position: { ...component.position, width: naturalW, height: naturalH }
        });
      }
    }
  };

  const placeholderIcon = toggleMode ? '🔄' : '🔘';
  const toggleText = t('Toggle Button (Current: {0})', t(isOn ? 'On' : 'Off'));
  const placeholderText = toggleMode ? toggleText : t('Button');
  const titleText = toggleMode
    ? toggleText
    : (isPressed ? t('Button (Pressed)') : t('Button'));

  // 图片模式渲染（Toggle 和 Normal 共用）
  if (hasImages) {
    return (
      <div
        key={component.id}
        style={{ ...style, overflow: 'hidden', cursor: 'pointer' }}
        {...handlers}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        title={titleText}
      >
        {webviewUri ? (
          <img
            src={webviewUri}
            onLoad={handleImageLoad}
            draggable={false}
            style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
          />
        ) : (
          <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px dashed #666',
            borderRadius: '4px',
            backgroundColor: 'rgba(128,128,128,0.1)',
            color: '#888',
            fontSize: '12px',
            gap: '4px',
            boxSizing: 'border-box'
          }}>
            <span style={{ fontSize: '24px' }}>{placeholderIcon}</span>
            <span>{placeholderText}</span>
          </div>
        )}
      </div>
    );
  }

  // 无图片的文本按钮（Normal 模式且未配图片时的 fallback）
  return (
    <button
      key={component.id}
      style={style}
      {...handlers}
      disabled={!component.enabled}
    >
      {component.data?.text || component.name}
    </button>
  );
};
