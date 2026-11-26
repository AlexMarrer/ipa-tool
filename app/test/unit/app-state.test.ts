import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppStateStore, defaultAppState, sanitizeAppState } from '../../src/main/app-state';

describe('app-state.json (AK-10-14)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ipa-state-'));
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it('startet ohne Datei mit den Standardwerten', async () => {
    expect(await createAppStateStore(dir).load()).toEqual(defaultAppState());
  });

  it('ersetzt eine defekte Datei ohne Fehler', async () => {
    await writeFile(path.join(dir, 'app-state.json'), '{kaputt');
    const store = createAppStateStore(dir);
    expect(await store.load()).toEqual(defaultAppState());
    await store.update({ selection: { section: 'day' } });
    expect(JSON.parse(await readFile(path.join(dir, 'app-state.json'), 'utf8'))).toMatchObject({ selection: { section: 'day' } });
  });

  it('speichert Fenster und Auswahl und liest sie wieder', async () => {
    const store = createAppStateStore(dir);
    await store.load();
    await store.update({ window: { x: 10, y: 20, width: 1300, height: 800, maximized: true }, selection: { repositoryId: 'p-123456', section: 'schedule', day: '2026-11-25' } });
    const reloaded = await createAppStateStore(dir).load();
    expect(reloaded.window).toEqual({ x: 10, y: 20, width: 1300, height: 800, maximized: true });
    expect(reloaded.selection).toEqual({ repositoryId: 'p-123456', section: 'schedule', day: '2026-11-25' });
  });

  it('enthält nie Projektkonfiguration: fremde Schlüssel fallen weg', async () => {
    await writeFile(
      path.join(dir, 'app-state.json'),
      JSON.stringify({ ...defaultAppState(), projects: { x: { claude: { allowPaidUsage: true } } }, config: { limits: 1 }, selection: { repositoryId: 'a', section: 'overview', day: null, limits: 5 } }),
    );
    const state = await createAppStateStore(dir).load();
    expect(Object.keys(state).sort()).toEqual(['schemaVersion', 'selection', 'theme', 'window']);
    expect(Object.keys(state.selection).sort()).toEqual(['day', 'repositoryId', 'section']);
    const store = createAppStateStore(dir);
    await store.load();
    await store.update({ selection: { repositoryId: 'b' } });
    expect(await readFile(path.join(dir, 'app-state.json'), 'utf8')).not.toMatch(/allowPaidUsage|limits/);
  });

  it('bereinigt ungültige Werte einzeln und hält die Mindestgrösse ein', () => {
    const state = sanitizeAppState({ window: { width: 200, height: 'hoch', x: 'a', y: 5 }, selection: { section: 'geheim', day: '2026-13-40', repositoryId: 7 } });
    expect(state.window).toMatchObject({ width: 1100, height: 800, x: null, y: null });
    expect(state.selection).toEqual({ repositoryId: null, section: 'overview', day: null });
    expect(sanitizeAppState('text')).toEqual(defaultAppState());
    expect(sanitizeAppState(null)).toEqual(defaultAppState());
  });
});

describe('Darstellung (System, Hell, Dunkel)', () => {
  it('beginnt mit der Einstellung von Windows und kennt nur drei Werte', () => {
    expect(defaultAppState().theme).toBe('system');
    for (const theme of ['system', 'light', 'dark']) expect(sanitizeAppState({ theme }).theme).toBe(theme);
    for (const bad of ['', 'Dunkel', 'auto', 'DARK', 1, null, {}, ['dark']]) expect(sanitizeAppState({ theme: bad }).theme, String(bad)).toBe('system');
  });

  it('übernimmt eine alte Datei ohne Darstellung mit dem Standard', () => {
    expect(sanitizeAppState({ schemaVersion: 1, window: {}, selection: {} }).theme).toBe('system');
  });

  it('speichert die Wahl und liest sie beim nächsten Start', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ipa-theme-'));
    try {
      const store = createAppStateStore(dir);
      await store.load();
      await store.update({ theme: 'dark' });
      expect(JSON.parse(await readFile(path.join(dir, 'app-state.json'), 'utf8')).theme).toBe('dark');
      expect((await createAppStateStore(dir).load()).theme).toBe('dark');
      // A patch without a theme keeps it.
      await store.update({ selection: { repositoryId: 'a-111111' } });
      expect(store.get().theme).toBe('dark');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
