import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, protocol, shell } from 'electron';
import path from 'node:path';
import { IPC_CHANNELS } from '../shared/ipc';
import { createHandlers } from './ipc/handlers';
import { registerIpc } from './ipc/register';
import { createAppProtocolHandler } from './protocol';
import { APP_SCHEME } from './security';
import { createServices, readPackageVersion, type Services } from './services';
import { createMainWindow, lockDownSession, preloadFile } from './window';

// The app protocol must be registered before the app is ready (spec §3.2).
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const outDir = path.join(import.meta.dirname, '..');
const appRoot = app.getAppPath();
const devServerUrl = process.env['ELECTRON_RENDERER_URL'];

// Test hooks exist only outside an installation: an installed app ignores these variables, so the CLI root,
// the Node executable and the data folder cannot be redirected from the environment (spec §3.3, §4.3).
const testHooks = !app.isPackaged;
const userData = (testHooks ? process.env['IPA_APP_USER_DATA'] : undefined) ?? path.join(app.getPath('appData'), 'IPA Assistant');
app.setPath('userData', userData);

let mainWindow: BrowserWindow | null = null;
let services: Services | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow === null) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(async () => {
    nativeTheme.themeSource = 'system';
    lockDownSession();
    protocol.handle(APP_SCHEME, createAppProtocolHandler(path.join(outDir, 'renderer')));

    const nodeExe = testHooks ? process.env['IPA_APP_NODE'] : undefined;
    const cliRoot = testHooks ? process.env['IPA_APP_CLI_ROOT'] : undefined;
    services = await createServices({
      appRoot,
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      userDataDir: userData,
      env: process.env,
      appVersion: await readPackageVersion(appRoot),
      electronVersion: process.versions.electron,
      shell: {
        openPath: (file) => shell.openPath(file),
        showItemInFolder: (file) => shell.showItemInFolder(file),
        writeClipboard: (text) => clipboard.writeText(text),
        openExternal: (url) => shell.openExternal(url),
      },
      ...(nodeExe !== undefined ? { nodeExe } : {}),
      ...(cliRoot !== undefined ? { cliRoot } : {}),
    });
    const current = services;

    registerIpc({
      ipcMain,
      handlers: createHandlers(current),
      mainWebContentsId: () => mainWindow?.webContents.id,
      ...(devServerUrl !== undefined ? { devServerUrl } : {}),
      onRejected: (channel, reason) => current.log.write({ event: 'ipc_rejected', channel, reason }),
    });

    const state = current.appState.get();
    mainWindow = createMainWindow({
      state,
      preloadPath: preloadFile(outDir),
      devServerUrl,
      onBoundsChanged: (window) => void current.appState.update({ window }),
    });
    const send = (channel: string, payload: unknown): void => {
      if (mainWindow !== null && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
    };
    current.onProjectsChanged((change) => send(IPC_CHANNELS.projectsChanged, change));
    current.queue.onEvent((event) => send(IPC_CHANNELS.runEvent, event));
    current.watchProject(state.selection.repositoryId);
    mainWindow.on('closed', () => (mainWindow = null));
  });

  // A run does not survive closing the app: ask first and cancel on request (spec §3.6).
  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting || services === null) return;
    // Only runs that can be cancelled count: a short status call must never block quitting with a dialog.
    const active = services.queue.activeRuns().filter((run) => run.cancellable);
    if (active.length > 0) {
      const choice = dialog.showMessageBoxSync({
        type: 'question',
        buttons: ['Lauf abbrechen und beenden', 'Weiterlaufen lassen'],
        defaultId: 1,
        cancelId: 1,
        title: 'Lauf aktiv',
        message: 'Ein Lauf ist noch aktiv.',
        detail: 'Beim Beenden der App wird der Lauf abgebrochen. Ein abgebrochener Claude-Aufruf zählt als gescheiterter Versuch.',
      });
      if (choice === 1) {
        event.preventDefault();
        return;
      }
    }
    event.preventDefault();
    quitting = true;
    void services.shutdown().finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());
}
