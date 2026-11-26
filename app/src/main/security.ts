/**
 * Security settings of the main window and of the `app://` protocol (spec §3.2, AK-10-03). Kept free of
 * Electron imports so tests can read the values.
 */

export const APP_SCHEME = 'app';
export const APP_ORIGIN = 'app://app';
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export interface WebPreferencesPolicy {
  contextIsolation: true;
  sandbox: true;
  nodeIntegration: false;
  webSecurity: true;
  allowRunningInsecureContent: false;
  experimentalFeatures: false;
  nodeIntegrationInWorker: false;
  nodeIntegrationInSubFrames: false;
  webviewTag: false;
}

export const WEB_PREFERENCES_POLICY: WebPreferencesPolicy = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webviewTag: false,
};

/** Fuses applied by the build (spec §3.2); see `build/fuses.mjs`. */
export const FUSE_POLICY = {
  runAsNode: false,
  enableNodeCliInspectArguments: false,
  enableNodeOptionsEnvironmentVariable: false,
  onlyLoadAppFromAsar: true,
} as const;

/** Permission requests are refused in every session (spec §3.2). */
export function permissionRequestHandler(
  _webContents: unknown,
  _permission: string,
  callback: (granted: boolean) => void,
): void {
  callback(false);
}

/** Navigation is allowed only inside the app origin (or the dev server in development). */
export function isNavigationAllowed(url: string, devServerUrl: string | undefined): boolean {
  if (url.startsWith(`${APP_ORIGIN}/`)) return true;
  return devServerUrl !== undefined && devServerUrl !== '' && new URL(url).origin === new URL(devServerUrl).origin;
}
