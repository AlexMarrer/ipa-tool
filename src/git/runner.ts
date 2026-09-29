/**
 * Git calls restricted to the read list of spec.md §14.2.
 *
 * Imports nothing from other components, so that `core` can use it without an import cycle (spec.md §4.3).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

export interface GitRunOptions {
  cwd?: string;
  input?: Uint8Array;
  /** Exit codes that are not failures; default `[0]`. */
  okExitCodes?: number[];
}

export interface GitRunResult {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
}

export interface GitRunner {
  run(args: readonly string[], opts?: GitRunOptions): Promise<GitRunResult>;
}

export interface GitRunnerOptions {
  /** If the workspace lies inside the repository, listing calls exclude it (spec.md §5.3, §14.2). */
  workspaceDir?: string;
}

/** A programming error: the call is not on the read list. No process is started. */
export class GitPolicyError extends Error {
  readonly code = 'git_command_not_allowed';

  constructor(message: string) {
    super(message);
    this.name = 'GitPolicyError';
  }
}

export class GitSpawnError extends Error {
  readonly code: 'git_not_found' | 'git_spawn_failed';

  constructor(code: 'git_not_found' | 'git_spawn_failed', message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GitSpawnError';
    this.code = code;
  }
}

export class GitCommandError extends Error {
  readonly code = 'git_failed';
  readonly subcommand: string;
  readonly exitCode: number;
  readonly stderr: string;

  constructor(subcommand: string, exitCode: number, stderr: string) {
    const firstLine = stderr.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
    super(`git ${subcommand} endete mit Exit-Code ${exitCode}${firstLine ? `: ${firstLine.trim()}` : ''}`);
    this.name = 'GitCommandError';
    this.subcommand = subcommand;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

// diff.autoRefreshIndex=false: a worktree `git diff` would otherwise rewrite .git/index after
// stat-only changes, even with GIT_OPTIONAL_LOCKS=0 (I-01, spec.md §18).
export const GIT_GLOBAL_ARGS: readonly string[] = [
  '--no-pager',
  '-c',
  'core.quotepath=off',
  '-c',
  'color.ui=never',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'diff.autoRefreshIndex=false',
];

/** Removed so that Git reads only the given repository. */
export const REMOVED_GIT_ENV: readonly string[] = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY'];

const CONFIG_READ_FLAGS = new Set(['--null', '-z', '--local', '--global', '--system', '--worktree', '--includes', '--no-includes']);
const MAX_STDERR_CHARS = 64 * 1024;

// `--output` writes to a file; Git also accepts unambiguous abbreviations.
const OUTPUT_OPTION = /^--o(?:u(?:t(?:p(?:u(?:t)?)?)?)?)?(?:=.*)?$/;
const EXT_DIFF_OPTION = /^--ext(?:-(?:d(?:i(?:f(?:f)?)?)?)?)?$/;
const TEXTCONV_OPTION = /^--textc(?:o(?:n(?:v)?)?)?$/;

function reject(message: string): never {
  throw new GitPolicyError(`Git-Aufruf nicht erlaubt: ${message}`);
}

/** Full argument list of an allowed call; throws `GitPolicyError` before any process starts. */
export function buildGitInvocation(args: readonly string[], workspaceExclude: string | null): string[] {
  if (args.length === 0) reject('leerer Aufruf');
  for (const arg of args) {
    if (typeof arg !== 'string' || arg.includes('\0')) reject('ungültiges Argument');
  }
  const [subcommand, ...rest] = args as [string, ...string[]];

  if (subcommand === '--version') {
    if (rest.length > 0) reject('--version ohne weitere Argumente');
    return [...GIT_GLOBAL_ARGS, '--version'];
  }

  for (const arg of rest) {
    if (OUTPUT_OPTION.test(arg)) reject(`Option ${arg} schreibt in eine Datei`);
  }

  let effective = [...rest];
  switch (subcommand) {
    case 'rev-parse':
    case 'rev-list':
    case 'cat-file':
    case 'ls-files':
    case 'status':
      break;
    case 'diff':
    case 'show':
    case 'log':
      for (const arg of rest) {
        if (EXT_DIFF_OPTION.test(arg) || TEXTCONV_OPTION.test(arg)) reject(`Option ${arg} ist nicht erlaubt`);
      }
      effective = ['--no-ext-diff', '--no-textconv', ...rest];
      break;
    case 'symbolic-ref':
      if (rest.length !== 3 || rest[0] !== '-q' || rest[1] !== '--short' || rest[2] !== 'HEAD') {
        reject('symbolic-ref nur als "-q --short HEAD"');
      }
      break;
    case 'merge-base':
      if (rest.length !== 3 || rest[0] !== '--is-ancestor' || rest[1]!.startsWith('-') || rest[2]!.startsWith('-')) {
        reject('merge-base nur als "--is-ancestor <a> <b>"');
      }
      break;
    case 'hash-object':
      for (const arg of rest) {
        if (arg.startsWith('--w') || (/^-[^-]/.test(arg) && arg.slice(1).includes('w'))) {
          reject('hash-object nur ohne -w und --write');
        }
      }
      break;
    case 'config': {
      if (rest[0] !== '--get') reject('config nur mit --get');
      const positional = rest.slice(1).filter((arg) => {
        if (!arg.startsWith('-')) return true;
        if (!CONFIG_READ_FLAGS.has(arg) && !/^--type=(bool|int|bool-or-int|path|expiry-date|color)$/.test(arg)) {
          reject(`config --get mit Option ${arg}`);
        }
        return false;
      });
      if (positional.length < 1 || positional.length > 2) reject('config --get <name> [<wertmuster>]');
      break;
    }
    case 'check-ignore': {
      if (!rest.includes('-q')) reject('check-ignore nur mit -q');
      let pathsFollow = false;
      for (const arg of rest) {
        if (pathsFollow) continue;
        if (arg === '--') {
          pathsFollow = true;
        } else if (arg.startsWith('-') && arg !== '-q') {
          reject(`check-ignore mit Option ${arg}`);
        }
      }
      break;
    }
    default:
      reject(`Unterbefehl "${subcommand}" steht nicht auf der Leseliste`);
  }

  if (workspaceExclude !== null && needsWorkspaceExclude(subcommand, rest)) {
    const pathspec = `:(exclude,top,literal)${workspaceExclude}`;
    effective = effective.includes('--') ? [...effective, pathspec] : [...effective, '--', pathspec];
  }
  return [...GIT_GLOBAL_ARGS, subcommand, ...effective];
}

function needsWorkspaceExclude(subcommand: string, rest: readonly string[]): boolean {
  if (subcommand === 'status' || subcommand === 'ls-files') return true;
  if (subcommand === 'diff') return !rest.includes('--no-index');
  return false;
}

/**
 * Drops repository redirections, disables optional locks and credential prompts. Variable names are
 * case-insensitive on Windows.
 */
export function buildGitEnv(base: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  const drop = new Set([...REMOVED_GIT_ENV, 'GIT_OPTIONAL_LOCKS', 'GIT_TERMINAL_PROMPT']);
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    const normalized = platform === 'win32' ? key.toUpperCase() : key;
    if (drop.has(normalized) || value === undefined) continue;
    env[key] = value;
  }
  env['GIT_OPTIONAL_LOCKS'] = '0';
  env['GIT_TERMINAL_PROMPT'] = '0';
  return env;
}

/** Workspace path relative to the repository with `/`, or `null` if it lies outside. */
export function workspaceExcludeFor(
  repoRoot: string,
  workspaceDir: string | undefined,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (workspaceDir === undefined) return null;
  const portable = (p: string): string => path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '');
  const root = portable(repoRoot);
  const workspace = portable(workspaceDir);
  const key = (p: string): string => (platform === 'win32' ? p.toLowerCase() : p);
  const prefix = root.endsWith('/') ? root : `${root}/`;
  if (!key(workspace).startsWith(key(prefix))) return null;
  const relative = workspace.slice(prefix.length);
  return relative.length > 0 ? relative : null;
}

/** At most `max` Git processes of the returned runner run at the same time; further calls wait. */
export function limitConcurrency(runner: GitRunner, max: number): GitRunner {
  let active = 0;
  const waiting: (() => void)[] = [];
  return {
    async run(args, opts) {
      if (active < max) active += 1;
      // A finishing call hands its slot over directly, so `active` never exceeds `max`.
      else await new Promise<void>((resolve) => waiting.push(resolve));
      try {
        return await runner.run(args, opts);
      } finally {
        const next = waiting.shift();
        if (next === undefined) active -= 1;
        else next();
      }
    },
  };
}

export function createGitRunner(repoRoot: string, options: GitRunnerOptions = {}): GitRunner {
  const workspaceExclude = workspaceExcludeFor(repoRoot, options.workspaceDir);
  return {
    // async, so that a read-list violation also arrives as a rejected promise.
    async run(args, opts = {}) {
      const invocation = buildGitInvocation(args, workspaceExclude);
      const subcommand = args[0] ?? '';
      const okExitCodes = opts.okExitCodes ?? [0];
      return new Promise<GitRunResult>((resolve, rejectPromise) => {
        let settled = false;
        const settle = (action: () => void): void => {
          if (!settled) {
            settled = true;
            action();
          }
        };
        const child = spawn('git', invocation, {
          cwd: opts.cwd ?? repoRoot,
          env: buildGitEnv(),
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const stdout: Buffer[] = [];
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => {
          if (stderr.length < MAX_STDERR_CHARS) stderr += chunk;
        });
        child.on('error', (error: NodeJS.ErrnoException) => {
          settle(() =>
            rejectPromise(
              error.code === 'ENOENT'
                ? new GitSpawnError('git_not_found', 'Git wurde nicht gefunden. Ist Git installiert und im PATH?', {
                    cause: error,
                  })
                : new GitSpawnError('git_spawn_failed', `Git konnte nicht gestartet werden (${error.code ?? error.message})`, {
                    cause: error,
                  }),
            ),
          );
        });
        child.on('close', (code) => {
          const exitCode = code ?? -1;
          settle(() => {
            if (okExitCodes.includes(exitCode)) {
              resolve({ stdout: Buffer.concat(stdout), stderr: stderr.slice(0, MAX_STDERR_CHARS), exitCode });
            } else {
              rejectPromise(new GitCommandError(subcommand, exitCode, stderr.slice(0, MAX_STDERR_CHARS)));
            }
          });
        });
        // Git may exit before reading stdin; the write must not crash then.
        child.stdin.on('error', () => undefined);
        if (opts.input !== undefined) {
          child.stdin.end(Buffer.from(opts.input));
        } else {
          child.stdin.end();
        }
      });
    },
  };
}
