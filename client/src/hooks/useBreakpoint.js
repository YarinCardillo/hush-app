import { useState, useEffect } from 'react';

const MOBILE_MAX = 640;
const TABLET_MAX = 1024;

function getBreakpoint() {
  const width = window.innerWidth;
  if (width < MOBILE_MAX) return 'mobile';
  if (width < TABLET_MAX) return 'tablet';
  return 'desktop';
}

/**
 * Returns the current breakpoint: 'mobile' (<640px), 'tablet' (<1024px), or 'desktop'.
 */
export function useBreakpoint() {
  const [breakpoint, setBreakpoint] = useState(getBreakpoint);

  useEffect(() => {
    const handler = () => setBreakpoint(getBreakpoint());
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return breakpoint;
}
