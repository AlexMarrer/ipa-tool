/**
 * Data models of the daily journal (spec.md §9.10, §15).
 */
import type { AnalysisOutput, AnalysisStatus } from '../analysis/types.js';
import type { StatusChange } from '../collector/types.js';
import type { Note, NoteType, TimeBasis } from '../notes/types.js';

export const PROMPT_VERSION = 'journal@1';
export const PROMPT_FILE = 'journal.md';
export const OUTPUT_SCHEMA_VERSION = 'journal-output@1';

export type DayAttribution = 'day' | 'unclear';

/** Analysis output of a snapshot with qualified evidence IDs, for example `S000004:E001` (spec.md §9.10). */
export type DerivedAnalysis = AnalysisOutput;

export interface JournalAnalysis {
  snapshotId: string;
  dayAttribution: DayAttribution;
  observedPeriod: { from: string | null; to: string };
  /** `null` without a validated AI analysis or when the re-check withheld it (spec.md §18). */
  derived: DerivedAnalysis | null;
  /** From the manifest; delivered also by snapshots completed without Claude (package 07 §4). */
  statusChanges: StatusChange[];
}

/** Description of a snapshot unit without its content (spec.md §9.10). */
export interface JournalEvidence {
  ref: string;
  kind: 'commit_message' | 'state_delta' | 'test_report';
  path: string | null;
  commit: string | null;
  snapshotId: string;
  omitted: boolean;
  binary: boolean;
  /** Only for `test_report`, otherwise `null`. */
  fresh: boolean | null;
}

export interface JournalCommit {
  sha: string;
  snapshotId: string;
  committerDate: string;
  authoredByConfiguredUser: boolean;
  messageRef: string | null;
  /** Checked message; `null` if it is withheld or omitted, then only `messageRef` remains. */
  message: string | null;
}

export interface JournalContext {
  id: string;
  path: string;
  sha256: string;
  content: string;
}

export interface TimeEntry {
  noteId: string;
  noteType: NoteType;
  minutes: number;
  basis: TimeBasis;
  start: string | null;
  end: string | null;
  /** Plan notes state planned effort and stay out of the sums (spec.md §18). */
  counted: boolean;
  /** The note itself is withheld for a secret hit; its time is still a recorded fact. */
  withheld: boolean;
}

export interface MinuteSums {
  measuredMinutes: number;
  estimatedMinutes: number;
}

/** Deterministic time overview from notes only (spec.md §15, I-07). */
export interface TimeSummary {
  entries: TimeEntry[];
  /** Counted entries, measured and estimated apart; there is no grand total. */
  totals: MinuteSums;
  /** Plan notes with a time, not added to `totals`. */
  planned: MinuteSums;
  delays: { noteId: string; minutes: number; basis: TimeBasis }[];
  /** Shown separately and never added to `totals`. */
  delayTotals: MinuteSums;
  /** Notes of the day without a time: "Zeit unbekannt". */
  notesWithoutTime: string[];
}

export const GAP_TYPES = [
  'rebaseline',
  'previous_state_unavailable',
  'halt_detected',
  'halt',
  'run_failed',
  'no_capture',
  'invalid_notes',
  'withheld',
] as const;
export type JournalGapType = (typeof GAP_TYPES)[number];

export interface JournalGap {
  snapshotId: string | null;
  type: JournalGapType;
  /** German, without repository content (I-12). */
  detail: string;
}

export type OpenAnalysisStatus = Extract<AnalysisStatus, 'pending' | 'failed' | 'blocked' | 'exhausted' | 'skipped'>;

export interface OpenItems {
  analyses: { snapshotId: string; status: OpenAnalysisStatus }[];
  gaps: JournalGap[];
}

/** `journal/runs/<runId>/input.json`; the only data that reaches Claude (spec.md §9.10, §14.6). */
export interface JournalInput {
  schemaVersion: 1;
  purpose: 'journal';
  promptVersion: string;
  day: string;
  timezone: string;
  analyses: JournalAnalysis[];
  evidence: JournalEvidence[];
  commits: JournalCommit[];
  notes: Note[];
  context: JournalContext[];
  timeSummary: TimeSummary;
  openItems: OpenItems;
  allowedEvidenceIds: string[];
}

interface Cited {
  evidence: string[];
}

/** `structured_output` of Claude for a journal (spec.md §9.10). */
export interface JournalOutput {
  planned: ({ text: string } & Cited)[];
  done: ({ text: string } & Cited)[];
  problems: ({ problem: string; cause: string | null; solution: string | null } & Cited)[];
  decisions: ({ decision: string; rationale: string | null; alternatives: string[] } & Cited)[];
  tests: ({ description: string; result: 'passed' | 'failed' | 'unknown' } & Cited)[];
  deviations: ({ text: string } & Cited)[];
  insights: ({ text: string } & Cited)[];
  nextSteps: ({ text: string } & Cited)[];
  unknowns: string[];
}

export type SourceKind = JournalEvidence['kind'] | 'note' | 'context';

export interface JournalSource {
  ref: string;
  kind: SourceKind;
  path: string | null;
  snapshotId: string | null;
  sha256: string | null;
}

export type NoAiReason = 'requested' | 'no_data';

export interface AiJournalProvenance {
  promptVersion: string;
  outputSchemaVersion: string;
  cliVersion: string | null;
  models: string[];
  inputSha256: string;
  /** Workspace-relative, for example `journal/runs/R20261014T160500Z-a3f9`. */
  runDir: string;
}

export interface NoAiJournalProvenance {
  deterministic: true;
  reason: NoAiReason;
}

/** `journal/drafts/<day>-<runId>.json` (spec.md §9.10). */
export type JournalRecord = {
  schemaVersion: 1;
  day: string;
  runId: string;
  generatedAt: string;
  timeSummary: TimeSummary;
  openItems: OpenItems;
  sources: JournalSource[];
} & (
  | { mode: 'ai'; journal: JournalOutput; provenance: AiJournalProvenance }
  | { mode: 'no_ai'; journal: null; provenance: NoAiJournalProvenance }
);
