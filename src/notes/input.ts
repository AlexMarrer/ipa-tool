/**
 * Rules for a new note (spec.md §6.3, §9.5, package 04 §4). Every violation is a usage error with
 * exit code 2. Messages never repeat the text of a note or other free text.
 */
import { EXIT, IpaError } from '../core/errors.js';
import { ID_PATTERNS } from '../core/ids.js';
import { isValidDay } from '../core/time.js';
import {
  NOTE_TYPES,
  type NoteDelay,
  type NoteFields,
  type NoteInput,
  type NoteTime,
  type NoteType,
  TIME_BASES,
  type TimeBasis,
} from './types.js';

/** Option values of `ipa note` as the command line delivers them. */
export interface RawNoteOptions {
  type?: string;
  day?: string;
  minutes?: string;
  start?: string;
  end?: string;
  measured?: boolean;
  estimated?: boolean;
  delay?: string;
  reason?: string;
  alternative?: string[];
  cause?: string;
  solution?: string;
  ref?: string[];
}

/** A duration whose basis may still come from the interactive input. */
export interface NoteDuration {
  minutes: number;
  start: string | null;
  end: string | null;
}

/** Options after the syntax checks; `undefined` means not given. */
export interface NoteOptions {
  type?: NoteType;
  day?: string;
  duration?: NoteDuration;
  delayMinutes?: number;
  basis?: TimeBasis;
  reason?: string;
  alternatives: string[];
  cause?: string;
  solution?: string;
  refs: string[];
}

function usageError(code: string, message: string): IpaError {
  return new IpaError(code, EXIT.usage, message);
}

export function isNoteType(value: string): value is NoteType {
  return (NOTE_TYPES as readonly string[]).includes(value);
}

export function parseNoteType(value: string): NoteType {
  if (!isNoteType(value)) {
    throw usageError('note_type_invalid', `Unbekannter Notiztyp. Erlaubt sind ${NOTE_TYPES.join(', ')}.`);
  }
  return value;
}

function checkMinutesValue(option: string, minutes: number): number {
  if (!Number.isSafeInteger(minutes) || minutes < 1) {
    throw usageError('note_minutes_invalid', `${option} erwartet eine ganze Zahl grösser als 0, zum Beispiel ${option} 45.`);
  }
  return minutes;
}

/** Whole number of minutes greater than 0, as for `--minutes` and `--delay`. */
export function parseMinutes(option: string, value: string): number {
  const trimmed = value.trim();
  return checkMinutesValue(option, /^[0-9]+$/.test(trimmed) ? Number(trimmed) : Number.NaN);
}

const TIME_OF_DAY = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

function parseTimeOfDay(option: string, value: string): number {
  const match = TIME_OF_DAY.exec(value);
  if (match === null) {
    throw usageError('note_time_invalid', `${option} erwartet eine Uhrzeit im Format HH:MM, zum Beispiel 09:10.`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Minutes from `start` to `end` on one day. It is the difference of the clock times; a switch to or
 * from daylight saving time in between is not taken into account.
 */
export function spanMinutes(start: string, end: string): number {
  const from = parseTimeOfDay('--start', start);
  const to = parseTimeOfDay('--end', end);
  if (to <= from) {
    throw usageError('note_time_order', '--end muss nach --start liegen, beide am selben Tag.');
  }
  return to - from;
}

/** Leading and trailing blanks are removed; a value of blanks only is an error. */
function requireText(option: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') throw usageError('note_value_empty', `${option} darf nicht leer sein.`);
  return trimmed;
}

export function checkText(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') throw usageError('note_text_empty', 'Der Text der Notiz darf nicht leer sein.');
  return trimmed;
}

/** Only the syntax of a qualified evidence ID; its existence is checked from package 06 on (D-23). */
export function checkRefs(refs: readonly string[]): string[] {
  const result: string[] = [];
  for (const [index, raw] of refs.entries()) {
    const ref = raw.trim();
    if (!ID_PATTERNS.qualifiedEvidence.test(ref)) {
      // The position stands in for the rejected value, which is not repeated.
      const position = refs.length > 1 ? ` (Angabe ${index + 1} von ${refs.length})` : '';
      throw usageError('note_ref_invalid', `--ref erwartet einen Beleg der Form S000001:E001${position}.`);
    }
    if (!result.includes(ref)) result.push(ref);
  }
  return result;
}

export interface TypeFields {
  reason?: string | null | undefined;
  alternatives?: readonly string[] | undefined;
  cause?: string | null | undefined;
  solution?: string | null | undefined;
}

export function checkTypeFields(type: NoteType, fields: TypeFields): void {
  if (type !== 'decision' && (fields.reason != null || (fields.alternatives?.length ?? 0) > 0)) {
    throw usageError('note_decision_fields', '--reason und --alternative sind nur bei --type decision erlaubt.');
  }
  if (type !== 'problem' && (fields.cause != null || fields.solution != null)) {
    throw usageError('note_problem_fields', '--cause und --solution sind nur bei --type problem erlaubt.');
  }
}

function checkDaySyntax(day: string): string {
  if (!isValidDay(day)) {
    throw usageError('note_day_invalid', '--day erwartet einen Kalendertag im Format YYYY-MM-DD.');
  }
  return day;
}

/** Past days are allowed, future days only for plans (package 04 §4). */
export function checkActivityDay(day: string, type: NoteType, today: string): void {
  checkDaySyntax(day);
  if (day > today && type !== 'plan') {
    throw usageError('note_day_future', `Der Tag ${day} liegt in der Zukunft. Das ist nur bei --type plan erlaubt.`);
  }
}

function parseDuration(raw: RawNoteOptions): NoteDuration | undefined {
  if (raw.minutes !== undefined && (raw.start !== undefined || raw.end !== undefined)) {
    throw usageError('note_time_conflict', '--minutes und --start/--end schliessen sich aus. Bitte nur eine Form der Zeitangabe verwenden.');
  }
  if ((raw.start === undefined) !== (raw.end === undefined)) {
    throw usageError('note_time_incomplete', '--start und --end gehören zusammen.');
  }
  if (raw.minutes !== undefined) return { minutes: parseMinutes('--minutes', raw.minutes), start: null, end: null };
  if (raw.start !== undefined && raw.end !== undefined) {
    const start = raw.start.trim();
    const end = raw.end.trim();
    return { minutes: spanMinutes(start, end), start, end };
  }
  return undefined;
}

function parseBasis(raw: RawNoteOptions): TimeBasis | undefined {
  if (raw.measured === true && raw.estimated === true) {
    throw usageError('note_basis_conflict', 'Bitte nur eine Basis angeben: --measured oder --estimated.');
  }
  if (raw.measured === true) return 'measured';
  return raw.estimated === true ? 'estimated' : undefined;
}

/** Checks each option on its own and in the combinations that do not depend on the note type. */
export function parseNoteOptions(raw: RawNoteOptions): NoteOptions {
  return {
    type: raw.type === undefined ? undefined : parseNoteType(raw.type),
    day: raw.day === undefined ? undefined : checkDaySyntax(raw.day.trim()),
    duration: parseDuration(raw),
    delayMinutes: raw.delay === undefined ? undefined : parseMinutes('--delay', raw.delay),
    basis: parseBasis(raw),
    reason: raw.reason === undefined ? undefined : requireText('--reason', raw.reason),
    alternatives: (raw.alternative ?? []).map((value) => requireText('--alternative', value)),
    cause: raw.cause === undefined ? undefined : requireText('--cause', raw.cause),
    solution: raw.solution === undefined ? undefined : requireText('--solution', raw.solution),
    refs: checkRefs(raw.ref ?? []),
  };
}

/**
 * Checks that need the note type, for the interactive input before it asks the first question.
 * Without `--type` they follow once the type has been answered.
 */
export function precheckNoteOptions(options: NoteOptions, today: string): void {
  if (options.type === undefined) return;
  checkTypeFields(options.type, options);
  if (options.day !== undefined) checkActivityDay(options.day, options.type, today);
}

/** One basis applies to the time and to the delay (package 04 §4, D-13). */
function applyBasis(options: NoteOptions): { time: NoteTime | null; delay: NoteDelay | null } {
  const { duration, delayMinutes, basis } = options;
  if (basis === undefined) {
    if (duration !== undefined || delayMinutes !== undefined) {
      throw usageError(
        'note_basis_missing',
        'Eine Zeitangabe braucht --measured oder --estimated, damit feststeht, ob sie gemessen oder geschätzt ist.',
      );
    }
    return { time: null, delay: null };
  }
  if (duration === undefined && delayMinutes === undefined) {
    throw usageError('note_basis_without_time', '--measured und --estimated gelten nur zusammen mit --minutes, --start/--end oder --delay.');
  }
  return {
    time: duration === undefined ? null : { minutes: duration.minutes, basis, start: duration.start, end: duration.end },
    delay: delayMinutes === undefined ? null : { minutes: delayMinutes, basis },
  };
}

export function toNoteInput(options: NoteOptions, text: string): NoteInput {
  const { time, delay } = applyBasis(options);
  return {
    type: options.type ?? 'general',
    text,
    activityDay: options.day,
    time,
    delay,
    reason: options.reason ?? null,
    alternatives: options.alternatives,
    cause: options.cause ?? null,
    solution: options.solution ?? null,
    refs: options.refs,
  };
}

function checkBasisValue(basis: string): TimeBasis {
  if (!(TIME_BASES as readonly string[]).includes(basis)) {
    throw usageError('note_basis_invalid', 'Unbekannte Zeitbasis. Erlaubt sind measured und estimated.');
  }
  return basis as TimeBasis;
}

function checkTime(time: NoteTime | null): NoteTime | null {
  if (time === null) return null;
  const minutes = checkMinutesValue('--minutes', time.minutes);
  const basis = checkBasisValue(time.basis);
  if (time.start === null && time.end === null) return { minutes, basis, start: null, end: null };
  if (time.start === null || time.end === null) {
    throw usageError('note_time_incomplete', '--start und --end gehören zusammen.');
  }
  const span = spanMinutes(time.start, time.end);
  if (span !== minutes) {
    throw usageError('note_time_mismatch', `${minutes} Minuten passen nicht zu ${time.start} bis ${time.end} (${span} Minuten).`);
  }
  return { minutes, basis, start: time.start, end: time.end };
}

function checkDelay(delay: NoteDelay | null): NoteDelay | null {
  if (delay === null) return null;
  return { minutes: checkMinutesValue('--delay', delay.minutes), basis: checkBasisValue(delay.basis) };
}

/**
 * All rules for the content of a new note; `today` is the current day in the configured time zone.
 * Returns the normalized fields: trimmed texts, defaults filled in, duplicate refs removed.
 */
export function checkNoteInput(input: NoteInput, today: string): NoteFields {
  const type = parseNoteType(input.type);
  const text = checkText(input.text);
  const activityDay = input.activityDay ?? today;
  checkActivityDay(activityDay, type, today);
  const reason = input.reason == null ? null : requireText('--reason', input.reason);
  const alternatives = (input.alternatives ?? []).map((value) => requireText('--alternative', value));
  const cause = input.cause == null ? null : requireText('--cause', input.cause);
  const solution = input.solution == null ? null : requireText('--solution', input.solution);
  checkTypeFields(type, { reason, alternatives, cause, solution });
  return {
    type,
    text,
    activityDay,
    time: checkTime(input.time ?? null),
    delay: checkDelay(input.delay ?? null),
    reason,
    alternatives,
    cause,
    solution,
    refs: checkRefs(input.refs ?? []),
  };
}
