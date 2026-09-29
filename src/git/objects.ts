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
