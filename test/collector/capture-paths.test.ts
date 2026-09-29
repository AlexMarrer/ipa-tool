import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { symlink, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { runCapture } from '../../src/cli/commands/capture.js';
import type { Manifest } from '../../src/collector/types.js';
import { resolveContext } from '../../src/core/context.js';
import type { State } from '../../src/core/state.js';
import { createTempRepo } from '../helpers/git-repo.js';
import { createSecretMarker, filesContaining } from '../helpers/secrets.js';
import { captureRepo, evidenceFor, gitOutput, initRepo, readManifestFile, snapshotText, stagesOf, unchanged } from '../helpers/snapshots.js';
import { createTempDataRoot, createTempDir, readJsonFile, runCli } from '../helpers/workspace.js';

describe('Pfade, Autorschaft und Links (AK-02-13, AK-02-14, AK-02-16)', () => {
  it('erfasst Pfade mit Leerzeichen, Umlauten und Anführungszeichen (AK-02-13)', async () => {
    const quoted = process.platform === 'win32' ? "Zitat 'einfach' und „doppelt“.md" : 'Zitat "doppelt" und \'einfach\'.md';
    const names = { committed: 'Ordner mit Leerzeichen/Übung ä ö ü.txt', staged: 'naïve café.txt', untracked: quoted };
    const repo = await createTempRepo({ files: { [names.committed]: 'alt\n', [names.staged]: 'alt\n' } });
    const dataDir = await createTempDataRoot();
    const workspace = await initRepo(repo, dataDir);
    await repo.write(names.committed, 'alt\nneu\n');
    await repo.commit('Umlaute');
    await repo.write(names.staged, 'alt\ngestagt\n');
    await repo.git('add', '--', names.staged);
    await repo.write(names.untracked, 'Anführungszeichen\n');

    await unchanged(repo, () => captureRepo(repo, dataDir));
    const manifest = await readManifestFile(workspace, 'S000002');
    expect(stagesOf(manifest)).toEqual({ [names.committed]: 'clean', [names.staged]: 'staged', [names.untracked]: 'untracked' });
    expect(manifest.commits[0]!.files.map((file) => file.path)).toEqual([names.committed]);
    expect(await snapshotText(workspace, 'S000002', evidenceFor(manifest, 'commit_diff', names.committed).file)).toContain('+neu');
    expect(await snapshotText(workspace, 'S000002', evidenceFor(manifest, 'staged_diff', names.staged).file)).toContain('+gestagt');
    const untracked = manifest.fileStates.find((state) => state.path === names.untracked)!;
    expect(await snapshotText(workspace, 'S000002', untracked.copy)).toBe('Anführungszeichen\n');
  });

  it('kennzeichnet eigene und fremde Commits, ohne E-Mail-Adressen zu speichern (AK-02-14)', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    const workspace = await initRepo(repo, dataDir);
    await repo.write('eigen.txt', 'eigen\n');
    await repo.commit('Eigener Commit');
    await repo.write('fremd.txt', 'fremd\n');
    await repo.git('add', 'fremd.txt');
    await repo.git('commit', '-q', '-m', 'Fremder Commit', '--author', 'Fremde Person <fremd@example.invalid>');

    const result = await unchanged(repo, () => captureRepo(repo, dataDir));
    expect(result.stderr).toBe('');
    const manifest = await readManifestFile(workspace, 'S000002');
    expect(manifest.commits.map((commit) => commit.authoredByConfiguredUser)).toEqual([true, false]);
    expect(await filesContaining(dataDir, '@example.invalid')).toEqual([]);

    await repo.git('config', '--unset', 'user.email');
    await repo.write('eigen.txt', 'eigen\nweiter\n');
    await repo.git('add', 'eigen.txt');
    await repo.git('-c', 'user.email=ipa-test@example.invalid', 'commit', '-q', '-m', 'Ohne konfigurierte Adresse');
    const withoutEmail = await unchanged(repo, () => captureRepo(repo, dataDir));
    expect(withoutEmail.stderr).toContain('user.email');
    expect((await readManifestFile(workspace, 'S000003')).commits.map((commit) => commit.authoredByConfiguredUser)).toEqual([false]);
  });

  it('liest keine Inhalte hinter einem Ordner-Link ausserhalb des Repositorys (AK-02-16, Junction unter Windows)', async () => {
    const marker = createSecretMarker();
    const outside = await createTempDir('aussen');
    await writeFile(`${outside}/geheim.txt`, `${marker}\n`);
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    const workspace = await initRepo(repo, dataDir);
    try {
      await symlink(outside, `${repo.root}/verknuepft`, 'junction');
    } catch {
      return;
    }
    await unchanged(repo, () => captureRepo(repo, dataDir));
    expect(await filesContaining(dataDir, marker)).toEqual([]);
    const manifest = await readManifestFile(workspace, 'S000002');
    const linked = manifest.fileStates.filter((state) => state.path.startsWith('verknuepft'));
    expect(linked.length).toBeGreaterThan(0);
    for (const state of linked) {
      expect(state.symlink).toBe(true);
      if (state.copy !== null) expect(await snapshotText(workspace, 'S000002', state.copy)).not.toContain(marker);
    }
    expect(manifest.filterDecisions.some((entry) => entry.path?.startsWith('verknuepft') && entry.reason === 'symlink')).toBe(true);
  });

  it('speichert bei einem Symlink nur das geprüfte Linkziel (AK-02-16)', async ({ skip }) => {
    const marker = createSecretMarker();
    const outside = await createTempDir('ziel');
    await writeFile(`${outside}/ziel.txt`, `${marker}\n`);
    const repo = await createTempRepo();
    await repo.git('config', 'core.symlinks', 'true');
    const dataDir = await createTempDataRoot();
    const workspace = await initRepo(repo, dataDir);
    try {
      await symlink(`${outside}/ziel.txt`, `${repo.root}/link.txt`, 'file');
    } catch {
      // Windows without developer mode cannot create symlinks (see package checklist).
      skip();
    }
    await unchanged(repo, () => captureRepo(repo, dataDir));
    expect(await filesContaining(dataDir, marker)).toEqual([]);
    const manifest = await readManifestFile(workspace, 'S000002');
    const state = manifest.fileStates.find((entry) => entry.path === 'link.txt')!;
    expect(state).toMatchObject({ symlink: true, stage: 'untracked' });
    expect(await snapshotText(workspace, 'S000002', state.copy)).toBe(`${outside}/ziel.txt`);
    expect(evidenceFor(manifest, 'unstaged_diff', 'link.txt')).toMatchObject({ file: null, omitted: { reason: 'symlink' } });
  });

  it('behandelt einen als Datei ausgecheckten Link (core.symlinks=false) als Linkziel (AK-02-16)', async () => {
    const repo = await createTempRepo();
    await repo.git('config', 'core.symlinks', 'false');
    const blob = await new Promise<string>((resolve, reject) => {
      const child = execFile('git', ['hash-object', '-w', '--stdin'], { cwd: repo.root }, (error, stdout) =>
        error ? reject(error) : resolve(stdout.trim()),
      );
      child.stdin?.end('../ausserhalb/alt.txt');
    });
    await repo.git('update-index', '--add', '--cacheinfo', `120000,${blob},link.txt`);
    await repo.write('link.txt', '../ausserhalb/alt.txt');
    await repo.git('commit', '-q', '-m', 'Link');
    const dataDir = await createTempDataRoot();
    const workspace = await initRepo(repo, dataDir);
    await repo.write('link.txt', '../ausserhalb/neu.txt');

    await unchanged(repo, () => captureRepo(repo, dataDir));
    const manifest = await readManifestFile(workspace, 'S000002');
    const state = manifest.fileStates.find((entry) => entry.path === 'link.txt')!;
    expect(state).toMatchObject({ symlink: true, stage: 'unstaged', headBlob: blob });
    expect(await snapshotText(workspace, 'S000002', state.copy)).toBe('../ausserhalb/neu.txt');
    expect(evidenceFor(manifest, 'unstaged_diff', 'link.txt')).toMatchObject({ file: null, omitted: { reason: 'symlink' } });
  });
});

describe('Arbeitsbereich .ipa im Repository (AK-02-19)', () => {
  it('erfasst nichts aus .ipa, auch nicht aus Commits, und bleibt beim Schreiben in .ipa/tmp stabil', async () => {
    const repo = await createTempRepo({ files: { 'README.md': '# Projekt\n' } });
    const dataDir = await createTempDataRoot();
    const init = await runCli(['init', '--workspace', '.ipa'], { dataDir, repo: repo.root });
    expect(init.exitCode).toBe(0);
    expect(init.stderr).toContain('.gitignore');
    const workspace = `${repo.root}/.ipa`;
    await repo.write('.ipa/manuell.txt', 'versehentlich versioniert\n');
    await repo.git('add', '-f', '.ipa/manuell.txt');
    await repo.git('commit', '-q', '-m', 'Arbeitsbereich teilweise committet');
    await repo.write('README.md', '# Projekt\nmehr\n');

    const ctx = await resolveContext({ repo: repo.root, dataDir, requireInit: true });
    let writes = 0;
    const result = await unchanged(
      repo,
      () =>
        runCapture(ctx, {
          hooks: {
            afterFirstPass: async () => {
              writes += 1;
              await writeFile(`${workspace}/tmp/zwischendurch-${writes}.txt`, 'vom Tool während der Aufnahme');
            },
          },
        }),
      '.ipa',
    );
    expect(result.exitCode).toBe(0);
    const manifest = await readManifestFile(workspace, result.snapshotId!);
    expect(manifest.stability.attempts).toBe(1);
    const allPaths = [
      ...manifest.fileStates.map((state) => state.path),
      ...manifest.evidence.map((entry) => entry.path ?? ''),
      ...manifest.commits.flatMap((commit) => commit.files.map((file) => file.path)),
    ];
    expect(allPaths.filter((path) => path.toLowerCase().startsWith('.ipa'))).toEqual([]);
    expect(manifest.fileStates.map((state) => state.path)).toEqual(['README.md']);
    expect(manifest.filterDecisions).toContainEqual(expect.objectContaining({ path: '.ipa/manuell.txt', decision: 'excluded', rule: '.ipa/**' }));

    const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
    const exclude = ':(exclude,top,literal).ipa';
    const statusArgs = ['-c', 'core.quotepath=off', 'status', '--porcelain=v2', '-z', '--untracked-files=all', '--no-renames'];
    expect(manifest.git.statusFingerprint).toBe(sha(await gitOutput(repo.root, [...statusArgs, '--', exclude])));
    expect(manifest.git.statusFingerprint).not.toBe(sha(await gitOutput(repo.root, statusArgs)));
    const indexArgs = ['-c', 'core.quotepath=off', 'ls-files', '-s', '-z'];
    expect(manifest.git.indexFingerprint).toBe(sha(await gitOutput(repo.root, [...indexArgs, '--', exclude])));
    expect(manifest.git.indexFingerprint).not.toBe(sha(await gitOutput(repo.root, indexArgs)));
  });
});

describe('Manifest und Zustand nach mehreren Aufnahmen', () => {
  it('nimmt auch ohne Änderungen einen Arbeits-Snapshot auf, bis Paket 03 das unterdrückt', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    const workspace = await initRepo(repo, dataDir);
    await unchanged(repo, () => captureRepo(repo, dataDir));
    const manifest: Manifest = await readManifestFile(workspace, 'S000002');
    expect(manifest).toMatchObject({ kind: 'work', commits: [], fileStates: [], evidence: [], analysisRequired: true });
    const state = await readJsonFile<State>(`${workspace}/state.json`);
    expect(state).toMatchObject({ lastSnapshotId: 'S000002', nextSnapshotSeq: 3, baselineSnapshotId: 'S000001', lastAnalysedSnapshotId: null });
    expect(state.lastSuccessfulRun).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
