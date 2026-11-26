import type { SnapshotStatus } from '../../shared/views';

export type AttemptOutcomeName = 'success' | 'claude_error' | 'invalid_response' | 'validation_failed' | 'input_too_large' | 'interrupted';

export interface StatusFacts {
  complete: boolean;
  skipped: boolean;
  analysisRequired: boolean;
  /** Ascending by number. */
  attempts: readonly { number: number; outcome: AttemptOutcomeName }[];
  /** Numbers `n` of `retry-<n>.json`. */
  retries: readonly number[];
  maxAttempts: number;
}

/** `input_too_large` does not count towards the attempt limit (CLI spec §12.1). */
export function isFailedAttempt(outcome: AttemptOutcomeName): boolean {
  return outcome !== 'success' && outcome !== 'input_too_large';
}

export function failedAttemptsSinceRetry(attempts: StatusFacts['attempts'], retries: readonly number[]): number {
  const lastRetry = retries.length === 0 ? 0 : Math.max(...retries);
  return attempts.filter((attempt) => attempt.number > lastRetry && isFailedAttempt(attempt.outcome)).length;
}

/** The order of checks in app spec §5.3, equal to the CLI. Derived from files only; there is no status file. */
export function deriveSnapshotStatus(facts: StatusFacts): SnapshotStatus {
  if (facts.complete) return 'complete';
  if (facts.skipped) return 'skipped';
  if (!facts.analysisRequired) return 'not_required';
  if (facts.attempts.at(-1)?.outcome === 'input_too_large') return 'blocked';
  if (failedAttemptsSinceRetry(facts.attempts, facts.retries) >= facts.maxAttempts) return 'exhausted';
  if (facts.attempts.some((attempt) => isFailedAttempt(attempt.outcome))) return 'failed';
  return 'pending';
}

export interface AnalysisCounts {
  pending: number;
  failed: number;
  blocked: number;
  exhausted: number;
  complete: number;
  skipped: number;
  notRequired: number;
}

export function countStatuses(statuses: readonly SnapshotStatus[]): AnalysisCounts {
  const counts: AnalysisCounts = { pending: 0, failed: 0, blocked: 0, exhausted: 0, complete: 0, skipped: 0, notRequired: 0 };
  for (const status of statuses) {
    if (status === 'not_required') counts.notRequired += 1;
    else counts[status] += 1;
  }
  return counts;
}

export function countsEqual(a: AnalysisCounts, b: AnalysisCounts): boolean {
  return (Object.keys(a) as (keyof AnalysisCounts)[]).every((key) => a[key] === b[key]);
}
