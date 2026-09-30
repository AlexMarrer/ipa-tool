/**
 * Input package of an analysis (spec.md §9.6, §12.2, §14.6). Everything that reaches Claude passes the
 * content check again here (I-05); withheld and excluded content is only counted.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { readManifest, snapshotDir } from '../collector/snapshots.js';
import type { Manifest, Omission, OmitReason } from '../collector/types.js';
import type { WorkspaceContext } from '../core/context.js';
import { EXIT, IpaError } from '../core/errors.js';
import { ID_PATTERNS } from '../core/ids.js';
import { formatIssues, validate } from '../core/schemas.js';
import { createSecretScanner, type SecretScanner } from '../filter/secret-scanner.js';
import { readNotes } from '../notes/store.js';
import type { Note } from '../notes/types.js';
import { noteSecretHits } from './note-secrets.js';
import { type AnalysisInput, type ContextEntry, type FilterSummary, type InputEvidence, PROMPT_VERSION } from './types.js';

/** Same rule as for all units (spec.md §14.5). */
const BINARY_PROBE_BYTES = 8000;

const SENT_KINDS = new Set(['commit_message', 'state_delta', 'test_report']);

export interface BuildInputOptions {
  /** German warnings for stderr, for example a note reference to unknown evidence. */
  onWarning?: (message: string) => void;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** `input.json` and stdin get exactly this text; its UTF-8 length is the package size (spec.md §9.6). */
export function serializeInput(input: AnalysisInput): string {
  return `${JSON.stringify(input, null, 2)}\n`;
}

/** SHA-256 of the compact JSON of a note, as stored in `provenance.notesUsed` (spec.md §9.8). */
export function noteSha256(note: Note): string {
  return sha256Hex(JSON.stringify(note));
}

export function emptySummary(): FilterSummary {
  return { excluded: 0, withheld: 0, omitted: 0, byReason: {} };
}

function count(summary: FilterSummary, decision: 'excluded' | 'withheld' | 'omitted', reason: OmitReason): void {
  summary[decision] += 1;
  summary.byReason[reason] = (summary.byReason[reason] ?? 0) + 1;
}

export async function readSnapshotText(ctx: WorkspaceContext, snapshotId: string, file: string): Promise<string> {
  try {
    return await readFile(path.join(snapshotDir(ctx.workspaceDir, snapshotId), file), 'utf8');
  } catch (error) {
    throw new IpaError(
      'snapshot_content_missing',
      EXIT.usage,
      `Der Inhalt ${file} von Snapshot ${snapshotId} fehlt oder ist nicht lesbar. Der Snapshot ist beschädigt.`,
      { cause: error },
    );
  }
}

/** Commit messages, state deltas and test reports (spec.md §9.4 "An Claude: ja"), checked again. */
async function inputEvidence(ctx: WorkspaceContext, manifest: Manifest, scanner: SecretScanner, summary: FilterSummary): Promise<InputEvidence[]> {
  const result: InputEvidence[] = [];
  for (const entry of manifest.evidence) {
    if (!SENT_KINDS.has(entry.kind)) continue;
    const { file, ...rest } = entry;
    let omitted: Omission | null = entry.omitted;
    let content: string | null = null;
    if (omitted === null && !entry.binary && file !== null) {
      const text = await readSnapshotText(ctx, manifest.snapshotId, file);
      const hit = scanner.scan(text)[0];
      if (hit === undefined) {
        content = text;
      } else {
        // The configuration may have gained a pattern since the capture (I-05).
        omitted = { reason: 'secret_suspected', detector: hit.detector };
        count(summary, 'withheld', 'secret_suspected');
      }
    }
    result.push({ ...rest, omitted, content } as InputEvidence);
  }
  return result;
}

type ManifestLoader = (snapshotId: string) => Promise<Manifest | null>;

function manifestLoader(ctx: WorkspaceContext, current: Manifest): ManifestLoader {
  const cache = new Map<string, Promise<Manifest | null>>([[current.snapshotId, Promise.resolve(current)]]);
  return (snapshotId) => {
    let entry = cache.get(snapshotId);
    if (entry === undefined) {
      entry = readManifest(ctx, snapshotId).catch((error: unknown) => {
        if (error instanceof IpaError && error.code === 'file_not_found') return null;
        throw error;
      });
      cache.set(snapshotId, entry);
    }
    return entry;
  };
}

async function refExists(load: ManifestLoader, ref: string): Promise<boolean> {
  const [snapshotId = '', evidenceId] = ref.split(':');
  const manifest = await load(snapshotId);
  return manifest !== null && manifest.evidence.some((entry) => entry.id === evidenceId);
}

function byRecordedAt(a: Note, b: Note): number {
  return Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Notes recorded in `(observedPeriod.from, observedPeriod.to]` or with an existing reference into the
 * snapshot (spec.md §12.2). References to unknown evidence are ignored with a warning; notes with a
 * secret hit are withheld and only counted.
 */
async function selectNotes(
  ctx: WorkspaceContext,
  manifest: Manifest,
  scanner: SecretScanner,
  summary: FilterSummary,
  warn: (message: string) => void,
): Promise<Note[]> {
  const { from, to } = manifest.observedPeriod;
  const inPeriod = await readNotes(ctx, from === null ? { recordedTo: to } : { recordedFrom: from, recordedTo: to });
  const referencing = await readNotes(ctx, { refsToSnapshot: manifest.snapshotId });
  for (const line of inPeriod.invalid) {
    warn(`Warnung: ${line.file}, Zeile ${line.line} wird übersprungen (${line.error}).`);
  }

  const load = manifestLoader(ctx, manifest);
  const candidates = new Map<string, { note: Note; inPeriod: boolean }>();
  for (const note of inPeriod.notes) candidates.set(note.id, { note, inPeriod: true });
  for (const note of referencing.notes) if (!candidates.has(note.id)) candidates.set(note.id, { note, inPeriod: false });

  const selected: Note[] = [];
  const prefix = `${manifest.snapshotId}:`;
  for (const { note, inPeriod: recordedInPeriod } of candidates.values()) {
    let refersHere = false;
    for (const ref of note.refs) {
      if (await refExists(load, ref)) {
        if (ref.startsWith(prefix)) refersHere = true;
      } else {
        warn(`Warnung: Notiz ${note.id} verweist auf den unbekannten Beleg ${ref}; der Verweis wird ignoriert.`);
      }
    }
    if (!recordedInPeriod && !refersHere) continue;
    if (noteSecretHits(scanner, note).length > 0) {
      count(summary, 'withheld', 'secret_suspected');
      continue;
    }
    selected.push(note);
  }
  return selected.sort(byRecordedAt);
}

type ContextRead = { ok: true; bytes: Buffer } | { ok: false; reason: OmitReason };

async function readContextFile(file: string, maxBytes: number): Promise<ContextRead> {
  try {
    // Explicitly configured, therefore read like test reports without the path filter (D-17, spec.md §18).
    const info = await stat(file);
    if (!info.isFile()) return { ok: false, reason: 'unreadable' };
    if (info.size > maxBytes) return { ok: false, reason: 'file_too_large' };
    const bytes = await readFile(file);
    if (bytes.length > maxBytes) return { ok: false, reason: 'file_too_large' };
    if (bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)) return { ok: false, reason: 'binary' };
    return { ok: true, bytes };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

/** Context IDs `C01…` follow the configuration, also for files that are left out. */
export function contextId(index: number): string {
  return `C${String(index + 1).padStart(2, '0')}`;
}

/** Context files of `config.context.files`, read and checked on every package build (spec.md §12.2). */
export async function readContext(
  ctx: WorkspaceContext,
  scanner: SecretScanner,
  summary: FilterSummary,
  warn: (message: string) => void,
): Promise<ContextEntry[]> {
  const entries: ContextEntry[] = [];
  for (const [index, configured] of ctx.config.context.files.entries()) {
    const id = contextId(index);
    const shown = configured.replace(/\\/g, '/');
    const read = await readContextFile(path.resolve(ctx.repoRoot, configured), ctx.config.limits.maxContextFileBytes);
    if (!read.ok) {
      count(summary, 'omitted', read.reason);
      warn(`Hinweis: Kontextdatei ${id} (${shown}) ausgelassen: ${read.reason}.`);
      continue;
    }
    const content = read.bytes.toString('utf8');
    const hit = scanner.scan(content)[0];
    if (hit !== undefined) {
      count(summary, 'withheld', 'secret_suspected');
      warn(`Hinweis: Kontextdatei ${id} (${shown}) wegen Secret-Verdacht zurückgehalten (Detektor ${hit.detector}, Zeile ${hit.line}).`);
      continue;
    }
    entries.push({ id, path: shown, sha256: sha256Hex(read.bytes), content });
  }
  return entries;
}

/** Builds the package from an already loaded manifest. */
export async function buildInputFromManifest(ctx: WorkspaceContext, manifest: Manifest, opts: BuildInputOptions = {}): Promise<AnalysisInput> {
  const warn = opts.onWarning ?? (() => undefined);
  const scanner = createSecretScanner(ctx.config.secrets);
  const summary = emptySummary();
  for (const decision of manifest.filterDecisions) count(summary, decision.decision, decision.reason);

  const evidence = await inputEvidence(ctx, manifest, scanner, summary);
  const notes = await selectNotes(ctx, manifest, scanner, summary, warn);
  const context = await readContext(ctx, scanner, summary, warn);
  const input: AnalysisInput = {
    schemaVersion: 1,
    purpose: 'analysis',
    promptVersion: PROMPT_VERSION,
    snapshotId: manifest.snapshotId,
    previousSnapshotId: manifest.previousSnapshotId,
    observedPeriod: manifest.observedPeriod,
    repository: { branch: manifest.git.branch, head: manifest.git.head },
    commits: manifest.commits.map(({ files, ...commit }) => ({ ...commit, files: files.map(({ blob: _blob, ...file }) => file) })),
    statusChanges: manifest.statusChanges,
    evidence,
    notes,
    context,
    filterSummary: summary,
    allowedEvidenceIds: [...evidence.map((entry) => entry.id), ...notes.map((note) => note.id), ...context.map((entry) => entry.id)],
  };
  const result = validate('analysis-input', input);
  if (!result.ok) {
    throw new IpaError('record_invalid', EXIT.internal, `Interner Fehler: Das Eingabepaket von ${manifest.snapshotId} ist ungültig: ${formatIssues(result.issues)}`);
  }
  return input;
}

/** spec.md §10. */
export async function buildAnalysisInput(ctx: WorkspaceContext, snapshotId: string, opts: BuildInputOptions = {}): Promise<AnalysisInput> {
  if (!ID_PATTERNS.snapshotId.test(snapshotId)) throw new RangeError(`Ungültige Snapshot-ID: ${snapshotId}`);
  return buildInputFromManifest(ctx, await readManifest(ctx, snapshotId), opts);
}
