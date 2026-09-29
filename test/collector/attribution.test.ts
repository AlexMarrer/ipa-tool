import { describe, expect, it } from 'vitest';
import { type EffectiveState, type PathTransition, planAttribution } from '../../src/collector/attribution.js';
import { gitBlobId, toBlobForm } from '../../src/collector/delta.js';
import { buildLineage, type Lineage } from '../../src/collector/lineage.js';
import { changedReports, isFresh, type ObservedReport } from '../../src/collector/test-reports.js';
import type { Evidence, FileState, Manifest } from '../../src/collector/types.js';

const blob = (name: string): string => name.repeat(40).slice(0, 40);
const A = blob('a');
const B = blob('b');
const C = blob('c');
const D = blob('d');

const state = (blobId: string | null, stage: EffectiveState['stage'] = 'clean', known = true): EffectiveState => ({ blob: blobId, known, stage });

function transition(path: string, previous: EffectiveState, current: EffectiveState, committedIn: string | null = null): PathTransition {
  return { path, previous, current, committedIn };
}

function fileState(path: string, headBlob: string | null, worktreeBlob: string | null, extra: Partial<FileState> = {}): FileState {
  return { path, stage: 'unstaged', headBlob, indexBlob: headBlob, worktreeBlob, symlink: false, copy: null, copyOmitted: null, ...extra };
}

function delta(id: string, path: string, fromBlob: string | null, toBlob: string | null): Evidence {
  return { id, kind: 'state_delta', path, oldPath: null, commit: null, file: null, bytes: 0, sha256: null, binary: false, omitted: null, fromBlob, toBlob };
}

function manifest(snapshotId: string, kind: Manifest['kind'], fileStates: FileState[], evidence: Evidence[] = []): Manifest {
  return {
    schemaVersion: 1,
    snapshotId,
    repositoryId: 'projekt-3fa9c1',
    kind,
    previousSnapshotId: null,
    capturedAt: '2026-10-14T10:00:00+02:00',
    observedPeriod: { from: null, to: '2026-10-14T10:00:00+02:00' },
    git: { branch: 'main', head: null, indexFingerprint: 'f'.repeat(64), statusFingerprint: 'e'.repeat(64) },
    analysisRequired: false,
    commits: [],
    fileStates,
    evidence,
    statusChanges: [],
    testReports: [],
    filterDecisions: [],
    gaps: [],
    stability: { attempts: 1, stable: true },
    tool: { name: 'ipa-assistant', version: '0.1.0' },
  };
}

const EMPTY: Lineage = buildLineage([manifest('S000001', 'baseline', [])]);
const SHA1 = '1'.repeat(40);
const SHA2 = '2'.repeat(40);

describe('buildLineage: dokumentierte Blobs und Ausgangsstand (spec.md §11.4)', () => {
  // Newest first, as loadLineage reads them.
  const lineage = buildLineage([
    manifest('S000004', 'work', [], [delta('E001', 'a.txt', B, C), delta('E002', 'weg.txt', A, null)]),
    manifest('S000003', 'work', [], [delta('E003', 'a.txt', A, B)]),
    manifest('S000002', 'baseline', [fileState('basis.txt', A, D), fileState('link', null, null, { copyOmitted: 'symlink' })]),
    manifest('S000001', 'work', [], [delta('E009', 'alt.txt', null, blob('9'))]),
  ]);

  it('findet toBlob früherer state_delta, zuerst auf demselben Pfad, sonst über den Blob', () => {
    expect(lineage.documented('a.txt', B)).toEqual(['S000003:E003']);
    expect(lineage.documented('a.txt', C)).toEqual(['S000004:E001']);
    expect(lineage.documented('kopie.txt', C)).toEqual(['S000004:E001']);
    expect(lineage.documented('a.txt', A)).toEqual([]);
  });

  it('dokumentiert eine Löschung nur auf demselben Pfad', () => {
    expect(lineage.documented('weg.txt', null)).toEqual(['S000004:E002']);
    expect(lineage.documented('anders.txt', null)).toEqual([]);
  });

  it('endet beim letzten Ausgangs-Snapshot; ältere Folgen zählen nicht', () => {
    expect(lineage.documented('alt.txt', blob('9'))).toEqual([]);
  });

  it('kennt wirksamen Stand und HEAD-Blob der im Ausgangs-Snapshot erfassten Dateien', () => {
    expect(lineage.isBaseline('basis.txt', D)).toBe(true);
    expect(lineage.isBaseline('basis.txt', A)).toBe(true);
    expect(lineage.isBaseline('basis.txt', B)).toBe(false);
    // Not determined (link) is no "deleted" state.
    expect(lineage.isBaseline('link', null)).toBe(false);
  });
});

describe('planAttribution: Zustandsdelta, Statusänderungen und Commit-Dateien (spec.md §11.4)', () => {
  it('ergibt ohne Änderung weder Delta noch Statusänderung', () => {
    const plan = planAttribution([transition('a.txt', state(B, 'unstaged'), state(B, 'unstaged'))], [], EMPTY);
    expect(plan).toEqual({ deltas: [], statusChanges: [], commitFiles: [] });
  });

  it('zeigt eine Rücknahme auf den HEAD-Stand als Delta mit toBlob = HEAD-Blob (Randfall, AK-03-06)', () => {
    const plan = planAttribution([transition('a.txt', state(B, 'unstaged'), state(A))], [], EMPTY);
    expect(plan.deltas).toEqual([{ path: 'a.txt', fromBlob: B, toBlob: A, previousKnown: true }]);
  });

  it('ergibt nach Löschen und identischem Neuanlegen keine Änderung (Randfall)', () => {
    expect(planAttribution([transition('a.txt', state(B, 'untracked'), state(B, 'untracked'))], [], EMPTY).deltas).toEqual([]);
  });

  it('führt reines Stagen eines dokumentierten Stands als Statusänderung, ohne Delta (D-07, I-08)', () => {
    const lineage = buildLineage([manifest('S000002', 'work', [], [delta('E004', 'a.txt', A, B)]), manifest('S000001', 'baseline', [])]);
    const plan = planAttribution([transition('a.txt', state(B, 'unstaged'), state(B, 'staged'))], [], lineage);
    expect(plan.deltas).toEqual([]);
    expect(plan.statusChanges).toEqual([
      { path: 'a.txt', blob: B, from: 'unstaged', to: 'staged', commit: null, attribution: 'documented', previousEvidence: ['S000002:E004'] },
    ]);
  });

  it('ordnet einen unverändert committeten Stand als documented zu, ohne Delta (AK-03-03)', () => {
    const lineage = buildLineage([manifest('S000002', 'work', [], [delta('E004', 'a.txt', A, B)]), manifest('S000001', 'baseline', [])]);
    const plan = planAttribution([transition('a.txt', state(B, 'unstaged'), state(B), SHA1)], [[{ path: 'a.txt', blob: B }]], lineage);
    expect(plan.deltas).toEqual([]);
    expect(plan.statusChanges).toEqual([
      { path: 'a.txt', blob: B, from: 'unstaged', to: 'committed', commit: SHA1, attribution: 'documented', previousEvidence: ['S000002:E004'] },
    ]);
    expect(plan.commitFiles).toEqual([[{ attribution: 'documented', coveredByPath: null, previousEvidence: ['S000002:E004'] }]]);
  });

  it('ordnet einen weiter bearbeiteten und committeten Stand als new mit Delta vom dokumentierten Blob zu (AK-03-04)', () => {
    const lineage = buildLineage([manifest('S000002', 'work', [], [delta('E004', 'a.txt', A, B)]), manifest('S000001', 'baseline', [])]);
    const plan = planAttribution([transition('a.txt', state(B, 'unstaged'), state(C), SHA1)], [[{ path: 'a.txt', blob: C }]], lineage);
    expect(plan.deltas).toEqual([{ path: 'a.txt', fromBlob: B, toBlob: C, previousKnown: true }]);
    expect(plan.statusChanges).toEqual([]);
    expect(plan.commitFiles).toEqual([[{ attribution: 'new', coveredByPath: 'a.txt', previousEvidence: [] }]]);
  });

  it('ordnet einen Stand aus dem Ausgangs-Snapshot als baseline zu (AK-03-05)', () => {
    const lineage = buildLineage([manifest('S000001', 'baseline', [fileState('a.txt', A, B)])]);
    const plan = planAttribution([transition('a.txt', state(B, 'unstaged'), state(B), SHA1)], [[{ path: 'a.txt', blob: B }]], lineage);
    expect(plan.deltas).toEqual([]);
    expect(plan.statusChanges).toMatchObject([{ from: 'unstaged', to: 'committed', attribution: 'baseline', previousEvidence: [] }]);
    expect(plan.commitFiles).toEqual([[{ attribution: 'baseline', coveredByPath: null, previousEvidence: [] }]]);
  });

  it('committet einen dokumentierten Stand und bearbeitet weiter: documented plus neues Delta (Randfall)', () => {
    const lineage = buildLineage([manifest('S000002', 'work', [], [delta('E004', 'a.txt', A, B)]), manifest('S000001', 'baseline', [])]);
    const plan = planAttribution([transition('a.txt', state(B, 'unstaged'), state(C, 'unstaged'), SHA1)], [[{ path: 'a.txt', blob: B }]], lineage);
    expect(plan.deltas).toEqual([{ path: 'a.txt', fromBlob: B, toBlob: C, previousKnown: true }]);
    expect(plan.commitFiles).toEqual([[{ attribution: 'documented', coveredByPath: null, previousEvidence: ['S000002:E004'] }]]);
  });

  it('zeigt bei mehreren Commits den Nettoeffekt; Zwischenstände sind new oder unclear (Randfall)', () => {
    const covered = planAttribution(
      [transition('a.txt', state(A), state(C), SHA2)],
      [[{ path: 'a.txt', blob: B }], [{ path: 'a.txt', blob: C }]],
      EMPTY,
    );
    expect(covered.deltas).toEqual([{ path: 'a.txt', fromBlob: A, toBlob: C, previousKnown: true }]);
    expect(covered.commitFiles.flat().map((file) => [file.attribution, file.coveredByPath])).toEqual([
      ['new', 'a.txt'],
      ['new', 'a.txt'],
    ]);
    // Changed and changed back: no delta covers the path.
    const reverted = planAttribution([transition('a.txt', state(A), state(A), SHA2)], [[{ path: 'a.txt', blob: B }], [{ path: 'a.txt', blob: A }]], EMPTY);
    expect(reverted.deltas).toEqual([]);
    expect(reverted.statusChanges).toEqual([]);
    expect(reverted.commitFiles.flat().map((file) => file.attribution)).toEqual(['unclear', 'unclear']);
  });

  it('ordnet eine dokumentierte Löschung beim Commit als documented zu', () => {
    const lineage = buildLineage([manifest('S000002', 'work', [], [delta('E001', 'weg.txt', A, null)]), manifest('S000001', 'baseline', [])]);
    const plan = planAttribution([transition('weg.txt', state(null, 'unstaged'), state(null), SHA1)], [[{ path: 'weg.txt', blob: null }]], lineage);
    expect(plan.deltas).toEqual([]);
    expect(plan.commitFiles).toEqual([[{ attribution: 'documented', coveredByPath: null, previousEvidence: ['S000002:E001'] }]]);
  });

  it('erzeugt bei unbekanntem Vorstand ein Delta ohne Vorgänger und übergeht einen unbekannten aktuellen Stand', () => {
    const plan = planAttribution(
      [transition('b.txt', state(null, 'unstaged', false), state(B, 'unstaged')), transition('a.txt', state(A), state(null, 'unstaged', false))],
      [],
      EMPTY,
    );
    expect(plan.deltas).toEqual([{ path: 'b.txt', fromBlob: null, toBlob: B, previousKnown: false }]);
  });

  it('sortiert Deltas nach Pfad (AK-03-13)', () => {
    const plan = planAttribution([transition('z.txt', state(A), state(B)), transition('a.txt', state(A), state(C))], [], EMPTY);
    expect(plan.deltas.map((entry) => entry.path)).toEqual(['a.txt', 'z.txt']);
  });
});

describe('Blob-Form von Worktree-Inhalten (core.autocrlf)', () => {
  it('berechnet dieselbe Blob-ID wie Git', () => {
    // `printf 'a\n' | git hash-object --stdin`
    expect(gitBlobId(Buffer.from('a\n'), SHA1)).toBe('78981922613b2afb6025042ff6bd878ac1994e85');
  });

  it('wandelt CRLF nur um, wenn das Ergebnis dem Blob entspricht', () => {
    const lf = Buffer.from('eins\nzwei\n');
    const crlf = Buffer.from('eins\r\nzwei\r\n');
    const lfBlob = gitBlobId(lf, SHA1);
    expect(toBlobForm(crlf, lfBlob)).toEqual(lf);
    expect(toBlobForm(crlf, gitBlobId(crlf, SHA1))).toEqual(crlf);
    expect(toBlobForm(crlf, blob('9'))).toEqual(crlf);
  });
});

describe('Testberichte: Vergleich und Aktualität (D-17)', () => {
  const report = (path: string, sha256: string): ObservedReport => ({ path, label: 'Tests', size: 1, sha256, mtimeMs: 0, binary: false, content: Buffer.from('x') });

  it('meldet neue und geänderte Berichte, nicht unveränderte oder gelöschte', () => {
    const previous = [
      { path: 'gleich.xml', label: 'Tests', sha256: '1'.repeat(64), mtime: '2026-10-14T10:00:00+02:00' },
      { path: 'anders.xml', label: 'Tests', sha256: '2'.repeat(64), mtime: '2026-10-14T10:00:00+02:00' },
      { path: 'geloescht.xml', label: 'Tests', sha256: '3'.repeat(64), mtime: '2026-10-14T10:00:00+02:00' },
    ];
    const current = [report('gleich.xml', '1'.repeat(64)), report('anders.xml', '9'.repeat(64)), report('neu.xml', '4'.repeat(64))];
    expect(changedReports(current, previous).map((entry) => entry.path)).toEqual(['anders.xml', 'neu.xml']);
  });

  it('ist frisch genau im Intervall (from, to]', () => {
    const from = '2026-10-14T10:00:00+02:00';
    const to = new Date('2026-10-14T09:00:00Z');
    expect(isFresh(Date.parse(from), from, to)).toBe(false);
    expect(isFresh(Date.parse(from) + 1000, from, to)).toBe(true);
    expect(isFresh(to.getTime(), from, to)).toBe(true);
    expect(isFresh(to.getTime() + 1, from, to)).toBe(false);
    expect(isFresh(0, null, to)).toBe(true);
  });
});
