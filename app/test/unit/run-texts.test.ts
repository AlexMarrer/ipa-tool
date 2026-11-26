import { describe, expect, it } from 'vitest';
import { EXIT_CODE_MESSAGES } from '../../src/shared/messages';
import type { RunResultView, RunSummary } from '../../src/shared/run';
import { describeCapture, describeRun } from '../../src/shared/run-texts';

const summary = (overrides: Partial<RunSummary> = {}): RunSummary => ({
  command: 'capture',
  exitCode: 0,
  outcome: 'ok',
  runId: 'R1',
  errors: [],
  warnings: [],
  output: '',
  failure: null,
  cancelled: false,
  result: null,
  lock: null,
  ...overrides,
});

const capture = (overrides: Partial<Extract<RunResultView, { kind: 'capture' }>> = {}): RunResultView => ({
  kind: 'capture',
  capture: 'created',
  snapshot: { id: 'S000002', commits: 2, evidence: 12, fileStates: 5 },
  outsideWindow: false,
  analysis: { claudeCalls: 1, completed: [{ snapshotId: 'S000002', mode: 'ai' }], failed: [], open: [] },
  retry: null,
  halt: null,
  ...overrides,
});

describe('Klartexte der Läufe (§8.7, §9.1)', () => {
  it('hat für jeden Exit-Code von 0 bis 7 einen Text mit nächstem Schritt', () => {
    for (let code = 0; code <= 7; code++) {
      const text = describeRun(summary({ exitCode: code, outcome: code === 0 ? 'ok' : 'error' }));
      expect(text.title, String(code)).not.toBe('');
      expect(text.text, String(code)).not.toBe('');
      expect(text.title).not.toBe('Unbekannter Exit-Code');
      if (code !== 0) expect(EXIT_CODE_MESSAGES[code]).toBeDefined();
    }
  });

  it('beschreibt Erfolg, keine neue Arbeit und Nur aufnehmen', () => {
    expect(describeRun(summary({ result: capture() }))).toMatchObject({ title: 'Lauf beendet', chip: 'Erfolg', text: 'Snapshot S000002 gespeichert und analysiert. Die Analyse ist abgeschlossen.' });
    expect(describeRun(summary({ result: capture({ analysis: null }) })).text).toBe('Snapshot S000002 gespeichert. Analyse nicht ausgeführt (Nur aufnehmen).');
    expect(describeRun(summary({ result: capture({ capture: 'unchanged', snapshot: null, analysis: null }) }))).toMatchObject({ title: 'Keine neue Arbeit', chip: 'Keine neue Arbeit', text: 'Keine neue Arbeit.' });
    const unchanged = capture({ capture: 'unchanged', snapshot: null, analysis: { claudeCalls: 1, completed: [{ snapshotId: 'S000002', mode: 'ai' }, { snapshotId: 'S000003', mode: 'deterministic' }], failed: [], open: [] } });
    expect(describeRun(summary({ result: unchanged })).text).toBe('Keine neue Arbeit. Die Analyse von S000002 wurde abgeschlossen.');
    expect(describeRun(summary({ result: capture({ outsideWindow: true, snapshot: null, analysis: null }) })).text).toContain('Ausserhalb des Zeitfensters');
  });

  it('beschreibt einen erneuten Versuch mit der Nummer', () => {
    const retried = capture({ retry: { snapshotId: 'S000002', afterAttempt: 3 }, snapshot: null });
    expect(describeRun(summary({ result: retried })).text).toBe('Die Analyse von S000002 ist abgeschlossen (Versuch 4).');
  });

  it('beschreibt Journal, Notiz, Überspringen, Ausgangspunkt und Prüfen', () => {
    const journal = (mode: 'ai' | 'no_ai' | null): RunResultView => ({ kind: 'journal', day: '2026-11-26', mode, noAiReason: null, failure: null, draftWritten: mode !== null });
    expect(describeRun(summary({ result: journal('ai') })).text).toBe('Journal-Entwurf für 2026-11-26 gespeichert (KI-Entwurf).');
    expect(describeRun(summary({ result: journal('no_ai') })).text).toBe('Journal-Entwurf für 2026-11-26 gespeichert (ohne KI).');
    expect(describeRun(summary({ result: journal(null) })).text).toBe('Für 2026-11-26 gab es nichts zu schreiben.');
    const note: RunResultView = { kind: 'note', noteId: 'N1', type: 'activity', activityDay: '2026-11-26', time: null, delay: null, secretFindings: [] };
    expect(describeRun(summary({ result: note })).text).toBe('Notiz gespeichert.');
    expect(describeRun(summary({ result: { kind: 'skip', snapshotId: 'S000004', previousStatus: 'failed' } })).text).toBe('S000004 übersprungen.');
    expect(describeRun(summary({ result: { kind: 'baseline', snapshotId: 'S000005', forced: false, endedHalt: null } })).text).toBe('Neuer Ausgangspunkt S000005 gesetzt.');
    const doctor: RunResultView = { kind: 'doctor', ok: true, checkedAt: 'x', git: { found: true, version: '2' }, claude: { found: true, version: '1', loggedIn: true, authMethod: 'Anmeldung' }, billing: { detected: false, allowPaidUsage: false, blocked: false, sources: [] }, findings: [] };
    expect(describeRun(summary({ result: doctor })).text).toBe('Die Voraussetzungen sind erfüllt.');
  });

  it('meldet Exit 6 als nicht abgeschlossenen KI-Schritt ohne erfundene Versuchszahl', () => {
    const failed = capture({ analysis: { claudeCalls: 1, completed: [], failed: [{ snapshotId: 'S000002', code: 'timeout' }], open: [] } });
    const text = describeRun(summary({ exitCode: 6, outcome: 'ai_failed', result: failed, errors: [{ code: 'ai_step_failed', message: 'Die Analyse von S000002 ist nicht abgeschlossen.' }] }));
    expect(text).toMatchObject({ chip: 'KI-Schritt nicht abgeschlossen', tone: 'warn' });
    expect(text.text).toContain('Snapshot S000002 ist gespeichert');
    expect(text.text).toContain('beim nächsten Lauf erneut versucht');
    expect(text.text).not.toMatch(/Versuch \d+ von/);
    expect(text.extra).toEqual(['Die Analyse von S000002 ist nicht abgeschlossen.']);
    const journal = describeRun(summary({ exitCode: 6, result: { kind: 'journal', day: '2026-11-26', mode: null, noAiReason: null, failure: { code: 'timeout' }, draftWritten: false } }));
    expect(journal.text).toContain('Es wurde kein neuer Entwurf geschrieben');
    expect(journal.text).toContain('ohne KI erzeugen');
  });

  it('nennt bei Exit 3 den Beginn des anderen Laufs', () => {
    const text = describeRun(summary({ exitCode: 3, lock: { command: 'capture', startedAt: '10:15' } }));
    expect(text).toMatchObject({ title: 'Ein anderer Lauf ist aktiv', chip: 'Nicht gestartet', tone: 'neutral' });
    expect(text.extra).toEqual(['Aktiv seit 10:15']);
  });

  it('beschreibt Abbruch und Fehler der App um das CLI', () => {
    expect(describeRun(summary({ exitCode: null, cancelled: true }))).toMatchObject({ title: 'Lauf abgebrochen', chip: 'Abgebrochen', text: 'Der nächste Lauf setzt sauber fort.' });
    expect(describeRun(summary({ exitCode: null, failure: { code: 'runtime_missing', message: 'x' } }))).toMatchObject({ chip: 'Fehler', tone: 'err', text: expect.stringContaining('Laufzeit') });
    expect(describeRun(summary({ exitCode: null }))).toMatchObject({ chip: 'Unbekannt', tone: 'warn' });
  });

  it('erklärt einen unbekannten Exit-Code nie durch Raten', () => {
    const text = describeRun(summary({ exitCode: 42, errors: [{ code: 'x', message: 'Meldung des CLI' }] }));
    expect(text).toMatchObject({ title: 'Unbekannter Exit-Code', tone: 'warn' });
    expect(text.text).toContain('Exit-Code 42');
    expect(text.extra).toEqual(['Meldung des CLI']);
  });

  it('fasst einen Lauf in einer Zeile zusammen', () => {
    const result = capture() as Extract<RunResultView, { kind: 'capture' }>;
    expect(describeCapture(result)).toBe('Snapshot S000002 gespeichert, Commits 2, Belege 12, Analyse abgeschlossen');
    expect(describeCapture({ ...result, analysis: null })).toContain('Analyse nicht ausgeführt (Nur aufnehmen)');
    expect(describeCapture({ ...result, snapshot: null, capture: 'unchanged' })).toBe('Keine neue Arbeit');
  });
});
