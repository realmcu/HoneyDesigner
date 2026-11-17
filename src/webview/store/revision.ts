/**
 * 设计内容版本（docRevision）的生成规则
 *
 * 单一递增入口：所有会改变设计内容的路径（人工编辑、撤销/重做、AI 事务、
 * 宿主加载）都必须经过这里记账，不得各自维护计数。
 *
 * 两个与「保存」相关的版本：
 * - docRevision：当前有效内容的版本，内容变化时递增。保存**不**递增它。
 * - persistedRevision：已完成落盘的版本。由保存回执带回的、**实际写入的**版本
 *   推进，不能读回执到达时的「当前」版本——否则保存窗口内的新编辑会被误标为已保存。
 *
 * 详见 docs/superpowers/specs/2026-11-16-ai-collaboration-closed-loop-design.md §2。
 */

import type { Component } from '../types';

/**
 * 临时状态抑制：宿主加载前的占位清空、UI 状态恢复等不是内容提交。
 *
 * 与 suppressDirtyTracking 不同——后者只管脏状态与撤销历史，**不跳过**版本记账；
 * 这里只看「这次 components 变化是否代表设计内容的一次真实提交」。
 */
let transientDepth = 0;

/** 宿主推送期间置位：同样内容回推不产生新版本，故需比对而不是直接认定变化 */
let hostPushDepth = 0;

export function withoutRevisionCommit<T>(fn: () => T): T {
  transientDepth++;
  try {
    return fn();
  } finally {
    transientDepth--;
  }
}

export function beginHostContentPush(): void {
  hostPushDepth++;
}

export function endHostContentPush(): void {
  hostPushDepth--;
}

/**
 * 本次 components 变化是否要递增 docRevision。
 *
 * - 临时状态（占位清空、UI 恢复）不提交。
 * - 人工编辑、撤销/重做：引用变化即视为内容变化，跳过签名比对。
 *   这条路径高频（拖拽逐帧），签名比对成本不值得。
 * - 宿主推送：必须比对。宿主可能原样回推刚保存的内容（保存后刷新），
 *   此时不应产生新版本。
 */
export function shouldCommitRevision(next: Component[], prev: Component[]): boolean {
  if (transientDepth > 0) {
    return false;
  }
  if (hostPushDepth === 0) {
    return true;
  }
  return contentSignature(next) !== contentSignature(prev);
}

/**
 * 内容签名：键序无关的规范化序列化，仅用于宿主推送去重。
 *
 * 需要键序无关：宿主推来的组件来自 HML 解析，与内存中经 updateComponent
 * 演进过的对象键序不一定一致，普通 JSON.stringify 会把等价内容判成不同。
 */
export function contentSignature(value: unknown): string {
  return canonicalize(value);
}

function canonicalize(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const parts = Object.keys(record)
      .sort()
      .filter(key => record[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value);
}
