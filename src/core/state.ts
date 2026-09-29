/**
 * Zustand `state.json` (spec.md §9.1).
 */
import path from 'node:path';
import { readJsonValidated, writeJsonAtomic } from './json.js';

export const STATE_FILE = 'state.json';

export type HaltReason = 'branch_changed' | 'history_rewritten' | 'head_missing';

export interface RepositoryPosition {
  branch: string | null;
  head: string | null;
}

export interface Halt {
  reason: HaltReason;
  detectedAt: string;
  expected: RepositoryPosition;
  observed: RepositoryPosition;
}

export interface State {
  schemaVersion: 1;
  repositoryId: string;
  baselineSnapshotId: string | null;
  branch: string | null;
  lastSnapshotId: string | null;
  lastAnalysedSnapshotId: string | null;
  lastCommit: string | null;
  lastSuccessfulRun: string | null;
  nextSnapshotSeq: number;
  halt: Halt | null;
}

/** Anfangszustand nach `ipa init`: alle IDs `null`, `nextSnapshotSeq: 1`, kein Halt. */
export function createInitialState(repositoryId: string): State {
  return {
    schemaVersion: 1,
    repositoryId,
    baselineSnapshotId: null,
    branch: null,
    lastSnapshotId: null,
    lastAnalysedSnapshotId: null,
    lastCommit: null,
    lastSuccessfulRun: null,
    nextSnapshotSeq: 1,
    halt: null,
  };
}

export function statePath(workspaceDir: string): string {
  return path.join(workspaceDir, STATE_FILE);
}

export async function readState(workspaceDir: string): Promise<State> {
  return readJsonValidated<State>(statePath(workspaceDir), 'state');
}

export async function writeState(workspaceDir: string, state: State): Promise<void> {
  await writeJsonAtomic(statePath(workspaceDir), state, 'state');
}
