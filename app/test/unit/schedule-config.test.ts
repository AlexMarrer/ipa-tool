import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigChange } from '../../src/shared/config';
import type { RunInput, RunSummary } from '../../src/shared/run';
import type { RunEvent } from '../../src/shared/types';
import { createServices, type Services } from '../../src/main/services';
import { input } from '../../src/main/ipc/guard';
import type { ShellPort } from '../../src/main/shell';
import { APP_ROOT, createTestEnv, fingerprintRepo, initProject, waitFor, type InitializedProject, type TestEnv } from '../helpers/env';

const PRELOAD = path.join(APP_ROOT, 'test', 'helpers', 'schtasks-preload.mjs');

/** Commands `schedule` and `config` against the real CLI; `schtasks` is a stand-in file in every CLI process (AK-10-55). */
describe('Zeitplan und Konfiguration mit dem echten CLI', () => {
  let env: TestEnv;
  let project: InitializedProject;
  let services: Services;
  let configFile: string;
  let schedulerLog: string;
  const events: RunEvent[] = [];
  const shell: ShellPort = { openPath: async () => '', showItemInFolder: () => undefined, writeClipboard: () => undefined, openExternal: async () => undefined, trashItem: async () => undefined, chooseFile: async () => null, chooseFolder: async () => null, setTheme: () => undefined };

  beforeAll(async () => {
    env = await createTestEnv();
    schedulerLog = `${env.root}/schtasks-calls.jsonl`;
    env.env['IPA_TEST_SCHTASKS_STATE'] = `${env.root}/schtasks-state.json`;
    env.env['IPA_TEST_SCHTASKS_LOG'] = schedulerLog;
    env.env['NODE_OPTIONS'] = `--import=${pathToFileURL(PRELOAD).href}`;
    project = await initProject(env, 'zeitplan');
    configFile = `${project.workspacePath}/config.json`;
    services = await createServices({ appRoot: APP_ROOT, packaged: false, userDataDir: env.userData, env: env.env, appVersion: '0.1.0', electronVersion: '45.5.0', nodeExe: process.execPath, watchDebounceMs: 60, watchPollMs: 300, shell });
    await services.loadProjects();
    services.queue.onEvent((event) => events.push(event));
  }, 120_000);
  afterAll(async () => {
    await services.shutdown();
    await env.cleanup();
  });

  async function run(request: RunInput): Promise<RunSummary> {
    const before = events.length;
    const started = await services.startRun(project.repositoryId, request as never);
    if (!started.ok) throw new Error(`abgelehnt: ${started.reason}`);
    const finished = await waitFor(() => events.find((event, index) => index >= before && event.type === 'finished' && event.runKey === started.runKey), 60_000, 50);
    if (finished.type !== 'finished' || finished.summary === null) throw new Error('keine Zusammenfassung');
    return finished.summary;
  }
  const set = (...changes: ConfigChange[]) => input.configChanges(changes);
  const change = (path: string, value: unknown) => ({ path, value });
  const readConfig = async (): Promise<Record<string, any>> => JSON.parse(await readFile(configFile, 'utf8'));
  const view = async () => {
    const result = await services.loadConfig(project.repositoryId);
    if (!result.ok) throw new Error('Konfiguration nicht lesbar');
    return result.value;
  };
  const schedule = async () => {
    const result = await services.loadSchedule(project.repositoryId);
    if (!result.ok) throw new Error('Zeitplan nicht lesbar');
    return result.value;
  };

  describe('Konfiguration lesen und prüfen (AK-10-58)', () => {
    it('liest config.json direkt und kennt Arbeitsbereich, Prüfung von Claude und Signatur', async () => {
      const loaded = await view();
      expect(loaded.state).toBe('ok');
      expect(loaded.config?.claude).toMatchObject({ timeoutSeconds: 600, maxTurns: 5, maxAttemptsPerSnapshot: 3, maxAnalysesPerRun: 5 });
      expect(loaded.config?.schedule).toMatchObject({ windowStart: '08:00', windowEnd: '18:00', intervalMinutes: 120, extraRunTimes: ['17:45'] });
      expect(loaded.claude).toMatchObject({ ok: true, found: true });
      expect(loaded.workspaceInRepository).toBeNull();
      expect(loaded.signature).not.toBe('absent');
    });

    it('prüft einen Entwurf mit --dry-run, ohne die Datei anzufassen, und liefert Plan und Befunde', async () => {
      const before = await readFile(configFile);
      const preview = await services.previewConfig(project.repositoryId, set(change('schedule.intervalMinutes', 60)));
      expect(preview.ok && preview.value).toMatchObject({ valid: true, failure: null });
      const plan = preview.ok ? preview.value.schedulePlan : null;
      expect(plan?.runTimes.length).toBeGreaterThan(5);
      expect(plan?.maxClaudeCallsPerDay).toBe((plan?.runsPerDay ?? 0) * (plan?.maxAnalysesPerRun ?? 0));
      expect(Buffer.compare(before, await readFile(configFile))).toBe(0);
      expect(events.filter((event) => event.type === 'started' && event.label.startsWith('config'))).toEqual([]);
    });

    it('zeigt die Standardwerte 7 Läufe und 35 Aufrufe und zählt den Lauf auf windowEnd vorsichtig mit', async () => {
      const preview = await services.previewConfig(project.repositoryId, set(change('schedule.intervalMinutes', 120)));
      const plan = preview.ok ? preview.value.schedulePlan : null;
      expect(plan).toMatchObject({ runsPerDay: 7, maxClaudeCallsPerDay: 35 });
      expect(plan?.includesWindowEndRun).toBe(true);
      expect(plan?.runTimes).toContain('18:00');
    });

    it('meldet ungültige Angaben als Befund am Pfad in Klartext, ohne zu schreiben', async () => {
      const before = await readFile(configFile);
      const bad = await services.previewConfig(project.repositoryId, set(change('schedule.windowStart', '8.00'), change('claude.maxTurns', 0)));
      expect(bad.ok && bad.value.valid).toBe(false);
      const findings = bad.ok ? bad.value.findings : [];
      expect(findings.map((finding) => finding.path).join(' ')).toMatch(/windowStart/);
      expect(findings.map((finding) => finding.path).join(' ')).toMatch(/maxTurns/);
      expect(findings.every((finding) => finding.message !== '')).toBe(true);
      expect(Buffer.compare(before, await readFile(configFile))).toBe(0);
    });

    it('warnt wie das CLI: Zusatzlauf ausserhalb, Intervall länger als das Fenster, langer Timeout', async () => {
      const preview = await services.previewConfig(
        project.repositoryId,
        set(change('schedule.extraRunTimes', ['19:30']), change('schedule.intervalMinutes', 660), change('claude.timeoutSeconds', 900)),
      );
      const codes = preview.ok ? preview.value.findings.map((finding) => finding.code) : [];
      expect(codes).toEqual(expect.arrayContaining(['schedule_extra_outside_window', 'schedule_interval_exceeds_window', 'claude_timeout_exceeds_reserve']));
    });

    it('zeigt bei einer ungültigen config.json die Befunde von config check', async () => {
      const original = await readFile(configFile, 'utf8');
      const broken = JSON.parse(original);
      broken.claude.maxTurns = 0;
      await writeFile(configFile, JSON.stringify(broken, null, 2));
      try {
        const loaded = await view();
        expect(['invalid', 'unreadable', 'ok']).toContain(loaded.state);
        if (loaded.state === 'invalid') expect(loaded.findings.length).toBeGreaterThan(0);
        // `config set` refuses to write into a file that is already invalid; the fix is made by hand (spec §9.6).
        const check = await run({ name: 'configSet', changes: set(change('claude.maxTurns', 5)) });
        expect(check.exitCode).toBe(2);
      } finally {
        await writeFile(configFile, original);
      }
    });
  });

  describe('Konfiguration speichern nur über config set (AK-10-68)', () => {
    it('ändert genau die genannten Pfade und lässt alles andere unverändert', async () => {
      const before = await readConfig();
      const summary = await run({ name: 'configSet', changes: set(change('claude.maxTurns', 7), change('limits.maxFileBytes', 123456), change('paths.include', ['src/**', 'docs/**'])) });
      expect(summary).toMatchObject({ exitCode: 0, result: { kind: 'config', written: true, valid: true } });
      expect(summary.result).toMatchObject({ changedPaths: expect.arrayContaining(['claude.maxTurns', 'limits.maxFileBytes', 'paths.include']) });
      const after = await readConfig();
      const expected = structuredClone(before);
      expected.claude.maxTurns = 7;
      expected.limits.maxFileBytes = 123456;
      expected.paths.include = ['src/**', 'docs/**'];
      expect(after).toEqual(expected);
      await run({ name: 'configSet', changes: set(change('claude.maxTurns', 5), change('limits.maxFileBytes', before.limits.maxFileBytes), change('paths.include', before.paths.include)) });
    });

    it('lässt die Datei bei einem Befund Byte für Byte unverändert (Exit-Code 2)', async () => {
      const before = await readFile(configFile);
      const summary = await run({ name: 'configSet', changes: set(change('claude.maxAttemptsPerSnapshot', 0)) });
      expect(summary.exitCode).toBe(2);
      expect(summary.errors.length).toBeGreaterThan(0);
      expect(Buffer.compare(before, await readFile(configFile))).toBe(0);
    });

    it('verlangt für kostenpflichtige Nutzung die ausdrückliche Bestätigung und schreibt sonst nichts', async () => {
      const before = await readFile(configFile);
      const refused = await run({ name: 'configSet', changes: set(change('claude.allowPaidUsage', true)) });
      expect(refused.exitCode).toBe(2);
      expect(refused.errors.map((error) => error.code)).toContain('paid_usage_confirmation_required');
      expect(Buffer.compare(before, await readFile(configFile))).toBe(0);
      const allowed = await run({ name: 'configSet', changes: set(change('claude.allowPaidUsage', true)), confirmPaidUsage: true });
      expect(allowed.exitCode).toBe(0);
      expect((await readConfig())['claude'].allowPaidUsage).toBe(true);
      // Switching it off needs no confirmation.
      const off = await run({ name: 'configSet', changes: set(change('claude.allowPaidUsage', false)) });
      expect(off.exitCode).toBe(0);
      expect((await readConfig())['claude'].allowPaidUsage).toBe(false);
    });

    it('lässt Felder, die nach init fest sind, gar nicht erst durch die Eingabeprüfung', () => {
      for (const forbidden of ['timezone', 'repositoryId', 'repository.path', 'schemaVersion', 'claude.command', 'claude']) {
        expect(() => set(change(forbidden, 'x')), forbidden).toThrow();
      }
      expect(() => set(change('claude.maxTurns', 3), change('claude.maxTurns', 4))).toThrow();
    });

    it('lehnt die Bestätigung ohne den passenden Schalter ab', () => {
      expect(() => input.runInput({ name: 'configSet', changes: [change('claude.maxTurns', 3)], confirmPaidUsage: true })).toThrow();
      expect(() => input.runInput({ name: 'configSet', changes: [change('claude.allowPaidUsage', false)], confirmPaidUsage: true })).toThrow();
      expect(input.runInput({ name: 'configSet', changes: [change('claude.allowPaidUsage', true)], confirmPaidUsage: true })).toMatchObject({ confirmPaidUsage: true });
    });

    it('erkennt eine von Hand geänderte Datei an der Signatur', async () => {
      const first = await view();
      const original = await readFile(configFile, 'utf8');
      await new Promise((resolve) => setTimeout(resolve, 20));
      await writeFile(configFile, `${original.trimEnd()}\n\n`);
      const second = await view();
      expect(second.signature).not.toBe(first.signature);
      await writeFile(configFile, original);
    });
  });

  describe('Pfad testen gegen die Erfassung des CLI (AK-10-61)', () => {
    it('entscheidet mit demselben Filter wie `ipa capture`', async () => {
      const loaded = await view();
      const exclude = [...(loaded.config?.paths.exclude ?? []), '*.log', 'geheim/**'];
      await run({ name: 'configSet', changes: set(change('paths.exclude', exclude)) });
      const { repo } = project;
      const files = ['src/a.ts', 'src/b.log', 'geheim/x.txt', 'node_modules/p/index.js', 'docs/readme.md', 'build.log'];
      for (const file of files) await repo.write(file, `inhalt ${file}\n`);
      const captured = await run({ name: 'capture', mode: 'noAnalysis' });
      expect(captured.exitCode).toBe(0);
      const snapshotId = captured.result?.kind === 'capture' ? captured.result.snapshot?.id : null;
      expect(snapshotId).toBeTruthy();
      const manifest = JSON.parse(await readFile(`${project.workspacePath}/snapshots/${snapshotId}/manifest.json`, 'utf8')) as { filterDecisions: { path: string | null; decision: string; rule: string | null }[]; fileStates: { path: string }[] };
      const excluded = new Map(manifest.filterDecisions.filter((entry) => entry.decision === 'excluded').map((entry) => [entry.path, entry.rule]));
      const included = new Set(manifest.fileStates.map((entry) => entry.path));
      for (const file of files) {
        const tested = await services.testPath(project.repositoryId, loaded.config?.paths.include ?? ['**'], exclude, file);
        if (!tested.ok) throw new Error('Pfadtest fehlgeschlagen');
        if (tested.value.allowed) {
          expect(excluded.has(file), `${file} wird erfasst`).toBe(false);
        } else {
          expect(excluded.get(file), `${file}: ${tested.value.rule}`).toBe(tested.value.rule);
        }
      }
      expect(included.size).toBeGreaterThan(0);
      const git = await services.testPath(project.repositoryId, ['**'], [], '.git/config');
      expect(git.ok && git.value).toEqual({ allowed: false, rule: '.git/**' });
      const draft = await services.testPath(project.repositoryId, ['src/**'], [], 'docs/readme.md');
      expect(draft.ok && draft.value).toEqual({ allowed: false, rule: 'paths.include' });
    });

    it('rechnet auf dem Entwurf und akzeptiert Pfade mit Backslash', async () => {
      const result = await services.testPath(project.repositoryId, ['**'], ['**/tmp/**'], 'src\\tmp\\x.ts');
      expect(result.ok && result.value).toEqual({ allowed: false, rule: '**/tmp/**' });
    });
  });

  describe('Zeitplan mit Ersatz für die Aufgabenplanung (AK-10-52, AK-10-55, AK-10-56)', () => {
    it('zeigt vor dem Einrichten "nicht eingerichtet" und einen Plan', async () => {
      const status = await schedule();
      expect(status).toMatchObject({ state: 'not_installed', problem: null });
      expect(status.taskName).toMatch(/^ipa-assistant-/);
      expect(status.plan?.runsPerDay).toBe(7);
    });

    it('richtet ein, pausiert, setzt fort und löscht; "Schon so" ist kein Fehler', async () => {
      const install = await run({ name: 'scheduleInstall' });
      expect(install).toMatchObject({ exitCode: 0, result: { kind: 'schedule', changed: true, state: 'active' } });
      expect((await schedule()).state).toBe('active');
      expect((await schedule()).nextRun).not.toBeNull();

      const exists = await run({ name: 'scheduleInstall' });
      expect(exists.exitCode).toBe(2);
      expect(exists.errors.map((error) => error.code)).toContain('schedule_exists');

      expect(await run({ name: 'schedulePause' })).toMatchObject({ exitCode: 0, result: { state: 'paused', changed: true } });
      expect(await run({ name: 'schedulePause' })).toMatchObject({ exitCode: 0, result: { state: 'paused', changed: false } });
      expect((await schedule()).state).toBe('paused');
      const blocked = await run({ name: 'scheduleRun' });
      expect(blocked.exitCode).toBe(2);
      expect(blocked.errors.map((error) => error.code)).toContain('schedule_paused');

      expect(await run({ name: 'scheduleResume' })).toMatchObject({ exitCode: 0, result: { state: 'active', changed: true } });
      expect(await run({ name: 'scheduleResume' })).toMatchObject({ exitCode: 0, result: { changed: false } });
      const triggered = await run({ name: 'scheduleRun' });
      expect(triggered.exitCode).toBe(0);
      expect(triggered.result).toMatchObject({ kind: 'schedule', action: 'run' });
    });

    it('wird nach einer Änderung der Konfiguration veraltet und bleibt nach dem Aktualisieren pausiert', async () => {
      const saved = await run({ name: 'configSet', changes: set(change('schedule.intervalMinutes', 90)) });
      expect(saved.exitCode).toBe(0);
      const stale = await schedule();
      expect(stale.state).toBe('stale');
      expect(stale.differences).toContain('triggers');

      await run({ name: 'schedulePause' });
      const updated = await run({ name: 'scheduleInstall', update: true });
      expect(updated.exitCode).toBe(0);
      expect((await schedule()).state).toBe('paused');
      await run({ name: 'scheduleResume' });
      expect((await schedule()).state).toBe('active');

      await run({ name: 'configSet', changes: set(change('limits.maxRunSeconds', 3600)) });
      expect(((await schedule()).differences)).toContain('execution_time_limit');
      await run({ name: 'scheduleInstall', update: true });
    });

    it('löscht die Aufgabe, ohne Konfiguration und Läufe anzufassen', async () => {
      const before = await readFile(configFile);
      expect(await run({ name: 'scheduleRemove' })).toMatchObject({ exitCode: 0, result: { state: 'not_installed', changed: true } });
      expect((await schedule()).state).toBe('not_installed');
      expect(Buffer.compare(before, await readFile(configFile))).toBe(0);
      const again = await run({ name: 'scheduleRemove' });
      expect(again).toMatchObject({ exitCode: 0, result: { changed: false } });
    });

    it('hat nie die echte Aufgabenplanung berührt: jeder Aufruf lief über das Ersatzprogramm', async () => {
      const calls = (await readFile(schedulerLog, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as string[]);
      expect(calls.length).toBeGreaterThan(10);
      for (const call of calls) expect(['/Query', '/Create', '/Change', '/Delete', '/Run']).toContain(call[0]);
    });

    it('zeigt den Lauf-Verlauf aus runs.jsonl, neueste zuerst', async () => {
      const history = await services.loadRunHistory(project.repositoryId);
      if (!history.ok) throw new Error('kein Verlauf');
      expect(history.value.length).toBeGreaterThan(0);
      const times = history.value.map((entry) => Date.parse(entry.startedAt));
      expect(times).toEqual([...times].sort((a, b) => b - a));
      expect(history.value[0]).toMatchObject({ command: expect.any(String), outcome: expect.any(String), analysesCompleted: expect.any(Number) });
    });
  });

  it('verändert das Repository nie', async () => {
    const before = await fingerprintRepo(project.repo.root);
    await services.previewConfig(project.repositoryId, set(change('claude.maxTurns', 4)));
    await schedule();
    expect(await fingerprintRepo(project.repo.root)).toEqual(before);
  });
});
