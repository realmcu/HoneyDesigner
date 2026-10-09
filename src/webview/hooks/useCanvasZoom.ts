import { useEffect, useRef, type RefObject } from 'react';

/** Zoom the design canvas around the pointer without changing page zoom. */
export const useCanvasZoom = (
  containerRef: RefObject<HTMLDivElement | null>,
  zoom: number,
  setZoom: (zoom: number) => void,
  canvasOffset: { x: number; y: number },
  setCanvasOffset: (offset: { x: number; y: number }) => void
) => {
  const state = useRef({ zoom, canvasOffset, setZoom, setCanvasOffset });
  state.current = { zoom, canvasOffset, setZoom, setCanvasOffset };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (event: WheelEvent) => {
      // React's delegated wheel listener may be passive, so cancel the browser gesture here.
      event.preventDefault();
      if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
        container.scrollLeft += event.deltaY;
        return;
      }
      if (event.deltaY === 0) return;

      const { zoom: currentZoom, canvasOffset: currentOffset, setZoom: updateZoom, setCanvasOffset: updateOffset } = state.current;
      const nextZoom = Math.max(0.1, Math.min(5, currentZoom + (event.deltaY > 0 ? -0.1 : 0.1)));
      if (nextZoom === currentZoom) return;

      const rect = container.getBoundingClientRect();
      const mouseX = event.clientX - rect.left + container.scrollLeft;
      const mouseY = event.clientY - rect.top + container.scrollTop;
      const scale = nextZoom / currentZoom;
      const nextOffset = {
        x: mouseX - (mouseX - currentOffset.x) * scale,
        y: mouseY - (mouseY - currentOffset.y) * scale,
      };

      state.current = { ...state.current, zoom: nextZoom, canvasOffset: nextOffset };
      updateZoom(nextZoom);
      updateOffset(nextOffset);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [containerRef]);
};
