/**
 * Fixed analysis data for unit tests: a work snapshot with every kind of evidence the pipeline reads.
 */
import type { AnalysisInput, AnalysisOutput, InputEvidence } from '../../src/analysis/types.js';
import type { Manifest } from '../../src/collector/types.js';
import type { Note } from '../../src/notes/types.js';

export const SHA_A = 'a'.repeat(40);
export const SHA_B = 'b'.repeat(40);
export const BLOB_1 = '1'.repeat(40);
export const BLOB_2 = '2'.repeat(40);
export const HASH = 'c'.repeat(64);

export const NOTE_ID = 'N20261014T081500Z-0c1d';

export function fixedNote(): Note {
  return {
    schemaVersion: 1,
    id: NOTE_ID,
    type: 'decision',
    text: 'Validierung in einen Service verschoben',
    activityDay: '2026-10-14',
    recordedAt: '2026-10-14T09:15:00+02:00',
    time: { minutes: 30, basis: 'measured', start: null, end: null },
    delay: null,
    reason: 'Wiederverwendung in zwei Komponenten',
    alternatives: ['Logik in der Komponente'],
    cause: null,
    solution: null,
    refs: [],
  };
}

/**
 * S000002 after S000001: one commit (E001 message, E002 commit diff), a state delta with content (E003),
 * a withheld one (E004), a binary one (E005), a fresh (E006) and an old test report (E007).
 */
export function fixedManifest(): Manifest {
  const common = { oldPath: null, commit: null, binary: false, omitted: null };
  return {
    schemaVersion: 1,
    snapshotId: 'S000002',
    repositoryId: 'projekt-3fa9c1',
    kind: 'work',
    previousSnapshotId: 'S000001',
    capturedAt: '2026-10-14T10:03:12+02:00',
    observedPeriod: { from: '2026-10-14T08:00:00+02:00', to: '2026-10-14T10:03:12+02:00' },
    git: { branch: 'main', head: SHA_B, indexFingerprint: HASH, statusFingerprint: HASH },
    analysisRequired: true,
    commits: [
      {
        sha: SHA_B,
        parents: [SHA_A],
        authorDate: '2026-10-14T09:40:00+02:00',
        committerDate: '2026-10-14T09:40:00+02:00',
        authoredByConfiguredUser: true,
        isMerge: false,
        messageEvidence: 'E001',
        files: [
          {
            path: 'src/wort.ts',
            oldPath: null,
            change: 'M',
            blob: BLOB_2,
            evidence: 'E002',
            attribution: 'new',
            coveredBy: ['E003'],
            previousEvidence: [],
          },
        ],
      },
    ],
    fileStates: [],
    evidence: [
      { ...common, id: 'E001', kind: 'commit_message', path: null, commit: SHA_B, file: 'content/E001.txt', bytes: 30, sha256: HASH },
      { ...common, id: 'E002', kind: 'commit_diff', path: 'src/wort.ts', commit: SHA_B, file: 'content/E002.patch', bytes: 120, sha256: HASH },
      { ...common, id: 'E003', kind: 'state_delta', path: 'src/wort.ts', file: 'content/E003.patch', bytes: 120, sha256: HASH, fromBlob: BLOB_1, toBlob: BLOB_2 },
      {
        ...common,
        id: 'E004',
        kind: 'state_delta',
        path: 'config/app.properties',
        file: null,
        bytes: 80,
        sha256: null,
        omitted: { reason: 'secret_suspected', detector: 'assignment' },
        fromBlob: BLOB_1,
        toBlob: BLOB_2,
      },
      {
        ...common,
        id: 'E005',
        kind: 'state_delta',
        path: 'bild.png',
        file: null,
        bytes: 2048,
        sha256: null,
        binary: true,
        omitted: { reason: 'binary' },
        fromBlob: null,
        toBlob: BLOB_2,
      },
      { ...common, id: 'E006', kind: 'test_report', path: 'reports/unit.xml', file: 'content/E006.txt', bytes: 200, sha256: HASH, label: 'Unit', mtime: '2026-10-14T09:50:00+02:00', fresh: true },
      { ...common, id: 'E007', kind: 'test_report', path: 'reports/e2e.xml', file: 'content/E007.txt', bytes: 200, sha256: HASH, label: 'E2E', mtime: '2026-10-13T17:00:00+02:00', fresh: false },
    ],
    statusChanges: [
      {
        path: 'src/liste.ts',
        blob: BLOB_1,
        from: 'unstaged',
        to: 'committed',
        commit: SHA_B,
        attribution: 'documented',
        previousEvidence: ['S000001:E002'],
      },
    ],
    testReports: [],
    filterDecisions: [
      { path: 'secrets/zugang.txt', decision: 'excluded', reason: 'excluded', rule: '**/secrets/**', detector: null, line: null, evidence: null },
      { path: 'config/app.properties', decision: 'withheld', reason: 'secret_suspected', rule: null, detector: 'assignment', line: 3, evidence: 'E004' },
      { path: 'bild.png', decision: 'omitted', reason: 'binary', rule: null, detector: null, line: null, evidence: 'E005' },
    ],
    gaps: [{ type: 'previous_state_unavailable', detail: 'config/app.properties: Kopie des Vorgängers zurückgehalten (secret_suspected)' }],
    stability: { attempts: 1, stable: true },
    tool: { name: 'ipa-assistant', version: '0.1.0' },
  };
}

const CONTENTS: Record<string, string> = {
  E001: 'Wortvalidierung in Service verschieben\n\nWeil zwei Komponenten sie brauchen.\n',
  E003: 'diff --git a/src/wort.ts b/src/wort.ts\n--- a/src/wort.ts\n+++ b/src/wort.ts\n@@ -1 +1,2 @@\n export {};\n+export const x = 1;\n',
  E006: '<testsuite tests="3" failures="0"/>\n',
  E007: '<testsuite tests="1" failures="1"/>\n',
};

export function fixedContents(): Record<string, string> {
  return { ...CONTENTS };
}

export function fixedInput(): AnalysisInput {
  const manifest = fixedManifest();
  const evidence = manifest.evidence
    .filter((entry) => entry.kind === 'commit_message' || entry.kind === 'state_delta' || entry.kind === 'test_report')
    .map(({ file: _file, ...rest }) => ({ ...rest, content: CONTENTS[rest.id] ?? null }) as InputEvidence);
  const note = fixedNote();
  return {
    schemaVersion: 1,
    purpose: 'analysis',
    promptVersion: 'analyze-work@1',
    snapshotId: manifest.snapshotId,
    previousSnapshotId: manifest.previousSnapshotId,
    observedPeriod: manifest.observedPeriod,
    repository: { branch: manifest.git.branch, head: manifest.git.head },
    commits: manifest.commits.map(({ files, ...commit }) => ({ ...commit, files: files.map(({ blob: _blob, ...file }) => file) })),
    statusChanges: manifest.statusChanges,
    evidence,
    notes: [note],
    context: [{ id: 'C01', path: 'docs/anforderungen.md', sha256: HASH, content: '# Anforderungen\n' }],
    filterSummary: { excluded: 1, withheld: 1, omitted: 1, byReason: { excluded: 1, secret_suspected: 1, binary: 1 } },
    allowedEvidenceIds: [...evidence.map((entry) => entry.id), note.id, 'C01'],
  };
}

/** Passes every rule of spec.md §15 for `fixedInput()`. */
export function validOutput(): AnalysisOutput {
  return {
    summary: { text: 'Die Wortvalidierung wurde in einen Service verschoben.', evidence: ['E003', NOTE_ID] },
    implemented: [{ title: 'Service für Wortvalidierung', description: 'Neue Konstante im Service.', evidence: ['E003', 'E001'] }],
    decisions: [
      {
        title: 'Validierung im Service',
        description: 'Die Logik liegt im Service statt in der Komponente.',
        rationale: 'Zwei Komponenten nutzen dieselbe Prüfung.',
        alternatives: ['Logik in der Komponente'],
        evidence: [NOTE_ID],
      },
    ],
    problems: [
      { title: 'Doppelte Logik', description: 'Die Prüfung war doppelt vorhanden.', cause: null, solution: 'Service eingeführt.', evidence: ['E003'] },
    ],
    tests: [
      { description: 'Unit-Tests', result: 'passed', evidence: ['E006'] },
      { description: 'E2E-Tests', result: 'unknown', evidence: ['E007'] },
    ],
    contradictions: [{ description: 'Die Anforderung nennt eine andere Grenze als der Code.', evidence: ['C01', 'E003'] }],
    unknowns: ['Warum die Konstante den Wert 1 hat, ist nicht belegt.'],
  };
}
