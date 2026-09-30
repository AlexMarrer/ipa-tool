/**
 * Fixed journal data for unit tests: a day with an analysed snapshot, an open one, one across two days,
 * notes of every type and one context file.
 */
import { buildJournalRecord, type RecordContent } from '../../src/journal/generate.js';
import { buildTimeSummary } from '../../src/journal/time-summary.js';
import type { JournalInput, JournalOutput, JournalRecord, JournalSource } from '../../src/journal/types.js';
import type { Note } from '../../src/notes/types.js';

export const DAY = '2026-10-14';
export const SHA_A = 'a'.repeat(40);
export const SHA_B = 'b'.repeat(40);
export const HASH = 'c'.repeat(64);

export const NOTE = {
  plan: 'N20261014T060000Z-0001',
  activity: 'N20261014T075500Z-0002',
  decision: 'N20261014T081500Z-0003',
  problem: 'N20261014T093000Z-0004',
  insight: 'N20261014T120000Z-0005',
  general: 'N20261014T150000Z-0006',
} as const;

function note(id: string, type: Note['type'], text: string, recordedAt: string, extra: Partial<Note> = {}): Note {
  return {
    schemaVersion: 1,
    id,
    type,
    text,
    activityDay: DAY,
    recordedAt,
    time: null,
    delay: null,
    reason: null,
    alternatives: [],
    cause: null,
    solution: null,
    refs: [],
    ...extra,
  };
}

export function fixedNotes(): Note[] {
  return [
    note(NOTE.plan, 'plan', 'Wortvalidierung in einen Service verschieben', '2026-10-14T08:00:00+02:00', {
      time: { minutes: 60, basis: 'estimated', start: null, end: null },
    }),
    note(NOTE.activity, 'activity', 'Recherche zur Testkonfiguration', '2026-10-14T09:55:00+02:00', {
      time: { minutes: 45, basis: 'measured', start: '09:10', end: '09:55' },
    }),
    note(NOTE.decision, 'decision', 'Validierung im Service', '2026-10-14T10:15:00+02:00', {
      reason: 'Zwei Komponenten nutzen dieselbe Prüfung.',
      alternatives: ['Logik in der Komponente'],
      time: { minutes: 30, basis: 'estimated', start: null, end: null },
    }),
    note(NOTE.problem, 'problem', 'Build hing beim Start', '2026-10-14T11:30:00+02:00', {
      cause: 'Veralteter Cache',
      solution: 'Cache geleert',
      delay: { minutes: 20, basis: 'estimated' },
    }),
    note(NOTE.insight, 'insight', 'Vitest braucht für Windows längere Timeouts', '2026-10-14T14:00:00+02:00'),
    note(NOTE.general, 'general', 'Besprechung mit der Fachperson', '2026-10-14T17:00:00+02:00'),
  ];
}

export function fixedJournalInput(): JournalInput {
  const notes = fixedNotes();
  const deltaOf = (snapshotId: string, id: string, path: string, omitted = false, binary = false) => ({
    ref: `${snapshotId}:${id}`,
    kind: 'state_delta' as const,
    path,
    commit: null,
    snapshotId,
    omitted,
    binary,
    fresh: null,
  });
  return {
    schemaVersion: 1,
    purpose: 'journal',
    promptVersion: 'journal@1',
    day: DAY,
    timezone: 'Europe/Zurich',
    analyses: [
      {
        snapshotId: 'S000002',
        dayAttribution: 'day',
        observedPeriod: { from: '2026-10-14T08:00:00+02:00', to: '2026-10-14T10:03:12+02:00' },
        derived: {
          summary: { text: 'Die Wortvalidierung wurde in einen Service verschoben.', evidence: ['S000002:E003', NOTE.decision] },
          implemented: [{ title: 'Service für Wortvalidierung', description: 'Neue Konstante im Service.', evidence: ['S000002:E003', 'S000002:E001'] }],
          decisions: [
            {
              title: 'Validierung im Service',
              description: 'Die Logik liegt im Service.',
              rationale: 'Zwei Komponenten nutzen dieselbe Prüfung.',
              alternatives: ['Logik in der Komponente'],
              evidence: [NOTE.decision],
            },
          ],
          problems: [{ title: 'Doppelte Logik', description: 'Die Prüfung war doppelt vorhanden.', cause: null, solution: 'Service eingeführt.', evidence: ['S000002:E003'] }],
          tests: [
            { description: 'Unit-Tests', result: 'passed', evidence: ['S000002:E006'] },
            { description: 'E2E-Tests', result: 'unknown', evidence: ['S000002:E007'] },
          ],
          contradictions: [{ description: 'Die Anforderung nennt eine andere Grenze als der Code.', evidence: ['C01', 'S000002:E003'] }],
          unknowns: ['Warum die Konstante den Wert 1 hat, ist nicht belegt.'],
        },
        statusChanges: [],
      },
      {
        snapshotId: 'S000003',
        dayAttribution: 'day',
        observedPeriod: { from: '2026-10-14T10:03:12+02:00', to: '2026-10-14T12:00:00+02:00' },
        derived: null,
        statusChanges: [
          { path: 'src/liste.ts', blob: SHA_A, from: 'unstaged', to: 'committed', commit: SHA_B, attribution: 'documented', previousEvidence: ['S000002:E003'] },
        ],
      },
      {
        snapshotId: 'S000004',
        dayAttribution: 'unclear',
        observedPeriod: { from: '2026-10-14T16:00:00+02:00', to: '2026-10-15T09:00:00+02:00' },
        derived: {
          summary: { text: 'Nachtarbeit am Export.', evidence: ['S000004:E002'] },
          implemented: [{ title: 'CSV-Export', description: 'Neue Exportfunktion.', evidence: ['S000004:E002'] }],
          decisions: [],
          problems: [],
          tests: [],
          contradictions: [],
          unknowns: [],
        },
        statusChanges: [],
      },
    ],
    evidence: [
      { ref: 'S000002:E001', kind: 'commit_message', path: null, commit: SHA_B, snapshotId: 'S000002', omitted: false, binary: false, fresh: null },
      deltaOf('S000002', 'E003', 'src/wort.ts'),
      deltaOf('S000002', 'E004', 'config/app.properties', true),
      deltaOf('S000002', 'E005', 'bild.png', true, true),
      { ref: 'S000002:E006', kind: 'test_report', path: 'reports/unit.xml', commit: null, snapshotId: 'S000002', omitted: false, binary: false, fresh: true },
      { ref: 'S000002:E007', kind: 'test_report', path: 'reports/e2e.xml', commit: null, snapshotId: 'S000002', omitted: false, binary: false, fresh: false },
      { ref: 'S000003:E001', kind: 'commit_message', path: null, commit: SHA_A, snapshotId: 'S000003', omitted: true, binary: false, fresh: null },
      deltaOf('S000003', 'E002', 'test/wort.test.ts'),
      { ref: 'S000004:E001', kind: 'commit_message', path: null, commit: SHA_A, snapshotId: 'S000004', omitted: false, binary: false, fresh: null },
      deltaOf('S000004', 'E002', 'src/export.ts'),
    ],
    commits: [
      {
        sha: SHA_B,
        snapshotId: 'S000002',
        committerDate: '2026-10-14T09:40:00+02:00',
        authoredByConfiguredUser: true,
        messageRef: 'S000002:E001',
        message: 'Wortvalidierung in Service verschieben\n\nWeil zwei Komponenten sie brauchen.\n',
      },
      { sha: SHA_A, snapshotId: 'S000003', committerDate: '2026-10-14T11:50:00+02:00', authoredByConfiguredUser: true, messageRef: 'S000003:E001', message: null },
      {
        sha: 'd'.repeat(40),
        snapshotId: 'S000004',
        committerDate: '2026-10-15T08:30:00+02:00',
        authoredByConfiguredUser: false,
        messageRef: 'S000004:E001',
        message: 'Export ergänzt\n',
      },
    ],
    notes,
    context: [{ id: 'C01', path: 'docs/anforderungen.md', sha256: HASH, content: '# Anforderungen\n' }],
    timeSummary: buildTimeSummary(notes),
    openItems: {
      analyses: [{ snapshotId: 'S000003', status: 'pending' }],
      gaps: [
        { snapshotId: 'S000003', type: 'withheld', detail: '1 Einheit(en) wegen Secret-Verdacht zurückgehalten, davon 1 Commit-Nachricht(en) bei der erneuten Prüfung.' },
        { snapshotId: null, type: 'run_failed', detail: 'capture R20261014T100000Z-0a0a um 12:00:00: unstable (Exit-Code 5).' },
      ],
    },
    allowedEvidenceIds: [
      'S000002:E001',
      'S000002:E003',
      'S000002:E004',
      'S000002:E005',
      'S000002:E006',
      'S000002:E007',
      'S000003:E001',
      'S000003:E002',
      ...notes.map((entry) => entry.id),
      'C01',
    ],
  };
}

/** Passes every rule of spec.md §15 for `fixedJournalInput()`. */
export function validJournalOutput(): JournalOutput {
  return {
    planned: [{ text: 'Wortvalidierung in einen Service verschieben', evidence: [NOTE.plan, 'C01'] }],
    done: [
      { text: 'Validierung in einen Service verschoben', evidence: ['S000002:E003', 'S000002:E001'] },
      { text: 'Testkonfiguration recherchiert', evidence: [NOTE.activity] },
    ],
    problems: [{ problem: 'Build hing beim Start', cause: 'Veralteter Cache', solution: 'Cache geleert', evidence: [NOTE.problem] }],
    decisions: [{ decision: 'Validierung im Service', rationale: 'Zwei Komponenten nutzen dieselbe Prüfung.', alternatives: ['Logik in der Komponente'], evidence: [NOTE.decision] }],
    tests: [
      { description: 'Unit-Tests', result: 'passed', evidence: ['S000002:E006'] },
      { description: 'Geänderte Testdatei test/wort.test.ts', result: 'unknown', evidence: ['S000003:E002'] },
    ],
    deviations: [{ text: 'Die Recherche dauerte länger als geplant.', evidence: [NOTE.plan, NOTE.activity] }],
    insights: [{ text: 'Vitest braucht für Windows längere Timeouts.', evidence: [NOTE.insight] }],
    nextSteps: [{ text: 'Grenze der Anforderung mit dem Code abgleichen.', evidence: ['C01'] }],
    unknowns: ['Warum die Konstante den Wert 1 hat, ist nicht belegt.'],
  };
}

/** Every reference of `fixedJournalInput()` with kind, path, snapshot and a fixed hash. */
export function fixedSources(input: JournalInput = fixedJournalInput()): Map<string, JournalSource> {
  const sources = new Map<string, JournalSource>();
  for (const entry of input.evidence) {
    sources.set(entry.ref, { ref: entry.ref, kind: entry.kind, path: entry.path, snapshotId: entry.snapshotId, sha256: entry.omitted ? null : HASH });
  }
  for (const entry of input.notes) sources.set(entry.id, { ref: entry.id, kind: 'note', path: null, snapshotId: null, sha256: HASH });
  for (const entry of input.context) sources.set(entry.id, { ref: entry.id, kind: 'context', path: entry.path, snapshotId: null, sha256: entry.sha256 });
  return sources;
}

export const AI_CONTENT = (journal: JournalOutput = validJournalOutput()): RecordContent => ({
  mode: 'ai',
  journal,
  provenance: {
    promptVersion: 'journal@1',
    outputSchemaVersion: 'journal-output@1',
    cliVersion: '2.1.201',
    models: ['claude-fake-model'],
    inputSha256: 'e'.repeat(64),
    runDir: 'journal/runs/R20261014T160500Z-a3f9',
  },
});

export const NO_AI_CONTENT: RecordContent = { mode: 'no_ai', journal: null, provenance: { deterministic: true, reason: 'requested' } };

export function fixedRecord(content: RecordContent, input: JournalInput = fixedJournalInput()): JournalRecord {
  return buildJournalRecord({ input, sources: fixedSources(input), runId: 'R20261014T160500Z-a3f9', generatedAt: '2026-10-14T18:05:00+02:00', content });
}
