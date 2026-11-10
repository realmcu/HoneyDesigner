/**
 * 撤销/重做历史的记录策略
 * 栈本身放在 store state（undoStack/redoStack，元素是 components 快照），
 * 这里只决定「一次 components 变化是开新的一步，还是并入上一步」。
 * 历史只存在于 webview 内存，切换文件时清空；宿主只负责落盘。
 */

import type { Component } from '../types';

export const MAX_HISTORY = 50;

// 连续编辑（输入框逐字输入、按住方向键）间隔小于该值时并为一步（滑动窗口）
const COALESCE_MS = 500;

let suppressDepth = 0;
let lastChangeAt = 0;
let gestureActive = false;
let gestureRecorded = false;

/**
 * 回调内的 components 变化不进入撤销历史（仍会标脏）。
 * 用于派生同步（列表项排布、视频尺寸、分辨率对齐）和撤销/重做自身的回放。
 */
export function withoutHistory<T>(fn: () => T): T {
  suppressDepth++;
  try {
    return fn();
  } finally {
    suppressDepth--;
  }
}

export function isHistorySuppressed(): boolean {
  return suppressDepth > 0;
}

/**
 * 拖拽/缩放开始：整个手势只记一步（手势中途停顿也不拆分）。
 * 松开鼠标时自动结束，在画布外松手也不会让手势一直挂着。
 */
export function beginHistoryGesture(): void {
  if (!gestureActive && typeof window !== 'undefined') {
    window.addEventListener('mouseup', endHistoryGesture, { capture: true, once: true });
  }
  gestureActive = true;
  gestureRecorded = false;
}

export function endHistoryGesture(): void {
  gestureActive = false;
  lastChangeAt = 0;
}

/** 撤销/重做或加载新内容后调用：下一次编辑必定开新的一步 */
export function resetHistoryCoalescing(): void {
  lastChangeAt = 0;
  gestureRecorded = false;
}

/** 本次变化是否开新的一步（否则并入上一步） */
export function shouldStartHistoryStep(now: number = Date.now()): boolean {
  if (gestureActive) {
    if (gestureRecorded) {
      return false;
    }
    gestureRecorded = true;
    lastChangeAt = now;
    return true;
  }
  const merge = now - lastChangeAt < COALESCE_MS;
  lastChangeAt = now;
  return !merge;
}

export function pushHistory(stack: Component[][], snapshot: Component[]): Component[][] {
  const next = [...stack, snapshot];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}
