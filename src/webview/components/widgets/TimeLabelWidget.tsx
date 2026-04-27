import React from 'react';
import { WidgetProps } from './types';
import { useFontLoader } from '../../hooks/useFontLoader';

/**
 * 时间标签控件
 * 显示格式化的时间，支持多种时间格式
 */
export const TimeLabelWidget: React.FC<WidgetProps> = ({ component, style, handlers }) => {
  const fontPath = component.data?.fontFile;
  const { fontFamily } = useFontLoader(fontPath);
  const timeFormat = component.data?.timeFormat || 'HH:mm:ss';
  const isSplitTime = timeFormat === 'HH:mm-split';
  
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
  
  const text = getPreviewText(timeFormat);

  // 合并字体样式
  const hAlign = component.style?.hAlign || 'LEFT';
  const vAlign = component.style?.vAlign || 'TOP';
  const wordWrap = component.style?.wordWrap || false;
  
  // 获取配置的字号
  const actualFontSize = Number(component.data?.fontSize) || 16;
  
  // 计算垂直对齐的 padding
  const lineSpacingNum = Number(component.style?.lineSpacing) || 0;
  const lineHeight = lineSpacingNum 
    ? actualFontSize + lineSpacingNum
    : actualFontSize;
  
  const containerHeight = typeof style?.height === 'number' ? style.height : 0;
  const containerWidth = typeof style?.width === 'number' ? style.width : 0;
  const verticalPadding = vAlign === 'MID' && containerHeight > 0 
    ? Math.max(0, (containerHeight - lineHeight) / 2) 
    : 0;

  const labelStyle: React.CSSProperties = {
    ...style,
    width: style?.width,
    height: style?.height,
    fontFamily: fontFamily || 'inherit',
    fontSize: actualFontSize,
    color: component.style?.color || '#ffffff',
    letterSpacing: Number(component.style?.letterSpacing) || 0,
    lineHeight: `${lineHeight}px`,
    textAlign: hAlign.toLowerCase() as any,
    display: style?.display === 'none' ? 'none' : 'block',
    paddingTop: `${verticalPadding}px`,
    whiteSpace: wordWrap ? 'pre-wrap' : 'nowrap',
    overflow: 'hidden',
    boxSizing: 'border-box',
    position: 'absolute',
  };

  // 拆分时间的特殊渲染
  if (isSplitTime && wordWrap && text.includes(':')) {
    const parts = text.split(':');
    if (parts.length === 2) {
      const hour = parts[0];
      const minute = parts[1];
      
      const colonWidth = actualFontSize / 2;
      const numWidth = containerWidth - colonWidth;
      
      return (
        <div key={component.id} style={{...labelStyle, display: labelStyle.display === 'none' ? 'none' : 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: 0}} {...handlers}>
          {/* 第一行：小时 */}
          <div style={{ 
            fontFamily: fontFamily || 'inherit', 
            lineHeight: `${lineHeight}px`,
            width: `${numWidth}px`,
            marginLeft: `${colonWidth}px`,
            textAlign: 'center'
          }}>
            {hour}
          </div>
          {/* 第二行：冒号 + 分钟 */}
          <div style={{ 
            display: 'flex',
            width: '100%',
            lineHeight: `${lineHeight}px`
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
      );
    }
  }

  return (
    <div key={component.id} style={labelStyle} {...handlers}>
      <span>{text}</span>
    </div>
  );
};
