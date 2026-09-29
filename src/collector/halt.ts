/**
 * Halt detection (spec.md §11.5): the attribution sequence stops on a branch change or rewritten history.
 */
import type { Halt, HaltReason, RepositoryPosition } from '../core/state.js';
import { objectExists } from '../git/objects.js';
import type { GitRunner } from '../git/runner.js';

/** Reason for a halt, or null if `observed` continues the sequence that ended at `expected`. */
export async function detectHaltReason(git: GitRunner, expected: RepositoryPosition, observed: RepositoryPosition): Promise<HaltReason | null> {
  if (expected.branch !== observed.branch) return 'branch_changed';
  // No commit yet at the previous snapshot: the first commit continues the sequence.
  if (expected.head === null || expected.head === observed.head) return null;
  if (!(await objectExists(git, expected.head, 'commit'))) return 'head_missing';
  if (observed.head === null) return 'history_rewritten';
  const ancestor = await git.run(['merge-base', '--is-ancestor', expected.head, observed.head], { okExitCodes: [0, 1] });
  return ancestor.exitCode === 0 ? null : 'history_rewritten';
}

export async function detectHalt(
  git: GitRunner,
  expected: RepositoryPosition,
  observed: RepositoryPosition,
  detectedAt: string,
): Promise<Halt | null> {
  const reason = await detectHaltReason(git, expected, observed);
  return reason === null ? null : { reason, detectedAt, expected, observed };
}

const REASON_TEXT: Record<HaltReason, string> = {
  branch_changed: 'Der Branch hat gewechselt',
  history_rewritten: 'Die Historie wurde umgeschrieben (zum Beispiel Rebase, Amend oder Reset)',
  head_missing: 'Der Commit des letzten Snapshots existiert nicht mehr',
};

function describePosition(position: RepositoryPosition): string {
  const branch = position.branch ?? '(detached HEAD)';
  const head = position.head === null ? '(kein Commit)' : position.head.slice(0, 12);
  return `Branch ${branch}, HEAD ${head}`;
}

/** German explanation for stderr and `ipa status`; contains no repository content. */
export function describeHalt(halt: Halt): string {
  return (
    `${REASON_TEXT[halt.reason]} (${halt.reason}, erkannt am ${halt.detectedAt}). ` +
    `Erwartet: ${describePosition(halt.expected)}; vorgefunden: ${describePosition(halt.observed)}.`
  );
}

export const BASELINE_HINT =
  'Die Zuordnung ist angehalten. Bereits gespeicherte Snapshots bleiben unverändert. ' +
  'Nach Prüfung des Repositorys mit ipa baseline --reason "<Grund>" einen neuen Ausgangspunkt setzen.';
