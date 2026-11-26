import { MAX_NOTE_TEXT, type NoteInput } from '../../shared/run';
import type { NoteType } from '../../shared/views';

/** Value of the note form. Texts are what the user typed; `check` turns them into a valid command or says why not. */
export interface NoteForm {
  type: NoteType;
  text: string;
  day: string;
  timeMode: 'duration' | 'range';
  minutes: string;
  start: string;
  end: string;
  basis: 'measured' | 'estimated' | null;
  delay: string;
  reason: string;
  alternatives: string[];
  cause: string;
  solution: string;
  refs: string[];
}

export const MAX_REFS = 100;

export function emptyForm(today: string): NoteForm {
  return { type: 'general', text: '', day: today, timeMode: 'duration', minutes: '', start: '', end: '', basis: null, delay: '', reason: '', alternatives: [], cause: '', solution: '', refs: [] };
}

/**
 * Changing the type removes the fields of the old type and their values; a future day only exists for a plan
 * (spec §8.8: invalid combinations cannot be made).
 */
export function changeType(form: NoteForm, type: NoteType, today: string): NoteForm {
  const next: NoteForm = { ...form, type };
  if (type !== 'decision') {
    next.reason = '';
    next.alternatives = [];
  }
  if (type !== 'problem') {
    next.cause = '';
    next.solution = '';
  }
  if (type !== 'plan' && next.day > today) next.day = today;
  return next;
}

/** Switching between duration and from–to clears the other pair, so both never exist at once. */
export function changeTimeMode(form: NoteForm, timeMode: NoteForm['timeMode']): NoteForm {
  return timeMode === 'duration' ? { ...form, timeMode, start: '', end: '' } : { ...form, timeMode, minutes: '' };
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = (clock: string): number => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

export type FieldName = 'text' | 'minutes' | 'start' | 'end' | 'delay' | 'basis' | 'refs';

export interface FormCheck {
  errors: Partial<Record<FieldName, string>>;
  /** Why saving is locked, or `null`. */
  blocked: string | null;
  /** Minutes between start and end, when both are valid. */
  computed: number | null;
  /** Whether a time or a delay is entered, so that the basis is required. */
  needsBasis: boolean;
  input: NoteInput | null;
}

const wholeMinutes = (value: string): number | null => (/^\d{1,4}$/.test(value.trim()) && Number(value) > 0 && Number(value) <= 1440 ? Number(value) : null);

export function checkForm(form: NoteForm): FormCheck {
  const errors: FormCheck['errors'] = {};
  const text = form.text.trim();
  if (text.length > MAX_NOTE_TEXT) errors.text = `Der Text ist zu lang (höchstens ${MAX_NOTE_TEXT} Zeichen).`;

  let minutes: number | null = null;
  let computed: number | null = null;
  const minutesGiven = form.minutes.trim() !== '';
  const startGiven = form.start.trim() !== '';
  const endGiven = form.end.trim() !== '';
  if (form.timeMode === 'duration') {
    if (minutesGiven) {
      minutes = wholeMinutes(form.minutes);
      if (minutes === null) errors.minutes = 'Ganze Minuten von 1 bis 1440 eingeben.';
    }
  } else {
    if (startGiven && !CLOCK.test(form.start.trim())) errors.start = 'Uhrzeit als HH:MM eingeben';
    if (endGiven && !CLOCK.test(form.end.trim())) errors.end = 'Uhrzeit als HH:MM eingeben';
    if (startGiven !== endGiven && errors.start === undefined && errors.end === undefined) errors[startGiven ? 'end' : 'start'] = 'Beginn und Ende gehören zusammen.';
    if (startGiven && endGiven && errors.start === undefined && errors.end === undefined) {
      const length = toMinutes(form.end.trim()) - toMinutes(form.start.trim());
      if (length <= 0) errors.end = 'Ende muss nach dem Beginn liegen';
      else computed = length;
    }
  }
  let delay: number | null = null;
  const delayGiven = form.delay.trim() !== '';
  if (delayGiven) {
    delay = wholeMinutes(form.delay);
    if (delay === null) errors.delay = 'Ganze Minuten von 1 bis 1440 eingeben.';
  }
  if (form.refs.length > MAX_REFS) errors.refs = `Höchstens ${MAX_REFS} Belege.`;

  const needsBasis = minutesGiven || startGiven || endGiven || delayGiven;
  if (needsBasis && form.basis === null) errors.basis = 'Bitte wählen: gemessen oder geschätzt. Ohne Auswahl lässt sich die Notiz nicht speichern.';

  const timeInvalid = errors.minutes !== undefined || errors.start !== undefined || errors.end !== undefined || errors.delay !== undefined;
  const blocked =
    text === ''
      ? 'Speichern gesperrt: Der Text fehlt.'
      : errors.text !== undefined
        ? 'Speichern gesperrt: Der Text ist zu lang.'
        : timeInvalid
          ? 'Speichern gesperrt: Die Zeitangabe ist nicht gültig.'
          : errors.basis !== undefined
            ? 'Speichern gesperrt: Zeit ohne Basis'
            : errors.refs !== undefined
              ? 'Speichern gesperrt: Zu viele Belege.'
              : null;
  if (blocked !== null) return { errors, blocked, computed, needsBasis, input: null };

  const input: NoteInput = { text };
  if (form.type !== 'general') input.type = form.type;
  input.day = form.day;
  if (form.timeMode === 'duration' && minutes !== null) input.minutes = minutes;
  if (form.timeMode === 'range' && computed !== null) {
    input.start = form.start.trim();
    input.end = form.end.trim();
  }
  if (delay !== null) input.delay = delay;
  if (needsBasis && form.basis !== null) input.timeKind = form.basis;
  if (form.type === 'decision') {
    const reason = form.reason.trim();
    if (reason !== '') input.reason = reason;
    const alternatives = form.alternatives.map((item) => item.trim()).filter((item) => item !== '');
    if (alternatives.length > 0) input.alternatives = alternatives;
  }
  if (form.type === 'problem') {
    if (form.cause.trim() !== '') input.cause = form.cause.trim();
    if (form.solution.trim() !== '') input.solution = form.solution.trim();
  }
  if (form.refs.length > 0) input.refs = form.refs;
  return { errors, blocked: null, computed, needsBasis, input };
}
