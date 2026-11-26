import { describe, expect, it } from 'vitest';
import { LIMIT_DEFAULTS } from '../../src/shared/config';
import { SCHEDULE_STATE_TEXT, scheduleSummary, staleMessage, workdaysText } from '../../src/shared/schedule-texts';
import { defaultConfig } from '../components/fakeApi';
import { diffChanges, findingsFor, formatBytes, fromBase, getPath, integerError, pointerToPath, same, scheduleErrors, setPath, toBase } from '../../src/renderer/pages/config/draft';

describe('Entwurf der Konfiguration (AK-10-58, AK-10-68)', () => {
  it('ändert Pfade, ohne das Original zu verändern, und findet genau die Unterschiede', () => {
    const base = defaultConfig();
    const draft = setPath(setPath(base, 'claude.maxTurns', 9), 'paths.include', ['src/**']);
    expect(base.claude.maxTurns).toBe(5);
    expect(getPath(draft, 'claude.maxTurns')).toBe(9);
    expect(diffChanges(base, draft)).toEqual([
      { path: 'claude.maxTurns', value: 9 },
      { path: 'paths.include', value: ['src/**'] },
    ]);
    expect(diffChanges(base, base)).toEqual([]);
  });

  it('kennt nur Pfade, die die App ändern darf', () => {
    const base = defaultConfig();
    const draft = setPath(setPath(setPath(base, 'timezone', 'UTC'), 'repositoryId', 'x'), 'claude.command', ['x']);
    expect(diffChanges(base, draft)).toEqual([]);
  });

  it('behandelt ein fehlendes allowPaidUsage wie false', () => {
    const base = defaultConfig();
    expect(diffChanges(base, setPath(base, 'claude.allowPaidUsage', false))).toEqual([]);
    expect(diffChanges(base, setPath(base, 'claude.allowPaidUsage', true))).toEqual([{ path: 'claude.allowPaidUsage', value: true }]);
  });

  it('vergleicht tief und ordnet Befunde dem Feld zu', () => {
    expect(same({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(same({ a: [1] }, { a: [1, 2] })).toBe(false);
    expect(pointerToPath('/schedule/extraRunTimes/0')).toBe('schedule.extraRunTimes.0');
    const findings = [
      { severity: 'error' as const, code: 'x', path: '/schedule/extraRunTimes/0', message: 'a' },
      { severity: 'error' as const, code: 'x', path: '/claude/maxTurns', message: 'b' },
    ];
    expect(findingsFor(findings, 'schedule.extraRunTimes').map((entry) => entry.message)).toEqual(['a']);
    expect(findingsFor(findings, 'claude')).toHaveLength(1);
    expect(findingsFor(findings, 'claude.maxTurns')).toHaveLength(1);
    expect(findingsFor(findings, 'schedule')).toHaveLength(1);
    expect(findingsFor(findings, 'sched')).toHaveLength(0);
  });
});

describe('Zahlenfelder und Einheiten (AK-10-64)', () => {
  it('meldet ungültige ganze Zahlen im Wortlaut des Designs', () => {
    expect(integerError('Versuche pro Snapshot', '0', 1)).toBe('Versuche pro Snapshot: ganze Zahl, mindestens 1. Der Wert 0 ist nicht erlaubt.');
    expect(integerError('X', '3', 1)).toBeNull();
    expect(integerError('X', '', 1)).toContain('keine ganze Zahl');
    expect(integerError('X', '1.5', 1)).toContain('keine ganze Zahl');
    expect(integerError('X', '1441', 1, 1440)).toContain('höchstens 1440');
    expect(integerError('X', '0', 0)).toBeNull();
  });

  it('rechnet KiB und MiB exakt in Bytes und zurück', () => {
    expect(toBase('256', 'KiB')).toBe(262_144);
    expect(toBase('1.5', 'MiB')).toBe(1_572_864);
    expect(toBase('0.5', 'KiB')).toBe(512);
    expect(toBase('10', 'MiB')).toBe(10_485_760);
    expect(toBase('1,5', 'KiB')).toBe(1536);
    expect(toBase('0.0001', 'KiB')).toBeNull();
    expect(toBase('abc', 'B')).toBeNull();
    expect(toBase('-1', 'B')).toBeNull();
    expect(fromBase(262_144, 'KiB')).toBe('256');
    expect(fromBase(1_572_864, 'MiB')).toBe('1.5');
    for (const value of Object.values(LIMIT_DEFAULTS)) expect(toBase(fromBase(value, 'B'), 'B')).toBe(value);
    for (const bytes of [1, 1023, 1024, 262_144, 10_485_760, 123_457]) {
      const unit = bytes % 1_048_576 === 0 ? 'MiB' : bytes % 1_024 === 0 ? 'KiB' : 'B';
      expect(toBase(fromBase(bytes, unit), unit)).toBe(bytes);
    }
    expect(formatBytes(262_144)).toBe('256 KiB');
    expect(formatBytes(10_485_760)).toBe('10 MiB');
    expect(formatBytes(1500)).toBe('1500 B');
  });
});

describe('Formular des Zeitplans (AK-10-53)', () => {
  const ok = { workdays: ['mon'], windowStart: '08:00', windowEnd: '18:00', intervalMinutes: '120', extraRunTimes: ['17:45'] };

  it('akzeptiert ein gültiges Formular', () => {
    expect(scheduleErrors(ok).any).toBe(false);
  });

  it('prüft jeden Fehlerfall mit dem Text des Designs', () => {
    expect(scheduleErrors({ ...ok, workdays: [] }).workdays).toBe('Mindestens ein Arbeitstag nötig. Ohne Arbeitstage lässt sich der Zeitplan nicht speichern.');
    expect(scheduleErrors({ ...ok, windowStart: '8.00' }).windowStart).toBe('Beginn «8.00» ist keine gültige Uhrzeit. Bitte im Format HH:MM eingeben, zum Beispiel 08:00.');
    expect(scheduleErrors({ ...ok, windowEnd: '24:00' }).windowEnd).toContain('Ende «24:00» ist keine gültige Uhrzeit');
    expect(scheduleErrors({ ...ok, windowStart: '18:00', windowEnd: '08:00' }).windowEnd).toBe('Das Ende muss nach dem Beginn liegen.');
    expect(scheduleErrors({ ...ok, windowStart: '08:00', windowEnd: '08:00' }).windowEnd).toBe('Das Ende muss nach dem Beginn liegen.');
    for (const bad of ['0', '', 'x', '1.5', '-5', '1441']) expect(scheduleErrors({ ...ok, intervalMinutes: bad }).intervalMinutes, bad).toBe('Das Intervall muss eine ganze Zahl über 0 sein (Minuten).');
    expect(scheduleErrors({ ...ok, extraRunTimes: ['25:30'] }).extraRunTimes).toBe('Zusatzlauf «25:30» ist keine gültige Uhrzeit. Erlaubt sind 00:00 bis 23:59.');
    expect(scheduleErrors({ ...ok, extraRunTimes: ['09:00', '09:00'] }).extraRunTimes).toBeDefined();
    expect(scheduleErrors({ ...ok, workdays: [], intervalMinutes: '0' }).any).toBe(true);
  });
});

describe('Texte des Zeitplans (AK-10-52)', () => {
  it('hat zu jedem Zustand Beschriftung und Satz', () => {
    expect(Object.keys(SCHEDULE_STATE_TEXT).sort()).toEqual(['active', 'error', 'not_installed', 'paused', 'stale']);
    expect(SCHEDULE_STATE_TEXT.paused).toMatchObject({ label: 'Pausiert', text: 'Es werden keine Läufe ausgelöst, bis du fortsetzt.' });
  });

  it('nennt alle fünf Abweichungen in Klartext und fällt bei unbekannten auf den Namen zurück', () => {
    expect(staleMessage(['node_path', 'cli_path', 'arguments', 'triggers', 'execution_time_limit'])).toContain('(Pfad zu Node, Pfad zu cli.js, Argumente, Trigger, Zeitlimit)');
    expect(staleMessage(['neu'])).toContain('(neu)');
  });

  it('fasst die Arbeitstage und den Plan zusammen', () => {
    expect(workdaysText(['fri', 'mon', 'tue', 'wed', 'thu'])).toBe('Montag bis Freitag');
    expect(workdaysText(['mon', 'wed'])).toBe('Montag und Mittwoch');
    expect(workdaysText(['mon', 'tue', 'sat'])).toBe('Montag, Dienstag und Samstag');
    expect(workdaysText(['sat'])).toBe('Samstag');
    expect(scheduleSummary({ workdays: ['mon', 'tue', 'wed', 'thu', 'fri'], windowStart: '08:00', windowEnd: '18:00', intervalMinutes: 120, extraRunTimes: ['17:45'] }, 'Europe/Zurich', 35)).toBe(
      'Montag bis Freitag, 08:00 bis 18:00 · Europe/Zurich · Alle 120 Minuten, zusätzlich 17:45. Höchstens 35 Claude-Aufrufe pro Arbeitstag.',
    );
  });
});
