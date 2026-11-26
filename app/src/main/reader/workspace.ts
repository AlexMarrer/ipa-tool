import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { StatusReport } from '../../shared/cli-types';
import { clockOfTimestamp, dayOfTimestamp, formatLongDay, shiftDay, todayIn, weekdayOf } from '../../shared/dates';
import { ANALYSIS_STATUS, RUN_OUTCOME, type RunOutcome } from '../../shared/messages';
import type {
  AttentionItem,
  ClaudeView,
  DayIndex,
  DayView,
  DraftView,
  FileRef,
  FileState,
  GapView,
  HaltView,
  JournalDraftView,
  NoteView,
  OverviewView,
  ReferenceIndex,
  RunView,
  SnapshotStatus,
  SnapshotView,
  TimelineEntry,
  WorkLogView,
} from '../../shared/views';
import { OPEN_STATUSES } from '../../shared/views';
import type { SecretScanner, SecretsConfig } from '../cli-lib';
import type { SchemaValidator } from '../cli/validator';
import { ATTEMPT_ERROR_TEXT } from '../run/progress';
import { countStatuses, countsEqual, deriveSnapshotStatus, failedAttemptsSinceRetry, type AnalysisCounts, type AttemptOutcomeName } from './analysis-status';
import { exists, listDir, readJson, readJsonl, readText } from './files';
import { summarizeTime } from './time-summary';

const SNAPSHOT_ID = /^S\d{6}$/;
const DRAFT_FILE = /^(\d{4}-\d{2}-\d{2})-(R\d{8}T\d{6}Z-[0-9a-f]{4})$/;
const NOTE_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
const MAX_SPAN_DAYS = 400;
const MASKED = 'Dieses Feld enthält einen möglichen Zugangswert und wird hier nicht angezeigt.';
const QUIET_RUNS = new Set(['ok', 'unchanged', 'outside_window']);

interface ManifestData {
  snapshotId: string;
  kind: 'baseline' | 'work';
  capturedAt: string;
  observedPeriod: { from: string | null; to: string };
  git: { branch: string | null };
  analysisRequired: boolean;
  commits: unknown[];
  evidence: { id: string; kind: string; path: string | null; file?: string | null; omitted?: { reason: string; detector?: string } | null }[];
  statusChanges: { path: string; from: string; to: string }[];
  filterDecisions: { decision: string; reason: string; detector: string | null }[];
  gaps: GapView[];
}

interface NoteRecord {
  id: string;
  type: NoteView['type'];
  text: string;
  activityDay: string;
  recordedAt: string;
  time: NoteView['time'];
  delay: NoteView['delay'];
  reason: string | null;
  alternatives: string[];
  cause: string | null;
  solution: string | null;
  refs: string[];
}

interface RunRecord {
  runId: string;
  command: string;
  startedAt: string;
  durationMs: number;
  exitCode: number;
  outcome: string;
  snapshotCreated: string | null;
  errors: { code: string }[];
}

interface JournalRecord {
  day: string;
  runId: string;
  generatedAt: string;
  mode: 'ai' | 'no_ai';
}

interface ConfigData {
  timezone: string;
  claude: { maxAttemptsPerSnapshot: number };
  secrets: SecretsConfig;
}

interface StateData {
  baselineSnapshotId: string | null;
  lastSnapshotId: string | null;
  lastAnalysedSnapshotId: string | null;
  halt: { reason: HaltView['reason']; detectedAt: string; expected: HaltView['expected']; observed: HaltView['observed'] } | null;
}

export interface WorkspaceReaderOptions {
  workspacePath: string;
  validator: SchemaValidator;
  createScanner: (secrets: SecretsConfig) => SecretScanner;
  /** Time zone used when `config.json` cannot be read (the registry/status value). */
  fallbackTimezone: string | null;
  now?: () => Date;
}

export interface WorkspaceReader {
  day(day: string): Promise<DayView>;
  dayIndex(): Promise<DayIndex>;
  workLog(snapshotId: string): Promise<WorkLogView | null>;
  drafts(day: string): Promise<DraftView[]>;
  journal(file: string): Promise<JournalDraftView | null>;
  references(): Promise<ReferenceIndex>;
  overview(status: StatusReport | null, schedule: OverviewView['schedule']): Promise<OverviewView>;
  /** Absolute path for a file reference, `null` if it does not exist or lies outside the workspace (spec §3.8). */
  resolveFile(ref: FileRef): Promise<string | null>;
  /** Counts derived from files, for the comparison with `status --json` (AK-10-18). */
  derivedCounts(): Promise<{ counts: AnalysisCounts; openIds: string[]; withheldNotes: number }>;
}

const secretText = (hits: boolean, value: string): string => (hits ? MASKED : value);

export function createWorkspaceReader(options: WorkspaceReaderOptions): WorkspaceReader {
  const ws = options.workspacePath;
  const { validator } = options;
  const now = options.now ?? (() => new Date());
  const cache = new Map<string, { sig: string; value: unknown }>();

  /** Reads a file again only when its size or modification time changed. */
  async function cached<T>(file: string, load: () => Promise<T>): Promise<T> {
    let sig = 'absent';
    try {
      const info = await stat(file);
      sig = `${info.mtimeMs}:${info.size}`;
    } catch {
      // absent
    }
    const hit = cache.get(file);
    if (hit !== undefined && hit.sig === sig) return hit.value as T;
    const value = await load();
    cache.set(file, { sig, value });
    return value;
  }

  async function loadConfig(): Promise<{ config: ConfigData; fileState: FileState }> {
    const read = await readJson<ConfigData>(validator, 'config', path.join(ws, 'config.json'));
    if (read.state === 'ok') return { config: read.value, fileState: 'ok' };
    return {
      config: { timezone: options.fallbackTimezone ?? 'UTC', claude: { maxAttemptsPerSnapshot: 3 }, secrets: { extraPatterns: [], disabledDetectors: [] } },
      fileState: read.state,
    };
  }

  async function loadRuns(): Promise<{ runs: RunRecord[]; invalid: number }> {
    const file = path.join(ws, 'runs.jsonl');
    const read = await cached(file, () => readJsonl<RunRecord>(validator, 'run-record', file));
    return { runs: read.items, invalid: read.invalid };
  }

  async function loadState(): Promise<StateData | null> {
    const read = await readJson<StateData>(validator, 'state', path.join(ws, 'state.json'));
    return read.state === 'ok' ? read.value : null;
  }

  interface SnapshotData {
    view: SnapshotView;
    manifest: ManifestData;
  }

  async function loadSnapshots(config: ConfigData, runs: RunRecord[], timezone: string): Promise<{ snapshots: SnapshotData[]; unreadable: string[] }> {
    const names = (await listDir(path.join(ws, 'snapshots'))).filter((name) => SNAPSHOT_ID.test(name));
    const snapshots: SnapshotData[] = [];
    const unreadable: string[] = [];
    for (const id of names) {
      const file = path.join(ws, 'snapshots', id, 'manifest.json');
      const read = await cached(file, () => readJson<ManifestData>(validator, 'manifest', file));
      if (read.state !== 'ok') {
        unreadable.push(`snapshots/${id}/manifest.json`);
        continue;
      }
      snapshots.push({ manifest: read.value, view: await buildSnapshotView(read.value, config, runs, timezone) });
    }
    return { snapshots, unreadable };
  }

  async function buildSnapshotView(manifest: ManifestData, config: ConfigData, runs: RunRecord[], timezone: string): Promise<SnapshotView> {
    const id = manifest.snapshotId;
    const dir = path.join(ws, 'analyses', id);
    const names = await listDir(dir);
    const complete = (await readJson(validator, 'complete', path.join(dir, 'complete.json'))).state === 'ok';
    const skipped = !complete && (await readJson(validator, 'skip', path.join(dir, 'skip.json'))).state === 'ok';
    const attempts: { number: number; outcome: AttemptOutcomeName; errorCode: string | null }[] = [];
    for (const name of names) {
      const match = /^attempt-([1-9]\d*)$/.exec(name);
      if (match === null) continue;
      const read = await readJson<{ outcome: AttemptOutcomeName; errorCode: string | null }>(validator, 'attempt-outcome', path.join(dir, name, 'outcome.json'));
      // A folder without a valid outcome counts as an interrupted attempt (app spec §5.3).
      attempts.push({ number: Number(match[1]), outcome: read.state === 'ok' ? read.value.outcome : 'interrupted', errorCode: read.state === 'ok' ? read.value.errorCode : null });
    }
    attempts.sort((a, b) => a.number - b.number);
    const retries = names.flatMap((name) => {
      const match = /^retry-([1-9]\d*)\.json$/.exec(name);
      return match === null ? [] : [Number(match[1])];
    });
    const status = deriveSnapshotStatus({
      complete,
      skipped,
      analysisRequired: manifest.analysisRequired,
      attempts,
      retries,
      maxAttempts: config.claude.maxAttemptsPerSnapshot,
    });
    let aiMode: SnapshotView['aiMode'] = 'none';
    if (status === 'complete') {
      const record = await readJson<{ analysis: unknown }>(validator, 'analysis-record', path.join(dir, 'analysis.json'));
      aiMode = record.state === 'ok' && record.value.analysis !== null ? 'ai' : 'deterministic';
    }
    const last = attempts.at(-1);
    const withheld = manifest.filterDecisions.filter((decision) => decision.decision === 'withheld');
    const period = manifest.observedPeriod;
    const first = period.from === null ? null : dayOfTimestamp(period.from, timezone);
    const lastDay = dayOfTimestamp(period.to, timezone);
    const dayAttribution: SnapshotView['dayAttribution'] =
      manifest.kind === 'baseline' ? 'baseline' : first !== null && first === lastDay ? 'day' : 'unclear';
    const run = runs.find((candidate) => candidate.snapshotCreated === id);
    return {
      id,
      kind: manifest.kind,
      capturedAt: manifest.capturedAt,
      observedPeriod: period,
      branch: manifest.git.branch,
      commits: manifest.commits.length,
      evidence: manifest.evidence.length,
      status,
      attempts: { failed: failedAttemptsSinceRetry(attempts, retries), max: config.claude.maxAttemptsPerSnapshot },
      lastErrorCode: last === undefined ? null : (last.errorCode ?? (last.outcome === 'success' ? null : last.outcome)),
      aiMode,
      dayAttribution,
      withheld: { count: withheld.length, detectors: [...new Set(withheld.flatMap((decision) => (decision.detector === null ? [] : [decision.detector])))] },
      gaps: manifest.gaps,
      runId: run?.runId ?? null,
      time: (clockOfTimestamp(period.to, timezone) ?? '').slice(0, 5),
    };
  }

  /** Days of a snapshot: baseline on the day it was captured, otherwise every day its period touches. */
  function snapshotDays(manifest: ManifestData, timezone: string): string[] {
    if (manifest.kind === 'baseline') {
      const day = dayOfTimestamp(manifest.capturedAt, timezone);
      return day === null ? [] : [day];
    }
    const last = dayOfTimestamp(manifest.observedPeriod.to, timezone);
    if (last === null) return [];
    const first = manifest.observedPeriod.from === null ? last : (dayOfTimestamp(manifest.observedPeriod.from, timezone) ?? last);
    const days: string[] = [];
    for (let day = first, steps = 0; day <= last && steps < MAX_SPAN_DAYS; day = shiftDay(day, 1), steps += 1) days.push(day);
    return days;
  }

  function noteHits(scanner: SecretScanner, note: NoteRecord): { detectors: string[]; fields: string[] } | null {
    const detectors = new Set<string>();
    const fields = new Set<string>();
    const check = (field: string, value: string | null): void => {
      if (value === null) return;
      for (const { detector } of scanner.scan(value)) {
        detectors.add(detector);
        fields.add(field);
      }
    };
    check('text', note.text);
    check('reason', note.reason);
    for (const alternative of note.alternatives) check('alternatives', alternative);
    check('cause', note.cause);
    check('solution', note.solution);
    return fields.size === 0 ? null : { detectors: [...detectors], fields: [...fields] };
  }

  function toNoteView(note: NoteRecord, scanner: SecretScanner, timezone: string): NoteView {
    const withheld = noteHits(scanner, note);
    const hidden = (field: string): boolean => withheld?.fields.includes(field) === true;
    const recordedDay = dayOfTimestamp(note.recordedAt, timezone);
    const recordedClock = recordedDay === note.activityDay ? clockOfTimestamp(note.recordedAt, timezone) : null;
    const displayTime = recordedClock !== null ? recordedClock.slice(0, 5) : (note.time?.start ?? null);
    return {
      id: note.id,
      type: note.type,
      text: secretText(hidden('text'), note.text),
      activityDay: note.activityDay,
      recordedAt: note.recordedAt,
      time: note.time,
      delay: note.delay,
      reason: note.reason === null ? null : secretText(hidden('reason'), note.reason),
      alternatives: note.alternatives.map((alternative) => secretText(hidden('alternatives'), alternative)),
      cause: note.cause === null ? null : secretText(hidden('cause'), note.cause),
      solution: note.solution === null ? null : secretText(hidden('solution'), note.solution),
      refs: note.refs,
      withheld,
      displayTime,
    };
  }

  async function loadNotesOf(day: string, scanner: SecretScanner, timezone: string): Promise<{ notes: NoteView[]; invalid: number }> {
    const file = path.join(ws, 'notes', `${day}.jsonl`);
    const read = await cached(file, () => readJsonl<NoteRecord>(validator, 'note', file));
    // A line whose activity day does not match its file is invalid (CLI `readNotes`).
    const valid = read.items.filter((note) => note.activityDay === day);
    return { notes: valid.map((note) => toNoteView(note, scanner, timezone)), invalid: read.invalid + (read.items.length - valid.length) };
  }

  async function noteDays(): Promise<string[]> {
    return (await listDir(path.join(ws, 'notes'))).flatMap((name) => NOTE_FILE.exec(name)?.[1] ?? []);
  }

  function toRunView(run: RunRecord, timezone: string): RunView {
    return {
      runId: run.runId,
      command: run.command,
      startedAt: run.startedAt,
      outcome: run.outcome,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      errorCodes: run.errors.map((error) => error.code),
      snapshotCreated: run.snapshotCreated,
      time: (clockOfTimestamp(run.startedAt, timezone) ?? '').slice(0, 5),
    };
  }

  async function loadDrafts(timezone: string): Promise<DraftView[]> {
    const names = await listDir(path.join(ws, 'journal', 'drafts'));
    const drafts: DraftView[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const base = name.slice(0, -'.json'.length);
      if (!DRAFT_FILE.test(base)) continue;
      const file = path.join(ws, 'journal', 'drafts', name);
      const read = await cached(file, () => readJson<JournalRecord>(validator, 'journal-record', file));
      if (read.state !== 'ok') continue;
      drafts.push({
        file: base,
        runId: read.value.runId,
        day: read.value.day,
        generatedAt: read.value.generatedAt,
        mode: read.value.mode,
        time: (clockOfTimestamp(read.value.generatedAt, timezone) ?? '').slice(0, 5),
      });
    }
    return drafts.sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
  }

  async function context() {
    const { config, fileState } = await loadConfig();
    const timezone = config.timezone;
    const scanner = options.createScanner(config.secrets);
    const { runs, invalid } = await loadRuns();
    const { snapshots, unreadable } = await loadSnapshots(config, runs, timezone);
    return { config, configState: fileState, timezone, scanner, runs, runsInvalid: invalid, snapshots, unreadable };
  }

  function statusReason(snapshot: SnapshotView): string {
    switch (snapshot.status) {
      case 'pending':
        return 'Noch nicht analysiert.';
      case 'failed':
        return `Letzter Versuch nicht abgeschlossen${snapshot.lastErrorCode === null ? '' : ` (${ATTEMPT_ERROR_TEXT[snapshot.lastErrorCode] ?? snapshot.lastErrorCode})`}. Der nächste Lauf versucht es erneut.`;
      case 'blocked':
        return 'Die Eingabe überschreitet das Limit. Limit in der Konfiguration erhöhen.';
      case 'exhausted':
        return `${snapshot.attempts.failed} von ${snapshot.attempts.max} Versuchen.`;
      default:
        return '';
    }
  }

  const GAP_TEXT: Record<GapView['type'], string> = {
    rebaseline: 'Neuer Ausgangspunkt',
    halt_detected: 'Halt vor neuem Ausgangspunkt',
    previous_state_unavailable: 'Vorgängerstand fehlt',
  };

  async function day(dayValue: string): Promise<DayView> {
    const ctx = await context();
    const { timezone } = ctx;
    const today = todayIn(timezone, now());
    const onDay = ctx.snapshots.filter((entry) => snapshotDays(entry.manifest, timezone).includes(dayValue));
    const snapshots = onDay.map((entry) => entry.view);
    const { notes, invalid: noteInvalid } = await loadNotesOf(dayValue, ctx.scanner, timezone);
    const runs = ctx.runs.filter((run) => dayOfTimestamp(run.startedAt, timezone) === dayValue).map((run) => toRunView(run, timezone));
    const drafts = (await loadDrafts(timezone)).filter((draft) => draft.day === dayValue);
    const state = await loadState();

    // Sort time of an entry (app spec §5.2): snapshot `to` (else `from`), run start, note `recordedAt` on its day,
    // else the start of the time range, else the end of the day.
    const keyOf = (iso: string | null): string => (iso === null ? '~' : (clockOfTimestamp(iso, timezone) ?? '~'));
    const entries: { rank: number; key: string; id: string; entry: TimelineEntry }[] = [];
    for (const snapshot of snapshots) {
      const toDay = dayOfTimestamp(snapshot.observedPeriod.to, timezone);
      const at = toDay === dayValue || snapshot.kind === 'baseline' ? snapshot.observedPeriod.to : snapshot.observedPeriod.from;
      const key = keyOf(snapshot.kind === 'baseline' ? snapshot.capturedAt : at);
      entries.push({ rank: 0, key, id: snapshot.id, entry: { kind: 'snapshot', id: snapshot.id, time: key === '~' ? null : key.slice(0, 5) } });
    }
    for (const note of notes) {
      const recordedDay = dayOfTimestamp(note.recordedAt, timezone);
      const key = recordedDay === dayValue ? keyOf(note.recordedAt) : note.time?.start != null ? `${note.time.start}:00` : '~';
      entries.push({ rank: 1, key, id: note.id, entry: { kind: 'note', id: note.id, time: key === '~' ? null : key.slice(0, 5) } });
    }
    for (const run of runs) {
      const key = keyOf(run.startedAt);
      entries.push({ rank: 2, key, id: run.runId, entry: { kind: 'run', id: run.runId, time: key === '~' ? null : key.slice(0, 5) } });
    }
    entries.sort((a, b) => (a.key === b.key ? a.rank - b.rank || a.id.localeCompare(b.id) : a.key.localeCompare(b.key)));

    const attention: AttentionItem[] = [];
    for (const snapshot of snapshots) {
      if (OPEN_STATUSES.includes(snapshot.status)) {
        attention.push({
          id: `open:${snapshot.id}`,
          level: 'attention',
          kind: 'snapshot_open',
          snapshotId: snapshot.id,
          status: snapshot.status,
          text: `${snapshot.id}: ${ANALYSIS_STATUS[snapshot.status].label}. ${statusReason(snapshot)}`,
          link: 'workLogs',
        });
      }
      if (snapshot.dayAttribution === 'unclear') {
        const range = `${shortStamp(snapshot.observedPeriod.from, timezone)} – ${shortStamp(snapshot.observedPeriod.to, timezone)}`;
        attention.push({
          id: `unclear:${snapshot.id}`,
          level: 'notice',
          kind: 'snapshot_unclear',
          snapshotId: snapshot.id,
          text: `${snapshot.id} überspannt mehrere Tage (${range}) und zählt an keinem Tag als ausgeführte Arbeit.`,
        });
      }
      if (snapshot.withheld.count > 0) {
        attention.push({
          id: `withheld:${snapshot.id}`,
          level: 'attention',
          kind: 'withheld',
          snapshotId: snapshot.id,
          text: `${snapshot.id}: ${snapshot.withheld.count} Einheit(en) zurückgehalten${snapshot.withheld.detectors.length > 0 ? ` (Detektor ${snapshot.withheld.detectors.join(', ')})` : ''}.`,
          link: 'workLogs',
        });
      }
      for (const gap of snapshot.gaps) {
        attention.push({ id: `gap:${snapshot.id}:${gap.type}`, level: 'attention', kind: 'gap', snapshotId: snapshot.id, text: `${snapshot.id}: ${GAP_TEXT[gap.type]}.`, link: 'workLogs' });
      }
    }
    const withheldNotes = notes.filter((note) => note.withheld !== null);
    if (withheldNotes.length > 0) {
      const detectors = [...new Set(withheldNotes.flatMap((note) => note.withheld?.detectors ?? []))];
      attention.push({ id: 'withheld-notes', level: 'attention', kind: 'withheld', text: `${withheldNotes.length} Notiz(en) zurückgehalten (Detektor ${detectors.join(', ')}). Der Text geht nie an Claude.` });
    }
    for (const run of runs) {
      if (QUIET_RUNS.has(run.outcome)) continue;
      const label = RUN_OUTCOME[run.outcome as RunOutcome]?.label ?? run.outcome;
      attention.push({ id: `run:${run.runId}`, level: 'attention', kind: 'run_failed', text: `${run.time}: ${label} (Exit-Code ${run.exitCode}).`, link: 'timeline' });
    }
    if (state?.halt != null) {
      attention.push({ id: 'halt', level: 'attention', kind: 'halt', text: 'Die Erfassung ist angehalten. Einzelheiten stehen in der Projektübersicht.', link: 'overview' });
    }
    const invalidParts: string[] = [];
    if (noteInvalid > 0) invalidParts.push(`${noteInvalid} beschädigte Zeile(n) in notes/${dayValue}.jsonl`);
    if (ctx.runsInvalid > 0) invalidParts.push(`${ctx.runsInvalid} beschädigte Zeile(n) in runs.jsonl`);
    for (const text of invalidParts) attention.push({ id: `invalid:${text}`, level: 'attention', kind: 'invalid_lines', text: `${text}.` });
    if (snapshots.length === 0 && notes.length > 0) {
      attention.push({ id: 'no-capture', level: 'notice', kind: 'no_capture', text: 'Keine Aufnahme an diesem Tag.' });
    }

    return {
      day: dayValue,
      weekday: weekdayOf(dayValue),
      title: formatLongDay(dayValue),
      timezone,
      isFuture: dayValue > today,
      isToday: dayValue === today,
      snapshots,
      notes,
      runs,
      drafts,
      summary: { snapshotCount: snapshots.length, noteCount: notes.length, time: summarizeTime(notes) },
      attention,
      timeline: entries.map((entry) => entry.entry),
      invalid: { noteLines: noteInvalid, runLines: ctx.runsInvalid, unreadableFiles: ctx.unreadable },
    };
  }

  function shortStamp(iso: string | null, timezone: string): string {
    if (iso === null) return 'unbekannt';
    const date = dayOfTimestamp(iso, timezone);
    const clock = clockOfTimestamp(iso, timezone);
    if (date === null || clock === null) return 'unbekannt';
    return `${date.slice(8, 10)}.${date.slice(5, 7)}. ${clock.slice(0, 5)}`;
  }

  async function dayIndex(): Promise<DayIndex> {
    const ctx = await context();
    const { timezone } = ctx;
    const data = new Set<string>();
    const warning = new Set<string>();
    for (const entry of ctx.snapshots) {
      for (const day of snapshotDays(entry.manifest, timezone)) {
        data.add(day);
        if (OPEN_STATUSES.includes(entry.view.status)) warning.add(day);
      }
    }
    for (const day of await noteDays()) data.add(day);
    for (const run of ctx.runs) {
      const day = dayOfTimestamp(run.startedAt, timezone);
      if (day === null) continue;
      data.add(day);
      if (!QUIET_RUNS.has(run.outcome)) warning.add(day);
    }
    const state = await loadState();
    if (state?.halt != null) {
      const day = dayOfTimestamp(state.halt.detectedAt, timezone);
      if (day !== null) {
        data.add(day);
        warning.add(day);
      }
    }
    const days = [...data].sort().map((day) => ({ day, hasData: true, warning: warning.has(day) }));
    return { timezone, today: todayIn(timezone, now()), days };
  }

  async function workLog(snapshotId: string): Promise<WorkLogView | null> {
    if (!SNAPSHOT_ID.test(snapshotId)) return null;
    const ctx = await context();
    const entry = ctx.snapshots.find((candidate) => candidate.view.id === snapshotId);
    if (entry === undefined) return null;
    const read = await readText(path.join(ws, 'logs', `${snapshotId}.md`));
    if (read.state === 'ok') return { snapshot: entry.view, state: 'ok', markdown: read.text, replacement: false };
    return { snapshot: entry.view, state: read.state === 'missing' ? 'missing' : 'unreadable', markdown: replacementLog(entry.view, entry.manifest), replacement: true };
  }

  /** The "Nicht erstellt" view: built only from manifest and status, nothing invented (app spec §8.4). */
  function replacementLog(snapshot: SnapshotView, manifest: ManifestData): string {
    const hint =
      snapshot.status === 'exhausted'
        ? `Analyse nach ${snapshot.attempts.failed} Versuchen nicht abgeschlossen.`
        : snapshot.status === 'blocked'
          ? 'Eingabe zu gross. Die Analyse wurde nicht gestartet, weil die Eingabe das Limit überschreitet. Limit in der Konfiguration erhöhen, danach erneut analysieren.'
          : snapshot.status === 'skipped'
            ? 'Die Analyse wurde bewusst übersprungen.'
            : `${ANALYSIS_STATUS[snapshot.status].label}. ${statusReason(snapshot)}`.trim();
    const withheld = manifest.filterDecisions.filter((decision) => decision.decision === 'withheld');
    const changes = manifest.statusChanges.slice(0, 20).map((change) => `- \`${change.path}\`: ${change.from} → ${change.to}`);
    if (manifest.statusChanges.length > 20) changes.push(`- … und ${manifest.statusChanges.length - 20} weitere`);
    const notices = [`- Status: ${hint}`];
    if (withheld.length > 0) {
      const detectors = [...new Set(withheld.flatMap((decision) => (decision.detector === null ? [] : [decision.detector])))];
      notices.push(`- Secret-Verdacht${detectors.length > 0 ? ` (Detektor ${detectors.join(', ')})` : ''}. ${withheld.length} Einheit(en) zurückgehalten.`);
    }
    for (const gap of manifest.gaps) notices.push(`- ${GAP_TEXT[gap.type]}.`);
    const none = 'nicht erfasst';
    return [
      `# Work-Log ${snapshot.id} (nicht erstellt)`,
      '',
      '> Dieser Work-Log ist noch nicht erstellt. Die App zeigt stattdessen den Stand aus dem Manifest.',
      '',
      '## Zusammenfassung',
      '',
      'Nicht erstellt. Die Analyse ist nicht abgeschlossen.',
      '',
      '## Umgesetzt',
      '',
      none,
      '',
      '## Entscheidungen',
      '',
      none,
      '',
      '## Probleme',
      '',
      none,
      '',
      '## Tests',
      '',
      none,
      '',
      '## Widersprüche',
      '',
      none,
      '',
      '## Statusänderungen',
      '',
      ...(changes.length > 0 ? changes : [none]),
      '',
      '## Unbekannt/offen',
      '',
      none,
      '',
      '## Erfassungshinweise',
      '',
      ...notices,
      '',
      '## Belege',
      '',
      `${manifest.evidence.length} Beleg(e) im Manifest. Die Dateien liegen im Arbeitsbereich des Tools.`,
      '',
    ].join('\n');
  }

  async function journal(file: string): Promise<JournalDraftView | null> {
    if (!DRAFT_FILE.test(file)) return null;
    const ctx = await context();
    const draft = (await loadDrafts(ctx.timezone)).find((candidate) => candidate.file === file);
    if (draft === undefined) return null;
    const read = await readText(path.join(ws, 'journal', 'drafts', `${file}.md`));
    const state: FileState = read.state === 'ok' ? 'ok' : read.state === 'missing' ? 'missing' : 'unreadable';
    const markdown = read.state === 'ok' ? read.text : '';
    const headings = markdown.split('\n').flatMap((line) => (/^## (.+)$/.exec(line)?.[1] ?? []));
    return { draft, state, markdown, headings };
  }

  async function references(): Promise<ReferenceIndex> {
    const ctx = await context();
    const notes: Record<string, string> = {};
    for (const day of await noteDays()) {
      const file = path.join(ws, 'notes', `${day}.jsonl`);
      const read = await cached(file, () => readJsonl<NoteRecord>(validator, 'note', file));
      for (const note of read.items) if (note.activityDay === day) notes[note.id] = day;
    }
    const snapshots: Record<string, string> = {};
    for (const entry of ctx.snapshots) {
      const days = snapshotDays(entry.manifest, ctx.timezone);
      const first = days[0];
      if (first !== undefined) snapshots[entry.view.id] = days[days.length - 1] ?? first;
    }
    return { notes, snapshots };
  }

  async function derivedCounts() {
    const ctx = await context();
    const statuses = ctx.snapshots.map((entry) => entry.view.status);
    let withheldNotes = 0;
    for (const day of await noteDays()) {
      const { notes } = await loadNotesOf(day, ctx.scanner, ctx.timezone);
      withheldNotes += notes.filter((note) => note.withheld !== null).length;
    }
    return {
      counts: countStatuses(statuses),
      openIds: ctx.snapshots.filter((entry) => OPEN_STATUSES.includes(entry.view.status)).map((entry) => entry.view.id),
      withheldNotes,
    };
  }

  async function overview(status: StatusReport | null, schedule: OverviewView['schedule']): Promise<OverviewView> {
    const ctx = await context();
    const state = await loadState();
    const derived = await derivedCounts();
    const doctor = await readJson<{ checkedAt: string; ok: boolean; claude: { found: boolean; version: string | null; loggedIn: boolean | null } }>(
      validator,
      'doctor',
      path.join(ws, 'doctor.json'),
    );
    const claude: ClaudeView =
      doctor.state !== 'ok'
        ? { checkedAt: null, ok: null, version: null, problem: null }
        : {
            checkedAt: doctor.value.checkedAt,
            ok: doctor.value.ok,
            version: doctor.value.claude.version,
            problem: doctor.value.ok ? null : !doctor.value.claude.found ? 'Claude Code wurde nicht gefunden.' : doctor.value.claude.loggedIn === false ? 'Die Anmeldung fehlt.' : 'Die Prüfung ist nicht bestanden.',
          };

    const lastRunRecord = ctx.runs.at(-1);
    const lastSnapshot = ctx.snapshots.at(-1);
    const index = await dayIndex();
    const analyses = status === null ? derived.counts : status.analyses;
    return {
      halt:
        state?.halt == null
          ? null
          : {
              reason: state.halt.reason,
              detectedAt: state.halt.detectedAt,
              expected: state.halt.expected,
              observed: state.halt.observed,
              runId: [...ctx.runs].reverse().find((run) => run.outcome === 'halted')?.runId ?? null,
            },
      claude,
      lastRun: lastRunRecord === undefined ? null : toRunView(lastRunRecord, ctx.timezone),
      lastSnapshot: lastSnapshot === undefined ? null : { id: lastSnapshot.view.id, time: lastSnapshot.view.observedPeriod.to },
      analysedUpTo: state?.lastAnalysedSnapshotId ?? null,
      analyses: { pending: analyses.pending, failed: analyses.failed, blocked: analyses.blocked, exhausted: analyses.exhausted, complete: analyses.complete, skipped: analyses.skipped, notRequired: analyses.notRequired },
      withheld: status === null ? { units: ctx.snapshots.reduce((sum, entry) => sum + entry.view.withheld.count, 0), notes: derived.withheldNotes } : status.withheld,
      notesToday: status === null ? (await loadNotesOf(todayIn(ctx.timezone, now()), ctx.scanner, ctx.timezone)).notes.length : status.notesToday,
      schedule,
      recentDays: index.days.slice(-7).reverse().map((entry) => ({ day: entry.day, warning: entry.warning })),
      timezone: ctx.timezone,
      inconsistent: status !== null && (!countsEqual(derived.counts, { ...status.analyses, notRequired: status.analyses.notRequired }) || derived.withheldNotes !== status.withheld.notes),
    };
  }

  async function resolveFile(ref: FileRef): Promise<string | null> {
    let target: string;
    switch (ref.kind) {
      case 'workLog':
        if (!SNAPSHOT_ID.test(ref.snapshotId)) return null;
        target = path.join(ws, 'logs', `${ref.snapshotId}.md`);
        break;
      case 'journalDraft':
        if (!DRAFT_FILE.test(ref.file)) return null;
        target = path.join(ws, 'journal', 'drafts', `${ref.file}.md`);
        break;
      case 'journalFinalFolder':
        target = path.join(ws, 'journal', 'final');
        break;
      case 'workspaceFolder':
        target = ws;
        break;
      case 'evidence': {
        if (!SNAPSHOT_ID.test(ref.snapshotId) || !/^E\d{3,}$/.test(ref.evidenceId)) return null;
        const file = path.join(ws, 'snapshots', ref.snapshotId, 'manifest.json');
        const manifest = await readJson<ManifestData>(validator, 'manifest', file);
        if (manifest.state !== 'ok') return null;
        const copy = manifest.value.evidence.find((item) => item.id === ref.evidenceId)?.file;
        if (typeof copy !== 'string' || !/^content\/[^\\/]+$/.test(copy)) return null;
        target = path.join(ws, 'snapshots', ref.snapshotId, copy);
        break;
      }
    }
    if (!(await exists(target))) return null;
    // After realpath the target must stay inside the workspace (spec §3.8).
    const [real, root] = await Promise.all([realpath(target), realpath(ws)]);
    const relative = path.relative(root, real);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)) ? real : null;
  }

  return { day, dayIndex, workLog, drafts: async (dayValue) => (await loadDrafts((await loadConfig()).config.timezone)).filter((draft) => draft.day === dayValue), journal, references, overview, resolveFile, derivedCounts };
}

export type { SnapshotStatus };
