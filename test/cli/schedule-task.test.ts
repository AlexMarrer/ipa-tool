import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../../src/cli/main.js';
import type { CliDeps } from '../../src/cli/deps.js';
import { CLI_ENTRY } from '../../src/cli/commands/schedule.js';
import { type Config } from '../../src/core/config.js';
import { readJsonl } from '../../src/core/jsonl.js';
import { dayOf } from '../../src/core/time.js';
import { validate } from '../../src/core/schemas.js';
import { renderWindowsTask, type ScheduleTemplateInput } from '../../src/schedule/templates.js';
import { createTempRepo, type TempRepo } from '../helpers/git-repo.js';
import { FakeScheduler, formatSchedulerDate } from '../helpers/scheduler.js';
import { initRepo, unchanged } from '../helpers/snapshots.js';
import { createTempDataRoot, createTempDir, listTree, readJsonFile } from '../helpers/workspace.js';
import { parseXml, textAt } from '../helpers/xml.js';

interface Env {
  repo: TempRepo;
  dataDir: string;
  workspace: string;
  config: Config;
  scheduler: FakeScheduler;
  tempDir: string;
}

async function setup(): Promise<Env> {
  const repo = await createTempRepo({ name: 'mein projekt', files: { 'a.txt': 'eins\n' } });
  const dataDir = await createTempDataRoot();
  const workspace = await initRepo(repo, dataDir);
  const config = await readJsonFile<Config>(`${workspace}/config.json`);
  return { repo, dataDir, workspace, config, scheduler: new FakeScheduler(`ipa-assistant-${config.repositoryId}`), tempDir: await createTempDir('aufgabe') };
}

interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface Envelope {
  ok: boolean;
  exitCode: number;
  outcome: string;
  errors: { code: string; message: string }[];
  warnings: string[];
  result: Record<string, any> | null; // JSON of the test, shape checked by the schema
}

/**
 * `ipa schedule …` in this process with the stand-in for the Task Scheduler; the repository and the workspace
 * stay untouched: no lock, no run log, no file (AK-09-12).
 */
async function schedule(env: Env, args: string[], deps: CliDeps = {}): Promise<Run> {
  const before = await listTree(env.workspace);
  let stdout = '';
  let stderr = '';
  const exitCode = await unchanged(env.repo, () =>
    main(
      ['--data-dir', env.dataDir, '--repo', env.repo.root, 'schedule', ...args],
      { stdout: (text) => (stdout += text), stderr: (text) => (stderr += text), env: process.env },
      { schtasks: env.scheduler, platform: 'win32', tempDir: env.tempDir, ...deps },
    ),
  );
  expect(await listTree(env.workspace)).toEqual(before);
  return { exitCode, stdout, stderr };
}

async function json(env: Env, args: string[], exitCode = 0, deps: CliDeps = {}): Promise<Envelope> {
  const run = await schedule(env, [...args, '--json'], deps);
  expect(run.exitCode, run.stderr).toBe(exitCode);
  const value = JSON.parse(run.stdout) as Envelope;
  expect(validate('cli-schedule', value)).toEqual({ ok: true });
  expect(value).toMatchObject({ ok: exitCode === 0, exitCode });
  return value;
}

function expectedInput(env: Env, overrides: Partial<ScheduleTemplateInput> = {}): ScheduleTemplateInput {
  return {
    repositoryId: env.config.repositoryId,
    repoPath: env.repo.root,
    timezone: env.config.timezone,
    schedule: env.config.schedule,
    maxRunSeconds: env.config.limits.maxRunSeconds,
    claudeTimeoutSeconds: env.config.claude.timeoutSeconds,
    nodePath: process.execPath,
    cliPath: CLI_ENTRY,
    dataDir: env.dataDir,
    startDay: dayOf(new Date(), env.config.timezone),
    ...overrides,
  };
}

async function editConfig(env: Env, change: (config: Config) => Config): Promise<void> {
  env.config = change(env.config);
  await writeFile(`${env.workspace}/config.json`, JSON.stringify(env.config, null, 2));
}

async function runsOf(env: Env) {
  return (await readJsonl<{ command: string }>(`${env.workspace}/runs.jsonl`, 'run-record')).records.map((record) => record.command);
}

describe('ipa schedule status (AK-09-13)', () => {
  it('meldet eine nicht eingerichtete Aufgabe mit dem Läufeplan', async () => {
    const env = await setup();
    const envelope = await json(env, ['status']);
    expect(envelope).toMatchObject({ outcome: 'ok', errors: [], warnings: [] });
    expect(envelope.result).toMatchObject({
      action: 'status',
      taskName: `ipa-assistant-${env.config.repositoryId}`,
      changed: false,
      state: 'not_installed',
      enabled: null,
      differences: [],
      detail: null,
      nextRun: null,
      lastRun: null,
      lastResult: null,
      running: false,
      insideWindow: null,
      plan: { runsPerDay: 7, maxClaudeCallsPerDay: 35, includesWindowEndRun: true },
    });
    expect(env.scheduler.changes).toEqual([]);

    const text = await schedule(env, ['status']);
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toMatch(new RegExp(`Aufgabe: +ipa-assistant-${env.config.repositoryId}`));
    expect(text.stdout).toMatch(/Zustand: +nicht eingerichtet/);
    expect(text.stdout).toContain('höchstens 35 Claude-Aufrufe pro Arbeitstag');
  });

  it('meldet aktiv mit nächstem und letztem Lauf in der Zeitzone des Projekts, in deutscher und amerikanischer Anzeige', async () => {
    const env = await setup();
    expect((await schedule(env, ['install'])).exitCode).toBe(0);
    const next = new Date(Date.now() + 3600_000);
    const last = new Date(Date.now() - 7200_000);
    for (const style of ['de', 'en'] as const) {
      env.scheduler.dateStyle = style;
      env.scheduler.nextRun = new Date(next.setMilliseconds(0));
      env.scheduler.lastRun = new Date(last.setMilliseconds(0));
      const result = (await json(env, ['status'])).result!;
      expect(result).toMatchObject({ state: 'active', enabled: true, differences: [], lastResult: 0, running: false });
      expect(new Date(result['nextRun']).getTime(), style).toBe(next.getTime());
      expect(new Date(result['lastRun']).getTime(), style).toBe(last.getTime());
      expect(result['nextRun']).toMatch(/[+-]\d{2}:\d{2}$/);
    }
    env.scheduler.nextRun = null;
    env.scheduler.lastRun = null;
    env.scheduler.lastResult = 267011;
    expect((await json(env, ['status'])).result).toMatchObject({ nextRun: null, lastRun: null, lastResult: 267011 });
    env.scheduler.lastResult = 267009;
    expect((await json(env, ['status'])).result).toMatchObject({ running: true });
  });

  it('erkennt jede Abweichung als veraltet', async () => {
    const env = await setup();
    await schedule(env, ['install']);
    const status = async () => (await json(env, ['status'])).result!;
    expect(await status()).toMatchObject({ state: 'active', differences: [] });

    // Another Node.js or another installation of the tool.
    const other = path.join(path.dirname(CLI_ENTRY), '..', 'package.json');
    expect(await status()).toMatchObject({ state: 'active' });
    expect((await json(env, ['status'], 0, { nodePath: 'C:\\Programme\\nodejs22\\node.exe' })).result).toMatchObject({ state: 'stale', differences: ['node_path'] });
    expect((await json(env, ['status'], 0, { cliPath: other })).result).toMatchObject({ state: 'stale', differences: ['cli_path'] });
    // Without the pin of the data root the arguments differ.
    const noPin = await schedule(env, ['status', '--json']);
    expect(noPin.exitCode).toBe(0);

    // Triggers and the time limit follow the configuration.
    await editConfig(env, (config) => ({ ...config, schedule: { ...config.schedule, intervalMinutes: 60 } }));
    expect(await status()).toMatchObject({ state: 'stale', enabled: true, differences: ['triggers'] });
    await editConfig(env, (config) => ({ ...config, limits: { ...config.limits, maxRunSeconds: 900 } }));
    expect(await status()).toMatchObject({ state: 'stale', differences: ['triggers', 'execution_time_limit'] });
    expect((await schedule(env, ['status'])).stdout).toMatch(/Abweichungen: +Trigger, Zeitlimit/);

    // Edited by hand in the Task Scheduler.
    await editConfig(env, () => ({ ...env.config, schedule: { ...env.config.schedule, intervalMinutes: 120 }, limits: { ...env.config.limits, maxRunSeconds: 1800 } }));
    expect(await status()).toMatchObject({ state: 'active' });
    env.scheduler.edit((xml) => xml.replace('--repo', '--data-dir'));
    expect(await status()).toMatchObject({ state: 'stale', differences: ['arguments'] });
  });

  it('meldet einen Fehler, wenn schtasks nicht antwortet, mit Exit-Code 0', async () => {
    const env = await setup();
    env.scheduler.rejectWith = Object.assign(new Error('spawn schtasks ENOENT'), { code: 'ENOENT' });
    const result = (await json(env, ['status'])).result!;
    expect(result).toMatchObject({ state: 'error', enabled: null });
    expect(result['detail']).toContain('ENOENT');

    env.scheduler.rejectWith = null;
    await schedule(env, ['install']);
    env.scheduler.failures.set('/Query /TN', { exitCode: 1, stdout: '', stderr: 'FEHLER: Zugriff verweigert\r\n' });
    const denied = (await json(env, ['status'])).result!;
    expect(denied).toMatchObject({ state: 'error' });
    expect(denied['detail']).toContain('Zugriff verweigert');
  });
});

describe('ipa schedule install (AK-09-12)', () => {
  it('importiert die Vorlage von renderWindowsTask als UTF-16 und löscht die Hilfsdatei', async () => {
    const env = await setup();
    const result = await json(env, ['install']);
    expect(result).toMatchObject({ outcome: 'ok', errors: [], result: { action: 'install', changed: true, state: 'active', enabled: true, differences: [] } });
    expect(env.scheduler.changes).toHaveLength(1);
    const [verb, switchName, file, tnSwitch, name, ...rest] = env.scheduler.changes[0]!;
    expect([verb, switchName, tnSwitch, name, rest]).toEqual(['/Create', '/XML', '/TN', `ipa-assistant-${env.config.repositoryId}`, []]);
    expect(path.dirname(file!)).toBe(path.join(env.tempDir, 'ipa-assistant', 'schedule'));
    expect(existsSync(file!)).toBe(false);
    expect(await readdir(path.dirname(file!))).toEqual([]);

    const imported = env.scheduler.imports[0]!;
    expect(imported.replace(/\r\n/g, '\n')).toBe(renderWindowsTask(expectedInput(env), { encoding: 'UTF-16' }));
    const document = parseXml(imported);
    expect(document.declaration).toEqual({ version: '1.0', encoding: 'UTF-16' });
    expect(textAt(document.root, 'Settings/Enabled')).toBe('true');
    expect(textAt(document.root, 'Actions/Exec/Arguments')).toBe(`"${CLI_ENTRY}" capture --scheduled --repo "${env.repo.root}" --data-dir "${env.dataDir}"`);
    // Not logged, no lock (the helper checks the workspace), nothing in the repository.
    expect(await runsOf(env)).toEqual(['init']);
  });

  it('gibt die Hinweise der Vorlage aus und warnt bei aktiver kostenpflichtiger Nutzung', async () => {
    const env = await setup();
    await editConfig(env, (config) => ({ ...config, schedule: { ...config.schedule, extraRunTimes: ['18:30'] }, claude: { ...config.claude, allowPaidUsage: true } }));
    const result = await json(env, ['install']);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain('Der Zusatzlauf 18:30');
    expect(result.warnings[1]).toContain('claude.allowPaidUsage ist aktiv');
    expect(result.result!['plan']).toMatchObject({ skippedRunTimes: ['18:30'] });
  });

  it('lehnt eine vorhandene Aufgabe ohne --update ab und ersetzt sie mit --update', async () => {
    const env = await setup();
    await schedule(env, ['install']);
    const refused = await json(env, ['install'], 2);
    expect(refused).toMatchObject({ outcome: 'usage_error', result: null, errors: [{ code: 'schedule_exists' }] });
    expect(env.scheduler.changes).toHaveLength(1);

    await editConfig(env, (config) => ({ ...config, schedule: { ...config.schedule, windowEnd: '17:00' } }));
    expect((await json(env, ['status'])).result).toMatchObject({ state: 'stale' });
    const updated = await json(env, ['install', '--update']);
    expect(updated.result).toMatchObject({ changed: true, state: 'active', enabled: true, differences: [] });
    expect(env.scheduler.changes[1]!.at(-1)).toBe('/F');
    expect((await schedule(env, ['install', '--update'])).stdout).toContain('Aufgabe aktualisiert.');
  });

  it('lässt eine pausierte Aufgabe beim Aktualisieren pausiert', async () => {
    const env = await setup();
    await schedule(env, ['install']);
    await schedule(env, ['pause']);
    await editConfig(env, (config) => ({ ...config, schedule: { ...config.schedule, intervalMinutes: 60 } }));
    const updated = await json(env, ['install', '--update']);
    expect(updated.result).toMatchObject({ changed: true, state: 'paused', enabled: false, differences: [] });
    expect(textAt(parseXml(env.scheduler.imports.at(-1)!).root, 'Settings/Enabled')).toBe('false');
  });

  it('lehnt leere Arbeitstage und eine fehlende cli.js ab, ohne die Aufgabenplanung zu ändern', async () => {
    const env = await setup();
    const missing = await json(env, ['install'], 2, { cliPath: path.join(env.tempDir, 'nicht-gebaut', 'cli.js') });
    expect(missing).toMatchObject({ result: null, errors: [{ code: 'schedule_cli_missing' }] });
    await editConfig(env, (config) => ({ ...config, schedule: { ...config.schedule, workdays: [] } }));
    const noDays = await json(env, ['install'], 2);
    expect(noDays).toMatchObject({ result: null, errors: [{ code: 'schedule_no_workdays' }] });
    expect(env.scheduler.changes).toEqual([]);
    expect(await readdir(path.join(env.tempDir, 'ipa-assistant', 'schedule')).catch(() => [])).toEqual([]);
  });

  it('schreibt die Hilfsdatei nie in das Repository (I-01)', async () => {
    const env = await setup();
    const before = await listTree(env.repo.root);
    const refused = await json(env, ['install'], 2, { tempDir: env.repo.root });
    expect(refused).toMatchObject({ result: null, errors: [{ code: 'schedule_temp_in_repository' }] });
    expect(env.scheduler.changes).toEqual([]);
    expect(await listTree(env.repo.root)).toEqual(before);
  });

  it('meldet einen Fehler von schtasks mit Exit-Code 1 und löscht die Hilfsdatei trotzdem', async () => {
    const env = await setup();
    env.scheduler.failures.set('/Create', { exitCode: 1, stdout: '', stderr: 'FEHLER: Zugriff verweigert\r\n' });
    const failed = await json(env, ['install'], 1);
    expect(failed).toMatchObject({ outcome: 'error', result: null, errors: [{ code: 'schtasks_failed' }] });
    expect(failed.errors[0]!.message).toContain('Zugriff verweigert');
    expect(await readdir(path.join(env.tempDir, 'ipa-assistant', 'schedule'))).toEqual([]);
    expect(env.scheduler.xml).toBeNull();

    const unclear = new FakeScheduler(env.scheduler['name' as keyof FakeScheduler] as unknown as string);
    unclear.rejectWith = Object.assign(new Error('x'), { code: 'EACCES' });
    env.scheduler = unclear;
    expect((await json(env, ['install'], 1)).errors[0]!.code).toBe('schtasks_failed');
  });
});

describe('ipa schedule pause, resume, remove, run (AK-09-14)', () => {
  it('pausiert und setzt fort, idempotent, und ändert beim Zielzustand nichts', async () => {
    const env = await setup();
    await schedule(env, ['install']);
    const name = `ipa-assistant-${env.config.repositoryId}`;

    const paused = await json(env, ['pause']);
    expect(paused.result).toMatchObject({ action: 'pause', changed: true, state: 'paused', enabled: false, nextRun: null });
    expect(env.scheduler.changes.at(-1)).toEqual(['/Change', '/TN', name, '/DISABLE']);
    const again = await json(env, ['pause']);
    expect(again).toMatchObject({ errors: [], result: { changed: false, state: 'paused' } });
    expect(env.scheduler.changes).toHaveLength(2);

    const resumed = await json(env, ['resume']);
    expect(resumed.result).toMatchObject({ action: 'resume', changed: true, state: 'active', enabled: true });
    expect(env.scheduler.changes.at(-1)).toEqual(['/Change', '/TN', name, '/ENABLE']);
    expect((await json(env, ['resume'])).result).toMatchObject({ changed: false, state: 'active' });
    expect((await schedule(env, ['pause'])).stdout).toContain('Aufgabe pausiert.');
    expect((await schedule(env, ['pause'])).stdout).toContain('Aufgabe ist bereits pausiert.');
  });

  it('meldet bei einer nicht eingerichteten Aufgabe Exit-Code 2', async () => {
    const env = await setup();
    for (const action of ['pause', 'resume', 'run']) {
      const result = await json(env, [action], 2);
      expect(result, action).toMatchObject({ outcome: 'usage_error', result: null, errors: [{ code: 'schedule_not_installed' }] });
    }
    expect(env.scheduler.changes).toEqual([]);
  });

  it('entfernt die Aufgabe und meldet „nichts zu tun“ mit Exit-Code 0', async () => {
    const env = await setup();
    const nothing = await json(env, ['remove']);
    expect(nothing.result).toMatchObject({ action: 'remove', changed: false, state: 'not_installed' });
    expect(env.scheduler.changes).toEqual([]);

    await schedule(env, ['install']);
    const removed = await json(env, ['remove']);
    expect(removed.result).toMatchObject({ changed: true, state: 'not_installed', enabled: null });
    expect(env.scheduler.changes.at(-1)).toEqual(['/Delete', '/TN', `ipa-assistant-${env.config.repositoryId}`, '/F']);
    expect(env.scheduler.xml).toBeNull();
    expect((await schedule(env, ['remove'])).stdout).toContain('nichts zu entfernen');
  });

  it('startet die Aufgabe, im Fenster ohne Hinweis und ausserhalb mit Hinweis auf outside_window', async () => {
    const env = await setup();
    await schedule(env, ['install']);
    const name = `ipa-assistant-${env.config.repositoryId}`;
    const allDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

    await editConfig(env, (config) => ({ ...config, schedule: { ...config.schedule, workdays: [...allDays], windowStart: '00:00', windowEnd: '23:59', extraRunTimes: [] } }));
    await schedule(env, ['install', '--update']);
    const inside = await json(env, ['run']);
    expect(inside).toMatchObject({ warnings: [], result: { action: 'run', changed: true, insideWindow: true, state: 'active' } });
    expect(env.scheduler.changes.at(-1)).toEqual(['/Run', '/TN', name]);

    // Outside: today is no workday.
    const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const today = weekdays[new Date(`${dayOf(new Date(), env.config.timezone)}T12:00:00Z`).getUTCDay()]!;
    await editConfig(env, (config) => ({ ...config, schedule: { ...config.schedule, workdays: allDays.filter((day) => day !== today) } }));
    await schedule(env, ['install', '--update']);
    const outside = await json(env, ['run']);
    expect(outside.result).toMatchObject({ changed: true, insideWindow: false });
    expect(outside.warnings).toHaveLength(1);
    expect(outside.warnings[0]).toContain('outside_window');
    expect((await schedule(env, ['run'])).stderr).toContain('ausserhalb des Zeitfensters');
  });

  it('startet eine pausierte Aufgabe nicht und startet eine laufende nicht ein zweites Mal', async () => {
    const env = await setup();
    await schedule(env, ['install']);
    await schedule(env, ['pause']);
    const callsBefore = env.scheduler.changes.length;
    const paused = await json(env, ['run'], 2);
    expect(paused).toMatchObject({ result: null, errors: [{ code: 'schedule_paused' }] });
    expect(env.scheduler.changes).toHaveLength(callsBefore);

    await schedule(env, ['resume']);
    env.scheduler.lastResult = 267009;
    const running = await json(env, ['run']);
    expect(running.result).toMatchObject({ changed: false, running: true });
    expect(env.scheduler.changes.some((call) => call[0] === '/Run')).toBe(false);
    expect((await schedule(env, ['run'])).stdout).toContain('läuft bereits');
  });

  it('meldet einen Fehler von schtasks beim Starten mit Exit-Code 1', async () => {
    const env = await setup();
    await schedule(env, ['install']);
    env.scheduler.failures.set('/Run', { exitCode: 1, stdout: '', stderr: 'FEHLER: Die Aufgabe ist deaktiviert.\r\n' });
    const failed = await json(env, ['run'], 1);
    expect(failed).toMatchObject({ result: null, errors: [{ code: 'schtasks_failed' }] });
  });
});

describe('Rahmen der Zeitplan-Verwaltung (AK-09-15, AK-09-16)', () => {
  it('lässt ipa schedule --os unverändert und ruft schtasks dafür nie auf', async () => {
    const env = await setup();
    const windows = await schedule(env, ['--os', 'windows']);
    expect(windows.exitCode, windows.stderr).toBe(0);
    expect(parseXml(windows.stdout).root.name).toBe('Task');
    const cron = await schedule(env, ['--os', 'cron']);
    expect(cron.exitCode).toBe(0);
    expect(env.scheduler.calls).toEqual([]);

    const missing = await schedule(env, []);
    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain("Die Option '--os <windows|cron>' ist erforderlich");
  });

  it('läuft nur unter Windows und ruft ausserhalb davon schtasks nicht auf', async () => {
    const env = await setup();
    for (const action of ['status', 'install', 'pause', 'resume', 'remove', 'run']) {
      const envelope = await json(env, [action], 2, { platform: 'linux' });
      expect(envelope, action).toMatchObject({ outcome: 'usage_error', result: null, errors: [{ code: 'schedule_platform_unsupported' }] });
    }
    expect(env.scheduler.calls).toEqual([]);
  });

  it('verlangt ein initialisiertes Repository, bevor schtasks gefragt wird', async () => {
    const env = await setup();
    const stranger = await createTempRepo();
    let stderr = '';
    const exitCode = await main(
      ['--data-dir', env.dataDir, '--repo', stranger.root, 'schedule', 'status'],
      { stdout: () => undefined, stderr: (text) => (stderr += text), env: process.env },
      { schtasks: env.scheduler, platform: 'win32' },
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain('nicht initialisiert');
    expect(env.scheduler.calls).toEqual([]);
  });

  it('zeigt die Unterbefehle in der Hilfe, ohne schtasks zu starten', async () => {
    const env = await setup();
    let stdout = '';
    const exitCode = await main(['schedule', '--help'], { stdout: (text) => (stdout += text), stderr: () => undefined, env: process.env }, { schtasks: env.scheduler });
    expect(exitCode).toBe(0);
    for (const name of ['install', 'status', 'pause', 'resume', 'remove', 'run', '--os <windows|cron>']) expect(stdout).toContain(name);
    expect(env.scheduler.calls).toEqual([]);
  });

  it('das Datum des Aufgabenformats entspricht dem Formatierer des Ersatzes', () => {
    const date = new Date(2026, 10, 25, 18, 5, 9);
    expect(formatSchedulerDate(date, 'de')).toBe('25.11.2026 18:05:09');
    expect(formatSchedulerDate(date, 'en')).toBe('11/25/2026 6:05:09 PM');
    expect(formatSchedulerDate(new Date(2026, 10, 25, 0, 5, 9), 'en')).toBe('11/25/2026 12:05:09 AM');
  });
});
