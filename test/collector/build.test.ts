import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../../src/collector/build.js';
import type { DiffUnit } from '../../src/collector/diffs.js';
import { renderNewFilePatch } from '../../src/collector/new-file-patch.js';
import type { Observation, ObservedFile } from '../../src/collector/observe.js';
import type { SnapshotKind } from '../../src/collector/types.js';
import { sha256Hex } from '../../src/collector/worktree.js';
import { validate } from '../../src/core/schemas.js';
import { createSecretScanner } from '../../src/filter/secret-scanner.js';
import { createSecretMarker, secretAssignment } from '../helpers/secrets.js';

function blobOf(text: string): string {
  return sha256Hex(Buffer.from(text)).slice(0, 40);
}

function untracked(path: string, content: Buffer | string): ObservedFile {
  const bytes = Buffer.from(content);
  return {
    path,
    stage: 'untracked',
    headBlob: null,
    indexBlob: null,
    worktreeBlob: blobOf(path),
    symlink: false,
    submodule: false,
    read: { state: 'file', content: bytes, size: bytes.length, binary: bytes.subarray(0, 8000).includes(0), executable: false, sha256: sha256Hex(bytes) },
  };
}

function observation(files: ObservedFile[], extra: Partial<Observation> = {}): Observation {
  return {
    capturedAt: new Date('2026-10-14T08:03:12Z'),
    head: 'a'.repeat(40),
    branch: 'main',
    indexFingerprint: 'f'.repeat(64),
    statusFingerprint: 'e'.repeat(64),
    commits: [],
    staged: [],
    unstaged: [],
    files,
    excluded: new Map(),
    nestedRepositories: [],
    configuredEmail: null,
    ...extra,
  };
}

function build(obs: Observation, limits = { maxFileBytes: 10_000, maxSnapshotBytes: 1_000_000 }, kind: SnapshotKind = 'work') {
  const built = buildSnapshot({
    snapshotId: 'S000002',
    repositoryId: 'projekt-3fa9c1',
    kind,
    previous: { snapshotId: 'S000001', capturedAt: '2026-10-14T09:00:00+02:00' },
    observation: obs,
    attempts: 1,
    timezone: 'Europe/Zurich',
    limits,
    scanner: createSecretScanner({ extraPatterns: [], disabledDetectors: [] }),
  });
  expect(validate('manifest', built.manifest)).toEqual({ ok: true });
  return built;
}

function patchUnit(path: string, text: string): DiffUnit {
  return { path, oldPath: null, change: 'M', dstBlob: blobOf(text), binary: false, content: Buffer.from(text), omitted: null };
}

describe('buildSnapshot: Binärdaten und Grössen (spec.md §14.5, AK-02-07, AK-02-08)', () => {
  it('führt Einheiten mit NUL-Byte in den ersten 8000 Bytes nur als Metadaten', () => {
    const binary = Buffer.concat([Buffer.from('PNG'), Buffer.from([0, 1, 2])]);
    const lateNul = Buffer.concat([Buffer.from('x'.repeat(8500)), Buffer.from([0])]);
    const { manifest, files } = build(observation([untracked('bild.png', binary), untracked('spaet.txt', lateNul)]));
    const image = manifest.evidence.find((entry) => entry.path === 'bild.png')!;
    expect(image).toMatchObject({ binary: true, file: null, omitted: { reason: 'binary' }, bytes: binary.length });
    expect(manifest.fileStates.find((state) => state.path === 'bild.png')).toMatchObject({ copy: null, copyOmitted: 'binary' });
    expect(manifest.evidence.find((entry) => entry.path === 'spaet.txt')).toMatchObject({ binary: false, omitted: null });
    expect([...files.values()].some((content) => content.includes(binary))).toBe(false);
  });

  it('lässt Einheiten über maxFileBytes mit file_too_large aus', () => {
    const { manifest } = build(observation([untracked('gross.txt', 'y'.repeat(300)), untracked('klein.txt', 'k\n')]), {
      maxFileBytes: 200,
      maxSnapshotBytes: 1_000_000,
    });
    expect(manifest.fileStates.find((state) => state.path === 'gross.txt')).toMatchObject({ copy: null, copyOmitted: 'file_too_large' });
    expect(manifest.evidence.find((entry) => entry.path === 'gross.txt')).toMatchObject({ file: null, omitted: { reason: 'file_too_large' } });
    expect(manifest.fileStates.find((state) => state.path === 'klein.txt')?.copy).toBe('content/state/0001.dat');
    expect(manifest.filterDecisions.filter((entry) => entry.path === 'gross.txt').map((entry) => entry.decision)).toEqual(['omitted', 'omitted']);
  });

  it('lässt nach Erreichen von maxSnapshotBytes alle weiteren Einheiten deterministisch aus', () => {
    const names = ['e.txt', 'c.txt', 'a.txt', 'd.txt', 'b.txt'];
    const files = names.map((name) => untracked(name, `${name}\n`.padStart(50, '-')));
    const limits = { maxFileBytes: 10_000, maxSnapshotBytes: 120 };
    const first = build(observation(files), limits).manifest;
    const second = build(observation([...files].reverse()), limits).manifest;
    expect(second).toEqual(first);

    const copies = Object.fromEntries(first.fileStates.map((state) => [state.path, state.copy ?? state.copyOmitted]));
    expect(copies).toEqual({
      'a.txt': 'content/state/0001.dat',
      'b.txt': 'content/state/0002.dat',
      'c.txt': 'snapshot_limit',
      'd.txt': 'snapshot_limit',
      'e.txt': 'snapshot_limit',
    });
    // Copies come first; once the limit is hit, every later unit is omitted, however small.
    expect(first.evidence.every((entry) => entry.omitted?.reason === 'snapshot_limit')).toBe(true);
  });
});

describe('buildSnapshot: Secret-Prüfung (spec.md §14.4, AK-02-06)', () => {
  it('hält jede Einheit mit Treffer ganz zurück und nennt Detektor und Zeile, nie den Wert', () => {
    const marker = createSecretMarker();
    const text = `const a = 1;\n${secretAssignment(marker)}\n`;
    const commit = {
      meta: { sha: 'c'.repeat(40), parents: ['a'.repeat(40)], authorTime: 1_790_682_464, committerTime: 1_790_682_464, authorEmail: 'x@example.invalid', message: `Fix\n\n${secretAssignment(marker)}\n` },
      units: [patchUnit('src/alt.ts', `diff --git a/src/alt.ts b/src/alt.ts\n@@ -1,2 +1 @@\n const a = 1;\n-${secretAssignment(marker)}\n`)],
    };
    const { manifest, files } = build(observation([untracked('src/neu.ts', text)], { commits: [commit] }));

    for (const entry of manifest.evidence) {
      expect(entry, entry.id).toMatchObject({ file: null, sha256: null, omitted: { reason: 'secret_suspected', detector: 'assignment' } });
    }
    expect(manifest.fileStates[0]).toMatchObject({ path: 'src/neu.ts', copy: null, copyOmitted: 'secret_suspected' });
    const withheld = manifest.filterDecisions.filter((entry) => entry.decision === 'withheld');
    expect(withheld).toContainEqual({ path: 'src/neu.ts', decision: 'withheld', reason: 'secret_suspected', rule: null, detector: 'assignment', line: 2, evidence: null });
    expect(withheld).toContainEqual(expect.objectContaining({ path: null, evidence: 'E001', line: 3 }));
    expect(withheld).toHaveLength(4);
    expect(JSON.stringify(manifest)).not.toContain(marker);
    expect(files.size).toBe(0);
  });
});

describe('buildSnapshot: Belege, Dateien und Manifest (spec.md §8.1, §9.3)', () => {
  it('vergibt Beleg-IDs fortlaufend und legt Inhalte unter content/ ab', () => {
    const commit = {
      meta: { sha: 'c'.repeat(40), parents: ['a'.repeat(40), 'b'.repeat(40)], authorTime: 1_790_682_464, committerTime: 1_790_682_470, authorEmail: 'Ich@Example.invalid', message: 'Merge\n' },
      units: [patchUnit('z.txt', 'diff --git a/z.txt b/z.txt\n'), patchUnit('m.txt', 'diff --git a/m.txt b/m.txt\n')],
    };
    const obs = observation([untracked('neu.txt', 'neu\n')], {
      commits: [commit],
      staged: [patchUnit('s.txt', 'diff --git a/s.txt b/s.txt\n')],
      unstaged: [patchUnit('u.txt', 'diff --git a/u.txt b/u.txt\n')],
      configuredEmail: 'ich@example.invalid',
      excluded: new Map([['.env', '.env']]),
    });
    const { manifest, files } = build(obs);
    expect(manifest.evidence.map((entry) => [entry.id, entry.kind, entry.path, entry.file])).toEqual([
      ['E001', 'commit_message', null, 'content/E001.txt'],
      ['E002', 'commit_diff', 'm.txt', 'content/E002.patch'],
      ['E003', 'commit_diff', 'z.txt', 'content/E003.patch'],
      ['E004', 'staged_diff', 's.txt', 'content/E004.patch'],
      ['E005', 'unstaged_diff', 'neu.txt', 'content/E005.patch'],
      ['E006', 'unstaged_diff', 'u.txt', 'content/E006.patch'],
    ]);
    expect(manifest.commits[0]).toMatchObject({
      isMerge: true,
      authoredByConfiguredUser: true,
      messageEvidence: 'E001',
      authorDate: '2026-09-29T13:47:44+02:00',
      files: [
        { path: 'm.txt', evidence: 'E002', attribution: null, coveredBy: [], previousEvidence: [] },
        { path: 'z.txt', evidence: 'E003' },
      ],
    });
    expect(files.get('content/E001.txt')?.toString()).toBe('Merge\n');
    expect(files.get('content/state/0001.dat')?.toString()).toBe('neu\n');
    expect(manifest.fileStates[0]?.copy).toBe('content/state/0001.dat');
    expect(manifest.filterDecisions).toEqual([
      { path: '.env', decision: 'excluded', reason: 'excluded', rule: '.env', detector: null, line: null, evidence: null },
    ]);
    expect(manifest).toMatchObject({
      analysisRequired: true,
      previousSnapshotId: 'S000001',
      observedPeriod: { from: '2026-10-14T09:00:00+02:00', to: '2026-10-14T10:03:12+02:00' },
      statusChanges: [],
      testReports: [],
      gaps: [],
      stability: { attempts: 1, stable: true },
    });
  });

  it('setzt analysisRequired bei Ausgangs-Snapshots auf false', () => {
    expect(build(observation([]), undefined, 'baseline').manifest.analysisRequired).toBe(false);
  });
});

describe('renderNewFilePatch', () => {
  const blob = '4879932'.padEnd(40, '0');

  it('erzeugt denselben Aufbau wie git diff für eine neue Datei', () => {
    expect(renderNewFilePatch('neu.txt', Buffer.from('eins\nzwei\n'), blob, '100644').toString()).toBe(
      'diff --git a/neu.txt b/neu.txt\nnew file mode 100644\nindex 0000000..4879932\n--- /dev/null\n+++ b/neu.txt\n@@ -0,0 +1,2 @@\n+eins\n+zwei\n',
    );
    expect(renderNewFilePatch('a b.txt', Buffer.from('x'), blob, '100755').toString()).toBe(
      'diff --git a/a b.txt b/a b.txt\nnew file mode 100755\nindex 0000000..4879932\n--- /dev/null\n+++ b/a b.txt\t\n@@ -0,0 +1 @@\n+x\n\\ No newline at end of file\n',
    );
    expect(renderNewFilePatch('leer.txt', Buffer.alloc(0), blob, '100644').toString()).toBe(
      'diff --git a/leer.txt b/leer.txt\nnew file mode 100644\nindex 0000000..4879932\n',
    );
    expect(renderNewFilePatch('q"x.txt', Buffer.from('y\n'), blob, '100644').toString()).toContain('diff --git "a/q\\"x.txt" "b/q\\"x.txt"');
  });
});
