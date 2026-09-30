/**
 * Validation of Claude's answer (spec.md §13.3 step 7, §15): schema, then R-01, then R-02 to R-05.
 * R-07 is checked first so that a time field counts as a rule violation, not as a schema error.
 */
import { formatIssues, validate } from '../core/schemas.js';
import type { AnalysisInput, AnalysisOutput, InputEvidence } from './types.js';

export type AnalysisValidation =
  | { ok: true; value: AnalysisOutput }
  | { ok: false; errorCode: 'schema_invalid' | 'evidence_invalid' | 'rule_violation'; errors: string[] };

// Words of a key that name a time or duration (R-07); keys are split at camel case, `_` and `-`.
const TIME_WORDS = new Set([
  'time',
  'times',
  'minute',
  'minutes',
  'hour',
  'hours',
  'second',
  'seconds',
  'duration',
  'date',
  'dauer',
  'zeit',
  'zeiten',
  'zeitaufwand',
  'minuten',
  'stunde',
  'stunden',
  'datum',
]);

function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter((word) => word !== '');
}

function collectTimeKeys(value: unknown, at: string, found: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectTimeKeys(item, `${at}[${index}]`, found));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    const location = at === '' ? key : `${at}.${key}`;
    if (keyWords(key).some((word) => TIME_WORDS.has(word))) found.push(location);
    collectTimeKeys(child, location, found);
  }
}

/** Positions of all keys that name a time or duration (R-07); shared with the journal validator. */
export function timeFieldPaths(value: unknown): string[] {
  const found: string[] = [];
  collectTimeKeys(value, '', found);
  return found;
}

interface ClaimRef {
  at: string;
  evidence: string[];
}

function claims(output: AnalysisOutput): ClaimRef[] {
  return [
    { at: 'summary', evidence: output.summary.evidence },
    ...output.implemented.map((item, index) => ({ at: `implemented[${index}]`, evidence: item.evidence })),
    ...output.decisions.map((item, index) => ({ at: `decisions[${index}]`, evidence: item.evidence })),
    ...output.problems.map((item, index) => ({ at: `problems[${index}]`, evidence: item.evidence })),
    ...output.tests.map((item, index) => ({ at: `tests[${index}]`, evidence: item.evidence })),
    ...output.contradictions.map((item, index) => ({ at: `contradictions[${index}]`, evidence: item.evidence })),
  ];
}

/** A unit with content: neither omitted nor binary (spec.md §9.4). */
function withContent(entry: InputEvidence): boolean {
  return entry.omitted === null && !entry.binary && entry.content !== null;
}

/** spec.md §10. Messages name positions and IDs only, never content of the answer. */
export function validateAnalysisOutput(input: AnalysisInput, output: unknown): AnalysisValidation {
  const times = timeFieldPaths(output);
  if (times.length > 0) {
    return { ok: false, errorCode: 'rule_violation', errors: times.map((at) => `${at}: Zeitfelder sind nicht erlaubt (R-07)`) };
  }

  const schema = validate('analysis-output', output);
  if (!schema.ok) return { ok: false, errorCode: 'schema_invalid', errors: [formatIssues(schema.issues)] };
  const value = output as AnalysisOutput;

  const allowed = new Set(input.allowedEvidenceIds);
  const unknown: string[] = [];
  for (const claim of claims(value)) {
    for (const id of claim.evidence) {
      if (!allowed.has(id)) unknown.push(`${claim.at}: Beleg ${id} steht nicht in allowedEvidenceIds (R-01)`);
    }
  }
  if (unknown.length > 0) return { ok: false, errorCode: 'evidence_invalid', errors: unknown };

  const evidence = new Map(input.evidence.map((entry) => [entry.id, entry]));
  const noteIds = new Set(input.notes.map((note) => note.id));
  const cited = (ids: string[], accept: (entry: InputEvidence) => boolean) =>
    ids.some((id) => {
      const entry = evidence.get(id);
      return entry !== undefined && accept(entry);
    });

  const violations: string[] = [];
  value.implemented.forEach((item, index) => {
    if (!cited(item.evidence, (entry) => entry.kind === 'state_delta' && withContent(entry))) {
      violations.push(`implemented[${index}]: zitiert keinen state_delta-Beleg mit Inhalt (R-02)`);
    }
  });
  value.tests.forEach((item, index) => {
    if (item.result === 'unknown') return;
    if (!cited(item.evidence, (entry) => entry.kind === 'test_report' && entry.fresh && withContent(entry))) {
      violations.push(`tests[${index}]: Ergebnis ${item.result} ohne aktuellen test_report-Beleg mit Inhalt (R-03)`);
    }
  });
  value.decisions.forEach((item, index) => {
    if (item.rationale === null) return;
    const supported =
      item.evidence.some((id) => noteIds.has(id)) || cited(item.evidence, (entry) => entry.kind === 'commit_message' && withContent(entry));
    if (!supported) violations.push(`decisions[${index}]: Begründung ohne Notiz- oder Commit-Nachrichten-Beleg (R-04)`);
  });
  value.contradictions.forEach((item, index) => {
    if (new Set(item.evidence).size < 2) violations.push(`contradictions[${index}]: weniger als zwei verschiedene Belege (R-05)`);
  });
  if (violations.length > 0) return { ok: false, errorCode: 'rule_violation', errors: violations };
  return { ok: true, value };
}
