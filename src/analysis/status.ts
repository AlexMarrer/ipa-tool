/**
 * Status of a snapshot, derived only from existing files (spec.md §12.1); there is no status file.
 */
import type { AttemptOutcome } from '../claude/types.js';
import { readManifest } from '../collector/snapshots.js';
import type { WorkspaceContext } from '../core/context.js';
import { type AttemptInfo, listAttempts, listRetries, readCompleteMarker, readSkipMarker } from './files.js';
import type { AnalysisStatus } from './types.js';

export interface StatusFacts {
  complete: boolean;
  skipped: boolean;
  analysisRequired: boolean;
  /** Ascending by number. */
  attempts: readonly { number: number; outcome: AttemptOutcome }[];
  /** Numbers of `retry-<n>.json`. */
  retries: readonly number[];
  maxAttempts: number;
}

/** `input_too_large` does not count towards the attempt limit (spec.md §12.1). */
export function isFailedAttempt(outcome: AttemptOutcome): boolean {
  return outcome !== 'success' && outcome !== 'input_too_large';
}

export function failedAttemptsSinceRetry(attempts: StatusFacts['attempts'], retries: readonly number[]): number {
  const lastRetry = retries.length === 0 ? 0 : Math.max(...retries);
  return attempts.filter((attempt) => attempt.number > lastRetry && isFailedAttempt(attempt.outcome)).length;
}

/** The checks of spec.md §12.1 in their order. */
export function deriveStatus(facts: StatusFacts): AnalysisStatus {
  if (facts.complete) return 'complete';
  if (facts.skipped) return 'skipped';
  if (!facts.analysisRequired) return 'not_required';
  if (facts.attempts.at(-1)?.outcome === 'input_too_large') return 'blocked';
  if (failedAttemptsSinceRetry(facts.attempts, facts.retries) >= facts.maxAttempts) return 'exhausted';
  if (facts.attempts.some((attempt) => isFailedAttempt(attempt.outcome))) return 'failed';
  return 'pending';
}

export interface StatusDetails {
  status: AnalysisStatus;
  attempts: AttemptInfo[];
  retries: number[];
  failedSinceRetry: number;
  /** Number for the next `attempt-<n>/`. */
  nextAttempt: number;
}

/** Reads only what the order of the checks needs. */
export async function analysisDetails(ctx: WorkspaceContext, snapshotId: string): Promise<StatusDetails> {
  const empty = { attempts: [], retries: [], failedSinceRetry: 0, nextAttempt: 1 };
  if ((await readCompleteMarker(ctx.workspaceDir, snapshotId)) !== null) return { status: 'complete', ...empty };
  if ((await readSkipMarker(ctx.workspaceDir, snapshotId)) !== null) return { status: 'skipped', ...empty };
  const manifest = await readManifest(ctx, snapshotId);
  const [attempts, retries] = await Promise.all([listAttempts(ctx.workspaceDir, snapshotId), listRetries(ctx.workspaceDir, snapshotId)]);
  const status = deriveStatus({
    complete: false,
    skipped: false,
    analysisRequired: manifest.analysisRequired,
    attempts,
    retries,
    maxAttempts: ctx.config.claude.maxAttemptsPerSnapshot,
  });
  return {
    status,
    attempts,
    retries,
    failedSinceRetry: failedAttemptsSinceRetry(attempts, retries),
    nextAttempt: (attempts.at(-1)?.number ?? 0) + 1,
  };
}

/** spec.md §10. */
export async function analysisStatus(ctx: WorkspaceContext, snapshotId: string): Promise<AnalysisStatus> {
  return (await analysisDetails(ctx, snapshotId)).status;
}
