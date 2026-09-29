import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { IpaError } from '../../src/core/errors.js';
import { resolveRepository } from '../../src/core/repository.js';
import {
  createWorkspaceStructure,
  defaultWorkspaceDir,
  resolveExplicitWorkspace,
  WORKSPACE_SUBDIRS,
} from '../../src/core/workspace.js';
import { createTempRepo } from '../helpers/git-repo.js';
import { createTempDir } from '../helpers/workspace.js';

async function workspaceError(input: string, repoRoot: string, dataRoot: string): Promise<IpaError> {
  const repo = await resolveRepository(repoRoot);
  try {
    await resolveExplicitWorkspace(input, repo, dataRoot);
  } catch (error) {
    if (error instanceof IpaError) return error;
    throw error;
  }
  throw new Error(`Arbeitsbereich ${input} wurde nicht abgelehnt`);
}

describe('Arbeitsbereichsregeln (spec.md §5.3, D-21)', () => {
  it('liegt standardmässig unter <Datenwurzel>/workspaces/<repositoryId>', () => {
    expect(defaultWorkspaceDir('C:/Daten/ipa-assistant', 'projekt-3fa9c1')).toBe('C:/Daten/ipa-assistant/workspaces/projekt-3fa9c1');
  });

  it('löst --workspace relativ zur Repository-Wurzel auf', async () => {
    const repo = await createTempRepo();
    const dataRoot = `${await createTempDir('data')}/root`;
    const info = await resolveRepository(repo.root);
    const location = await resolveExplicitWorkspace('.ipa', info, dataRoot);
    expect(location).toEqual({ path: `${repo.root}/.ipa`, mode: 'explicit', relativeToRepo: '.ipa', existed: false });

    await mkdir(`${repo.root}/leer`);
    expect((await resolveExplicitWorkspace('leer', info, dataRoot)).existed).toBe(true);

    const outside = await createTempDir('aussen');
    expect((await resolveExplicitWorkspace(`${outside}/ws`, info, dataRoot)).relativeToRepo).toBeNull();
  });

  it('lehnt Repository-Wurzel, .git, nicht leere Ordner, Dateien und die Datenwurzel ab', async () => {
    const repo = await createTempRepo();
    const dataRoot = `${await createTempDir('data')}/root`;
    await repo.write('voll/datei.txt', 'x');
    await repo.write('eine-datei.txt', 'x');

    const cases: [string, string][] = [
      ['.', 'workspace_is_repository_root'],
      [repo.root, 'workspace_is_repository_root'],
      ['.git', 'workspace_in_git_dir'],
      ['.git/ipa', 'workspace_in_git_dir'],
      ['voll', 'workspace_not_empty'],
      ['eine-datei.txt', 'workspace_not_directory'],
      ['..', 'workspace_contains_repository'],
      [dataRoot, 'workspace_contains_data_root'],
      ['', 'workspace_invalid'],
    ];
    for (const [input, code] of cases) {
      const error = await workspaceError(input, repo.root, dataRoot);
      expect(error.code, input).toBe(code);
      expect(error.exitCode, input).toBe(2);
    }
  });

  it('benennt Reste eines abgebrochenen init', async () => {
    const repo = await createTempRepo();
    await repo.write('.ipa/config.json', '{}');
    await repo.write('.ipa/state.json', '{}');
    const error = await workspaceError('.ipa', repo.root, `${await createTempDir('data')}/root`);
    expect(error.code).toBe('workspace_not_empty');
    expect(error.message).toContain('abgebrochenen');
  });

  it('legt alle Unterordner aus spec.md §8.1 an, aber keinen Lock', async () => {
    const dir = await createTempDir('ws');
    await createWorkspaceStructure(dir);
    expect((await readdir(dir)).sort()).toEqual(['analyses', 'context', 'journal', 'logs', 'notes', 'snapshots', 'tmp']);
    expect((await readdir(`${dir}/journal`)).sort()).toEqual(['drafts', 'final', 'runs']);
    expect(WORKSPACE_SUBDIRS).not.toContain('lock');
    await writeFile(`${dir}/tmp/x`, '');
  });
});
