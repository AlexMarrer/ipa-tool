/**
 * Working-time window of `ipa capture --scheduled` (spec.md §11.1, D-15): weekday and wall-clock time
 * in the configured time zone, never in the time zone of the process or the operating system.
 */
import type { Config, Weekday } from '../core/config.js';
import { type WeekdayName, zonedWeekdayAndTime } from '../core/time.js';

export type ScheduleConfig = Config['schedule'];

export interface WindowCheck {
  inside: boolean;
  weekday: WeekdayName;
  /** Wall-clock time `HH:MM` in the configured time zone. */
  time: string;
  /** Why the instant lies outside, or `null` inside. */
  reason: 'weekday' | 'time' | null;
}

/**
 * Inside means: the weekday is one of `schedule.workdays` and the time lies in the closed interval
 * `[windowStart, windowEnd]`. The comparison uses whole minutes, so a run triggered at 18:00 and started
 * a few seconds later still counts as inside a window ending at 18:00.
 */
export function checkScheduleWindow(instant: Date, timeZone: string, schedule: ScheduleConfig): WindowCheck {
  const { weekday, time } = zonedWeekdayAndTime(instant, timeZone);
  if (!(schedule.workdays as readonly string[]).includes(weekday)) return { inside: false, weekday, time, reason: 'weekday' };
  // `HH:MM` with leading zeros compares correctly as text.
  if (time < schedule.windowStart || time > schedule.windowEnd) return { inside: false, weekday, time, reason: 'time' };
  return { inside: true, weekday, time, reason: null };
}

const GERMAN_WEEKDAYS: Record<Weekday, string> = {
  mon: 'Montag',
  tue: 'Dienstag',
  wed: 'Mittwoch',
  thu: 'Donnerstag',
  fri: 'Freitag',
  sat: 'Samstag',
  sun: 'Sonntag',
};

const SHORT_WEEKDAYS: Record<Weekday, string> = { mon: 'Mo', tue: 'Di', wed: 'Mi', thu: 'Do', fri: 'Fr', sat: 'Sa', sun: 'So' };

/** Monday first, as in the configuration example. */
export const WEEK_ORDER: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function sortedWorkdays(schedule: ScheduleConfig): Weekday[] {
  return WEEK_ORDER.filter((day) => schedule.workdays.includes(day));
}

/** For example `Mo, Di, Mi, Do, Fr 08:00–18:00`. */
export function describeWindow(schedule: ScheduleConfig): string {
  const days = sortedWorkdays(schedule).map((day) => SHORT_WEEKDAYS[day]);
  return `${days.length === 0 ? 'keine Arbeitstage' : days.join(', ')} ${schedule.windowStart}–${schedule.windowEnd}`;
}

/** German one-line message for a run outside the window; contains no repository content. */
export function describeOutsideWindow(check: WindowCheck, timeZone: string, schedule: ScheduleConfig): string {
  const when = `${GERMAN_WEEKDAYS[check.weekday]}, ${check.time} in ${timeZone}`;
  const why = check.reason === 'weekday' ? 'kein Arbeitstag' : 'Uhrzeit ausserhalb des Zeitfensters';
  return `Ausserhalb des Zeitfensters (${when}: ${why}; Fenster ${describeWindow(schedule)}). Kein Lauf; protokolliert in runs.jsonl.`;
}
