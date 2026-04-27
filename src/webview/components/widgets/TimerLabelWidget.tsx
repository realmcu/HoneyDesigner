import React from 'react';
import { WidgetProps } from './types';
import { useFontLoader } from '../../hooks/useFontLoader';

/**
 * 计时器标签控件
 * 显示计时器，支持正计时和倒计时
 * 在设计器中模拟计时器更新
 */
export const TimerLabelWidget: React.FC<WidgetProps> = ({ component, style, handlers }) => {
  const fontPath = component.data?.fontFile;
  const { fontFamily } = useFontLoader(fontPath);
  
  const [displayText, setDisplayText] = React.useState<string>('00:00:00');
  const [timeCount, setTimeCount] = React.useState<number>(0);

  // 获取计时器配置（兼容 timerFormat 和 timerDisplayFormat）
  const timerType = component.data?.timerType || 'stopwatch'; // stopwatch 或 countdown
  const displayFormat = component.data?.timerFormat || component.data?.timerDisplayFormat || 'HH:MM:SS';
  const initialValue = component.data?.timerInitialValue || 0; // 毫秒
  const autoStart = component.data?.timerAutoStart !== false; // 默认自动启动

  // 格式化时间显示
  const formatTime = React.useCallback((ms: number): string => {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const centiseconds = Math.floor((ms % 1000) / 10);
    
    switch (displayFormat) {
      case 'HH:MM:SS':
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      case 'MM:SS':
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      case 'MM:SS:MS':
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
      case 'SS':
        return seconds.toString().padStart(2, '0');
      default:
        return ms.toString();
    }
  }, [displayFormat]);

  // 初始化计时器值
  React.useEffect(() => {
    setTimeCount(initialValue);
    setDisplayText(formatTime(initialValue));
  }, [initialValue, formatTime]);

  // 模拟计时器更新（每 100ms 更新一次，模拟 10 次 10ms 的更新）
  React.useEffect(() => {
    if (!autoStart) {
      return;
    }

    const interval = setInterval(() => {
      setTimeCount(prevCount => {
        let newCount: number;
        
        if (timerType === 'countdown') {
          // 倒计时模式
          if (prevCount >= 100) {
            newCount = prevCount - 100;
          } else {
            newCount = 0;
            clearInterval(interval); // 倒计时结束，停止定时器
          }
        } else {
          // 正计时模式
          newCount = prevCount + 100;
        }
        
        setDisplayText(formatTime(newCount));
        return newCount;
      });
    }, 100); // 每 100ms 更新一次

    return () => clearInterval(interval);
  }, [autoStart, timerType, formatTime]);

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

  return (
    <div key={component.id} style={labelStyle} {...handlers}>
      <span>{displayText}</span>
    </div>
  );
};
