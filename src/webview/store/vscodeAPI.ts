import { VSCodeAPI } from '../types';

/**
 * 共享的 vscodeAPI 实例
 * 在 store.ts 和 collaboration.ts 之间共享，确保 postMessage 使用同一实例
 */
let apiInstance: VSCodeAPI | null = null;

export function getVSCodeAPI(): VSCodeAPI | null {
  return apiInstance;
}

export function setVSCodeAPIInstance(api: VSCodeAPI): void {
  apiInstance = api;
}
