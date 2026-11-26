import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { APP_ROOT, createTestEnv, initProject, readFakeCalls, type InitializedProject, type TestEnv } from '../helpers/env';

/**
 * Package 13: schedule and configuration in the real app against the real CLI. The Task Scheduler is replaced by a
 * stand-in inside every CLI process (`schtasks-preload.mjs`); the tests never touch the real one (AK-10-55).
 */
let env: TestEnv;
let app: ElectronApplication;
let page: Page;
let main: InitializedProject;
let configFile: string;
let schedulerLog: string;
const PRELOAD = path.join(APP_ROOT, 'test', 'helpers', 'schtasks-preload.mjs');

const bar = () => page.getByRole('navigation', { name: 'Bereiche' });
const groups = () => page.getByRole('navigation', { name: 'Gruppen der Konfiguration' });
const readConfig = async (): Promise<Record<string, any>> => JSON.parse(await readFile(configFile, 'utf8'));

test.beforeAll(async () => {
  test.setTimeout(300_000);
  env = await createTestEnv();
  schedulerLog = `${env.root}/schtasks-calls.jsonl`;
  main = await initProject(env, 'zeitplan');
  configFile = `${main.workspacePath}/config.json`;
  app = await electron.launch({
    args: [APP_ROOT],
    cwd: APP_ROOT,
    colorScheme: null,
    env: {
      ...(env.env as Record<string, string>),
      IPA_APP_USER_DATA: env.userData,
      IPA_APP_NODE: process.execPath,
      IPA_TEST_SCHTASKS_STATE: `${env.root}/schtasks-state.json`,
      IPA_TEST_SCHTASKS_LOG: schedulerLog,
      IPA_APP_CLI_NODE_OPTIONS: `--import=${pathToFileURL(PRELOAD).href}`,
    },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('navigation', { name: 'Projekte' }).getByRole('button', { name: /zeitplan/ })).toBeVisible({ timeout: 30_000 });
});

test.afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

test('richtet den Zeitplan ein, zeigt die Vorschau und pausiert und setzt fort (AK-10-52 bis AK-10-55)', async () => {
  await bar().getByRole('button', { name: 'Zeitplan', exact: true }).click();
  const card = page.getByRole('region', { name: 'Zustand der Aufgabe' });
  await expect(card).toContainText('Nicht eingerichtet', { timeout: 30_000 });
  const preview = page.getByRole('region', { name: 'Vorschau eines Arbeitstags' });
  await expect(preview).toContainText('Höchstens 35 Claude-Aufrufe pro Arbeitstag', { timeout: 20_000 });
  await expect(preview).toContainText('7 Läufe × 5 Analysen pro Lauf');
  await expect(page.getByRole('button', { name: /Jetzt auslösen/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Einrichten' }).click();
  await expect(card).toContainText('Aktiv', { timeout: 30_000 });
  await expect(page.getByText('Die Windows-Aufgabe ist eingerichtet.')).toBeVisible();
  await expect(card).toContainText(`ipa-assistant-${main.repositoryId}`);

  await page.getByRole('button', { name: 'Pausieren' }).click();
  await expect(card).toContainText('Pausiert', { timeout: 30_000 });
  const trigger = page.getByRole('button', { name: /Jetzt auslösen/ });
  await expect(trigger).toBeDisabled();
  await page.getByRole('button', { name: 'Fortsetzen' }).click();
  await expect(card).toContainText('Aktiv', { timeout: 30_000 });
  await expect(trigger).toBeEnabled();
});

test('speichert eine Änderung des Zeitplans, zeigt "veraltet" und aktualisiert; config.json ändert sich nur im Pfad (AK-10-56, AK-10-68)', async () => {
  const before = await readConfig();
  const form = page.getByRole('form', { name: 'Zeitplan bearbeiten' });
  const interval = form.getByRole('textbox', { name: /Intervall/ });
  await interval.fill('90');
  await expect(page.getByRole('button', { name: 'Einrichten' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Zeitplan speichern' }).click();
  const card = page.getByRole('region', { name: 'Zustand der Aufgabe' });
  await expect(card).toContainText('Veraltet', { timeout: 30_000 });
  await expect(card).toContainText('Trigger');
  const after = await readConfig();
  const expected = structuredClone(before);
  expected.schedule.intervalMinutes = 90;
  expect(after).toEqual(expected);

  await page.getByRole('button', { name: 'Aktualisieren' }).click();
  await expect(card).toContainText('Aktiv', { timeout: 30_000 });
});

test('speichert in der Konfiguration, erkennt eine Änderung von Hand und fragt nach (AK-10-58, AK-10-67)', async () => {
  await bar().getByRole('button', { name: 'Konfiguration', exact: true }).click();
  const turns = page.getByRole('textbox', { name: /Maximale Gesprächsrunden/ });
  await expect(turns).toHaveValue('5', { timeout: 20_000 });
  await turns.fill('0');
  await expect(page.getByText('Maximale Gesprächsrunden: ganze Zahl, mindestens 1. Der Wert 0 ist nicht erlaubt.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Speichern' })).toBeDisabled();
  await turns.fill('7');

  // A hand edit while changes are open: the app asks and keeps nothing silently.
  const current = await readConfig();
  current['claude'].maxAttemptsPerSnapshot = 4;
  await writeFile(configFile, `${JSON.stringify(current, null, 2)}\n`);
  const dialog = page.getByRole('dialog', { name: 'Die Datei wurde zwischenzeitlich geändert' });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Meine Änderungen behalten' }).click();
  await expect(turns).toHaveValue('7');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Gespeichert. Die Änderung gilt ab dem nächsten Lauf.')).toBeVisible({ timeout: 30_000 });
  const after = await readConfig();
  expect(after['claude']).toMatchObject({ maxTurns: 7, maxAttemptsPerSnapshot: 4 });
});

test('prüft einen Pfad auf dem ungespeicherten Entwurf gegen den Filter des CLI (AK-10-61)', async () => {
  await groups().getByRole('button', { name: /^Dateifilter/ }).click();
  await page.getByRole('textbox', { name: 'Pfad im Repository' }).fill('node_modules/x/index.js');
  await expect(page.getByText('wird nicht erfasst')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('region', { name: 'Pfad testen' })).toContainText('**/node_modules/**');
  await page.getByRole('textbox', { name: 'Pfad im Repository' }).fill('src/app.ts');
  await expect(page.getByText('wird erfasst', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('textbox', { name: 'Pfad im Repository' }).fill('.git/config');
  await expect(page.getByRole('region', { name: 'Pfad testen' })).toContainText('.git/**', { timeout: 20_000 });
});

test('schaltet kostenpflichtige Nutzung nur nach zwei Schritten ein, ohne Bestätigung nichts (AK-10-60)', async () => {
  await groups().getByRole('button', { name: /^Kostenschutz/ }).click();
  const toggle = page.getByRole('switch');
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  const dialog = page.getByRole('dialog', { name: /Schritt 1 von 2/ });
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  expect((await readConfig())['claude'].allowPaidUsage ?? false).toBe(false);

  await toggle.click();
  await page.getByRole('dialog', { name: /Schritt 1 von 2/ }).getByRole('button', { name: 'Weiter' }).click();
  const second = page.getByRole('dialog', { name: /Schritt 2 von 2/ });
  const confirm = second.getByRole('button', { name: 'Kostenpflichtige Nutzung erlauben' });
  await expect(confirm).toBeDisabled();
  await second.getByRole('checkbox').check();
  await second.getByRole('textbox').fill('erlauben');
  await confirm.click();
  await expect(second).toHaveCount(0, { timeout: 30_000 });
  await expect(toggle).toBeChecked({ timeout: 30_000 });
  expect((await readConfig())['claude'].allowPaidUsage).toBe(true);

  // Switching it off needs no confirmation.
  await toggle.click();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Gespeichert. Die Änderung gilt ab dem nächsten Lauf.')).toBeVisible({ timeout: 30_000 });
  await expect(toggle).not.toBeChecked();
  expect((await readConfig())['claude'].allowPaidUsage).toBe(false);
});

test('löscht den Zeitplan nach Bestätigung, ohne die Konfiguration anzufassen, und ruft nie Claude auf (AK-10-55, §12.1)', async () => {
  await bar().getByRole('button', { name: 'Zeitplan', exact: true }).click();
  const before = await readFile(configFile);
  await page.getByRole('button', { name: 'Löschen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Zeitplan löschen?' });
  await expect(dialog).toContainText(`ipa-assistant-${main.repositoryId}`);
  await dialog.getByRole('button', { name: 'Zeitplan löschen' }).click();
  await expect(page.getByRole('region', { name: 'Zustand der Aufgabe' })).toContainText('Nicht eingerichtet', { timeout: 30_000 });
  expect(Buffer.compare(before, await readFile(configFile))).toBe(0);

  // Everything went through the stand-in; nothing reached the real Task Scheduler, and no model was called.
  const calls = (await readFile(schedulerLog, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as string[]);
  expect(calls.map((call) => call[0])).toEqual(expect.arrayContaining(['/Create', '/Change', '/Delete']));
  expect((await readFakeCalls(env)).filter((call) => call.kind === 'model-call')).toEqual([]);
});
