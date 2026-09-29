/**
 * Temporäre Git-Repositories für Integrationstests (spec.md §16.2).
 * Die Repositories setzen lokal `user.name`, `user.email` und `core.autocrlf=false`.
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
  /** Kanonische Repository-Wurzel mit `/`. */
  root: string;
  git(...args: string[]): Promise<string>;
  write(relativePath: string, content: string | Uint8Array): Promise<void>;
  /** `git add -A` und `git commit`. */
  commit(message: string): Promise<void>;
}

export interface TempRepoOptions {
  /** Name des Repository-Ordners, zum Beispiel mit Leerzeichen und Umlauten. */
  name?: string;
  /** Dateien, die vor dem ersten Commit angelegt werden. */
  files?: Record<string, string>;
  /** Ersten Commit anlegen. Standard: `true`. Ohne Commit bleibt HEAD unborn. */
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
