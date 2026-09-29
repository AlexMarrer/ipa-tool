/**
 * State delta planning and attribution (spec.md §11.4, I-08). Pure: all Git lookups happen before.
 */
import type { Lineage } from './lineage.js';
import type { Attribution, FileStage, StatusChange } from './types.js';

export interface EffectiveState {
  /** Worktree blob, or null if the file does not exist. */
  blob: string | null;
  /** False if the state could not be determined (link, unreadable). */
  known: boolean;
  /** `clean` for paths that are not listed in the file states. */
  stage: FileStage;
}

export interface PathTransition {
  path: string;
  previous: EffectiveState;
  current: EffectiveState;
  /** Last new commit that changed the path, or null. */
  committedIn: string | null;
}

export interface CommitFileInput {
  path: string;
  blob: string | null;
}

export interface PlannedDelta {
  path: string;
  /** Null if the previous state is unknown or the file did not exist. */
  fromBlob: string | null;
  toBlob: string | null;
  previousKnown: boolean;
}

export interface CommitFileAttribution {
  attribution: Attribution;
  /** Path of the covering `state_delta`, resolved to its evidence ID when the manifest is built. */
  coveredByPath: string | null;
  previousEvidence: string[];
}

export interface AttributionPlan {
  /** Sorted by path. */
  deltas: PlannedDelta[];
  statusChanges: StatusChange[];
  /** Same shape as the commits and their files of the input. */
  commitFiles: CommitFileAttribution[][];
}

function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function planAttribution(transitions: readonly PathTransition[], commits: readonly (readonly CommitFileInput[])[], lineage: Lineage): AttributionPlan {
  const deltas: PlannedDelta[] = [];
  const statusChanges: StatusChange[] = [];

  for (const { path, previous, current, committedIn } of [...transitions].sort((a, b) => comparePaths(a.path, b.path))) {
    // Without a determined current state nothing can be said about the path.
    if (!current.known) continue;
    if (!previous.known || previous.blob !== current.blob) {
      deltas.push({ path, fromBlob: previous.known ? previous.blob : null, toBlob: current.blob, previousKnown: previous.known });
      continue;
    }
    // Same effective state: only the stage may have changed (I-08).
    const to = committedIn !== null && current.stage === 'clean' && previous.stage !== 'clean' ? 'committed' : current.stage;
    if (to === previous.stage) continue;
    const documented = lineage.documented(path, current.blob);
    statusChanges.push({
      path,
      blob: current.blob,
      from: previous.stage,
      to,
      commit: to === 'committed' ? committedIn : null,
      attribution: documented.length > 0 ? 'documented' : lineage.isBaseline(path, current.blob) ? 'baseline' : 'unclear',
      previousEvidence: documented,
    });
  }

  const covered = new Set(deltas.map((delta) => delta.path));
  const commitFiles = commits.map((files) =>
    files.map(({ path, blob }): CommitFileAttribution => {
      const documented = lineage.documented(path, blob);
      if (documented.length > 0) return { attribution: 'documented', coveredByPath: null, previousEvidence: documented };
      if (lineage.isBaseline(path, blob)) return { attribution: 'baseline', coveredByPath: null, previousEvidence: [] };
      if (covered.has(path)) return { attribution: 'new', coveredByPath: path, previousEvidence: [] };
      return { attribution: 'unclear', coveredByPath: null, previousEvidence: [] };
    }),
  );
  return { deltas, statusChanges, commitFiles };
}
