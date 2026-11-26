import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDay } from '../shared/dates';
import type { AppState, Section } from '../shared/types';

const SECTIONS: readonly Section[] = ['overview', 'day', 'schedule', 'config'];
export const MIN_WIDTH = 1100;
export const MIN_HEIGHT = 700;

export function defaultAppState(): AppState {
  return {
    schemaVersion: 1,
    window: { x: null, y: null, width: 1280, height: 800, maximized: false },
    selection: { repositoryId: null, section: 'overview', day: null },
  };
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * Takes what can be used from an untrusted value and fills the rest with defaults, so a defect or unknown file
 * is replaced without an error (AK-10-14). Only window state and last selection survive; every other key,
 * for example project configuration, is dropped (spec §12.4).
 */
export function sanitizeAppState(value: unknown): AppState {
  const result = defaultAppState();
  if (typeof value !== 'object' || value === null) return result;
  const v = value as Record<string, unknown>;

  const win = v['window'];
  if (typeof win === 'object' && win !== null) {
    const w = win as Record<string, unknown>;
    if (finite(w['width'])) result.window.width = Math.max(MIN_WIDTH, Math.round(w['width']));
    if (finite(w['height'])) result.window.height = Math.max(MIN_HEIGHT, Math.round(w['height']));
    if (finite(w['x']) && finite(w['y'])) {
      result.window.x = Math.round(w['x']);
      result.window.y = Math.round(w['y']);
    }
    if (typeof w['maximized'] === 'boolean') result.window.maximized = w['maximized'];
  }

  const sel = v['selection'];
  if (typeof sel === 'object' && sel !== null) {
    const s = sel as Record<string, unknown>;
    if (typeof s['repositoryId'] === 'string' && s['repositoryId'].length <= 80) result.selection.repositoryId = s['repositoryId'];
    if (typeof s['section'] === 'string' && (SECTIONS as readonly string[]).includes(s['section'])) {
      result.selection.section = s['section'] as Section;
    }
    if (isDay(s['day'])) result.selection.day = s['day'];
  }
  return result;
}

export interface AppStateStore {
  load(): Promise<AppState>;
  get(): AppState;
  update(patch: { window?: Partial<AppState['window']>; selection?: Partial<AppState['selection']> }): Promise<AppState>;
}

/** `app-state.json` in the user data folder (spec AD-08). */
export function createAppStateStore(dir: string): AppStateStore {
  const file = path.join(dir, 'app-state.json');
  let state = defaultAppState();

  async function save(): Promise<void> {
    await mkdir(dir, { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(temp, file);
  }

  return {
    async load() {
      try {
        state = sanitizeAppState(JSON.parse(await readFile(file, 'utf8')));
      } catch {
        state = defaultAppState();
      }
      return state;
    },
    get: () => state,
    async update(patch) {
      state = sanitizeAppState({
        ...state,
        window: { ...state.window, ...patch.window },
        selection: { ...state.selection, ...patch.selection },
      });
      await save();
      return state;
    },
  };
}
