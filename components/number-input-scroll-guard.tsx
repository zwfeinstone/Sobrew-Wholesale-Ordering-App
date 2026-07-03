'use client';

import { useEffect } from 'react';

export function NumberInputScrollGuard() {
  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      const focusedElement = document.activeElement;
      if (!(focusedElement instanceof HTMLInputElement)) return;
      if (focusedElement.type !== 'number') return;
      if (event.target !== focusedElement) return;

      focusedElement.blur();
    };

    document.addEventListener('wheel', handleWheel, true);
    return () => document.removeEventListener('wheel', handleWheel, true);
  }, []);

  return null;
}
