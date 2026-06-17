/**
 * View 页面复杂度计算模块
 * 
 * 本模块用于统计每个 hg_view 页面的绘制复杂度，包含两个核心指标：
 * 
 * ═══════════════════════════════════════════════════════════════════
 * 一、绘制覆盖率 (Draw Coverage)
 * ═══════════════════════════════════════════════════════════════════
 * 
 * 公式：覆盖率 = Σ(每个后代控件的像素面积) / (view.width × view.height)
 * 
 * 像素面积计算规则（按控件类型）：
 * 
 * 嵌入式 GUI 引擎本质上只有三种绘制操作：
 *   1. 图像（blit）：hg_image, hg_gif, hg_button(有图), hg_video, hg_svg, hg_lottie, hg_3d
 *   2. 文字（font rasterize）：hg_label, hg_time_label, hg_timer_label, hg_button(无图), checkbox/radio 文本
 *   3. 绘制（fill/stroke）：hg_rect, hg_circle, hg_arc, hg_glass, hg_particle
 * 容器类控件本身不直接产生绘制像素，只组织子控件布局。
 * 
 * | 控件类型                          | 像素面积公式                                    | 说明                         |
 * |----------------------------------|------------------------------------------------|------------------------------|
 * | --- 容器类（不产生绘制像素） ---   |                                                |                              |
 * | hg_view                          | 0（不计入）                                     | 被统计的容器本身              |
 * | hg_window (showBackground=true)  | w × h                                          | 有背景渲染（唯一例外）        |
 * | hg_window (showBackground=false) | 0                                              | 透明容器不产生绘制             |
 * | hg_canvas                        | 0                                              | 纯容器，不产生绘制像素         |
 * | hg_list                          | 0                                              | 纯容器，不产生绘制像素         |
 * | hg_list_item                     | 0                                              | 纯容器，不产生绘制像素         |
 * | hg_menu_cellular                 | 0                                              | 容器，子图标由子控件贡献       |
 * | --- 绘制类（fill/stroke） ---     |                                                |                              |
 * | hg_rect                          | w × h                                          | 矩形填满 bbox                |
 * | hg_circle                        | π × radius²                                   | 按实际圆形面积                |
 * | hg_arc                           | radius × angleSpan(rad) × strokeWidth          | 按弧线实际笔画面积            |
 * | hg_glass                         | w × h                                          | 玻璃效果处理整个区域           |
 * | hg_particle                      | particleCount × π × avgRadius²                 | 按实际粒子面积精算（见下方）   |
 * | --- 图像类（blit） ---            |                                                |                              |
 * | hg_image                         | w × h                                          | 图片 blit 整个 bbox           |
 * | hg_gif                           | w × h                                          | 同图片                       |
 * | hg_svg                           | w × h                                          | 矢量渲染整个 bbox             |
 * | hg_lottie                        | w × h                                          | 动画渲染整个 bbox             |
 * | hg_video                         | w × h                                          | 视频帧填满 bbox               |
 * | hg_3d                            | w × h                                          | WebGL 渲染整个 canvas         |
 * | hg_button (有图片)               | w × h                                          | 图片模式按图片算              |
 * | --- 文字类（font rasterize） ---  |                                                |                              |
 * | hg_label                         | 文本精算（见下方）                               | 按实际文本内容估算            |
 * | hg_time_label                    | 文本精算                                        | 同 label                     |
 * | hg_timer_label                   | 文本精算                                        | 同 label                     |
 * | hg_button (无图片)               | 文本精算                                        | 按文本估算                    |
 * | hg_checkbox                      | 20 × 20 + 文本面积                              | 勾选框 + 文本                |
 * | hg_radio                         | 20 × 20 + 文本面积                              | 圆点 + 文本                  |
 * | --- 输入类 ---                    |                                                |                              |
 * | hg_input                         | w × h                                          | 输入框有背景边框              |
 * | hg_textarea                      | w × h                                          | 同输入框                     |
 * | hg_switch                        | w × h                                          | 轨道 + 滑块占满              |
 * | hg_slider                        | w × h                                          | 轨道占满宽度                  |
 *
 * 文本精算公式：
 *   面积 = Σ(每个可见字符的面积)
 *   CJK 字符面积 = fontSize × fontSize
 *   ASCII 字符面积 = fontSize × fontSize × 0.6
 *   不可见字符（换行、空格、制表符）不计入
 *   最终乘以 0.7 填充系数（字符笔画未占满 fontSize 格子）
 *   空文本: 面积 = 0
 * 
 * 粒子精算公式：
 *   面积 = particleCount × π × ((sizeMin + sizeMax) / 4)²
 *   其中 (sizeMin + sizeMax) / 4 是平均半径
 *   如果有 secondaryLayer，再加上第二层的面积
 *   粒子配置从 PARTICLE_EFFECT_MAP 中按 effectType 查找
 *   找不到配置时回退到 w × h
 * 
 * 通用规则：
 *   - visible = false → 面积 = 0
 *   - opacity = 0 → 面积 = 0
 *   - 重叠区域不去重（重叠 = 重复绘制）
 * 
 * ═══════════════════════════════════════════════════════════════════
 * 二、渲染开销系数 (Render Cost)
 * ═══════════════════════════════════════════════════════════════════
 * 
 * 每种控件/渲染方式有不同的单像素渲染开销系数：
 * 
 * | 控件/渲染方式                     | 基础系数 | 理由                              |
 * |----------------------------------|---------|-----------------------------------|
 * | hg_image                         | 1.0     | 基准，直接 blit                    |
 * | hg_rect（纯色矩形）              | 2.0     | 逐像素填充 + 可能有圆角            |
 * | hg_circle                        | 2.5     | 圆形裁剪 + 抗锯齿                  |
 * | hg_arc                           | 3.0     | 三角函数计算 + 抗锯齿 + 可能有渐变  |
 * | hg_image + 变换（旋转/缩放）      | 2.0     | 矩阵变换 + 双线性插值              |
 * | hg_image + 透明混合               | 1.5     | alpha blending                    |
 * | hg_label（点阵字体）              | 2.0     | 点阵查表 + alpha 混合              |
 * | hg_label（矢量字体）              | 4.0     | 矢量光栅化 + 抗锯齿                |
 * | hg_svg                           | 5.0     | 矢量解析 + 路径填充                |
 * | hg_lottie                        | 6.0     | 逐帧矢量动画                      |
 * | hg_gif                           | 1.5     | 多帧解码 + blit                   |
 * | hg_3d                            | 10.0    | 顶点变换 + 光照 + 纹理             |
 * | hg_glass                         | 8.0     | 背景采样 + 折射计算                |
 * | hg_particle                      | 7.0     | 大量粒子逐个渲染                   |
 * | hg_video                         | 2.0     | 解码 + blit                       |
 * | hg_button                        | 1.0     | 同图片或文本                       |
 * | hg_input / hg_textarea           | 2.0     | 背景填充 + 文本                    |
 * | hg_checkbox / hg_radio           | 2.0     | 绘制 + 文本                       |
 * | hg_switch / hg_slider            | 2.0     | 绘制类控件                         |
 * | hg_window                        | 2.0     | 背景填充                          |
 * | hg_canvas                        | 0       | 纯容器，不产生绘制                  |
 * | hg_list / hg_list_item           | 0       | 纯容器，不产生绘制                  |
 * | hg_menu_cellular                 | 0       | 容器，不产生绘制                    |
 *
 * 修正系数（叠加到基础系数上）：
 *   - 文本类矢量字体 (fontType='vector')：基础系数从 2.0 → 4.0
 *   - 有渐变 (useGradient=true)：× 1.5
 *   - 有变换 (rotation/scale != 默认值)：× 2.0
 *   - 有半透明 (0 < opacity < 255)：× 1.3
 * 
 * 最终公式：
 *   页面复杂度 = Σ(控件像素面积) / View面积
 *   渲染开销 = Σ(控件像素面积 × 渲染开销系数) / View面积
 */

import type { Component } from '../types';
import { PARTICLE_EFFECT_MAP } from '../constants/particleEffects';

// ============================================================================
// 渲染开销基础系数表
// ============================================================================

const BASE_RENDER_COST: Record<string, number> = {
  // 图像类（image=1.0 为基准）
  hg_image: 1.0,
  hg_gif: 1.5,
  hg_video: 2.0,
  hg_button: 1.0,
  // 绘制类（rect=2.0 为基准）
  hg_rect: 2.0,
  hg_circle: 2.5,
  hg_arc: 3.0,
  hg_glass: 8.0,
  hg_particle: 7.0,
  // 文字类（点阵=2.0，矢量=4.0，在 calculateRenderCost 中动态判断）
  hg_label: 2.0,
  hg_time_label: 2.0,
  hg_timer_label: 2.0,
  // 矢量/动画类
  hg_svg: 5.0,
  hg_lottie: 6.0,
  hg_3d: 10.0,
  // 输入类（有背景填充 + 文本）
  hg_input: 2.0,
  hg_textarea: 2.0,
  hg_checkbox: 2.0,
  hg_radio: 2.0,
  hg_switch: 2.0,
  hg_slider: 2.0,
  // 容器类（面积为 0，系数不影响结果）
  hg_view: 0,
  hg_window: 2.0,
  hg_canvas: 0,
  hg_list: 0,
  hg_list_item: 0,
  hg_menu_cellular: 0,
};

// ============================================================================
// 文本像素面积估算
// ============================================================================

/**
 * 判断字符是否为 CJK（中日韩）字符
 */
function isCJK(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 0x4E00 && code <= 0x9FFF) ||   // CJK 统一汉字
    (code >= 0x3400 && code <= 0x4DBF) ||   // CJK 扩展 A
    (code >= 0x3000 && code <= 0x303F) ||   // CJK 符号和标点
    (code >= 0xFF00 && code <= 0xFFEF) ||   // 全角字符
    (code >= 0x3040 && code <= 0x309F) ||   // 平假名
    (code >= 0x30A0 && code <= 0x30FF)      // 片假名
  );
}

/**
 * 估算文本的实际绘制像素面积
 * 简单直接：可见字符数 × 单字面积
 */
function estimateTextPixelArea(component: Component): number {
  const text = component.data?.text || '';
  if (!text) return 0;

  const fontSize = component.style?.fontSize || component.data?.fontSize || 16;

  let totalArea = 0;
  for (const char of text) {
    if (char === '\n' || char === '\r' || char === '\t') continue;
    totalArea += isCJK(char) ? fontSize * fontSize : fontSize * fontSize * 0.6;
  }

  // 字符笔画并未占满 fontSize 格子，乘以 0.7 的填充系数
  return totalArea * 0.7;
}

// ============================================================================
// 控件像素面积计算
// ============================================================================

/**
 * 计算单个控件的像素面积
 */
function calculateComponentPixelArea(component: Component): number {
  // 通用规则：不可见或完全透明的控件不计入
  if (!component.visible) return 0;
  const opacity = component.style?.opacity ?? component.data?.opacity;
  if (opacity === 0) return 0;

  const w = component.position.width;
  const h = component.position.height;
  const type = component.type;

  switch (type) {
    // ---- 被统计的容器本身，不计入 ----
    case 'hg_view':
      return 0;

    // ---- 纯容器类，不产生绘制像素 ----
    case 'hg_canvas':
    case 'hg_list':
    case 'hg_list_item':
    case 'hg_menu_cellular':
      return 0;

    // ---- 窗口容器：看是否有背景（唯一例外） ----
    case 'hg_window': {
      const showBg = component.data?.showBackground;
      return (showBg === false || showBg === 'false') ? 0 : w * h;
    }

    // ---- 粒子效果：按实际粒子面积精算 ----
    case 'hg_particle': {
      const effectType = (component.data?.effectType as string) || 'snow';
      const config = PARTICLE_EFFECT_MAP.get(effectType);
      if (!config) return w * h; // 找不到配置，回退到 bbox

      const calcLayerArea = (count: number, sizeMin: number, sizeMax: number) => {
        const avgRadius = (sizeMin + sizeMax) / 4;
        return count * Math.PI * avgRadius * avgRadius;
      };

      let area = calcLayerArea(
        config.particleCount,
        config.visual.sizeMin,
        config.visual.sizeMax
      );

      // 加上第二层粒子（如 rocket 的烟雾层）
      if (config.secondaryLayer) {
        area += calcLayerArea(
          config.secondaryLayer.particleCount,
          config.secondaryLayer.visual.sizeMin,
          config.secondaryLayer.visual.sizeMax
        );
      }

      return area;
    }

    // ---- 圆形：π × radius² ----
    case 'hg_circle': {
      const radius = component.style?.radius ?? 40;
      return Math.PI * radius * radius;
    }

    // ---- 圆弧：弧长 × 笔画宽度 ----
    case 'hg_arc': {
      const radius = component.style?.radius ?? 40;
      const startAngle = component.style?.startAngle ?? 0;
      const endAngle = component.style?.endAngle ?? 270;
      const strokeWidth = component.style?.strokeWidth ?? 8;
      let angleSpan = endAngle - startAngle;
      if (angleSpan <= 0) angleSpan += 360;
      const angleRad = (angleSpan / 180) * Math.PI;
      return radius * angleRad * strokeWidth;
    }

    // ---- 文本类控件：精算 ----
    case 'hg_label':
    case 'hg_time_label':
    case 'hg_timer_label':
      return estimateTextPixelArea(component);

    // ---- 按钮：有图片按 bbox，无图片按文本 ----
    case 'hg_button': {
      const hasImage = !!(component.data?.imageOn || component.data?.imageOff);
      return hasImage ? w * h : estimateTextPixelArea(component);
    }

    // ---- 复选框/单选框：小方块 + 文本 ----
    case 'hg_checkbox':
    case 'hg_radio': {
      const controlArea = 20 * 20;
      const textArea = estimateTextPixelArea(component);
      return controlArea + textArea;
    }

    // ---- 其他所有控件：w × h ----
    default:
      return w * h;
  }
}

// ============================================================================
// 渲染开销系数计算
// ============================================================================

/**
 * 计算单个控件的渲染开销系数（含修正）
 */
function calculateRenderCost(component: Component): number {
  const type = component.type;
  let cost = BASE_RENDER_COST[type] ?? 1.0;

  const style = component.style || {};
  const data = component.data || {};

  // 文本类控件：矢量字体开销翻倍（点阵=2.0，矢量=4.0）
  const textTypes = ['hg_label', 'hg_time_label', 'hg_timer_label'];
  if (textTypes.includes(type)) {
    const fontType = data.fontType || 'bitmap';
    if (fontType === 'vector') {
      cost = 4.0;
    }
  }

  // 修正：有渐变
  if (style.useGradient === true) {
    cost *= 1.5;
  }

  // 修正：图片有变换（旋转/缩放）
  if (type === 'hg_image' || type === 'hg_gif') {
    const transform = style.transform;
    if (transform) {
      const hasRotation = transform.rotation && transform.rotation !== 0;
      const hasScale = (transform.scaleX !== undefined && transform.scaleX !== 1) ||
                       (transform.scaleY !== undefined && transform.scaleY !== 1);
      if (hasRotation || hasScale) {
        cost *= 2.0;
      }
    }
    // 也检查 data 中的 transform（字符串格式）
    if (typeof data.transform === 'string') {
      try {
        const t = JSON.parse(data.transform);
        const hasRotation = t.rotation && t.rotation !== 0;
        const hasScale = (t.scaleX !== undefined && t.scaleX !== 1) ||
                         (t.scaleY !== undefined && t.scaleY !== 1);
        if (hasRotation || hasScale) {
          cost *= 2.0;
        }
      } catch { /* ignore parse errors */ }
    }
  }

  // 修正：半透明（0 < opacity < 255）
  const opacity = style.opacity ?? data.opacity;
  if (opacity !== undefined && opacity > 0 && opacity < 255) {
    cost *= 1.3;
  }

  return cost;
}

// ============================================================================
// 公开接口
// ============================================================================

/**
 * View 复杂度统计结果
 */
export interface ViewComplexityResult {
  /** 子控件数量 */
  childCount: number;
  /** View 尺寸 */
  viewWidth: number;
  viewHeight: number;
  /** View 面积 */
  viewArea: number;
  /** 所有子控件的像素面积总和 */
  totalPixelArea: number;
  /** 绘制覆盖率 = totalPixelArea / viewArea */
  drawCoverage: number;
  /** 加权渲染开销总和 */
  totalRenderCost: number;
  /** 页面复杂度 = totalRenderCost / viewArea */
  complexity: number;
}

/**
 * 获取一个 view 的所有后代控件（不包含 view 自身）
 */
function getDescendants(viewComponent: Component, allComponents: Component[]): Component[] {
  const descendants: Component[] = [];

  function collect(parentId: string) {
    for (const comp of allComponents) {
      if (comp.parent === parentId) {
        descendants.push(comp);
        // 递归收集子控件的后代
        if (comp.children && comp.children.length > 0) {
          collect(comp.id);
        }
      }
    }
  }

  collect(viewComponent.id);
  return descendants;
}

/**
 * 计算指定 hg_view 的页面复杂度
 * 
 * @param viewComponent - 目标 hg_view 组件
 * @param allComponents - 所有组件列表
 * @returns 复杂度统计结果
 */
export function calculateViewComplexity(
  viewComponent: Component,
  allComponents: Component[]
): ViewComplexityResult {
  const viewWidth = viewComponent.position.width;
  const viewHeight = viewComponent.position.height;
  const viewArea = viewWidth * viewHeight;

  const descendants = getDescendants(viewComponent, allComponents);

  let totalPixelArea = 0;
  let totalRenderCost = 0;

  for (const comp of descendants) {
    const pixelArea = calculateComponentPixelArea(comp);
    const renderCost = calculateRenderCost(comp);

    totalPixelArea += pixelArea;
    totalRenderCost += pixelArea * renderCost;
  }

  return {
    childCount: descendants.length,
    viewWidth,
    viewHeight,
    viewArea,
    totalPixelArea,
    drawCoverage: viewArea > 0 ? totalPixelArea / viewArea : 0,
    totalRenderCost,
    complexity: viewArea > 0 ? totalRenderCost / viewArea : 0,
  };
}
