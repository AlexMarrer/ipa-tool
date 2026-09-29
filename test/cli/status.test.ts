import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Config } from '../../src/core/config.js';
import type { Registry } from '../../src/core/registry.js';
import { appendRunRecord, createRunRecord } from '../../src/core/run-log.js';
import { createTempRepo } from '../helpers/git-repo.js';
import { expectRepoUnchanged, fingerprintRepo } from '../helpers/repo-fingerprint.js';
import { createTempDataRoot, listTree, readJsonFile, runCli } from '../helpers/workspace.js';

/** Felder von Paket 01 aus spec.md §6.6, in der festgelegten Reihenfolge. */
const PACKAGE_01_FIELDS = [
  'repositoryId',
  'repoPath',
  'workspacePath',
  'dataRoot',
  'timezone',
  'workspaceMode',
  'baselineSnapshotId',
  'lastSnapshotId',
  'lastAnalysedSnapshotId',
  'lastSuccessfulRun',
  'lastRun',
];

async function initialized(options: { workspace?: string } = {}) {
  const repo = await createTempRepo();
  const dataDir = await createTempDataRoot();
  const args = options.workspace === undefined ? ['init'] : ['init', '--workspace', options.workspace];
  const init = await runCli(args, { dataDir, repo: repo.root });
  expect(init.exitCode).toBe(0);
  const entry = (await readJsonFile<Registry>(`${dataDir}/registry.json`)).repositories[0]!;
  return { repo, dataDir, entry };
}

describe('ipa status (Paket 01)', () => {
  it('liefert mit --json genau die Felder von Paket 01 und schreibt keine Datei (AK-01-13)', async () => {
    const { repo, dataDir, entry } = await initialized();
    const treeBefore = await listTree(dataDir);
    const repoBefore = await fingerprintRepo(repo.root);

    const result = await runCli(['status', '--json'], { dataDir, repo: repo.root });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const report = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(Object.keys(report)).toEqual(PACKAGE_01_FIELDS);
    expect(report).toMatchObject({
      repositoryId: entry.repositoryId,
      repoPath: repo.root,
      workspacePath: entry.workspacePath,
      dataRoot: dataDir,
      timezone: 'Europe/Zurich',
      workspaceMode: 'default',
      baselineSnapshotId: null,
      lastSnapshotId: null,
      lastAnalysedSnapshotId: null,
      lastSuccessfulRun: null,
    });
    expect(report['lastRun']).toMatchObject({ command: 'init', outcome: 'ok', exitCode: 0, errors: [] });

    const human = await runCli(['status'], { dataDir, repo: repo.root });
    expect(human.exitCode).toBe(0);
    for (const label of ['Repository-ID:', 'Arbeitsbereich:', 'Speichermodus:', 'Datenwurzel:', 'Zeitzone:', 'Letzter Lauf:']) {
      expect(human.stdout).toContain(label);
    }
    expect(human.stdout).toContain('Standard (Datenwurzel, ausserhalb des Repositorys)');

    expect(await listTree(dataDir)).toEqual(treeBefore);
    expectRepoUnchanged(repoBefore, await fingerprintRepo(repo.root));
  });

  it('meldet ein nicht initialisiertes Repository mit Exit-Code 2', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    const result = await runCli(['status'], { dataDir, repo: repo.root });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('nicht initialisiert');
    expect(result.stdout).toBe('');
  });

  it('meldet eine ungültige config.json mit Exit-Code 2 und dem Feld (AK-01-12)', async () => {
    const { repo, dataDir, entry } = await initialized();
    const configFile = `${entry.workspacePath}/config.json`;
    const config = await readJsonFile<Config>(configFile);

    await writeFile(configFile, JSON.stringify({ ...config, limits: { ...config.limits, maxFileBytes: 'gross' } }));
    const invalid = await runCli(['status'], { dataDir, repo: repo.root });
    expect(invalid.exitCode).toBe(2);
    expect(invalid.stderr).toContain('/limits/maxFileBytes');

    await writeFile(configFile, JSON.stringify({ ...config, unbekannt: true }));
    const extra = await runCli(['status'], { dataDir, repo: repo.root });
    expect(extra.exitCode).toBe(2);
    expect(extra.stderr).toContain('/unbekannt');

    await writeFile(configFile, JSON.stringify({ ...config, schemaVersion: 2 }));
    const newer = await runCli(['status', '--json'], { dataDir, repo: repo.root });
    expect(newer.exitCode).toBe(2);
    expect(newer.stderr).toContain('Schemaversion 2');
  });

  it('meldet eine beschädigte Registry mit Exit-Code 2 und lässt sie unverändert', async () => {
    const { repo, dataDir } = await initialized();
    await writeFile(`${dataDir}/registry.json`, '{"schemaVersion":1,"repositories":[');
    const result = await runCli(['status'], { dataDir, repo: repo.root });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('registry.json');
    expect(await readFile(`${dataDir}/registry.json`, 'utf8')).toBe('{"schemaVersion":1,"repositories":[');
  });

  it('zeigt für zwei Repositories jeweils den eigenen Arbeitsbereich (AK-01-07)', async () => {
    const dataDir = await createTempDataRoot();
    const repoA = await createTempRepo({ name: 'alpha' });
    const repoB = await createTempRepo({ name: 'beta' });
    expect((await runCli(['init'], { dataDir, repo: repoA.root })).exitCode).toBe(0);
    expect((await runCli(['init', '--workspace', '.ipa'], { dataDir, repo: repoB.root })).exitCode).toBe(0);

    const a = JSON.parse((await runCli(['status', '--json'], { dataDir, repo: repoA.root })).stdout) as Record<string, string>;
    const b = JSON.parse((await runCli(['status', '--json'], { dataDir, repo: repoB.root })).stdout) as Record<string, string>;
    expect(a['repositoryId']).toMatch(/^alpha-/);
    expect(b['repositoryId']).toMatch(/^beta-/);
    expect(a['workspacePath']).toBe(`${dataDir}/workspaces/${a['repositoryId']}`);
    expect(b['workspacePath']).toBe(`${repoB.root}/.ipa`);
    expect(b['workspaceMode']).toBe('explicit');

    if (process.platform === 'win32') {
      const variant = repoA.root.toUpperCase().replace(/\//g, '\\');
      const viaVariant = await runCli(['status', '--json'], { dataDir, repo: variant });
      expect(viaVariant.exitCode).toBe(0);
      expect(JSON.parse(viaVariant.stdout)).toMatchObject({ repositoryId: a['repositoryId'], repoPath: repoA.root });
      const dataVariant = dataDir.toLowerCase().replace(/\//g, '\\');
      const viaDataVariant = await runCli(['--repo', repoB.root.toLowerCase(), 'status', '--json'], { dataDir: dataVariant });
      expect(JSON.parse(viaDataVariant.stdout)).toMatchObject({ repositoryId: b['repositoryId'] });
    }
  });

  it('zeigt vom letzten Lauf nur die Fehlercodes, nicht die Meldungen', async () => {
    const { repo, dataDir, entry } = await initialized();
    await appendRunRecord(
      entry.workspacePath,
      createRunRecord({
        runId: 'R20261014T080312Z-0e0e',
        command: 'capture',
        startedAt: new Date('2026-10-14T08:03:12Z'),
        endedAt: new Date('2026-10-14T08:03:20Z'),
        timezone: 'Europe/Zurich',
        exitCode: 5,
        lockBroken: true,
        errors: [{ code: 'unstable', message: 'Detail, das status nicht zeigt' }],
      }),
    );
    const result = await runCli(['status', '--json'], { dataDir, repo: repo.root });
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as { lastRun: Record<string, unknown> };
    expect(report.lastRun).toMatchObject({ command: 'capture', outcome: 'unstable', exitCode: 5, lockBroken: true, errors: [{ code: 'unstable' }] });
    expect(result.stdout).not.toContain('Detail, das status nicht zeigt');
  });

  it('überspringt ungültige Zeilen in runs.jsonl mit einer Warnung', async () => {
    const { repo, dataDir, entry } = await initialized();
    await appendFile(`${entry.workspacePath}/runs.jsonl`, '{kaputt}\n');
    const result = await runCli(['status', '--json'], { dataDir, repo: repo.root });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Zeile 2');
    expect(JSON.parse(result.stdout)).toMatchObject({ lastRun: { command: 'init' } });
  });
});
