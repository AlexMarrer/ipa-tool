/**
 * View models built by the reader in the main process (spec §5). Plain data: they never contain file contents of
 * evidence, reasons of skips, or detected secret values.
 */
import type { AnalysisStatus } from './messages';

export type OpenStatus = 'pending' | 'failed' | 'blocked' | 'exhausted';
/** Status of a work snapshot (the baseline is shown through `kind`). */
export type SnapshotStatus = Exclude<AnalysisStatus, 'baseline'>;
export const OPEN_STATUSES: readonly SnapshotStatus[] = ['pending', 'failed', 'blocked', 'exhausted'];

export type DayAttribution = 'day' | 'unclear' | 'baseline';
export type AiMode = 'ai' | 'deterministic' | 'none';

export interface WithheldInfo {
  count: number;
  /** Detector names only, never values. */
  detectors: string[];
}

export interface GapView {
  type: 'rebaseline' | 'halt_detected' | 'previous_state_unavailable';
  detail: string;
}

export interface SnapshotView {
  id: string;
  kind: 'baseline' | 'work';
  capturedAt: string;
  observedPeriod: { from: string | null; to: string };
  branch: string | null;
  commits: number;
  evidence: number;
  status: SnapshotStatus;
  attempts: { failed: number; max: number };
  /** `outcome.json › errorCode` of the last attempt, or the outcome name when there is no error code. */
  lastErrorCode: string | null;
  aiMode: AiMode;
  dayAttribution: DayAttribution;
  withheld: WithheldInfo;
  gaps: GapView[];
  /** Id of the run that created the snapshot (from `runs.jsonl`), if known. */
  runId: string | null;
  /** `HH:MM` of the sort time in the project time zone. */
  time: string;
}

export type NoteType = 'general' | 'activity' | 'problem' | 'decision' | 'insight' | 'plan';
export type Basis = 'measured' | 'estimated';

export interface NoteView {
  id: string;
  type: NoteType;
  /** Text with fields that hit a secret detector replaced; see `withheld`. */
  text: string;
  activityDay: string;
  recordedAt: string;
  time: { minutes: number; basis: Basis; start: string | null; end: string | null } | null;
  delay: { minutes: number; basis: Basis } | null;
  reason: string | null;
  alternatives: string[];
  cause: string | null;
  solution: string | null;
  refs: string[];
  /** `null` unless a text field hit a secret detector (spec §5.5). */
  withheld: { detectors: string[]; fields: string[] } | null;
  /** `HH:MM` or `null` (shown as a dash). */
  displayTime: string | null;
}

export interface RunView {
  runId: string;
  command: string;
  startedAt: string;
  outcome: string;
  exitCode: number;
  durationMs: number;
  errorCodes: string[];
  snapshotCreated: string | null;
  time: string;
}

export interface DraftView {
  file: string;
  runId: string;
  day: string;
  generatedAt: string;
  mode: 'ai' | 'no_ai';
  time: string;
}

/** Minutes per basis; the app never adds the two (spec §5.6, I-07). */
export interface MinuteSums {
  measured: number;
  estimated: number;
}

export interface TimeView {
  time: MinuteSums;
  planned: MinuteSums;
  delays: MinuteSums;
  withoutTime: number;
}

export type AttentionKind =
  | 'snapshot_open'
  | 'snapshot_unclear'
  | 'withheld'
  | 'run_failed'
  | 'halt'
  | 'invalid_lines'
  | 'gap'
  | 'no_capture'
  | 'analysis_inconsistent';

export interface AttentionItem {
  id: string;
  /** `notice` entries ("Zur Kenntnis") do not count (spec §5.7). */
  level: 'attention' | 'notice';
  kind: AttentionKind;
  text: string;
  snapshotId?: string;
  status?: SnapshotStatus;
  link?: 'workLogs' | 'overview' | 'timeline';
}

export type TimelineEntry =
  | { kind: 'snapshot'; id: string; time: string | null }
  | { kind: 'note'; id: string; time: string | null }
  | { kind: 'run'; id: string; time: string | null };

export interface InvalidCounts {
  noteLines: number;
  runLines: number;
  unreadableFiles: string[];
}

export interface DayView {
  day: string;
  weekday: string;
  /** German long date such as "Mittwoch, 14. Oktober 2026". */
  title: string;
  timezone: string;
  isFuture: boolean;
  isToday: boolean;
  snapshots: SnapshotView[];
  notes: NoteView[];
  runs: RunView[];
  drafts: DraftView[];
  summary: { snapshotCount: number; noteCount: number; time: TimeView };
  attention: AttentionItem[];
  timeline: TimelineEntry[];
  invalid: InvalidCounts;
}

export interface DayIndexEntry {
  day: string;
  hasData: boolean;
  warning: boolean;
}

export interface DayIndex {
  timezone: string;
  today: string;
  days: DayIndexEntry[];
}

export type FileState = 'ok' | 'missing' | 'unreadable' | 'newer';

export interface WorkLogView {
  snapshot: SnapshotView;
  state: FileState;
  /** Markdown of `logs/<id>.md`, or the replacement text of the app when the log is missing. */
  markdown: string;
  /** `true` when the log does not exist and `markdown` is the replacement view "Nicht erstellt". */
  replacement: boolean;
}

export interface JournalDraftView {
  draft: DraftView;
  state: FileState;
  markdown: string;
  headings: string[];
}

export interface ReferenceTarget {
  /** Day the target belongs to, `null` if it cannot be found. */
  day: string | null;
}

export interface ReferenceIndex {
  notes: Record<string, string>;
  snapshots: Record<string, string>;
  /** Context references of journals and logs: id -> path. Filled per document, not globally. */
}

export interface HaltView {
  reason: 'branch_changed' | 'history_rewritten' | 'head_missing';
  detectedAt: string;
  expected: { branch: string | null; head: string | null };
  observed: { branch: string | null; head: string | null };
  /** Run that detected the halt (the run whose record is closest before `detectedAt`), if known. */
  runId: string | null;
}

export interface ClaudeView {
  /** `null` until `doctor` ran. */
  checkedAt: string | null;
  ok: boolean | null;
  version: string | null;
  problem: string | null;
}

export interface OverviewView {
  halt: HaltView | null;
  claude: ClaudeView;
  lastRun: RunView | null;
  lastSnapshot: { id: string; time: string } | null;
  analysedUpTo: string | null;
  analyses: { pending: number; failed: number; blocked: number; exhausted: number; complete: number; skipped: number; notRequired: number };
  withheld: { units: number; notes: number };
  notesToday: number;
  schedule: { state: string; nextRun: string | null } | null;
  recentDays: { day: string; warning: boolean }[];
  timezone: string;
  /** The app's own derivation differs from `status --json`; the app then shows `status` and a notice (spec §5.3). */
  inconsistent: boolean;
}

/** What the renderer may ask the main process to open or reveal; paths are never passed (spec §3.8). */
export type FileRef =
  | { kind: 'workLog'; snapshotId: string }
  | { kind: 'journalDraft'; file: string }
  | { kind: 'journalFinalFolder' }
  | { kind: 'workspaceFolder' }
  | { kind: 'evidence'; snapshotId: string; evidenceId: string };
