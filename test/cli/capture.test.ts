import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { initializeWorkspace } from '../../src/core/init.js';
import { readJsonl } from '../../src/core/jsonl.js';
import type { RunRecord } from '../../src/core/run-log.js';
import type { State } from '../../src/core/state.js';
import { createTempRepo } from '../helpers/git-repo.js';
import { expectRepoUnchanged, fingerprintRepo } from '../helpers/repo-fingerprint.js';
import { initRepo, readManifestFile } from '../helpers/snapshots.js';
import { createTempDataRoot, listTree, readJsonFile, runCli } from '../helpers/workspace.js';

async function runs(workspace: string): Promise<RunRecord[]> {
  const result = await readJsonl<RunRecord>(`${workspace}/runs.jsonl`, 'run-record');
  expect(result.invalid).toEqual([]);
  return result.records;
}

describe('ipa capture (Paket 02)', () => {
  it('nimmt mit Lock einen Arbeits-Snapshot auf, protokolliert den Lauf und zeigt ihn in status (AK-02-02, AK-02-18)', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    const workspace = await initRepo(repo, dataDir);
    for (const [content, args] of [['neu\n', ['capture']], ['neu\nzwei\n', ['capture', '--no-analysis']]] as const) {
      // Each capture needs a change; otherwise it is `unchanged` (package 03).
      await repo.write('neu.txt', content);
      const before = await fingerprintRepo(repo.root);
      const result = await runCli(args, { dataDir, repo: repo.root });
      expectRepoUnchanged(before, await fingerprintRepo(repo.root));
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/Snapshot S00000[23] gespeichert \(Arbeits-Snapshot, ohne Analyse\)/);
      expect(result.stdout).toContain('Dateizustände:');
    }

    const records = await runs(workspace);
    expect(records.map((record) => [record.command, record.exitCode, record.outcome, record.snapshotCreated])).toEqual([
      ['init', 0, 'ok', 'S000001'],
      ['capture', 0, 'ok', 'S000002'],
      ['capture', 0, 'ok', 'S000003'],
    ]);
    const state = await readJsonFile<State>(`${workspace}/state.json`);
    expect(state.lastSuccessfulRun).toBe(records[2]!.endedAt);

    const status = await runCli(['status', '--json'], { dataDir, repo: repo.root });
    expect(JSON.parse(status.stdout)).toMatchObject({ lastSnapshotId: 'S000003', snapshots: { total: 3, baseline: 1, work: 2 } });
    const human = await runCli(['status'], { dataDir, repo: repo.root });
    expect(human.stdout).toMatch(/Snapshots:\s+3 \(Ausgangs-Snapshots: 1, Arbeits-Snapshots: 2\)/);
  });

  it('endet mit Exit-Code 3 und protokolliert den Lauf, wenn ein anderer Lauf den Lock hält', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    const workspace = await initRepo(repo, dataDir);
    const lock = { pid: process.pid, hostname: os.hostname(), command: 'capture', runId: 'R20261014T080312Z-0bad', startedAt: '2026-10-14T10:03:12+02:00' };
    await writeFile(`${workspace}/lock`, JSON.stringify(lock));
    const snapshotsBefore = await listTree(`${workspace}/snapshots`);

    const result = await runCli(['capture'], { dataDir, repo: repo.root });
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('Lock');
    expect(await listTree(`${workspace}/snapshots`)).toEqual(snapshotsBefore);
    expect((await runs(workspace)).at(-1)).toMatchObject({ command: 'capture', exitCode: 3, outcome: 'lock_held', snapshotCreated: null });
  });

  it('verlangt einen Ausgangs-Snapshot; ein erneutes init holt ihn nach (AK-02-01, spec.md §6.3)', async () => {
    const repo = await createTempRepo({ files: { 'a.txt': 'a\n' } });
    const dataDir = await createTempDataRoot();
    // Workspace of an init that stopped before the baseline, as after package 01.
    const created = await initializeWorkspace({ repo: repo.root, dataDir });
    await repo.write('a.txt', 'a\nb\n');

    const capture = await runCli(['capture'], { dataDir, repo: repo.root });
    expect(capture.exitCode).toBe(2);
    expect(capture.stderr).toContain('ipa init');
    expect((await runs(created.entry.workspacePath)).at(-1)).toMatchObject({ command: 'capture', exitCode: 2, outcome: 'usage_error' });

    const conflicting = await runCli(['init', '--timezone', 'America/New_York'], { dataDir, repo: repo.root });
    expect(conflicting.exitCode).toBe(2);
    expect(conflicting.stderr).toContain('Europe/Zurich');

    const init = await runCli(['init', '--timezone', 'Europe/Zurich'], { dataDir, repo: repo.root });
    expect(init.exitCode, init.stderr).toBe(0);
    expect(init.stdout).toContain('Ausgangs-Snapshot nachgeholt.');
    expect(init.stdout).toContain('Ausgangs-Snapshot: S000001');
    const baseline = await readManifestFile(created.entry.workspacePath, 'S000001');
    expect(baseline).toMatchObject({ kind: 'baseline', analysisRequired: false });
    expect(baseline.fileStates.map((state) => [state.path, state.stage])).toEqual([['a.txt', 'unstaged']]);

    const second = await runCli(['init'], { dataDir, repo: repo.root });
    expect(second.exitCode).toBe(2);
    expect(second.stderr).toContain('bereits initialisiert');
    expect((await runCli(['capture'], { dataDir, repo: repo.root })).exitCode).toBe(0);
  });

  it('meldet ein nicht initialisiertes Repository mit Exit-Code 2', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    const result = await runCli(['capture'], { dataDir, repo: repo.root });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('nicht initialisiert');
  });
});
