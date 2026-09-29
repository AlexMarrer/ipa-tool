/**
 * `analysis.json` (spec.md §9.8): from Claude's validated answer or, for snapshots without analysis
 * requirement (D-08), deterministically without Claude.
 */
import type { ClaudeMeta } from '../claude/types.js';
import { SNAPSHOTS_FOLDER } from '../collector/snapshots.js';
import type { Manifest } from '../collector/types.js';
import { noteSha256 } from './input.js';
import { type AnalysisInput, type AnalysisOutput, type AnalysisRecord, type EvidenceIndexEntry, OUTPUT_SCHEMA_VERSION, PROMPT_VERSION } from './types.js';

function manifestIndex(manifest: Manifest): EvidenceIndexEntry[] {
  return manifest.evidence.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    path: entry.path,
    snapshotFile: entry.file === null ? null : `${SNAPSHOTS_FOLDER}/${manifest.snapshotId}/${entry.file}`,
  }));
}

function recordBase(manifest: Manifest) {
  return {
    schemaVersion: 1 as const,
    snapshotId: manifest.snapshotId,
    previousSnapshotId: manifest.previousSnapshotId,
    observedPeriod: manifest.observedPeriod,
    repository: { branch: manifest.git.branch, head: manifest.git.head },
    commits: manifest.commits.map((commit) => commit.sha),
  };
}

export function deterministicRecord(manifest: Manifest, generatedAt: string): AnalysisRecord {
  return {
    ...recordBase(manifest),
    evidenceIndex: manifestIndex(manifest),
    statusChanges: manifest.statusChanges,
    analysis: null,
    provenance: { deterministic: true, generatedAt },
  };
}

export interface AiRecordInput {
  manifest: Manifest;
  input: AnalysisInput;
  output: AnalysisOutput;
  attempt: number;
  analysedAt: string;
  meta: Pick<ClaudeMeta, 'cliVersion' | 'models'>;
  inputSha256: string;
}

export function aiRecord(args: AiRecordInput): AnalysisRecord {
  const { manifest, input } = args;
  return {
    ...recordBase(manifest),
    evidenceIndex: [
      ...manifestIndex(manifest),
      ...input.notes.map((note): EvidenceIndexEntry => ({ id: note.id, kind: 'note', path: null, snapshotFile: null })),
      ...input.context.map((entry): EvidenceIndexEntry => ({ id: entry.id, kind: 'context', path: entry.path, snapshotFile: null })),
    ],
    statusChanges: manifest.statusChanges,
    analysis: args.output,
    provenance: {
      attempt: args.attempt,
      analysedAt: args.analysedAt,
      cliVersion: args.meta.cliVersion,
      models: args.meta.models,
      promptVersion: PROMPT_VERSION,
      outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
      inputSha256: args.inputSha256,
      notesUsed: input.notes.map((note) => ({ id: note.id, sha256: noteSha256(note) })),
      contextUsed: input.context.map((entry) => ({ id: entry.id, path: entry.path, sha256: entry.sha256 })),
    },
  };
}
