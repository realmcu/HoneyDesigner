import React from 'react';
import { Component } from '../types';
import { useTypoLineHeight } from './useFontMetrics';

/**
 * 文本排版参数
 */
export interface TextLayoutParams {
  /** 字体文件路径（如 /NotoSansSC_Regular.ttf） */
  fontPath: string | undefined;
  /** 字体族名（来自 useFontLoader） */
  fontFamily: string | undefined;
  /** 字号 */
  fontSize: number;
  /** 额外行间距（像素） */
  lineSpacing: number;
  /** 额外字间距（像素） */
  letterSpacing: number;
  /** 字体颜色 */
  color: string;
  /** 横向对齐 */
  hAlign: string;
  /** 纵向对齐 */
  vAlign: string;
  /** 是否换行 */
  wordWrap: boolean;
  /** 是否按词断行 */
  wordBreak: boolean;
}

/**
 * 文本排版计算结果
 */
export interface TextLayoutResult {
  /** 行高（像素），= typoLineHeight + lineSpacing */
  lineHeight: number;
  /** CSS line-height 值 */
  cssLineHeight: string;
  /** 外层容器样式（定位 + 裁剪 + 纵向对齐） */
  containerStyle: React.CSSProperties;
  /** 内层文本块样式（排版属性） */
  textBlockStyle: React.CSSProperties;
}

/**
 * 从组件属性中提取文本排版参数
 */
export function getTextLayoutParams(component: Component, fontFamily: string | undefined): TextLayoutParams {
  return {
    fontPath: component.data?.fontFile,
    fontFamily,
    fontSize: Number(component.data?.fontSize) || 16,
    lineSpacing: Number(component.style?.lineSpacing) || 0,
    letterSpacing: Number(component.style?.letterSpacing) || 0,
    color: component.style?.color || '#ffffff',
    hAlign: component.style?.hAlign || 'LEFT',
    vAlign: component.style?.vAlign || 'TOP',
    wordWrap: component.style?.wordWrap || false,
    wordBreak: component.style?.wordBreak || false,
  };
}

/** 纵向对齐：单行偏移量（像素，可为负），以及多行的 flex 对齐方式 */
export interface VerticalAlignment {
  /** 单行时文本块相对容器顶部的偏移；负值让内容溢出到容器上方，由 overflow 裁掉顶部 */
  singleLineOffset: number;
  /** 多行时是否用 flex 纵向对齐 */
  useFlex: boolean;
  /** 多行时的 flex justify-content 值 */
  flexJustify: 'center' | 'flex-end' | undefined;
}

/**
 * 计算纵向对齐方式，语义与 HoneyGUI font_mem.c 的 offset_y 一致：
 *   offset_y = (rect_h - char_height_sum) * align_y / 2，align_y 为 0/1/2。
 * 单行以 lineHeight 为内容高度；多行交给 flex，由浏览器算出真实换行后的块高，
 * BOTTOM 用 flex-end 把末行贴到容器底边，内容超高时顶部同样被 overflow 裁掉。
 */
export function computeVerticalAlignment(
  vAlign: string,
  wordWrap: boolean,
  containerHeight: number,
  lineHeight: number
): VerticalAlignment {
  const isMid = vAlign === 'MID';
  const isBottom = vAlign === 'BOTTOM';

  if (wordWrap) {
    return {
      singleLineOffset: 0,
      useFlex: isMid || isBottom,
      flexJustify: isMid ? 'center' : isBottom ? 'flex-end' : undefined,
    };
  }

  let singleLineOffset = 0;
  if (containerHeight > 0) {
    if (isMid) {
      singleLineOffset = (containerHeight - lineHeight) / 2;
    } else if (isBottom) {
      singleLineOffset = containerHeight - lineHeight;
    }
  }
  return { singleLineOffset, useFlex: false, flexJustify: undefined };
}

/**
 * 文本排版 hook
 *
 * 统一计算文本类控件（hg_label、hg_time_label、hg_timer_label）的排版样式。
 * 排版模型对齐 Figma / HoneyGUI V3：
 *   - 行高 = typo metrics（从字体文件 OS/2 表解析）+ extra_line_spacing
 *   - 纵向对齐：TOP = 顶部，MID = 居中，BOTTOM = 贴底
 *   - 横向对齐：通过 text-align 实现
 *
 * 注意：不使用浏览器 line-height: normal（它用 Win metrics，对 CJK 字体偏大），
 * 而是直接解析字体文件的 sTypoAscender/sTypoDescender/sTypoLineGap 计算行高。
 */
export function useTextLayout(
  params: TextLayoutParams,
  baseStyle: React.CSSProperties | undefined
): TextLayoutResult {
  const { fontPath, fontFamily, fontSize, lineSpacing, letterSpacing, color, hAlign, vAlign, wordWrap, wordBreak } = params;

  // 从字体文件 typo metrics 计算行高（对齐 Figma / V3）
  const typoLineHeight = useTypoLineHeight(fontPath, fontFamily, fontSize);

  // 行高 = typo 基准 + 额外行间距
  const lineHeight = typoLineHeight + lineSpacing;
  const cssLineHeight = `${lineHeight}px`;

  // ========== 纵向对齐逻辑，对齐 Figma / V3 ==========
  //
  // Figma 排版模型：
  //   - 一行文字占据的空间 = lineHeight，文字在行框内上下居中（half-leading）
  //   - TOP：文本块紧贴容器顶部
  //   - MID 单行：(容器高 - lineHeight) / 2
  //   - MID 多行：(容器高 - 行数 × lineHeight) / 2
  //   - BOTTOM：单行贴底，多行把最后一行贴到容器底边，溢出时裁掉顶部
  //
  const containerHeight = typeof baseStyle?.height === 'number' ? baseStyle.height : 0;
  const { singleLineOffset, useFlex, flexJustify } = computeVerticalAlignment(
    vAlign, wordWrap, containerHeight, lineHeight);

  // 外层容器：定位 + 裁剪
  // 多行 MID / BOTTOM 时使用 flex 布局实现纵向对齐
  const containerStyle: React.CSSProperties = {
    ...baseStyle,
    width: baseStyle?.width,
    height: baseStyle?.height,
    display: baseStyle?.display === 'none' ? 'none' : (useFlex ? 'flex' : 'block'),
    flexDirection: useFlex ? 'column' : undefined,
    justifyContent: flexJustify,
    overflow: 'hidden',
    boxSizing: 'border-box',
    position: 'absolute',
  };

  // 内层文本块：排版属性
  const textBlockStyle: React.CSSProperties = {
    fontFamily: fontFamily || 'inherit',
    fontSize,
    color,
    letterSpacing,
    lineHeight: cssLineHeight,
    textAlign: hAlign.toLowerCase() as any,
    wordBreak: wordBreak ? 'keep-all' : 'break-all',
    whiteSpace: wordWrap ? 'pre-wrap' : 'nowrap',
    width: '100%',
    // 负值用于 BOTTOM 溢出：把文本块整体上移，容器 overflow 裁掉顶部
    marginTop: singleLineOffset !== 0 ? `${singleLineOffset}px` : undefined,
  };

  return { lineHeight, cssLineHeight, containerStyle, textBlockStyle };
}
