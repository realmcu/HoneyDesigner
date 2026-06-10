import React from 'react';
import { WidgetProps } from './types';
import { useFontLoader } from '../../hooks/useFontLoader';
import { useTextLayout, getTextLayoutParams } from '../../hooks/useTextLayout';

/**
 * 时间标签控件
 * 显示格式化的时间，支持多种时间格式
 */
export const TimeLabelWidget: React.FC<WidgetProps> = ({ component, style, handlers, children }) => {
  const fontPath = component.data?.fontFile;
  const { fontFamily } = useFontLoader(fontPath);
  const timeFormat = component.data?.timeFormat || 'HH:mm:ss';
  const isSplitTime = timeFormat === 'HH:mm-split';

  // 用户手动填写的文本优先展示（仅设计态预览，不影响 C 代码生成）
  const userText = component.data?.text;

  // 自动时间预览：根据格式决定刷新频率（有秒的每秒，无秒的每分钟）
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (userText) return;
    const hasSeconds = /:ss|second/i.test(timeFormat);
    const interval = hasSeconds ? 1000 : 60000;
    const timer = setInterval(() => setTick(t => t + 1), interval);
    return () => clearInterval(timer);
  }, [userText, timeFormat]);

  // 根据时间格式生成预览文本
  const getPreviewText = (format: string): string => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const year = now.getFullYear();
    const month = pad(now.getMonth() + 1);
    const day = pad(now.getDate());
    const hour = pad(now.getHours());
    const minute = pad(now.getMinutes());
    const second = pad(now.getSeconds());
    
    switch (format) {
      case 'HH:mm:ss': return `${hour}:${minute}:${second}`;
      case 'HH:mm': return `${hour}:${minute}`;
      case 'HH': return `${hour}`;
      case 'mm': return `${minute}`;
      case 'HH:mm-split': return `${hour}:${minute}`;
      case 'YYYY-MM-DD': return `${year}-${month}-${day}`;
      case 'YYYY-MM-DD HH:mm:ss': return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
      case 'MM-DD HH:mm': return `${month}-${day} ${hour}:${minute}`;
      default: return `${hour}:${minute}:${second}`;
    }
  };
  
  const text = userText || getPreviewText(timeFormat);

  // ========== 排版计算（共用逻辑） ==========
  const layoutParams = getTextLayoutParams(component, fontFamily);
  const { cssLineHeight, containerStyle, textBlockStyle } = useTextLayout(layoutParams, style);

  const actualFontSize = layoutParams.fontSize;
  const containerWidth = typeof style?.width === 'number' ? style.width : 0;

  // 拆分时间的特殊渲染
  if (isSplitTime && layoutParams.wordWrap && text.includes(':')) {
    const parts = text.split(':');
    if (parts.length === 2) {
      const hour = parts[0];
      const minute = parts[1];
      
      const colonWidth = actualFontSize / 2;
      const numWidth = containerWidth - colonWidth;
      
      return (
        <div key={component.id} style={containerStyle} {...handlers}>
          <div style={{...textBlockStyle, display: 'flex', flexDirection: 'column', alignItems: 'flex-start'}}>
            <div style={{ 
              fontFamily: fontFamily || 'inherit', 
              lineHeight: cssLineHeight,
              width: `${numWidth}px`,
              marginLeft: `${colonWidth}px`,
              textAlign: 'center'
            }}>
              {hour}
            </div>
            <div style={{ 
              display: 'flex',
              width: '100%',
              lineHeight: cssLineHeight
            }}>
              <div style={{ 
                fontFamily: fontFamily || 'inherit',
                width: `${colonWidth}px`,
                textAlign: 'center'
              }}>
                :
              </div>
              <div style={{ 
                fontFamily: fontFamily || 'inherit',
                width: `${numWidth}px`,
                textAlign: 'center'
              }}>
                {minute}
              </div>
            </div>
          </div>
          {children}
        </div>
      );
    }
  }

  return (
    <div key={component.id} style={containerStyle} {...handlers}>
      <div style={textBlockStyle}>
        <span>{text}</span>
      </div>
      {children}
    </div>
  );
};
