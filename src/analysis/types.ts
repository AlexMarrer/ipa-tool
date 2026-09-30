/**
 * Data models of the analysis pipeline (spec.md §9.6–§9.9, §10, §12).
 */
import type { AttemptOutcome, ClaudeErrorCode, ValidationErrorCode } from '../claude/types.js';
import type {
  CommitFile,
  CommitRecord,
  DiffEvidence,
  Evidence,
  OmitReason,
  StateDeltaEvidence,
  StatusChange,
  TestReportEvidence,
} from '../collector/types.js';
import type { Note } from '../notes/types.js';

export const PROMPT_VERSION = 'analyze-work@1';
export const PROMPT_FILE = 'analyze-work.md';
export const OUTPUT_SCHEMA_VERSION = 'analysis-output@1';

/** Derived from the files of a snapshot (spec.md §12.1), in the order of the checks. */
export const ANALYSIS_STATUSES = ['complete', 'skipped', 'not_required', 'blocked', 'exhausted', 'failed', 'pending'] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

/** Statuses that still need work; the cursor never passes them (spec.md §12.1, I-03). */
export const OPEN_STATUSES: readonly AnalysisStatus[] = ['pending', 'failed', 'blocked', 'exhausted'];

export function isOpen(status: AnalysisStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

/** The cursor may pass these. */
export function isDone(status: AnalysisStatus): boolean {
  return status === 'complete' || status === 'skipped';
}

export type InputCommitFile = Omit<CommitFile, 'blob'>;
export type InputCommit = Omit<CommitRecord, 'files'> & { files: InputCommitFile[] };

type WithContent<T> = Omit<T, 'file'> & { content: string | null };
export type MessageEvidence = DiffEvidence & { kind: 'commit_message' };
export type InputEvidence = WithContent<MessageEvidence> | WithContent<StateDeltaEvidence> | WithContent<TestReportEvidence>;

export interface ContextEntry {
  /** `C01`, `C02`, … in the order of `config.context.files`. */
  id: string;
  /** As configured, with `/`. */
  path: string;
  sha256: string;
  content: string;
}

export interface FilterSummary {
  excluded: number;
  withheld: number;
  omitted: number;
  byReason: Partial<Record<OmitReason, number>>;
}

/** `attempt-<n>/input.json` (spec.md §9.6); the only data that reaches Claude (§14.6). */
export interface AnalysisInput {
  schemaVersion: 1;
  purpose: 'analysis';
  promptVersion: string;
  snapshotId: string;
  previousSnapshotId: string | null;
  observedPeriod: { from: string | null; to: string };
  repository: { branch: string | null; head: string | null };
  commits: InputCommit[];
  statusChanges: StatusChange[];
  evidence: InputEvidence[];
  notes: Note[];
  context: ContextEntry[];
  filterSummary: FilterSummary;
  allowedEvidenceIds: string[];
}

export interface Claim {
  evidence: string[];
}

/** `structured_output` of Claude (spec.md §9.7). */
export interface AnalysisOutput {
  summary: { text: string } & Claim;
  implemented: ({ title: string; description: string } & Claim)[];
  decisions: ({ title: string; description: string; rationale: string | null; alternatives: string[] } & Claim)[];
  problems: ({ title: string; description: string; cause: string | null; solution: string | null } & Claim)[];
  tests: ({ description: string; result: 'passed' | 'failed' | 'unknown' } & Claim)[];
  contradictions: ({ description: string } & Claim)[];
  unknowns: string[];
}

export interface EvidenceIndexEntry {
  id: string;
  kind: Evidence['kind'] | 'note' | 'context';
  path: string | null;
  /** Relative to the workspace, for example `snapshots/S000002/content/E001.patch`. */
  snapshotFile: string | null;
}

export interface AiProvenance {
  attempt: number;
  analysedAt: string;
  cliVersion: string | null;
  models: string[];
  promptVersion: string;
  outputSchemaVersion: string;
  inputSha256: string;
  notesUsed: { id: string; sha256: string }[];
  contextUsed: { id: string; path: string; sha256: string }[];
}

export interface DeterministicProvenance {
  deterministic: true;
  generatedAt: string;
}

/** `analyses/<snapshotId>/analysis.json` (spec.md §9.8). */
export type AnalysisRecord = {
  schemaVersion: 1;
  snapshotId: string;
  previousSnapshotId: string | null;
  observedPeriod: { from: string | null; to: string };
  repository: { branch: string | null; head: string | null };
  commits: string[];
  evidenceIndex: EvidenceIndexEntry[];
  statusChanges: StatusChange[];
} & ({ analysis: AnalysisOutput; provenance: AiProvenance } | { analysis: null; provenance: DeterministicProvenance });

export interface CompleteMarker {
  schemaVersion: 1;
  snapshotId: string;
  completedAt: string;
  analysisSha256: string;
  logSha256: string;
}

export interface SkipMarker {
  schemaVersion: 1;
  snapshotId: string;
  skippedAt: string;
  reason: string;
}

export interface RetryMarker {
  schemaVersion: 1;
  snapshotId: string;
  requestedAt: string;
}

/** `attempt-<n>/outcome.json` (spec.md §9.9). */
export interface AttemptOutcomeRecord {
  schemaVersion: 1;
  snapshotId: string | null;
  runId: string;
  attempt: number;
  startedAt: string;
  endedAt: string;
  outcome: AttemptOutcome;
  errorCode: ClaudeErrorCode | ValidationErrorCode | null;
  message: string | null;
}

/** Abort points for tests (spec.md §10); the shipped CLI never sets them. */
export interface QueueHooks {
  afterAnalysisWritten?(info: { snapshotId: string }): Promise<void> | void;
  afterLogWritten?(info: { snapshotId: string }): Promise<void> | void;
  afterCompleteMarker?(info: { snapshotId: string }): Promise<void> | void;
}

export type CompletionMode = 'ai' | 'deterministic';

/** A failed attempt of this run, or a snapshot that stays blocked or exhausted. */
export interface QueueProblem {
  snapshotId: string;
  /** Error class, outcome or one of `analysis_exhausted`, `claude_not_ready`, `input_too_large`. */
  code: string;
  /** German, without repository content (I-12). */
  message: string;
}

export type QueueStopReason = 'open' | 'run_limit' | 'deadline';

export interface QueueResult {
  /** Snapshots that got `complete.json` in this run, in order. */
  completed: { snapshotId: string; mode: CompletionMode }[];
  /** Snapshots with a failed attempt in this run or that stay blocked or exhausted. */
  failed: QueueProblem[];
  /** Snapshots whose cursor position was caught up after an abort (spec.md §12.4). */
  caughtUp: string[];
  claudeCalls: number;
  /** Why the queue stopped before the last snapshot, or null. */
  stoppedBy: { reason: QueueStopReason; snapshotId: string } | null;
  cursor: string | null;
  /** Open snapshots after the run with their status. */
  open: { snapshotId: string; status: AnalysisStatus }[];
  /** 6 if a snapshot is `failed`, `blocked` or `exhausted` after the run or Claude was not ready. */
  exitCode: 0 | 6;
  warnings: string[];
}
