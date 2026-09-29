import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import type { Config } from '../../src/core/config.js';
import { readJsonl } from '../../src/core/jsonl.js';
import type { Registry } from '../../src/core/registry.js';
import type { RunRecord } from '../../src/core/run-log.js';
import { validate } from '../../src/core/schemas.js';
import type { State } from '../../src/core/state.js';
import { createTempRepo } from '../helpers/git-repo.js';
import { expectRepoUnchanged, fingerprintRepo } from '../helpers/repo-fingerprint.js';
import { createTempDataRoot, createTempDir, listTree, readJsonFile, runCli } from '../helpers/workspace.js';

const SUBDIRS = ['analyses', 'context', 'journal', 'logs', 'notes', 'snapshots', 'tmp'];

async function readRegistry(dataDir: string): Promise<Registry> {
  return readJsonFile<Registry>(`${dataDir}/registry.json`);
}

describe('ipa init (Paket 01)', () => {
  it('legt im Standardmodus einen schemagültigen Arbeitsbereich in der Datenwurzel an (AK-01-03)', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    const before = await fingerprintRepo(repo.root);

    const result = await runCli(['init'], { dataDir, cwd: repo.root });
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);

    const registry = await readRegistry(dataDir);
    expect(validate('registry', registry)).toEqual({ ok: true });
    expect(registry.repositories).toHaveLength(1);
    const entry = registry.repositories[0]!;
    expect(entry).toMatchObject({ repoPath: repo.root, workspaceMode: 'default' });
    expect(entry.workspacePath).toBe(`${dataDir}/workspaces/${entry.repositoryId}`);
    expect(result.stdout).toContain(entry.repositoryId);
    expect(result.stdout).toContain(entry.workspacePath);
    expect(result.stdout).toContain('Europe/Zurich');

    const config = await readJsonFile<Config>(`${entry.workspacePath}/config.json`);
    expect(validate('config', config)).toEqual({ ok: true });
    expect(config).toMatchObject({ repositoryId: entry.repositoryId, repository: { path: repo.root }, timezone: 'Europe/Zurich' });

    const state = await readJsonFile<State>(`${entry.workspacePath}/state.json`);
    expect(validate('state', state)).toEqual({ ok: true });
    expect(state).toEqual({
      schemaVersion: 1,
      repositoryId: entry.repositoryId,
      baselineSnapshotId: null,
      branch: null,
      lastSnapshotId: null,
      lastAnalysedSnapshotId: null,
      lastCommit: null,
      lastSuccessfulRun: null,
      nextSnapshotSeq: 1,
      halt: null,
    });

    const runs = await readJsonl<RunRecord>(`${entry.workspacePath}/runs.jsonl`, 'run-record');
    expect(runs.invalid).toEqual([]);
    expect(runs.records).toHaveLength(1);
    expect(runs.records[0]).toMatchObject({
      command: 'init',
      exitCode: 0,
      outcome: 'ok',
      snapshotCreated: null,
      lockBroken: false,
      errors: [],
    });

    const names = (await readdir(entry.workspacePath)).sort();
    expect(names).toEqual([...SUBDIRS, 'config.json', 'runs.jsonl', 'state.json'].sort());
    expect((await readdir(`${entry.workspacePath}/journal`)).sort()).toEqual(['drafts', 'final', 'runs']);
    expect(existsSync(`${dataDir}/registry.lock`)).toBe(false);

    expectRepoUnchanged(before, await fingerprintRepo(repo.root));
  });

  it('endet ausserhalb eines Git-Repositorys mit Exit-Code 2 und legt nichts an (AK-01-04)', async () => {
    const outside = await createTempDir('kein-repo');
    const dataDir = await createTempDataRoot();
    const result = await runCli(['init'], { dataDir, repo: outside });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Kein Git-Repository');
    expect(existsSync(dataDir)).toBe(false);
    expect(await readdir(outside)).toEqual([]);
  });

  it('lehnt ein zweites init ab und ändert keine Datei (AK-01-05)', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    expect((await runCli(['init'], { dataDir, repo: repo.root })).exitCode).toBe(0);
    const before = await listTree(dataDir);

    const second = await runCli(['init', '--workspace', '.ipa'], { dataDir, repo: repo.root });
    expect(second.exitCode).toBe(2);
    expect(second.stderr).toContain('bereits initialisiert');
    expect(await listTree(dataDir)).toEqual(before);
    expect(existsSync(`${repo.root}/.ipa`)).toBe(false);
  });

  it('lehnt ineinander liegende Datenwurzel und Repository ab (AK-01-06)', async () => {
    const repo = await createTempRepo();
    const before = await fingerprintRepo(repo.root);
    const inside = await runCli(['init'], { dataDir: `${repo.root}/ipa-daten`, repo: repo.root });
    expect(inside.exitCode).toBe(2);
    expect(inside.stderr).toContain('liegt im untersuchten Repository');
    expectRepoUnchanged(before, await fingerprintRepo(repo.root));

    const parent = await createTempDir('daten-mit-repo');
    const nested = `${parent}/projekt`;
    await mkdir(nested);
    const { git } = await import('../helpers/git-repo.js');
    await git(nested, 'init', '-q', '-b', 'main');
    const around = await runCli(['init'], { dataDir: parent, repo: nested });
    expect(around.exitCode).toBe(2);
    expect(around.stderr).toContain('liegt in der Datenwurzel');
    expect(existsSync(`${parent}/registry.json`)).toBe(false);
  });

  it('funktioniert in einem Repository ohne Commits', async () => {
    const repo = await createTempRepo({ commit: false });
    const dataDir = await createTempDataRoot();
    const before = await fingerprintRepo(repo.root);
    const result = await runCli(['init'], { dataDir, repo: repo.root });
    expect(result.exitCode).toBe(0);
    expect(await readRegistry(dataDir)).toMatchObject({ repositories: [{ repoPath: repo.root }] });
    expectRepoUnchanged(before, await fingerprintRepo(repo.root));
  });

  it('funktioniert mit Leerzeichen und Umlauten in Repository-, Datenwurzel- und Arbeitsbereichspfad', async () => {
    const repo = await createTempRepo({ name: 'Mein Projekt Übung' });
    const dataDir = `${await createTempDir('daten')}/Daten Ärger`;
    const result = await runCli(['init', '--workspace', 'Arbeits Bereich Ö'], { dataDir, repo: repo.root });
    expect(result.exitCode).toBe(0);
    const entry = (await readRegistry(dataDir)).repositories[0]!;
    expect(entry.repositoryId).toMatch(/^mein-projekt-uebung-[0-9a-f]{6}$/);
    expect(entry.workspacePath).toBe(`${repo.root}/Arbeits Bereich Ö`);
    const status = await runCli(['status', '--json'], { dataDir, repo: repo.root });
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({ repoPath: repo.root, workspacePath: entry.workspacePath, dataRoot: dataDir });
  });

  it('verwendet die Repository-Wurzel, wenn --repo auf ein Unterverzeichnis zeigt', async () => {
    const repo = await createTempRepo({ files: { 'src/modul/datei.ts': 'export {};\n' } });
    const dataDir = await createTempDataRoot();
    expect((await runCli(['init'], { dataDir, repo: `${repo.root}/src/modul` })).exitCode).toBe(0);
    expect((await readRegistry(dataDir)).repositories[0]?.repoPath).toBe(repo.root);
  });

  it('prüft --timezone und speichert die gewählte Zeitzone', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    const invalid = await runCli(['init', '--timezone', 'Mars/Olympus'], { dataDir, repo: repo.root });
    expect(invalid.exitCode).toBe(2);
    expect(invalid.stderr).toContain('Mars/Olympus');
    expect(existsSync(dataDir)).toBe(false);

    const valid = await runCli(['init', '--timezone', 'America/New_York'], { dataDir, repo: repo.root });
    expect(valid.exitCode).toBe(0);
    const entry = (await readRegistry(dataDir)).repositories[0]!;
    expect((await readJsonFile<Config>(`${entry.workspacePath}/config.json`)).timezone).toBe('America/New_York');
    expect(entry.createdAt).toMatch(/-0[45]:00$/);
  });

  describe('mit --workspace (AK-01-15)', () => {
    it('legt den Arbeitsbereich in <repo>/.ipa an, weist auf .gitignore hin und ändert sonst nichts', async () => {
      const repo = await createTempRepo({ files: { '.gitignore': 'node_modules/\n', 'README.md': '# Test\n' } });
      const dataDir = await createTempDataRoot();
      const before = await fingerprintRepo(repo.root, { workspace: '.ipa' });

      const result = await runCli(['init', '--workspace', '.ipa'], { dataDir, repo: repo.root });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('Hinweis');
      expect(result.stderr).toContain('.gitignore');
      expect(result.stdout).toContain('ausdrücklich gewählt (im Repository)');

      const entry = (await readRegistry(dataDir)).repositories[0]!;
      expect(entry).toMatchObject({ workspaceMode: 'explicit', workspacePath: `${repo.root}/.ipa` });
      expect((await readdir(`${repo.root}/.ipa`)).sort()).toEqual([...SUBDIRS, 'config.json', 'runs.jsonl', 'state.json'].sort());
      expect(await readFile(`${repo.root}/.gitignore`, 'utf8')).toBe('node_modules/\n');

      const after = await fingerprintRepo(repo.root, { workspace: '.ipa' });
      expectRepoUnchanged(before, after);
      expect(Object.keys(after.workspace ?? {})).toContain('config.json');

      const status = await runCli(['status'], { dataDir, repo: repo.root });
      expect(status.exitCode).toBe(0);
      expect(status.stdout).toContain(`${repo.root}/.ipa`);
      expect(status.stdout).toContain('ausdrücklich gewählt (im Repository)');
    });

    it('gibt keinen Hinweis, wenn .ipa bereits ignoriert ist', async () => {
      const repo = await createTempRepo({ files: { '.gitignore': '/.ipa/\n' } });
      const dataDir = await createTempDataRoot();
      const result = await runCli(['init', '--workspace', '.ipa'], { dataDir, repo: repo.root });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });

    it('akzeptiert einen leeren Ordner und einen Ordner ausserhalb des Repositorys', async () => {
      const repo = await createTempRepo();
      const dataDir = await createTempDataRoot();
      const outside = `${await createTempDir('aussen')}/ws`;
      const result = await runCli(['init', '--workspace', outside], { dataDir, repo: repo.root });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('ausdrücklich gewählt (ausserhalb des Repositorys)');
      expect((await readRegistry(dataDir)).repositories[0]).toMatchObject({ workspaceMode: 'explicit', workspacePath: outside });

      const repo2 = await createTempRepo();
      await mkdir(`${repo2.root}/leer`);
      const second = await runCli(['init', '--workspace', 'leer', '--timezone', 'UTC'], { dataDir, repo: repo2.root });
      expect(second.exitCode).toBe(0);
    });

    it('meldet einen nicht anlegbaren Arbeitsbereich mit Exit-Code 2 und Pfad, ohne Registry-Eintrag', async () => {
      const repo = await createTempRepo();
      const dataDir = await createTempDataRoot();
      const blocker = `${await createTempDir('blocker')}/eine-datei`;
      await writeFile(blocker, 'kein Ordner');
      const target = `${blocker}/ws`;
      const result = await runCli(['init', '--workspace', target], { dataDir, repo: repo.root });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(target);
      expect(existsSync(`${dataDir}/registry.json`)).toBe(false);
      expect(await readFile(blocker, 'utf8')).toBe('kein Ordner');
    });

    it('lehnt .git, die Repository-Wurzel und nicht leere Ordner mit Exit-Code 2 ab', async () => {
      const repo = await createTempRepo({ files: { 'docs/readme.txt': 'x' } });
      const dataDir = await createTempDataRoot();
      const before = await fingerprintRepo(repo.root);
      for (const workspace of ['.git', '.git/ipa', '.', 'docs']) {
        const result = await runCli(['init', '--workspace', workspace], { dataDir, repo: repo.root });
        expect(result.exitCode, workspace).toBe(2);
      }
      expect(existsSync(dataDir)).toBe(false);
      expectRepoUnchanged(before, await fingerprintRepo(repo.root));
    });
  });

  it('meldet eine nicht beschreibbare Datenwurzel mit Auswegen und legt nirgends etwas an (AK-01-16)', async () => {
    const repo = await createTempRepo();
    const base = await createTempDir('blockiert');
    const file = `${base}/datenwurzel-ist-datei`;
    await writeFile(file, 'kein Ordner');
    const elsewhere = { IPA_ASSISTANT_HOME: `${base}/home-unbenutzt`, LOCALAPPDATA: `${base}/lad-unbenutzt` };
    const before = await fingerprintRepo(repo.root);

    for (const args of [['init'], ['init', '--workspace', '.ipa']]) {
      const result = await runCli(args, { dataDir: file, repo: repo.root, env: elsewhere });
      expect(result.exitCode, args.join(' ')).toBe(2);
      for (const expected of [file, '--data-dir', 'IPA_ASSISTANT_HOME', '--workspace']) {
        expect(result.stderr).toContain(expected);
      }
    }
    expect(await readdir(base)).toEqual(['datenwurzel-ist-datei']);
    expect(await readFile(file, 'utf8')).toBe('kein Ordner');
    expect(existsSync(`${repo.root}/.ipa`)).toBe(false);
    expectRepoUnchanged(before, await fingerprintRepo(repo.root));
  });

  it('legt einen gelöschten Arbeitsbereich nicht automatisch neu an', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    expect((await runCli(['init'], { dataDir, repo: repo.root })).exitCode).toBe(0);
    const entry = (await readRegistry(dataDir)).repositories[0]!;
    await rm(entry.workspacePath, { recursive: true });
    const registryBefore = await readFile(`${dataDir}/registry.json`, 'utf8');

    const result = await runCli(['init'], { dataDir, repo: repo.root });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('fehlt');
    expect(await readFile(`${dataDir}/registry.json`, 'utf8')).toBe(registryBefore);
    expect(await readdir(`${dataDir}/workspaces`)).toEqual([]);
  });

  it('endet mit Exit-Code 3 und räumt auf, wenn ein anderer Lauf die Registry sperrt', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    await mkdir(dataDir, { recursive: true });
    const lock = {
      pid: process.pid,
      hostname: os.hostname(),
      command: 'init',
      runId: 'R20261014T080312Z-0bad',
      startedAt: '2026-10-14T10:03:12+02:00',
    };
    await writeFile(`${dataDir}/registry.lock`, JSON.stringify(lock));

    const result = await runCli(['init'], { dataDir, repo: repo.root });
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('Lock');
    expect(existsSync(`${dataDir}/registry.json`)).toBe(false);
    expect(await readdir(`${dataDir}/workspaces`)).toEqual([]);
    expect(JSON.parse(await readFile(`${dataDir}/registry.lock`, 'utf8'))).toEqual(lock);
  });
});
