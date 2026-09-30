/**
 * Day attribution of snapshots (spec.md §15): a snapshot belongs to day D if `observedPeriod.from` and
 * `observedPeriod.to` both lie on D in the configured time zone. A period across several days touches
 * each of them and is "unclear" there.
 */
import { dayOf } from '../core/time.js';
import type { DayAttribution } from './types.js';

export interface ObservedPeriod {
  from: string | null;
  to: string;
}

/** Day of an ISO timestamp with offset in the configured time zone. */
export function dayOfTimestamp(timestamp: string, timeZone: string): string {
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) throw new RangeError(`Kein gültiger Zeitstempel: ${timestamp}`);
  return dayOf(new Date(ms), timeZone);
}

/** First and last day of the period; without `from` (first baseline) only the day of `to`. */
export function periodDays(period: ObservedPeriod, timeZone: string): { first: string; last: string } {
  const last = dayOfTimestamp(period.to, timeZone);
  return { first: period.from === null ? last : dayOfTimestamp(period.from, timeZone), last };
}

/** Days are `YYYY-MM-DD`, so their string order is the calendar order. */
export function touchesDay(period: ObservedPeriod, day: string, timeZone: string): boolean {
  const { first, last } = periodDays(period, timeZone);
  return first <= day && day <= last;
}

/** `null` if the period does not touch the day. A period without `from` has no known start: unclear. */
export function dayAttribution(period: ObservedPeriod, day: string, timeZone: string): DayAttribution | null {
  if (!touchesDay(period, day, timeZone)) return null;
  const { first, last } = periodDays(period, timeZone);
  return period.from !== null && first === day && last === day ? 'day' : 'unclear';
}
