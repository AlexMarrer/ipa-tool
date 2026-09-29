import { describe, expect, it } from 'vitest';
import { IpaError } from '../../src/core/errors.js';
import {
  checkNoteInput,
  parseNoteOptions,
  precheckNoteOptions,
  type RawNoteOptions,
  spanMinutes,
  toNoteInput,
} from '../../src/notes/input.js';
import { NOTE_TYPES, type NoteFields, type NoteInput } from '../../src/notes/types.js';
import { createSecretMarker } from '../helpers/secrets.js';

const TODAY = '2026-10-14';

/** The path of a direct `ipa note`: syntax checks, basis, then every rule of `addNote`. */
function direct(raw: RawNoteOptions, text = 'Text'): NoteFields {
  return checkNoteInput(toNoteInput(parseNoteOptions(raw), text), TODAY);
}

/** The usage error (exit code 2) that `action` raises. */
function usageErrorOf(action: () => unknown): IpaError {
  try {
    action();
  } catch (error) {
    if (!(error instanceof IpaError)) throw error;
    expect(error.exitCode).toBe(2);
    return error;
  }
  throw new Error('Es wurde kein Fehler ausgelöst.');
}

function usageCode(action: () => unknown): string {
  return usageErrorOf(action).code;
}

const EMPTY_FIELDS = { time: null, delay: null, reason: null, alternatives: [], cause: null, solution: null, refs: [] };

describe('Optionsprüfung von ipa note (Paket 04 §4)', () => {
  it('ohne Optionen entsteht eine allgemeine Notiz für heute ohne Zeit (AK-04-01)', () => {
    expect(direct({})).toEqual({ type: 'general', text: 'Text', activityDay: TODAY, ...EMPTY_FIELDS });
  });

  it('akzeptiert die sechs Typen und lehnt andere Werte ab', () => {
    for (const type of NOTE_TYPES) {
      expect(direct({ type }).type).toBe(type);
    }
    for (const type of ['Decision', 'notiz', '', ' general']) {
      expect(usageCode(() => direct({ type }))).toBe('note_type_invalid');
    }
  });

  it('entfernt Leerzeichen am Rand, behält Anführungszeichen, Semikolon und Umlaute und lehnt leeren Text ab', () => {
    const text = 'Mock lieferte "falschen" Typ; Grösse äöü ÄÖÜ ß – ok';
    expect(direct({}, `  ${text}\t`).text).toBe(text);
    expect(usageCode(() => direct({}, ''))).toBe('note_text_empty');
    expect(usageCode(() => direct({}, ' \t\n '))).toBe('note_text_empty');
  });

  describe('Zeit (AK-04-03, D-13)', () => {
    it('--minutes mit genau einer Basis', () => {
      expect(direct({ minutes: '45', measured: true }).time).toEqual({ minutes: 45, basis: 'measured', start: null, end: null });
      expect(direct({ minutes: ' 045 ', estimated: true }).time).toEqual({ minutes: 45, basis: 'estimated', start: null, end: null });
      expect(usageCode(() => direct({ minutes: '45' }))).toBe('note_basis_missing');
      expect(usageCode(() => direct({ minutes: '45', measured: true, estimated: true }))).toBe('note_basis_conflict');
    });

    it('--minutes nur als ganze Zahl grösser als 0', () => {
      for (const minutes of ['0', '-5', '4.5', 'abc', '', '1e3', '45min', '99999999999999999999']) {
        expect(usageCode(() => direct({ minutes, measured: true })), minutes).toBe('note_minutes_invalid');
      }
    });

    it('--start und --end ergeben die Minuten', () => {
      expect(direct({ start: '09:10', end: '09:55', estimated: true }).time).toEqual({
        minutes: 45,
        basis: 'estimated',
        start: '09:10',
        end: '09:55',
      });
      expect(direct({ start: '00:00', end: '23:59', measured: true }).time?.minutes).toBe(1439);
      expect(usageCode(() => direct({ start: '09:10', end: '09:55' }))).toBe('note_basis_missing');
    });

    it('--start und --end nur zusammen, nicht mit --minutes und nur mit end nach start', () => {
      expect(usageCode(() => direct({ start: '09:10', measured: true }))).toBe('note_time_incomplete');
      expect(usageCode(() => direct({ end: '09:55', measured: true }))).toBe('note_time_incomplete');
      expect(usageCode(() => direct({ minutes: '45', start: '09:10', end: '09:55', measured: true }))).toBe('note_time_conflict');
      expect(usageCode(() => direct({ minutes: '45', end: '09:55', measured: true }))).toBe('note_time_conflict');
      expect(usageCode(() => direct({ start: '09:10', end: '09:10', measured: true }))).toBe('note_time_order');
      expect(usageCode(() => direct({ start: '09:55', end: '09:10', measured: true }))).toBe('note_time_order');
      for (const start of ['9:10', '24:00', '09:60', '0910', '09:10:00']) {
        expect(usageCode(() => direct({ start, end: '23:00', measured: true })), start).toBe('note_time_invalid');
      }
    });

    it('rechnet mit Uhrzeiten desselben Tages, ohne Sommerzeitumstellung', () => {
      expect(spanMinutes('01:30', '03:30')).toBe(120);
    });
  });

  describe('Verzögerung (AK-04-04)', () => {
    it('wird getrennt von der Zeit gespeichert und nutzt dieselbe Basis', () => {
      expect(direct({ delay: '20', estimated: true })).toMatchObject({ time: null, delay: { minutes: 20, basis: 'estimated' } });
      expect(direct({ delay: '20', minutes: '45', measured: true })).toMatchObject({
        time: { minutes: 45, basis: 'measured', start: null, end: null },
        delay: { minutes: 20, basis: 'measured' },
      });
    });

    it('verlangt eine Basis und eine ganze Zahl grösser als 0', () => {
      expect(usageCode(() => direct({ delay: '20' }))).toBe('note_basis_missing');
      expect(usageCode(() => direct({ delay: '0', estimated: true }))).toBe('note_minutes_invalid');
      expect(usageCode(() => direct({ delay: 'zwanzig', estimated: true }))).toBe('note_minutes_invalid');
    });
  });

  it('eine Basis ohne Zeit und ohne Verzögerung ist ein Bedienungsfehler', () => {
    expect(usageCode(() => direct({ measured: true }))).toBe('note_basis_without_time');
    expect(usageCode(() => direct({ estimated: true }))).toBe('note_basis_without_time');
  });

  it('--reason und --alternative nur bei decision; ohne Grund bleibt er unbekannt (AK-04-02)', () => {
    expect(direct({ type: 'decision', reason: ' Wiederverwendung ', alternative: ['A', 'B'] })).toMatchObject({
      reason: 'Wiederverwendung',
      alternatives: ['A', 'B'],
    });
    expect(direct({ type: 'decision' })).toMatchObject({ reason: null, alternatives: [] });
    expect(usageCode(() => direct({ type: 'activity', reason: 'x' }))).toBe('note_decision_fields');
    expect(usageCode(() => direct({ alternative: ['A'] }))).toBe('note_decision_fields');
    expect(usageCode(() => direct({ type: 'decision', reason: '  ' }))).toBe('note_value_empty');
    expect(usageCode(() => direct({ type: 'decision', alternative: ['A', ' '] }))).toBe('note_value_empty');
  });

  it('--cause und --solution nur bei problem', () => {
    expect(direct({ type: 'problem', cause: 'Falscher Typ', solution: 'Testdaten angepasst' })).toMatchObject({
      cause: 'Falscher Typ',
      solution: 'Testdaten angepasst',
    });
    expect(direct({ type: 'problem' })).toMatchObject({ cause: null, solution: null });
    expect(usageCode(() => direct({ type: 'decision', cause: 'x' }))).toBe('note_problem_fields');
    expect(usageCode(() => direct({ solution: 'x' }))).toBe('note_problem_fields');
    expect(usageCode(() => direct({ type: 'problem', cause: '' }))).toBe('note_value_empty');
  });

  it('--day: vergangene Tage sind erlaubt, zukünftige nur bei plan (AK-04-05)', () => {
    expect(direct({ day: '2026-10-01' }).activityDay).toBe('2026-10-01');
    expect(direct({ day: TODAY }).activityDay).toBe(TODAY);
    expect(direct({ day: '2026-10-15', type: 'plan' }).activityDay).toBe('2026-10-15');
    expect(usageCode(() => direct({ day: '2026-10-15' }))).toBe('note_day_future');
    expect(usageCode(() => direct({ day: '2027-01-01', type: 'activity' }))).toBe('note_day_future');
    for (const day of ['2026-10-1', '14.10.2026', '2026-02-30', '2026-13-01', '', 'heute']) {
      expect(usageCode(() => direct({ day })), day).toBe('note_day_invalid');
    }
  });

  it('--ref prüft nur die Syntax und speichert jeden Beleg einmal (AK-04-07)', () => {
    expect(direct({ ref: ['S000001:E001', 'S000002:E0123', 'S000001:E001'] }).refs).toEqual(['S000001:E001', 'S000002:E0123']);
    for (const ref of ['S1:E1', 'S000001', 'E001', 's000001:e001', 'S000001:E01', 'S0000001:E001']) {
      expect(usageCode(() => direct({ ref: [ref] })), ref).toBe('note_ref_invalid');
    }
  });

  it('wiederholt abgelehnte Werte nicht in der Meldung', () => {
    const marker = createSecretMarker();
    expect(usageErrorOf(() => direct({ ref: [marker] })).message).toBe('--ref erwartet einen Beleg der Form S000001:E001.');
    expect(usageErrorOf(() => direct({ ref: ['S000001:E001', ` ${marker}`] })).message).toBe(
      '--ref erwartet einen Beleg der Form S000001:E001 (Angabe 2 von 2).',
    );
    expect(usageErrorOf(() => direct({ type: marker })).message).toBe(
      'Unbekannter Notiztyp. Erlaubt sind general, activity, problem, decision, insight, plan.',
    );
    const delay = { minutes: 20, basis: marker } as unknown as NoteInput['delay'];
    expect(usageErrorOf(() => checkNoteInput({ type: 'activity', text: 'Text', delay }, TODAY)).message).not.toContain(marker);
  });

  it('prüft vor der interaktiven Eingabe nur, was ohne Antwort feststeht', () => {
    expect(() => precheckNoteOptions(parseNoteOptions({ reason: 'x', day: '2027-01-01' }), TODAY)).not.toThrow();
    expect(usageCode(() => precheckNoteOptions(parseNoteOptions({ type: 'activity', reason: 'x' }), TODAY))).toBe('note_decision_fields');
    expect(usageCode(() => precheckNoteOptions(parseNoteOptions({ type: 'general', day: '2027-01-01' }), TODAY))).toBe('note_day_future');
    expect(() => precheckNoteOptions(parseNoteOptions({ type: 'plan', day: '2027-01-01' }), TODAY)).not.toThrow();
  });
});

describe('checkNoteInput prüft auch Eingaben ohne Befehlszeile', () => {
  const input = (patch: Partial<NoteInput>): NoteInput => ({ type: 'activity', text: 'Text', ...patch });

  it('verlangt zueinander passende Minuten, Beginn und Ende sowie eine bekannte Basis', () => {
    expect(checkNoteInput(input({ time: { minutes: 45, basis: 'measured', start: '09:10', end: '09:55' } }), TODAY).time?.minutes).toBe(45);
    expect(usageCode(() => checkNoteInput(input({ time: { minutes: 30, basis: 'measured', start: '09:10', end: '09:55' } }), TODAY))).toBe(
      'note_time_mismatch',
    );
    expect(usageCode(() => checkNoteInput(input({ time: { minutes: 30, basis: 'measured', start: '09:10', end: null } }), TODAY))).toBe(
      'note_time_incomplete',
    );
    expect(usageCode(() => checkNoteInput(input({ time: { minutes: 0, basis: 'measured', start: null, end: null } }), TODAY))).toBe(
      'note_minutes_invalid',
    );
    const unknownBasis = { minutes: 20, basis: 'irgendwie' } as unknown as NoteInput['delay'];
    expect(usageCode(() => checkNoteInput(input({ delay: unknownBasis }), TODAY))).toBe('note_basis_invalid');
  });

  it('ergänzt den heutigen Tag und die leeren Felder', () => {
    expect(checkNoteInput({ type: 'insight', text: 'Erkenntnis' }, TODAY)).toEqual({
      type: 'insight',
      text: 'Erkenntnis',
      activityDay: TODAY,
      ...EMPTY_FIELDS,
    });
  });
});
