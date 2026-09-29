import { readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { runBaseline } from '../../src/cli/commands/baseline.js';
import { resolveContext } from '../../src/core/context.js';
import { IpaError } from '../../src/core/errors.js';
import { readJsonl } from '../../src/core/jsonl.js';
import type { RunRecord } from '../../src/core/run-log.js';
import type { State } from '../../src/core/state.js';
import { createTempRepo, type TempRepo } from '../helpers/git-repo.js';
import { captureRepo, initRepo, readManifestFile, unchanged } from '../helpers/snapshots.js';
import { type CliResult, createTempDataRoot, listTree, readJsonFile, runCli } from '../helpers/workspace.js';

interface Setup {
  repo: TempRepo;
  dataDir: string;
  workspace: string;
}

/** Baseline S000001, then one captured commit as S000002. */
async function setup(): Promise<Setup> {
  const repo = await createTempRepo({ files: { 'a.txt': 'eins\n' } });
  const dataDir = await createTempDataRoot();
  const workspace = await initRepo(repo, dataDir);
  await repo.write('a.txt', 'eins\nzwei\n');
  await repo.commit('Zwei');
  await captureRepo(repo, dataDir);
  return { repo, dataDir, workspace };
}

async function ipa(env: Setup, args: string[]): Promise<CliResult> {
  return unchanged(env.repo, () => runCli(args, { dataDir: env.dataDir, repo: env.repo.root }));
}

async function state(workspace: string): Promise<State> {
  return readJsonFile<State>(`${workspace}/state.json`);
}

async function lastRun(workspace: string): Promise<RunRecord> {
  return (await readJsonl<RunRecord>(`${workspace}/runs.jsonl`, 'run-record')).records.at(-1)!;
}

/** Captures after a halt: exit code 4, no snapshot, stored snapshots byte for byte unchanged. */
async function expectHalted(env: Setup, reason: string): Promise<State> {
  const before = await listTree(`${env.workspace}/snapshots`);
  const result = await ipa(env, ['capture']);
  expect(result.exitCode, result.stderr).toBe(4);
  expect(result.stderr).toContain(reason);
  expect(result.stderr).toContain('ipa baseline --reason');
  expect(await listTree(`${env.workspace}/snapshots`)).toEqual(before);
  expect(await lastRun(env.workspace)).toMatchObject({ command: 'capture', exitCode: 4, outcome: 'halted', snapshotCreated: null });
  const after = await state(env.workspace);
  expect(after.halt?.reason).toBe(reason);
  return after;
}

describe('Halt-Erkennung (spec.md §11.5)', () => {
  it('hält nach einem Branchwechsel an; alle Snapshot-Dateien bleiben byte-gleich (AK-03-07)', async () => {
    const env = await setup();
    const head = (await env.repo.git('rev-parse', 'HEAD')).trim();
    await env.repo.git('checkout', '-q', '-b', 'anderer');
    await env.repo.write('a.txt', 'eins\nzwei\ndrei\n');

    const halted = await expectHalted(env, 'branch_changed');
    expect(halted.halt).toMatchObject({ expected: { branch: 'main', head }, observed: { branch: 'anderer', head } });
    expect(halted.lastSnapshotId).toBe('S000002');
    expect(await readdir(`${env.workspace}/snapshots`)).toEqual(['S000001', 'S000002']);
  });

  it('erkennt commit --amend als history_rewritten (AK-03-08)', async () => {
    const env = await setup();
    await env.repo.git('commit', '-q', '--amend', '-m', 'Zwei, umformuliert');
    await expectHalted(env, 'history_rewritten');
  });

  it('erkennt einen Rebase als history_rewritten (AK-03-08)', async () => {
    const env = await setup();
    await env.repo.git('checkout', '-q', '-b', 'basis', 'HEAD~1');
    await env.repo.write('b.txt', 'b\n');
    await env.repo.commit('Basis');
    await env.repo.git('checkout', '-q', 'main');
    await env.repo.git('rebase', '-q', 'basis');
    await expectHalted(env, 'history_rewritten');
  });

  it('erkennt git reset --soft HEAD~1 als history_rewritten (Randfall)', async () => {
    const env = await setup();
    await env.repo.git('reset', '-q', '--soft', 'HEAD~1');
    await expectHalted(env, 'history_rewritten');
  });

  it('erkennt detached HEAD als branch_changed (Randfall)', async () => {
    const env = await setup();
    await env.repo.git('checkout', '-q', '--detach');
    const halted = await expectHalted(env, 'branch_changed');
    expect(halted.halt?.observed.branch).toBeNull();
  });

  it('erkennt einen durch Garbage Collection entfernten Vorgänger-HEAD als head_missing (Randfall)', async () => {
    const env = await setup();
    await env.repo.git('reset', '-q', '--hard', 'HEAD~1');
    await env.repo.git('reflog', 'expire', '--expire=now', '--all');
    await env.repo.git('gc', '-q', '--prune=now');
    await expectHalted(env, 'head_missing');
  });

  it('hält beim ersten Commit nach einem Repository ohne Commits nicht an', async () => {
    const repo = await createTempRepo({ commit: false, files: { 'a.txt': 'eins\n' } });
    const dataDir = await createTempDataRoot();
    const workspace = await initRepo(repo, dataDir);
    await repo.commit('Erster Commit');
    const result = await unchanged(repo, () => runCli(['capture'], { dataDir, repo: repo.root }));
    expect(result.exitCode, result.stderr).toBe(0);
    expect((await state(workspace)).halt).toBeNull();
    // The captured untracked file is now committed unchanged.
    expect((await readManifestFile(workspace, 'S000002')).commits[0]!.files).toMatchObject([{ path: 'a.txt', attribution: 'baseline' }]);
  });

  it('endet bei aktivem Halt erneut mit Exit-Code 4 ohne Snapshot (AK-03-09)', async () => {
    const env = await setup();
    await env.repo.git('checkout', '-q', '-b', 'anderer');
    const first = await expectHalted(env, 'branch_changed');
    // Even back on the expected branch the halt stays until ipa baseline.
    await env.repo.git('checkout', '-q', 'main');
    const second = await expectHalted(env, 'branch_changed');
    expect(second.halt).toEqual(first.halt);
  });
});

describe('ipa baseline (spec.md §6.3, §11.5)', () => {
  it('hebt den Halt auf, speichert einen Ausgangs-Snapshot mit Lücken und ordnet danach relativ dazu zu (AK-03-10)', async () => {
    const env = await setup();
    await env.repo.git('checkout', '-q', '-b', 'anderer');
    await env.repo.write('a.txt', 'eins\nzwei\nauf anderem Branch\n');
    const halted = await expectHalted(env, 'branch_changed');
    const before = await listTree(`${env.workspace}/snapshots`);

    const result = await ipa(env, ['baseline', '--reason', 'Wechsel auf Branch anderer']);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('Ausgangs-Snapshot S000003 gespeichert');
    const after = await listTree(`${env.workspace}/snapshots`);
    for (const [file, entry] of Object.entries(before)) expect(after[file], file).toEqual(entry);

    const baseline = await readManifestFile(env.workspace, 'S000003');
    expect(baseline).toMatchObject({ kind: 'baseline', analysisRequired: false, previousSnapshotId: 'S000002', commits: [], statusChanges: [] });
    expect(baseline.gaps).toEqual([
      { type: 'rebaseline', detail: 'Wechsel auf Branch anderer' },
      { type: 'halt_detected', detail: `branch_changed, erkannt am ${halted.halt!.detectedAt}` },
    ]);
    expect(await state(env.workspace)).toMatchObject({ halt: null, branch: 'anderer', lastSnapshotId: 'S000003', baselineSnapshotId: 'S000001' });
    expect(await lastRun(env.workspace)).toMatchObject({ command: 'baseline', exitCode: 0, outcome: 'ok', snapshotCreated: 'S000003' });

    // The state from before the new baseline counts as baseline, not as new work.
    await env.repo.commit('Auf anderem Branch');
    const capture = await ipa(env, ['capture']);
    expect(capture.exitCode, capture.stderr).toBe(0);
    const next = await readManifestFile(env.workspace, 'S000004');
    expect(next.previousSnapshotId).toBe('S000003');
    expect(next.commits[0]!.files).toMatchObject([{ path: 'a.txt', attribution: 'baseline' }]);
    expect(next.evidence.filter((entry) => entry.kind === 'state_delta')).toEqual([]);
    expect(next.analysisRequired).toBe(false);
  });

  it('verlangt ohne Halt --force und ohne --reason einen Grund (AK-03-10)', async () => {
    const env = await setup();
    const withoutHalt = await ipa(env, ['baseline', '--reason', 'Lange Pause']);
    expect(withoutHalt.exitCode).toBe(2);
    expect(withoutHalt.stderr).toContain('--force');
    expect(await lastRun(env.workspace)).toMatchObject({ command: 'baseline', exitCode: 2, outcome: 'usage_error', snapshotCreated: null });
    expect((await ipa(env, ['baseline'])).exitCode).toBe(2);
    expect((await ipa(env, ['baseline', '--force', '--reason', '  '])).exitCode).toBe(2);
    expect(await readdir(`${env.workspace}/snapshots`)).toEqual(['S000001', 'S000002']);

    const forced = await ipa(env, ['baseline', '--force', '--reason', 'Lange Pause']);
    expect(forced.exitCode, forced.stderr).toBe(0);
    expect((await readManifestFile(env.workspace, 'S000003')).gaps).toEqual([{ type: 'rebaseline', detail: 'Lange Pause' }]);
  });

  it('lässt den Halt bei instabilem Stand bestehen und endet mit Exit-Code 5', async () => {
    const env = await setup();
    await env.repo.git('checkout', '-q', '-b', 'anderer');
    const halted = await expectHalted(env, 'branch_changed');
    const ctx = await resolveContext({ repo: env.repo.root, dataDir: env.dataDir, requireInit: true });
    ctx.config.limits.stabilityDelayMs = 1;
    let calls = 0;
    const error = await runBaseline(ctx, {
      reason: 'Neuer Ausgangspunkt',
      hooks: {
        afterFirstPass: async () => {
          calls += 1;
          await env.repo.write('a.txt', `Änderung ${calls}\n`);
        },
      },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IpaError);
    expect(error).toMatchObject({ exitCode: 5 });
    expect(await state(env.workspace)).toMatchObject({ halt: halted.halt, lastSnapshotId: 'S000002' });
    expect(await readdir(`${env.workspace}/snapshots`)).toEqual(['S000001', 'S000002']);
    expect(await lastRun(env.workspace)).toMatchObject({ command: 'baseline', exitCode: 5, outcome: 'unstable' });
  });
});
