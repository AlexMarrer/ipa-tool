import { describe, expect, it } from 'vitest';
import { changeTimeMode, changeType, checkForm, emptyForm } from '../../src/renderer/dialogs/noteForm';

const TODAY = '2026-11-26';
const form = (patch: Partial<ReturnType<typeof emptyForm>> = {}) => ({ ...emptyForm(TODAY), text: 'Etwas getan', ...patch });

describe('Formularlogik der Notiz (AK-10-45, AK-10-46)', () => {
  it('sperrt Speichern ohne Text und akzeptiert den einfachsten Fall', () => {
    expect(checkForm(emptyForm(TODAY))).toMatchObject({ blocked: 'Speichern gesperrt: Der Text fehlt.', input: null });
    expect(checkForm(form({ text: '   \n ' })).blocked).toContain('Der Text fehlt');
    expect(checkForm(form()).input).toEqual({ text: 'Etwas getan', day: TODAY });
  });

  it('übergibt Typ, Tag und Text unverändert, auch mit führendem Strich und Zeilenumbruch', () => {
    const text = '--force "x"\nzweite Zeile';
    expect(checkForm(form({ text, type: 'activity' })).input).toEqual({ text, type: 'activity', day: TODAY });
  });

  it('verlangt gemessen oder geschätzt, sobald Zeit oder Verzögerung angegeben ist', () => {
    for (const patch of [{ minutes: '30' }, { delay: '5' }, { timeMode: 'range' as const, start: '09:00', end: '10:00' }]) {
      const check = checkForm(form(patch));
      expect(check.needsBasis).toBe(true);
      expect(check.blocked, JSON.stringify(patch)).toBe('Speichern gesperrt: Zeit ohne Basis');
    }
    expect(checkForm(form({ minutes: '30', basis: 'measured' })).input).toMatchObject({ minutes: 30, timeKind: 'measured' });
    expect(checkForm(form()).needsBasis).toBe(false);
  });

  it('rechnet Von–bis, prüft Format und Reihenfolge und sendet entweder Minuten oder Zeiten', () => {
    const ok = checkForm(form({ timeMode: 'range', start: '09:10', end: '09:55', basis: 'measured' }));
    expect(ok.computed).toBe(45);
    expect(ok.input).toEqual({ text: 'Etwas getan', day: TODAY, start: '09:10', end: '09:55', timeKind: 'measured' });
    expect(ok.input).not.toHaveProperty('minutes');
    expect(checkForm(form({ timeMode: 'range', start: '9:10', end: '09:55', basis: 'measured' })).errors.start).toBe('Uhrzeit als HH:MM eingeben');
    expect(checkForm(form({ timeMode: 'range', start: '10:00', end: '10:00', basis: 'measured' })).errors.end).toBe('Ende muss nach dem Beginn liegen');
    expect(checkForm(form({ timeMode: 'range', start: '10:00', basis: 'measured' })).errors.end).toBeDefined();
    expect(checkForm(form({ minutes: '0', basis: 'measured' })).errors.minutes).toBeDefined();
    expect(checkForm(form({ minutes: '1.5', basis: 'measured' })).errors.minutes).toBeDefined();
    expect(checkForm(form({ minutes: '1441', basis: 'measured' })).errors.minutes).toBeDefined();
  });

  it('kennt Dauer und Von–bis nie gleichzeitig', () => {
    const range = changeTimeMode(form({ minutes: '30' }), 'range');
    expect(range.minutes).toBe('');
    const duration = changeTimeMode({ ...range, start: '09:00', end: '10:00' }, 'duration');
    expect(duration).toMatchObject({ start: '', end: '' });
  });

  it('entfernt beim Typwechsel die Zusatzfelder und setzt einen Zukunftstag ausser bei Planung zurück', () => {
    const decision = form({ type: 'decision', reason: 'Weil', alternatives: ['A'] });
    expect(changeType(decision, 'problem', TODAY)).toMatchObject({ reason: '', alternatives: [], type: 'problem' });
    const problem = form({ type: 'problem', cause: 'U', solution: 'L' });
    expect(changeType(problem, 'decision', TODAY)).toMatchObject({ cause: '', solution: '' });
    const future = form({ type: 'plan', day: '2026-12-01' });
    expect(changeType(future, 'plan', TODAY).day).toBe('2026-12-01');
    expect(changeType(future, 'activity', TODAY).day).toBe(TODAY);
  });

  it('sendet Zusatzfelder nur beim passenden Typ und lässt leere weg', () => {
    expect(checkForm(form({ type: 'decision', reason: ' Weil ', alternatives: ['A', ' ', 'B'] })).input).toMatchObject({ reason: 'Weil', alternatives: ['A', 'B'] });
    expect(checkForm(form({ type: 'problem', cause: 'U', solution: '' })).input).toMatchObject({ cause: 'U' });
    expect(checkForm(form({ type: 'problem', cause: 'U', solution: '' })).input).not.toHaveProperty('solution');
    // Values of another type never reach the command, even if they were still set.
    expect(checkForm(form({ type: 'activity', reason: 'Weil', cause: 'U' })).input).not.toHaveProperty('reason');
  });

  it('lehnt Texte über der Grenze von 8000 Zeichen und zu viele Belege ab', () => {
    expect(checkForm(form({ text: 'x'.repeat(8000) })).input).not.toBeNull();
    expect(checkForm(form({ text: 'x'.repeat(8001) })).blocked).toBe('Speichern gesperrt: Der Text ist zu lang.');
    expect(checkForm(form({ refs: Array.from({ length: 101 }, (_, i) => `S000001:E${String(i + 1).padStart(3, '0')}`) })).blocked).toBe('Speichern gesperrt: Zu viele Belege.');
    expect(checkForm(form({ refs: ['S000002:E001'] })).input).toMatchObject({ refs: ['S000002:E001'] });
  });
});
