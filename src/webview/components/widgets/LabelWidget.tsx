import React from 'react';
import { WidgetProps } from './types';
import { useFontLoader } from '../../hooks/useFontLoader';
import { useFontGlyphCheck } from '../../hooks/useFontGlyphCheck';
import { useTextLayout, getTextLayoutParams } from '../../hooks/useTextLayout';

export const LabelWidget: React.FC<WidgetProps> = ({ component, style, handlers, children }) => {
  const fontPath = component.data?.fontFile;
  const { fontFamily, isLoading: fontLoading } = useFontLoader(fontPath);
  const timeFormat = component.data?.timeFormat || '';
  const isSplitTime = timeFormat === 'HH:mm-split';
  
  let displayText = component.data?.text || component.name;
  if (isSplitTime && !component.data?.text) {
    displayText = '12:34';
  }
  const text = displayText;
  
  // 滚动动画状态
  const [scrollOffset, setScrollOffset] = React.useState(0);
  const animationRef = React.useRef<number | null>(null);
  const startTimeRef = React.useRef<number | null>(null);
  
  // 字体字形检测
  const { supported, missingChars, isChecking } = useFontGlyphCheck(fontFamily, text, fontPath);
  const showWarning = fontPath && !fontLoading && !isChecking && !supported && missingChars.length > 0;

  // 滚动相关属性
  const enableScroll = (component.data as any)?.enableScroll;
  const scrollPreview = (component.data as any)?.scrollPreview;
  const scrollDirection = component.data?.scrollDirection || 'horizontal';
  const scrollReverse = (component.data as any)?.scrollReverse;
  const scrollStartOffset = Number(component.data?.scrollStartOffset) || 0;
  const scrollEndOffset = Number(component.data?.scrollEndOffset) || 0;
  const scrollInterval = Number(component.data?.scrollInterval) || 3000;
  const scrollDuration = Number(component.data?.scrollDuration) || 0;
  
  // 换行设置：滚动时根据方向自动设置
  let wordWrap: boolean;
  if (enableScroll) {
    wordWrap = scrollDirection === 'vertical';
  } else {
    wordWrap = component.style?.wordWrap || false;
  }

  // ========== 排版计算（共用逻辑） ==========
  const layoutParams = getTextLayoutParams(component, fontFamily);
  layoutParams.wordWrap = wordWrap; // 滚动模式可能覆盖 wordWrap
  const { lineHeight, cssLineHeight, containerStyle, textBlockStyle } = useTextLayout(layoutParams, style);

  const actualFontSize = layoutParams.fontSize;
  const containerWidth = typeof style?.width === 'number' ? style.width : 0;
  const containerHeight = typeof style?.height === 'number' ? style.height : 0;

  // 滚动动画效果
  React.useEffect(() => {
    if (!enableScroll || !scrollPreview) {
      setScrollOffset(0);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      startTimeRef.current = null;
      return;
    }

    const letterSpacing = Number(component.style?.letterSpacing) || 0;
    const textLength = text.length;
    const estimatedTextWidth = textLength * actualFontSize * 0.6 + (textLength - 1) * letterSpacing;
    const estimatedTextHeight = wordWrap 
      ? Math.ceil(estimatedTextWidth / containerWidth) * lineHeight
      : lineHeight;
    
    const isHorizontal = scrollDirection === 'horizontal';
    const textSize = isHorizontal ? estimatedTextWidth : estimatedTextHeight;
    const totalScrollDistance = scrollStartOffset + textSize + scrollEndOffset;
    
    const animate = (timestamp: number) => {
      if (!startTimeRef.current) {
        startTimeRef.current = timestamp;
      }
      
      const elapsed = timestamp - startTimeRef.current;
      
      if (scrollDuration > 0 && elapsed >= scrollDuration) {
        setScrollOffset(0);
        startTimeRef.current = null;
        return;
      }
      
      const cycleProgress = (elapsed % scrollInterval) / scrollInterval;
      let offset = cycleProgress * totalScrollDistance - scrollStartOffset;
      
      if (scrollReverse) {
        offset = -offset;
      }
      
      setScrollOffset(offset);
      animationRef.current = requestAnimationFrame(animate);
    };
    
    animationRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      startTimeRef.current = null;
    };
  }, [enableScroll, scrollPreview, scrollDirection, scrollReverse, scrollStartOffset, scrollEndOffset, scrollInterval, scrollDuration, text, actualFontSize, containerWidth, containerHeight, lineHeight, wordWrap, component.style?.letterSpacing]);

  const warningStyle: React.CSSProperties = {
    color: '#ff4444',
    fontSize: 12,
    marginTop: 4,
    fontFamily: 'system-ui, sans-serif',
    whiteSpace: 'normal',
    wordBreak: 'break-all',
    lineHeight: '1.4',
  };

  const scrollTextStyle: React.CSSProperties = {
    fontFamily: fontFamily || 'inherit',
    display: 'inline-block',
    transform: enableScroll && scrollPreview
      ? scrollDirection === 'horizontal'
        ? `translateX(${-scrollOffset}px)`
        : `translateY(${-scrollOffset}px)`
      : 'none',
    transition: 'none',
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
          {showWarning && (
            <span style={warningStyle}>
              ⚠️ 字体缺少字形: {missingChars.slice(0, 5).map(c => `"${c}"`).join(' ')}
              {missingChars.length > 5 && ` 等${missingChars.length}个字符`}
            </span>
          )}
          {children}
        </div>
      );
    }
  }

  return (
    <div key={component.id} style={containerStyle} {...handlers}>
      <div style={textBlockStyle}>
        {!showWarning && (
          <span style={scrollTextStyle}>{text}</span>
        )}
        {showWarning && (
          <span style={warningStyle}>
            ⚠️ 字体缺少字形: {missingChars.slice(0, 5).map(c => `"${c}"`).join(' ')}
            {missingChars.length > 5 && ` 等${missingChars.length}个字符`}
          </span>
        )}
      </div>
      {children}
    </div>
  );
};
