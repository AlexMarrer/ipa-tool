import { describe, expect, it } from 'vitest';
import { dayAttribution, dayOfTimestamp, periodDays, touchesDay } from '../../src/journal/day.js';

const ZONE = 'Europe/Zurich';

describe('Tageszuordnung von Snapshots (spec.md §15)', () => {
  it('ordnet einen Snapshot dem Tag zu, wenn Beginn und Ende an diesem Tag liegen', () => {
    const period = { from: '2026-10-14T08:00:00+02:00', to: '2026-10-14T10:03:12+02:00' };
    expect(dayAttribution(period, '2026-10-14', ZONE)).toBe('day');
    expect(dayAttribution(period, '2026-10-13', ZONE)).toBeNull();
    expect(dayAttribution(period, '2026-10-15', ZONE)).toBeNull();
  });

  it('führt einen Snapshot über mehrere Tage an jedem berührten Tag als unklar (AK-07-05)', () => {
    const period = { from: '2026-10-14T16:00:00+02:00', to: '2026-10-16T09:00:00+02:00' };
    expect(periodDays(period, ZONE)).toEqual({ first: '2026-10-14', last: '2026-10-16' });
    for (const day of ['2026-10-14', '2026-10-15', '2026-10-16']) expect(dayAttribution(period, day, ZONE)).toBe('unclear');
    expect(touchesDay(period, '2026-10-13', ZONE)).toBe(false);
    expect(touchesDay(period, '2026-10-17', ZONE)).toBe(false);
  });

  it('bestimmt den Tag in der konfigurierten Zeitzone, nicht in UTC', () => {
    // 23:30 UTC is already the next day in Zurich (summer time, UTC+2).
    const period = { from: '2026-10-14T22:10:00Z', to: '2026-10-14T23:30:00Z' };
    expect(dayAttribution(period, '2026-10-15', ZONE)).toBe('day');
    expect(dayAttribution(period, '2026-10-14', ZONE)).toBeNull();
    expect(dayAttribution(period, '2026-10-14', 'UTC')).toBe('day');
  });

  it('behandelt die Umstellung auf Winterzeit korrekt', () => {
    // 25 October 2026: 03:00 summer time becomes 02:00 winter time.
    const period = { from: '2026-10-25T00:30:00+02:00', to: '2026-10-25T23:30:00+01:00' };
    expect(dayAttribution(period, '2026-10-25', ZONE)).toBe('day');
    expect(dayOfTimestamp('2026-10-25T23:30:00Z', ZONE)).toBe('2026-10-26');
  });

  it('wertet einen Zeitraum ohne Beginn nur am Tag seines Endes, dort als unklar', () => {
    const period = { from: null, to: '2026-10-14T08:00:00+02:00' };
    expect(periodDays(period, ZONE)).toEqual({ first: '2026-10-14', last: '2026-10-14' });
    expect(dayAttribution(period, '2026-10-14', ZONE)).toBe('unclear');
    expect(touchesDay(period, '2026-10-13', ZONE)).toBe(false);
  });

  it('lehnt einen ungültigen Zeitstempel ab', () => {
    expect(() => dayOfTimestamp('gestern', ZONE)).toThrow(RangeError);
  });
});
