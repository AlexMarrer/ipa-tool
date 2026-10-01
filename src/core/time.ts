/**
 * Time functions on `Intl.DateTimeFormat` without extra libraries (spec.md §8.3).
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    if (part === undefined) {
      throw new RangeError(`Zeitteil ${type} fehlt für Zeitzone ${timeZone}`);
    }
    return Number(part.value);
  };
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: pick('second'),
  };
}

function assertValidDate(date: Date): void {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Ungültiges Datum');
  }
}

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

/** Canonical name of a time zone that `Intl.DateTimeFormat` accepts, otherwise `null`. */
export function canonicalTimeZone(timeZone: string): string | null {
  if (timeZone.trim() === '') return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  return canonicalTimeZone(timeZone) !== null;
}

/** ISO 8601 with the zone offset, in seconds, for example `2026-10-14T10:03:12+02:00`. */
export function formatZoned(date: Date, timeZone: string): string {
  assertValidDate(date);
  const epochSeconds = Math.floor(date.getTime() / 1000) * 1000;
  const p = zonedParts(new Date(epochSeconds), timeZone);
  const wallClockAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offsetMinutes = Math.round((wallClockAsUtc - epochSeconds) / 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  return (
    `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}` +
    `T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}

export function dayOf(date: Date, timeZone: string): string {
  assertValidDate(date);
  const p = zonedParts(date, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** Index 0 is Sunday, as in `Date.prototype.getUTCDay`. */
export const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type WeekdayName = (typeof WEEKDAY_NAMES)[number];

/** Weekday and wall-clock time `HH:MM` in the given zone, independent of the process time zone. */
export function zonedWeekdayAndTime(date: Date, timeZone: string): { weekday: WeekdayName; time: string } {
  assertValidDate(date);
  const p = zonedParts(date, timeZone);
  const weekday = WEEKDAY_NAMES[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()]!;
  return { weekday, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

const DAY_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

/** `YYYY-MM-DD` that names an existing calendar day, for example not `2026-02-30`. */
export function isValidDay(value: string): boolean {
  const match = DAY_PATTERN.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(0);
  // setUTCFullYear keeps years below 100 as they are, unlike Date.UTC.
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** `YYYYMMDDTHHMMSSZ` in UTC for run and note IDs (spec.md §8.2). */
export function formatUtcCompact(date: Date): string {
  assertValidDate(date);
  return (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}
