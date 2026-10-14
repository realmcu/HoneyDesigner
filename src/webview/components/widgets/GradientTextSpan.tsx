import React from 'react';
import { Component } from '../../types';
import { useTextGradient } from '../../hooks/useTextGradient';

interface GradientTextSpanProps {
  component: Component;
  text: string;
  fontFamily: string | undefined;
  fontSize: number;
  layoutKey: string;
  /** 作为渐变 WIDGET 框的包裹元素样式（对应设备上的一个 gui_text 控件） */
  style: React.CSSProperties;
}

/**
 * 单段带渐变预览的文本，用于一个组件在设备上拆成多个 gui_text 的场景（如分拆时间）
 */
export const GradientTextSpan: React.FC<GradientTextSpanProps> = ({ component, text, fontFamily, fontSize, layoutKey, style }) => {
  const gradient = useTextGradient(component, { text, fontFamily, fontSize, layoutKey });
  return (
    <div ref={gradient.containerRef} style={style}>
      <span ref={gradient.textRef} style={gradient.textStyle}>{text}</span>
    </div>
  );
};
