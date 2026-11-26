import { BrowserWindow, nativeTheme, screen, session } from 'electron';
import path from 'node:path';
import type { AppState } from '../shared/types';
import { MIN_HEIGHT, MIN_WIDTH } from './app-state';
import { APP_ENTRY_URL, WEB_PREFERENCES_POLICY, isNavigationAllowed, permissionRequestHandler } from './security';
import { fitBounds } from './window-bounds';

export interface CreateWindowOptions {
  state: AppState;
  preloadPath: string;
  devServerUrl: string | undefined;
  onBoundsChanged: (window: AppState['window']) => void;
}

export function createMainWindow(options: CreateWindowOptions): BrowserWindow {
  const bounds = fitBounds(options.state.window, screen.getAllDisplays().map((display) => display.workArea));
  const window = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    title: 'IPA Assistant',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#121316' : '#ffffff',
    webPreferences: { ...WEB_PREFERENCES_POLICY, preload: options.preloadPath },
  });
  if (options.state.window.maximized) window.maximize();
  window.once('ready-to-show', () => window.show());

  // No navigation and no new windows (spec §3.2). External links open only after confirmation (later package).
  window.webContents.on('will-navigate', (event, url) => {
    if (!isNavigationAllowed(url, options.devServerUrl)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  let timer: NodeJS.Timeout | null = null;
  const remember = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      if (window.isDestroyed()) return;
      const maximized = window.isMaximized();
      const normal = window.getNormalBounds();
      options.onBoundsChanged({ x: normal.x, y: normal.y, width: normal.width, height: normal.height, maximized });
    }, 400);
  };
  window.on('resize', remember);
  window.on('move', remember);
  window.on('maximize', remember);
  window.on('unmaximize', remember);

  if (options.devServerUrl !== undefined && options.devServerUrl !== '') void window.loadURL(options.devServerUrl);
  else void window.loadURL(APP_ENTRY_URL);
  return window;
}

/** Refuses every permission request in the default session (spec §3.2). */
export function lockDownSession(): void {
  session.defaultSession.setPermissionRequestHandler(permissionRequestHandler);
  session.defaultSession.setPermissionCheckHandler(() => false);
}

export function preloadFile(outDir: string): string {
  return path.join(outDir, 'preload', 'index.cjs');
}
