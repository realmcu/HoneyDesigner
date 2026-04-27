import React from 'react';
import { WidgetProps } from './types';
import { useFontLoader } from '../../hooks/useFontLoader';
import { useFontGlyphCheck } from '../../hooks/useFontGlyphCheck';

export const LabelWidget: React.FC<WidgetProps> = ({ component, style, handlers, children }) => {
  const fontPath = component.data?.fontFile;
  const { fontFamily, isLoading: fontLoading } = useFontLoader(fontPath);
  const timeFormat = component.data?.timeFormat || '';
  const isSplitTime = timeFormat === 'HH:mm-split';
  
  // 拆分时间模式下使用用户设置的文本，如果没有则使用默认示例
  let displayText = component.data?.text || component.name;
  
  if (isSplitTime && !component.data?.text) {
    displayText = '12:34'; // 拆分时间的默认预览（仅当用户未设置文本时）
  }
  
  const text = displayText;
  
  // 滚动动画状态
  const [scrollOffset, setScrollOffset] = React.useState(0);
  const animationRef = React.useRef<number | null>(null);
  const startTimeRef = React.useRef<number | null>(null);
  
  // 检测字体是否支持文本中的所有字符（传递 fontPath 给后端解析）
  const { supported, missingChars, isChecking } = useFontGlyphCheck(fontFamily, text, fontPath);
  
  // 只有在选择了自定义字体且检测完成时才显示警告
  const showWarning = fontPath && !fontLoading && !isChecking && !supported && missingChars.length > 0;

  // 合并字体样式
  const hAlign = component.style?.hAlign || 'LEFT';
  const vAlign = component.style?.vAlign || 'TOP';
  
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
  // - 横向滚动：强制不换行
  // - 纵向滚动：强制换行
  // - 非滚动：使用用户设置
  let wordWrap: boolean;
  if (enableScroll) {
    wordWrap = scrollDirection === 'vertical';
  } else {
    wordWrap = component.style?.wordWrap || false;
  }
  const wordBreak = component.style?.wordBreak || false;
  
  // 获取配置的字号（确保是数字类型）
  const actualFontSize = Number(component.data?.fontSize) || 16;
  
  // 计算垂直对齐的 padding
  // 关键：lineHeight 等于 fontSize 时，文本占用空间 = EM 矩形大小
  const lineSpacingNum = Number(component.style?.lineSpacing) || 0;
  const lineHeight = lineSpacingNum 
    ? actualFontSize + lineSpacingNum
    : actualFontSize;
  
  const containerHeight = typeof style?.height === 'number' ? style.height : 0;
  const containerWidth = typeof style?.width === 'number' ? style.width : 0;
  const verticalPadding = vAlign === 'MID' && containerHeight > 0 
    ? Math.max(0, (containerHeight - lineHeight) / 2) 
    : 0;

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

    // 计算文本实际宽度/高度（估算）
    const letterSpacing = Number(component.style?.letterSpacing) || 0;
    const textLength = text.length;
    const estimatedTextWidth = textLength * actualFontSize * 0.6 + (textLength - 1) * letterSpacing;
    const estimatedTextHeight = wordWrap 
      ? Math.ceil(estimatedTextWidth / containerWidth) * lineHeight
      : lineHeight;
    
    // 计算滚动总距离
    const isHorizontal = scrollDirection === 'horizontal';
    const containerSize = isHorizontal ? containerWidth : containerHeight;
    const textSize = isHorizontal ? estimatedTextWidth : estimatedTextHeight;
    
    // 滚动距离 = 起始偏移 + 文本长度 + 结束偏移
    const totalScrollDistance = scrollStartOffset + textSize + scrollEndOffset;
    
    const animate = (timestamp: number) => {
      if (!startTimeRef.current) {
        startTimeRef.current = timestamp;
      }
      
      const elapsed = timestamp - startTimeRef.current;
      
      // 检查是否超过总持续时间
      if (scrollDuration > 0 && elapsed >= scrollDuration) {
        setScrollOffset(0);
        startTimeRef.current = null;
        return;
      }
      
      // 计算当前循环内的进度
      const cycleProgress = (elapsed % scrollInterval) / scrollInterval;
      
      // 计算偏移量
      let offset = cycleProgress * totalScrollDistance - scrollStartOffset;
      
      // 反向滚动
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

  const labelStyle: React.CSSProperties = {
    ...style,
    // 确保宽高从 style 中正确继承
    width: style?.width,
    height: style?.height,
    fontFamily: fontFamily || 'inherit',
    fontSize: actualFontSize,
    color: component.style?.color || '#ffffff',
    letterSpacing: Number(component.style?.letterSpacing) || 0,
    // 关键：lineHeight 必须等于 fontSize（或 fontSize + lineSpacing），确保文本占用空间 = EM 矩形
    lineHeight: `${lineHeight}px`,
    textAlign: hAlign.toLowerCase() as any,
    display: style?.display === 'none' ? 'none' : 'block',
    // 垂直对齐：基于 lineHeight（即 EM 矩形大小）
    paddingTop: `${verticalPadding}px`,
    // 按词换行
    wordBreak: wordBreak ? 'keep-all' : 'break-all',
    whiteSpace: wordWrap ? 'pre-wrap' : 'nowrap',
    overflow: 'hidden',
    // 确保不改变容器高度
    boxSizing: 'border-box',
    position: 'absolute',
  };

  const warningStyle: React.CSSProperties = {
    color: '#ff4444',
    fontSize: 12,
    marginTop: 4,
    fontFamily: 'system-ui, sans-serif',
    whiteSpace: 'normal',
    wordBreak: 'break-all',
    lineHeight: '1.4',
  };

  // 滚动文本的样式
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

  // 拆分时间的特殊渲染（仅在 HH:mm-split 格式且启用换行时）
  if (isSplitTime && wordWrap && text.includes(':')) {
    const parts = text.split(':');
    if (parts.length === 2) {
      const hour = parts[0];
      const minute = parts[1];
      
      // 参考 SDK 示例布局：
      // - 冒号宽度 = 字体大小 / 2
      // - 小时和分钟使用相同的 x 和宽度
      // - 都使用居中对齐
      const colonWidth = actualFontSize / 2;  // 冒号宽度 = 字体大小 / 2
      const numWidth = containerWidth - colonWidth;  // 数字部分宽度
      
      return (
        <div key={component.id} style={{...labelStyle, display: labelStyle.display === 'none' ? 'none' : 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: 0}} {...handlers}>
          {/* 第一行：小时（居中对齐） */}
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
            {/* 冒号（居中） */}
            <div style={{ 
              fontFamily: fontFamily || 'inherit',
              width: `${colonWidth}px`,
              textAlign: 'center'
            }}>
              :
            </div>
            {/* 分钟（居中对齐，与小时上下对齐） */}
            <div style={{ 
              fontFamily: fontFamily || 'inherit',
              width: `${numWidth}px`,
              textAlign: 'center'
            }}>
              {minute}
            </div>
          </div>
          {/* 显示警告信息 */}
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
    <div key={component.id} style={labelStyle} {...handlers}>
      {/* 如果字体不支持，隐藏文本；否则正常显示 */}
      {!showWarning && (
        <span style={scrollTextStyle}>{text}</span>
      )}
      {/* 显示警告信息 */}
      {showWarning && (
        <span style={warningStyle}>
          ⚠️ 字体缺少字形: {missingChars.slice(0, 5).map(c => `"${c}"`).join(' ')}
          {missingChars.length > 5 && ` 等${missingChars.length}个字符`}
        </span>
      )}
      {children}
    </div>
  );
};
