/**
 * Turns an observation into a manifest and the content files to store: binary check, size limits
 * and secret check before any storage (spec.md §14), evidence IDs and file names (§8.1, §9.3).
 */
import { formatZoned } from '../core/time.js';
import { toolVersion } from '../core/tool.js';
import type { SecretScanner } from '../filter/secret-scanner.js';
import type { CommitFileAttribution } from './attribution.js';
import type { DeltaUnit } from './delta.js';
import type { DiffUnit } from './diffs.js';
import { renderNewFilePatch } from './new-file-patch.js';
import { type Observation, type ObservedFile, unreadableReason } from './observe.js';
import { isFresh, type ObservedReport } from './test-reports.js';
import type {
  CommitRecord,
  DiffEvidenceKind,
  Evidence,
  FileState,
  FilterDecision,
  Gap,
  Manifest,
  Omission,
  OmitReason,
  SnapshotKind,
  StatusChange,
} from './types.js';
import { isBinaryContent, sha256Hex } from './worktree.js';

export interface BuildInput {
  snapshotId: string;
  repositoryId: string;
  kind: SnapshotKind;
  previous: { snapshotId: string; capturedAt: string } | null;
  observation: Observation;
  attempts: number;
  timezone: string;
  limits: { maxFileBytes: number; maxSnapshotBytes: number };
  scanner: SecretScanner;
  /** Result of the attribution (spec.md §11.4); absent for baseline snapshots. */
  attribution?: {
    deltas: readonly DeltaUnit[];
    statusChanges: readonly StatusChange[];
    /** Same shape as `observation.commits` and their units. */
    commitFiles: readonly (readonly CommitFileAttribution[])[];
  };
  /** Every configured report that exists now; the comparison base of the next snapshot. */
  reports: readonly ObservedReport[];
  /** Reports that are new or changed; each becomes a `test_report` (empty for baselines). */
  newReports: readonly ObservedReport[];
  gaps: readonly Gap[];
}

export interface BuiltSnapshot {
  manifest: Manifest;
  /** Content files relative to the snapshot folder. */
  files: Map<string, Buffer>;
}

interface Unit {
  content: Buffer | null;
  /** Size of the unit if known, also when it is omitted. */
  size: number;
  binary: boolean;
  omitted: Omission | null;
  /** First line with a secret hit. */
  line: number | null;
}

interface EvidenceDraft extends Unit {
  kind: DiffEvidenceKind | 'state_delta' | 'test_report';
  path: string | null;
  oldPath: string | null;
  commit: string | null;
  extension: 'patch' | 'txt';
  delta?: { fromBlob: string | null; toBlob: string | null };
  report?: { label: string; mtime: string; fresh: boolean };
}

interface CopyDraft extends Unit {
  path: string;
}

function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function unitOf(content: Buffer | null, omitted: Omission | null, size = content?.length ?? 0, binary = false): Unit {
  return { content, size, binary, omitted, line: null };
}

function screen(unit: Unit, scanner: SecretScanner, maxFileBytes: number): void {
  if (unit.omitted !== null) return;
  if (unit.content === null) {
    unit.omitted = { reason: 'unreadable' };
  } else if (unit.binary || isBinaryContent(unit.content)) {
    unit.binary = true;
    unit.omitted = { reason: 'binary' };
  } else if (unit.size > maxFileBytes) {
    unit.omitted = { reason: 'file_too_large' };
  } else {
    // latin1 keeps every byte, so the ASCII patterns work on any text encoding.
    const hit = scanner.scan(unit.content.toString('latin1'))[0];
    if (hit !== undefined) {
      unit.omitted = { reason: 'secret_suspected', detector: hit.detector };
      unit.line = hit.line;
    }
  }
}

/** spec.md §14.5: once the sum would exceed the limit, every further unit is omitted. */
function applySnapshotLimit(units: readonly Unit[], maxSnapshotBytes: number): void {
  let total = 0;
  let exceeded = false;
  for (const unit of units) {
    if (unit.omitted !== null) continue;
    if (!exceeded && total + unit.size <= maxSnapshotBytes) {
      total += unit.size;
    } else {
      exceeded = true;
      unit.omitted = { reason: 'snapshot_limit' };
    }
  }
}

function diffDraft(kind: DiffEvidenceKind, unit: DiffUnit, commit: string | null): EvidenceDraft {
  return {
    ...unitOf(unit.content, unit.omitted, unit.content?.length ?? 0, unit.binary),
    kind,
    path: unit.path,
    oldPath: unit.oldPath,
    commit,
    extension: 'patch',
  };
}

/** `unstaged_diff` of an untracked file: a new-file patch built from the bytes read once. */
function untrackedDraft(file: ObservedFile): EvidenceDraft {
  const read = file.read;
  const base = { kind: 'unstaged_diff' as const, path: file.path, oldPath: null, commit: null, extension: 'patch' as const };
  const blocked = unreadableReason(read);
  if (blocked !== null) return { ...base, ...unitOf(null, blocked) };
  if (read?.state === 'symlink' || file.symlink) return { ...base, ...unitOf(null, { reason: 'symlink' }) };
  if (read?.state === 'large') {
    return { ...base, ...unitOf(null, { reason: read.binary ? 'binary' : 'file_too_large' }, read.size, read.binary) };
  }
  if (read?.state !== 'file' || file.worktreeBlob === null) return { ...base, ...unitOf(null, { reason: 'unreadable' }) };
  if (read.binary) return { ...base, ...unitOf(null, { reason: 'binary' }, read.size, true) };
  return { ...base, ...unitOf(renderNewFilePatch(file.path, read.content, file.worktreeBlob, read.executable ? '100755' : '100644'), null) };
}

/**
 * Copy of the effective state for every non-clean path that differs from HEAD (spec.md §11.4).
 * Returns the omission reason instead when the content must not or cannot be read.
 */
function copyDraft(file: ObservedFile): CopyDraft | OmitReason | null {
  if (file.stage === 'clean' || file.submodule) return null;
  const blocked = unreadableReason(file.read);
  if (blocked !== null) return blocked.reason;
  if (file.worktreeBlob === null || file.worktreeBlob === file.headBlob) return null;
  const read = file.read;
  if (read?.state === 'file') return { path: file.path, ...unitOf(read.content, null, read.size, read.binary) };
  // A link is stored as its target text only (D-20).
  if (read?.state === 'symlink') return { path: file.path, ...unitOf(read.target, null) };
  if (read?.state === 'large') {
    return { path: file.path, ...unitOf(null, { reason: read.binary ? 'binary' : 'file_too_large' }, read.size, read.binary) };
  }
  return null;
}

function decisionOf(unit: Unit, path: string | null, evidence: string | null): FilterDecision {
  const omitted = unit.omitted!;
  return {
    path,
    decision: omitted.reason === 'secret_suspected' ? 'withheld' : omitted.reason === 'excluded' ? 'excluded' : 'omitted',
    reason: omitted.reason,
    rule: omitted.rule ?? null,
    detector: omitted.detector ?? null,
    line: unit.line,
    evidence,
  };
}

/** spec.md §11.3 (D-08): a delta, a new test report or a commit file that is new or unclear. */
export function analysisRequired(evidence: readonly Evidence[], commits: readonly CommitRecord[]): boolean {
  if (evidence.some((entry) => entry.kind === 'state_delta' || entry.kind === 'test_report')) return true;
  return commits.some((commit) => commit.files.some((file) => file.attribution === 'new' || file.attribution === 'unclear'));
}

export function buildSnapshot(input: BuildInput): BuiltSnapshot {
  const { observation, timezone, scanner, limits } = input;
  const drafts: EvidenceDraft[] = [];
  const commitDrafts: { messageIndex: number | null; files: { unit: DiffUnit; draftIndex: number; unitIndex: number }[] }[] = [];

  for (const commit of observation.commits) {
    let messageIndex: number | null = null;
    if (commit.meta.message !== '') {
      messageIndex = drafts.length;
      const message = Buffer.from(commit.meta.message, 'utf8');
      drafts.push({ ...unitOf(message, null), kind: 'commit_message', path: null, oldPath: null, commit: commit.meta.sha, extension: 'txt' });
    }
    const commitFiles: { unit: DiffUnit; draftIndex: number; unitIndex: number }[] = [];
    const ordered = commit.units.map((unit, unitIndex) => ({ unit, unitIndex })).sort((a, b) => comparePaths(a.unit.path, b.unit.path));
    for (const { unit, unitIndex } of ordered) {
      commitFiles.push({ unit, draftIndex: drafts.length, unitIndex });
      drafts.push(diffDraft('commit_diff', unit, commit.meta.sha));
    }
    commitDrafts.push({ messageIndex, files: commitFiles });
  }
  for (const unit of [...observation.staged].sort((a, b) => comparePaths(a.path, b.path))) {
    drafts.push(diffDraft('staged_diff', unit, null));
  }
  const unstaged = [
    ...observation.unstaged.map((unit) => diffDraft('unstaged_diff', unit, null)),
    ...observation.files.filter((file) => file.stage === 'untracked').map(untrackedDraft),
  ].sort((a, b) => comparePaths(a.path ?? '', b.path ?? ''));
  drafts.push(...unstaged);

  // IDs continue after the diffs so that package 02 numbering stays stable (spec.md §18).
  const deltaStart = drafts.length;
  for (const delta of input.attribution?.deltas ?? []) {
    drafts.push({
      ...unitOf(delta.content, delta.omitted, delta.size, delta.binary),
      kind: 'state_delta',
      path: delta.path,
      oldPath: null,
      commit: null,
      extension: 'patch',
      delta: { fromBlob: delta.fromBlob, toBlob: delta.toBlob },
    });
  }
  const reportStart = drafts.length;
  for (const report of input.newReports) {
    const omitted: Omission | null = report.content === null ? { reason: report.binary ? 'binary' : 'file_too_large' } : null;
    drafts.push({
      ...unitOf(report.content, omitted, report.size, report.binary),
      kind: 'test_report',
      path: report.path,
      oldPath: null,
      commit: null,
      extension: 'txt',
      report: {
        label: report.label,
        mtime: formatZoned(new Date(report.mtimeMs), timezone),
        fresh: isFresh(report.mtimeMs, input.previous?.capturedAt ?? null, observation.capturedAt),
      },
    });
  }

  const files = [...observation.files].sort((a, b) => comparePaths(a.path, b.path));
  const copies = new Map<string, CopyDraft | OmitReason>();
  for (const file of files) {
    const copy = copyDraft(file);
    if (copy !== null) copies.set(file.path, copy);
  }
  const copyUnits = [...copies.values()].filter((copy): copy is CopyDraft => typeof copy !== 'string');

  for (const unit of [...copyUnits, ...drafts]) screen(unit, scanner, limits.maxFileBytes);
  // Copies first: they are the previous state for the next capture. Then the evidence that goes to
  // Claude, so that diffs which are never sent cannot crowd it out (spec.md §18).
  applySnapshotLimit([...copyUnits, ...drafts.slice(deltaStart), ...drafts.slice(0, deltaStart)], limits.maxSnapshotBytes);

  const stored = new Map<string, Buffer>();
  const store = (unit: Unit, file: string): { file: string | null; sha256: string | null } => {
    if (unit.omitted !== null || unit.content === null) return { file: null, sha256: null };
    stored.set(file, unit.content);
    return { file, sha256: sha256Hex(unit.content) };
  };

  const evidence: Evidence[] = drafts.map((draft, index): Evidence => {
    const id = `E${String(index + 1).padStart(3, '0')}`;
    const { file, sha256 } = store(draft, `content/${id}.${draft.extension}`);
    const common = {
      id,
      path: draft.path,
      oldPath: draft.oldPath,
      commit: draft.commit,
      file,
      bytes: draft.size,
      sha256,
      binary: draft.binary,
      omitted: draft.omitted,
    };
    if (draft.kind === 'state_delta') return { ...common, kind: 'state_delta', fromBlob: draft.delta!.fromBlob, toBlob: draft.delta!.toBlob };
    if (draft.kind === 'test_report') return { ...common, kind: 'test_report', ...draft.report! };
    return { ...common, kind: draft.kind };
  });
  const deltaIds = new Map(evidence.slice(deltaStart, reportStart).map((entry) => [entry.path!, entry.id]));

  let copyNumber = 0;
  const fileStates: FileState[] = files.map((file) => {
    const copy = copies.get(file.path);
    let copyFile: string | null = null;
    let copyOmitted: OmitReason | null = null;
    if (typeof copy === 'string') {
      copyOmitted = copy;
    } else if (copy !== undefined) {
      if (copy.omitted === null) {
        copyNumber += 1;
        copyFile = store(copy, `content/state/${String(copyNumber).padStart(4, '0')}.dat`).file;
      } else {
        copyOmitted = copy.omitted.reason;
      }
    }
    return {
      path: file.path,
      stage: file.stage,
      headBlob: file.headBlob,
      indexBlob: file.indexBlob,
      worktreeBlob: file.worktreeBlob,
      symlink: file.symlink,
      copy: copyFile,
      copyOmitted,
    };
  });

  const email = observation.configuredEmail?.toLowerCase() ?? null;
  const commits: CommitRecord[] = observation.commits.map((commit, index) => {
    const links = commitDrafts[index]!;
    return {
      sha: commit.meta.sha,
      parents: commit.meta.parents,
      authorDate: formatZoned(new Date(commit.meta.authorTime * 1000), timezone),
      committerDate: formatZoned(new Date(commit.meta.committerTime * 1000), timezone),
      // D-19: only this boolean is kept, never the address.
      authoredByConfiguredUser: email !== null && commit.meta.authorEmail.trim().toLowerCase() === email,
      isMerge: commit.meta.parents.length > 1,
      messageEvidence: links.messageIndex === null ? null : evidence[links.messageIndex]!.id,
      files: links.files.map(({ unit, draftIndex, unitIndex }) => {
        const assigned = input.attribution?.commitFiles[index]?.[unitIndex];
        const covering = assigned?.coveredByPath == null ? undefined : deltaIds.get(assigned.coveredByPath);
        return {
          path: unit.path,
          oldPath: unit.oldPath,
          change: unit.change,
          blob: unit.dstBlob,
          evidence: evidence[draftIndex]!.id,
          attribution: assigned?.attribution ?? null,
          coveredBy: covering === undefined ? [] : [covering],
          previousEvidence: assigned?.previousEvidence ?? [],
        };
      }),
    };
  });

  const filterDecisions: FilterDecision[] = [
    ...[...observation.excluded].map(([path, rule]): FilterDecision => ({
      path,
      decision: 'excluded',
      reason: 'excluded',
      rule,
      detector: null,
      line: null,
      evidence: null,
    })),
    ...observation.nestedRepositories.map((path): FilterDecision => ({
      path,
      decision: 'omitted',
      reason: 'unreadable',
      rule: null,
      detector: null,
      line: null,
      evidence: null,
    })),
    ...drafts.flatMap((draft, index) => (draft.omitted === null ? [] : [decisionOf(draft, draft.path, evidence[index]!.id)])),
    ...[...copies].flatMap(([path, copy]) => {
      if (typeof copy === 'string') return [decisionOf(unitOf(null, { reason: copy }), path, null)];
      return copy.omitted === null ? [] : [decisionOf(copy, path, null)];
    }),
  ].sort((a, b) => comparePaths(a.path ?? '', b.path ?? '') || comparePaths(a.evidence ?? '~', b.evidence ?? '~'));

  const capturedAt = formatZoned(observation.capturedAt, timezone);
  const manifest: Manifest = {
    schemaVersion: 1,
    snapshotId: input.snapshotId,
    repositoryId: input.repositoryId,
    kind: input.kind,
    previousSnapshotId: input.previous?.snapshotId ?? null,
    capturedAt,
    observedPeriod: { from: input.previous?.capturedAt ?? null, to: capturedAt },
    git: {
      branch: observation.branch,
      head: observation.head,
      indexFingerprint: observation.indexFingerprint,
      statusFingerprint: observation.statusFingerprint,
    },
    analysisRequired: input.kind === 'work' && analysisRequired(evidence, commits),
    commits,
    fileStates,
    evidence,
    statusChanges: [...(input.attribution?.statusChanges ?? [])],
    testReports: input.reports.map((report) => ({
      path: report.path,
      label: report.label,
      sha256: report.sha256,
      mtime: formatZoned(new Date(report.mtimeMs), timezone),
    })),
    filterDecisions,
    gaps: [...input.gaps],
    stability: { attempts: input.attempts, stable: true },
    tool: { name: 'ipa-assistant', version: toolVersion() },
  };
  return { manifest, files: stored };
}
