/**
 * Zeitfunktionen mit `Intl.DateTimeFormat`, ohne Zusatzbibliothek (spec.md §8.3).
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

/**
 * Kanonischer Name einer von `Intl.DateTimeFormat` akzeptierten Zeitzone, sonst `null`.
 */
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

/**
 * ISO 8601 mit Offset der Zeitzone, sekundengenau, zum Beispiel `2026-10-14T10:03:12+02:00`.
 */
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

/** Tag `YYYY-MM-DD` in der Zeitzone. */
export function dayOf(date: Date, timeZone: string): string {
  assertValidDate(date);
  const p = zonedParts(date, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** UTC-Zeit im Format `YYYYMMDDTHHMMSSZ` für Lauf- und Notiz-IDs (spec.md §8.2). */
export function formatUtcCompact(date: Date): string {
  assertValidDate(date);
  return (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}
