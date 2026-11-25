import { readdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { main } from '../../src/cli/main.js';
import { type Config } from '../../src/core/config.js';
import { readJsonl } from '../../src/core/jsonl.js';
import { type SchemaId, validate } from '../../src/core/schemas.js';
import { createTempRepo, type TempRepo } from '../helpers/git-repo.js';
import { initRepo, unchanged } from '../helpers/snapshots.js';
import { type CliResult, createTempDataRoot, listTree, readJsonFile, runCli } from '../helpers/workspace.js';

interface Env {
  repo: TempRepo;
  dataDir: string;
  workspace: string;
  file: string;
}

async function setup(): Promise<Env> {
  const repo = await createTempRepo({ files: { 'a.txt': 'eins\n' } });
  const dataDir = await createTempDataRoot();
  const workspace = await initRepo(repo, dataDir);
  return { repo, dataDir, workspace, file: `${workspace}/config.json` };
}

/** `ipa config …`; neither the repository nor anything but `config.json` may change, and no run is logged. */
async function config(env: Env, args: string[]): Promise<CliResult> {
  const before = await listTree(env.workspace);
  const runsBefore = (await readJsonl(`${env.workspace}/runs.jsonl`, 'run-record')).records.length;
  const result = await unchanged(env.repo, () => runCli(['config', ...args], { dataDir: env.dataDir, repo: env.repo.root }));
  const after = await listTree(env.workspace);
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (name !== 'config.json') expect(after[name]?.sha256, name).toEqual(before[name]?.sha256);
  }
  expect((await readJsonl(`${env.workspace}/runs.jsonl`, 'run-record')).records).toHaveLength(runsBefore);
  return result;
}

interface Envelope {
  ok: boolean;
  exitCode: number;
  outcome: string;
  errors: { code: string; message: string }[];
  warnings: string[];
  result: Record<string, any> | null; // JSON of the test, shape checked by the schema
}

function parse(result: CliResult): Envelope {
  const value = JSON.parse(result.stdout) as Envelope;
  expect(validate('cli-config' as SchemaId, value)).toEqual({ ok: true });
  expect(result.stdout.endsWith('}\n')).toBe(true);
  return value;
}

const bytes = (file: string) => readFile(file);

describe('ipa config get (AK-09-06)', () => {
  it('gibt die ganze Datei und einzelne Werte aus', async () => {
    const env = await setup();
    const all = await config(env, ['get']);
    expect(all.exitCode, all.stderr).toBe(0);
    expect(JSON.parse(all.stdout)).toEqual(await readJsonFile(env.file));

    const value = await config(env, ['get', 'schedule.workdays']);
    expect(JSON.parse(value.stdout)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
    expect((await config(env, ['get', 'claude.model'])).stdout).toBe('null\n');
    expect((await config(env, ['get', 'claude.maxAnalysesPerRun'])).stdout).toBe('5\n');
  });

  it('liefert mit --json die Hülle mit Pfad und Wert', async () => {
    const env = await setup();
    const envelope = parse(await config(env, ['get', 'limits.maxRunSeconds', '--json']));
    expect(envelope).toMatchObject({ ok: true, exitCode: 0, outcome: 'ok', errors: [], result: { action: 'get', path: 'limits.maxRunSeconds', value: 1800, valid: null, written: false } });
    expect(envelope.result!['configPath']).toBe(env.file);
    const whole = parse(await config(env, ['get', '--json']));
    expect(whole.result!['path']).toBeNull();
    expect(whole.result!['value']).toEqual(await readJsonFile(env.file));
  });

  it('lehnt einen unbekannten Pfad mit Exit-Code 2 ab', async () => {
    const env = await setup();
    for (const path of ['gibt.es.nicht', 'claude.toString', 'schedule.workdays.mon']) {
      const result = await config(env, ['get', path]);
      expect(result.exitCode, path).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('gibt es in config.json nicht');
    }
    const json = parse(await config(env, ['get', 'gibt.es.nicht', '--json']));
    expect(json).toMatchObject({ ok: false, exitCode: 2, outcome: 'usage_error', result: null, errors: [{ code: 'config_path_unknown' }] });
  });

  it('verlangt ein initialisiertes Repository', async () => {
    const env = await setup();
    const stranger = await createTempRepo();
    const result = await runCli(['config', 'get'], { dataDir: env.dataDir, repo: stranger.root });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('nicht initialisiert');
  });
});

describe('ipa config check (AK-09-07)', () => {
  it('meldet die Standardkonfiguration als gültig und zeigt den Läufeplan', async () => {
    const env = await setup();
    const result = await config(env, ['check']);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('config.json ist gültig.');
    expect(result.stdout).toContain('höchstens 35 Claude-Aufrufe pro Arbeitstag');
    const json = parse(await config(env, ['check', '--json']));
    expect(json.result).toMatchObject({ action: 'check', valid: true, findings: [], schedulePlan: { runsPerDay: 7, maxClaudeCallsPerDay: 35 } });
  });

  it('meldet Warnungen mit Exit-Code 0 und Fehler mit Exit-Code 2', async () => {
    const env = await setup();
    const current = await readJsonFile<Config>(env.file);
    await writeFile(
      env.file,
      JSON.stringify({ ...current, schedule: { ...current.schedule, extraRunTimes: ['18:30'], intervalMinutes: 720 }, claude: { ...current.claude, timeoutSeconds: 900 } }, null, 2),
    );
    const warned = await config(env, ['check']);
    expect(warned.exitCode, warned.stderr).toBe(0);
    expect(warned.stdout).toContain('(3 Warnungen)');
    expect(warned.stderr).toContain('Warnung: /schedule/extraRunTimes/0: Der Zusatzlauf 18:30');
    expect(warned.stderr).toContain('Hinweis: /schedule/intervalMinutes: schedule.intervalMinutes (720)');
    expect(warned.stderr).toContain('Warnung: /claude/timeoutSeconds: claude.timeoutSeconds (900 s)');
    const warnedJson = parse(await config(env, ['check', '--json']));
    expect(warnedJson).toMatchObject({ ok: true, errors: [], result: { valid: true } });
    expect(warnedJson.result!['findings'].map((finding: { code: string }) => finding.code)).toEqual([
      'schedule_extra_outside_window',
      'schedule_interval_exceeds_window',
      'claude_timeout_exceeds_reserve',
    ]);
    expect(warnedJson.warnings).toHaveLength(3);

    await writeFile(env.file, JSON.stringify({ ...current, schedule: { ...current.schedule, workdays: [] } }, null, 2));
    const failed = await config(env, ['check']);
    expect(failed.exitCode).toBe(2);
    expect(failed.stdout).toContain('config.json ist ungültig (1 Fehler');
    expect(failed.stderr).toContain('Fehler: /schedule/workdays: schedule.workdays ist leer');
    const failedJson = parse(await config(env, ['check', '--json']));
    expect(failedJson).toMatchObject({ ok: false, exitCode: 2, outcome: 'usage_error', errors: [{ code: 'schedule_no_workdays' }], result: { valid: false } });
  });

  it('meldet eine ungültige Datei, statt abzubrechen, auch bei Syntaxfehlern', async () => {
    const env = await setup();
    const current = await readJsonFile<Config>(env.file);
    await writeFile(env.file, JSON.stringify({ ...current, timezone: 'Mars/Olympus', limits: { ...current.limits, maxFileBytes: 0 }, unbekannt: 1 }, null, 2));
    const broken = parse(await config(env, ['check', '--json']));
    expect(broken.exitCode).toBe(2);
    expect(broken.result!['schedulePlan']).toBeNull();
    expect(broken.result!['findings'].map((finding: { path: string }) => finding.path).sort()).toEqual(['/limits/maxFileBytes', '/unbekannt']);

    await writeFile(env.file, JSON.stringify({ ...current, timezone: 'Mars/Olympus' }, null, 2));
    expect(parse(await config(env, ['check', '--json'])).result!['findings']).toEqual([
      { severity: 'error', code: 'timezone_unknown', path: '/timezone', message: expect.stringContaining('Mars/Olympus') },
    ]);

    await writeFile(env.file, '{ "schemaVersion": 1,');
    const syntax = parse(await config(env, ['check', '--json']));
    expect(syntax.exitCode).toBe(2);
    expect(syntax.result!['findings']).toEqual([{ severity: 'error', code: 'json_invalid', path: '/', message: expect.stringContaining('Kein gültiges JSON') }]);
    // Every other command refuses an invalid file with exit code 2 (spec.md §7.2).
    expect((await runCli(['status'], { dataDir: env.dataDir, repo: env.repo.root })).exitCode).toBe(2);
  });

  it('meldet eine falsche repositoryId und einen falschen Repository-Pfad', async () => {
    const env = await setup();
    const current = await readJsonFile<Config>(env.file);
    await writeFile(env.file, JSON.stringify({ ...current, repositoryId: 'anderes-000000', repository: { path: 'C:/GIT/anderes' } }, null, 2));
    const result = parse(await config(env, ['check', '--json']));
    expect(result.result!['findings'].map((finding: { code: string; path: string }) => `${finding.code}${finding.path}`)).toEqual(['config_mismatch/repositoryId', 'config_mismatch/repository/path']);
  });
});

describe('ipa config set (AK-09-08)', () => {
  it('schreibt geprüfte Änderungen atomar und lässt alles andere unverändert', async () => {
    const env = await setup();
    const before = await readJsonFile<Config>(env.file);
    const result = await config(env, ['set', 'claude.maxTurns=7', 'schedule.extraRunTimes=["17:30","12:00"]', 'claude.model=opus']);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('config.json aktualisiert: claude.maxTurns, schedule.extraRunTimes, claude.model.');
    expect(result.stdout).toContain('Läufe pro Arbeitstag: 08:00, 10:00, 12:00, 14:00, 16:00, 17:30, 18:00 (7 Läufe); höchstens 35');
    expect(result.stderr).toContain('Hinweis: Eine bereits eingerichtete Aufgabe');

    const after = await readJsonFile<Config>(env.file);
    expect(after).toEqual({
      ...before,
      claude: { ...before.claude, maxTurns: 7, model: 'opus' },
      schedule: { ...before.schedule, extraRunTimes: ['17:30', '12:00'] },
    });
    // Formatted like every file the tool writes, and without a leftover of the temporary file.
    expect((await bytes(env.file)).toString('utf8')).toBe(`${JSON.stringify(after, null, 2)}\n`);
    expect((await readdir(env.workspace)).filter((name) => name.includes('.tmp-'))).toEqual([]);
    // The next run loads the new configuration.
    expect((await runCli(['status'], { dataDir: env.dataDir, repo: env.repo.root })).exitCode).toBe(0);
  });

  it('lässt die Datei bei einem Fehler Byte für Byte unverändert (Exit-Code 2)', async () => {
    const env = await setup();
    const before = await bytes(env.file);
    const cases: [string[], string][] = [
      [['claude.maxTurns=0'], '/claude/maxTurns'],
      [['claude.maxTurns="viele"'], '/claude/maxTurns'],
      [['schedule.windowStart="19:00"'], '/schedule/windowStart'],
      [['schedule.workdays=[]'], '/schedule/workdays'],
      [['schedule.workdays=["mon","mon"]'], '/schedule/workdays'],
      [['secrets.extraPatterns=["[offen"]'], '/secrets/extraPatterns/0'],
      [['gibt.nicht=1'], ''],
      [['claude.maxTurns'], ''],
      [['paths.include=**'], '/paths/include'],
      [['claude.maxTurns=3', 'claude.maxTurns=0'], '/claude/maxTurns'],
    ];
    for (const [args, pointer] of cases) {
      const result = await config(env, ['set', ...args]);
      expect(result.exitCode, args.join(' ')).toBe(2);
      expect(result.stdout, args.join(' ')).toBe('');
      if (pointer !== '') expect(result.stderr, args.join(' ')).toContain(pointer);
      expect(await bytes(env.file), args.join(' ')).toEqual(before);
    }
    expect((await readdir(env.workspace)).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('lehnt leere Arbeitstage mit dem Code schedule_no_workdays ab (AK-09-07)', async () => {
    const env = await setup();
    const before = await bytes(env.file);
    const json = parse(await config(env, ['set', 'schedule.workdays=[]', '--json']));
    expect(json).toMatchObject({ ok: false, exitCode: 2, errors: [{ code: 'schedule_no_workdays' }], result: { valid: false, written: false, schedulePlan: { runsPerDay: 0, maxClaudeCallsPerDay: 0 } } });
    expect(await bytes(env.file)).toEqual(before);
  });

  it('speichert Warnungen mit, meldet sie aber (AK-09-07)', async () => {
    const env = await setup();
    const result = parse(await config(env, ['set', 'schedule.extraRunTimes=["18:30"]', '--json']));
    expect(result).toMatchObject({ ok: true, result: { valid: true, written: true, findings: [{ severity: 'warning', code: 'schedule_extra_outside_window' }] } });
    expect(result.warnings.some((line) => line.startsWith('Warnung: /schedule/extraRunTimes/0'))).toBe(true);
    expect(result.result!['schedulePlan']).toMatchObject({ skippedRunTimes: ['18:30'], runsPerDay: 6, maxClaudeCallsPerDay: 30 });
    expect((await readJsonFile<Config>(env.file)).schedule.extraRunTimes).toEqual(['18:30']);
  });

  it('prüft mit --dry-run, ohne zu schreiben', async () => {
    const env = await setup();
    const before = await bytes(env.file);
    const ok = await config(env, ['set', 'claude.maxTurns=9', '--dry-run']);
    expect(ok.exitCode, ok.stderr).toBe(0);
    expect(ok.stdout).toContain('Nur geprüft (--dry-run), config.json ist unverändert: claude.maxTurns.');
    expect(await bytes(env.file)).toEqual(before);
    const json = parse(await config(env, ['set', 'claude.maxTurns=9', '--dry-run', '--json']));
    expect(json.result).toMatchObject({ valid: true, written: false, dryRun: true, changes: [{ path: 'claude.maxTurns', before: 5, after: 9 }] });
    const bad = await config(env, ['set', 'claude.maxTurns=0', '--dry-run']);
    expect(bad.exitCode).toBe(2);
    expect(await bytes(env.file)).toEqual(before);
  });

  it('lässt repositoryId, repository.path, timezone und schemaVersion nicht ändern (AK-09-09)', async () => {
    const env = await setup();
    const before = await bytes(env.file);
    for (const assignment of ['timezone=UTC', 'repositoryId=anderes-000000', 'repository.path=C:/GIT/anderes', 'repository={"path":"C:/GIT/anderes"}', 'schemaVersion=2']) {
      const json = parse(await config(env, ['set', assignment, '--json']));
      expect(json.exitCode, assignment).toBe(2);
      expect(json.errors.map((error) => error.code), assignment).toContain(assignment.startsWith('schemaVersion') ? 'schema_version_unsupported' : 'config_immutable');
      expect(json.result).toMatchObject({ valid: false, written: false });
      expect(await bytes(env.file), assignment).toEqual(before);
    }
    // The unchanged value is no change.
    expect((await config(env, ['set', 'timezone="Europe/Zurich"'])).exitCode).toBe(0);
  });

  it('schaltet claude.allowPaidUsage nur mit --confirm-paid-usage ein (AK-09-10)', async () => {
    const env = await setup();
    expect((await readJsonFile<Config>(env.file)).claude.allowPaidUsage).toBe(false);
    const before = await bytes(env.file);
    for (const args of [['claude.allowPaidUsage=true'], ['claude={"command":["claude"],"model":null,"timeoutSeconds":600,"maxTurns":5,"maxAttemptsPerSnapshot":3,"maxAnalysesPerRun":5,"allowPaidUsage":true}']]) {
      const refused = parse(await config(env, ['set', ...args, '--json']));
      expect(refused).toMatchObject({ ok: false, exitCode: 2, errors: [{ code: 'paid_usage_confirmation_required' }], result: { written: false } });
      expect(refused.errors[0]!.message).toContain('--confirm-paid-usage');
      expect(await bytes(env.file)).toEqual(before);
    }
    // Other changes never touch the value, and the flag alone sets nothing.
    expect((await config(env, ['set', 'claude.maxTurns=2'])).exitCode).toBe(0);
    expect((await config(env, ['set', 'claude.maxTurns=3', '--confirm-paid-usage'])).exitCode).toBe(0);
    expect((await readJsonFile<Config>(env.file)).claude.allowPaidUsage).toBe(false);
    expect((await config(env, ['set', 'claude.allowPaidUsage=false', '--confirm-paid-usage'])).exitCode).toBe(0);
    expect((await readJsonFile<Config>(env.file)).claude.allowPaidUsage).toBe(false);

    const confirmed = await config(env, ['set', 'claude.allowPaidUsage=true', '--confirm-paid-usage']);
    expect(confirmed.exitCode, confirmed.stderr).toBe(0);
    expect(confirmed.stderr).toContain('Warnung: claude.allowPaidUsage ist aktiv');
    expect((await readJsonFile<Config>(env.file)).claude.allowPaidUsage).toBe(true);

    // Once on, further changes need no flag; switching off never does.
    expect((await config(env, ['set', 'claude.maxTurns=4'])).exitCode).toBe(0);
    expect((await readJsonFile<Config>(env.file)).claude.allowPaidUsage).toBe(true);
    const off = await config(env, ['set', 'claude.allowPaidUsage=false']);
    expect(off.exitCode, off.stderr).toBe(0);
    expect((await readJsonFile<Config>(env.file)).claude.allowPaidUsage).toBe(false);
  });

  it('legt allowPaidUsage in einer älteren Konfiguration ohne dieses Feld nur mit dem Flag an', async () => {
    const env = await setup();
    const current = await readJsonFile<Config>(env.file);
    delete current.claude.allowPaidUsage;
    await writeFile(env.file, JSON.stringify(current, null, 2));
    expect((await config(env, ['set', 'claude.allowPaidUsage=true'])).exitCode).toBe(2);
    expect((await readJsonFile<Config>(env.file)).claude.allowPaidUsage).toBeUndefined();
    expect((await config(env, ['set', 'claude.allowPaidUsage=true', '--confirm-paid-usage'])).exitCode).toBe(0);
    expect((await readJsonFile<Config>(env.file)).claude.allowPaidUsage).toBe(true);
  });

  it('ersetzt die Datei nicht, wenn sie sich während der Prüfung geändert hat (config_changed)', async () => {
    const env = await setup();
    const handEdited = async () => {
      const current = await readJsonFile<Config>(env.file);
      await writeFile(env.file, JSON.stringify({ ...current, claude: { ...current.claude, maxTurns: 4 } }, null, 2));
    };
    let stdout = '';
    let stderr = '';
    const exitCode = await main(['--data-dir', env.dataDir, '--repo', env.repo.root, 'config', 'set', 'claude.maxAnalysesPerRun=9', '--json'], {
      stdout: (text) => (stdout += text),
      stderr: (text) => (stderr += text),
      env: process.env,
    }, { beforeConfigWrite: handEdited });
    expect(exitCode, stderr).toBe(2);
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, result: null, errors: [{ code: 'config_changed' }] });
    // The hand edit stays; the change of the command was not applied.
    const after = await readJsonFile<Config>(env.file);
    expect(after.claude).toMatchObject({ maxTurns: 4, maxAnalysesPerRun: 5 });
    expect((await readdir(env.workspace)).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('übernimmt Handänderungen an anderen Feldern, weil nur die genannten Pfade ersetzt werden', async () => {
    const env = await setup();
    const current = await readJsonFile<Config>(env.file);
    await writeFile(env.file, JSON.stringify({ ...current, claude: { ...current.claude, maxTurns: 4 } }, null, 2));
    expect((await config(env, ['set', 'claude.maxAnalysesPerRun=9'])).exitCode).toBe(0);
    expect((await readJsonFile<Config>(env.file)).claude).toMatchObject({ maxTurns: 4, maxAnalysesPerRun: 9 });
  });

  it('verlangt mindestens eine Zuweisung', async () => {
    const env = await setup();
    const result = await runCli(['config', 'set'], { dataDir: env.dataDir, repo: env.repo.root });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('zuweisungen');
  });
});

describe('ipa config in der Hilfe (AK-09-15)', () => {
  it('nennt die Unterbefehle und das Flag für kostenpflichtige Nutzung', async () => {
    const help = await runCli(['config', '--help'], { dataDir: null });
    expect(help.exitCode).toBe(0);
    for (const name of ['get', 'check', 'set']) expect(help.stdout).toContain(name);
    // No English entry of Commander's implicit help command.
    expect(help.stdout).not.toContain('display help');
    const set = await runCli(['config', 'set', '--help'], { dataDir: null });
    expect(set.stdout).toContain('--confirm-paid-usage');
    expect(set.stdout).toContain('--dry-run');
    expect((await runCli(['config'], { dataDir: null })).exitCode).toBe(2);
  });
});
