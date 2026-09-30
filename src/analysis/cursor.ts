/**
 * Analysis cursor (spec.md §12.3, I-03): the last snapshot of the longest gapless prefix from the first
 * snapshot in which every snapshot is `complete` or `skipped`.
 */
import { listSnapshots, readManifest } from '../collector/snapshots.js';
import type { WorkspaceContext } from '../core/context.js';
import { readState, writeState } from '../core/state.js';
import { analysisStatus } from './status.js';
import { type AnalysisStatus, isDone } from './types.js';

/** `ids` ascending; `null` if the first snapshot is not done. */
export function cursorOf(ids: readonly string[], statusOf: (snapshotId: string) => AnalysisStatus): string | null {
  let cursor: string | null = null;
  for (const id of ids) {
    if (!isDone(statusOf(id))) break;
    cursor = id;
  }
  return cursor;
}

/** Writes `lastAnalysedSnapshotId` and `lastCommit` (HEAD of that snapshot) atomically if they changed. */
export async function writeCursor(ctx: WorkspaceContext, cursor: string | null): Promise<void> {
  const state = await readState(ctx.workspaceDir);
  const lastCommit = cursor === null ? null : (await readManifest(ctx, cursor)).git.head;
  if (state.lastAnalysedSnapshotId === cursor && state.lastCommit === lastCommit) return;
  await writeState(ctx.workspaceDir, { ...state, lastAnalysedSnapshotId: cursor, lastCommit });
}

export interface CursorSync {
  cursor: string | null;
  previous: string | null;
  /** Index in `ids` of the first snapshot after the cursor. */
  nextIndex: number;
  ids: string[];
}

/**
 * Recomputes the cursor from the markers and stores it (spec.md §12.4: `complete.json` exists but the
 * cursor lies behind it). Reads statuses only up to the first snapshot that is not done.
 */
export async function syncCursor(ctx: WorkspaceContext): Promise<CursorSync> {
  const ids = await listSnapshots(ctx);
  const { lastAnalysedSnapshotId: previous } = await readState(ctx.workspaceDir);
  let cursor: string | null = null;
  let nextIndex = 0;
  for (const id of ids) {
    if (!isDone(await analysisStatus(ctx, id))) break;
    cursor = id;
    nextIndex += 1;
  }
  await writeCursor(ctx, cursor);
  return { cursor, previous, nextIndex, ids };
}
