import { describe, expect, it } from 'vitest';
import type { AnalysisOutput } from '../../src/analysis/types.js';
import { validateAnalysisOutput } from '../../src/analysis/validate.js';
import { validate } from '../../src/core/schemas.js';
import { fixedInput, fixedManifest, NOTE_ID, validOutput } from './fixtures.js';

function check(change: (output: AnalysisOutput) => void) {
  const output = validOutput();
  change(output);
  return validateAnalysisOutput(fixedInput(), output);
}

describe('validateAnalysisOutput (spec.md §15, AK-06-05)', () => {
  it('akzeptiert eine Antwort, die alle Regeln erfüllt', () => {
    expect(validate('manifest', fixedManifest())).toEqual({ ok: true });
    expect(validate('analysis-input', fixedInput())).toEqual({ ok: true });
    expect(validateAnalysisOutput(fixedInput(), validOutput())).toEqual({ ok: true, value: validOutput() });
  });

  it('meldet Schemafehler als schema_invalid', () => {
    const missing = validOutput() as Partial<AnalysisOutput>;
    delete missing.unknowns;
    expect(validateAnalysisOutput(fixedInput(), missing)).toMatchObject({ ok: false, errorCode: 'schema_invalid' });
    expect(validateAnalysisOutput(fixedInput(), 'kein Objekt')).toMatchObject({ ok: false, errorCode: 'schema_invalid' });
    expect(check((output) => (output.tests[0]!.result = 'bestanden' as 'passed'))).toMatchObject({ errorCode: 'schema_invalid' });
    expect(check((output) => (output.summary.evidence = []))).toMatchObject({ errorCode: 'schema_invalid' });
    // Qualified IDs of earlier snapshots are not local evidence IDs.
    expect(check((output) => (output.summary.evidence = ['S000001:E002']))).toMatchObject({ errorCode: 'schema_invalid' });
  });

  it('R-01: eine ID ausserhalb von allowedEvidenceIds ergibt evidence_invalid', () => {
    expect(check((output) => output.implemented[0]!.evidence.push('E999'))).toEqual({
      ok: false,
      errorCode: 'evidence_invalid',
      errors: ['implemented[0]: Beleg E999 steht nicht in allowedEvidenceIds (R-01)'],
    });
    expect(check((output) => (output.summary.evidence = ['C02']))).toMatchObject({ errorCode: 'evidence_invalid' });
    expect(check((output) => (output.contradictions[0]!.evidence = ['N20991231T000000Z-ffff', 'E003']))).toMatchObject({
      errorCode: 'evidence_invalid',
    });
  });

  it('R-02: implemented braucht einen state_delta-Beleg mit Inhalt', () => {
    expect(check((output) => (output.implemented[0]!.evidence = ['E003']))).toMatchObject({ ok: true });
    for (const evidence of [['E001'], ['E004'], ['E005'], [NOTE_ID, 'C01']]) {
      const result = check((output) => (output.implemented[0]!.evidence = evidence));
      expect(result, evidence.join(',')).toEqual({
        ok: false,
        errorCode: 'rule_violation',
        errors: ['implemented[0]: zitiert keinen state_delta-Beleg mit Inhalt (R-02)'],
      });
    }
  });

  it('R-03: passed oder failed braucht einen aktuellen test_report mit Inhalt; unknown nicht', () => {
    expect(check((output) => (output.tests[0]!.result = 'failed'))).toMatchObject({ ok: true });
    for (const evidence of [['E007'], ['E003'], [NOTE_ID]]) {
      const result = check((output) => (output.tests[0]!.evidence = evidence));
      expect(result, evidence.join(',')).toMatchObject({ ok: false, errorCode: 'rule_violation' });
    }
    expect(check((output) => output.tests.push({ description: 'Alt', result: 'unknown', evidence: ['E003'] }))).toMatchObject({ ok: true });
  });

  it('R-04: eine Begründung braucht einen Notiz- oder Commit-Nachrichten-Beleg', () => {
    expect(check((output) => (output.decisions[0]!.evidence = ['E001']))).toMatchObject({ ok: true });
    expect(check((output) => (output.decisions[0]!.evidence = ['E003']))).toEqual({
      ok: false,
      errorCode: 'rule_violation',
      errors: ['decisions[0]: Begründung ohne Notiz- oder Commit-Nachrichten-Beleg (R-04)'],
    });
    expect(check((output) => (output.decisions[0]!.evidence = ['C01']))).toMatchObject({ errorCode: 'rule_violation' });
    expect(
      check((output) => {
        output.decisions[0]!.evidence = ['E003'];
        output.decisions[0]!.rationale = null;
      }),
    ).toMatchObject({ ok: true });
  });

  it('R-05: ein Widerspruch braucht zwei verschiedene Belege', () => {
    expect(check((output) => (output.contradictions[0]!.evidence = ['E003', 'E003']))).toEqual({
      ok: false,
      errorCode: 'rule_violation',
      errors: ['contradictions[0]: weniger als zwei verschiedene Belege (R-05)'],
    });
    expect(check((output) => (output.contradictions[0]!.evidence = ['E003']))).toMatchObject({ errorCode: 'schema_invalid' });
  });

  it('R-07: Zeitfelder ergeben rule_violation, auch verschachtelt', () => {
    const withMinutes = { ...validOutput(), implemented: [{ ...validOutput().implemented[0]!, minutes: 45 }] };
    expect(validateAnalysisOutput(fixedInput(), withMinutes)).toEqual({
      ok: false,
      errorCode: 'rule_violation',
      errors: ['implemented[0].minutes: Zeitfelder sind nicht erlaubt (R-07)'],
    });
    for (const key of ['timeSpent', 'durationMinutes', 'arbeitszeit_stunden', 'hours', 'Dauer']) {
      expect(validateAnalysisOutput(fixedInput(), { ...validOutput(), [key]: 1 }), key).toMatchObject({ errorCode: 'rule_violation' });
    }
    expect(validateAnalysisOutput(fixedInput(), { ...validOutput(), tests: [] })).toMatchObject({ ok: true });
  });

  it('prüft alle Verstösse einer Kategorie auf einmal', () => {
    const result = check((output) => {
      output.implemented[0]!.evidence = ['E001'];
      output.contradictions[0]!.evidence = ['E001', 'E001'];
    });
    expect(result).toMatchObject({ ok: false, errorCode: 'rule_violation' });
    expect(result.ok ? [] : result.errors).toHaveLength(2);
  });
});
