import { describe, expect, it } from 'vitest';
import { canonicalTimeZone, dayOf, formatUtcCompact, formatZoned, isValidTimeZone } from '../../src/core/time.js';

const ZURICH = 'Europe/Zurich';
const at = (iso: string): Date => new Date(iso);

describe('Zeitfunktionen (AK-01-11)', () => {
  it('liefert im Sommer +02:00 und im Winter +01:00', () => {
    expect(formatZoned(at('2026-07-15T08:03:12Z'), ZURICH)).toBe('2026-07-15T10:03:12+02:00');
    expect(formatZoned(at('2026-01-15T08:03:12Z'), ZURICH)).toBe('2026-01-15T09:03:12+01:00');
  });

  it('behandelt die Umstellung auf Sommerzeit am 29. März 2026', () => {
    expect(formatZoned(at('2026-03-29T00:59:59Z'), ZURICH)).toBe('2026-03-29T01:59:59+01:00');
    expect(formatZoned(at('2026-03-29T01:00:00Z'), ZURICH)).toBe('2026-03-29T03:00:00+02:00');
    expect(dayOf(at('2026-03-29T01:00:00Z'), ZURICH)).toBe('2026-03-29');
  });

  it('behandelt die Umstellung auf Winterzeit am 25. Oktober 2026', () => {
    expect(formatZoned(at('2026-10-25T00:59:59Z'), ZURICH)).toBe('2026-10-25T02:59:59+02:00');
    expect(formatZoned(at('2026-10-25T01:00:00Z'), ZURICH)).toBe('2026-10-25T02:00:00+01:00');
    expect(dayOf(at('2026-10-25T01:30:00Z'), ZURICH)).toBe('2026-10-25');
  });

  it('wechselt den Tag um Mitternacht der Zeitzone, nicht um Mitternacht UTC', () => {
    expect(dayOf(at('2026-06-30T21:59:59Z'), ZURICH)).toBe('2026-06-30');
    expect(dayOf(at('2026-06-30T22:00:00Z'), ZURICH)).toBe('2026-07-01');
    expect(formatZoned(at('2026-06-30T22:00:00Z'), ZURICH)).toBe('2026-07-01T00:00:00+02:00');
    expect(dayOf(at('2026-12-31T22:59:59Z'), ZURICH)).toBe('2026-12-31');
    expect(dayOf(at('2026-12-31T23:00:00Z'), ZURICH)).toBe('2027-01-01');
    expect(formatZoned(at('2026-12-31T23:00:00Z'), ZURICH)).toBe('2027-01-01T00:00:00+01:00');
  });

  it('schneidet Millisekunden ab und kennt andere Zonen', () => {
    expect(formatZoned(at('2026-10-14T08:03:12.999Z'), ZURICH)).toBe('2026-10-14T10:03:12+02:00');
    expect(formatZoned(at('2026-10-14T08:03:12Z'), 'UTC')).toBe('2026-10-14T08:03:12+00:00');
    expect(formatZoned(at('2026-10-14T08:03:12Z'), 'America/New_York')).toBe('2026-10-14T04:03:12-04:00');
    expect(formatZoned(at('2026-10-14T08:03:12Z'), 'Asia/Kathmandu')).toBe('2026-10-14T13:48:12+05:45');
  });

  it('lehnt ungültige Daten ab', () => {
    expect(() => formatZoned(new Date(Number.NaN), ZURICH)).toThrow(RangeError);
    expect(() => dayOf(new Date(Number.NaN), ZURICH)).toThrow(RangeError);
  });

  it('prüft und normalisiert Zeitzonen', () => {
    expect(isValidTimeZone(ZURICH)).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(canonicalTimeZone('europe/zurich')).toBe(ZURICH);
  });

  it('formatiert die UTC-Zeit für IDs', () => {
    expect(formatUtcCompact(at('2026-10-14T08:03:12.500Z'))).toBe('20261014T080312Z');
  });
});
