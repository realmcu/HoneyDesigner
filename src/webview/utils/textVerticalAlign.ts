// 不能引入 React 或其他 webview 运行时模块：jest 测试会经 tsc 把本文件编进 out/ 并随插件打包。

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
