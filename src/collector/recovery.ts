import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceContext } from '../core/context.js';
import { errnoCode, IpaError } from '../core/errors.js';
import { formatSnapshotId } from '../core/ids.js';
import { readState, writeState } from '../core/state.js';
import { readManifest, snapshotsDir, TEMP_PREFIX } from './snapshots.js';

export const TMP_FOLDER = 'tmp';

export interface RecoveryResult {
  /** Snapshots stored by an aborted run and now taken over into state.json. */
  recovered: string[];
  removedTempDirs: number;
}

async function removeEntries(dir: string, select: (name: string) => boolean): Promise<number> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return 0;
    throw error;
  }
  let removed = 0;
  for (const name of names.filter(select)) {
    await rm(path.join(dir, name), { recursive: true, force: true, maxRetries: 3 });
    removed += 1;
  }
  return removed;
}

async function adoptableManifest(ctx: WorkspaceContext, snapshotId: string) {
  try {
    return await readManifest(ctx, snapshotId);
  } catch (error) {
    if (error instanceof IpaError && error.code === 'file_not_found') return null;
    throw error;
  }
}

/**
 * Restart rules of spec.md §11.6, run at the start of every command that takes the lock:
 * removes orphaned `snapshots/.tmp-*` folders, takes over a snapshot that was stored completely
 * before state.json was updated, and empties `tmp/`.
 */
export async function recoverWorkspace(ctx: WorkspaceContext): Promise<RecoveryResult> {
  const removedTempDirs = await removeEntries(snapshotsDir(ctx.workspaceDir), (name) => name.startsWith(TEMP_PREFIX));

  const recovered: string[] = [];
  let state = await readState(ctx.workspaceDir);
  for (;;) {
    const snapshotId = formatSnapshotId(state.nextSnapshotSeq);
    const manifest = await adoptableManifest(ctx, snapshotId);
    if (manifest === null) break;
    state = {
      ...state,
      lastSnapshotId: snapshotId,
      nextSnapshotSeq: state.nextSnapshotSeq + 1,
      branch: manifest.git.branch,
      baselineSnapshotId: state.baselineSnapshotId ?? (manifest.kind === 'baseline' ? snapshotId : null),
    };
    await writeState(ctx.workspaceDir, state);
    recovered.push(snapshotId);
  }

  await removeEntries(path.join(ctx.workspaceDir, TMP_FOLDER), () => true);
  return { recovered, removedTempDirs };
}
