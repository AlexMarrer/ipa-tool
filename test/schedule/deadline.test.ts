import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClaudeRunner } from '../../src/claude/runner.js';
import type { ClaudeRunner } from '../../src/claude/types.js';
import { reportQueue, runCapture } from '../../src/cli/commands/capture.js';
import type { CliIo } from '../../src/cli/io.js';
import type { Clock } from '../../src/core/clock.js';
import { resolveContext } from '../../src/core/context.js';
import { lastRunOf, namesIn, type PipelineEnv, stateOf } from '../helpers/analysis.js';
import { fakeClaudeEnv, mergedEnv } from '../helpers/claude.js';
import { captureAt, journalRepo } from '../helpers/journal.js';
import { setLimits, unchanged } from '../helpers/snapshots.js';

// Lets a test move the clock while `ensureClaudeReady` runs, which may take up to 20 s in reality.
const readiness = vi.hoisted(() => ({ before: null as (() => void) | null }));
vi.mock('../../src/claude/doctor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/claude/doctor.js')>();
  return {
    ...actual,
    ensureClaudeReady: async (...args: Parameters<typeof actual.ensureClaudeReady>) => {
      readiness.before?.();
      return actual.ensureClaudeReady(...args);
    },
  };
});

interface ManualClock extends Clock {
  advance(ms: number): void;
}

function manualClock(at: string): ManualClock {
  let current = new Date(at).getTime();
  return { now: () => new Date(current), advance: (ms) => (current += ms) };
}

/** Every reading is `stepMs` later than the previous one, so the limit passes before the queue starts. */
function steppingClock(at: string, stepMs: number): Clock {
  let current = new Date(at).getTime();
  return {
    now: () => {
      const reading = new Date(current);
      current += stepMs;
      return reading;
    },
  };
}

const BASELINE = '2026-10-06T06:00:00Z';
const LIMIT_SECONDS = 600;

/** Baseline plus work snapshots S000002 … captured without analysis, and a run limit of 600 s. */
async function pendingSnapshots(count: number): Promise<PipelineEnv> {
  const env = await journalRepo(BASELINE);
  await setLimits(env.workspace, { maxRunSeconds: LIMIT_SECONDS });
  for (let index = 1; index <= count; index += 1) {
    await env.repo.write('a.txt', `eins\n${'weiter\n'.repeat(index)}`);
    await captureAt(env, `2026-10-06T06:${String(index * 10).padStart(2, '0')}:00Z`);
  }
  return env;
}

async function runWithClock(env: PipelineEnv, clock: Clock, mode: string, wrap?: (inner: ClaudeRunner) => ClaudeRunner) {
  const ctx = await resolveContext({ repo: env.repo.root, dataDir: env.dataDir, requireInit: true, clock });
  const fake = await fakeClaudeEnv(mode);
  const processEnv = mergedEnv(fake.env);
  const inner = createClaudeRunner({ env: processEnv });
  const runner = wrap === undefined ? inner : wrap(inner);
  const result = await unchanged(env.repo, () => runCapture(ctx, { analysis: { runner, env: processEnv } }), env.inRepo);
  const calls = await fake.calls();
  return { result, modelCalls: calls.filter((call) => call.kind === 'model-call'), calls };
}

function memoryIo(): { io: CliIo; stderr: () => string } {
  let stderr = '';
  return { io: { stdout: () => undefined, stderr: (text) => (stderr += text), env: {} }, stderr: () => stderr };
}

describe('Laufzeitgrenze limits.maxRunSeconds (AK-08-06)', () => {
  afterEach(() => {
    readiness.before = null;
  });

  it('startet nach Ablauf der Frist keinen weiteren Claude-Aufruf; der laufende endet regulär, die übrigen bleiben pending, Exit-Code 0', async () => {
    const env = await pendingSnapshots(3);
    const clock = manualClock('2026-10-06T07:00:00Z');
    // The limit passes while the first call is running.
    const { result, modelCalls } = await runWithClock(env, clock, 'analysis', (inner) => ({
      run: (ctx, request) => {
        const pending = inner.run(ctx, request);
        clock.advance((LIMIT_SECONDS + 1) * 1000);
        return pending;
      },
    }));

    expect(modelCalls).toHaveLength(1);
    expect(result.exitCode).toBe(0);
    expect(result.queue?.completed).toEqual([
      { snapshotId: 'S000001', mode: 'deterministic' },
      { snapshotId: 'S000002', mode: 'ai' },
    ]);
    expect(result.queue?.stoppedBy).toEqual({ reason: 'deadline', snapshotId: 'S000003' });
    expect(result.queue?.open).toEqual([
      { snapshotId: 'S000003', status: 'pending' },
      { snapshotId: 'S000004', status: 'pending' },
    ]);
    expect(await namesIn(`${env.workspace}/analyses/S000003`)).toEqual([]);
    // Nothing new to capture: the run is `unchanged`, although the queue worked.
    expect(await lastRunOf(env.workspace)).toMatchObject({
      exitCode: 0,
      outcome: 'unchanged',
      analysesCompleted: ['S000001', 'S000002'],
      analysesFailed: [],
      errors: [],
    });
    expect((await stateOf(env.workspace)).lastAnalysedSnapshotId).toBe('S000002');

    const output = memoryIo();
    reportQueue(output.io, result.queue!);
    expect(output.stderr()).toContain('Laufzeitgrenze limits.maxRunSeconds erreicht, kein weiterer Claude-Aufruf; S000003 folgt im nächsten Lauf.');

    // The next run within its limit continues with the open snapshots.
    const next = await captureAt(env, '2026-10-06T08:00:00Z', 'analysis');
    expect(next.exitCode).toBe(0);
    expect(next.queue?.completed.map((entry) => entry.snapshotId)).toEqual(['S000003', 'S000004']);
  });

  it('beginnt die Frist mit dem Lauf: nach einer langen Aufnahme startet kein Aufruf, Snapshots ohne Analysepflicht werden trotzdem abgeschlossen', async () => {
    const env = await pendingSnapshots(2);
    const { result, calls } = await runWithClock(env, steppingClock('2026-10-06T07:00:00Z', (LIMIT_SECONDS + 1) * 1000), 'analysis');
    // Not even the readiness check starts a process.
    expect(calls).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.queue?.completed).toEqual([{ snapshotId: 'S000001', mode: 'deterministic' }]);
    expect(result.queue?.stoppedBy).toEqual({ reason: 'deadline', snapshotId: 'S000002' });
    expect(result.queue?.open.map((entry) => entry.status)).toEqual(['pending', 'pending']);
  });

  it('endet mit Exit-Code 6, wenn ein Snapshot nach Ablauf der Frist failed bleibt', async () => {
    const env = await pendingSnapshots(2);
    const failed = await captureAt(env, '2026-10-06T07:00:00Z', 'error-result');
    expect(failed.exitCode).toBe(6);
    expect(await namesIn(`${env.workspace}/analyses/S000002`)).toEqual(['attempt-1']);

    const { result, modelCalls } = await runWithClock(env, steppingClock('2026-10-06T08:00:00Z', (LIMIT_SECONDS + 1) * 1000), 'analysis');
    expect(modelCalls).toEqual([]);
    expect(result.queue?.stoppedBy).toEqual({ reason: 'deadline', snapshotId: 'S000002' });
    expect(result.queue?.open).toEqual([
      { snapshotId: 'S000002', status: 'failed' },
      { snapshotId: 'S000003', status: 'pending' },
    ]);
    expect(result.exitCode).toBe(6);
    expect(await namesIn(`${env.workspace}/analyses/S000002`)).toEqual(['attempt-1']);
  });

  it('prüft die Frist direkt vor dem Aufruf: läuft sie während der Bereitschaftsprüfung ab, startet kein Aufruf', async () => {
    const env = await pendingSnapshots(1);
    const clock = manualClock('2026-10-06T07:00:00Z');
    readiness.before = () => clock.advance((LIMIT_SECONDS + 1) * 1000);
    const { result, calls, modelCalls } = await runWithClock(env, clock, 'analysis');

    expect(calls.map((call) => call.kind)).toEqual(['auth']);
    expect(modelCalls).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.queue?.stoppedBy).toEqual({ reason: 'deadline', snapshotId: 'S000002' });
    expect(result.queue?.open).toEqual([{ snapshotId: 'S000002', status: 'pending' }]);
    expect(await namesIn(`${env.workspace}/analyses/S000002`)).toEqual([]);
  });
});
