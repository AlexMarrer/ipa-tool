import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { formatLongDay } from '../../src/shared/dates';
import { APP_ROOT, createTestEnv, fingerprintRepo, readFakeCalls, runCli, type TestEnv } from '../helpers/env';
import { SECRET_MARKER, buildStatesWorkspace, type StatesWorkspace } from '../helpers/rich-workspace';

/**
 * Package 11: the reading views against a workspace made by the real CLI, in the real app (AK-10-31 to AK-10-35).
 * The workspace takes about a minute to build.
 */
let env: TestEnv;
let states: StatesWorkspace;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  test.setTimeout(400_000);
  env = await createTestEnv();
  states = await buildStatesWorkspace(env);
  app = await electron.launch({
    args: [APP_ROOT],
    cwd: APP_ROOT,
    colorScheme: null,
    env: { ...(env.env as Record<string, string>), IPA_APP_USER_DATA: env.userData, IPA_APP_NODE: process.execPath },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('navigation', { name: 'Projekte' }).getByRole('button', { name: /zustaende/ })).toBeVisible({ timeout: 30_000 });
});

test.afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

const bar = () => page.getByRole('navigation', { name: 'Bereiche' });

test('zeigt die Übersicht mit den Zählern des echten CLI (AK-10-31, AK-10-33)', async () => {
  await expect(page.getByRole('region', { name: 'Analysen nach Status' })).toContainText('Versuche erschöpft', { timeout: 20_000 });
  await expect(page.getByRole('region', { name: 'Zurückgehalten' })).toContainText('1 Notiz(en)');
  await expect(page.getByRole('region', { name: 'Notizen heute' })).toContainText('8');
  await expect(page.getByRole('region', { name: 'Letzter Lauf' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Letzte Tage' })).toBeVisible();
  // The sidebar dot says warning in words, not only by colour (spec §5.1).
  const row = page.getByRole('navigation', { name: 'Projekte' }).getByRole('button', { name: /zustaende/ });
  await expect(row.getByRole('img', { name: 'Warnung' })).toBeVisible();
  await expect(row).toContainText('offene Analysen');
});

test('liest Tag, Zeitstrahl, Work-Logs, Notizen und Journal, ohne etwas zu verändern (AK-10-35)', async () => {
  const workspaceBefore = await fingerprintRepo(states.project.workspacePath);
  const repoBefore = await fingerprintRepo(states.project.repo.root);

  await bar().getByRole('button', { name: 'Tag', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: formatLongDay(states.today) })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Work-Logs 8$/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Notizen 8$/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Journal/ })).toBeVisible();
  await expect(page.getByText(/Dinge brauchen Aufmerksamkeit|Ding braucht Aufmerksamkeit/)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Zeitstrahl' }).getByRole('button', { name: /Snapshot S000003/ })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Zusammenfassung des Tages' })).toContainText('Zeit gemessen 90 min');

  await page.getByRole('tab', { name: /^Work-Logs/ }).click();
  await page.getByRole('navigation', { name: 'Snapshots des Tages' }).getByRole('button', { name: /S000002/ }).click();
  await expect(page.getByRole('heading', { level: 3, name: 'Work-Log S000002' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /Zusammenfassung/ })).toContainText('KI-Entwurf');
  await page.getByRole('navigation', { name: 'Snapshots des Tages' }).getByRole('button', { name: /S000003/ }).click();
  await expect(page.getByText('Nicht erstellt. Die Analyse ist nicht abgeschlossen.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Datei öffnen' })).toBeDisabled();

  await page.getByRole('tab', { name: /^Notizen/ }).click();
  await page.getByRole('list', { name: 'Notizen' }).getByRole('button', { name: /Zugangswert/ }).click();
  await expect(page.getByRole('list', { name: 'Notizen' }).getByText(/zurückgehalten \(Detektor assignment\)/)).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain(SECRET_MARKER);

  await page.getByRole('tab', { name: /^Journal/ }).click();
  await expect(page.getByRole('combobox', { name: 'Entwürfe' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Gliederung' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /Zeitaufwand/ })).toContainText('vom Tool');

  // Calendar and day change.
  await page.getByRole('button', { name: 'Kalender' }).click();
  await expect(page.getByRole('dialog', { name: 'Kalender' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Vortag' }).click();
  await expect(page.getByRole('heading', { level: 2, name: formatLongDay(states.yesterday) })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('heading', { level: 2, name: formatLongDay(states.today) })).toBeVisible();

  expect(await fingerprintRepo(states.project.workspacePath)).toEqual(workspaceBefore);
  expect(await fingerprintRepo(states.project.repo.root)).toEqual(repoBefore);
});

test('springt von einem Notiz-Chip im Journal zur Notiz (AK-10-30)', async () => {
  await page.getByRole('tab', { name: /^Journal/ }).click();
  const chip = page.locator('.md .chip--ref').filter({ hasText: /^N\d{8}T\d{6}Z-[0-9a-f]{4}$/ }).first();
  await expect(chip).toBeVisible();
  const id = (await chip.textContent()) ?? '';
  await chip.click();
  await expect(page.getByRole('tab', { name: /^Notizen/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(id, { exact: true })).toBeVisible();
});

test('zeigt eine Änderung durch die Konsole ohne Neustart, gemessen (AK-10-34, AO-12)', async () => {
  await page.getByRole('tab', { name: /^Notizen/ }).click();
  await expect(page.getByRole('tab', { name: /^Notizen 8$/ })).toBeVisible();
  const started = Date.now();
  const result = await runCli(env, states.project.repo.root, ['note', '--type', 'general', '--', 'Live-Notiz aus der Konsole']);
  expect(result.exitCode).toBe(0);
  await expect(page.getByRole('tab', { name: /^Notizen 9$/ })).toBeVisible({ timeout: 12_000 });
  const elapsed = Date.now() - started;
  console.log(`LIVE-UPDATE ${elapsed} ms (inklusive Start des CLI)`);
  expect(elapsed).toBeLessThan(4_000);
  await expect(page.getByText('Live-Notiz aus der Konsole')).toBeVisible();
});

test('startet nie Claude und ruft nur erlaubte Befehle von selbst auf (AK-10-15)', async () => {
  const calls = await readFakeCalls(env);
  // The fixture itself made model calls before the app started; none may come from the app afterwards.
  const modelCalls = calls.filter((call) => call.kind === 'model-call').length;
  await page.getByRole('navigation', { name: 'Projekte' }).getByRole('button', { name: /zustaende/ }).click();
  await bar().getByRole('button', { name: 'Übersicht' }).click();
  await bar().getByRole('button', { name: 'Tag', exact: true }).click();
  await page.waitForTimeout(800);
  expect((await readFakeCalls(env)).filter((call) => call.kind === 'model-call')).toHaveLength(modelCalls);
});
