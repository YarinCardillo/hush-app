import { useState, useEffect, useCallback, useRef } from 'react';

const STORAGE_KEY = 'hush:sidebar-width';
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 180;
const MAX_WIDTH = 400;

export function useSidebarResize() {
  const [width, setWidth] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const parsed = stored ? parseInt(stored, 10) : NaN;
      return Number.isNaN(parsed) ? DEFAULT_WIDTH : Math.min(Math.max(parsed, MIN_WIDTH), MAX_WIDTH);
    } catch {
      return DEFAULT_WIDTH;
    }
  });

  const dragState = useRef(null); // { startX, startWidth }

  const onMouseMove = useCallback((e) => {
    if (!dragState.current) return;
    const delta = e.clientX - dragState.current.startX;
    const next = Math.min(Math.max(dragState.current.startWidth + delta, MIN_WIDTH), MAX_WIDTH);
    setWidth(next);
  }, []);

  const onMouseUp = useCallback(() => {
    if (!dragState.current) return;
    dragState.current = null;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    setWidth((w) => {
      localStorage.setItem(STORAGE_KEY, String(w));
      return w;
    });
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [onMouseMove]);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startWidth: width };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [width, onMouseMove, onMouseUp]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [onMouseMove, onMouseUp]);

  return { width, handleMouseDown };
}
