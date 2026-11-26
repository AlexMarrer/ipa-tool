import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWatcher, type Watcher } from '../../src/main/watch/watcher';
import { waitFor } from '../helpers/env';

describe('Dateibeobachtung (AK-10-34)', () => {
  let dir: string;
  let watcher: Watcher | null = null;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ipa-watch-'));
  });
  afterEach(async () => {
    watcher?.close();
    watcher = null;
    await rm(dir, { recursive: true, force: true });
  });

  it('meldet geänderte Pfade entprellt und mit relativen /-Pfaden', async () => {
    const batches: string[][] = [];
    watcher = createWatcher({ root: dir, onPaths: (paths) => batches.push(paths), debounceMs: 50, pollMs: 60_000 });
    await mkdir(path.join(dir, 'snapshots', 'S000002'), { recursive: true });
    await writeFile(path.join(dir, 'snapshots', 'S000002', 'manifest.json'), '{}');
    await writeFile(path.join(dir, 'state.json'), '{}');
    const all = await waitFor(() => {
      const flat = batches.flat();
      return flat.includes('snapshots/S000002/manifest.json') && flat.includes('state.json') ? flat : null;
    }, 2_000);
    expect(all.every((entry) => !entry.includes('\\'))).toBe(true);
    // Several writes within the debounce window arrive as one batch.
    expect(batches.length).toBeLessThanOrEqual(all.length);
  });

  it('erkennt Änderungen wichtiger Dateien auch bei verlorenen Dateiereignissen über die Abfrage', async () => {
    await writeFile(path.join(dir, 'state.json'), 'a');
    const seen: string[] = [];
    // A watch function that never reports anything simulates lost events (spec AO-12).
    const silentWatch = (() => ({ on: () => undefined, close: () => undefined })) as unknown as typeof import('node:fs').watch;
    watcher = createWatcher({ root: dir, onPaths: (paths) => seen.push(...paths), debounceMs: 20, pollMs: 100, pollFiles: ['state.json', 'lock'], watchFn: silentWatch });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await writeFile(path.join(dir, 'state.json'), 'geändert und länger');
    await writeFile(path.join(dir, 'lock'), '{}');
    await waitFor(() => (seen.includes('state.json') && seen.includes('lock') ? true : null), 2_000);
  });

  it('meldet Ausfall der Beobachtung', async () => {
    const health: boolean[] = [];
    watcher = createWatcher({ root: path.join(dir, 'gibt-es-nicht'), onPaths: () => undefined, onHealth: (healthy) => health.push(healthy), pollMs: 60_000 });
    expect(health).toContain(false);
  });

  it('meldet nach close() nichts mehr', async () => {
    const seen: string[] = [];
    watcher = createWatcher({ root: dir, onPaths: (paths) => seen.push(...paths), debounceMs: 30, pollMs: 60_000 });
    watcher.close();
    await writeFile(path.join(dir, 'x.txt'), 'x');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(seen).toEqual([]);
  });
});
