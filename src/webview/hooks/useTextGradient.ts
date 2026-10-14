import React from 'react';
import { Component } from '../types';
import { useDesignerStore } from '../store';
import {
  GradientRect,
  buildTextGradientCss,
  isVectorTextFont,
  resolveTextGradient,
} from '../../shared/textGradient';

interface TextGradientMeasure {
  /** 参照框，坐标相对于文本 span 的 padding box */
  box: GradientRect;
  width: number;
  height: number;
  /** WIDGET 框相对未平移 span 的偏移，渲染时再减去当前滚动平移 */
  widgetOrigin?: { x: number; y: number };
}

export interface TextGradientOptions {
  text: string;
  fontFamily: string | undefined;
  fontSize: number;
  /** 当前滚动平移（px），WIDGET 框据此保持在控件上不动 */
  translateX?: number;
  translateY?: number;
  /** 影响排版的其余因素（尺寸、对齐、换行、行高、字间距），变化时重新测量 */
  layoutKey: string;
}

export interface TextGradientResult {
  /** 是否启用渐变预览；启用时文本 span 必须是 inline-block */
  active: boolean;
  /** 需挂到控件外层容器（WIDGET 框测量用） */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** 需挂到唯一包含文本节点的 span */
  textRef: React.RefObject<HTMLSpanElement | null>;
  /** 合并到文本 span 的样式 */
  textStyle: React.CSSProperties | undefined;
}

let measureCanvas: HTMLCanvasElement | undefined;

function unionRect(acc: [number, number, number, number] | null, x0: number, y0: number, x1: number, y1: number) {
  if (!acc) {
    return [x0, y0, x1, y1] as [number, number, number, number];
  }
  return [Math.min(acc[0], x0), Math.min(acc[1], y0), Math.max(acc[2], x1), Math.max(acc[3], y1)] as [number, number, number, number];
}

function toRect(r: [number, number, number, number]): GradientRect {
  return { x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1] };
}

/** 每行文字的笔进范围 x 行框高度，对应 GUI_TEXT_GRADIENT_BOX_LAYOUT */
function measureLayoutBox(span: HTMLSpanElement, spanRect: DOMRect, k: number, pad: number): GradientRect | null {
  const range = document.createRange();
  range.selectNodeContents(span);
  let acc: [number, number, number, number] | null = null;
  for (const r of Array.from(range.getClientRects())) {
    if (r.width <= 0) {
      continue;
    }
    const left = (r.left - spanRect.left) / k;
    acc = unionRect(acc, left, 0, left + r.width / k, 0);
  }
  if (!acc) {
    return null;
  }
  // inline-block 的内容高度恰为 行数 x 行高
  const contentHeight = span.offsetHeight - pad * 2;
  return { x: acc[0], y: pad, width: acc[2] - acc[0], height: contentHeight };
}

/** 字形墨迹的并集，对应 GUI_TEXT_GRADIENT_BOX_INK */
function measureInkBox(span: HTMLSpanElement, spanRect: DOMRect, k: number): GradientRect | null {
  const node = span.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) {
    return null;
  }
  measureCanvas = measureCanvas || document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  const cs = getComputedStyle(span);
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;

  const text = node.textContent || '';
  const range = document.createRange();
  let acc: [number, number, number, number] | null = null;
  let offset = 0;
  for (const ch of text) {
    const start = offset;
    offset += ch.length;
    if (/\s/.test(ch)) {
      continue;
    }
    range.setStart(node, start);
    range.setEnd(node, offset);
    const r = Array.from(range.getClientRects()).find((rect) => rect.width > 0);
    if (!r) {
      continue;
    }
    const m = ctx.measureText(ch);
    const inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const inkH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    if (inkW <= 0 || inkH <= 0) {
      continue;
    }
    // 文本片段矩形顶端 = 基线 - 字体 ascent（与 canvas fontBoundingBoxAscent 同源）
    const penX = (r.left - spanRect.left) / k;
    const baseline = (r.top - spanRect.top) / k + m.fontBoundingBoxAscent;
    acc = unionRect(
      acc,
      penX - m.actualBoundingBoxLeft,
      baseline - m.actualBoundingBoxAscent,
      penX + m.actualBoundingBoxRight,
      baseline + m.actualBoundingBoxDescent
    );
  }
  return acc ? toRect(acc) : null;
}

/**
 * 文本渐变填充预览，模拟 HoneyGUI gui_text_set_gradient()。
 *
 * 渐变画在文本 span 的背景上并用 background-clip: text 裁到字形。span 加 pad 内边距、
 * 同量负外边距：不改变排版，但让超出行框的墨迹（负行距、下伸部）不被背景区域裁掉。
 * 与设备一致，只对 HoneyGUI 工程中的矢量字体生效，其余情况保持纯色。
 */
export function useTextGradient(component: Component, options: TextGradientOptions): TextGradientResult {
  const { text, fontFamily, fontSize, translateX = 0, translateY = 0, layoutKey } = options;
  const targetEngine = useDesignerStore((state) => state.projectConfig?.targetEngine || 'honeygui');
  const containerRef = React.useRef<HTMLDivElement>(null);
  const textRef = React.useRef<HTMLSpanElement>(null);
  const translateRef = React.useRef({ x: translateX, y: translateY });
  translateRef.current = { x: translateX, y: translateY };

  const config = React.useMemo(() => {
    if (targetEngine === 'lvgl' || !isVectorTextFont(component.data)) {
      return null;
    }
    return resolveTextGradient(component.style, component.data);
  }, [targetEngine, component.style, component.data]);

  const pad = Math.ceil(fontSize);
  const [measure, setMeasure] = React.useState<TextGradientMeasure | null>(null);

  React.useLayoutEffect(() => {
    const span = textRef.current;
    if (!config || !span) {
      setMeasure(null);
      return;
    }
    const spanRect = span.getBoundingClientRect();
    const k = span.offsetWidth > 0 ? spanRect.width / span.offsetWidth : 0;
    if (!(k > 0)) {
      setMeasure(null);
      return;
    }

    let box: GradientRect | null;
    let widgetOrigin: TextGradientMeasure['widgetOrigin'];
    if (config.box === 'widget') {
      const container = containerRef.current;
      if (!container) {
        setMeasure(null);
        return;
      }
      const cRect = container.getBoundingClientRect();
      const { x: tx, y: ty } = translateRef.current;
      widgetOrigin = {
        x: (cRect.left - spanRect.left) / k + container.clientLeft + tx,
        y: (cRect.top - spanRect.top) / k + container.clientTop + ty,
      };
      box = { x: 0, y: 0, width: container.clientWidth, height: container.clientHeight };
    } else if (config.box === 'ink') {
      box = measureInkBox(span, spanRect, k);
    } else {
      box = measureLayoutBox(span, spanRect, k, pad);
    }

    if (!box) {
      setMeasure(null);
      return;
    }
    const next: TextGradientMeasure = { box, width: span.offsetWidth, height: span.offsetHeight, widgetOrigin };
    setMeasure((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [config, text, fontFamily, fontSize, pad, layoutKey]);

  if (!config) {
    return { active: false, containerRef, textRef, textStyle: undefined };
  }

  const baseStyle: React.CSSProperties = { display: 'inline-block', padding: pad, margin: -pad };
  if (!measure) {
    return { active: true, containerRef, textRef, textStyle: baseStyle };
  }

  const box = measure.widgetOrigin
    ? { ...measure.box, x: measure.widgetOrigin.x - translateX, y: measure.widgetOrigin.y - translateY }
    : measure.box;
  return {
    active: true,
    containerRef,
    textRef,
    textStyle: {
      ...baseStyle,
      backgroundImage: buildTextGradientCss(config, box, measure.width, measure.height),
      backgroundRepeat: 'no-repeat',
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
      WebkitTextFillColor: 'transparent',
    },
  };
}
