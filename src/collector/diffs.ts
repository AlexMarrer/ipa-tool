import { type ChangeLetter, parseNumstatZ, parseRawZ, type RawDiffEntry, splitPatch } from '../git/parse-diff.js';
import { isNullObjectId } from '../git/parse-status.js';
import type { GitRunner } from '../git/runner.js';
import type { ChangeType, Omission } from './types.js';

export const SYMLINK_MODE = '120000';
export const SUBMODULE_MODE = '160000';

export interface DiffUnit {
  /** Destination path; for deletions the deleted path. */
  path: string;
  oldPath: string | null;
  change: ChangeType;
  dstBlob: string | null;
  binary: boolean;
  /** Patch section, or null when the unit is omitted. */
  content: Buffer | null;
  omitted: Omission | null;
}

// Stays below the Windows command line limit of 32767 characters.
const MAX_PATHSPEC_CHARS = 24_000;

export function literalPathspec(path: string): string {
  return `:(top,literal)${path}`;
}

/** Splits pathspecs into command lines of bounded length. Renames across two chunks degrade to D + A. */
export function chunkPathspecs(paths: readonly string[], maxChars = MAX_PATHSPEC_CHARS): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const path of paths) {
    const spec = literalPathspec(path);
    if (current.length > 0 && length + spec.length + 1 > maxChars) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(spec);
    length += spec.length + 1;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

const CHANGE_TYPES: ReadonlySet<ChangeLetter> = new Set(['A', 'C', 'D', 'M', 'R', 'T']);

export interface DescribeOptions {
  /** Rename detection among the given paths only; a rename from a path outside the list becomes an addition (spec.md §14.3). */
  renames: boolean;
}

/**
 * Change list, binary flags and per-file patches for `range` (`[]` = index vs. worktree,
 * `['--cached', base]`, `[from, to]`), restricted to `paths`. Unmerged entries are skipped.
 */
export async function describeDiff(git: GitRunner, range: readonly string[], paths: readonly string[], options: DescribeOptions): Promise<DiffUnit[]> {
  if (paths.length === 0) return [];
  const renameArg = options.renames ? '-M' : '--no-renames';

  const entries: RawDiffEntry[] = [];
  const binary = new Set<string>();
  const sections = new Map<string, Buffer[]>();
  for (const chunk of chunkPathspecs(paths)) {
    // Same pathspec and rename option, so all three agree on the pairing of renames. Binary and
    // symlink sections of the patch are dropped below.
    const [raw, numstat, patch] = await Promise.all([
      git.run(['diff', ...range, '--raw', '-z', '--no-abbrev', renameArg, '--', ...chunk]),
      git.run(['diff', ...range, '--numstat', '-z', renameArg, '--', ...chunk]),
      git.run(['diff', ...range, '-p', '--full-index', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', '--submodule=short', renameArg, '--', ...chunk]),
    ]);
    entries.push(...parseRawZ(raw.stdout));
    for (const entry of parseNumstatZ(numstat.stdout)) if (entry.binary) binary.add(entry.path);
    for (const section of splitPatch(patch.stdout)) {
      const key = section.newPath ?? section.oldPath;
      if (key === null) continue;
      // A type change yields two sections for the same path.
      sections.set(key, [...(sections.get(key) ?? []), section.content]);
    }
  }

  const relevant = entries.filter((entry) => CHANGE_TYPES.has(entry.status));
  const isSymlink = (entry: RawDiffEntry) => entry.srcMode === SYMLINK_MODE || entry.dstMode === SYMLINK_MODE;

  return relevant.map((entry) => {
    const symlink = isSymlink(entry);
    const isBinary = binary.has(entry.path);
    const parts = sections.get(entry.path);
    let omitted: Omission | null = null;
    if (symlink) omitted = { reason: 'symlink' };
    else if (isBinary) omitted = { reason: 'binary' };
    return {
      path: entry.path,
      oldPath: entry.oldPath,
      change: entry.status as ChangeType,
      dstBlob: entry.status === 'D' || isNullObjectId(entry.dstBlob) ? null : entry.dstBlob,
      binary: isBinary,
      content: omitted === null ? Buffer.concat(parts ?? []) : null,
      omitted,
    };
  });
}
