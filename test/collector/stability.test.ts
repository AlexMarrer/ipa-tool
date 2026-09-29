import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { runCapture } from '../../src/cli/commands/capture.js';
import { captureSnapshot } from '../../src/collector/capture.js';
import { resolveContext, type WorkspaceContext } from '../../src/core/context.js';
import { IpaError } from '../../src/core/errors.js';
import { initializeWorkspace } from '../../src/core/init.js';
import { readJsonl } from '../../src/core/jsonl.js';
import type { RunRecord } from '../../src/core/run-log.js';
import { createTempRepo, type TempRepo } from '../helpers/git-repo.js';
import { diffFingerprints, expectRepoUnchanged, fingerprintRepo } from '../helpers/repo-fingerprint.js';
import { initRepo, readManifestFile } from '../helpers/snapshots.js';
import { createTempDataRoot, runCli } from '../helpers/workspace.js';

async function setup(): Promise<{ repo: TempRepo; dataDir: string; workspace: string; ctx: WorkspaceContext }> {
  const repo = await createTempRepo({ files: { 'datei.txt': 'eins\n' } });
  const dataDir = await createTempDataRoot();
  const workspace = await initRepo(repo, dataDir);
  const ctx = await resolveContext({ repo: repo.root, dataDir, requireInit: true });
  ctx.config.limits.stabilityDelayMs = 1;
  return { repo, dataDir, workspace, ctx };
}

async function lastRun(workspace: string): Promise<RunRecord | undefined> {
  return (await readJsonl<RunRecord>(`${workspace}/runs.jsonl`, 'run-record')).records.at(-1);
}

describe('Konsistenzprüfung (spec.md §11.2, AK-02-09)', () => {
  it('wiederholt die Aufnahme nach einer einmaligen Änderung zwischen den Lesedurchgängen', async () => {
    const { repo, workspace, ctx } = await setup();
    await repo.write('datei.txt', 'eins\nzwei\n');
    let calls = 0;
    const outcome = await captureSnapshot(ctx, {
      kind: 'work',
      hooks: {
        afterFirstPass: async () => {
          calls += 1;
          if (calls === 1) await repo.write('datei.txt', 'eins\nzwei\ndrei\n');
        },
      },
    });
    expect(outcome).toEqual({ type: 'created', snapshotId: 'S000002', analysisRequired: true });
    expect(calls).toBe(2);
    const manifest = await readManifestFile(workspace, 'S000002');
    expect(manifest.stability).toEqual({ attempts: 2, stable: true });
    const copy = manifest.fileStates.find((state) => state.path === 'datei.txt')!.copy!;
    expect(await readFile(`${workspace}/snapshots/S000002/${copy}`, 'utf8')).toBe('eins\nzwei\ndrei\n');
  });

  it('endet bei dauernder Änderung mit Exit-Code 5, ohne Snapshot-Ordner und mit unverändertem state.json', async () => {
    const { repo, workspace, ctx } = await setup();
    const stateBefore = await readFile(`${workspace}/state.json`, 'utf8');
    const repoBefore = await fingerprintRepo(repo.root);
    let calls = 0;
    const hooks = {
      afterFirstPass: async () => {
        calls += 1;
        await repo.write('datei.txt', `stand ${calls}\n`);
      },
    };
    const error = await captureSnapshot(ctx, { kind: 'work', hooks }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IpaError);
    expect(error).toMatchObject({ code: 'unstable', exitCode: 5 });
    expect(calls).toBe(1 + ctx.config.limits.stabilityRetries);
    expect(await readdir(`${workspace}/snapshots`)).toEqual(['S000001']);
    expect(await readFile(`${workspace}/state.json`, 'utf8')).toBe(stateBefore);

    const run = await runCapture(ctx, { hooks }).catch((e: unknown) => e);
    expect(run).toMatchObject({ exitCode: 5 });
    expect(await lastRun(workspace)).toMatchObject({ command: 'capture', exitCode: 5, outcome: 'unstable', snapshotCreated: null, errors: [{ code: 'unstable' }] });
    expect(await readdir(`${workspace}/snapshots`)).toEqual(['S000001']);
    expect(await readFile(`${workspace}/state.json`, 'utf8')).toBe(stateBefore);
    // Only the hook touched the repository.
    expect(diffFingerprints(repoBefore, await fingerprintRepo(repo.root))).toEqual(['wt:datei.txt']);
  });
});

describe('Wiederanlauf der Aufnahme (spec.md §11.6, AK-02-10)', () => {
  it('übernimmt einen nach dem Umbenennen abgebrochenen Snapshot ohne Duplikat und räumt Reste auf', async () => {
    const { repo, dataDir, workspace, ctx } = await setup();
    await repo.write('datei.txt', 'eins\nzwei\n');
    const aborted = await captureSnapshot(ctx, {
      kind: 'work',
      hooks: {
        beforeStateUpdate: () => {
          throw new Error('Abbruch simuliert');
        },
      },
    }).catch((e: unknown) => e);
    expect(aborted).toBeInstanceOf(Error);
    expect(await readdir(`${workspace}/snapshots`)).toEqual(['S000001', 'S000002']);
    const stateAfterAbort = JSON.parse(await readFile(`${workspace}/state.json`, 'utf8')) as { lastSnapshotId: string; nextSnapshotSeq: number };
    expect(stateAfterAbort).toMatchObject({ lastSnapshotId: 'S000001', nextSnapshotSeq: 2 });

    await mkdir(`${workspace}/snapshots/.tmp-S000009-0badc0de/content`, { recursive: true });
    await writeFile(`${workspace}/snapshots/.tmp-S000009-0badc0de/content/E001.patch`, 'Rest');
    await writeFile(`${workspace}/tmp/hilfsdatei.txt`, 'Rest');

    const before = await fingerprintRepo(repo.root);
    const result = await runCli(['capture'], { dataDir, repo: repo.root });
    expectRepoUnchanged(before, await fingerprintRepo(repo.root));
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toContain('S000002 aus einem abgebrochenen Lauf übernommen');
    expect(await readdir(`${workspace}/snapshots`)).toEqual(['S000001', 'S000002', 'S000003']);
    expect(await readdir(`${workspace}/tmp`)).toEqual([]);
    const next = await readManifestFile(workspace, 'S000003');
    expect(next.previousSnapshotId).toBe('S000002');
    expect(await lastRun(workspace)).toMatchObject({ outcome: 'ok', snapshotCreated: 'S000003', recovered: ['S000002'] });
  });

  it('übernimmt bei init einen Ausgangs-Snapshot, der vor dem Zustands-Update abgebrochen wurde', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    // Without a baseline step, as after an init that stopped before the baseline.
    const created = await initializeWorkspace({ repo: repo.root, dataDir });
    const aborted = await captureSnapshot(created.ctx, {
      kind: 'baseline',
      hooks: {
        beforeStateUpdate: () => {
          throw new Error('Abbruch simuliert');
        },
      },
    }).catch((e: unknown) => e);
    expect(aborted).toBeInstanceOf(Error);

    const result = await runCli(['init'], { dataDir, repo: repo.root });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('aus einer abgebrochenen Initialisierung übernommen');
    expect(await readdir(`${created.entry.workspacePath}/snapshots`)).toEqual(['S000001']);
    expect(await lastRun(created.entry.workspacePath)).toMatchObject({ command: 'init', snapshotCreated: null, recovered: ['S000001'] });
    const again = await runCli(['init'], { dataDir, repo: repo.root });
    expect(again.exitCode).toBe(2);
    expect(again.stderr).toContain('bereits initialisiert');
  });
});
