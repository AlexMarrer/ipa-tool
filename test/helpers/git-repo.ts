/**
 * Temporary Git repositories for integration tests (spec.md §16.2) with local `user.name`,
 * `user.email` and `core.autocrlf=false`.
 */
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createTempDir } from './workspace.js';

const execFileAsync = promisify(execFile);

export const TEST_USER_NAME = 'IPA Test';
export const TEST_USER_EMAIL = 'ipa-test@example.invalid';

export interface TempRepo {
  /** Canonical, with `/`. */
  root: string;
  git(...args: string[]): Promise<string>;
  write(relativePath: string, content: string | Uint8Array): Promise<void>;
  /** `git add -A` and `git commit`. */
  commit(message: string): Promise<void>;
}

export interface TempRepoOptions {
  /** Folder name, for example with spaces and umlauts. */
  name?: string;
  /** Files created before the first commit. */
  files?: Record<string, string>;
  /** Default `true`; without a commit HEAD stays unborn. */
  commit?: boolean;
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, windowsHide: true, encoding: 'utf8' });
  return stdout;
}

export async function createTempRepo(options: TempRepoOptions = {}): Promise<TempRepo> {
  const parent = await createTempDir('repo');
  const root = `${parent}/${options.name ?? 'projekt'}`;
  await mkdir(root, { recursive: true });
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'config', 'user.name', TEST_USER_NAME);
  await git(root, 'config', 'user.email', TEST_USER_EMAIL);
  await git(root, 'config', 'core.autocrlf', 'false');
  await git(root, 'config', 'commit.gpgsign', 'false');

  const repo: TempRepo = {
    root,
    git: (...args) => git(root, ...args),
    async write(relativePath, content) {
      const target = path.join(root, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    },
    async commit(message) {
      await git(root, 'add', '-A');
      await git(root, 'commit', '-q', '-m', message);
    },
  };

  const files = options.files ?? { 'README.md': '# Testprojekt\n' };
  for (const [file, content] of Object.entries(files)) {
    await repo.write(file, content);
  }
  if (options.commit ?? true) {
    await repo.commit('Erster Commit');
  }
  return repo;
}
