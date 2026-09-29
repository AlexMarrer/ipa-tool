import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOL_ROOT } from '../helpers/workspace.js';

const NOTES_DIR = path.join(TOOL_ROOT, 'src', 'notes');
const CORE_DIR = path.join(TOOL_ROOT, 'src', 'core');

// Static imports and re-exports (`from '…'`), side-effect imports (`import '…'`) and dynamic imports.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g;

function isInside(target: string, dir: string): boolean {
  const relative = path.relative(dir, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function importsOfNotes(): Promise<{ file: string; specifier: string }[]> {
  const files = (await readdir(NOTES_DIR)).filter((name) => name.endsWith('.ts'));
  const result: { file: string; specifier: string }[] = [];
  for (const file of files) {
    const source = await readFile(path.join(NOTES_DIR, file), 'utf8');
    for (const match of source.matchAll(SPECIFIER)) result.push({ file, specifier: match[1]! });
  }
  return result;
}

describe('Abhängigkeiten von src/notes/ (spec.md §4.3, D-23)', () => {
  it('importiert nur core, eigene Dateien und Node-Module (AK-04-08)', async () => {
    const imports = await importsOfNotes();
    // Guards against a pattern that silently matches nothing.
    expect(imports.some(({ specifier }) => specifier.startsWith('../core/'))).toBe(true);

    const violations = imports
      .filter(({ specifier }) => {
        if (specifier.startsWith('node:')) return false;
        if (!specifier.startsWith('.')) return true;
        const target = path.resolve(NOTES_DIR, specifier);
        return !isInside(target, CORE_DIR) && !isInside(target, NOTES_DIR);
      })
      .map(({ file, specifier }) => `${file}: ${specifier}`);
    expect(violations).toEqual([]);
  });
});
