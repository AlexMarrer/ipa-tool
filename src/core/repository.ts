/**
 * Repository resolution (spec.md §5.4).
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { createGitRunner, GitCommandError, GitSpawnError } from '../git/runner.js';
import { errnoCode, EXIT, IpaError } from './errors.js';
import { canonicalizePath } from './paths.js';

export interface RepositoryInfo {
  /** Canonical, with `/`. */
  root: string;
  /** Git directory of this worktree. */
  gitDir: string;
  /** Common Git directory shared by all worktrees. */
  commonDir: string;
}

function gitFailureMessage(error: GitCommandError): string {
  const firstLine = error.stderr.split(/\r?\n/).find((line) => line.trim() !== '');
  return firstLine ? ` (git: ${firstLine.trim()})` : '';
}

function mapSpawnError(error: unknown): never {
  if (error instanceof GitSpawnError) {
    throw new IpaError(error.code, EXIT.usage, error.message, { cause: error });
  }
  throw error;
}

/**
 * No repository, a bare repository or a start outside a worktree give exit code 2.
 */
export async function resolveRepository(start: string): Promise<RepositoryInfo> {
  const startDir = path.resolve(start);
  try {
    const info = await stat(startDir);
    if (!info.isDirectory()) {
      throw new IpaError('repository_not_directory', EXIT.usage, `Der Repository-Pfad ist kein Ordner: ${startDir}`);
    }
  } catch (error) {
    if (error instanceof IpaError) throw error;
    const code = errnoCode(error);
    throw new IpaError(
      'repository_not_found',
      EXIT.usage,
      code === 'ENOENT' ? `Der Repository-Pfad existiert nicht: ${startDir}` : `Der Repository-Pfad ist nicht lesbar: ${startDir}`,
      { cause: error },
    );
  }

  const git = createGitRunner(startDir);
  let bare: string;
  try {
    const result = await git.run(['rev-parse', '--is-bare-repository'], { cwd: startDir });
    bare = result.stdout.toString('utf8').trim();
  } catch (error) {
    if (error instanceof GitCommandError) {
      throw new IpaError('not_a_repository', EXIT.usage, `Kein Git-Repository: ${startDir}${gitFailureMessage(error)}`, {
        cause: error,
      });
    }
    return mapSpawnError(error);
  }
  if (bare === 'true') {
    throw new IpaError('bare_repository', EXIT.usage, `Bare-Repositories werden nicht unterstützt: ${startDir}`);
  }

  let lines: string[];
  try {
    const result = await git.run(['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'], {
      cwd: startDir,
    });
    lines = result.stdout.toString('utf8').split(/\r?\n/).filter((line) => line.length > 0);
  } catch (error) {
    if (error instanceof GitCommandError) {
      throw new IpaError(
        'no_worktree',
        EXIT.usage,
        `Kein Arbeitsverzeichnis eines Git-Repositorys: ${startDir}${gitFailureMessage(error)}`,
        { cause: error },
      );
    }
    return mapSpawnError(error);
  }
  const [root, gitDir, commonDir] = lines;
  if (root === undefined || gitDir === undefined || commonDir === undefined) {
    throw new IpaError('no_worktree', EXIT.usage, `Die Repository-Wurzel von ${startDir} liess sich nicht bestimmen.`);
  }
  return {
    root: await canonicalizePath(root),
    gitDir: await canonicalizePath(gitDir),
    commonDir: await canonicalizePath(commonDir),
  };
}
