/** Types shared by main, preload and renderer (spec §3.9, §5.1). Pure data, no Node or DOM types. */
import type { RunSummary } from './run';

export type IpaError = { code: string; message: string; details?: string };
export type IpaResult<T> = { ok: true; value: T } | { ok: false; error: IpaError };

export type ProjectStatus = 'ok' | 'warning' | 'error' | 'halt';
export type WorkspaceMode = 'default' | 'explicit';

export interface Project {
  repositoryId: string;
  repoPath: string;
  workspacePath: string;
  workspaceMode: WorkspaceMode;
  /** `null` while the status could not be read. */
  timezone: string | null;
  status: ProjectStatus;
  /** Short line next to the status dot (spec §5.1), empty for `ok`. */
  hint: string;
  /** Claude is ready / not ready / never checked, from `status --json`; drives the warning in the header. */
  claudeReady: boolean | null;
}

export type RegistryState = 'ok' | 'missing' | 'invalid' | 'unreadable';

export interface ProjectList {
  registry: { state: RegistryState; path: string; detail: string | null };
  projects: Project[];
}

export type Section = 'overview' | 'day' | 'schedule' | 'config';
export type Page = Section | 'system' | 'add-project';

/** Window state and last selection only; never project configuration (spec §12.4, AK-10-14). */
export interface AppState {
  schemaVersion: 1;
  window: { x: number | null; y: number | null; width: number; height: number; maximized: boolean };
  selection: { repositoryId: string | null; section: Section; day: string | null };
}

export interface VersionInfo {
  app: string;
  electron: string;
  /** Version of the Node runtime that runs the CLI, `null` if it cannot be resolved. */
  node: string | null;
  cli: string | null;
  runtime: 'development' | 'test' | 'installed' | null;
  /** Set when the CLI could not be started; the message is German and names the next step. */
  runtimeProblem: string | null;
}

export interface LiveLine {
  /** ISO 8601 time of the file event. */
  at: string;
  text: string;
  muted?: boolean;
}

export type RunEvent =
  | {
      type: 'started';
      runKey: string;
      repositoryId: string;
      label: string;
      cancellable: boolean;
      ai: boolean;
      /** Long runs show in the run panel; short commands (note, skip, baseline, doctor) report to their dialog. */
      panel: boolean;
      startedAt: string;
    }
  | { type: 'live'; runKey: string; line: LiveLine }
  | {
      type: 'finished';
      runKey: string;
      repositoryId: string;
      exitCode: number | null;
      cancelled: boolean;
      /** Exit code 3 is a notice, not an error (spec §3.7). */
      notice: 'lock_held' | null;
      failure: IpaError | null;
      summary: RunSummary | null;
    };

export type ProjectsChange = { repositoryId: string | null; reason: 'registry' | 'workspace' | 'poll' };

export interface WatchHealth {
  healthy: boolean;
}
