import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { State } from '../../src/core/state.js';
import { createTempRepo } from '../helpers/git-repo.js';
import { createSecretMarker, filesContaining, secretAssignment } from '../helpers/secrets.js';
import {
  captureRepo,
  evidenceFor,
  gitOutput,
  initRepo,
  readManifestFile,
  setLimits,
  snapshotText,
  stagesOf,
  unchanged,
  workspaceOf,
} from '../helpers/snapshots.js';
import { createTempDataRoot, readJsonFile, runCli } from '../helpers/workspace.js';

describe('Ausgangs-Snapshot bei ipa init (AK-02-01, AK-02-15)', () => {
  it('erfasst gestagte, ungestagte und neue Dateien getrennt in fileStates und Belegen (AK-02-01)', async () => {
    const repo = await createTempRepo({ files: { 'gestagt.txt': 'alt\n', 'ungestagt.txt': 'alt\n' } });
    await repo.write('gestagt.txt', 'alt\nneu gestagt\n');
    await repo.git('add', 'gestagt.txt');
    await repo.write('ungestagt.txt', 'alt\nneu ungestagt\n');
    await repo.write('neu.txt', 'ganz neu\n');
    const dataDir = await createTempDataRoot();

    const workspace = await unchanged(repo, () => initRepo(repo, dataDir));
    const manifest = await readManifestFile(workspace, 'S000001');
    expect(manifest).toMatchObject({ kind: 'baseline', analysisRequired: false, previousSnapshotId: null, commits: [] });
    expect(manifest.observedPeriod.from).toBeNull();
    expect(stagesOf(manifest)).toEqual({ 'gestagt.txt': 'staged', 'neu.txt': 'untracked', 'ungestagt.txt': 'unstaged' });
    expect(manifest.evidence.map((entry) => [entry.kind, entry.path])).toEqual([
      ['staged_diff', 'gestagt.txt'],
      ['unstaged_diff', 'neu.txt'],
      ['unstaged_diff', 'ungestagt.txt'],
    ]);
    expect(await snapshotText(workspace, 'S000001', evidenceFor(manifest, 'staged_diff', 'gestagt.txt').file)).toContain('+neu gestagt');
    expect(await snapshotText(workspace, 'S000001', evidenceFor(manifest, 'unstaged_diff', 'ungestagt.txt').file)).toContain('+neu ungestagt');
    const state = await readJsonFile<State>(`${workspace}/state.json`);
    expect(state).toMatchObject({ baselineSnapshotId: 'S000001', lastSnapshotId: 'S000001', nextSnapshotSeq: 2, branch: 'main' });
  });

  it('initialisiert ein Repository ohne Commits und erfasst danach den ersten Commit (AK-02-15)', async () => {
    const repo = await createTempRepo({ commit: false, files: { 'a.txt': 'erste Datei\n', 'b.txt': 'gestagt ohne Commit\n' } });
    await repo.git('add', 'b.txt');
    const dataDir = await createTempDataRoot();
    const workspace = await unchanged(repo, () => initRepo(repo, dataDir));
    const baseline = await readManifestFile(workspace, 'S000001');
    expect(baseline.git).toMatchObject({ head: null, branch: 'main' });
    expect(stagesOf(baseline)).toEqual({ 'a.txt': 'untracked', 'b.txt': 'staged' });
    // A-06: the staged diff of an unborn HEAD compares against the empty tree.
    expect(await snapshotText(workspace, 'S000001', evidenceFor(baseline, 'staged_diff', 'b.txt').file)).toContain('+gestagt ohne Commit');

    await repo.commit('Erster Commit');
    await unchanged(repo, () => captureRepo(repo, dataDir));
    const work = await readManifestFile(workspace, 'S000002');
    expect(work.commits).toHaveLength(1);
    expect(work.commits[0]).toMatchObject({
      parents: [],
      isMerge: false,
      files: [
        { path: 'a.txt', change: 'A', oldPath: null },
        { path: 'b.txt', change: 'A', oldPath: null },
      ],
    });
    expect(await snapshotText(workspace, 'S000002', evidenceFor(work, 'commit_diff', 'a.txt').file)).toContain('+erste Datei');
  });
});

describe('Arbeits-Snapshot mit ipa capture (AK-02-02, AK-02-03, AK-02-04)', () => {
  it('speichert neue, gestagte und ungestagte Inhalte lesbar in Belegen und Kopien (AK-02-02)', async () => {
    const repo = await createTempRepo({ files: { 'gestagt.txt': 'alt\n', 'ungestagt.txt': 'alt\n' } });
    const dataDir = await createTempDataRoot();
    const workspace = await initRepo(repo, dataDir);
    await repo.write('gestagt.txt', 'alt\nneu gestagt\n');
    await repo.git('add', 'gestagt.txt');
    await repo.write('ungestagt.txt', 'alt\nneu ungestagt\n');
    await repo.write('ordner/neu.txt', 'ganz neu\n');

    const result = await unchanged(repo, () => captureRepo(repo, dataDir));
    expect(result.stdout).toContain('Snapshot S000002 gespeichert');
    const manifest = await readManifestFile(workspace, 'S000002');
    expect(manifest).toMatchObject({ kind: 'work', previousSnapshotId: 'S000001', analysisRequired: true, stability: { attempts: 1 } });
    const baseline = await readManifestFile(workspace, 'S000001');
    expect(manifest.observedPeriod).toEqual({ from: baseline.capturedAt, to: manifest.capturedAt });

    const copies: Record<string, string> = {};
    for (const state of manifest.fileStates) copies[state.path] = await snapshotText(workspace, 'S000002', state.copy);
    expect(copies).toEqual({ 'gestagt.txt': 'alt\nneu gestagt\n', 'ordner/neu.txt': 'ganz neu\n', 'ungestagt.txt': 'alt\nneu ungestagt\n' });
    expect(await snapshotText(workspace, 'S000002', evidenceFor(manifest, 'unstaged_diff', 'ordner/neu.txt').file)).toContain('+ganz neu');
    for (const entry of manifest.evidence) {
      const content = await readFile(`${workspace}/snapshots/S000002/${entry.file}`);
      expect(entry.sha256).toBe(createHash('sha256').update(content).digest('hex'));
      expect(entry.bytes).toBe(content.length);
    }
  });

  it('erfasst zwei Commits einzeln und einen Merge gegen den ersten Elternteil (AK-02-03)', async () => {
    const repo = await createTempRepo({ files: { 'a.txt': 'a\n' } });
    const dataDir = await createTempDataRoot();
    const workspace = await initRepo(repo, dataDir);
    await repo.write('a.txt', 'a\nzwei\n');
    await repo.write('b.txt', 'b\n');
    await repo.commit('Erster Arbeitscommit\n\nmit Beschreibung');
    await repo.write('b.txt', 'b\ndrei\n');
    await repo.commit('Zweiter Arbeitscommit');

    await unchanged(repo, () => captureRepo(repo, dataDir));
    const manifest = await readManifestFile(workspace, 'S000002');
    expect(manifest.commits.map((commit) => commit.files.map((file) => `${file.change} ${file.path}`))).toEqual([['M a.txt', 'A b.txt'], ['M b.txt']]);
    const [first, second] = manifest.commits;
    expect(second!.parents).toEqual([first!.sha]);
    const message = manifest.evidence.find((entry) => entry.id === first!.messageEvidence)!;
    expect(message).toMatchObject({ kind: 'commit_message', commit: first!.sha, path: null });
    expect(await snapshotText(workspace, 'S000002', message.file)).toBe('Erster Arbeitscommit\n\nmit Beschreibung\n');
    for (const commit of manifest.commits) {
      for (const file of commit.files) {
        expect(manifest.evidence.find((entry) => entry.id === file.evidence)).toMatchObject({ kind: 'commit_diff', commit: commit.sha, path: file.path });
        expect(file.blob).toMatch(/^[0-9a-f]{40}$/);
      }
    }

    await repo.git('checkout', '-q', '-b', 'feature');
    await repo.write('feature.txt', 'aus dem Zweig\n');
    await repo.commit('Feature');
    await repo.git('checkout', '-q', 'main');
    await repo.write('main.txt', 'auf main\n');
    await repo.commit('Main');
    await repo.git('merge', '-q', '--no-ff', 'feature', '-m', 'Merge feature');
    await unchanged(repo, () => captureRepo(repo, dataDir));
    const merged = await readManifestFile(workspace, 'S000003');
    const merge = merged.commits.find((commit) => commit.isMerge)!;
    expect(merged.commits).toHaveLength(3);
    expect(merged.commits.at(-1)).toBe(merge);
    expect(merge.parents).toHaveLength(2);
    expect(merge.files.map((file) => `${file.change} ${file.path}`)).toEqual(['A feature.txt']);
    expect(await snapshotText(workspace, 'S000003', evidenceFor(merged, 'commit_diff', 'feature.txt').file)).toContain('+aus dem Zweig');
  });

  it('erfasst Löschung und Umbenennung und liest bei einer Umbenennung aus secrets/ nichts vom alten Pfad (AK-02-04)', async () => {
    const repo = await createTempRepo({
      files: { 'weg.txt': 'weg\n', 'alter-name.txt': 'bleibt gleich\n'.repeat(5), 'secrets/x.txt': 'war ausgeschlossen\n', 'src/y.txt': 'wird ausgeschlossen\n' },
    });
    const dataDir = await createTempDataRoot();
    const workspace = await initRepo(repo, dataDir);
    await repo.git('rm', '-q', 'weg.txt');
    await repo.git('mv', 'alter-name.txt', 'neuer-name.txt');
    await repo.git('mv', 'src/y.txt', 'secrets/y.txt');
    await mkdir(`${repo.root}/src`, { recursive: true });
    await repo.git('mv', 'secrets/x.txt', 'src/x.txt');
    await repo.commit('Aufräumen');

    await unchanged(repo, () => captureRepo(repo, dataDir));
    const manifest = await readManifestFile(workspace, 'S000002');
    const files = Object.fromEntries(manifest.commits[0]!.files.map((file) => [file.path, [file.change, file.oldPath]]));
    expect(files).toEqual({
      'neuer-name.txt': ['R', 'alter-name.txt'],
      'src/x.txt': ['A', null],
      'src/y.txt': ['D', null],
      'weg.txt': ['D', null],
    });
    const moved = await snapshotText(workspace, 'S000002', evidenceFor(manifest, 'commit_diff', 'src/x.txt').file);
    expect(moved).toContain('new file mode');
    expect(moved).not.toContain('secrets/');
    const excluded = manifest.filterDecisions.filter((entry) => entry.decision === 'excluded').map((entry) => [entry.path, entry.rule]);
    expect(excluded).toEqual([
      ['secrets/x.txt', '**/secrets/**'],
      ['secrets/y.txt', '**/secrets/**'],
    ]);
    expect(manifest.fileStates.map((state) => state.path).some((path) => path.startsWith('secrets/'))).toBe(false);
  });
});

describe('Filter und Inhaltsprüfung (AK-02-05, AK-02-06)', () => {
  it('speichert nichts aus ausgeschlossenen Dateien, auch nicht aus Commit-Historie und Diffs (AK-02-05)', async () => {
    const marker = createSecretMarker();
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    const workspace = await initRepo(repo, dataDir);
    await repo.write('.env', `${secretAssignment(marker)}\n`);
    await repo.write('secrets/token.txt', `${marker}\n`);
    await repo.commit('Konfiguration');
    await repo.git('rm', '-q', 'secrets/token.txt');
    await repo.commit('Token entfernt');
    await repo.write('.env', `${secretAssignment(marker)}\nzweite=${marker}\n`);
    await repo.git('add', '.env');
    await repo.write('config/.env.local', `${secretAssignment(marker)}\n`);

    const result = await unchanged(repo, () => captureRepo(repo, dataDir));
    expect(`${result.stdout}${result.stderr}`).not.toContain(marker);
    expect(await filesContaining(dataDir, marker)).toEqual([]);
    const manifest = await readManifestFile(workspace, 'S000002');
    const excluded = manifest.filterDecisions.filter((entry) => entry.decision === 'excluded').map((entry) => [entry.path, entry.rule]);
    expect(excluded).toEqual([
      ['.env', '.env'],
      ['config/.env.local', '.env.*'],
      ['secrets/token.txt', '**/secrets/**'],
    ]);
    expect(manifest.commits.map((commit) => commit.files)).toEqual([[], []]);
    expect(manifest.fileStates).toEqual([]);
  });

  it('hält künstliche Secrets in Datei, entfernter Diff-Zeile und Commit-Nachricht zurück (AK-02-06)', async () => {
    const marker = createSecretMarker();
    const repo = await createTempRepo({ files: { 'src/alt.ts': `const a = 1;\n${secretAssignment(marker)}\n` } });
    const dataDir = await createTempDataRoot();
    const initResult = await runCli(['init'], { dataDir, repo: repo.root });
    expect(initResult.exitCode).toBe(0);
    const workspace = await workspaceOf(dataDir, repo.root);
    await repo.write('src/alt.ts', 'const a = 1;\n');
    await repo.commit(`Konfiguration bereinigt\n\n${secretAssignment(marker)}`);
    await repo.write('src/neu.ts', `export const x = 1;\n${secretAssignment(marker)}\n`);

    const result = await unchanged(repo, () => runCli(['capture'], { dataDir, repo: repo.root }));
    expect(result.exitCode).toBe(0);
    for (const output of [initResult.stdout, initResult.stderr, result.stdout, result.stderr]) expect(output).not.toContain(marker);
    expect(result.stderr).toContain('Secret-Verdacht');
    expect(await filesContaining(dataDir, marker)).toEqual([]);

    const manifest = await readManifestFile(workspace, 'S000002');
    const withheld = { reason: 'secret_suspected', detector: 'assignment' };
    const message = manifest.evidence.find((entry) => entry.kind === 'commit_message')!;
    expect(message).toMatchObject({ file: null, omitted: withheld });
    expect(evidenceFor(manifest, 'commit_diff', 'src/alt.ts')).toMatchObject({ file: null, omitted: withheld });
    expect(evidenceFor(manifest, 'unstaged_diff', 'src/neu.ts')).toMatchObject({ file: null, omitted: withheld });
    expect(manifest.fileStates.find((state) => state.path === 'src/neu.ts')).toMatchObject({ copy: null, copyOmitted: 'secret_suspected' });
    // Package 03: both state deltas carry the secret too, the removed line included (AK-03-12).
    expect(evidenceFor(manifest, 'state_delta', 'src/alt.ts')).toMatchObject({ file: null, omitted: withheld });
    expect(evidenceFor(manifest, 'state_delta', 'src/neu.ts')).toMatchObject({ file: null, omitted: withheld });
    const decisions = manifest.filterDecisions.filter((entry) => entry.decision === 'withheld');
    expect(decisions).toHaveLength(6);
    for (const decision of decisions) expect(decision).toMatchObject({ reason: 'secret_suspected', detector: 'assignment', line: expect.any(Number) });
  });
});

describe('Binärdaten, Grenzwerte und Konsistenz der Blob-IDs (AK-02-07, AK-02-08, AK-02-12)', () => {
  it('führt Binärdateien nur mit Metadaten (AK-02-07)', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    const workspace = await initRepo(repo, dataDir);
    await repo.write('daten.bin', Buffer.from([0, 1, 2, 3, 255, 0, 10]));
    await repo.commit('Binärdatei');
    await repo.write('bild.png', Buffer.concat([Buffer.from('\x89PNG\r\n'), Buffer.alloc(64)]));

    await unchanged(repo, () => captureRepo(repo, dataDir));
    const manifest = await readManifestFile(workspace, 'S000002');
    for (const [kind, path] of [['commit_diff', 'daten.bin'], ['unstaged_diff', 'bild.png']] as const) {
      expect(evidenceFor(manifest, kind, path), path).toMatchObject({ binary: true, file: null, sha256: null, omitted: { reason: 'binary' } });
    }
    expect(manifest.fileStates.find((state) => state.path === 'bild.png')).toMatchObject({ copy: null, copyOmitted: 'binary' });
    expect(manifest.fileStates.find((state) => state.path === 'bild.png')?.worktreeBlob).toMatch(/^[0-9a-f]{40}$/);
  });

  it('lässt zu grosse Einheiten und Einheiten nach Erreichen der Snapshot-Grenze aus (AK-02-08)', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    const workspace = await initRepo(repo, dataDir);
    await setLimits(workspace, { maxFileBytes: 200 });
    await repo.write('gross.txt', `${'zeile\n'.repeat(100)}`);
    await unchanged(repo, () => captureRepo(repo, dataDir));
    const large = await readManifestFile(workspace, 'S000002');
    const state = large.fileStates.find((entry) => entry.path === 'gross.txt')!;
    expect(state).toMatchObject({ copy: null, copyOmitted: 'file_too_large' });
    expect(state.worktreeBlob).toBe((await gitOutput(repo.root, ['hash-object', 'gross.txt'])).toString('utf8').trim());
    expect(evidenceFor(large, 'unstaged_diff', 'gross.txt')).toMatchObject({ file: null, omitted: { reason: 'file_too_large' }, bytes: 600 });

    await setLimits(workspace, { maxFileBytes: 262144, maxSnapshotBytes: 120 });
    for (const name of ['c.txt', 'a.txt', 'b.txt']) await repo.write(name, `${name}\n`.padStart(50, '-'));
    await unchanged(repo, () => captureRepo(repo, dataDir));
    const limited = await readManifestFile(workspace, 'S000003');
    const copies = Object.fromEntries(limited.fileStates.map((entry) => [entry.path, entry.copy ?? entry.copyOmitted]));
    expect(copies).toEqual({
      'a.txt': 'content/state/0001.dat',
      'b.txt': 'content/state/0002.dat',
      'c.txt': 'snapshot_limit',
      'gross.txt': 'snapshot_limit',
    });
    expect(limited.evidence.every((entry) => entry.omitted?.reason === 'snapshot_limit')).toBe(true);
  });

  it('berechnet mit core.autocrlf=true für eine CRLF-Datei denselben Blob wie der Index (AK-02-12)', async () => {
    const repo = await createTempRepo({ files: { 'basis.txt': 'x\n' } });
    await repo.git('config', 'core.autocrlf', 'true');
    await repo.write('crlf.txt', 'eins\r\nzwei\r\n');
    await repo.git('add', 'crlf.txt');
    const dataDir = await createTempDataRoot();
    const workspace = await unchanged(repo, () => initRepo(repo, dataDir));
    const manifest = await readManifestFile(workspace, 'S000001');
    const state = manifest.fileStates.find((entry) => entry.path === 'crlf.txt')!;
    expect(state.stage).toBe('staged');
    expect(state.worktreeBlob).toBe(state.indexBlob);
    expect(state.indexBlob).toBe((await gitOutput(repo.root, ['ls-files', '-s', 'crlf.txt'])).toString('utf8').split(' ')[1]);
    expect(await snapshotText(workspace, 'S000001', state.copy)).toBe('eins\r\nzwei\r\n');
  });
});
