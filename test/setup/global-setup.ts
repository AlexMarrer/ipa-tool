/**
 * Global Vitest setup (spec.md §16.2):
 *
 * - `IPA_ASSISTANT_HOME`, `LOCALAPPDATA` and `XDG_DATA_HOME` point to a temp folder, so no test reaches
 *   the real data root.
 * - Git reads neither the system nor the user configuration of the machine.
 * - `dist/` is built because integration tests start the real CLI entry point.
 * - Afterwards the real data root must be unchanged.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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
  }
}

const execFileAsync = promisify(execFile);
const TOOL_ROOT = fileURLToPath(new URL('../../', import.meta.url));

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

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const realRoots = realDataRootCandidates(process.env);
  const before = await Promise.all(realRoots.map(describeDataRoot));

  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ipa-test-')));
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
