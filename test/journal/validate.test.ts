import { describe, expect, it } from 'vitest';
import type { JournalOutput } from '../../src/journal/types.js';
import { validateJournalOutput } from '../../src/journal/validate.js';
import { fixedJournalInput, NOTE, validJournalOutput } from './fixtures.js';

function check(patch: Partial<JournalOutput>) {
  return validateJournalOutput(fixedJournalInput(), { ...validJournalOutput(), ...patch });
}

function errorsOf(result: ReturnType<typeof check>): string[] {
  return result.ok ? [] : result.errors;
}

describe('Validator der Journal-Ausgabe (spec.md §15, AK-07-08)', () => {
  it('akzeptiert eine regelkonforme Antwort', () => {
    const result = validateJournalOutput(fixedJournalInput(), validJournalOutput());
    expect(result).toEqual({ ok: true, value: validJournalOutput() });
  });

  it('lehnt Zeitfelder als Regelverstoss ab, bevor das Schema geprüft wird (R-07)', () => {
    const output = { ...validJournalOutput(), done: [{ text: 'Recherche', evidence: [NOTE.activity], minutes: 45 }] };
    const result = validateJournalOutput(fixedJournalInput(), output);
    expect(result).toEqual({ ok: false, errorCode: 'rule_violation', errors: ['done[0].minutes: Zeitfelder sind nicht erlaubt (R-07)'] });
    expect(errorsOf(check({ unknowns: [] }))).toEqual([]);
    const nested = validateJournalOutput(fixedJournalInput(), { ...validJournalOutput(), zeitaufwand: 3 });
    expect(nested).toMatchObject({ ok: false, errorCode: 'rule_violation' });
  });

  it('meldet Schemafehler mit schema_invalid', () => {
    expect(validateJournalOutput(fixedJournalInput(), { ...validJournalOutput(), planned: undefined })).toMatchObject({ ok: false, errorCode: 'schema_invalid' });
    expect(check({ done: [{ text: 'Ohne Beleg', evidence: [] }] })).toMatchObject({ ok: false, errorCode: 'schema_invalid' });
    expect(check({ tests: [{ description: 'Tests', result: 'grün' as 'passed', evidence: ['S000002:E006'] }] })).toMatchObject({
      ok: false,
      errorCode: 'schema_invalid',
    });
    // An unqualified snapshot ID has no place in a journal.
    expect(check({ done: [{ text: 'Änderung', evidence: ['E003'] }] })).toMatchObject({ ok: false, errorCode: 'schema_invalid' });
  });

  it('lehnt unbekannte Referenzen ab, auch Notizen anderer Tage und Belege mit unklarer Tageszuordnung (R-01)', () => {
    const otherDay = check({ insights: [{ text: 'Erkenntnis von gestern', evidence: ['N20261013T080000Z-9999'] }] });
    expect(otherDay).toEqual({
      ok: false,
      errorCode: 'evidence_invalid',
      errors: ['insights[0]: Beleg N20261013T080000Z-9999 steht nicht in allowedEvidenceIds (R-01)'],
    });
    const unclear = check({ done: [{ text: 'CSV-Export', evidence: ['S000004:E002'] }] });
    expect(unclear).toEqual({ ok: false, errorCode: 'evidence_invalid', errors: ['done[0]: Beleg S000004:E002 steht nicht in allowedEvidenceIds (R-01)'] });
    expect(check({ nextSteps: [{ text: 'Weiter', evidence: ['C02'] }] })).toMatchObject({ ok: false, errorCode: 'evidence_invalid' });
  });

  it('verlangt für passed oder failed einen aktuellen Testbericht mit Inhalt (R-03)', () => {
    const stale = check({ tests: [{ description: 'E2E-Tests', result: 'passed', evidence: ['S000002:E007'] }] });
    expect(stale).toEqual({
      ok: false,
      errorCode: 'rule_violation',
      errors: ['tests[0]: Ergebnis passed ohne aktuellen test_report-Beleg mit Inhalt (R-03)'],
    });
    const changedFile = check({ tests: [{ description: 'Geänderte Testdatei', result: 'failed', evidence: ['S000003:E002'] }] });
    expect(changedFile).toMatchObject({ ok: false, errorCode: 'rule_violation' });
    expect(check({ tests: [{ description: 'Unit-Tests', result: 'failed', evidence: ['S000002:E006'] }] })).toMatchObject({ ok: true });
    expect(check({ tests: [{ description: 'E2E-Tests', result: 'unknown', evidence: ['S000002:E007'] }] })).toMatchObject({ ok: true });

    const input = fixedJournalInput();
    input.evidence = input.evidence.map((entry) => (entry.ref === 'S000002:E006' ? { ...entry, omitted: true } : entry));
    const omitted = validateJournalOutput(input, { ...validJournalOutput(), tests: [{ description: 'Unit-Tests', result: 'passed', evidence: ['S000002:E006'] }] });
    expect(omitted).toMatchObject({ ok: false, errorCode: 'rule_violation' });
  });

  it('verlangt für eine Begründung eine Notiz oder eine Commit-Nachricht mit Inhalt (R-04)', () => {
    const fromDiff = check({ decisions: [{ decision: 'Service', rationale: 'Wiederverwendung', alternatives: [], evidence: ['S000002:E003'] }] });
    expect(fromDiff).toEqual({
      ok: false,
      errorCode: 'rule_violation',
      errors: ['decisions[0]: Begründung ohne Notiz- oder Commit-Nachrichten-Beleg (R-04)'],
    });
    const withheldMessage = check({ decisions: [{ decision: 'Service', rationale: 'Wiederverwendung', alternatives: [], evidence: ['S000003:E001'] }] });
    expect(withheldMessage).toMatchObject({ ok: false, errorCode: 'rule_violation' });
    expect(check({ decisions: [{ decision: 'Service', rationale: 'Wiederverwendung', alternatives: [], evidence: ['S000002:E001'] }] })).toMatchObject({ ok: true });
    expect(check({ decisions: [{ decision: 'Service', rationale: null, alternatives: [], evidence: ['S000002:E003'] }] })).toMatchObject({ ok: true });
  });

  it('verlangt für ausgeführte Arbeit einen Snapshot-Beleg mit Inhalt oder eine passende Notiz (R-06)', () => {
    const planOnly = check({ done: [{ text: 'Service geplant', evidence: [NOTE.plan, 'C01'] }] });
    expect(planOnly).toEqual({
      ok: false,
      errorCode: 'rule_violation',
      errors: ['done[0]: weder Snapshot-Beleg mit Inhalt noch Notiz vom Typ activity, general oder problem (R-06)'],
    });
    expect(check({ done: [{ text: 'Erkenntnis', evidence: [NOTE.insight] }] })).toMatchObject({ ok: false, errorCode: 'rule_violation' });
    expect(check({ done: [{ text: 'Konfiguration geändert', evidence: ['S000002:E004'] }] })).toMatchObject({ ok: false, errorCode: 'rule_violation' });
    expect(check({ done: [{ text: 'Bild ersetzt', evidence: ['S000002:E005'] }] })).toMatchObject({ ok: false, errorCode: 'rule_violation' });
    for (const ref of [NOTE.activity, NOTE.general, NOTE.problem, 'S000002:E003', 'S000002:E001']) {
      expect(check({ done: [{ text: 'Arbeit', evidence: [ref] }] }), ref).toMatchObject({ ok: true });
    }
  });

  it('nennt alle Verstösse einer Stufe und nur Positionen und IDs, keine Inhalte', () => {
    const result = check({
      done: [{ text: 'GEHEIMER TEXT', evidence: [NOTE.plan] }],
      tests: [{ description: 'GEHEIMER TEXT', result: 'passed', evidence: ['S000002:E007'] }],
    });
    expect(errorsOf(result)).toHaveLength(2);
    expect(errorsOf(result).join(' ')).not.toContain('GEHEIMER TEXT');
  });
});
