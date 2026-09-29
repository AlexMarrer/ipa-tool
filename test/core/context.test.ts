import { rm, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { resolveContext } from '../../src/core/context.js';
import { IpaError } from '../../src/core/errors.js';
import { ID_PATTERNS } from '../../src/core/ids.js';
import { initializeWorkspace } from '../../src/core/init.js';
import { createTempRepo } from '../helpers/git-repo.js';
import { createTempDataRoot, createTempDir, listTree, readJsonFile } from '../helpers/workspace.js';

async function contextError(promise: Promise<unknown>): Promise<IpaError> {
  const error = await promise.catch((e: unknown) => e);
  if (error instanceof IpaError) return error;
  throw new Error(`Kein IpaError: ${String(error)}`);
}

describe('resolveContext (spec.md §10)', () => {
  it('unterscheidet requireInit true und false bei einem nicht initialisierten Repository', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    const error = await contextError(resolveContext({ repo: repo.root, dataDir, requireInit: true }));
    expect(error.code).toBe('not_initialized');
    expect(error.exitCode).toBe(2);
    await expect(resolveContext({ repo: repo.root, dataDir, requireInit: false })).resolves.toBeNull();
  });

  it('liest Arbeitsbereich aus der Registry, lädt die Konfiguration und injiziert die Uhr', async () => {
    const repo = await createTempRepo({ name: 'Mein Projekt' });
    const dataDir = await createTempDataRoot();
    const clock = { now: () => new Date('2026-10-14T08:03:12Z') };
    const init = await initializeWorkspace({ repo: repo.root, dataDir });
    const ctx = await resolveContext({ repo: `${repo.root}/`, dataDir, requireInit: true, clock });
    expect(ctx).toMatchObject({
      dataRoot: dataDir,
      repoRoot: repo.root,
      repositoryId: init.entry.repositoryId,
      workspaceDir: init.entry.workspacePath,
      clock,
    });
    expect(ctx.config.timezone).toBe('Europe/Zurich');
    expect(ctx.runId).toMatch(/^R20261014T080312Z-[0-9a-f]{4}$/);
    expect(ctx.runId).toMatch(ID_PATTERNS.runId);
  });

  it('verwendet die Repository-Wurzel, wenn --repo auf ein Unterverzeichnis zeigt', async () => {
    const repo = await createTempRepo({ files: { 'src/tief/datei.txt': 'x' } });
    const dataDir = await createTempDataRoot();
    await initializeWorkspace({ repo: repo.root, dataDir });
    const ctx = await resolveContext({ repo: `${repo.root}/src/tief`, dataDir, requireInit: true });
    expect(ctx.repoRoot).toBe(repo.root);
  });

  it('schreibt nichts', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    await initializeWorkspace({ repo: repo.root, dataDir });
    const before = await listTree(dataDir);
    await resolveContext({ repo: repo.root, dataDir, requireInit: true });
    expect(await listTree(dataDir)).toEqual(before);
  });

  it('meldet eine ungültige config.json mit Exit-Code 2 und dem Feld (AK-01-12)', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    const { entry } = await initializeWorkspace({ repo: repo.root, dataDir });
    const config = await readJsonFile<Record<string, unknown>>(`${entry.workspacePath}/config.json`);
    await writeFile(`${entry.workspacePath}/config.json`, JSON.stringify({ ...config, limits: { ...(config['limits'] as object), maxFileBytes: -1 } }));
    const error = await contextError(resolveContext({ repo: repo.root, dataDir, requireInit: true }));
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain('/limits/maxFileBytes');
  });

  it('meldet einen gelöschten Arbeitsbereich mit Hinweis und legt ihn nicht neu an', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    const { entry } = await initializeWorkspace({ repo: repo.root, dataDir });
    await rm(entry.workspacePath, { recursive: true });
    const error = await contextError(resolveContext({ repo: repo.root, dataDir, requireInit: false }));
    expect(error.code).toBe('workspace_missing');
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain('registry.json');
    const tree = await listTree(dataDir);
    expect(Object.keys(tree).filter((p) => p.startsWith('workspaces/') && p.split('/').length === 2)).toEqual([]);
  });

  it('erkennt eine config.json, die zu einem anderen Repository gehört', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    const { entry } = await initializeWorkspace({ repo: repo.root, dataDir });
    const config = await readJsonFile<Record<string, unknown>>(`${entry.workspacePath}/config.json`);
    await writeFile(`${entry.workspacePath}/config.json`, JSON.stringify({ ...config, repository: { path: 'C:/anderes' } }));
    expect((await contextError(resolveContext({ repo: repo.root, dataDir, requireInit: true }))).code).toBe('config_mismatch');
  });

  it('lehnt eine Datenwurzel im Repository ab (AK-01-06)', async () => {
    const repo = await createTempRepo();
    const error = await contextError(resolveContext({ repo: repo.root, dataDir: `${repo.root}/daten`, requireInit: true }));
    expect(error.code).toBe('data_root_in_repository');
  });

  it('lehnt Pfade ausserhalb eines Git-Repositorys ab', async () => {
    const outside = await createTempDir('kein-repo');
    const error = await contextError(resolveContext({ repo: outside, dataDir: await createTempDataRoot(), requireInit: true }));
    expect(error.code).toBe('not_a_repository');
    expect(error.exitCode).toBe(2);
  });
});
