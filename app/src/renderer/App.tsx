import { lazy, Suspense, useEffect, useMemo } from 'react';
import type { IpaApi } from '../shared/ipc';
import { AppShell } from './layout/AppShell';
import { createAppStore } from './store/appStore';
import { useSystemTheme } from './theme/useTheme';

// The state gallery exists only in development and test builds (spec AD-15); the bundler removes it otherwise.
const Gallery = import.meta.env.DEV || import.meta.env.MODE === 'test' ? lazy(() => import('./gallery/Gallery')) : null;

export function App({ api }: { api: IpaApi }) {
  useSystemTheme();
  const app = useMemo(() => createAppStore(api), [api]);
  useEffect(() => {
    void app.actions.init();
    return () => app.actions.dispose();
  }, [app]);

  if (Gallery !== null && window.location.hash === '#/gallery') {
    return (
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    );
  }
  return <AppShell app={app} api={api} />;
}
