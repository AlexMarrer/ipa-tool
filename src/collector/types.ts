/**
 * Snapshot manifest (spec.md §9.3, §9.4) and the collector interface from spec.md §10.
 */
import type { SecretDetector } from '../core/config.js';
import type { Halt } from '../core/state.js';

export type SnapshotKind = 'baseline' | 'work';
export type FileStage = 'clean' | 'staged' | 'unstaged' | 'mixed' | 'untracked';
export type ChangeType = 'A' | 'M' | 'D' | 'R' | 'T' | 'C';
export type Attribution = 'new' | 'documented' | 'baseline' | 'unclear';
export type OmitReason = 'excluded' | 'secret_suspected' | 'binary' | 'file_too_large' | 'snapshot_limit' | 'unreadable' | 'symlink';

export interface Omission {
  reason: OmitReason;
  rule?: string;
  detector?: SecretDetector;
}

export interface EvidenceCommon {
  id: string;
  path: string | null;
  oldPath: string | null;
  commit: string | null;
  /** Relative to the snapshot folder; null when the unit is omitted. */
  file: string | null;
  bytes: number;
  sha256: string | null;
  binary: boolean;
  omitted: Omission | null;
}

export type DiffEvidenceKind = 'commit_message' | 'commit_diff' | 'staged_diff' | 'unstaged_diff';

export interface DiffEvidence extends EvidenceCommon {
  kind: DiffEvidenceKind;
}

export interface StateDeltaEvidence extends EvidenceCommon {
  kind: 'state_delta';
  fromBlob: string | null;
  toBlob: string | null;
}

export interface TestReportEvidence extends EvidenceCommon {
  kind: 'test_report';
  label: string;
  mtime: string;
  fresh: boolean;
}

export type Evidence = DiffEvidence | StateDeltaEvidence | TestReportEvidence;

export interface CommitFile {
  path: string;
  oldPath: string | null;
  change: ChangeType;
  blob: string | null;
  evidence: string | null;
  attribution: Attribution | null;
  coveredBy: string[];
  previousEvidence: string[];
}

export interface CommitRecord {
  sha: string;
  parents: string[];
  authorDate: string;
  committerDate: string;
  authoredByConfiguredUser: boolean;
  isMerge: boolean;
  messageEvidence: string | null;
  files: CommitFile[];
}

export interface FileState {
  path: string;
  stage: FileStage;
  headBlob: string | null;
  indexBlob: string | null;
  worktreeBlob: string | null;
  symlink: boolean;
  copy: string | null;
  copyOmitted: OmitReason | null;
}

export interface StatusChange {
  path: string;
  blob: string | null;
  from: FileStage;
  to: FileStage | 'committed';
  commit: string | null;
  attribution: 'documented' | 'baseline' | 'unclear';
  previousEvidence: string[];
}

export interface TestReportRef {
  path: string;
  label: string;
  sha256: string;
  mtime: string;
}

export interface FilterDecision {
  path: string | null;
  decision: 'excluded' | 'withheld' | 'omitted';
  reason: OmitReason;
  rule: string | null;
  detector: SecretDetector | null;
  line: number | null;
  evidence: string | null;
}

export interface Gap {
  type: 'rebaseline' | 'previous_state_unavailable' | 'halt_detected';
  detail: string;
}

export interface Manifest {
  schemaVersion: 1;
  snapshotId: string;
  repositoryId: string;
  kind: SnapshotKind;
  previousSnapshotId: string | null;
  capturedAt: string;
  observedPeriod: { from: string | null; to: string };
  git: { branch: string | null; head: string | null; indexFingerprint: string; statusFingerprint: string };
  analysisRequired: boolean;
  commits: CommitRecord[];
  fileStates: FileState[];
  evidence: Evidence[];
  statusChanges: StatusChange[];
  testReports: TestReportRef[];
  filterDecisions: FilterDecision[];
  gaps: Gap[];
  stability: { attempts: number; stable: true };
  tool: { name: 'ipa-assistant'; version: string };
}

export type CaptureOutcome =
  | { type: 'created'; snapshotId: string; analysisRequired: boolean }
  | { type: 'unchanged' }
  | { type: 'halted'; halt: Halt };

/** Test hooks (spec.md §10); the shipped CLI never sets them. */
export interface CaptureHooks {
  /** Runs between the first read pass and the consistency check of every attempt. */
  afterFirstPass?(info: { attempt: number }): Promise<void> | void;
  /** Runs after the snapshot folder got its final name and before state.json is updated. */
  beforeStateUpdate?(info: { snapshotId: string }): Promise<void> | void;
}

export interface CaptureOptions {
  kind: SnapshotKind;
  /** `ipa baseline`: stored as a `rebaseline` gap (spec.md §11.5). */
  reason?: string;
  hooks?: CaptureHooks;
  /** Receives German warnings for stderr, for example a missing user.email. */
  onWarning?: (message: string) => void;
}
