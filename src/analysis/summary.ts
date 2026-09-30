/**
 * Figures for `ipa status` (spec.md §6.6): analysis statuses and notes withheld for a secret hit.
 */
import { listSnapshots } from '../collector/snapshots.js';
import type { WorkspaceContext } from '../core/context.js';
import { createSecretScanner } from '../filter/secret-scanner.js';
import { readNotes } from '../notes/store.js';
import { noteSecretHits } from './note-secrets.js';
import { analysisStatus } from './status.js';
import { isOpen } from './types.js';

export interface AnalysesSummary {
  pending: number;
  failed: number;
  blocked: number;
  exhausted: number;
  complete: number;
  skipped: number;
  notRequired: number;
  /** Snapshots with status pending, failed, blocked or exhausted, ascending. */
  openIds: string[];
}

export async function summarizeAnalyses(ctx: WorkspaceContext): Promise<AnalysesSummary> {
  const summary: AnalysesSummary = { pending: 0, failed: 0, blocked: 0, exhausted: 0, complete: 0, skipped: 0, notRequired: 0, openIds: [] };
  for (const snapshotId of await listSnapshots(ctx)) {
    const status = await analysisStatus(ctx, snapshotId);
    if (status === 'not_required') summary.notRequired += 1;
    else summary[status] += 1;
    if (isOpen(status)) summary.openIds.push(snapshotId);
  }
  return summary;
}

/** Notes with a secret hit; they never reach Claude and count as open reviews (spec.md §12.2). */
export async function countWithheldNotes(ctx: WorkspaceContext): Promise<number> {
  const scanner = createSecretScanner(ctx.config.secrets);
  const { notes } = await readNotes(ctx);
  return notes.filter((note) => noteSecretHits(scanner, note).length > 0).length;
}
