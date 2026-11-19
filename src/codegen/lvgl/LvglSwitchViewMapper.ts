/**
 * Maps HML switchView animation styles to LVGL lv_screen_load_anim_t values.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LVGL v9.4 可用动画类型及行为（来源: lv_display.c）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   类型                    | 旧屏行为              | 新屏行为              | 说明
 *   ───────────────────────┼──────────────────────┼──────────────────────┼──────────────
 *   NONE                   | 直接替换              | 直接显示              | 无动画
 *   MOVE_LEFT              | → 向左滑出 (0→-W)    | ← 从右滑入 (+W→0)   | 双屏同时左移
 *   MOVE_RIGHT             | ← 向右滑出 (0→+W)   | → 从左滑入 (-W→0)    | 双屏同时右移
 *   MOVE_TOP               | ↑ 向上滑出 (0→-H)   | ↓ 从下滑入 (+H→0)    | 双屏同时上移
 *   MOVE_BOTTOM            | ↓ 向下滑出 (0→+H)   | ↑ 从上滑入 (-H→0)    | 双屏同时下移
 *   OVER_LEFT              | 静止不动              | ← 从右滑入覆盖 (+W→0)| 新屏覆盖旧屏
 *   OVER_RIGHT             | 静止不动              | → 从左滑入覆盖 (-W→0) | 新屏覆盖旧屏
 *   OVER_TOP               | 静止不动              | ↑ 从下滑入覆盖 (+H→0) | 新屏覆盖旧屏
 *   OVER_BOTTOM            | 静止不动              | ↓ 从上滑入覆盖 (-H→0) | 新屏覆盖旧屏
 *   OUT_LEFT               | → 向左滑出 (0→-W)    | 静止不动              | 旧屏滑走露出新屏
 *   OUT_RIGHT              | ← 向右滑出 (0→+W)   | 静止不动              | 旧屏滑走露出新屏
 *   OUT_TOP                | ↑ 向上滑出 (0→-H)   | 静止不动              | 旧屏滑走露出新屏
 *   OUT_BOTTOM             | ↓ 向下滑出 (0→+H)   | 静止不动              | 旧屏滑走露出新屏
 *   FADE_IN                | 静止不动              | 淡入 (0→255)         | 新屏渐显
 *   FADE_OUT               | 淡出 (255→0)         | 静止不动              | 旧屏渐隐
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HML switchOut × switchIn 组合 → LVGL 映射对照表
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 【双屏同时移动】switchOut=平移 + switchIn=平移（Translation 系列）
 *   退出:向左平移 + 进入:向左平移  → MOVE_LEFT    (双屏一起向左)
 *   退出:向右平移 + 进入:向右平移  → MOVE_RIGHT   (双屏一起向右)
 *   退出:向上平移 + 进入:向上平移  → MOVE_TOP     (双屏一起向上)
 *   退出:向下平移 + 进入:向下平移  → MOVE_BOTTOM  (双屏一起向下)
 *
 * 【旧屏静止，新屏滑入覆盖】switchOut=静止 + switchIn=动画移入
 *   退出:静止 + 进入:Anim Move From Right  → OVER_LEFT   (新屏从右覆盖)
 *   退出:静止 + 进入:Anim Move From Left   → OVER_RIGHT  (新屏从左覆盖)
 *   退出:静止 + 进入:从下平移              → OVER_TOP    (新屏从下覆盖)
 *   退出:静止 + 进入:从上平移              → OVER_BOTTOM (新屏从上覆盖)
 *
 * 【旧屏滑出，新屏静止】switchOut=平移 + switchIn=静止/无动画
 *   退出:向左平移 + 进入:静止  → OUT_LEFT    (旧屏向左滑走)
 *   退出:向右平移 + 进入:静止  → OUT_RIGHT   (旧屏向右滑走)
 *   退出:向上平移 + 进入:静止  → OUT_TOP     (旧屏向上滑走)
 *   退出:向下平移 + 进入:静止  → OUT_BOTTOM  (旧屏向下滑走)
 *
 * 【淡入淡出】
 *   退出:淡出     + 进入:任意  → FADE_OUT    (旧屏渐隐)
 *   退出:任意     + 进入:淡入  → FADE_IN     (新屏渐显)
 *
 * 【无动画】
 *   退出:静止/无  + 进入:静止/无  → NONE
 *
 * 【无法映射的 HoneyGUI 特有效果】→ 降级为最接近的 LVGL 动画
 *   Cube (立方体旋转)     → 降级为对应方向的 MOVE
 *   Rotate (旋转)         → 降级为对应方向的 MOVE
 *   Reduction (缩放)      → 降级为对应方向的 MOVE
 *   Blur (模糊)           → 降级为 FADE
 *   Zoom (缩放进入)       → 降级为 FADE_IN
 *   Bounce (弹跳)         → 降级为 OVER
 *   Move Fade (移动淡入)  → 降级为 FADE_IN
 *   Center Zoom Fade      → 降级为 FADE_IN
 *
 * 【设计器自定义转场】预设同时编排旧页、新页，忽略 switchOut
 *   纵深缩放 SWITCH_IN_DEPTH_ZOOM     → FADE_IN
 *   底部弹层 SWITCH_IN_SHEET_UP       → OVER_TOP（新屏从下覆盖）
 *   圆形揭示 SWITCH_IN_CIRCLE_REVEAL  → FADE_IN
 */
import { readViewTransition, ViewTransitionPreset } from '../../shared/viewTransition';

/** Default animation duration in ms */
const DEFAULT_ANIM_DURATION = 300;

/**
 * Combined mapping: resolve from (switchOut, switchIn) pair.
 *
 * Strategy:
 *   1. If switchIn is "静止/无动画" → use OUT_* based on switchOut direction (旧屏滑走)
 *   2. If switchOut is "静止/无动画" → use OVER_* or FADE_IN based on switchIn (新屏覆盖)
 *   3. If both are Translation → use MOVE_* based on switchOut direction (双屏同时移动)
 *   4. Fade takes priority when explicitly set
 *   5. Fallback: switchOut direction → MOVE_*
 */

/** switchOut 静止/无动画的值 */
const SWITCH_OUT_STILL = new Set([
  'SWITCH_INIT_STATE',
  'SWITCH_OUT_NONE_ANIMATION',
]);

/** switchIn 静止/无动画的值 */
const SWITCH_IN_STILL = new Set([
  'SWITCH_INIT_STATE',
  'SWITCH_IN_NONE_ANIMATION',
]);

/** switchOut Translation 方向 → MOVE_* (双屏同时移动) */
const OUT_TRANSLATION_TO_MOVE: Record<string, string> = {
  'SWITCH_OUT_TO_LEFT_USE_TRANSLATION': 'LV_SCREEN_LOAD_ANIM_MOVE_LEFT',
  'SWITCH_OUT_TO_RIGHT_USE_TRANSLATION': 'LV_SCREEN_LOAD_ANIM_MOVE_RIGHT',
  'SWITCH_OUT_TO_TOP_USE_TRANSLATION': 'LV_SCREEN_LOAD_ANIM_MOVE_TOP',
  'SWITCH_OUT_TO_BOTTOM_USE_TRANSLATION': 'LV_SCREEN_LOAD_ANIM_MOVE_BOTTOM',
};

/** switchOut Translation 方向 → OUT_* (旧屏滑走，新屏静止) */
const OUT_TRANSLATION_TO_OUT: Record<string, string> = {
  'SWITCH_OUT_TO_LEFT_USE_TRANSLATION': 'LV_SCREEN_LOAD_ANIM_OUT_LEFT',
  'SWITCH_OUT_TO_RIGHT_USE_TRANSLATION': 'LV_SCREEN_LOAD_ANIM_OUT_RIGHT',
  'SWITCH_OUT_TO_TOP_USE_TRANSLATION': 'LV_SCREEN_LOAD_ANIM_OUT_TOP',
  'SWITCH_OUT_TO_BOTTOM_USE_TRANSLATION': 'LV_SCREEN_LOAD_ANIM_OUT_BOTTOM',
};

/** switchIn → OVER_* (旧屏静止，新屏覆盖) */
const IN_TO_OVER: Record<string, string> = {
  'SWITCH_IN_FROM_LEFT_USE_TRANSLATION': 'LV_SCREEN_LOAD_ANIM_OVER_RIGHT',
  'SWITCH_IN_FROM_RIGHT_USE_TRANSLATION': 'LV_SCREEN_LOAD_ANIM_OVER_LEFT',
  'SWITCH_IN_FROM_TOP_USE_TRANSLATION': 'LV_SCREEN_LOAD_ANIM_OVER_BOTTOM',
  'SWITCH_IN_FROM_BOTTOM_USE_TRANSLATION': 'LV_SCREEN_LOAD_ANIM_OVER_TOP',
  'SWITCH_IN_ANIMATION_MOVE_FROM_RIGHT': 'LV_SCREEN_LOAD_ANIM_OVER_LEFT',
  'SWITCH_IN_ANIMATION_MOVE_FROM_LEFT': 'LV_SCREEN_LOAD_ANIM_OVER_RIGHT',
};

/** HoneyGUI 特有效果 → 降级映射 */
const OUT_FALLBACK: Record<string, string> = {
  // Cube → 降级为 MOVE
  'SWITCH_OUT_TO_LEFT_USE_CUBE': 'LV_SCREEN_LOAD_ANIM_MOVE_LEFT',
  'SWITCH_OUT_TO_RIGHT_USE_CUBE': 'LV_SCREEN_LOAD_ANIM_MOVE_RIGHT',
  'SWITCH_OUT_TO_TOP_USE_CUBE': 'LV_SCREEN_LOAD_ANIM_MOVE_TOP',
  'SWITCH_OUT_TO_BOTTOM_USE_CUBE': 'LV_SCREEN_LOAD_ANIM_MOVE_BOTTOM',
  // Rotate → 降级为 MOVE
  'SWITCH_OUT_TO_LEFT_USE_ROTATE': 'LV_SCREEN_LOAD_ANIM_MOVE_LEFT',
  'SWITCH_OUT_TO_RIGHT_USE_ROTATE': 'LV_SCREEN_LOAD_ANIM_MOVE_RIGHT',
  'SWITCH_OUT_TO_TOP_USE_ROTATE': 'LV_SCREEN_LOAD_ANIM_MOVE_TOP',
  'SWITCH_OUT_TO_BOTTOM_USE_ROTATE': 'LV_SCREEN_LOAD_ANIM_MOVE_BOTTOM',
  // Reduction → 降级为 MOVE
  'SWITCH_OUT_TO_LEFT_USE_REDUCTION': 'LV_SCREEN_LOAD_ANIM_MOVE_LEFT',
  'SWITCH_OUT_TO_RIGHT_USE_REDUCTION': 'LV_SCREEN_LOAD_ANIM_MOVE_RIGHT',
  'SWITCH_OUT_TO_TOP_USE_REDUCTION': 'LV_SCREEN_LOAD_ANIM_MOVE_TOP',
  'SWITCH_OUT_TO_BOTTOM_USE_REDUCTION': 'LV_SCREEN_LOAD_ANIM_MOVE_BOTTOM',
  // Blur → 降级为 FADE_OUT
  'SWITCH_OUT_STILL_USE_BLUR': 'LV_SCREEN_LOAD_ANIM_FADE_OUT',
  // Fade
  'SWITCH_OUT_ANIMATION_FADE': 'LV_SCREEN_LOAD_ANIM_FADE_OUT',
};

const IN_FALLBACK: Record<string, string> = {
  // Cube → 降级为 OVER
  'SWITCH_IN_FROM_LEFT_USE_CUBE': 'LV_SCREEN_LOAD_ANIM_OVER_RIGHT',
  'SWITCH_IN_FROM_RIGHT_USE_CUBE': 'LV_SCREEN_LOAD_ANIM_OVER_LEFT',
  'SWITCH_IN_FROM_TOP_USE_CUBE': 'LV_SCREEN_LOAD_ANIM_OVER_BOTTOM',
  'SWITCH_IN_FROM_BOTTOM_USE_CUBE': 'LV_SCREEN_LOAD_ANIM_OVER_TOP',
  // Rotate → 降级为 OVER
  'SWITCH_IN_FROM_LEFT_USE_ROTATE': 'LV_SCREEN_LOAD_ANIM_OVER_RIGHT',
  'SWITCH_IN_FROM_RIGHT_USE_ROTATE': 'LV_SCREEN_LOAD_ANIM_OVER_LEFT',
  'SWITCH_IN_FROM_TOP_USE_ROTATE': 'LV_SCREEN_LOAD_ANIM_OVER_BOTTOM',
  'SWITCH_IN_FROM_BOTTOM_USE_ROTATE': 'LV_SCREEN_LOAD_ANIM_OVER_TOP',
  // Reduction → 降级为 OVER
  'SWITCH_IN_FROM_LEFT_USE_REDUCTION': 'LV_SCREEN_LOAD_ANIM_OVER_RIGHT',
  'SWITCH_IN_FROM_RIGHT_USE_REDUCTION': 'LV_SCREEN_LOAD_ANIM_OVER_LEFT',
  'SWITCH_IN_FROM_TOP_USE_REDUCTION': 'LV_SCREEN_LOAD_ANIM_OVER_BOTTOM',
  'SWITCH_IN_FROM_BOTTOM_USE_REDUCTION': 'LV_SCREEN_LOAD_ANIM_OVER_TOP',
  // Blur → 降级为 FADE_IN
  'SWITCH_IN_STILL_USE_BLUR': 'LV_SCREEN_LOAD_ANIM_FADE_IN',
  // Fade / Zoom / Bounce / Move Fade → 降级为 FADE_IN
  'SWITCH_IN_ANIMATION_FADE': 'LV_SCREEN_LOAD_ANIM_FADE_IN',
  'SWITCH_IN_ANIMATION_ZOOM': 'LV_SCREEN_LOAD_ANIM_FADE_IN',
  'SWITCH_IN_ANIMATION_MOVE_FADE': 'LV_SCREEN_LOAD_ANIM_FADE_IN',
  'SWITCH_IN_ANIMATION_BOUNCE_FROM_RIGHT': 'LV_SCREEN_LOAD_ANIM_OVER_LEFT',
  'SWITCH_IN_ANIMATION_ZOOM_FROM_TOP_LEFT': 'LV_SCREEN_LOAD_ANIM_FADE_IN',
  'SWITCH_IN_ANIMATION_ZOOM_FROM_TOP_RIGHT': 'LV_SCREEN_LOAD_ANIM_FADE_IN',
  'SWITCH_IN_CENTER_ZOOM_FADE': 'LV_SCREEN_LOAD_ANIM_FADE_IN',
};

/** 设计器自定义转场：旧页的动作由预设决定，switchOut 不参与 */
const IN_PRESET: Record<ViewTransitionPreset, string> = {
  'SWITCH_IN_DEPTH_ZOOM': 'LV_SCREEN_LOAD_ANIM_FADE_IN',
  'SWITCH_IN_SHEET_UP': 'LV_SCREEN_LOAD_ANIM_OVER_TOP',
  'SWITCH_IN_CIRCLE_REVEAL': 'LV_SCREEN_LOAD_ANIM_FADE_IN',
};

/**
 * Resolve LVGL animation type from HML switchOut/switchIn pair.
 */
export function resolveLvglScreenAnim(switchInStyle?: string, switchOutStyle?: string): string {
  const preset = readViewTransition(switchInStyle);
  if (preset) {
    return IN_PRESET[preset];
  }

  const outStill = !switchOutStyle || SWITCH_OUT_STILL.has(switchOutStyle);
  const inStill = !switchInStyle || SWITCH_IN_STILL.has(switchInStyle);

  // Case 1: 双方都静止 → 无动画
  if (outStill && inStill) {
    return 'LV_SCREEN_LOAD_ANIM_NONE';
  }

  // Case 2: 退出静止 + 进入有动画 → 新屏覆盖旧屏 (OVER_* / FADE_IN)
  if (outStill && switchInStyle) {
    return IN_TO_OVER[switchInStyle] || IN_FALLBACK[switchInStyle] || 'LV_SCREEN_LOAD_ANIM_FADE_IN';
  }

  // Case 3: 退出有动画 + 进入静止 → 旧屏滑走 (OUT_* / FADE_OUT)
  if (inStill && switchOutStyle) {
    return OUT_TRANSLATION_TO_OUT[switchOutStyle] || OUT_FALLBACK[switchOutStyle] || 'LV_SCREEN_LOAD_ANIM_FADE_OUT';
  }

  // Case 4: 退出淡出 → FADE_OUT
  if (switchOutStyle === 'SWITCH_OUT_ANIMATION_FADE') {
    return 'LV_SCREEN_LOAD_ANIM_FADE_OUT';
  }

  // Case 5: 进入淡入 → FADE_IN
  if (switchInStyle === 'SWITCH_IN_ANIMATION_FADE') {
    return 'LV_SCREEN_LOAD_ANIM_FADE_IN';
  }

  // Case 6: 双方都有动画 → 以退出方向为准，双屏同时移动 (MOVE_*)
  if (switchOutStyle && OUT_TRANSLATION_TO_MOVE[switchOutStyle]) {
    return OUT_TRANSLATION_TO_MOVE[switchOutStyle];
  }

  // Case 7: 退出是特效 → 降级
  if (switchOutStyle && OUT_FALLBACK[switchOutStyle]) {
    return OUT_FALLBACK[switchOutStyle];
  }

  // Case 8: 进入是特效 → 降级
  if (switchInStyle && IN_FALLBACK[switchInStyle]) {
    return IN_FALLBACK[switchInStyle];
  }

  return 'LV_SCREEN_LOAD_ANIM_MOVE_LEFT';
}

/**
 * Generate lv_screen_load_anim() call for a switchView action.
 */
export function generateSwitchViewCode(
  targetViewId: string,
  switchInStyle?: string,
  switchOutStyle?: string,
  indent: string = '            '
): string {
  const animType = resolveLvglScreenAnim(switchInStyle, switchOutStyle);
  return `${indent}lv_screen_load_anim(${targetViewId}, ${animType}, ${DEFAULT_ANIM_DURATION}, 0, false);\n`;
}
