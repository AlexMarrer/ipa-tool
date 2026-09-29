/**
 * Paths use `/` internally (spec.md §2.3, §5.4). On Windows the drive letter is upper case and
 * comparisons ignore case.
 */
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { errnoCode } from './errors.js';

/** Backslashes → `/`, upper-case drive letter, no trailing `/` except for roots. */
export function toPortablePath(input: string): string {
  let result = input.replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(result)) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }
  const isRoot = result === '/' || /^[A-Z]:\/$/.test(result);
  if (!isRoot && result.length > 1) {
    result = result.replace(/\/+$/, '');
  }
  return result;
}

export function comparisonKey(input: string, platform: NodeJS.Platform = process.platform): string {
  const portable = toPortablePath(input);
  return platform === 'win32' ? portable.toLowerCase() : portable;
}

export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  return comparisonKey(a, platform) === comparisonKey(b, platform);
}

export function isSameOrInside(child: string, parent: string, platform: NodeJS.Platform = process.platform): boolean {
  const childKey = comparisonKey(child, platform);
  const parentKey = comparisonKey(parent, platform);
  if (childKey === parentKey) return true;
  const prefix = parentKey.endsWith('/') ? parentKey : `${parentKey}/`;
  return childKey.startsWith(prefix);
}

export function isStrictlyInside(child: string, parent: string, platform: NodeJS.Platform = process.platform): boolean {
  return isSameOrInside(child, parent, platform) && !samePath(child, parent, platform);
}

/**
 * Relative path with `/`, or `null` if `child` is not strictly inside `parent`. The letter case of
 * the result comes from `child`.
 */
export function relativeInside(child: string, parent: string, platform: NodeJS.Platform = process.platform): string | null {
  if (!isStrictlyInside(child, parent, platform)) return null;
  const portableChild = toPortablePath(child);
  const portableParent = toPortablePath(parent);
  const prefixLength = portableParent.endsWith('/') ? portableParent.length : portableParent.length + 1;
  return portableChild.slice(prefixLength);
}

/**
 * `realpath` of the nearest existing ancestor plus the part that does not exist yet.
 */
export async function canonicalizePath(input: string): Promise<string> {
  const absolute = path.resolve(input);
  const missing: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      const real = await realpath(current);
      const joined = missing.length === 0 ? real : path.join(real, ...[...missing].reverse());
      return toPortablePath(joined);
    } catch (error) {
      const code = errnoCode(error);
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        // Some drives do not support realpath; the lexical path is used then.
        return toPortablePath(absolute);
      }
      const parent = path.dirname(current);
      if (parent === current) return toPortablePath(absolute);
      missing.push(path.basename(current));
      current = parent;
    }
  }
}
