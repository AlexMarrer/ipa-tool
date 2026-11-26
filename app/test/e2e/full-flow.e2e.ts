import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { APP_ROOT, createRepo, createTestEnv, fingerprintRepo, readFakeCalls, type TestEnv, type TestRepo } from '../helpers/env';

/**
 * AK-10-79: the whole way through the real app with the staged CLI and the bundled node.exe (the same files the installer
 * delivers), the fake Claude and a temporary data root. Playwright cannot attach to the installed app (the fuses switch
 * debugging off, spec §19), so the app runs from `out/` and brings the delivered runtime.
 */
const STAGE_CLI = path.join(APP_ROOT, 'stage', 'cli');
const STAGE_NODE = path.join(APP_ROOT, 'stage', 'node', 'node.exe');
const MODE_FAKE = path.join(APP_ROOT, 'test', 'helpers', 'mode-fake.mjs');
const PRELOAD = path.join(APP_ROOT, 'test', 'helpers', 'schtasks-preload.mjs');
const staged = existsSync(path.join(STAGE_CLI, 'dist', 'cli.js')) && existsSync(STAGE_NODE);

let env: TestEnv;
let app: ElectronApplication;
let page: Page;
let repo: TestRepo;
let modeFile: string;
let workspace = '';
let repoFingerprint: Record<string, string> = {};

const bar = () => page.getByRole('navigation', { name: 'Bereiche' });
const panel = () => page.getByRole('region', { name: 'Laufanzeige' });
const setMode = (mode: string) => writeFile(modeFile, mode);
const modelCalls = async (): Promise<number> => (await readFakeCalls(env)).filter((call) => call.kind === 'model-call').length;

test.describe.configure({ mode: 'serial' });
test.skip(!staged, 'Braucht das gestagte CLI und die node.exe (npm run dist --prefix app).');

test.beforeAll(async () => {
  test.setTimeout(300_000);
  env = await createTestEnv();
  modeFile = `${env.root}/fake-mode.txt`;
  await setMode('analysis');
  repo = await createRepo(env, 'gesamt');
  await repo.write('src/start.ts', 'export const start = 1;\n');
  await repo.commit('Startstand');
  app = await electron.launch({
    args: [APP_ROOT],
    cwd: APP_ROOT,
    colorScheme: null,
    env: {
      ...(env.env as Record<string, string>),
      FAKE_MODE_FILE: modeFile,
      SLOW_MS: '60000',
      IPA_APP_USER_DATA: env.userData,
      IPA_APP_NODE: STAGE_NODE,
      IPA_APP_CLI_ROOT: STAGE_CLI,
      IPA_TEST_SCHTASKS_STATE: `${env.root}/schtasks-state.json`,
      IPA_APP_CLI_NODE_OPTIONS: `--import=${pathToFileURL(PRELOAD).href}`,
    },
  });
  // The system dialog cannot be driven; the choice of the user is replaced by the test repository.
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as unknown as typeof dialog.showOpenDialog;
  }, repo.root.replace(/\//g, '\\'));
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

test('richtet ein Projekt mit dem Assistenten ein (AK-10-69 bis AK-10-71)', async () => {
  await expect(page.getByText('Noch kein Projekt').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Projekt hinzufügen' }).first().click();
  await expect(page.getByText('Schritt 1 von 4: Ordner wählen')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Weiter' })).toBeDisabled();
  await page.getByRole('button', { name: 'Ordner wählen …' }).click();
  const list = page.getByRole('list', { name: 'Prüfung des Ordners' });
  await expect(list).toContainText('Ja · Branch main', { timeout: 30_000 });
  await expect(list).toContainText('Beschreibbar');
  await expect(list).toContainText(/Schon eingerichtet\s*Nein/);
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByText('Schritt 2 von 4: Einstellungen')).toBeVisible();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByRole('region', { name: 'Bestätigen' })).toContainText('S000001 · Ausgangslage, zählt nicht als Arbeit');
  await page.getByRole('button', { name: 'Projekt einrichten' }).click();
  const result = page.getByRole('region', { name: 'Ergebnis' });
  await expect(result).toContainText('Projekt eingerichtet', { timeout: 60_000 });
  await expect(result).toContainText('S000001');
  const id = (await result.locator('dd.mono').first().innerText()).trim();
  expect(id).toMatch(/^gesamt-[0-9a-f]{6}$/);
  workspace = `${env.dataRoot}/workspaces/${id}`;

  // The wizard offers a schedule and sets none up by itself.
  await expect(result.getByRole('region', { name: 'Zeitplan' })).toContainText('Ein Zeitplan lässt das Tool regelmässig erfassen');
  await page.getByRole('button', { name: 'Zum Projekt' }).click();
  await expect(page.getByRole('navigation', { name: 'Projekte' }).getByRole('button', { name: new RegExp(id) })).toBeVisible();

  // The fake Claude takes the place of the real one for everything that follows.
  const configFile = `${workspace}/config.json`;
  const config = JSON.parse(await readFile(configFile, 'utf8')) as { claude: Record<string, unknown> };
  config.claude['command'] = [STAGE_NODE, MODE_FAKE];
  await writeFile(configFile, JSON.stringify(config, null, 2));
  expect(await modelCalls()).toBe(0);
});

test('prüft Claude auf der Seite System ohne Modellaufruf (AK-10-72)', async () => {
  await page.getByRole('button', { name: /System/ }).click();
  await expect(page.getByRole('heading', { name: /System – gilt für alle Projekte/ })).toBeVisible();
  const claude = page.getByRole('region', { name: 'Claude' });
  await claude.getByRole('button', { name: 'Prüfen' }).click();
  await expect(claude).toContainText('bereit', { timeout: 60_000 });
  await expect(claude).toContainText('Claude Code');
  await expect(claude.getByRole('button', { name: /Live-Test/ })).toBeEnabled();
  expect(await modelCalls()).toBe(0);
  await page.getByRole('navigation', { name: 'Bereiche des Systems' }).getByRole('button', { name: 'Version' }).click();
  await expect(page.getByRole('region', { name: 'Version' })).toContainText('Node (mitgeliefert)');
  await page.getByRole('navigation', { name: 'Projekte' }).getByRole('button').first().click();
});

test('erfasst eine Notiz, nimmt auf und analysiert, erzeugt das Journal mit und ohne KI und liest alles (AK-10-79)', async () => {
  await page.keyboard.press('Control+n');
  const dialog = page.getByRole('dialog', { name: 'Neue Notiz' });
  await dialog.getByRole('textbox', { name: /Text/ }).fill('Gesamtablauf geprüft');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  const saved = page.getByRole('dialog', { name: 'Notiz gespeichert' });
  await expect(saved).toBeVisible({ timeout: 60_000 });
  await saved.getByRole('button', { name: 'Schliessen' }).click();

  await repo.write('src/neu.ts', 'export const neu = 2;\n');
  repoFingerprint = await fingerprintRepo(repo.root);
  await page.getByRole('button', { name: /Jetzt erfassen.*Claude/ }).click();
  await expect(panel()).toContainText('Die Analyse ist abgeschlossen', { timeout: 120_000 });
  await panel().getByRole('button', { name: 'Schliessen' }).click();
  expect(await modelCalls()).toBeGreaterThan(0);

  await bar().getByRole('button', { name: 'Tag', exact: true }).click();
  await page.getByRole('tab', { name: /^Work-Logs/ }).click();
  await expect(page.getByRole('heading', { level: 3, name: /Work-Log S00000/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: /^Notizen/ }).click();
  await expect(page.getByRole('list', { name: 'Notizen' })).toContainText('Gesamtablauf geprüft');

  await page.getByRole('tab', { name: /^Journal/ }).click();
  await page.getByRole('button', { name: 'Ohne KI erzeugen' }).click();
  await expect(page.getByRole('combobox', { name: 'Entwürfe' })).toBeVisible({ timeout: 60_000 });
  await setMode('journal');
  await page.getByRole('button', { name: /Journal erzeugen.*Claude/ }).click();
  await expect(page.getByRole('combobox', { name: 'Entwürfe' }).locator('option')).toHaveCount(2, { timeout: 120_000 });
  await expect(page.getByRole('combobox', { name: 'Entwürfe' }).locator('option').first()).toContainText('KI-Entwurf');
  await expect(page.getByRole('navigation', { name: 'Gliederung' })).toBeVisible();
  await setMode('analysis');
});

test('zeigt die Zeitplan-Vorschau und speichert eine Änderung der Konfiguration (AK-10-79)', async () => {
  await bar().getByRole('button', { name: 'Zeitplan', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Vorschau eines Arbeitstags' })).toContainText('Höchstens 35 Claude-Aufrufe pro Arbeitstag', { timeout: 30_000 });
  await bar().getByRole('button', { name: 'Konfiguration', exact: true }).click();
  const turns = page.getByRole('textbox', { name: /Maximale Gesprächsrunden/ });
  await turns.fill('6');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Gespeichert. Die Änderung gilt ab dem nächsten Lauf.')).toBeVisible({ timeout: 30_000 });
  expect(JSON.parse(await readFile(`${workspace}/config.json`, 'utf8')).claude.maxTurns).toBe(6);
});

test('bricht einen laufenden Lauf ab und der nächste setzt fort (AK-10-51, AK-10-79)', async () => {
  await setMode('slow');
  await repo.write('src/langsam.ts', 'export const langsam = 3;\n');
  repoFingerprint = await fingerprintRepo(repo.root);
  await bar().getByRole('button', { name: 'Übersicht', exact: true }).click();
  await page.getByRole('button', { name: /Jetzt erfassen.*Claude/ }).click();
  await expect(panel()).toContainText('Läuft', { timeout: 30_000 });
  await panel().getByRole('button', { name: 'Live-Ausgabe' }).click();
  await expect(panel()).toContainText('Claude-Aufruf 1 von', { timeout: 90_000 });
  await panel().getByRole('button', { name: 'Abbrechen' }).click();
  await page.getByRole('dialog', { name: 'Lauf wirklich abbrechen?' }).getByRole('button', { name: 'Lauf abbrechen' }).click();
  await expect(panel()).toContainText('Lauf abgebrochen', { timeout: 30_000 });
  await panel().getByRole('button', { name: 'Schliessen' }).click();

  await setMode('analysis');
  await page.getByRole('button', { name: /Jetzt erfassen.*Claude/ }).click();
  await expect(panel()).toContainText(/Die Analyse ist abgeschlossen|Keine neue Arbeit/, { timeout: 120_000 });
});

test('verändert das untersuchte Repository nie (AK-10-79)', async () => {
  expect(await fingerprintRepo(repo.root)).toEqual(repoFingerprint);
});
