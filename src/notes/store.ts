/**
 * Notes as JSONL per activity day in `notes/<activityDay>.jsonl` (spec.md §8.1, §9.5). Appending
 * takes no lock (D-16): a note never waits for a running capture.
 */
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceContext } from '../core/context.js';
import { errnoCode } from '../core/errors.js';
import { createNoteId } from '../core/ids.js';
import { appendJsonl, type InvalidLine, readJsonlEntries } from '../core/jsonl.js';
import { dayOf, formatZoned, isValidDay } from '../core/time.js';
import { checkNoteInput } from './input.js';
import type { Note, NoteInput } from './types.js';

export const NOTES_FOLDER = 'notes';

const NOTE_FILE = /^([0-9]{4}-[0-9]{2}-[0-9]{2})\.jsonl$/;

export function notesFilePath(workspaceDir: string, day: string): string {
  return path.join(workspaceDir, NOTES_FOLDER, `${day}.jsonl`);
}

/**
 * Checks the input (exit code 2 on a violation), adds `id`, `recordedAt` and the default
 * `activityDay` from one reading of the clock, and appends the note to the file of its day.
 */
export async function addNote(ctx: WorkspaceContext, input: NoteInput): Promise<Note> {
  const now = ctx.clock.now();
  const timezone = ctx.config.timezone;
  const fields = checkNoteInput(input, dayOf(now, timezone));
  const note: Note = {
    schemaVersion: 1,
    id: createNoteId({ now: () => now }),
    type: fields.type,
    text: fields.text,
    activityDay: fields.activityDay,
    recordedAt: formatZoned(now, timezone),
    time: fields.time,
    delay: fields.delay,
    reason: fields.reason,
    alternatives: fields.alternatives,
    cause: fields.cause,
    solution: fields.solution,
    refs: fields.refs,
  };
  await mkdir(path.join(ctx.workspaceDir, NOTES_FOLDER), { recursive: true });
  await appendJsonl(notesFilePath(ctx.workspaceDir, note.activityDay), note, 'note');
  return note;
}

/** All criteria that are given must hold. */
export interface NoteQuery {
  /** Activity day `YYYY-MM-DD`; only the file of this day is read. */
  day?: string;
  /** `recordedAt` after this timestamp (exclusive, as `observedPeriod.from` in spec.md §12.2). */
  recordedFrom?: string;
  /** `recordedAt` at or before this timestamp (inclusive, as `observedPeriod.to`). */
  recordedTo?: string;
  /** At least one entry in `refs` points into this snapshot. */
  refsToSnapshot?: string;
}

export interface InvalidNoteLine extends InvalidLine {
  /** Relative to the workspace, for example `notes/2026-10-14.jsonl`. */
  file: string;
}

export interface NoteReadResult {
  /** Sorted by `recordedAt`, then by `id`. */
  notes: Note[];
  invalid: InvalidNoteLine[];
}

/** Days with a note file, ascending. Other files in `notes/` are ignored. */
async function listNoteDays(workspaceDir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(path.join(workspaceDir, NOTES_FOLDER));
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return [];
    throw error;
  }
  return names
    .map((name) => NOTE_FILE.exec(name)?.[1])
    .filter((day): day is string => day !== undefined)
    .sort();
}

function instantOf(timestamp: string, what: string): number {
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) throw new RangeError(`${what} ist kein gültiger Zeitstempel: ${timestamp}`);
  return ms;
}

interface ReadNote {
  note: Note;
  instant: number;
}

/**
 * spec.md §10. Lines that are not valid JSON or violate the schema are reported and skipped, like
 * lines whose `activityDay` does not match the file, whose `recordedAt` is no real instant, or whose
 * `id` already appeared among the files read, for example after a line was copied by hand.
 */
export async function readNotes(ctx: WorkspaceContext, q: NoteQuery = {}): Promise<NoteReadResult> {
  if (q.day !== undefined && !isValidDay(q.day)) throw new RangeError(`Ungültiger Tag: ${q.day}`);
  const from = q.recordedFrom === undefined ? null : instantOf(q.recordedFrom, 'recordedFrom');
  const to = q.recordedTo === undefined ? null : instantOf(q.recordedTo, 'recordedTo');
  const days = q.day === undefined ? await listNoteDays(ctx.workspaceDir) : [q.day];

  const read: ReadNote[] = [];
  const invalid: InvalidNoteLine[] = [];
  const seen = new Set<string>();
  for (const day of days) {
    const file = `${NOTES_FOLDER}/${day}.jsonl`;
    const { entries, invalid: broken } = await readJsonlEntries<Note>(notesFilePath(ctx.workspaceDir, day), 'note');
    invalid.push(...broken.map((line) => ({ file, ...line })));
    for (const { line, record } of entries) {
      const instant = Date.parse(record.recordedAt);
      if (record.activityDay !== day) {
        invalid.push({ file, line, error: `activityDay ${record.activityDay} passt nicht zur Datei des Tages ${day}` });
      } else if (Number.isNaN(instant)) {
        invalid.push({ file, line, error: 'recordedAt ist kein gültiger Zeitpunkt' });
      } else if (seen.has(record.id)) {
        invalid.push({ file, line, error: `Notiz-ID ${record.id} kommt mehrfach vor` });
      } else {
        seen.add(record.id);
        read.push({ note: record, instant });
      }
    }
  }

  // File names are days, so their string order is the order of the days.
  invalid.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));

  const prefix = q.refsToSnapshot === undefined ? null : `${q.refsToSnapshot}:`;
  const notes = read
    .filter(({ instant }) => (from === null || instant > from) && (to === null || instant <= to))
    .filter(({ note }) => prefix === null || note.refs.some((ref) => ref.startsWith(prefix)))
    .sort((a, b) => a.instant - b.instant || (a.note.id < b.note.id ? -1 : a.note.id > b.note.id ? 1 : 0))
    .map(({ note }) => note);
  return { notes, invalid };
}
