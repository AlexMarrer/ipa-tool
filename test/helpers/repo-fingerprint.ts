/**
 * Integrity of the examined repository (spec.md §16.2, I-01): SHA-256 of `.git/index`, `HEAD`, all refs,
 * `packed-refs`, `config`, `info/exclude`, the list of object files and every worktree file outside
 * `.git/`. A workspace inside the repository is recorded separately, since only it may change.
 */
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';

export interface RepoFingerprint {
  /** Without the workspace; keys `git:<file>` and `wt:<path>`. */
  repo: Record<string, string>;
  workspace: Record<string, string> | null;
}

export interface FingerprintOptions {
  /** Workspace inside the repository, relative to the root or absolute. */
  workspace?: string;
}

const sha256 = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');

async function hashFileOrMissing(file: string): Promise<string> {
  try {
    return sha256(await readFile(file));
  } catch {
    return 'fehlt';
  }
}

async function listFiles(dir: string, relative = ''): Promise<string[]> {
  let names: string[];
  try {
    names = (await readdir(path.join(dir, relative))).sort();
  } catch {
    return [];
  }
  const result: string[] = [];
  for (const name of names) {
    const rel = relative === '' ? name : `${relative}/${name}`;
    const info = await lstat(path.join(dir, rel));
    if (info.isDirectory()) result.push(...(await listFiles(dir, rel)));
    else result.push(rel);
  }
  return result;
}

function normalizeKey(p: string): string {
  const slashed = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed;
}

async function hashTree(
  root: string,
  relative: string,
  skip: (rel: string) => boolean,
  into: Record<string, string>,
  prefix: string,
): Promise<void> {
  const names = (await readdir(path.join(root, relative))).sort();
  for (const name of names) {
    const rel = relative === '' ? name : `${relative}/${name}`;
    if (skip(rel)) continue;
    const full = path.join(root, rel);
    const info = await lstat(full);
    if (info.isSymbolicLink()) {
      into[`${prefix}${rel}`] = `link:${await readlink(full)}`;
    } else if (info.isDirectory()) {
      into[`${prefix}${rel}/`] = 'dir';
      await hashTree(root, rel, skip, into, prefix);
    } else {
      into[`${prefix}${rel}`] = sha256(await readFile(full));
    }
  }
}

export async function fingerprintRepo(root: string, options: FingerprintOptions = {}): Promise<RepoFingerprint> {
  const gitDir = path.join(root, '.git');
  const repo: Record<string, string> = {};
  for (const file of ['index', 'HEAD', 'packed-refs', 'config', 'info/exclude']) {
    repo[`git:${file}`] = await hashFileOrMissing(path.join(gitDir, file));
  }
  for (const ref of await listFiles(path.join(gitDir, 'refs'))) {
    repo[`git:refs/${ref}`] = await hashFileOrMissing(path.join(gitDir, 'refs', ref));
  }
  repo['git:objects'] = sha256((await listFiles(path.join(gitDir, 'objects'))).join('\n'));

  let workspaceRel: string | null = null;
  if (options.workspace !== undefined) {
    const absolute = path.resolve(root, options.workspace);
    const rel = path.relative(root, absolute);
    if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)) workspaceRel = normalizeKey(rel);
  }
  const isWorkspace = (rel: string): boolean => {
    if (workspaceRel === null) return false;
    const key = normalizeKey(rel);
    return key === workspaceRel || key.startsWith(`${workspaceRel}/`);
  };

  await hashTree(root, '', (rel) => normalizeKey(rel) === '.git' || isWorkspace(rel), repo, 'wt:');

  let workspace: Record<string, string> | null = null;
  if (workspaceRel !== null) {
    workspace = {};
    try {
      await hashTree(path.resolve(root, options.workspace ?? ''), '', () => false, workspace, '');
    } catch {
      // The workspace does not exist yet.
    }
  }
  return { repo, workspace };
}

/** Changed keys outside the workspace. */
export function diffFingerprints(before: RepoFingerprint, after: RepoFingerprint): string[] {
  const keys = new Set([...Object.keys(before.repo), ...Object.keys(after.repo)]);
  return [...keys].sort().filter((key) => before.repo[key] !== after.repo[key]);
}

export function expectRepoUnchanged(before: RepoFingerprint, after: RepoFingerprint): void {
  expect(diffFingerprints(before, after), 'Repository ausserhalb des Arbeitsbereichs verändert').toEqual([]);
}
