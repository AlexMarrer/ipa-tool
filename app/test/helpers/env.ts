/**
 * Test environment for the app: temporary data root, real Git repositories and workspaces created by the real
 * CLI with the fake Claude CLI (spec §17). Nothing here touches the real data root or `%APPDATA%`.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const APP_ROOT = path.resolve(import.meta.dirname, '..', '..');
export const REPO_ROOT = path.resolve(APP_ROOT, '..');
export const CLI_JS = path.join(REPO_ROOT, 'dist', 'cli.js');
export const FAKE_CLAUDE = path.join(REPO_ROOT, 'test', 'helpers', 'fake-claude.mjs');

export interface TestEnv {
  /** Folder that holds everything of this test. */
  root: string;
  dataRoot: string;
  userData: string;
  fakeLog: string;
  /** Environment for CLI and app processes; mutate `FAKE_CLAUDE_MODE` between runs. */
  env: NodeJS.ProcessEnv;
  cleanup(): Promise<void>;
}

/** Portable path with `/` and an upper-case drive letter, as the CLI prints it. */
export function portable(p: string): string {
  const slashed = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:/.test(slashed) ? slashed.charAt(0).toUpperCase() + slashed.slice(1) : slashed;
}

export async function createTestEnv(): Promise<TestEnv> {
  const root = portable(await realpath(await mkdtemp(path.join(os.tmpdir(), 'ipa-app-test-'))));
  const dataRoot = `${root}/ipa-daten`;
  const userData = `${root}/app-daten`;
  const claudeConfig = `${root}/claude-konfig`;
  const fakeLog = `${root}/fake-claude.jsonl`;
  await mkdir(userData, { recursive: true });
  await mkdir(claudeConfig, { recursive: true });

  const env: NodeJS.ProcessEnv = { ...process.env };
  // Variables of a surrounding Claude Code session and API keys must not reach the CLI under test.
  for (const name of Object.keys(env)) {
    if (/^(CLAUDECODE|CLAUDE_.+|MCP_CONNECTION_NONBLOCKING|MCP_SERVER_CONNECTION_BATCH_SIZE|ANTHROPIC_(API_KEY|AUTH_TOKEN|PROFILE|FEDERATION_RULE_ID))$/i.test(name)) {
      delete env[name];
    }
  }
  env['CLAUDE_CONFIG_DIR'] = claudeConfig;
  env['IPA_ASSISTANT_HOME'] = dataRoot;
  env['FAKE_CLAUDE_MODE'] = 'analysis';
  env['FAKE_CLAUDE_LOG'] = fakeLog;

  return {
    root,
    dataRoot,
    userData,
    fakeLog,
    env,
    cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
  };
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, windowsHide: true, encoding: 'utf8' });
  return stdout;
}

export interface TestRepo {
  root: string;
  write(relative: string, content: string): Promise<void>;
  commit(message: string): Promise<void>;
}

export async function createRepo(env: TestEnv, name = 'projekt'): Promise<TestRepo> {
  const root = `${env.root}/repos/${name}`;
  await mkdir(root, { recursive: true });
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'config', 'user.name', 'IPA Test');
  await git(root, 'config', 'user.email', 'ipa-test@example.invalid');
  await git(root, 'config', 'core.autocrlf', 'false');
  await git(root, 'config', 'commit.gpgsign', 'false');
  const repo: TestRepo = {
    root,
    async write(relative, content) {
      const target = path.join(root, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    },
    async commit(message) {
      await git(root, 'add', '-A');
      await git(root, 'commit', '-q', '-m', message);
    },
  };
  await repo.write('README.md', '# Testprojekt\n');
  await repo.commit('Erster Commit');
  return repo;
}

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs the built CLI directly, like a console would. */
export async function runCli(env: TestEnv, repo: string, args: string[], extraEnv: Record<string, string> = {}): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_JS, '--repo', repo, ...args], {
      cwd: env.userData,
      env: { ...env.env, ...extraEnv },
      windowsHide: true,
      encoding: 'utf8',
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { exitCode: typeof failure.code === 'number' ? failure.code : -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

export interface InitializedProject {
  repo: TestRepo;
  repositoryId: string;
  workspacePath: string;
}

/** `ipa init` with the real CLI, then `claude.command` pointed to the fake Claude CLI. */
export async function initProject(env: TestEnv, name = 'projekt', options: { fakeClaude?: boolean } = {}): Promise<InitializedProject> {
  const repo = await createRepo(env, name);
  const result = await runCli(env, repo.root, ['init', '--json']);
  if (result.exitCode !== 0) throw new Error(`init endete mit ${result.exitCode}: ${result.stderr}${result.stdout}`);
  const parsed = JSON.parse(result.stdout) as { result: { repositoryId: string; workspacePath: string } };
  const { repositoryId, workspacePath } = parsed.result;
  if (options.fakeClaude !== false) {
    const file = `${workspacePath}/config.json`;
    const config = JSON.parse(await readFile(file, 'utf8')) as { claude: Record<string, unknown> };
    config.claude['command'] = [process.execPath, FAKE_CLAUDE];
    await writeFile(file, JSON.stringify(config, null, 2));
    // `doctor` without --live calls no model; it records that the (fake) Claude is ready.
    const doctor = await runCli(env, repo.root, ['doctor', '--json']);
    if (doctor.exitCode !== 0) throw new Error(`doctor endete mit ${doctor.exitCode}: ${doctor.stderr}${doctor.stdout}`);
  }
  return { repo, repositoryId, workspacePath };
}

export async function readFakeCalls(env: TestEnv): Promise<{ kind: string; pid: number }[]> {
  const text = await readFile(env.fakeLog, 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as { kind: string; pid: number });
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function waitFor<T>(probe: () => Promise<T | null | undefined | false> | T | null | undefined | false, timeoutMs = 60_000, intervalMs = 100): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error('Zeitüberschreitung beim Warten');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Integrity of the examined repository (CLI spec §16.2, I-01). */
export async function fingerprintRepo(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const sha = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');
  async function walk(dir: string, relative: string): Promise<void> {
    for (const name of (await readdir(path.join(dir, relative))).sort()) {
      const rel = relative === '' ? name : `${relative}/${name}`;
      const full = path.join(dir, rel);
      const info = await lstat(full);
      if (info.isSymbolicLink()) result[rel] = `link:${await readlink(full)}`;
      else if (info.isDirectory()) await walk(dir, rel);
      else result[rel] = sha(await readFile(full));
    }
  }
  await walk(root, '');
  return result;
}

export async function appendLine(file: string, line: string): Promise<void> {
  await appendFile(file, `${line}\n`);
}
