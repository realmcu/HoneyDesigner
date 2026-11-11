import { useState, useEffect, useCallback } from 'react';

interface PanelConfig {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
}

export interface PanelState {
  width: number;
  isResizing: boolean;
  isCollapsed: boolean;
  setWidth: (w: number) => void;
  setIsResizing: (r: boolean) => void;
  toggle: () => void;
  startResize: () => void;
  stopResize: () => void;
}

/**
 * 面板宽度调整 Hook
 */
export function usePanelResize(config: PanelConfig): PanelState {
  const [width, setWidth] = useState(config.defaultWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [savedWidth, setSavedWidth] = useState(config.defaultWidth);

  const toggle = useCallback(() => {
    if (isCollapsed) {
      setWidth(savedWidth);
      setIsCollapsed(false);
    } else {
      setSavedWidth(width);
      setWidth(0);
      setIsCollapsed(true);
    }
  }, [isCollapsed, width, savedWidth]);

  const startResize = useCallback(() => setIsResizing(true), []);
  const stopResize = useCallback(() => setIsResizing(false), []);

  return {
    width,
    isResizing,
    isCollapsed,
    setWidth,
    setIsResizing,
    toggle,
    startResize,
    stopResize,
  };
}

/**
 * 面板快捷键 Hook
 */
export function usePanelShortcuts(
  toggleLeft: () => void,
  toggleRight: () => void
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // Ctrl+B: 切换左侧面板
      if (e.ctrlKey && e.key === 'b' && !e.shiftKey) {
        e.preventDefault();
        toggleLeft();
      }
      // Ctrl+Shift+B: 切换右侧面板
      if (e.ctrlKey && e.shiftKey && e.key === 'B') {
        e.preventDefault();
        toggleRight();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleLeft, toggleRight]);
}
