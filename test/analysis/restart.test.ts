import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { QueueHooks } from '../../src/analysis/types.js';
import { runCapture } from '../../src/cli/commands/capture.js';
import { createClaudeRunner } from '../../src/claude/runner.js';
import { resolveContext } from '../../src/core/context.js';
import { fakeClaudeEnv, mergedEnv } from '../helpers/claude.js';
import {
  captureOnly,
  ipa,
  lastRunOf,
  namesIn,
  outcomeOf,
  type PipelineEnv,
  pipelineRepo,
  recordOf,
  startLockHolder,
  stateOf,
  stopLockHolder,
} from '../helpers/analysis.js';
import { setLimits, unchanged } from '../helpers/snapshots.js';
import { listTree } from '../helpers/workspace.js';

/** One capture through `runCapture` with test hooks (spec.md §10); the abort surfaces as a rejection. */
async function captureWithHooks(env: PipelineEnv, hooks: QueueHooks): Promise<unknown> {
  const fake = await fakeClaudeEnv('analysis');
  const processEnv = mergedEnv(fake.env);
  const ctx = await resolveContext({ repo: env.repo.root, dataDir: env.dataDir, requireInit: true });
  return unchanged(env.repo, () =>
    runCapture(ctx, { analysis: { runner: createClaudeRunner({ env: processEnv }), hooks, env: processEnv } }).catch((error: unknown) => error),
  );
}

function abortAt(point: keyof QueueHooks): QueueHooks {
  return {
    [point]: ({ snapshotId }: { snapshotId: string }) => {
      if (snapshotId === 'S000002') throw new Error(`künstlicher Abbruch nach ${point}`);
    },
  };
}

async function openSnapshot(): Promise<PipelineEnv> {
  const env = await pipelineRepo();
  await env.repo.write('a.txt', 'eins\nzwei\n');
  await captureOnly(env);
  return env;
}

describe('Wiederanlauf der Analyse (spec.md §12.4)', () => {
  it('führt nach einem Abbruch hinter der Abschlussmarkierung den Cursor ohne Aufruf und ohne zweiten Log nach (AK-06-06)', async () => {
    const env = await openSnapshot();
    const aborted = await captureWithHooks(env, abortAt('afterCompleteMarker'));
    expect(aborted).toBeInstanceOf(Error);
    expect(await namesIn(`${env.workspace}/analyses/S000002`)).toEqual(['analysis.json', 'attempt-1', 'complete.json']);
    expect(await stateOf(env.workspace)).toMatchObject({ lastAnalysedSnapshotId: 'S000001' });
    expect(await lastRunOf(env.workspace)).toMatchObject({ exitCode: 1, errors: [{ code: 'internal' }] });
    const logBefore = await readFile(`${env.workspace}/logs/S000002.md`);

    const next = await ipa(env, ['capture']);
    expect(next.result.exitCode, next.result.stderr).toBe(0);
    expect(next.calls).toEqual([]);
    expect(next.result.stderr).toContain('Analyse-Cursor ohne neuen Aufruf nachgeführt über S000002');
    const head = (await env.repo.git('rev-parse', 'HEAD')).trim();
    expect(await stateOf(env.workspace)).toMatchObject({ lastAnalysedSnapshotId: 'S000002', lastCommit: head });
    expect(await namesIn(`${env.workspace}/logs`)).toEqual(['S000001.md', 'S000002.md']);
    expect(await readFile(`${env.workspace}/logs/S000002.md`)).toEqual(logBefore);
    expect(await namesIn(`${env.workspace}/analyses/S000002`)).toEqual(['analysis.json', 'attempt-1', 'complete.json']);
  });

  for (const point of ['afterAnalysisWritten', 'afterLogWritten'] as const) {
    it(`verarbeitet nach einem Abbruch über ${point} den Snapshot erneut unter denselben Pfaden (AK-06-07)`, async () => {
      const env = await openSnapshot();
      expect(await captureWithHooks(env, abortAt(point))).toBeInstanceOf(Error);
      const files = await namesIn(`${env.workspace}/analyses/S000002`);
      expect(files).toContain('analysis.json');
      expect(files).not.toContain('complete.json');
      expect(await namesIn(`${env.workspace}/logs`)).toEqual(point === 'afterLogWritten' ? ['S000001.md', 'S000002.md'] : ['S000001.md']);
      expect(await stateOf(env.workspace)).toMatchObject({ lastAnalysedSnapshotId: 'S000001' });

      // The attempt without outcome.json counts as interrupted; the next run tries again.
      const next = await ipa(env, ['capture']);
      expect(next.result.exitCode, next.result.stderr).toBe(0);
      expect(next.modelCalls).toHaveLength(1);
      expect(await outcomeOf(env.workspace, 'S000002', 2)).toMatchObject({ outcome: 'success' });
      expect((await recordOf(env.workspace, 'S000002')).provenance).toMatchObject({ attempt: 2 });
      expect(await namesIn(`${env.workspace}/logs`)).toEqual(['S000001.md', 'S000002.md']);
      expect(await readFile(`${env.workspace}/logs/S000002.md`, 'utf8')).toContain('Versuch 2');
      expect(await stateOf(env.workspace)).toMatchObject({ lastAnalysedSnapshotId: 'S000002' });
    });
  }

  it('verarbeitet offene Snapshots auch nach einer instabilen Aufnahme und endet mit Exit-Code 5 (spec.md §4.4)', async () => {
    const env = await openSnapshot();
    await setLimits(env.workspace, { stabilityRetries: 0 });
    const fake = await fakeClaudeEnv('analysis');
    const processEnv = mergedEnv(fake.env);
    const ctx = await resolveContext({ repo: env.repo.root, dataDir: env.dataDir, requireInit: true });
    let changes = 0;
    const result = await runCapture(ctx, {
      hooks: { afterFirstPass: async () => env.repo.write('a.txt', `stand ${(changes += 1)}\n`) },
      analysis: { runner: createClaudeRunner({ env: processEnv }), env: processEnv },
    });
    expect(result).toMatchObject({ exitCode: 5, snapshotId: null, outcome: null, captureError: { code: 'unstable' } });
    expect(result.queue?.completed.map((entry) => entry.snapshotId)).toEqual(['S000001', 'S000002']);
    expect(await namesIn(`${env.workspace}/snapshots`)).toEqual(['S000001', 'S000002']);
    expect(await stateOf(env.workspace)).toMatchObject({ lastAnalysedSnapshotId: 'S000002' });
    expect(await lastRunOf(env.workspace)).toMatchObject({
      exitCode: 5,
      outcome: 'unstable',
      analysesCompleted: ['S000001', 'S000002'],
      errors: [{ code: 'unstable' }],
    });
  });

  it('ein paralleler zweiter capture endet mit Exit-Code 3 und verändert weder Snapshots noch Analysen noch state.json (AK-06-14)', async () => {
    const env = await openSnapshot();
    const before = {
      snapshots: await listTree(`${env.workspace}/snapshots`),
      analyses: await listTree(`${env.workspace}/analyses`),
      logs: await listTree(`${env.workspace}/logs`),
      state: await readFile(`${env.workspace}/state.json`),
    };
    await env.repo.write('b.txt', 'b\n');
    const holder = await startLockHolder(env.workspace);
    try {
      const parallel = await ipa(env, ['capture']);
      expect(parallel.result.exitCode).toBe(3);
      expect(parallel.calls).toEqual([]);
    } finally {
      await stopLockHolder(holder);
    }
    expect(await listTree(`${env.workspace}/snapshots`)).toEqual(before.snapshots);
    expect(await listTree(`${env.workspace}/analyses`)).toEqual(before.analyses);
    expect(await listTree(`${env.workspace}/logs`)).toEqual(before.logs);
    expect(await readFile(`${env.workspace}/state.json`)).toEqual(before.state);
    expect(await lastRunOf(env.workspace)).toMatchObject({ command: 'capture', exitCode: 3, outcome: 'lock_held' });
  });
});
