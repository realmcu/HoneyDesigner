/**
 * HoneyGUI Designer Webview Entry Point
 */

// 必须是第一个 import：为按需 chunk 设置 CSP nonce（详见该模块注释）。
import './webpackNonce';

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './global.css';
// 从types.ts导入已有的Window接口扩展
import './types';
import { setLocale } from './i18n';

if (window.__honeyguiPerf) {
  window.__honeyguiPerf.scriptEvaluatedAt = performance.now();
}

// 安全初始化VSCode API，确保只获取一次
if (!window.vscodeAPI) {
  try {
    // 尝试获取VS Code API
    window.vscodeAPI = window.acquireVsCodeApi?.();
    console.log('[HoneyGUI] VSCode API initialized successfully');
  } catch (error) {
    console.error('[HoneyGUI] Error acquiring VSCode API:', error);
    // 即使获取失败，也确保vscodeAPI存在，避免后续代码重复尝试
    window.vscodeAPI = {
      postMessage: (message: any) => {
        console.error('[HoneyGUI] VSCode API not available, cannot send message:', message);
      },
      setState: () => {},
      getState: () => null
    };
  }
} else {
  console.log('[HoneyGUI] VSCode API already initialized, reusing existing instance');
}

// 【关键修复】在渲染前就初始化语言设置，避免闪烁
// 尝试从 VSCode 的状态中获取语言设置
try {
  const state = window.vscodeAPI?.getState();
  if (state && state.locale) {
    setLocale(state.locale);
    console.log('[HoneyGUI] Locale initialized from state:', state.locale);
  } else {
    // 如果没有保存的状态，尝试从浏览器语言推断
    const browserLang = navigator.language.toLowerCase();
    if (browserLang.startsWith('zh')) {
      setLocale('zh-cn');
      console.log('[HoneyGUI] Locale initialized from browser:', 'zh-cn');
    }
  }
} catch (error) {
  console.warn('[HoneyGUI] Failed to initialize locale:', error);
}

// Allow wheel to change number input values while preventing page scroll
document.addEventListener('wheel', (e) => {
  const target = e.target as HTMLInputElement;
  if (target.tagName === 'INPUT' && target.type === 'number' && document.activeElement === target) {
    e.preventDefault();
    const step = parseFloat(target.step) || 1;
    const currentVal = parseFloat(target.value) || 0;
    const delta = e.deltaY < 0 ? step : -step;
    let newVal = currentVal + delta;
    if (target.min !== '') newVal = Math.max(newVal, parseFloat(target.min));
    if (target.max !== '') newVal = Math.min(newVal, parseFloat(target.max));
    const decimals = (target.step && target.step.includes('.'))
      ? target.step.split('.')[1].length : 0;
    // Use native setter to bypass React's value tracker, then dispatch input event
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    nativeInputValueSetter?.call(target, newVal.toFixed(decimals));
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }
}, { passive: false });

if (window.__honeyguiPerf) {
  window.__honeyguiPerf.reactRenderStartedAt = performance.now();
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<App />);
} else {
  // Fallback: create root element if it doesn't exist
  const newRootElement = document.createElement('div');
  newRootElement.id = 'root';
  document.body.appendChild(newRootElement);

  const root = ReactDOM.createRoot(newRootElement);
  root.render(<App />);
}
