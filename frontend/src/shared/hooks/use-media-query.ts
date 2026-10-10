'use client';

import { useCallback, useSyncExternalStore } from 'react';

export function useMediaQuery(query: string) {
  const subscribe = useCallback((listener: () => void) => {
    if (typeof window.matchMedia !== 'function') return () => {};
    const media = window.matchMedia(query);
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    }
    media.addListener?.(listener);
    return () => media.removeListener?.(listener);
  }, [query]);
  const snapshot = useCallback(() => typeof window.matchMedia === 'function' && Boolean(window.matchMedia(query).matches), [query]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
