import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Evidence, Manifest, StateDeltaEvidence } from '../../src/collector/types.js';
import { readJsonl } from '../../src/core/jsonl.js';
import type { RunRecord } from '../../src/core/run-log.js';
import type { State } from '../../src/core/state.js';
import { createTempRepo, git, type TempRepo } from '../helpers/git-repo.js';
import { createSecretMarker, filesContaining, secretAssignment } from '../helpers/secrets.js';
import { captureRepo, evidenceFor, initRepo, readManifestFile, snapshotText, unchanged } from '../helpers/snapshots.js';
import { type CliResult, createTempDataRoot, readJsonFile, runCli } from '../helpers/workspace.js';

async function lastRun(workspace: string): Promise<RunRecord> {
  const { records, invalid } = await readJsonl<RunRecord>(`${workspace}/runs.jsonl`, 'run-record');
  expect(invalid).toEqual([]);
  return records.at(-1)!;
}

/** `ipa capture` with a repository fingerprint check around it. */
async function capture(repo: TempRepo, dataDir: string, workspace?: string): Promise<CliResult> {
  return unchanged(repo, () => runCli(['capture', '--no-analysis'], { dataDir, repo: repo.root }), workspace);
}

async function blobAt(repo: TempRepo, spec: string): Promise<string> {
  return (await repo.git('rev-parse', spec)).trim();
}

async function hashText(repo: TempRepo, text: string): Promise<string> {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const child = execFile('git', ['hash-object', '--stdin'], { cwd: repo.root }, (error, stdout) => (error ? reject(error) : resolve(stdout.trim())));
    child.stdin!.end(text);
  });
}

function deltas(manifest: Manifest): StateDeltaEvidence[] {
  return manifest.evidence.filter((entry): entry is StateDeltaEvidence => entry.kind === 'state_delta');
}

async function setup(files: Record<string, string> = { 'a.txt': 'eins\n' }): Promise<{ repo: TempRepo; dataDir: string; workspace: string }> {
  const repo = await createTempRepo({ files });
  const dataDir = await createTempDataRoot();
  const workspace = await initRepo(repo, dataDir);
  return { repo, dataDir, workspace };
}

describe('Relevanz (spec.md §11.3)', () => {
  it('speichert beim zweiten capture ohne Änderung keinen Snapshot und protokolliert unchanged (AK-03-01)', async () => {
    const { repo, dataDir, workspace } = await setup();
    await repo.write('a.txt', 'eins\nzwei\n');
    await repo.write('neu.txt', 'neu\n');
    expect((await capture(repo, dataDir)).exitCode).toBe(0);
    const stateBefore = await readJsonFile<State>(`${workspace}/state.json`);
    const snapshotsBefore = await readdir(`${workspace}/snapshots`);

    const result = await capture(repo, dataDir);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('Keine neue Arbeit seit Snapshot S000002');
    expect(await readdir(`${workspace}/snapshots`)).toEqual(snapshotsBefore);
    expect(await lastRun(workspace)).toMatchObject({ command: 'capture', exitCode: 0, outcome: 'unchanged', snapshotCreated: null, errors: [] });
    const stateAfter = await readJsonFile<State>(`${workspace}/state.json`);
    // Only the end of the last successful run moves on (spec.md §9.1, §18).
    expect({ ...stateAfter, lastSuccessfulRun: null }).toEqual({ ...stateBefore, lastSuccessfulRun: null });
  });

  it('speichert keinen Snapshot, wenn ein erfasster Stand nur gestagt wird (AK-03-02, D-07)', async () => {
    const { repo, dataDir, workspace } = await setup();
    await repo.write('a.txt', 'eins\nzwei\n');
    await repo.write('neu.txt', 'neu\n');
    await captureRepo(repo, dataDir);
    await repo.git('add', 'a.txt', 'neu.txt');

    const result = await capture(repo, dataDir);
    expect(result.exitCode).toBe(0);
    expect(await readdir(`${workspace}/snapshots`)).toEqual(['S000001', 'S000002']);
    expect(await lastRun(workspace)).toMatchObject({ outcome: 'unchanged' });
  });
});

describe('Zuordnung über mehrere Aufnahmen (spec.md §11.4)', () => {
  it('führt einen unverändert committeten Stand nur als Statusänderung (AK-03-03, I-08)', async () => {
    const { repo, dataDir, workspace } = await setup();
    await repo.write('a.txt', 'eins\nzwei\n');
    await captureRepo(repo, dataDir);
    const first = await readManifestFile(workspace, 'S000002');
    const documented = evidenceFor(first, 'state_delta', 'a.txt');
    await repo.commit('Zweite Zeile');

    expect((await capture(repo, dataDir)).exitCode).toBe(0);
    const manifest = await readManifestFile(workspace, 'S000003');
    const head = await blobAt(repo, 'HEAD');
    const committedBlob = await blobAt(repo, 'HEAD:a.txt');
    expect(deltas(manifest)).toEqual([]);
    expect(manifest.statusChanges).toEqual([
      { path: 'a.txt', blob: committedBlob, from: 'unstaged', to: 'committed', commit: head, attribution: 'documented', previousEvidence: [`S000002:${documented.id}`] },
    ]);
    expect(manifest.commits[0]!.files).toMatchObject([{ path: 'a.txt', attribution: 'documented', coveredBy: [], previousEvidence: [`S000002:${documented.id}`] }]);
    expect(manifest.analysisRequired).toBe(false);
  });

  it('erzeugt nach weiterer Bearbeitung ein Delta vom dokumentierten Blob, die Commit-Datei ist new (AK-03-04)', async () => {
    const { repo, dataDir, workspace } = await setup();
    await repo.write('a.txt', 'eins\nzwei\n');
    await captureRepo(repo, dataDir);
    const documentedBlob = await hashText(repo, 'eins\nzwei\n');
    await repo.write('a.txt', 'eins\nzwei\ndrei\n');
    await repo.commit('Drei Zeilen');

    await capture(repo, dataDir);
    const manifest = await readManifestFile(workspace, 'S000003');
    const delta = evidenceFor(manifest, 'state_delta', 'a.txt') as StateDeltaEvidence;
    expect(delta).toMatchObject({ fromBlob: documentedBlob, toBlob: await blobAt(repo, 'HEAD:a.txt') });
    const patch = await snapshotText(workspace, 'S000003', delta.file);
    expect(patch).toMatch(/^diff --git a\/a\.txt b\/a\.txt\n/);
    expect(patch).toContain('\n+drei\n');
    expect(patch).not.toContain('+zwei');
    expect(manifest.commits[0]!.files).toMatchObject([{ path: 'a.txt', attribution: 'new', coveredBy: [delta.id], previousEvidence: [] }]);
    expect(manifest.statusChanges).toEqual([]);
    expect(manifest.analysisRequired).toBe(true);
  });

  it('ordnet einen später committeten Stand aus dem Ausgangs-Snapshot als baseline zu (AK-03-05)', async () => {
    const repo = await createTempRepo({ files: { 'a.txt': 'eins\n' } });
    await repo.write('a.txt', 'eins\nvor init\n');
    const dataDir = await createTempDataRoot();
    const workspace = await initRepo(repo, dataDir);
    await repo.commit('Stand von vor init');

    await capture(repo, dataDir);
    const manifest = await readManifestFile(workspace, 'S000002');
    expect(deltas(manifest)).toEqual([]);
    expect(manifest.commits[0]!.files).toMatchObject([{ path: 'a.txt', attribution: 'baseline', coveredBy: [], previousEvidence: [] }]);
    expect(manifest.statusChanges).toMatchObject([{ path: 'a.txt', from: 'unstaged', to: 'committed', attribution: 'baseline', previousEvidence: [] }]);
    expect(manifest.analysisRequired).toBe(false);
  });

  it('zeigt eine Rücknahme auf den HEAD-Stand als Delta mit toBlob = HEAD-Blob (AK-03-06)', async () => {
    const { repo, dataDir, workspace } = await setup();
    await repo.write('a.txt', 'eins\nzwei\n');
    await captureRepo(repo, dataDir);
    await repo.write('a.txt', 'eins\n');

    const result = await capture(repo, dataDir);
    expect(result.stdout).toContain('Snapshot S000003 gespeichert');
    const manifest = await readManifestFile(workspace, 'S000003');
    const delta = evidenceFor(manifest, 'state_delta', 'a.txt') as StateDeltaEvidence;
    expect(delta.toBlob).toBe(await blobAt(repo, 'HEAD:a.txt'));
    expect(delta.fromBlob).toBe(await hashText(repo, 'eins\nzwei\n'));
    expect(await snapshotText(workspace, 'S000003', delta.file)).toContain('\n-zwei\n');
    expect(manifest.fileStates).toEqual([]);
  });

  it('committet einen dokumentierten Stand und bearbeitet ihn weiter: documented und neues Delta (Randfall)', async () => {
    const { repo, dataDir, workspace } = await setup();
    await repo.write('a.txt', 'eins\nzwei\n');
    await captureRepo(repo, dataDir);
    await repo.commit('Zwei');
    await repo.write('a.txt', 'eins\nzwei\ndrei\n');

    await capture(repo, dataDir);
    const manifest = await readManifestFile(workspace, 'S000003');
    expect(manifest.commits[0]!.files).toMatchObject([{ attribution: 'documented' }]);
    expect(evidenceFor(manifest, 'state_delta', 'a.txt')).toMatchObject({ fromBlob: await blobAt(repo, 'HEAD:a.txt') });
    expect(manifest.analysisRequired).toBe(true);
  });

  it('zeigt bei mehreren Commits den Nettoeffekt und erfasst gelöschte, wieder angelegte und neue Dateien (Randfall)', async () => {
    const { repo, dataDir, workspace } = await setup({ 'a.txt': 'eins\n', 'b.txt': 'b\n' });
    await repo.write('a.txt', 'eins\nzwei\n');
    await repo.commit('Zwei');
    await repo.write('a.txt', 'eins\nzwei\ndrei\n');
    await repo.commit('Drei');
    // Deleted and recreated identically: no change.
    await git(repo.root, 'rm', '-q', 'b.txt');
    await repo.write('b.txt', 'b\n');
    await repo.write('neu.txt', 'neu\n');

    await capture(repo, dataDir);
    const manifest = await readManifestFile(workspace, 'S000002');
    expect(deltas(manifest).map((entry) => entry.path)).toEqual(['a.txt', 'neu.txt']);
    const delta = evidenceFor(manifest, 'state_delta', 'a.txt');
    const patch = await snapshotText(workspace, 'S000002', delta.file);
    expect(patch).toContain('@@ -1 +1,3 @@\n eins\n+zwei\n+drei\n');
    expect(manifest.commits.map((commit) => commit.files.map((file) => [file.attribution, file.coveredBy]))).toEqual([
      [['new', [delta.id]]],
      [['new', [delta.id]]],
    ]);
    const neu = evidenceFor(manifest, 'state_delta', 'neu.txt') as StateDeltaEvidence;
    expect(neu.fromBlob).toBeNull();
    expect(await snapshotText(workspace, 'S000002', neu.file)).toContain('new file mode 100644\n');
  });

  it('hält ein Delta vollständig zurück, das eine Zeile mit künstlichem Secret entfernt (AK-03-12)', async () => {
    const marker = createSecretMarker();
    const { repo, dataDir, workspace } = await setup({ 'config.ts': `export const port = 1;\n${secretAssignment(marker)}\n` });
    await repo.write('config.ts', 'export const port = 1;\n');

    const result = await capture(repo, dataDir);
    expect(result.exitCode).toBe(0);
    for (const output of [result.stdout, result.stderr]) expect(output).not.toContain(marker);
    const manifest = await readManifestFile(workspace, 'S000002');
    expect(evidenceFor(manifest, 'state_delta', 'config.ts')).toMatchObject({
      file: null,
      sha256: null,
      omitted: { reason: 'secret_suspected', detector: 'assignment' },
    });
    expect(manifest.filterDecisions).toContainEqual(
      expect.objectContaining({ path: 'config.ts', decision: 'withheld', detector: 'assignment', evidence: evidenceFor(manifest, 'state_delta', 'config.ts').id }),
    );
    expect(await filesContaining(dataDir, marker)).toEqual([]);
    expect(await filesContaining(workspace, marker)).toEqual([]);
  });

  it('nimmt einen Merge eines fremden Branches ohne Halt auf; fremde Commits sind nicht eigene (Randfall)', async () => {
    const { repo, dataDir, workspace } = await setup();
    await repo.git('checkout', '-q', '-b', 'fremd');
    await repo.write('fremd.txt', 'fremd\n');
    await repo.git('add', 'fremd.txt');
    await repo.git('-c', 'user.name=Fremd', '-c', 'user.email=fremd@example.invalid', 'commit', '-q', '-m', 'Fremder Commit');
    await repo.git('checkout', '-q', 'main');
    await repo.write('a.txt', 'eins\neigen\n');
    await repo.commit('Eigener Commit');
    await repo.git('merge', '-q', '--no-ff', '-m', 'Merge fremd', 'fremd');

    const result = await capture(repo, dataDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const manifest = await readManifestFile(workspace, 'S000002');
    expect(manifest.commits.map((commit) => [commit.isMerge, commit.authoredByConfiguredUser])).toEqual([
      [false, true],
      [false, false],
      [true, true],
    ]);
    expect(deltas(manifest).map((entry) => entry.path)).toEqual(['a.txt', 'fremd.txt']);
    expect((await readJsonFile<State>(`${workspace}/state.json`)).halt).toBeNull();
  });
});

describe('Voriger Stand und Zeilenenden (spec.md §11.4)', () => {
  it('trägt previous_state_unavailable ein, wenn die Kopie des Vorgängers zurückgehalten wurde', async () => {
    const marker = createSecretMarker();
    const { repo, dataDir, workspace } = await setup();
    await repo.write('a.txt', `eins\n${secretAssignment(marker)}\n`);
    await captureRepo(repo, dataDir);
    expect((await readManifestFile(workspace, 'S000002')).fileStates).toMatchObject([{ path: 'a.txt', copy: null, copyOmitted: 'secret_suspected' }]);
    await repo.write('a.txt', 'eins\nbereinigt\n');

    await capture(repo, dataDir);
    const manifest = await readManifestFile(workspace, 'S000003');
    const delta = evidenceFor(manifest, 'state_delta', 'a.txt') as StateDeltaEvidence;
    expect(delta).toMatchObject({ fromBlob: null, toBlob: await hashText(repo, 'eins\nbereinigt\n'), omitted: null });
    const patch = await snapshotText(workspace, 'S000003', delta.file);
    expect(patch).toContain('--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1,2 @@\n+eins\n+bereinigt\n');
    expect(manifest.gaps).toEqual([{ type: 'previous_state_unavailable', detail: expect.stringContaining('a.txt') }]);
    expect(await filesContaining(dataDir, marker)).toEqual([]);
  });

  it('vergleicht mit core.autocrlf=true Inhalte in Blob-Form: nur die geänderte Zeile erscheint', async () => {
    const repo = await createTempRepo({ commit: false, files: {} });
    await repo.git('config', 'core.autocrlf', 'true');
    await repo.write('crlf.txt', 'eins\r\nzwei\r\n');
    await repo.commit('CRLF');
    const dataDir = await createTempDataRoot();
    const workspace = await initRepo(repo, dataDir);
    await repo.write('crlf.txt', 'eins\r\nzwei\r\ndrei\r\n');

    await capture(repo, dataDir);
    const manifest = await readManifestFile(workspace, 'S000002');
    const patch = await snapshotText(workspace, 'S000002', evidenceFor(manifest, 'state_delta', 'crlf.txt').file);
    expect(patch).toContain('@@ -1,2 +1,3 @@\n eins\n zwei\n+drei\n');
    expect(patch).not.toContain('-eins');
  });
});

describe('Determinismus (AK-03-13)', () => {
  function normalize(manifest: Manifest, texts: Map<string, string>): unknown {
    return {
      evidence: manifest.evidence.map((entry: Evidence) => ({
        kind: entry.kind,
        path: entry.path,
        omitted: entry.omitted,
        blobs: entry.kind === 'state_delta' ? [entry.fromBlob, entry.toBlob] : null,
        text: entry.file === null ? null : texts.get(entry.id),
      })),
      statusChanges: manifest.statusChanges,
      commits: manifest.commits.map((commit) => commit.files.map((file) => [file.path, file.blob, file.attribution])),
    };
  }

  it('erzeugt in zwei Arbeitsbereichen dieselben Belege für dieselbe Folge von Zuständen', async () => {
    const repo = await createTempRepo({ files: { 'a.txt': 'eins\n', 'alt.txt': 'alt\n', 'b c.txt': 'leer\n' } });
    const roots = [await createTempDataRoot(), await createTempDataRoot()];
    const workspaces = [await initRepo(repo, roots[0]!), await initRepo(repo, roots[1]!)];
    const steps: (() => Promise<void>)[] = [
      async () => {
        await repo.write('a.txt', 'eins\nzwei\n');
        await repo.write('neu/datei.txt', 'neu\n');
        await repo.write('b c.txt', 'gefüllt\n');
      },
      async () => {
        await repo.commit('Erster Schritt');
        await repo.write('a.txt', 'eins\nzwei\ndrei\n');
      },
      async () => {
        await repo.git('mv', 'alt.txt', 'umbenannt.txt');
        await repo.git('rm', '-q', 'neu/datei.txt');
      },
      async () => repo.commit('Zweiter Schritt'),
    ];
    for (const step of steps) {
      await step();
      for (const dataDir of roots) expect((await capture(repo, dataDir)).exitCode).toBe(0);
    }

    const snapshots = await readdir(`${workspaces[0]}/snapshots`);
    expect(snapshots).toEqual(['S000001', 'S000002', 'S000003', 'S000004', 'S000005']);
    expect(await readdir(`${workspaces[1]}/snapshots`)).toEqual(snapshots);
    for (const id of snapshots) {
      const normalized = [];
      for (const workspace of workspaces) {
        const manifest = await readManifestFile(workspace!, id);
        const texts = new Map<string, string>();
        for (const entry of manifest.evidence) {
          if (entry.file !== null) texts.set(entry.id, await readFile(`${workspace}/snapshots/${id}/${entry.file}`, 'utf8'));
        }
        normalized.push(normalize(manifest, texts));
      }
      expect(normalized[1], id).toEqual(normalized[0]);
    }
    // The sequence covers deltas, a rename, a deletion and pure status changes.
    const manifests = await Promise.all(snapshots.map((id) => readManifestFile(workspaces[0]!, id)));
    expect(manifests.flatMap((manifest) => deltas(manifest).map((entry) => entry.path))).toEqual([
      'a.txt',
      'b c.txt',
      'neu/datei.txt',
      'a.txt',
      'alt.txt',
      'neu/datei.txt',
      'umbenannt.txt',
    ]);
    expect(manifests[4]!.statusChanges.map((change) => [change.path, change.from, change.to, change.attribution])).toEqual([
      ['a.txt', 'unstaged', 'committed', 'documented'],
      ['alt.txt', 'staged', 'committed', 'documented'],
      ['neu/datei.txt', 'staged', 'committed', 'documented'],
      ['umbenannt.txt', 'staged', 'committed', 'documented'],
    ]);
    expect(manifests[4]!.analysisRequired).toBe(false);
  });
});

describe('Arbeitsbereich im Repository (AK-03-15, I-14)', () => {
  it('erfasst eigene Ausgaben in .ipa/ nicht als Arbeit: der zweite capture ergibt unchanged', async () => {
    const repo = await createTempRepo({ files: { 'a.txt': 'eins\n' } });
    const dataDir = await createTempDataRoot();
    const workspace = await initRepo(repo, dataDir, ['--workspace', '.ipa']);
    await repo.write('a.txt', 'eins\nzwei\n');

    expect((await capture(repo, dataDir, '.ipa')).stdout).toContain('Snapshot S000002 gespeichert');
    const second = await capture(repo, dataDir, '.ipa');
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain('Keine neue Arbeit');
    expect(await readdir(`${workspace}/snapshots`)).toEqual(['S000001', 'S000002']);
    expect(await lastRun(workspace)).toMatchObject({ outcome: 'unchanged' });
    const manifest = await readManifestFile(workspace, 'S000002');
    expect(manifest.fileStates.map((state) => state.path)).toEqual(['a.txt']);
    expect(manifest.evidence.every((entry) => !entry.path?.startsWith('.ipa'))).toBe(true);
  });
});
