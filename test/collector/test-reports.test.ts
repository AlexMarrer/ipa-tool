import { rm, utimes, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Manifest, TestReportEvidence } from '../../src/collector/types.js';
import type { Config } from '../../src/core/config.js';
import { readJsonl } from '../../src/core/jsonl.js';
import type { RunRecord } from '../../src/core/run-log.js';
import { createTempRepo, type TempRepo } from '../helpers/git-repo.js';
import { createSecretMarker, filesContaining, secretAssignment } from '../helpers/secrets.js';
import { initRepo, readManifestFile, snapshotText, unchanged } from '../helpers/snapshots.js';
import { type CliResult, createTempDataRoot, createTempDir, readJsonFile, runCli } from '../helpers/workspace.js';

function reports(manifest: Manifest): TestReportEvidence[] {
  return manifest.evidence.filter((entry): entry is TestReportEvidence => entry.kind === 'test_report');
}

async function capture(repo: TempRepo, dataDir: string): Promise<CliResult> {
  const result = await unchanged(repo, () => runCli(['capture', '--no-analysis'], { dataDir, repo: repo.root }));
  expect(result.exitCode, result.stderr).toBe(0);
  return result;
}

async function lastOutcome(workspace: string): Promise<string | undefined> {
  return (await readJsonl<RunRecord>(`${workspace}/runs.jsonl`, 'run-record')).records.at(-1)?.outcome;
}

/** Repository with an ignored report folder and one report outside the repository. */
async function setup(): Promise<{ repo: TempRepo; dataDir: string; workspace: string; external: string }> {
  const repo = await createTempRepo({ files: { '.gitignore': 'reports/\n', 'a.txt': 'eins\n' } });
  const dataDir = await createTempDataRoot();
  const workspace = await initRepo(repo, dataDir);
  const external = `${await createTempDir('berichte')}/e2e.txt`;
  const config = await readJsonFile<Config>(`${workspace}/config.json`);
  config.testReports = [
    { path: 'reports/junit.xml', label: 'Unit-Tests' },
    { path: external, label: 'E2E-Tests' },
  ];
  await writeFile(`${workspace}/config.json`, JSON.stringify(config, null, 2));
  return { repo, dataDir, workspace, external };
}

describe('Testberichte (spec.md §9.4, D-17, AK-03-11)', () => {
  it('erfasst neue und geänderte Berichte mit fresh, unveränderte ohne Beleg', async () => {
    const { repo, dataDir, workspace, external } = await setup();
    await repo.write('reports/junit.xml', '<testsuite tests="3" failures="0"/>\n');
    await writeFile(external, 'e2e: 5 bestanden\n');

    expect((await capture(repo, dataDir)).stdout).toContain('Snapshot S000002 gespeichert');
    const first = await readManifestFile(workspace, 'S000002');
    expect(reports(first).map((entry) => [entry.path, entry.label, entry.fresh, entry.omitted])).toEqual([
      ['reports/junit.xml', 'Unit-Tests', true, null],
      [external, 'E2E-Tests', true, null],
    ]);
    expect(await snapshotText(workspace, 'S000002', reports(first)[0]!.file)).toBe('<testsuite tests="3" failures="0"/>\n');
    expect(first.testReports.map((entry) => entry.path)).toEqual(['reports/junit.xml', external]);
    // Ignored by Git, so the report is no worktree state of its own.
    expect(first.evidence.filter((entry) => entry.kind === 'state_delta')).toEqual([]);
    expect(first.analysisRequired).toBe(true);

    // Unchanged reports: no evidence, and the capture is not relevant.
    await capture(repo, dataDir);
    expect(await lastOutcome(workspace)).toBe('unchanged');

    // New content with an old modification time, for example a copied file.
    await repo.write('reports/junit.xml', '<testsuite tests="4" failures="1"/>\n');
    const old = new Date('2020-01-01T00:00:00Z');
    await utimes(`${repo.root}/reports/junit.xml`, old, old);
    await capture(repo, dataDir);
    const second = await readManifestFile(workspace, 'S000003');
    expect(reports(second)).toMatchObject([{ path: 'reports/junit.xml', fresh: false, mtime: '2020-01-01T01:00:00+01:00' }]);
    expect(second.testReports).toHaveLength(2);
  });

  it('hält einen Bericht mit künstlichem Secret zurück', async () => {
    const marker = createSecretMarker();
    const { repo, dataDir, workspace } = await setup();
    await repo.write('reports/junit.xml', `<failure>${secretAssignment(marker)}</failure>\n`);

    const result = await capture(repo, dataDir);
    for (const output of [result.stdout, result.stderr]) expect(output).not.toContain(marker);
    const manifest = await readManifestFile(workspace, 'S000002');
    expect(reports(manifest)).toMatchObject([{ path: 'reports/junit.xml', file: null, omitted: { reason: 'secret_suspected', detector: 'assignment' } }]);
    expect(manifest.filterDecisions).toContainEqual(expect.objectContaining({ path: 'reports/junit.xml', decision: 'withheld' }));
    expect(await filesContaining(dataDir, marker)).toEqual([]);
  });

  it('erzeugt für einen gelöschten Bericht keinen Beleg und keine relevante Aufnahme', async () => {
    const { repo, dataDir, workspace } = await setup();
    await repo.write('reports/junit.xml', '<testsuite tests="1"/>\n');
    await capture(repo, dataDir);
    await rm(`${repo.root}/reports/junit.xml`);

    await capture(repo, dataDir);
    expect(await lastOutcome(workspace)).toBe('unchanged');
    await repo.write('a.txt', 'eins\nzwei\n');
    await capture(repo, dataDir);
    const manifest = await readManifestFile(workspace, 'S000003');
    expect(reports(manifest)).toEqual([]);
    expect(manifest.testReports).toEqual([]);
  });
});
