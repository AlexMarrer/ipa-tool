/**
 * Validation of Claude's journal answer (spec.md §13.3 step 7, §15): R-07 over the field names, then the
 * schema, then R-01, then R-03, R-04 and R-06. Messages name positions and IDs only.
 */
import { timeFieldPaths } from '../analysis/validate.js';
import { formatIssues, validate } from '../core/schemas.js';
import type { JournalEvidence, JournalInput, JournalOutput } from './types.js';

export type JournalValidation =
  | { ok: true; value: JournalOutput }
  | { ok: false; errorCode: 'schema_invalid' | 'evidence_invalid' | 'rule_violation'; errors: string[] };

/** Note types that support executed work (R-06). */
const WORK_NOTE_TYPES = new Set(['activity', 'general', 'problem']);

function citations(output: JournalOutput): { at: string; evidence: string[] }[] {
  const list = (name: keyof Omit<JournalOutput, 'unknowns'>) =>
    output[name].map((item, index) => ({ at: `${name}[${index}]`, evidence: item.evidence }));
  return [
    ...list('planned'),
    ...list('done'),
    ...list('problems'),
    ...list('decisions'),
    ...list('tests'),
    ...list('deviations'),
    ...list('insights'),
    ...list('nextSteps'),
  ];
}

/** Neither omitted nor binary; a withheld commit message counts as omitted (spec.md §15). */
function withContent(entry: JournalEvidence): boolean {
  return !entry.omitted && !entry.binary;
}

export function validateJournalOutput(input: JournalInput, output: unknown): JournalValidation {
  const times = timeFieldPaths(output);
  if (times.length > 0) {
    return { ok: false, errorCode: 'rule_violation', errors: times.map((at) => `${at}: Zeitfelder sind nicht erlaubt (R-07)`) };
  }

  const schema = validate('journal-output', output);
  if (!schema.ok) return { ok: false, errorCode: 'schema_invalid', errors: [formatIssues(schema.issues)] };
  const value = output as JournalOutput;

  const allowed = new Set(input.allowedEvidenceIds);
  const unknown: string[] = [];
  for (const claim of citations(value)) {
    for (const ref of claim.evidence) {
      if (!allowed.has(ref)) unknown.push(`${claim.at}: Beleg ${ref} steht nicht in allowedEvidenceIds (R-01)`);
    }
  }
  if (unknown.length > 0) return { ok: false, errorCode: 'evidence_invalid', errors: unknown };

  const evidence = new Map(input.evidence.map((entry) => [entry.ref, entry]));
  const notes = new Map(input.notes.map((note) => [note.id, note]));
  const cites = (refs: readonly string[], accept: (entry: JournalEvidence) => boolean) =>
    refs.some((ref) => {
      const entry = evidence.get(ref);
      return entry !== undefined && accept(entry);
    });

  const violations: string[] = [];
  value.tests.forEach((item, index) => {
    if (item.result === 'unknown') return;
    if (!cites(item.evidence, (entry) => entry.kind === 'test_report' && entry.fresh === true && withContent(entry))) {
      violations.push(`tests[${index}]: Ergebnis ${item.result} ohne aktuellen test_report-Beleg mit Inhalt (R-03)`);
    }
  });
  value.decisions.forEach((item, index) => {
    if (item.rationale === null) return;
    const supported = item.evidence.some((ref) => notes.has(ref)) || cites(item.evidence, (entry) => entry.kind === 'commit_message' && withContent(entry));
    if (!supported) violations.push(`decisions[${index}]: Begründung ohne Notiz- oder Commit-Nachrichten-Beleg (R-04)`);
  });
  value.done.forEach((item, index) => {
    // allowedEvidenceIds holds only units of snapshots attributed to the day, so R-01 already keeps out unclear days.
    const supported =
      cites(item.evidence, withContent) || item.evidence.some((ref) => WORK_NOTE_TYPES.has(notes.get(ref)?.type ?? ''));
    if (!supported) violations.push(`done[${index}]: weder Snapshot-Beleg mit Inhalt noch Notiz vom Typ activity, general oder problem (R-06)`);
  });
  if (violations.length > 0) return { ok: false, errorCode: 'rule_violation', errors: violations };
  return { ok: true, value };
}
