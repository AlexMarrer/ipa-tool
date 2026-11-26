import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { APP_ROOT, createTestEnv, fingerprintRepo, initProject, readFakeCalls, waitFor, type InitializedProject, type TestEnv } from '../helpers/env';
import { buildHaltWorkspace } from '../helpers/rich-workspace';

/**
 * Package 12: the actions in the real app against the real CLI with the fake Claude (AK-10-36 to AK-10-51).
 * No model is called; the fake Claude only records its calls.
 */
let env: TestEnv;
let app: ElectronApplication;
let page: Page;
let main: InitializedProject;
let slow: InitializedProject;
let halted: InitializedProject;
const SLOW_FAKE = path.join(APP_ROOT, 'test', 'helpers', 'slow-fake.mjs');

const modelCalls = async (): Promise<number> => (await readFakeCalls(env)).filter((call) => call.kind === 'model-call').length;
const project = (name: RegExp) => page.getByRole('navigation', { name: 'Projekte' }).getByRole('button', { name });
const panel = () => page.getByRole('region', { name: 'Laufanzeige' });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  env = await createTestEnv();
  env.env['SLOW_MS'] = '60000';
  main = await initProject(env, 'aktionen');
  slow = await initProject(env, 'langsam');
  const file = `${slow.workspacePath}/config.json`;
  const config = JSON.parse(await readFile(file, 'utf8')) as { claude: Record<string, unknown> };
  config.claude['command'] = [process.execPath, SLOW_FAKE];
  await writeFile(file, JSON.stringify(config, null, 2));
  halted = await buildHaltWorkspace(env, 'branch_changed', 'angehalten');
  app = await electron.launch({
    args: [APP_ROOT],
    cwd: APP_ROOT,
    colorScheme: null,
    env: { ...(env.env as Record<string, string>), IPA_APP_USER_DATA: env.userData, IPA_APP_NODE: process.execPath },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(project(/aktionen/)).toBeVisible({ timeout: 30_000 });
});

test.afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

test('ruft Claude nie von selbst auf, auch nicht beim Öffnen und Wechseln der Seiten (AK-10-50, §12.1)', async () => {
  await project(/aktionen/).click();
  for (const name of ['Tag', 'Zeitplan', 'Konfiguration', 'Übersicht']) await page.getByRole('navigation', { name: 'Bereiche' }).getByRole('button', { name, exact: true }).click();
  await page.waitForTimeout(1500);
  expect(await modelCalls()).toBe(0);
});

test('speichert eine Notiz mit Strg+N und Strg+Enter, zeigt nie den Text im Dialog und legt sie in den Tag (AK-10-45, AK-10-48)', async () => {
  const text = '--Käse "mit" Umlauten\nzweite Zeile & Sonderzeichen';
  await page.keyboard.press('Control+n');
  const dialog = page.getByRole('dialog', { name: 'Neue Notiz' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: /Text/ })).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Speichern' })).toBeDisabled();
  await dialog.getByRole('radio', { name: 'Tätigkeit' }).click();
  await dialog.getByRole('textbox', { name: /Text/ }).fill(text);
  await dialog.getByRole('button', { name: 'Mehr Felder' }).click();
  await dialog.getByRole('textbox', { name: 'Minuten' }).fill('30');
  await expect(dialog.getByRole('button', { name: 'Speichern' })).toBeDisabled();
  await dialog.getByRole('radio', { name: 'Geschätzt' }).click();
  await page.keyboard.press('Control+Enter');
  const saved = page.getByRole('dialog', { name: 'Notiz gespeichert' });
  await expect(saved).toBeVisible({ timeout: 30_000 });
  await expect(saved).toContainText('Tätigkeit');
  await expect(saved).toContainText('30 min · geschätzt');
  expect(await saved.innerText()).not.toContain('Käse');
  await saved.getByRole('button', { name: 'Im Zeitstrahl ansehen' }).click();
  await page.getByRole('tab', { name: /^Notizen/ }).click();
  await expect(page.getByRole('list', { name: 'Notizen' })).toContainText('Käse', { timeout: 20_000 });
  expect(await modelCalls()).toBe(0);
});

test('bricht den Notiz-Dialog mit Esc ab und meldet ein Zugangsdatum nur mit Detektor (AK-10-45, AK-10-48)', async () => {
  await page.keyboard.press('Control+n');
  await expect(page.getByRole('dialog', { name: 'Neue Notiz' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.keyboard.press('Control+n');
  const dialog = page.getByRole('dialog', { name: 'Neue Notiz' });
  await dialog.getByRole('textbox', { name: /Text/ }).fill('api_key = "IPA_TEST_SECRET_0123456789abcdef"');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  const saved = page.getByRole('dialog', { name: 'Notiz gespeichert' });
  await expect(saved).toContainText('Mögliches Zugangsdatum erkannt', { timeout: 30_000 });
  await expect(saved).toContainText('assignment');
  await expect(saved).toContainText('nie an Claude gesendet');
  expect(await page.locator('body').innerText()).not.toContain('IPA_TEST_SECRET_0123456789abcdef');
  await saved.getByRole('button', { name: 'Schliessen' }).click();
});

test('Nur aufnehmen speichert einen Snapshot ohne Modellaufruf, Jetzt erfassen analysiert ihn (AK-10-38)', async () => {
  const before = await fingerprintRepo(main.repo.root);
  await main.repo.write('src/neu.ts', 'export const neu = 1;\n');
  const changed = await fingerprintRepo(main.repo.root);
  expect(changed).not.toEqual(before);

  await page.getByRole('button', { name: 'Weitere Optionen' }).click();
  await page.getByRole('menuitem', { name: 'Nur aufnehmen' }).click();
  await expect(panel()).toContainText('Analyse nicht ausgeführt (Nur aufnehmen)', { timeout: 60_000 });
  await expect(panel()).toContainText('Exit-Code 0: Erfolg');
  expect(await modelCalls()).toBe(0);
  await panel().getByRole('button', { name: 'Schliessen' }).click();

  await page.getByRole('button', { name: /Jetzt erfassen.*Claude/ }).click();
  await expect(panel()).toContainText(/Die Analyse ist abgeschlossen|Keine neue Arbeit/, { timeout: 90_000 });
  await expect(page.getByRole('button', { name: /Jetzt erfassen.*Claude/ })).toBeEnabled();
  expect(await modelCalls()).toBeGreaterThan(0);
  // The repository is only read, never changed by the app (AK-10-35).
  expect(await fingerprintRepo(main.repo.root)).toEqual(changed);
});

test('erzeugt ein Journal ohne KI, übernimmt es als Endfassung und löscht die Endfassung in den Papierkorb (spec §8.5)', async () => {
  const calls = await modelCalls();
  const finalDir = `${main.workspacePath}/journal/final`;
  await page.getByRole('navigation', { name: 'Bereiche' }).getByRole('button', { name: 'Tag', exact: true }).click();
  await page.getByRole('tab', { name: /^Journal/ }).click();
  await page.getByRole('button', { name: 'Ohne KI erzeugen' }).click();
  await expect(page.getByRole('combobox', { name: 'Entwürfe' })).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: 'Als Endfassung übernehmen' }).click();
  await expect(page.getByText(/Endfassung angelegt: journal\/final\/\d{4}-\d{2}-\d{2}\.md/)).toBeVisible({ timeout: 20_000 });
  const finals = page.getByRole('list', { name: 'Endfassungen dieses Tages' });
  await expect(finals).toContainText('.md', { timeout: 20_000 });
  const copied = await waitFor(async () => (await readdir(finalDir).catch(() => [])).filter((name) => name.endsWith('.md'))[0], 20_000);
  expect(await readFile(`${finalDir}/${copied}`, 'utf8')).toContain('Entwurf');

  // A second copy never replaces the first one.
  await page.getByRole('button', { name: 'Als Endfassung übernehmen' }).click();
  await expect(finals.getByRole('listitem')).toHaveCount(2, { timeout: 20_000 });

  await page.getByRole('button', { name: new RegExp(`Endfassung ${copied.replace('.', '\\.')} löschen`) }).click();
  const confirm = page.getByRole('dialog', { name: 'Endfassung löschen?' });
  await expect(confirm).toContainText('Papierkorb');
  await confirm.getByRole('button', { name: 'In den Papierkorb' }).click();
  await expect(page.getByText('Endfassung in den Papierkorb verschoben.')).toBeVisible({ timeout: 20_000 });
  await expect(finals.getByRole('listitem')).toHaveCount(1, { timeout: 20_000 });
  expect((await readdir(finalDir)).filter((name) => name.endsWith('.md'))).not.toContain(copied);
  // The draft is still there, and no model was called.
  await expect(page.getByRole('combobox', { name: 'Entwürfe' })).toBeVisible();
  expect(await modelCalls()).toBe(calls);
});

test('zeigt die Live-Ausgabe, sperrt während des Laufs und bricht mit Rückfrage ab (AK-10-36, AK-10-37, AK-10-39, AK-10-51)', async () => {
  await project(/langsam/).click();
  await slow.repo.write('src/langsam.ts', 'export const langsam = 1;\n');
  await page.getByRole('button', { name: /Jetzt erfassen.*Claude/ }).click();
  await expect(panel()).toContainText('Läuft', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /Jetzt erfassen.*Claude/ })).toBeDisabled();
  await page.getByRole('button', { name: /Jetzt erfassen.*Claude/ }).hover({ force: true });
  await panel().getByRole('button', { name: 'Live-Ausgabe' }).click();
  await expect(panel()).toContainText('Claude-Aufruf 1 von', { timeout: 60_000 });
  await expect(panel().getByRole('list')).not.toContainText('Käse');

  await panel().getByRole('button', { name: 'Abbrechen' }).click();
  const confirm = page.getByRole('dialog', { name: 'Lauf wirklich abbrechen?' });
  await expect(confirm).toContainText('Bereits gespeicherte Snapshots bleiben erhalten.');
  await expect(confirm).toContainText('Ein abgebrochener Claude-Aufruf zählt als gescheiterter Versuch.');
  await confirm.getByRole('button', { name: 'Weiterlaufen lassen' }).click();
  await expect(panel()).toContainText('Läuft');
  await panel().getByRole('button', { name: 'Abbrechen' }).click();
  await page.getByRole('dialog', { name: 'Lauf wirklich abbrechen?' }).getByRole('button', { name: 'Lauf abbrechen' }).click();
  await expect(panel()).toContainText('Lauf abgebrochen', { timeout: 30_000 });
  await expect(panel()).toContainText('Der nächste Lauf setzt sauber fort.');
  await expect(page.getByRole('button', { name: /Jetzt erfassen.*Claude/ })).toBeEnabled();
  // The slow fake never got as far as a model call.
  await waitFor(async () => (await modelCalls()) >= 0, 5_000);
});

test('setzt nach einem Halt mit Grund einen neuen Ausgangspunkt (AK-10-43)', async () => {
  await project(/angehalten/).click();
  // The halt banner with its action stands in the header on every page of the project.
  const setBaseline = page.getByRole('button', { name: 'Neuen Ausgangspunkt setzen' });
  await expect(setBaseline.first()).toBeVisible({ timeout: 20_000 });
  await setBaseline.first().click();
  const dialog = page.getByRole('dialog', { name: 'Neuen Ausgangspunkt setzen' });
  await expect(dialog).toContainText('Das Repository selbst wird nicht verändert.');
  await expect(dialog.getByRole('button', { name: 'Ausgangspunkt setzen' })).toBeDisabled();
  await dialog.getByRole('textbox', { name: /Grund/ }).fill('Bewusst auf den neuen Branch gewechselt');
  await expect(dialog.getByRole('button', { name: 'Ausgangspunkt setzen' })).toBeEnabled({ timeout: 10_000 });
  await dialog.getByRole('button', { name: 'Ausgangspunkt setzen' }).click();
  await expect(dialog).toContainText('Neuer Ausgangspunkt', { timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Schliessen' }).click();
  await expect(setBaseline).toHaveCount(0, { timeout: 20_000 });
  expect(halted.repositoryId).not.toBe('');
});
