import { execFile } from 'node:child_process';

export interface GitResult {
  ok: boolean;
  stdout: string;
}

/**
 * Reading Git calls of the app (spec §12.5): only `rev-parse` and `--version`, never with shell, no optional locks,
 * with a time limit. Nothing here can write to a repository.
 */
export type GitRunner = (cwd: string | null, args: readonly string[]) => Promise<GitResult>;

const ALLOWED = new Set(['--version', 'rev-parse']);

export const runGit: GitRunner = (cwd, args) => {
  if (!ALLOWED.has(args[0] ?? '')) return Promise.resolve({ ok: false, stdout: '' });
  return new Promise((resolve) => {
    execFile(
      'git',
      [...args],
      { cwd: cwd ?? undefined, windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } },
      (error, stdout) => resolve({ ok: error === null, stdout: String(stdout).trim() }),
    );
  });
};
