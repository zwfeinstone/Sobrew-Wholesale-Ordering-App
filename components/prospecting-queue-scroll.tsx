'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** Keep a queue's scroll position when a record or a sample flow opens. */
export default function ProspectingQueueScroll({ memoryKey, compact, children }: { memoryKey: string; compact: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const rail = compact ? ref.current?.closest<HTMLElement>('[data-prospecting-rail]') : null;
    const target = rail || window;
    const key = `prospecting-scroll-v2:${compact ? 'rail' : 'list'}:${memoryKey}`;
    let frame = 0;
    function remember() {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; try { sessionStorage.setItem(key, String(rail ? rail.scrollTop : window.scrollY)); } catch { /* Optional browser storage. */ } });
    }
    try {
      const saved = Number(sessionStorage.getItem(key));
      if (Number.isFinite(saved) && saved > 0) {
        if (rail) rail.scrollTop = saved;
        else window.scrollTo({ top: saved, behavior: 'instant' });
      }
    } catch { /* Scrolling still works when storage is disabled. */ }
    target.addEventListener('scroll', remember, { passive: true });
    return () => { target.removeEventListener('scroll', remember); if (frame) cancelAnimationFrame(frame); };
  }, [memoryKey, compact]);
  return <div ref={ref} className="min-w-0">{children}</div>;
}
