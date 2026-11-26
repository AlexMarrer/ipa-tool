import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { APP_ROOT, createTestEnv, fingerprintRepo, initProject, readFakeCalls, type InitializedProject, type TestEnv } from '../helpers/env';

/**
 * Start test of the built app (spec §17): the window opens with the security options, the project list comes
 * from the real CLI, and navigation never starts Claude (AK-10-03, AK-10-15). Needs `npm run build` first.
 */
let env: TestEnv;
let project: InitializedProject;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  env = await createTestEnv();
  project = await initProject(env, 'e2e projekt');
  app = await electron.launch({
    args: [APP_ROOT],
    cwd: APP_ROOT,
    // Playwright pins prefers-color-scheme to light by default; null leaves it to nativeTheme (the Windows setting).
    colorScheme: null,
    env: {
      ...(env.env as Record<string, string>),
      IPA_APP_USER_DATA: env.userData,
      IPA_APP_NODE: process.execPath,
    },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

test('öffnet das Hauptfenster mit den Sicherheitseinstellungen (AK-10-03)', async () => {
  const preferences = await app.evaluate(({ BrowserWindow }) => {
    // getLastWebPreferences is not in the public typings but returns the options the window really got.
    const contents = BrowserWindow.getAllWindows()[0]?.webContents as unknown as { getLastWebPreferences(): Record<string, boolean> } | undefined;
    const prefs = contents?.getLastWebPreferences();
    return { contextIsolation: prefs?.contextIsolation, sandbox: prefs?.sandbox, nodeIntegration: prefs?.nodeIntegration, webSecurity: prefs?.webSecurity, allowRunningInsecureContent: prefs?.allowRunningInsecureContent };
  });
  expect(preferences).toMatchObject({ contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true });
  expect(preferences.allowRunningInsecureContent).not.toBe(true);

  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getMinimumSize());
  expect(bounds).toEqual([1100, 700]);

  const exposure = await page.evaluate(() => ({
    process: typeof (window as unknown as { process?: unknown }).process,
    require: typeof (window as unknown as { require?: unknown }).require,
    ipcRenderer: typeof (window as unknown as { ipcRenderer?: unknown }).ipcRenderer,
    keys: Object.keys((window as unknown as { ipa: object }).ipa).sort(),
    url: location.href,
  }));
  expect(exposure).toMatchObject({ process: 'undefined', require: 'undefined', ipcRenderer: 'undefined', keys: ['app', 'day', 'journal', 'notes', 'overview', 'projects', 'run', 'shell', 'snapshot', 'system'] });
  expect(exposure.url.startsWith('app://app/')).toBe(true);
});

test('liefert die Seite mit Content-Security-Policy und lehnt Pfade ausserhalb ab', async () => {
  const response = await page.goto('app://app/index.html');
  expect(response?.headers()['content-security-policy']).toContain("default-src 'none'");
  expect(response?.headers()['content-security-policy']).toContain("connect-src 'none'");
  const outside = await page.goto('app://app/..%2Fmain%2Findex.js');
  expect(outside?.status()).toBe(404);
  await page.goto('app://app/index.html');
});

test('verweigert Navigation und neue Fenster', async () => {
  await page.goto('app://app/index.html');
  await page.evaluate(() => {
    window.open('https://example.com/');
  });
  await page.waitForTimeout(300);
  expect(app.windows()).toHaveLength(1);
  await page.evaluate(() => {
    location.href = 'https://example.com/';
  });
  await page.waitForTimeout(300);
  expect(page.url().startsWith('app://app/')).toBe(true);
});

test('zeigt das Projekt aus der Registry und navigiert ohne je Claude zu starten (AK-10-15)', async () => {
  await page.goto('app://app/index.html');
  const before = await fingerprintRepo(project.repo.root);
  const sidebar = page.getByRole('navigation', { name: 'Projekte' });
  await expect(sidebar.getByRole('button', { name: new RegExp(project.repositoryId) })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(project.repositoryId);

  for (const name of ['Tag', 'Zeitplan', 'Konfiguration', 'Übersicht']) {
    await page.getByRole('navigation', { name: 'Bereiche' }).getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Bereiche' }).getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page');
  }
  await page.getByRole('button', { name: /System/ }).click();
  await page.getByRole('button', { name: /Projekt hinzufügen/ }).first().click();
  await page.keyboard.press('Control+n');

  // Change files in the workspace: the app reloads the status but starts nothing else.
  await readFile(path.join(project.workspacePath, 'state.json'));
  await project.repo.write('src/aenderung.ts', 'export {};\n');
  await page.waitForTimeout(1200);

  const calls = await readFakeCalls(env);
  expect(calls.filter((call) => call.kind === 'model-call')).toEqual([]);
  const log = (await readFile(path.join(env.userData, 'logs', 'app.log'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as { event: string; command?: string; trigger?: string; ai?: boolean });
  const started = log.filter((entry) => entry.event === 'cli_started');
  expect(started.length).toBeGreaterThan(0);
  // Only commands that never call a model may start on their own (spec §12.1): status and schedule status.
  for (const entry of started) {
    expect(entry).toMatchObject({ trigger: 'auto', ai: false });
    expect(['status', 'schedule status']).toContain(entry.command);
  }
  expect(await fingerprintRepo(project.repo.root)).toMatchObject({ ...before, 'src/aenderung.ts': expect.any(String) });
});

test('speichert nur Fenster und Auswahl in app-state.json (AK-10-14)', async () => {
  await page.goto('app://app/index.html');
  await page.getByRole('navigation', { name: 'Bereiche' }).getByRole('button', { name: 'Zeitplan' }).click();
  await expect.poll(async () => {
    try {
      return JSON.parse(await readFile(path.join(env.userData, 'app-state.json'), 'utf8')).selection?.section;
    } catch {
      return null;
    }
  }).toBe('schedule');
  const saved = JSON.parse(await readFile(path.join(env.userData, 'app-state.json'), 'utf8')) as Record<string, unknown>;
  expect(Object.keys(saved).sort()).toEqual(['schemaVersion', 'selection', 'window']);
});

test('folgt der Windows-Einstellung Hell und Dunkel zur Laufzeit (AK-10-11)', async () => {
  await page.goto('app://app/index.html');
  const theme = async () => page.evaluate(() => ({ theme: document.documentElement.dataset['theme'], background: getComputedStyle(document.body).backgroundColor }));
  // nativeTheme is what follows the Windows setting; changing its source changes prefers-color-scheme at runtime.
  const setSource = (source: 'light' | 'dark' | 'system') => app.evaluate(({ nativeTheme }, value) => void (nativeTheme.themeSource = value), source);
  await setSource('light');
  await expect.poll(theme).toEqual({ theme: 'light', background: 'rgb(255, 255, 255)' });
  await setSource('dark');
  await expect.poll(theme).toEqual({ theme: 'dark', background: 'rgb(18, 19, 22)' });
  await setSource('system');
});

test('erlaubt nur eine Instanz', async () => {
  // The second start quits at once, before a debugger could attach, so it is started as a plain process.
  const electronPath = createRequire(import.meta.url)('electron') as unknown as string;
  const second = spawn(electronPath, [APP_ROOT], {
    cwd: APP_ROOT,
    env: { ...env.env, IPA_APP_USER_DATA: env.userData, IPA_APP_NODE: process.execPath },
    stdio: 'ignore',
    windowsHide: true,
  });
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => second.once('exit', () => resolve(true))),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20_000)),
  ]);
  if (!exited) second.kill();
  expect(exited).toBe(true);
  expect(app.windows()).toHaveLength(1);
});
