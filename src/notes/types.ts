/**
 * Note model of spec.md §9.5.
 */

export const NOTE_TYPES = ['general', 'activity', 'problem', 'decision', 'insight', 'plan'] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

/** Every time value states whether it was measured or estimated (D-13). */
export const TIME_BASES = ['measured', 'estimated'] as const;
export type TimeBasis = (typeof TIME_BASES)[number];

export interface NoteTime {
  minutes: number;
  basis: TimeBasis;
  /** `HH:MM`; set together with `end` when the minutes were computed from a time span. */
  start: string | null;
  end: string | null;
}

/** Kept apart from `time` and never added to it (I-07). */
export interface NoteDelay {
  minutes: number;
  basis: TimeBasis;
}

export interface Note {
  schemaVersion: 1;
  id: string;
  type: NoteType;
  text: string;
  activityDay: string;
  recordedAt: string;
  time: NoteTime | null;
  delay: NoteDelay | null;
  /** Only for `decision`; `null` means the reason is unknown. */
  reason: string | null;
  /** Only for `decision`, otherwise empty. */
  alternatives: string[];
  /** Only for `problem`. */
  cause: string | null;
  solution: string | null;
  /** Qualified evidence IDs such as `S000001:E001`. */
  refs: string[];
}

/** Content of a new note. `addNote` adds `id` and `recordedAt`, and `activityDay` if it is missing. */
export interface NoteInput {
  type: NoteType;
  text: string;
  /** Default: today in the configured time zone. */
  activityDay?: string;
  time?: NoteTime | null;
  delay?: NoteDelay | null;
  reason?: string | null;
  alternatives?: string[];
  cause?: string | null;
  solution?: string | null;
  refs?: string[];
}

/** A note without the fields that `addNote` generates. */
export type NoteFields = Omit<Note, 'schemaVersion' | 'id' | 'recordedAt'>;
