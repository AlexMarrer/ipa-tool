import { createHash } from 'node:crypto';
import { lstat, open, readFile, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { errnoCode } from '../core/errors.js';
import { comparisonKey, toPortablePath } from '../core/paths.js';

/** spec.md §14.5: a unit is binary if its first 8000 bytes contain a NUL byte. */
export const BINARY_PROBE_BYTES = 8000;

export type WorktreeRead =
  | { state: 'file'; content: Buffer; size: number; binary: boolean; executable: boolean; sha256: string }
  /** Larger than `maxFileBytes`: only the first bytes are read for the binary check. */
  | { state: 'large'; size: number; binary: boolean; executable: boolean; mtimeMs: number }
  | { state: 'symlink'; target: Buffer }
  /** A parent folder is a symlink or junction pointing elsewhere; nothing is read (D-20). */
  | { state: 'behind_link' }
  | { state: 'directory' }
  | { state: 'missing' }
  | { state: 'unreadable'; code: string };

export function isBinaryContent(content: Uint8Array): boolean {
  return content.subarray(0, BINARY_PROBE_BYTES).includes(0);
}

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

const UNREADABLE_CODES = new Set(['EACCES', 'EPERM', 'EBUSY', 'EISDIR', 'ELOOP', 'EINVAL']);

async function readProbe(file: string): Promise<Buffer> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(BINARY_PROBE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, BINARY_PROBE_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Reads worktree files without following links. Git for Windows lists files inside junctions, so
 * every parent folder is resolved and must stay inside the repository.
 */
export class WorktreeReader {
  private readonly parents = new Map<string, Promise<boolean>>();

  constructor(
    private readonly repoRoot: string,
    private readonly maxFileBytes: number,
  ) {}

  private parentInside(relativeDir: string): Promise<boolean> {
    let cached = this.parents.get(relativeDir);
    if (cached === undefined) {
      const expected = relativeDir === '' ? this.repoRoot : `${this.repoRoot}/${relativeDir}`;
      cached = realpath(expected).then(
        (real) => comparisonKey(toPortablePath(real)) === comparisonKey(expected),
        () => false,
      );
      this.parents.set(relativeDir, cached);
    }
    return cached;
  }

  async read(relativePath: string): Promise<WorktreeRead> {
    const absolute = path.join(this.repoRoot, relativePath);
    const slash = relativePath.lastIndexOf('/');
    try {
      const info = await lstat(absolute);
      if (!(await this.parentInside(slash < 0 ? '' : relativePath.slice(0, slash)))) return { state: 'behind_link' };
      if (info.isSymbolicLink()) return { state: 'symlink', target: await readlink(absolute, { encoding: 'buffer' }) };
      if (info.isDirectory()) return { state: 'directory' };
      if (!info.isFile()) return { state: 'unreadable', code: 'ESPECIAL' };
      const executable = process.platform !== 'win32' && (info.mode & 0o100) !== 0;
      if (info.size > this.maxFileBytes) {
        const probe = await readProbe(absolute);
        return { state: 'large', size: info.size, binary: isBinaryContent(probe), executable, mtimeMs: info.mtimeMs };
      }
      const content = await readFile(absolute);
      return { state: 'file', content, size: content.length, binary: isBinaryContent(content), executable, sha256: sha256Hex(content) };
    } catch (error) {
      const code = errnoCode(error);
      if (code === 'ENOENT' || code === 'ENOTDIR') return { state: 'missing' };
      if (code !== undefined && UNREADABLE_CODES.has(code)) return { state: 'unreadable', code };
      throw error;
    }
  }
}

/** Same observation as before? Used by the consistency check (spec.md §11.2). */
export function sameRead(before: WorktreeRead, after: WorktreeRead): boolean {
  if (before.state !== after.state) return false;
  switch (before.state) {
    case 'file':
      return after.state === 'file' && after.sha256 === before.sha256;
    case 'large':
      return after.state === 'large' && after.size === before.size && after.mtimeMs === before.mtimeMs;
    case 'symlink':
      return after.state === 'symlink' && after.target.equals(before.target);
    case 'unreadable':
      return after.state === 'unreadable' && after.code === before.code;
    default:
      return true;
  }
}
