/**
 * Object IDs without writing to the object database (D-05).
 */
import type { GitRunner } from './runner.js';

function objectId(stdout: Buffer): string {
  const id = stdout.toString('utf8').trim();
  if (!/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(id)) throw new Error(`Unerwartete Git-Ausgabe von hash-object: "${id.slice(0, 80)}"`);
  return id;
}

/** Blob ID of in-memory content; `path` selects the clean filters (autocrlf, attributes) like `git add`. */
export async function hashBlob(git: GitRunner, content: Uint8Array, path: string): Promise<string> {
  const result = await git.run(['hash-object', '--stdin', `--path=${path}`], { input: content });
  return objectId(result.stdout);
}

/** Blob ID of a symlink: Git stores the link target unfiltered. */
export async function hashSymlinkBlob(git: GitRunner, target: Uint8Array): Promise<string> {
  const result = await git.run(['hash-object', '--stdin', '--no-filters'], { input: target });
  return objectId(result.stdout);
}

/**
 * Blob ID of a file that is too large to load into memory. Git reads the regular file itself;
 * callers must have ruled out symlinks and paths outside the repository beforehand.
 */
export async function hashFileBlob(git: GitRunner, path: string, absolutePath: string): Promise<string> {
  const result = await git.run(['hash-object', `--path=${path}`, '--', absolutePath]);
  return objectId(result.stdout);
}

/** ID of the empty tree in the repository's hash format; diff base for root commits and unborn HEAD. */
export async function emptyTreeId(git: GitRunner): Promise<string> {
  const result = await git.run(['hash-object', '-t', 'tree', '--stdin'], { input: new Uint8Array() });
  return objectId(result.stdout);
}

/** Blob ID of `<rev>:<path>`, or null if the path does not exist in that commit. */
export async function blobAt(git: GitRunner, rev: string, path: string): Promise<string | null> {
  const result = await git.run(['rev-parse', '--verify', '-q', `${rev}:${path}`], { okExitCodes: [0, 1] });
  return result.exitCode === 0 ? objectId(result.stdout) : null;
}

/**
 * `blobAt` for many paths with one `cat-file --batch-check`. Paths with a line break cannot pass
 * through the line-based input and are looked up one by one.
 */
export async function blobsAt(git: GitRunner, rev: string, paths: readonly string[]): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const batch = paths.filter((path) => !path.includes('\n') && !path.includes('\r'));
  if (batch.length > 0) {
    const input = Buffer.from(batch.map((path) => `${rev}:${path}\n`).join(''), 'utf8');
    const lines = (await git.run(['cat-file', '--batch-check'], { input })).stdout.toString('utf8').split('\n');
    batch.forEach((path, index) => {
      const match = /^([0-9a-f]{40}|[0-9a-f]{64}) (\S+) \d+$/.exec(lines[index] ?? '');
      result.set(path, match !== null && match[2] !== 'tree' ? match[1]! : null);
    });
  }
  for (const path of paths) {
    if (!result.has(path)) result.set(path, await blobAt(git, rev, path));
  }
  return result;
}

/** Whether the object exists in the repository; `peel` checks the type as well, for example `commit`. */
export async function objectExists(git: GitRunner, id: string, peel?: 'commit'): Promise<boolean> {
  const result = await git.run(['cat-file', '-e', peel === undefined ? id : `${id}^{${peel}}`], { okExitCodes: [0, 1, 128] });
  return result.exitCode === 0;
}

export type StoredObject = { type: string; size: number; content: Buffer | null } | null;

/**
 * Reads objects with `cat-file --batch-check` and `--batch`. Content is loaded only for blobs up to
 * `maxBytes`; larger ones and other types come back with `content: null`, missing ones as `null`.
 */
export async function readObjects(git: GitRunner, ids: readonly string[], maxBytes: number): Promise<Map<string, StoredObject>> {
  const unique = [...new Set(ids)];
  const result = new Map<string, StoredObject>();
  if (unique.length === 0) return result;
  const check = await git.run(['cat-file', '--batch-check'], { input: Buffer.from(`${unique.join('\n')}\n`, 'utf8') });
  const lines = check.stdout.toString('utf8').split('\n');
  const load: string[] = [];
  unique.forEach((id, index) => {
    const match = /^([0-9a-f]+) (\S+) (\d+)$/.exec(lines[index] ?? '');
    if (match === null) {
      result.set(id, null);
      return;
    }
    const size = Number(match[3]);
    result.set(id, { type: match[2]!, size, content: null });
    if (match[2] === 'blob' && size <= maxBytes) load.push(id);
  });
  if (load.length === 0) return result;

  const batch = await git.run(['cat-file', '--batch'], { input: Buffer.from(`${load.join('\n')}\n`, 'utf8') });
  let offset = 0;
  for (const id of load) {
    const newline = batch.stdout.indexOf(0x0a, offset);
    const header = batch.stdout.subarray(offset, newline).toString('utf8');
    const match = /^([0-9a-f]+) (\S+) (\d+)$/.exec(header);
    if (newline < 0 || match === null) throw new Error(`Unerwartete Git-Ausgabe von cat-file --batch: "${header.slice(0, 80)}"`);
    const size = Number(match[3]);
    const start = newline + 1;
    result.set(id, { type: match[2]!, size, content: Buffer.from(batch.stdout.subarray(start, start + size)) });
    offset = start + size + 1;
  }
  return result;
}
