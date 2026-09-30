/**
 * Global Vitest setup (spec.md §16.2):
 *
 * - `IPA_ASSISTANT_HOME`, `LOCALAPPDATA` and `XDG_DATA_HOME` point to a temp folder, so no test reaches
 *   the real data root.
 * - Git reads neither the system nor the user configuration of the machine.
 * - In the test processes `claude` is not on the PATH, so no automatic test can start the real Claude
 *   Code, and the temp directory (and with it the Claude working directory, D-22) lies in the test folder.
 *   `CLAUDE_CONFIG_DIR` points to an empty folder, so the Claude user settings of the machine do not reach
 *   the billing guard; managed settings of the machine still do.
 * - `dist/` is built because integration tests start the real CLI entry point.
 * - Afterwards the real data root must be unchanged.
 *
 * The live tests (`npm run test:live`) use the same setup but keep the real `claude` on the PATH.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    ipaTestRoot: string;
    ipaTestEnv: Record<string, string>;
    /** Real data root locations that no test may touch. */
    ipaRealDataRoots: string[];
    /** Only for the test processes: PATH without `claude` and a temp directory in the test folder. */
    ipaWorkerEnv: Record<string, string>;
    /** The temp directory of the machine, before the redirection. */
    ipaSystemTmpDir: string;
    /** `claude` was removed from the PATH of the test processes. */
    ipaClaudeHidden: boolean;
  }
}

const execFileAsync = promisify(execFile);
const TOOL_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** File names under which Claude Code may be installed. */
export const CLAUDE_EXECUTABLE = /^claude(\.(exe|cmd|bat|com|ps1))?$/i;

/**
 * PATH without any Claude Code executable. A folder that contains one is replaced by a folder of links
 * to its other entries, so that for example Git stays reachable when it lies next to `claude`.
 */
async function pathWithoutClaude(pathValue: string, root: string): Promise<string> {
  const result: string[] = [];
  for (const [index, dir] of pathValue.split(path.delimiter).entries()) {
    if (dir === '') continue;
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      result.push(dir);
      continue;
    }
    if (!names.some((name) => CLAUDE_EXECUTABLE.test(name))) {
      result.push(dir);
      continue;
    }
    const shadow = path.join(root, 'path-ohne-claude', String(index));
    await mkdir(shadow, { recursive: true });
    for (const name of names.filter((candidate) => !CLAUDE_EXECUTABLE.test(candidate))) {
      const target = path.join(dir, name);
      const entry = path.join(shadow, name);
      // Windows allows symbolic links only in developer mode; a hard link works for files without it.
      await symlink(target, entry).catch(() => link(target, entry).catch(() => undefined));
    }
    result.push(shadow);
  }
  for (const dir of result) {
    const names = await readdir(dir).catch(() => [] as string[]);
    if (names.some((name) => CLAUDE_EXECUTABLE.test(name))) {
      throw new Error(`Claude Code bleibt für die Tests erreichbar: ${dir}`);
    }
  }
  return result.join(path.delimiter);
}

/** Where the tool would create its data root outside the tests. */
function realDataRootCandidates(env: NodeJS.ProcessEnv): string[] {
  const candidates: string[] = [];
  if (env['IPA_ASSISTANT_HOME']) candidates.push(path.resolve(env['IPA_ASSISTANT_HOME']));
  if (process.platform === 'win32') {
    if (env['LOCALAPPDATA']) candidates.push(path.join(env['LOCALAPPDATA'], 'ipa-assistant'));
  } else if (process.platform === 'darwin') {
    candidates.push(path.join(os.homedir(), 'Library', 'Application Support', 'ipa-assistant'));
  } else {
    candidates.push(path.join(env['XDG_DATA_HOME'] || path.join(os.homedir(), '.local', 'share'), 'ipa-assistant'));
  }
  return candidates;
}

/** Existence, registry hash and workspace names of a data root. */
async function describeDataRoot(dir: string): Promise<string> {
  let names: string[];
  try {
    names = (await readdir(dir)).sort();
  } catch {
    return 'fehlt';
  }
  let registry = 'keine';
  try {
    registry = createHash('sha256').update(await readFile(path.join(dir, 'registry.json'))).digest('hex');
  } catch {
    // no registry
  }
  let workspaces: string[] = [];
  try {
    workspaces = (await readdir(path.join(dir, 'workspaces'))).sort();
  } catch {
    // no workspaces
  }
  return JSON.stringify({ names, registry, workspaces });
}

export interface SetupOptions {
  /** Removes `claude` from the PATH of the test processes; only the live tests keep it. */
  hideClaude: boolean;
}

export function createSetup(options: SetupOptions): (project: TestProject) => Promise<() => Promise<void>> {
  return (project) => setup(project, options);
}

async function setup(project: TestProject, options: SetupOptions): Promise<() => Promise<void>> {
  const realRoots = realDataRootCandidates(process.env);
  const before = await Promise.all(realRoots.map(describeDataRoot));

  const systemTmpDir = await realpath(os.tmpdir());
  const root = await realpath(await mkdtemp(path.join(systemTmpDir, 'ipa-test-')));
  const env: Record<string, string> = {
    IPA_ASSISTANT_HOME: path.join(root, 'ipa-home'),
    LOCALAPPDATA: path.join(root, 'localappdata'),
    XDG_DATA_HOME: path.join(root, 'xdg-data'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(root, 'gitconfig-global'),
    // Git does not look for repositories above the test folder.
    GIT_CEILING_DIRECTORIES: root,
  };
  await writeFile(env['GIT_CONFIG_GLOBAL']!, '');
  Object.assign(process.env, env);
  project.provide('ipaTestRoot', root);
  project.provide('ipaTestEnv', env);
  project.provide('ipaRealDataRoots', realRoots);

  // Applied only in the test processes (test-env.ts), so that Vitest itself keeps its temp directory.
  const tmp = path.join(root, 'tmp');
  await mkdir(tmp);
  const workerEnv: Record<string, string> = { TMPDIR: tmp, TMP: tmp, TEMP: tmp };
  if (options.hideClaude) {
    workerEnv['PATH'] = await pathWithoutClaude(process.env['PATH'] ?? '', root);
    // The billing guard reads the Claude settings; the ones of the machine must not decide a test.
    workerEnv['CLAUDE_CONFIG_DIR'] = path.join(root, 'claude-konfig');
    await mkdir(workerEnv['CLAUDE_CONFIG_DIR']);
  }
  project.provide('ipaWorkerEnv', workerEnv);
  project.provide('ipaSystemTmpDir', systemTmpDir);
  project.provide('ipaClaudeHidden', options.hideClaude);

  await execFileAsync(process.execPath, [path.join(TOOL_ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json'], {
    cwd: TOOL_ROOT,
    windowsHide: true,
  });

  return async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    const after = await Promise.all(realRoots.map(describeDataRoot));
    realRoots.forEach((dir, index) => {
      if (before[index] !== after[index]) {
        throw new Error(`Die echte Datenwurzel wurde während der Tests verändert: ${dir}`);
      }
    });
  };
}

export default createSetup({ hideClaude: true });
