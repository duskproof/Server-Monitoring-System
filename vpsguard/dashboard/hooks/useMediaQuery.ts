'use client';

import { useEffect, useState } from 'react';

/** SSR-safe media query hook (defaults to `false` on the server). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);

    const listener = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener('change', listener);
    return () => list.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)');
}
