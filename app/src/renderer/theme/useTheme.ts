import { useEffect } from 'react';

/**
 * Follows the Windows light/dark setting at runtime and sets `data-theme` on the root element (spec §10.1).
 * Without a determinable setting the app stays light.
 */
export function useSystemTheme(): void {
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      document.documentElement.dataset['theme'] = 'light';
      return;
    }
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (): void => {
      document.documentElement.dataset['theme'] = query.matches ? 'dark' : 'light';
    };
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);
}
