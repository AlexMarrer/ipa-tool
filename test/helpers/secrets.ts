/**
 * Artificial secrets for tests (spec.md §16.2); never real credentials.
 */
import { randomBytes } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export function createSecretMarker(): string {
  return `IPA_TEST_SECRET_${randomBytes(8).toString('hex')}`;
}

/** A line the `assignment` detector recognises. */
export function secretAssignment(marker: string): string {
  return `api_key = "${marker}"`;
}

/** Files below `root` (recursively, links not followed) whose bytes contain `needle`. */
export async function filesContaining(root: string, needle: string): Promise<string[]> {
  const bytes = Buffer.from(needle, 'utf8');
  const hits: string[] = [];
  async function walk(dir: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = path.join(dir, name);
      const info = await lstat(full);
      if (info.isDirectory()) await walk(full);
      else if (info.isFile() && (await readFile(full)).includes(bytes)) hits.push(full);
    }
  }
  await walk(root);
  return hits;
}
