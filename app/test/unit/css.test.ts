import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_ROOT } from '../helpers/env';

/** Class names live in one global namespace; two files defining the same layout class break each other. */
describe('CSS-Klassen kollidieren nicht', () => {
  const dir = path.join(APP_ROOT, 'src', 'renderer');
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.css')) files.push(full);
    }
  };
  walk(dir);

  it('definiert jede Klasse als Hauptselektor nur in einer Datei', () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const file of files) {
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      // Top-level selectors of the form `.name {` (no descendant, no pseudo) make a file the owner of a class.
      for (const match of css.matchAll(/(?:^|\})\s*\.([a-z][a-z0-9-]*)\s*\{/g)) {
        const name = match[1] as string;
        const previous = owner.get(name);
        if (previous !== undefined && previous !== file) clashes.push(`.${name}: ${path.relative(dir, previous)} und ${path.relative(dir, file)}`);
        else owner.set(name, file);
      }
    }
    expect(clashes).toEqual([]);
  });
});
