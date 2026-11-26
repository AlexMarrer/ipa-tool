import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommandRequest } from '../../src/main/cli/commands';
import type { CliRun, CliRunResult, Runner } from '../../src/main/cli/runner';
import { createRunRegistry, isProcessAlive, readLockFile } from '../../src/main/run/locks';
import { createRunQueue, type QueueProject } from '../../src/main/run/queue';
import { createTestEnv, type TestEnv } from '../helpers/env';

const result = (overrides: Partial<CliRunResult> = {}): CliRunResult => ({
  exitCode: 0,
  stdout: '',
  stderr: '',
  envelope: null,
  status: null,
  cancelled: false,
  failure: null,
  ...overrides,
});

/** Runner whose runs end only when the test says so; no process is started. */
function controllableRunner() {
  const started: { request: CommandRequest; finish: (value?: Partial<CliRunResult>) => void; cancelled: boolean; pid: number }[] = [];
  const runner: Runner = {
    start(_repo, request): CliRun {
      let finish!: (value?: Partial<CliRunResult>) => void;
      const entry = { request, cancelled: false, pid: 40_000 + started.length, finish: (value?: Partial<CliRunResult>) => finish(value) };
      const promise = new Promise<CliRunResult>((resolve) => {
        finish = (value) => resolve(result({ ...value, cancelled: entry.cancelled }));
      });
      started.push(entry);
      return {
        pid: entry.pid,
        result: promise,
        async cancel() {
          entry.cancelled = true;
          entry.finish();
        },
      };
    },
    version: async () => '0.1.0',
  };
  return { runner, started };
}

const projects: Record<string, QueueProject> = {
  a: { repositoryId: 'a', repoPath: 'C:/a', workspacePath: 'C:/ws-a' },
  b: { repositoryId: 'b', repoPath: 'C:/b', workspacePath: 'C:/ws-b' },
};

function setup(readLock: (workspace: string) => Promise<null | { pid: number; command: string; runId: string; startedAt: string }> = async () => null) {
  const { runner, started } = controllableRunner();
  const queue = createRunQueue({ runner, registry: createRunRegistry(), project: (id) => projects[id] ?? null, readLock });
  return { queue, started };
}

describe('Sperren pro Projekt (AK-10-07)', () => {
  it('erlaubt höchstens einen Schreib-Lauf und lehnt den zweiten ohne Prozess ab', async () => {
    const { queue, started } = setup();
    const first = await queue.start('a', { name: 'capture', mode: 'noAnalysis' }, 'user');
    expect(first.ok).toBe(true);
    const second = await queue.start('a', { name: 'baseline', reason: 'x' }, 'user');
    expect(second).toMatchObject({ ok: false, reason: 'write_run_active' });
    expect(started).toHaveLength(1);
  });

  it('sperrt KI-Befehle, solange ein Schreib- oder Journal-Lauf läuft', async () => {
    const { queue } = setup();
    await queue.start('a', { name: 'journal', noAi: true }, 'user');
    expect(await queue.start('a', { name: 'capture', mode: 'full' }, 'user')).toMatchObject({ ok: false, reason: 'journal_run_active' });
    expect(await queue.start('a', { name: 'doctor', live: true }, 'user')).toMatchObject({ ok: false });
    expect(await queue.start('a', { name: 'scheduleRun' }, 'user')).toMatchObject({ ok: false });
    // Without Claude a write run is still fine next to a journal run.
    expect(await queue.start('a', { name: 'capture', mode: 'noAnalysis' }, 'user')).toMatchObject({ ok: true });
  });

  it('erlaubt höchstens einen Journal-Lauf', async () => {
    const { queue } = setup();
    expect((await queue.start('a', { name: 'journal', noAi: true }, 'user')).ok).toBe(true);
    expect(await queue.start('a', { name: 'journal', noAi: true }, 'user')).toMatchObject({ ok: false, reason: 'journal_run_active' });
  });

  it('lässt note und config während eines Schreib-Laufs zu', async () => {
    const { queue } = setup();
    await queue.start('a', { name: 'capture', mode: 'full' }, 'user');
    expect((await queue.start('a', { name: 'note', text: 'x' }, 'user')).ok).toBe(true);
    expect((await queue.start('a', { name: 'configSet', changes: [{ path: 'a', value: 'b' }] }, 'user')).ok).toBe(true);
    expect((await queue.start('a', { name: 'status' }, 'auto')).ok).toBe(true);
  });

  it('sperrt doctor nur gegen sich selbst', async () => {
    const { queue } = setup();
    expect((await queue.start('a', { name: 'doctor' }, 'user')).ok).toBe(true);
    expect(await queue.start('a', { name: 'doctor' }, 'user')).toMatchObject({ ok: false, reason: 'doctor_active' });
    expect((await queue.start('a', { name: 'capture', mode: 'noAnalysis' }, 'user')).ok).toBe(true);
  });

  it('lässt verschiedene Projekte parallel laufen', async () => {
    const { queue } = setup();
    expect((await queue.start('a', { name: 'capture', mode: 'full' }, 'user')).ok).toBe(true);
    expect((await queue.start('b', { name: 'capture', mode: 'full' }, 'user')).ok).toBe(true);
  });

  it('gibt die Sperre nach dem Ende frei', async () => {
    const { queue, started } = setup();
    const first = await queue.start('a', { name: 'capture', mode: 'noAnalysis' }, 'user');
    started[0]?.finish();
    if (first.ok) await first.done;
    expect((await queue.start('a', { name: 'capture', mode: 'noAnalysis' }, 'user')).ok).toBe(true);
  });

  it('lehnt unbekannte Projekte ab', async () => {
    const { queue } = setup();
    expect(await queue.start('unbekannt', { name: 'status' }, 'auto')).toMatchObject({ ok: false, reason: 'project_unknown' });
  });

  it('führt Exit-Code 3 als Hinweis, nicht als Fehler', async () => {
    const { queue, started } = setup();
    const events: unknown[] = [];
    queue.onEvent((event) => events.push(event));
    const run = await queue.start('a', { name: 'capture', mode: 'full' }, 'user');
    started[0]?.finish({ exitCode: 3 });
    if (run.ok) await run.done;
    expect(events.at(-1)).toMatchObject({ type: 'finished', exitCode: 3, notice: 'lock_held', failure: null });
  });
});

describe('fremde Läufe aus der Lock-Datei (AK-10-07)', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await createTestEnv();
  });
  afterAll(async () => env.cleanup());

  const lockJson = (pid: number, hostname: string) =>
    JSON.stringify({ pid, hostname, command: 'capture', runId: 'R20261126T100000Z-ab12', startedAt: '2026-11-26T10:00:00+01:00' });

  it('erkennt einen Lock mit lebendem Prozess auf diesem Rechner', async () => {
    await writeFile(path.join(env.root, 'lock'), lockJson(process.pid, os.hostname()));
    expect(await readLockFile(env.root)).toMatchObject({ pid: process.pid, command: 'capture' });
  });

  it('ignoriert einen toten Lock, einen Lock eines anderen Rechners und kaputte Dateien', async () => {
    await writeFile(path.join(env.root, 'lock'), lockJson(2_147_000_000, os.hostname()));
    expect(isProcessAlive(2_147_000_000)).toBe(false);
    expect(await readLockFile(env.root)).toBeNull();
    await writeFile(path.join(env.root, 'lock'), lockJson(process.pid, 'anderer-rechner'));
    expect(await readLockFile(env.root)).toBeNull();
    await writeFile(path.join(env.root, 'lock'), '{kaputt');
    expect(await readLockFile(env.root)).toBeNull();
  });

  it('sperrt Schreib-Läufe und KI-Buttons bei einem fremden Lauf, nicht aber note', async () => {
    const foreign = { pid: process.pid, command: 'capture', runId: 'R1', startedAt: '2026-11-26T10:00:00+01:00' };
    const { queue } = setup(async () => foreign);
    expect(await queue.start('a', { name: 'capture', mode: 'noAnalysis' }, 'user')).toMatchObject({ ok: false, reason: 'foreign_lock' });
    expect(await queue.start('a', { name: 'journal' }, 'user')).toMatchObject({ ok: false, reason: 'foreign_lock' });
    expect((await queue.start('a', { name: 'note', text: 'x' }, 'user')).ok).toBe(true);
    expect(await queue.foreignLock('a')).toEqual(foreign);
  });

  it('hält den Lock des eigenen Laufs nicht für fremd', async () => {
    let lock: { pid: number; command: string; runId: string; startedAt: string } | null = null;
    const { queue } = setup(async () => lock);
    // The controllable runner hands out pid 40000 to the first run; the CLI child then writes the lock.
    const first = await queue.start('a', { name: 'capture', mode: 'noAnalysis' }, 'user');
    expect(first.ok).toBe(true);
    lock = { pid: 40_000, command: 'capture', runId: 'R1', startedAt: 'x' };
    expect(await queue.foreignLock('a')).toBeNull();
    lock = { pid: 12_345, command: 'capture', runId: 'R2', startedAt: 'x' };
    expect(await queue.foreignLock('a')).not.toBeNull();
  });
});

describe('Aufrufprotokoll und automatische Aufrufe (AK-10-15)', () => {
  it('lehnt automatische Aufrufe ausser den erlaubten ab und protokolliert sie', async () => {
    const { queue, started } = setup();
    for (const request of [{ name: 'capture', mode: 'full' }, { name: 'journal' }, { name: 'doctor', live: true }, { name: 'scheduleRun' }] as CommandRequest[]) {
      expect(await queue.start('a', request, 'auto')).toMatchObject({ ok: false, reason: 'auto_not_allowed' });
    }
    expect(started).toHaveLength(0);
    expect((await queue.start('a', { name: 'status' }, 'auto')).ok).toBe(true);
    expect(queue.log().filter((entry) => entry.event === 'rejected').map((entry) => entry.reason)).toEqual(['auto_not_allowed', 'auto_not_allowed', 'auto_not_allowed', 'auto_not_allowed']);
  });

  it('protokolliert Befehl, Auslöser und Exit-Code, nie Argumentwerte', async () => {
    const { queue, started } = setup();
    const run = await queue.start('a', { name: 'skip', snapshotId: 'S000002', reason: 'GEHEIMER-GRUND-123' }, 'user');
    started[0]?.finish({ exitCode: 2 });
    if (run.ok) await run.done;
    const text = JSON.stringify(queue.log());
    expect(text).not.toContain('GEHEIMER-GRUND-123');
    expect(queue.log().map((entry) => [entry.event, entry.command, entry.trigger])).toEqual([
      ['started', 'skip', 'user'],
      ['finished', 'skip', 'user'],
    ]);
    expect(queue.log().at(-1)).toMatchObject({ exitCode: 2 });
  });

  it('sendet Ereignisse nur für Aktionen des Benutzers', async () => {
    const { queue, started } = setup();
    const events: string[] = [];
    queue.onEvent((event) => events.push(event.type));
    const auto = await queue.start('a', { name: 'status' }, 'auto');
    started[0]?.finish();
    if (auto.ok) await auto.done;
    expect(events).toEqual([]);
    const user = await queue.start('a', { name: 'capture', mode: 'noAnalysis' }, 'user');
    started[1]?.finish();
    if (user.ok) await user.done;
    expect(events).toEqual(['started', 'finished']);
  });

  it('meldet Kurzbefehle als nicht abbrechbar, damit sie das Beenden der App nicht aufhalten', async () => {
    const { queue } = setup();
    await queue.start('a', { name: 'status' }, 'auto');
    await queue.start('a', { name: 'note', text: 'x' }, 'user');
    await queue.start('a', { name: 'capture', mode: 'noAnalysis' }, 'user');
    expect(queue.activeRuns('a').map((run) => [run.label, run.cancellable])).toEqual([
      ['status', false],
      ['note', false],
      ['capture --no-analysis', true],
    ]);
    expect(queue.activeRuns().filter((run) => run.cancellable)).toHaveLength(1);
  });

  it('bricht nur abbrechbare Befehle ab', async () => {
    const { queue } = setup();
    const note = await queue.start('a', { name: 'note', text: 'x' }, 'user');
    const noteKey = note.ok ? note.runKey : '';
    expect(await queue.cancel(noteKey)).toEqual({ cancelled: false, reason: 'not_cancellable' });
    expect(await queue.cancel('gibt-es-nicht')).toEqual({ cancelled: false, reason: 'run_unknown' });
    const capture = await queue.start('a', { name: 'capture', mode: 'noAnalysis' }, 'user');
    expect(capture.ok && (await queue.cancel(capture.runKey)).cancelled).toBe(true);
    if (capture.ok) expect((await capture.done).cancelled).toBe(true);
  });
});
