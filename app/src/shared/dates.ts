/** Day arithmetic in the time zone of a project (spec AD-11). Days are `YYYY-MM-DD`. */

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Today in the given IANA zone; falls back to UTC for an unknown zone. */
export function todayIn(timeZone: string | null, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone ?? 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Day of an ISO timestamp with offset in the given zone, or `null` for an invalid timestamp. */
export function dayOfTimestamp(iso: string, timeZone: string): string | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : todayIn(timeZone, new Date(ms));
}

/** `HH:MM:SS` of an ISO timestamp in the given zone, or `null` for an invalid timestamp. */
export function clockOfTimestamp(iso: string, timeZone: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(11, 19);
  }
}

/** "Mittwoch, 14. Oktober 2026" for a `YYYY-MM-DD` day (a calendar date, no zone involved). */
export function formatLongDay(day: string): string {
  return new Intl.DateTimeFormat('de-CH', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${day}T12:00:00Z`));
}

export function weekdayOf(day: string): string {
  return new Intl.DateTimeFormat('de-CH', { timeZone: 'UTC', weekday: 'long' }).format(new Date(`${day}T12:00:00Z`));
}

export function shiftDay(day: string, delta: number): string {
  if (!isDay(day)) throw new RangeError(`Ungültiger Tag: ${day}`);
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}
