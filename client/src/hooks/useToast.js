import { useState, useCallback } from 'react';

/**
 * Hook that manages a stack of toast notifications.
 * Each toast auto-dismisses after 3 seconds.
 *
 * @returns {{ toasts: Array<{ id: number, message: string, type: 'success'|'error'|'info' }>, show: Function }}
 */
export function useToast() {
  const [toasts, setToasts] = useState([]);

  const show = useCallback((message, type = 'info') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  return { toasts, show };
}
