import { spawn } from 'node:child_process';
import { utimes } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitRunner } from '../../src/git/runner.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const {
  buildGitEnv,
  buildGitInvocation,
  createGitRunner,
  GIT_GLOBAL_ARGS,
  GitCommandError,
  GitPolicyError,
  GitSpawnError,
  limitConcurrency,
  workspaceExcludeFor,
} = await import('../../src/git/runner.js');
const { createTempRepo } = await import('../helpers/git-repo.js');
const { fingerprintRepo, expectRepoUnchanged } = await import('../helpers/repo-fingerprint.js');

const EXCLUDE = ':(exclude,top,literal).ipa';

function lastSpawn(): { args: string[]; env: NodeJS.ProcessEnv } {
  const call = vi.mocked(spawn).mock.calls.at(-1);
  if (call === undefined) throw new Error('spawn wurde nicht aufgerufen');
  const [, args, options] = call as unknown as [string, string[], { env: NodeJS.ProcessEnv }];
  return { args, env: options.env };
}

describe('GitRunner (spec.md §14.2, AK-01-10)', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockClear();
  });

  it('lehnt nicht gelistete und schreibende Aufrufe ab, ohne einen Prozess zu starten', async () => {
    const repo = await createTempRepo();
    const git = createGitRunner(repo.root);
    const rejected: string[][] = [
      [],
      ['push'],
      ['commit', '-m', 'x'],
      ['checkout', 'main'],
      ['add', '.'],
      ['ls-tree', 'HEAD'],
      ['-c', 'core.pager=x', 'status'],
      ['hash-object', '-w', 'datei'],
      ['hash-object', '--write', 'datei'],
      ['hash-object', '--wr', 'datei'],
      ['hash-object', '-tw', 'datei'],
      ['config', 'user.email'],
      ['config', 'user.email', 'neu@example.invalid'],
      ['config', '--get', '--add', 'x'],
      ['config', '--unset', 'user.email'],
      ['symbolic-ref', 'HEAD', 'refs/heads/x'],
      ['symbolic-ref', '--short', 'HEAD'],
      ['merge-base', 'a', 'b'],
      ['merge-base', '--is-ancestor', '--octopus', 'b'],
      ['check-ignore', '.ipa'],
      ['check-ignore', '-q', '--stdin'],
      ['diff', '--output=x.patch'],
      ['log', '--output', 'x.txt'],
      ['show', '--outp=x'],
      ['diff', '--ext-diff'],
      ['diff', '--textconv'],
      ['--version', 'x'],
    ];
    for (const args of rejected) {
      await expect(git.run(args), args.join(' ')).rejects.toBeInstanceOf(GitPolicyError);
    }
    expect(spawn).not.toHaveBeenCalled();
  });

  it('erlaubt die Leseliste mit ihren Einschränkungen', () => {
    const allowed: string[][] = [
      ['rev-parse', '--show-toplevel'],
      ['rev-list', '--reverse', 'HEAD'],
      ['cat-file', '-t', 'HEAD'],
      ['show', 'HEAD'],
      ['log', '-z', '--format=%H', '--oneline'],
      ['diff', '--cached', '--output-indicator-new=+'],
      ['ls-files', '-s', '-z'],
      ['status', '--porcelain=v2', '-z'],
      ['symbolic-ref', '-q', '--short', 'HEAD'],
      ['merge-base', '--is-ancestor', 'a1', 'b2'],
      ['hash-object', '--stdin', '--path=src/x.ts'],
      ['config', '--get', 'user.email'],
      ['config', '--get', '--local', '--null', 'user.email'],
      ['check-ignore', '-q', '--', '.ipa'],
      ['--version'],
    ];
    for (const args of allowed) {
      expect(() => buildGitInvocation(args, null), args.join(' ')).not.toThrow();
    }
  });

  it('setzt die Pflichtoptionen vor jeden Unterbefehl und schaltet Diff-Erweiterungen ab', () => {
    expect(buildGitInvocation(['status', '--porcelain=v2'], null)).toEqual([...GIT_GLOBAL_ARGS, 'status', '--porcelain=v2']);
    expect(GIT_GLOBAL_ARGS).toEqual([
      '--no-pager',
      '-c',
      'core.quotepath=off',
      '-c',
      'color.ui=never',
      '-c',
      'core.fsmonitor=false',
      '-c',
      'diff.autoRefreshIndex=false',
    ]);
    for (const sub of ['diff', 'show', 'log']) {
      expect(buildGitInvocation([sub, 'HEAD'], null)).toEqual([...GIT_GLOBAL_ARGS, sub, '--no-ext-diff', '--no-textconv', 'HEAD']);
    }
  });

  it('hängt bei einem Arbeitsbereich im Repository die Ausschluss-Pathspec an', () => {
    expect(buildGitInvocation(['status', '--porcelain=v2', '-z'], '.ipa').slice(-2)).toEqual(['--', EXCLUDE]);
    expect(buildGitInvocation(['ls-files', '-s', '-z'], '.ipa').slice(-2)).toEqual(['--', EXCLUDE]);
    expect(buildGitInvocation(['diff', '--cached', '--raw'], '.ipa').slice(-2)).toEqual(['--', EXCLUDE]);
    expect(buildGitInvocation(['diff', 'HEAD', '--', 'src'], '.ipa').slice(-3)).toEqual(['--', 'src', EXCLUDE]);
    expect(buildGitInvocation(['diff', '--no-index', 'a', 'b'], '.ipa')).not.toContain(EXCLUDE);
    expect(buildGitInvocation(['show', 'HEAD:datei'], '.ipa')).not.toContain(EXCLUDE);
    expect(buildGitInvocation(['status'], null)).not.toContain(EXCLUDE);
  });

  it('erkennt, ob der Arbeitsbereich im Repository liegt', () => {
    expect(workspaceExcludeFor('C:/repo', 'C:/repo/.ipa', 'win32')).toBe('.ipa');
    expect(workspaceExcludeFor('C:/repo', 'c:/REPO/tools/.ipa', 'win32')).toBe('tools/.ipa');
    expect(workspaceExcludeFor('C:/repo', 'C:/daten/ws', 'win32')).toBeNull();
    expect(workspaceExcludeFor('C:/repo', 'C:/repo2/.ipa', 'win32')).toBeNull();
    expect(workspaceExcludeFor('C:/repo', undefined, 'win32')).toBeNull();
  });

  it('entfernt Repository-Umleitungen aus der Umgebung und setzt GIT_OPTIONAL_LOCKS=0', () => {
    const env = buildGitEnv(
      { PATH: 'x', GIT_DIR: 'a', Git_Work_Tree: 'b', GIT_INDEX_FILE: 'c', GIT_OBJECT_DIRECTORY: 'd', GIT_OPTIONAL_LOCKS: '1', HOME: 'h' },
      'win32',
    );
    expect(env).toEqual({ PATH: 'x', HOME: 'h', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' });
    expect(buildGitEnv({ git_dir: 'kleingeschrieben' }, 'linux')).toMatchObject({ git_dir: 'kleingeschrieben' });
  });

  it('startet Git ohne Shell mit bereinigter Umgebung, auch wenn GIT_DIR gesetzt ist', async () => {
    const repo = await createTempRepo();
    const saved = { GIT_DIR: process.env['GIT_DIR'], GIT_INDEX_FILE: process.env['GIT_INDEX_FILE'] };
    process.env['GIT_DIR'] = 'C:/gibt/es/nicht/.git';
    process.env['GIT_INDEX_FILE'] = 'C:/gibt/es/nicht/index';
    try {
      const result = await createGitRunner(repo.root).run(['rev-parse', '--show-toplevel']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString('utf8').trim().toLowerCase()).toBe(repo.root.toLowerCase());
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    const { args, env } = lastSpawn();
    expect(args.slice(0, GIT_GLOBAL_ARGS.length)).toEqual([...GIT_GLOBAL_ARGS]);
    expect(env['GIT_OPTIONAL_LOCKS']).toBe('0');
    expect(env['GIT_TERMINAL_PROMPT']).toBe('0');
    expect(Object.keys(env).map((key) => key.toUpperCase())).not.toContain('GIT_DIR');
    expect(Object.keys(env).map((key) => key.toUpperCase())).not.toContain('GIT_INDEX_FILE');
    const options = vi.mocked(spawn).mock.calls.at(-1)?.[2] as { shell?: boolean } | undefined;
    expect(options?.shell).toBe(false);
  });

  it('blendet einen Arbeitsbereich im Repository in status und ls-files aus', async () => {
    const repo = await createTempRepo();
    await repo.write('.ipa/versioniert.txt', 'x');
    await repo.commit('Arbeitsbereich versehentlich committet');
    await repo.write('.ipa/tmp/neu.txt', 'y');
    await repo.write('src/neu.txt', 'z');
    const before = await fingerprintRepo(repo.root, { workspace: '.ipa' });

    const git = createGitRunner(repo.root, { workspaceDir: `${repo.root}/.ipa` });
    const status = (await git.run(['status', '--porcelain=v2', '-z', '--untracked-files=all'])).stdout.toString('utf8');
    expect(status).toContain('src/neu.txt');
    expect(status).not.toContain('.ipa');
    const files = (await git.run(['ls-files', '-s', '-z'])).stdout.toString('utf8');
    expect(files).toContain('README.md');
    expect(files).not.toContain('.ipa');

    const unfiltered = (await createGitRunner(repo.root).run(['ls-files', '-z'])).stdout.toString('utf8');
    expect(unfiltered).toContain('.ipa/versioniert.txt');
    expectRepoUnchanged(before, await fingerprintRepo(repo.root, { workspace: '.ipa' }));
  });

  it('schreibt .git/index bei einem Diff gegen den Working Tree nicht neu, auch nach reinen Zeitstempeländerungen (I-01)', async () => {
    const repo = await createTempRepo({ files: { 'a.txt': 'eins\n', 'b.txt': 'zwei\n' } });
    // Without diff.autoRefreshIndex=false, git diff refreshes the index after stat-only changes.
    const later = new Date(Date.now() + 60_000);
    await utimes(`${repo.root}/a.txt`, later, later);
    await repo.write('b.txt', 'zwei\ngeändert\n');
    const before = await fingerprintRepo(repo.root);

    const git = createGitRunner(repo.root);
    for (const args of [['diff', '--raw', '-z'], ['diff', '--numstat', '-z'], ['diff', '-p'], ['status', '--porcelain=v2', '-z']]) {
      await git.run(args);
    }
    expectRepoUnchanged(before, await fingerprintRepo(repo.root));
  });

  it('begrenzt mit limitConcurrency die gleichzeitig laufenden Git-Prozesse, auch wenn Aufrufe scheitern', async () => {
    let active = 0;
    let peak = 0;
    const slow: GitRunner = {
      async run(args) {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        if (args[0] === 'fehler') throw new Error('gescheitert');
        return { stdout: Buffer.alloc(0), stderr: '', exitCode: 0 };
      },
    };
    const limited = limitConcurrency(slow, 3);
    const calls = Array.from({ length: 20 }, (_, index) => limited.run([index % 5 === 0 ? 'fehler' : 'status']).catch(() => 'abgelehnt'));
    const results = await Promise.all(calls);
    expect(peak).toBe(3);
    expect(results.filter((result) => result === 'abgelehnt')).toHaveLength(4);
    await expect(limited.run(['status'])).resolves.toMatchObject({ exitCode: 0 });
  });

  it('meldet Git-Fehler und erlaubte Exit-Codes', async () => {
    const repo = await createTempRepo();
    const git = createGitRunner(repo.root);
    await expect(git.run(['rev-parse', '--verify', '-q', 'gibt-es-nicht'])).rejects.toBeInstanceOf(GitCommandError);
    const result = await git.run(['rev-parse', '--verify', '-q', 'gibt-es-nicht'], { okExitCodes: [0, 1] });
    expect(result.exitCode).toBe(1);
    const hashed = await git.run(['hash-object', '--stdin'], { input: new TextEncoder().encode('hallo\n') });
    expect(hashed.stdout.toString('utf8').trim()).toMatch(/^[0-9a-f]{40}$/);
  });

  it('meldet ein fehlendes Git als GitSpawnError', async () => {
    const repo = await createTempRepo();
    const savedPath = process.env['PATH'];
    process.env['PATH'] = '';
    try {
      await expect(createGitRunner(repo.root).run(['--version'])).rejects.toMatchObject({ code: 'git_not_found' });
      await expect(createGitRunner(repo.root).run(['--version'])).rejects.toBeInstanceOf(GitSpawnError);
    } finally {
      process.env['PATH'] = savedPath;
    }
  });
});
