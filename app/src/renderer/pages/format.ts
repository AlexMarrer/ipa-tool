import { clockOfTimestamp, dayOfTimestamp } from '../../shared/dates';
import type { Basis, NoteType, NoteView } from '../../shared/views';

export const NOTE_TYPE_LABEL: Record<NoteType, string> = {
  general: 'Allgemein',
  activity: 'Tätigkeit',
  problem: 'Problem',
  decision: 'Entscheidung',
  insight: 'Erkenntnis',
  plan: 'Planung',
};

export const NOTE_TYPES = Object.keys(NOTE_TYPE_LABEL) as NoteType[];

export const BASIS_LABEL: Record<Basis, string> = { measured: 'gemessen', estimated: 'geschätzt' };

/** `14.10.2026 16:05` in the zone of the project. */
export function formatStamp(iso: string | null, timeZone: string): string {
  if (iso === null) return 'unbekannt';
  const day = dayOfTimestamp(iso, timeZone);
  const clock = clockOfTimestamp(iso, timeZone);
  if (day === null || clock === null) return 'unbekannt';
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)} ${clock.slice(0, 5)}`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** `…d2e8`: the last four characters of a run id, the full id goes into the tooltip. */
export function shortRunId(runId: string): string {
  return `…${runId.slice(-4)}`;
}

/** The figure at the right of a note in the timeline and the list (spec §8.3, §8.6). */
export function noteFigure(note: Pick<NoteView, 'type' | 'time' | 'delay'>): string {
  const parts: string[] = [];
  if (note.time !== null) {
    if (note.time.start !== null && note.time.end !== null) parts.push(`Zeit von ${note.time.start} bis ${note.time.end}`);
    else parts.push(`${note.time.minutes} min ${note.type === 'plan' ? 'geplant' : BASIS_LABEL[note.time.basis]}`);
  }
  if (note.delay !== null) parts.push(`Verzögerung ${note.delay.minutes} min`);
  return parts.length === 0 ? 'ohne Zeit' : parts.join(' · ');
}

export function timeDetail(note: Pick<NoteView, 'time'>): string {
  if (note.time === null) return 'nicht angegeben';
  if (note.time.start !== null && note.time.end !== null) return `Von ${note.time.start} bis ${note.time.end}, ${note.time.minutes} Minuten`;
  return `${note.time.minutes} Minuten (Dauer)`;
}

export const SCHEDULE_STATE: Record<string, string> = {
  not_installed: 'Nicht eingerichtet',
  active: 'Aktiv',
  paused: 'Pausiert',
  stale: 'Veraltet',
  error: 'Fehler',
};

/** First line of a note text, cut to a readable length for the timeline title. */
export function noteTitle(text: string): string {
  const first = text.split('\n')[0] ?? '';
  return first.length > 120 ? `${first.slice(0, 117)}…` : first;
}
