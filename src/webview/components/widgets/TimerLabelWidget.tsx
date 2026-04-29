import React from 'react';
import { WidgetProps } from './types';
import { useFontLoader } from '../../hooks/useFontLoader';
import { useTextLayout, getTextLayoutParams } from '../../hooks/useTextLayout';

/**
 * 计时器标签控件
 * 显示计时器，支持正计时和倒计时
 * 在设计器中模拟计时器更新
 */
export const TimerLabelWidget: React.FC<WidgetProps> = ({ component, style, handlers, children }) => {
  const fontPath = component.data?.fontFile;
  const { fontFamily } = useFontLoader(fontPath);
  
  const [displayText, setDisplayText] = React.useState<string>('00:00:00');
  const [timeCount, setTimeCount] = React.useState<number>(0);

  // 获取计时器配置
  const timerType = component.data?.timerType || 'stopwatch';
  const displayFormat = component.data?.timerFormat || component.data?.timerDisplayFormat || 'HH:MM:SS';
  const initialValue = component.data?.timerInitialValue || 0;
  const autoStart = component.data?.timerAutoStart !== false;

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

  // 模拟计时器更新
  React.useEffect(() => {
    if (!autoStart) {
      return;
    }

    const interval = setInterval(() => {
      setTimeCount(prevCount => {
        let newCount: number;
        
        if (timerType === 'countdown') {
          if (prevCount >= 100) {
            newCount = prevCount - 100;
          } else {
            newCount = 0;
            clearInterval(interval);
          }
        } else {
          newCount = prevCount + 100;
        }
        
        setDisplayText(formatTime(newCount));
        return newCount;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [autoStart, timerType, formatTime]);

  // ========== 排版计算（共用逻辑） ==========
  const layoutParams = getTextLayoutParams(component, fontFamily);
  const { containerStyle, textBlockStyle } = useTextLayout(layoutParams, style);

  return (
    <div key={component.id} style={containerStyle} {...handlers}>
      <div style={textBlockStyle}>
        <span>{displayText}</span>
      </div>
      {children}
    </div>
  );
};
