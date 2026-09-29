import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IpaError } from '../../src/core/errors.js';
import {
  addRegistryEntry,
  findRegistryEntry,
  readRegistry,
  REGISTRY_LOCK_FILE,
  type RegistryEntry,
  registryPath,
} from '../../src/core/registry.js';
import { createTempDir } from '../helpers/workspace.js';

function entry(id: string, repoPath: string): RegistryEntry {
  return {
    repositoryId: id,
    repoPath,
    workspacePath: `C:/Daten/workspaces/${id}`,
    workspaceMode: 'default',
    createdAt: '2026-10-14T10:03:12+02:00',
  };
}

const lockInfo = { command: 'init', runId: 'R20261014T080312Z-a3f9', startedAt: '2026-10-14T10:03:12+02:00' };

async function dataRoot(): Promise<string> {
  const dir = `${await createTempDir('registry')}/daten`;
  await mkdir(dir);
  return dir;
}

describe('Registry (spec.md §9.2)', () => {
  it('liefert null, solange keine Registry existiert', async () => {
    expect(await readRegistry(await dataRoot())).toBeNull();
    expect(await readRegistry(`${await createTempDir('registry')}/fehlt/ganz`)).toBeNull();
  });

  it('ergänzt Einträge und behält vorhandene', async () => {
    const root = await dataRoot();
    await addRegistryEntry(root, entry('a-111111', 'C:/GIT/a'), lockInfo);
    await addRegistryEntry(root, entry('b-222222', 'C:/GIT/b'), lockInfo);
    const registry = await readRegistry(root);
    expect(registry?.repositories.map((e) => e.repositoryId)).toEqual(['a-111111', 'b-222222']);
    expect(findRegistryEntry(registry, 'C:/GIT/b')?.repositoryId).toBe('b-222222');
    expect(findRegistryEntry(registry, 'C:/GIT/c')).toBeNull();
  });

  it('verliert bei gleichzeitigen Ergänzungen keinen Eintrag', async () => {
    const root = await dataRoot();
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => addRegistryEntry(root, entry(`r${i}-00000${i}`, `C:/GIT/r${i}`), lockInfo)),
    );
    const registry = await readRegistry(root);
    expect(registry?.repositories).toHaveLength(5);
  });

  it('lehnt einen zweiten Eintrag für dasselbe Repository ab', async () => {
    const root = await dataRoot();
    await addRegistryEntry(root, entry('a-111111', 'C:/GIT/a'), lockInfo);
    const error = await addRegistryEntry(root, entry('a-333333', 'C:/GIT/a'), lockInfo).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'already_initialized', exitCode: 2 });
  });

  it.runIf(process.platform === 'win32')('findet Einträge unabhängig von Schreibweise und Trennzeichen', async () => {
    const root = await dataRoot();
    await addRegistryEntry(root, entry('a-111111', 'C:/GIT/Projekt'), lockInfo);
    const registry = await readRegistry(root);
    expect(findRegistryEntry(registry, 'c:\\git\\PROJEKT')?.repositoryId).toBe('a-111111');
  });

  it('meldet beschädigte, doppelte oder neuere Registries mit Exit-Code 2 und ändert nichts (D-18)', async () => {
    const root = await dataRoot();
    const cases = [
      '{ kaputt',
      JSON.stringify({ schemaVersion: 2, repositories: [] }),
      JSON.stringify({ schemaVersion: 1, repositories: [entry('a-111111', 'C:/GIT/a'), entry('a-111111', 'C:/GIT/b')] }),
    ];
    for (const content of cases) {
      await writeFile(registryPath(root), content);
      const error = await readRegistry(root).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(IpaError);
      expect((error as IpaError).exitCode).toBe(2);
      await expect(addRegistryEntry(root, entry('c-333333', 'C:/GIT/c'), lockInfo)).rejects.toBeInstanceOf(IpaError);
      expect(await readFile(registryPath(root), 'utf8')).toBe(content);
    }
  });

  it('räumt einen veralteten Registry-Lock eines beendeten Prozesses ab', async () => {
    const root = await dataRoot();
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    await new Promise((resolve) => child.on('exit', resolve));
    await writeFile(
      path.join(root, REGISTRY_LOCK_FILE),
      JSON.stringify({ pid: child.pid, hostname: os.hostname(), command: 'init', runId: 'R20261013T080000Z-dead', startedAt: 'x' }),
    );
    await addRegistryEntry(root, entry('a-111111', 'C:/GIT/a'), lockInfo);
    expect((await readRegistry(root))?.repositories).toHaveLength(1);
  });
});
