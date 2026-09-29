import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { askNote } from '../../src/cli/note-dialog.js';
import { IpaError } from '../../src/core/errors.js';
import { type NoteOptions, parseNoteOptions, type RawNoteOptions } from '../../src/notes/input.js';

const TODAY = '2026-10-14';

/** Runs the dialog with all answers written ahead, as a pipe delivers them. */
async function dialog(answers: string[], preset: RawNoteOptions = {}) {
  const input = new PassThrough();
  input.end(answers.map((answer) => `${answer}\n`).join(''));
  const output = new PassThrough();
  let shown = '';
  output.setEncoding('utf8');
  output.on('data', (chunk: string) => {
    shown += chunk;
  });
  const options = parseNoteOptions(preset);
  const result = await askNote({ input, output, isTTY: true }, options, { day: options.day ?? TODAY, today: TODAY });
  return { ...result, shown: () => shown };
}

/** Positions of the questions in the output, to check their order. */
function positions(shown: string, questions: string[]): number[] {
  return questions.map((question) => shown.indexOf(question));
}

const base: NoteOptions = { alternatives: [], refs: [] };

describe('Interaktive Eingabe von ipa note (Paket 04 §4, AK-04-06)', () => {
  it('fragt Typ, Text, Grund und Alternativen, Zeitaufwand und Basis in dieser Reihenfolge', async () => {
    const result = await dialog(['4', 'Validierung im Service', 'Wiederverwendung', 'Logik in der Komponente', 'Eigener Service', '', '30', 'g']);
    expect(result.text).toBe('Validierung im Service');
    expect(result.options).toEqual({
      ...base,
      type: 'decision',
      reason: 'Wiederverwendung',
      alternatives: ['Logik in der Komponente', 'Eigener Service'],
      duration: { minutes: 30, start: null, end: null },
      basis: 'measured',
    });
    const order = positions(result.shown(), ['Neue Notiz für 2026-10-14', 'Typ (', 'Text:', 'Grund', 'Geprüfte Alternative', 'Weitere Alternative', 'Zeitaufwand', 'Gemessen oder geschätzt']);
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('übernimmt mit Enter die Standardwerte und fragt ohne Zeit nicht nach der Basis', async () => {
    const result = await dialog(['', 'Nur ein Text', '']);
    expect(result).toMatchObject({ text: 'Nur ein Text', options: { ...base, type: 'general' } });
    expect(result.options.duration).toBeUndefined();
    expect(result.options.basis).toBeUndefined();
    expect(result.shown()).not.toContain('Gemessen oder geschätzt');
    expect(result.shown()).not.toContain('Grund');
  });

  it('fragt bei problem nach Ursache und Lösung, Enter lässt sie unbekannt', async () => {
    const result = await dialog(['problem', 'Mock lieferte falschen Typ; "Tests" rot – äöü', '', 'Testdaten angepasst', '20', 'geschätzt']);
    expect(result.text).toBe('Mock lieferte falschen Typ; "Tests" rot – äöü');
    expect(result.options).toMatchObject({ type: 'problem', solution: 'Testdaten angepasst', basis: 'estimated' });
    expect(result.options.cause).toBeUndefined();
    const order = positions(result.shown(), ['Text:', 'Ursache', 'Lösung', 'Zeitaufwand']);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('fragt ungültige Antworten erneut', async () => {
    const result = await dialog(['7', 'notiz', '2', '', 'Recherche', '0', 'abc', '15', 'x', 's']);
    expect(result).toMatchObject({
      text: 'Recherche',
      options: { type: 'activity', duration: { minutes: 15, start: null, end: null }, basis: 'estimated' },
    });
    const shown = result.shown();
    expect(shown.match(/Typ \(/g)).toHaveLength(3);
    expect(shown.match(/Text: /g)).toHaveLength(2);
    expect(shown.match(/Zeitaufwand/g)).toHaveLength(3);
    expect(shown.match(/Gemessen oder geschätzt/g)).toHaveLength(2);
    expect(shown).toContain('Der Text ist Pflicht.');
  });

  it('überspringt Fragen, die Optionen der Befehlszeile schon beantworten', async () => {
    const result = await dialog(['Recherche zur Testkonfiguration'], { type: 'activity', minutes: '45', measured: true, day: '2026-10-13' });
    expect(result).toMatchObject({
      text: 'Recherche zur Testkonfiguration',
      options: { type: 'activity', day: '2026-10-13', duration: { minutes: 45 }, basis: 'measured' },
    });
    const shown = result.shown();
    expect(shown).toContain('Neue Notiz für 2026-10-13');
    expect(shown).not.toContain('Typ (');
    expect(shown).not.toContain('Zeitaufwand');
    expect(shown).not.toContain('Gemessen oder geschätzt');
  });

  it('fragt die Basis auch für eine Verzögerung von der Befehlszeile', async () => {
    const result = await dialog(['', 'Warten auf Review', '', 'g'], { delay: '20' });
    expect(result.options).toMatchObject({ type: 'general', delayMinutes: 20, basis: 'measured' });
    expect(result.options.duration).toBeUndefined();
  });

  it('fragt den Typ erneut, wenn er nicht zu den Optionen passt', async () => {
    const withReason = await dialog(['1', '4', 'Validierung im Service', '', ''], { reason: 'Wiederverwendung' });
    expect(withReason.options).toMatchObject({ type: 'decision', reason: 'Wiederverwendung', alternatives: [] });
    expect(withReason.shown()).toContain('--reason und --alternative sind nur bei --type decision erlaubt.');
    expect(withReason.shown()).not.toContain('Grund (');

    const future = await dialog(['', 'plan', 'Sprint planen', ''], { day: '2026-10-20' });
    expect(future.options).toMatchObject({ type: 'plan', day: '2026-10-20' });
    expect(future.shown()).toContain('Der Tag 2026-10-20 liegt in der Zukunft.');
  });

  it('bricht ab, wenn die Eingabe endet, zum Beispiel mit Strg+D', async () => {
    // Also after an invalid answer: its question is asked again once readline has already closed.
    for (const answers of [['1'], ['1', 'Text', 'abc']]) {
      const error = await dialog(answers).catch((e: unknown) => e);
      expect(error, answers.join(' / ')).toBeInstanceOf(IpaError);
      expect(error).toMatchObject({ code: 'note_input_aborted', exitCode: 2 });
    }
  });
});
