/**
 * What the renderer may ask the main process to run, and what comes back (app spec §4.1, §8.7). The result carries
 * only whitelisted fields: no paths, no file contents, no reasons and no note texts (I-12, spec §12.6).
 */
import type { ConfigChange, ConfigFinding, ScheduleState } from './config';
import type { IpaError } from './types';

export interface NoteInput {
  text: string;
  type?: 'general' | 'activity' | 'problem' | 'decision' | 'insight' | 'plan';
  day?: string;
  minutes?: number;
  start?: string;
  end?: string;
  timeKind?: 'measured' | 'estimated';
  delay?: number;
  reason?: string;
  alternatives?: string[];
  cause?: string;
  solution?: string;
  refs?: string[];
}

/** The actions package 12 starts. Schedule and configuration commands follow in package 13. */
export type RunInput =
  | { name: 'capture'; mode: 'full' | 'noAnalysis' | 'retry'; retrySnapshotId?: string }
  | { name: 'journal'; day?: string; noAi?: boolean }
  | { name: 'skip'; snapshotId: string; reason: string }
  | { name: 'baseline'; reason: string; force?: boolean }
  /** `live` is the live test of the page System: two short calls of the model (spec §8.13). */
  | { name: 'doctor'; live?: boolean }
  | ({ name: 'note' } & NoteInput)
  /** Saves changes with `ipa config set`; `confirmPaidUsage` only together with `claude.allowPaidUsage = true`. */
  | { name: 'configSet'; changes: ConfigChange[]; confirmPaidUsage?: boolean }
  | { name: 'scheduleInstall'; update?: boolean }
  | { name: 'schedulePause' }
  | { name: 'scheduleResume' }
  | { name: 'scheduleRemove' }
  | { name: 'scheduleRun' };

export const MAX_NOTE_TEXT = 8_000;

export type RunResultView =
  | {
      kind: 'capture';
      capture: 'created' | 'unchanged' | 'halted' | 'unstable' | 'skipped' | null;
      snapshot: { id: string; commits: number; evidence: number; fileStates: number } | null;
      outsideWindow: boolean;
      /** `null` when no analysis ran (`--no-analysis`, outside the window). */
      analysis: null | {
        claudeCalls: number;
        completed: { snapshotId: string; mode: 'ai' | 'deterministic' }[];
        failed: { snapshotId: string; code: string }[];
        open: { snapshotId: string; status: string }[];
      };
      retry: { snapshotId: string; afterAttempt: number } | null;
      halt: 'branch_changed' | 'history_rewritten' | 'head_missing' | null;
    }
  | { kind: 'journal'; day: string; mode: 'ai' | 'no_ai' | null; noAiReason: 'requested' | 'no_data' | null; failure: { code: string } | null; draftWritten: boolean }
  | {
      kind: 'note';
      noteId: string;
      type: NonNullable<NoteInput['type']>;
      activityDay: string;
      time: { minutes: number; basis: 'measured' | 'estimated'; start: string | null; end: string | null } | null;
      delay: { minutes: number; basis: 'measured' | 'estimated' } | null;
      /** Detector and field only, never the value. */
      secretFindings: { detector: string; field: string }[];
    }
  | { kind: 'config'; valid: boolean | null; findings: ConfigFinding[]; /** Paths only, never the values. */ changedPaths: string[]; written: boolean }
  | { kind: 'schedule'; action: string; changed: boolean; state: ScheduleState | null; differences: string[]; detail: string | null; running: boolean; insideWindow: boolean | null }
  | { kind: 'skip'; snapshotId: string; previousStatus: string }
  | { kind: 'baseline'; snapshotId: string; forced: boolean; endedHalt: 'branch_changed' | 'history_rewritten' | 'head_missing' | null }
  | {
      kind: 'doctor';
      ok: boolean;
      checkedAt: string;
      git: { found: boolean; version: string | null };
      claude: { found: boolean; version: string | null; loggedIn: boolean | null; authMethod: string | null };
      billing: { detected: boolean; allowPaidUsage: boolean; blocked: boolean; /** Names of variables and settings, never values. */ sources: string[]; /** Settings files that could not be read. */ unreadable?: string[] };
      /** Result of the live test, if one ran. */
      live?: { ok: boolean } | null;
      findings: string[];
    };

export interface RunSummary {
  /** Label such as `capture --no-analysis`; no argument values. */
  command: string;
  exitCode: number | null;
  outcome: string | null;
  runId: string | null;
  errors: { code: string; message: string }[];
  warnings: string[];
  /** What the CLI wrote to stderr, for the folded "Ausgabe des Befehls". */
  output: string;
  /** A failure of the app around the CLI (spec §3.4), as opposed to an exit code. */
  failure: IpaError | null;
  cancelled: boolean;
  result: RunResultView | null;
  /** Since when a foreign run holds the lock (exit code 3), from the lock file. */
  lock: { command: string; startedAt: string } | null;
}

export interface LockState {
  /** Runs the app started itself. */
  own: { runKey: string; label: string; ai: boolean; cancellable: boolean; kind: 'write' | 'journal' | 'doctor' | 'short' }[];
  /** A run of the scheduled task or the console, from the lock file of a living process. */
  foreign: { command: string; startedAt: string } | null;
}

export type StartOutcome = { ok: true; runKey: string } | { ok: false; reason: string; message: string };
