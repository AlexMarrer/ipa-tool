/**
 * The wizard "Projekt hinzufügen" and the page System (app spec §8.12, §8.13). The renderer never names a folder:
 * the main process remembers the one the user chose in the system dialog and checks and sets up exactly that one.
 */
import type { IpaError } from './types';

export interface ProjectCheck {
  /** Folder as the user chose it, for display only. */
  repoPath: string;
  dataRoot: {
    path: string | null;
    /** Probe file could be written (and deleted) in the data root or its nearest existing parent. */
    writable: boolean;
    /** Whether the data root exists yet. */
    exists: boolean;
    detail: string | null;
  };
  repository: {
    /** The chosen folder is the main folder of a Git repository. */
    isMainFolder: boolean;
    /** The folder lies inside a repository but is not its main folder. */
    insideRepository: boolean;
    branch: string | null;
    head: string | null;
  };
  /** `registry.json` already knows this repository. */
  existing: { repositoryId: string } | null;
  gitVersion: string | null;
  /** Newest `doctor.json` of any project, `null` if there is none (AO-08). */
  claude: { ok: boolean; version: string | null; authMethod: string | null; checkedAt: string } | null;
}

export interface InitInput {
  timezone: string;
  /** `default`: in the data root; `repository`: `.ipa` inside the repository. */
  workspace: 'default' | 'repository';
}

export interface InitOutcome {
  exitCode: number | null;
  errors: { code: string; message: string }[];
  warnings: string[];
  failure: IpaError | null;
  result: {
    created: boolean;
    repositoryId: string;
    workspacePath: string;
    workspaceMode: 'default' | 'explicit';
    timezone: string;
    baselineSnapshotId: string | null;
    claude: { checked: boolean; ok: boolean | null; cliVersion: string | null; problems: string | null };
  } | null;
}

export interface UsageRow {
  repositoryId: string;
  runId: string;
  /** Local day in the time zone of the project. */
  day: string;
  time: string;
  startedAt: string;
  purpose: 'analysis' | 'journal' | 'doctor';
  durationMs: number;
  models: string[];
  outcome: 'success' | 'claude_error' | 'invalid_response';
  /** Rough value in USD, `null` when unknown. Never a bill (spec §8.13). */
  costUsd: number | null;
}

export type UsageRange = '7' | '30' | 'all';

export interface SystemStatus {
  /** Newest check of Claude and Git over all projects, `null` if none was made. */
  check: {
    checkedAt: string;
    ok: boolean;
    claude: { found: boolean; version: string | null; loggedIn: boolean | null; authMethod: string | null };
    git: { found: boolean; version: string | null };
    liveCheck: { ok: boolean; checkedAt: string } | null;
  } | null;
  dataRoot: string | null;
  /** Projects whose workspace lies inside the repository (the backup note names them). */
  workspacesInRepository: string[];
}
