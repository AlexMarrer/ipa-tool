/**
 * Input of a journal run (spec.md §9.10, package 07 §4). It is built from snapshots, analyses, notes
 * and context only; earlier journal drafts and `journal/final/` are never read (I-09, I-10). Everything
 * that reaches Claude passes the content check again (I-05).
 */
import { readAnalysisRecord } from '../analysis/files.js';
import { emptySummary, noteSha256, readContext, readSnapshotText } from '../analysis/input.js';
import { noteSecretHits } from '../analysis/note-secrets.js';
import { analysisStatus } from '../analysis/status.js';
import type { AnalysisOutput } from '../analysis/types.js';
import { describeHalt } from '../collector/halt.js';
import { listSnapshots, readManifest } from '../collector/snapshots.js';
import type { Manifest } from '../collector/types.js';
import type { WorkspaceContext } from '../core/context.js';
import { EXIT, IpaError } from '../core/errors.js';
import { readRunRecords } from '../core/run-log.js';
import { formatIssues, validate } from '../core/schemas.js';
import { readState } from '../core/state.js';
import { isValidDay } from '../core/time.js';
import { createSecretScanner, type SecretScanner } from '../filter/secret-scanner.js';
import { NOTES_FOLDER, readNotes } from '../notes/store.js';
import type { Note } from '../notes/types.js';
import { dayAttribution, dayOfTimestamp, touchesDay } from './day.js';
import { buildTimeSummary } from './time-summary.js';
import {
  type DerivedAnalysis,
  type JournalAnalysis,
  type JournalCommit,
  type JournalContext,
  type JournalEvidence,
  type JournalGap,
  type JournalInput,
  type JournalSource,
  type OpenAnalysisStatus,
  type OpenItems,
  PROMPT_VERSION,
} from './types.js';

const OPEN_FOR_JOURNAL = new Set<string>(['pending', 'failed', 'blocked', 'exhausted', 'skipped']);

const DESCRIBED_KINDS = new Set(['commit_message', 'state_delta', 'test_report']);

export interface JournalInputBuild {
  input: JournalInput;
  /** Every reference a draft may show, with kind, path, snapshot and SHA-256 (spec.md §9.10 `sources`). */
  sources: ReadonlyMap<string, JournalSource>;
  /** German warnings for stderr, without content. */
  warnings: string[];
}

interface Collected {
  ctx: WorkspaceContext;
  day: string;
  scanner: SecretScanner;
  analyses: JournalAnalysis[];
  evidence: JournalEvidence[];
  commits: JournalCommit[];
  allowed: string[];
  openItems: OpenItems;
  sources: Map<string, JournalSource>;
  warnings: string[];
}

function addSource(collected: Collected, source: JournalSource): void {
  if (!collected.sources.has(source.ref)) collected.sources.set(source.ref, source);
}

/** Every text field of an analysis output, for the re-check before it reaches Claude again. */
function analysisTexts(analysis: AnalysisOutput): string[] {
  return [
    analysis.summary.text,
    ...analysis.implemented.flatMap((item) => [item.title, item.description]),
    ...analysis.decisions.flatMap((item) => [item.title, item.description, item.rationale ?? '', ...item.alternatives]),
    ...analysis.problems.flatMap((item) => [item.title, item.description, item.cause ?? '', item.solution ?? '']),
    ...analysis.tests.map((item) => item.description),
    ...analysis.contradictions.map((item) => item.description),
    ...analysis.unknowns,
  ];
}

/**
 * `E001` becomes `S000004:E001`; note IDs stay. Context IDs of the analysis are mapped to the context of
 * this journal with the same path and SHA-256 and dropped otherwise, because the file has changed since.
 */
export function qualifyAnalysis(analysis: AnalysisOutput, snapshotId: string, contextIds: ReadonlyMap<string, string>): DerivedAnalysis {
  const map = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      if (id.startsWith('E')) return [`${snapshotId}:${id}`];
      if (id.startsWith('C')) {
        const mapped = contextIds.get(id);
        return mapped === undefined ? [] : [mapped];
      }
      return [id];
    });
  return {
    summary: { text: analysis.summary.text, evidence: map(analysis.summary.evidence) },
    implemented: analysis.implemented.map((item) => ({ ...item, evidence: map(item.evidence) })),
    decisions: analysis.decisions.map((item) => ({ ...item, evidence: map(item.evidence) })),
    problems: analysis.problems.map((item) => ({ ...item, evidence: map(item.evidence) })),
    tests: analysis.tests.map((item) => ({ ...item, evidence: map(item.evidence) })),
    contradictions: analysis.contradictions.map((item) => ({ ...item, evidence: map(item.evidence) })),
    unknowns: [...analysis.unknowns],
  };
}

async function derivedOf(collected: Collected, snapshotId: string, context: readonly JournalContext[]): Promise<DerivedAnalysis | null> {
  const record = await readAnalysisRecord(collected.ctx.workspaceDir, snapshotId);
  if (record.analysis === null) return null;
  const hit = collected.scanner.scan(analysisTexts(record.analysis).join('\n'))[0];
  if (hit !== undefined) {
    collected.openItems.gaps.push({
      snapshotId,
      type: 'withheld',
      detail:
        `Die Aussagen der Analyse wurden bei der erneuten Prüfung wegen Secret-Verdacht zurückgehalten (Detektor ${hit.detector}); ` +
        `offene Prüfung in analyses/${snapshotId}/analysis.json.`,
    });
    return null;
  }
  for (const used of record.provenance.notesUsed) {
    addSource(collected, { ref: used.id, kind: 'note', path: null, snapshotId: null, sha256: used.sha256 });
  }
  const contextIds = new Map<string, string>();
  for (const used of record.provenance.contextUsed) {
    const current = context.find((entry) => entry.path === used.path && entry.sha256 === used.sha256);
    if (current !== undefined) contextIds.set(used.id, current.id);
  }
  return qualifyAnalysis(record.analysis, snapshotId, contextIds);
}

/** Descriptions without content; commit messages are read and checked again (I-05). */
async function describeUnits(collected: Collected, manifest: Manifest, citable: boolean): Promise<{ messages: Map<string, string>; withheld: number }> {
  const messages = new Map<string, string>();
  let withheld = 0;
  for (const entry of manifest.evidence) {
    if (!DESCRIBED_KINDS.has(entry.kind)) continue;
    const ref = `${manifest.snapshotId}:${entry.id}`;
    let omitted = entry.omitted !== null;
    if (entry.kind === 'commit_message' && !omitted && !entry.binary && entry.file !== null) {
      const text = await readSnapshotText(collected.ctx, manifest.snapshotId, entry.file);
      if (collected.scanner.scan(text).length === 0) messages.set(entry.id, text);
      else {
        // The configuration may have gained a pattern since the capture.
        omitted = true;
        withheld += 1;
      }
    }
    collected.evidence.push({
      ref,
      kind: entry.kind as JournalEvidence['kind'],
      path: entry.path,
      commit: entry.commit,
      snapshotId: manifest.snapshotId,
      omitted,
      binary: entry.binary,
      fresh: entry.kind === 'test_report' ? entry.fresh : null,
    });
    addSource(collected, { ref, kind: entry.kind as JournalEvidence['kind'], path: entry.path, snapshotId: manifest.snapshotId, sha256: entry.sha256 });
    if (citable) collected.allowed.push(ref);
  }
  return { messages, withheld };
}

function withheldUnitsGap(manifest: Manifest, recheckHits: number): JournalGap | null {
  const recorded = manifest.filterDecisions.filter((entry) => entry.decision === 'withheld').length;
  if (recorded + recheckHits === 0) return null;
  const again = recheckHits === 0 ? '' : `, davon ${recheckHits} Commit-Nachricht(en) bei der erneuten Prüfung`;
  return {
    snapshotId: manifest.snapshotId,
    type: 'withheld',
    detail:
      `${recorded + recheckHits} Einheit(en) wegen Secret-Verdacht zurückgehalten${again}; offene Prüfung ` +
      `(Pfad, Detektor und Zeile ohne Wert in filterDecisions von snapshots/${manifest.snapshotId}/manifest.json).`,
  };
}

async function collectSnapshot(collected: Collected, manifest: Manifest, context: readonly JournalContext[]): Promise<void> {
  const { ctx, day } = collected;
  const { snapshotId } = manifest;
  for (const gap of manifest.gaps) collected.openItems.gaps.push({ snapshotId, type: gap.type, detail: gap.detail });
  if (manifest.kind === 'baseline') {
    // Baselines hold the existing state and never count as work of the day (spec.md §15).
    const gap = withheldUnitsGap(manifest, 0);
    if (gap !== null) collected.openItems.gaps.push(gap);
    return;
  }

  const attribution = dayAttribution(manifest.observedPeriod, day, ctx.config.timezone) ?? 'unclear';
  // Units of a snapshot with unclear day stay out of `allowedEvidenceIds`: that work is not attributed to the day.
  const { messages, withheld } = await describeUnits(collected, manifest, attribution === 'day');
  const gap = withheldUnitsGap(manifest, withheld);
  if (gap !== null) collected.openItems.gaps.push(gap);

  for (const commit of manifest.commits) {
    collected.commits.push({
      sha: commit.sha,
      snapshotId,
      committerDate: commit.committerDate,
      authoredByConfiguredUser: commit.authoredByConfiguredUser,
      messageRef: commit.messageEvidence === null ? null : `${snapshotId}:${commit.messageEvidence}`,
      message: commit.messageEvidence === null ? null : (messages.get(commit.messageEvidence) ?? null),
    });
  }

  const status = await analysisStatus(ctx, snapshotId);
  if (OPEN_FOR_JOURNAL.has(status)) collected.openItems.analyses.push({ snapshotId, status: status as OpenAnalysisStatus });
  collected.analyses.push({
    snapshotId,
    dayAttribution: attribution,
    observedPeriod: manifest.observedPeriod,
    derived: status === 'complete' ? await derivedOf(collected, snapshotId, context) : null,
    statusChanges: manifest.statusChanges,
  });
}

function timeOf(timestamp: string): string {
  return timestamp.slice(11, 19);
}

/** Runs of the day from `runs.jsonl` that did not end with exit code 0, and the count of unchanged captures. */
async function collectRuns(collected: Collected): Promise<number> {
  const { ctx, day } = collected;
  const { records, invalid } = await readRunRecords(ctx.workspaceDir);
  for (const line of invalid) collected.warnings.push(`Warnung: runs.jsonl, Zeile ${line.line} wird übersprungen (${line.error}).`);
  let unchanged = 0;
  for (const run of records) {
    if (dayOfTimestamp(run.startedAt, ctx.config.timezone) !== day) continue;
    if (run.exitCode === 0) {
      if (run.outcome === 'unchanged') unchanged += 1;
      continue;
    }
    const codes = [...new Set(run.errors.map((error) => error.code))];
    collected.openItems.gaps.push({
      snapshotId: null,
      type: 'run_failed',
      detail:
        `${run.command} ${run.runId} um ${timeOf(run.startedAt)}: ${run.outcome} (Exit-Code ${run.exitCode})` +
        `${codes.length === 0 ? '' : `, Fehlerklassen: ${codes.join(', ')}`}.`,
    });
  }
  return unchanged;
}

interface DayNotes {
  notes: Note[];
  timeNotes: Note[];
  withheldIds: Set<string>;
}

async function collectNotes(collected: Collected): Promise<DayNotes> {
  const { ctx, day } = collected;
  const { notes: all, invalid } = await readNotes(ctx, { day });
  for (const line of invalid) {
    collected.warnings.push(`Warnung: ${line.file}, Zeile ${line.line} wird übersprungen (${line.error}).`);
    collected.openItems.gaps.push({
      snapshotId: null,
      type: 'invalid_notes',
      detail: `${line.file}, Zeile ${line.line}: ungültige Notizzeile, nicht berücksichtigt (${line.error}).`,
    });
  }
  const notes: Note[] = [];
  const withheldIds = new Set<string>();
  for (const note of all) {
    const hits = noteSecretHits(collected.scanner, note);
    if (hits.length === 0) {
      notes.push(note);
      addSource(collected, { ref: note.id, kind: 'note', path: null, snapshotId: null, sha256: noteSha256(note) });
      continue;
    }
    withheldIds.add(note.id);
    collected.openItems.gaps.push({
      snapshotId: null,
      type: 'withheld',
      detail:
        `Notiz ${note.id} wegen Secret-Verdacht zurückgehalten (${hits.map((hit) => `${hit.detector} in ${hit.field}`).join(', ')}); ` +
        `offene Prüfung in ${NOTES_FOLDER}/${day}.jsonl.`,
    });
  }
  return { notes, timeNotes: all, withheldIds };
}

/** spec.md §9.10 and package 07 §4. `day` must be a valid `YYYY-MM-DD`. */
export async function buildJournalInput(ctx: WorkspaceContext, day: string): Promise<JournalInputBuild> {
  if (!isValidDay(day)) throw new RangeError(`Ungültiger Tag: ${day}`);
  const timezone = ctx.config.timezone;
  const collected: Collected = {
    ctx,
    day,
    scanner: createSecretScanner(ctx.config.secrets),
    analyses: [],
    evidence: [],
    commits: [],
    allowed: [],
    openItems: { analyses: [], gaps: [] },
    sources: new Map(),
    warnings: [],
  };

  const summary = emptySummary();
  const context = await readContext(ctx, collected.scanner, summary, (message) => collected.warnings.push(message));
  for (const entry of context) addSource(collected, { ref: entry.id, kind: 'context', path: entry.path, snapshotId: null, sha256: entry.sha256 });

  let touched = 0;
  for (const snapshotId of await listSnapshots(ctx)) {
    const manifest = await readManifest(ctx, snapshotId);
    if (!touchesDay(manifest.observedPeriod, day, timezone)) continue;
    touched += 1;
    await collectSnapshot(collected, manifest, context);
  }

  const { halt } = await readState(ctx.workspaceDir);
  if (halt !== null && dayOfTimestamp(halt.detectedAt, timezone) === day) {
    collected.openItems.gaps.push({ snapshotId: null, type: 'halt', detail: describeHalt(halt) });
  }
  const unchangedRuns = await collectRuns(collected);
  if (touched === 0) {
    collected.openItems.gaps.push({
      snapshotId: null,
      type: 'no_capture',
      detail:
        'Keine Aufnahme an diesem Tag: Kein Snapshot berührt den Tag, Arbeit ist nur über Notizen erfasst' +
        `${unchangedRuns === 0 ? '.' : `; ${unchangedRuns} Aufnahmelauf/-läufe ohne neue Arbeit.`}`,
    });
  }
  const dayNotes = await collectNotes(collected);
  if (summary.withheld > 0) {
    collected.openItems.gaps.push({
      snapshotId: null,
      type: 'withheld',
      detail: `${summary.withheld} Kontextdatei(en) wegen Secret-Verdacht zurückgehalten; offene Prüfung (Hinweis auf stderr nennt Datei, Detektor und Zeile).`,
    });
  }

  const input: JournalInput = {
    schemaVersion: 1,
    purpose: 'journal',
    promptVersion: PROMPT_VERSION,
    day,
    timezone,
    analyses: collected.analyses,
    evidence: collected.evidence,
    commits: collected.commits,
    notes: dayNotes.notes,
    context,
    timeSummary: buildTimeSummary(dayNotes.timeNotes, dayNotes.withheldIds),
    openItems: collected.openItems,
    allowedEvidenceIds: [...collected.allowed, ...dayNotes.notes.map((note) => note.id), ...context.map((entry) => entry.id)],
  };
  const result = validate('journal-input', input);
  if (!result.ok) {
    throw new IpaError('record_invalid', EXIT.internal, `Interner Fehler: Die Journal-Eingabe für ${day} ist ungültig: ${formatIssues(result.issues)}`);
  }
  return { input, sources: collected.sources, warnings: collected.warnings };
}
