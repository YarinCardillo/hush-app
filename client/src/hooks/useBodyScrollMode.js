import { useEffect } from 'react';

export const BODY_SCROLL_MODE = Object.freeze({
  LOCKED: 'locked',
  SCROLL: 'scroll',
});

/**
 * Keeps document-level scroll behavior aligned with the current route shell.
 * Auth screens should allow page scrolling; the main app layout should stay
 * viewport-locked and rely on internal panels for scrolling.
 *
 * @param {'locked'|'scroll'} mode
 */
export function useBodyScrollMode(mode) {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const html = document.documentElement;
    const body = document.body;
    if (!html || !body) return undefined;

    const prev = {
      htmlHeight: html.style.height,
      htmlOverflow: html.style.overflow,
      htmlOverflowX: html.style.overflowX,
      htmlOverflowY: html.style.overflowY,
      htmlOverscrollBehavior: html.style.overscrollBehavior,
      bodyHeight: body.style.height,
      bodyOverflow: body.style.overflow,
      bodyOverflowX: body.style.overflowX,
      bodyOverflowY: body.style.overflowY,
      bodyOverscrollBehavior: body.style.overscrollBehavior,
      dataMode: body.dataset.hushScrollMode ?? null,
    };

    const isLocked = mode === BODY_SCROLL_MODE.LOCKED;
    const overflowY = isLocked ? 'hidden' : 'auto';
    const overscrollBehavior = isLocked ? 'none' : 'auto';

    html.style.height = '100%';
    body.style.height = '100%';
    html.style.overflow = overflowY;
    body.style.overflow = overflowY;
    html.style.overflowX = 'hidden';
    body.style.overflowX = 'hidden';
    html.style.overflowY = overflowY;
    body.style.overflowY = overflowY;
    html.style.overscrollBehavior = overscrollBehavior;
    body.style.overscrollBehavior = overscrollBehavior;
    body.dataset.hushScrollMode = isLocked
      ? BODY_SCROLL_MODE.LOCKED
      : BODY_SCROLL_MODE.SCROLL;

    return () => {
      html.style.height = prev.htmlHeight;
      html.style.overflow = prev.htmlOverflow;
      html.style.overflowX = prev.htmlOverflowX;
      html.style.overflowY = prev.htmlOverflowY;
      html.style.overscrollBehavior = prev.htmlOverscrollBehavior;
      body.style.height = prev.bodyHeight;
      body.style.overflow = prev.bodyOverflow;
      body.style.overflowX = prev.bodyOverflowX;
      body.style.overflowY = prev.bodyOverflowY;
      body.style.overscrollBehavior = prev.bodyOverscrollBehavior;

      if (prev.dataMode === null) {
        delete body.dataset.hushScrollMode;
      } else {
        body.dataset.hushScrollMode = prev.dataMode;
      }
    };
  }, [mode]);
}
