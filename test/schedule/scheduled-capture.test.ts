import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createClaudeRunner } from '../../src/claude/runner.js';
import { type CaptureRunResult, runCapture } from '../../src/cli/commands/capture.js';
import type { Config } from '../../src/core/config.js';
import { formatZoned } from '../../src/core/time.js';
import { lastRunOf, type PipelineEnv, startLockHolder, stateOf, stopLockHolder } from '../helpers/analysis.js';
import { type FakeCall, fakeClaudeEnv, mergedEnv } from '../helpers/claude.js';
import { createTempRepo } from '../helpers/git-repo.js';
import { contextAt, journalRepo } from '../helpers/journal.js';
import { initRepo, unchanged } from '../helpers/snapshots.js';
import { withProcessTimeZone } from '../helpers/time-zone.js';
import { createTempDataRoot, listTree, readJsonFile, runCli } from '../helpers/workspace.js';

// 2026-10-02 is a Friday, 2026-10-03 a Saturday, 2026-10-06 a Tuesday; summer time in Zurich (UTC+2).
const FRIDAY_10 = '2026-10-02T08:00:00Z';
const SATURDAY_10 = '2026-10-03T08:00:00Z';
const TUESDAY_0759 = '2026-10-06T05:59:00Z';
const TUESDAY_10 = '2026-10-06T08:00:00Z';

interface ScheduledRun {
  result: CaptureRunResult;
  calls: FakeCall[];
}

/** `capture --scheduled` in process at `at` with the fake CLI; the repository must stay unchanged. */
async function scheduledCaptureAt(env: PipelineEnv, at: string, scheduled = true): Promise<ScheduledRun> {
  const ctx = await contextAt(env, at);
  const fake = await fakeClaudeEnv('analysis');
  const processEnv = mergedEnv(fake.env);
  const result = await unchanged(
    env.repo,
    () => runCapture(ctx, { scheduled, analysis: { runner: createClaudeRunner({ env: processEnv }), env: processEnv } }),
    env.inRepo,
  );
  return { result, calls: await fake.calls() };
}

async function setSchedule(workspace: string, schedule: Partial<Config['schedule']>): Promise<void> {
  const config = await readJsonFile<Config>(`${workspace}/config.json`);
  await writeFile(`${workspace}/config.json`, JSON.stringify({ ...config, schedule: { ...config.schedule, ...schedule } }, null, 2));
}

describe('ipa capture --scheduled (Paket 08)', () => {
  it('endet am Samstag und um 07:59 in Europe/Zurich mit Exit-Code 0, ohne Snapshot, ohne Claude-Aufruf und mit outside_window (AK-08-01)', async () => {
    const env = await journalRepo(FRIDAY_10);
    // Work that an ordinary capture would store.
    await env.repo.write('a.txt', 'eins\nzwei\n');
    const stateBefore = await readFile(`${env.workspace}/state.json`);
    const snapshotsBefore = await listTree(`${env.workspace}/snapshots`);

    for (const at of [SATURDAY_10, TUESDAY_0759]) {
      const { result, calls } = await scheduledCaptureAt(env, at);
      expect(result).toMatchObject({ exitCode: 0, snapshotId: null, outcome: null, queue: null, outsideWindow: { inside: false } });
      // Not even the version or login check of Claude runs.
      expect(calls).toEqual([]);
      const run = await lastRunOf(env.workspace);
      expect(run).toMatchObject({
        command: 'capture',
        exitCode: 0,
        outcome: 'outside_window',
        snapshotCreated: null,
        analysesCompleted: [],
        analysesFailed: [],
        lockBroken: false,
        errors: [],
      });
      expect(run.startedAt).toBe(formatZoned(new Date(at), 'Europe/Zurich'));
    }
    expect((await lastRunOf(env.workspace)).startedAt).toBe('2026-10-06T07:59:00+02:00');
    // No snapshot, no lock left behind, and lastSuccessfulRun keeps naming the last real capture.
    expect(await readFile(`${env.workspace}/state.json`)).toEqual(stateBefore);
    expect(await listTree(`${env.workspace}/snapshots`)).toEqual(snapshotsBefore);
    expect(Object.keys(await listTree(env.workspace))).not.toContain('lock');
  });

  it('prüft das Fenster vor dem Lock: ausserhalb endet der Lauf auch bei gehaltenem Lock mit Exit-Code 0, innerhalb mit 3', async () => {
    const env = await journalRepo(FRIDAY_10);
    const holder = await startLockHolder(env.workspace);
    try {
      const { result } = await scheduledCaptureAt(env, SATURDAY_10);
      expect(result.exitCode).toBe(0);
      expect((await lastRunOf(env.workspace)).outcome).toBe('outside_window');

      await expect(scheduledCaptureAt(env, TUESDAY_10)).rejects.toMatchObject({ exitCode: 3 });
      expect((await lastRunOf(env.workspace)).outcome).toBe('lock_held');
    } finally {
      await stopLockHolder(holder);
    }
  });

  it('verhält sich am Dienstag um 10:00 wie capture (AK-08-02)', async () => {
    const scheduled = await journalRepo(FRIDAY_10);
    const plain = await journalRepo(FRIDAY_10);
    for (const env of [scheduled, plain]) await env.repo.write('a.txt', 'eins\nzwei\n');

    const withWindow = await scheduledCaptureAt(scheduled, TUESDAY_10);
    const withoutWindow = await scheduledCaptureAt(plain, TUESDAY_10, false);
    for (const { result, calls } of [withWindow, withoutWindow]) {
      expect(result).toMatchObject({ exitCode: 0, snapshotId: 'S000002', outcome: { type: 'created' }, outsideWindow: null });
      expect(result.queue?.completed.map((entry) => entry.snapshotId)).toEqual(['S000001', 'S000002']);
      expect(calls.filter((call) => call.kind === 'model-call')).toHaveLength(1);
    }
    for (const env of [scheduled, plain]) {
      const run = await lastRunOf(env.workspace);
      expect(run).toMatchObject({ command: 'capture', exitCode: 0, outcome: 'ok', snapshotCreated: 'S000002', analysesCompleted: ['S000001', 'S000002'] });
      expect((await stateOf(env.workspace)).lastSuccessfulRun).toBe(run.endedAt);
      expect((await stateOf(env.workspace)).lastAnalysedSnapshotId).toBe('S000002');
    }
  });

  it('prüft ohne --scheduled kein Zeitfenster', async () => {
    const env = await journalRepo(FRIDAY_10);
    await env.repo.write('a.txt', 'eins\nzwei\n');
    const { result } = await scheduledCaptureAt(env, SATURDAY_10, false);
    expect(result).toMatchObject({ exitCode: 0, snapshotId: 'S000002', outsideWindow: null });
  });

  it('entscheidet mit TZ=UTC und TZ=America/New_York gleich, auch am Umstellungstag (AK-08-03)', async () => {
    const outcomes: Record<string, (string | null)[]> = {};
    for (const zone of ['UTC', 'America/New_York']) {
      const env = await journalRepo('2026-10-09T08:00:00Z');
      await setSchedule(env.workspace, { workdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sun'], windowStart: '00:00', windowEnd: '23:59' });
      outcomes[zone] = await withProcessTimeZone(zone, async () => {
        const seen: (string | null)[] = [];
        // Saturday 00:30 in Zurich is still Friday in UTC and New York: outside.
        await env.repo.write('a.txt', 'eins\nzwei\n');
        seen.push((await scheduledCaptureAt(env, '2026-10-09T22:30:00Z')).result.snapshotId ?? 'ausserhalb');
        // Monday 00:30 in Zurich is still Sunday in UTC and New York: inside.
        seen.push((await scheduledCaptureAt(env, '2026-10-11T22:30:00Z')).result.snapshotId ?? 'ausserhalb');
        // Sunday of the change to winter time, window 08:00–18:00: 07:59 CET outside, 08:00 CET inside.
        await setSchedule(env.workspace, { windowStart: '08:00', windowEnd: '18:00' });
        await env.repo.write('a.txt', 'eins\nzwei\ndrei\n');
        seen.push((await scheduledCaptureAt(env, '2026-10-25T06:59:00Z')).result.snapshotId ?? 'ausserhalb');
        seen.push((await scheduledCaptureAt(env, '2026-10-25T07:00:00Z')).result.snapshotId ?? 'ausserhalb');
        return seen;
      });
    }
    expect(outcomes['UTC']).toEqual(['ausserhalb', 'S000002', 'ausserhalb', 'S000003']);
    expect(outcomes['America/New_York']).toEqual(outcomes['UTC']);
  });

  it('über den CLI-Einstieg mit den Argumenten der Aufgabe: ausserhalb ohne Ausgabe auf stdout, innerhalb wie capture', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    const workspace = await initRepo(repo, dataDir);
    await repo.write('neu.txt', 'neu\n');
    // The argument order of the generated task: global options after the command.
    const taskArgs = ['capture', '--scheduled', '--no-analysis', '--repo', repo.root, '--data-dir', dataDir];

    await setSchedule(workspace, { workdays: [] });
    const outside = await unchanged(repo, () => runCli(taskArgs, { dataDir: null }));
    expect(outside.exitCode, outside.stderr).toBe(0);
    expect(outside.stdout).toBe('');
    expect(outside.stderr).toContain('Ausserhalb des Zeitfensters');
    expect(outside.stderr).toContain('kein Arbeitstag');
    expect(await lastRunOf(workspace)).toMatchObject({ command: 'capture', exitCode: 0, outcome: 'outside_window', snapshotCreated: null });

    await setSchedule(workspace, { workdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], windowStart: '00:00', windowEnd: '23:59' });
    const inside = await unchanged(repo, () => runCli(taskArgs, { dataDir: null }));
    expect(inside.exitCode, inside.stderr).toBe(0);
    expect(inside.stdout).toContain('Snapshot S000002 gespeichert (Arbeits-Snapshot)');
    expect(await lastRunOf(workspace)).toMatchObject({ command: 'capture', exitCode: 0, outcome: 'ok', snapshotCreated: 'S000002' });

    const help = await runCli(['capture', '--help'], { dataDir: null });
    expect(help.stdout).toContain('--scheduled');
  });
});
