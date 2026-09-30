import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../src/core/config.js';
import { zonedWeekdayAndTime } from '../../src/core/time.js';
import { checkScheduleWindow, describeOutsideWindow, type ScheduleConfig } from '../../src/schedule/window.js';
import { initialTzVariable, withProcessTimeZone } from '../helpers/time-zone.js';

const DEFAULT_SCHEDULE = createDefaultConfig({ repositoryId: 'p-000000', repoPath: 'C:/p', timezone: 'Europe/Zurich' }).schedule;
const EVERY_DAY: ScheduleConfig['workdays'] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function inside(at: string, schedule: ScheduleConfig = DEFAULT_SCHEDULE, zone = 'Europe/Zurich'): boolean {
  return checkScheduleWindow(new Date(at), zone, schedule).inside;
}

describe('Fensterprüfung für capture --scheduled (AK-08-01, AK-08-02)', () => {
  it('liegt am Samstag und um 07:59 in Europe/Zurich ausserhalb, am Dienstag um 10:00 innerhalb', () => {
    // 2026-10-03 is a Saturday, 2026-10-06 a Tuesday; summer time, UTC+2.
    expect(checkScheduleWindow(new Date('2026-10-03T08:00:00Z'), 'Europe/Zurich', DEFAULT_SCHEDULE)).toEqual({
      inside: false,
      weekday: 'sat',
      time: '10:00',
      reason: 'weekday',
    });
    expect(checkScheduleWindow(new Date('2026-10-06T05:59:00Z'), 'Europe/Zurich', DEFAULT_SCHEDULE)).toEqual({
      inside: false,
      weekday: 'tue',
      time: '07:59',
      reason: 'time',
    });
    expect(checkScheduleWindow(new Date('2026-10-06T08:00:00Z'), 'Europe/Zurich', DEFAULT_SCHEDULE)).toEqual({
      inside: true,
      weekday: 'tue',
      time: '10:00',
      reason: null,
    });
  });

  it('schliesst windowStart und windowEnd ein und vergleicht ganze Minuten', () => {
    expect(inside('2026-10-06T06:00:00Z')).toBe(true); // 08:00
    expect(inside('2026-10-06T05:59:59Z')).toBe(false); // 07:59:59
    expect(inside('2026-10-06T16:00:59Z')).toBe(true); // 18:00:59, a run triggered at 18:00
    expect(inside('2026-10-06T16:01:00Z')).toBe(false); // 18:01
    // The extra run at 17:45 lies inside the default window.
    expect(inside('2026-10-06T15:45:00Z')).toBe(true);
  });

  it('bestimmt den Wochentag in der konfigurierten Zeitzone, nicht in UTC', () => {
    // Monday 00:30 in Zurich is still Sunday in UTC.
    const allDay = { ...DEFAULT_SCHEDULE, windowStart: '00:00', windowEnd: '23:59' };
    expect(inside('2026-10-04T22:30:00Z', allDay)).toBe(true);
    expect(inside('2026-10-04T22:30:00Z', allDay, 'UTC')).toBe(false);
  });

  it('beschreibt einen Lauf ausserhalb des Fensters auf Deutsch, ohne Inhalte', () => {
    const check = checkScheduleWindow(new Date('2026-10-03T05:59:00Z'), 'Europe/Zurich', DEFAULT_SCHEDULE);
    expect(describeOutsideWindow(check, 'Europe/Zurich', DEFAULT_SCHEDULE)).toBe(
      'Ausserhalb des Zeitfensters (Samstag, 07:59 in Europe/Zurich: kein Arbeitstag; Fenster Mo, Di, Mi, Do, Fr 08:00–18:00). ' +
        'Kein Lauf; protokolliert in runs.jsonl.',
    );
  });
});

describe('Fensterprüfung unabhängig von der Prozesszeitzone (AK-08-03)', () => {
  afterEach(() => {
    // Guards against a test that left a different process time zone behind.
    expect(process.env['TZ']).toBe(initialTzVariable);
  });

  const cases: { name: string; at: string; schedule: ScheduleConfig; expected: boolean }[] = [
    { name: 'Dienstag 10:00', at: '2026-10-06T08:00:00Z', schedule: DEFAULT_SCHEDULE, expected: true },
    { name: 'Dienstag 07:59', at: '2026-10-06T05:59:00Z', schedule: DEFAULT_SCHEDULE, expected: false },
    { name: 'Samstag 10:00', at: '2026-10-03T08:00:00Z', schedule: DEFAULT_SCHEDULE, expected: false },
    { name: 'Montag 00:30, in New York noch Sonntag', at: '2026-10-04T22:30:00Z', schedule: { ...DEFAULT_SCHEDULE, windowStart: '00:00', windowEnd: '23:59' }, expected: true },
    // Last Sunday of October: 03:00 summer time becomes 02:00 winter time, so 08:00 is 07:00 UTC.
    { name: 'Umstellung auf Winterzeit, 08:00 MEZ', at: '2026-10-25T07:00:00Z', schedule: { ...DEFAULT_SCHEDULE, workdays: EVERY_DAY }, expected: true },
    { name: 'Umstellung auf Winterzeit, 07:59 MEZ', at: '2026-10-25T06:59:00Z', schedule: { ...DEFAULT_SCHEDULE, workdays: EVERY_DAY }, expected: false },
    { name: 'Umstellung auf Winterzeit, erstes 02:30', at: '2026-10-25T00:30:00Z', schedule: { ...DEFAULT_SCHEDULE, workdays: EVERY_DAY, windowStart: '02:00', windowEnd: '02:59' }, expected: true },
    { name: 'Umstellung auf Winterzeit, zweites 02:30', at: '2026-10-25T01:30:00Z', schedule: { ...DEFAULT_SCHEDULE, workdays: EVERY_DAY, windowStart: '02:00', windowEnd: '02:59' }, expected: true },
    { name: 'Umstellung auf Winterzeit, 03:00 MEZ', at: '2026-10-25T02:00:00Z', schedule: { ...DEFAULT_SCHEDULE, workdays: EVERY_DAY, windowStart: '02:00', windowEnd: '02:59' }, expected: false },
    // Last Sunday of March: 02:00 winter time becomes 03:00 summer time, so 08:00 is 06:00 UTC.
    { name: 'Umstellung auf Sommerzeit, 08:00 MESZ', at: '2026-03-29T06:00:00Z', schedule: { ...DEFAULT_SCHEDULE, workdays: EVERY_DAY }, expected: true },
    { name: 'Umstellung auf Sommerzeit, 07:59 MESZ', at: '2026-03-29T05:59:00Z', schedule: { ...DEFAULT_SCHEDULE, workdays: EVERY_DAY }, expected: false },
    // Changeover days of the process time zone America/New_York (Sundays 8 March and 1 November 2026).
    { name: 'Umstellungstag in New York im März, 08:30 MEZ', at: '2026-03-08T07:30:00Z', schedule: { ...DEFAULT_SCHEDULE, workdays: EVERY_DAY }, expected: true },
    { name: 'Umstellungstag in New York im November, 07:59 MEZ', at: '2026-11-01T06:59:00Z', schedule: { ...DEFAULT_SCHEDULE, workdays: EVERY_DAY }, expected: false },
    { name: 'Umstellungstag in New York im November, 08:00 MEZ', at: '2026-11-01T07:00:00Z', schedule: { ...DEFAULT_SCHEDULE, workdays: EVERY_DAY }, expected: true },
  ];

  it('die Prozesszeitzone lässt sich im Testprozess tatsächlich umstellen', () => {
    const at = new Date('2026-10-06T08:00:00Z');
    expect(withProcessTimeZone('UTC', () => at.getHours())).toBe(8);
    expect(withProcessTimeZone('America/New_York', () => at.getHours())).toBe(4);
  });

  for (const testCase of cases) {
    it(`${testCase.name}: gleiches Ergebnis mit TZ=UTC und TZ=America/New_York`, () => {
      const results = ['UTC', 'America/New_York'].map((zone) =>
        withProcessTimeZone(zone, () => checkScheduleWindow(new Date(testCase.at), 'Europe/Zurich', testCase.schedule)),
      );
      expect(results[0]!.inside).toBe(testCase.expected);
      expect(results[1]).toEqual(results[0]);
    });
  }

  it('zonedWeekdayAndTime hängt nicht von TZ ab', () => {
    const at = new Date('2026-10-25T01:30:00Z');
    const expected = { weekday: 'sun', time: '02:30' };
    expect(withProcessTimeZone('UTC', () => zonedWeekdayAndTime(at, 'Europe/Zurich'))).toEqual(expected);
    expect(withProcessTimeZone('America/New_York', () => zonedWeekdayAndTime(at, 'Europe/Zurich'))).toEqual(expected);
    expect(withProcessTimeZone('Asia/Tokyo', () => zonedWeekdayAndTime(at, 'Europe/Zurich'))).toEqual(expected);
  });
});
