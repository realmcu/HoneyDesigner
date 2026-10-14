import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { Component } from '../../types';

export function useGeometryButtonPreview(component: Component) {
  const [isOn, setIsOn] = useState(component.data?.buttonInitialState === 'on');
  const pressStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setIsOn(component.data?.buttonInitialState === 'on');
  }, [component.id, component.data?.buttonInitialState, component.data?.buttonMode]);

  const previewHandlers = {
    onMouseDownCapture: (event: MouseEvent) => {
      pressStart.current = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
    },
    onClick: (event: MouseEvent) => {
      const start = pressStart.current;
      pressStart.current = null;
      if (component.data?.buttonMode !== 'dual-state' || !component.enabled || component.locked ||
          event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
          !start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) {
        return;
      }
      setIsOn(current => !current);
    },
  };

  return { isOn, previewHandlers };
}
