import { useEffect, useRef } from 'react';

// Returns an `arm()` callback. Call it right after firing a Generate; once the
// report element (`#${targetId}`) is in the DOM on the next render, the page
// smooth-scrolls to it. Only the armed generate scrolls — a silent
// auto-regenerate (metric change) leaves the scroll position alone.
export function useScrollAfterGenerate(targetId: string, rendered: unknown): () => void {
  const armed = useRef(false);

  useEffect(() => {
    if (!armed.current || !rendered) return;
    armed.current = false;
    const el = document.getElementById(targetId);
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // rAF so the layout (sticky tab bar etc.) has settled before we measure.
    requestAnimationFrame(() => el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }));
  }, [targetId, rendered]);

  return () => {
    armed.current = true;
  };
}
