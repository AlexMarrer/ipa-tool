import { vi } from 'vitest';
import type { IpaApi } from '../../src/shared/ipc';
import type { AppState, IpaResult, Project, ProjectList, ProjectsChange, RunEvent } from '../../src/shared/types';
import type { DayIndex, DayView, JournalDraftView, OverviewView, ReferenceIndex, WorkLogView } from '../../src/shared/views';

export const project = (overrides: Partial<Project> = {}): Project => ({
  repositoryId: 'alpha-111111',
  repoPath: 'C:/repos/alpha',
  workspacePath: 'C:/daten/workspaces/alpha-111111',
  workspaceMode: 'default',
  timezone: 'Europe/Zurich',
  status: 'ok',
  hint: '',
  ...overrides,
});

/** A day without entries; tests spread their own values over it. */
export const emptyDay = (day: string, overrides: Partial<DayView> = {}): DayView => ({
  day,
  weekday: 'Donnerstag',
  title: 'Donnerstag, 26. November 2026',
  timezone: 'Europe/Zurich',
  isFuture: false,
  isToday: false,
  snapshots: [],
  notes: [],
  runs: [],
  drafts: [],
  summary: { snapshotCount: 0, noteCount: 0, time: { time: { measured: 0, estimated: 0 }, planned: { measured: 0, estimated: 0 }, delays: { measured: 0, estimated: 0 }, withoutTime: 0 } },
  attention: [],
  timeline: [],
  invalid: { noteLines: 0, runLines: 0, unreadableFiles: [] },
  ...overrides,
});

export interface FakeApiOptions {
  projects?: Project[];
  registry?: ProjectList['registry'];
  state?: Partial<AppState['selection']>;
  listResult?: IpaResult<ProjectList>;
  days?: Record<string, DayView>;
  index?: DayIndex;
  workLogs?: Record<string, WorkLogView | null>;
  journals?: Record<string, JournalDraftView | null>;
  references?: ReferenceIndex;
  overview?: OverviewView;
}

export function createFakeApi(options: FakeApiOptions = {}) {
  const changed = new Set<(change: ProjectsChange) => void>();
  const runListeners = new Set<(event: RunEvent) => void>();
  let projects = options.projects ?? [];
  let state: AppState = {
    schemaVersion: 1,
    window: { x: null, y: null, width: 1280, height: 800, maximized: false },
    selection: { repositoryId: null, section: 'overview', day: null, ...options.state },
  };
  const ok = <T,>(value: T): Promise<IpaResult<T>> => Promise.resolve({ ok: true, value });
  const days = options.days ?? {};
  const index: DayIndex = options.index ?? { timezone: 'Europe/Zurich', today: '2026-11-26', days: [] };

  const api: IpaApi = {
    projects: {
      list: vi.fn(() => (options.listResult !== undefined ? Promise.resolve(options.listResult) : ok({ registry: options.registry ?? { state: 'ok' as const, path: 'C:/daten/registry.json', detail: null }, projects }))),
      status: vi.fn(async (id: string) => {
        const found = projects.find((candidate) => candidate.repositoryId === id);
        return found === undefined ? { ok: false as const, error: { code: 'invalid_request', message: 'x' } } : { ok: true as const, value: found };
      }),
      onChanged: vi.fn((listener) => {
        changed.add(listener);
        return () => void changed.delete(listener);
      }),
    },
    run: {
      cancel: vi.fn(() => ok({ cancelled: true })),
      onEvent: vi.fn((listener) => {
        runListeners.add(listener);
        return () => void runListeners.delete(listener);
      }),
    },
    system: {
      versions: vi.fn(() => ok({ app: '0.1.0', electron: '45.5.0', node: 'v24.22.3', cli: '0.1.0', runtime: 'test' as const, runtimeProblem: null })),
      dataRoot: vi.fn(() => ok({ path: 'C:/daten' })),
    },
    app: {
      getState: vi.fn(() => ok(state)),
      setState: vi.fn((patch) => {
        state = { ...state, window: { ...state.window, ...patch.window }, selection: { ...state.selection, ...patch.selection } };
        return ok(state);
      }),
    },
    day: {
      load: vi.fn((_id: string, day: string) => ok(days[day] ?? emptyDay(day))),
      index: vi.fn(() => ok(index)),
    },
    snapshot: { workLog: vi.fn((_id: string, snapshotId: string) => ok(options.workLogs?.[snapshotId] ?? null)) },
    journal: { read: vi.fn((_id: string, file: string) => ok(options.journals?.[file] ?? null)) },
    notes: { references: vi.fn(() => ok(options.references ?? { notes: {}, snapshots: {} })) },
    overview: {
      load: vi.fn(() =>
        ok(
          options.overview ?? {
            halt: null,
            claude: { checkedAt: null, ok: null, version: null, problem: null },
            lastRun: null,
            lastSnapshot: null,
            analysedUpTo: null,
            analyses: { pending: 0, failed: 0, blocked: 0, exhausted: 0, complete: 0, skipped: 0, notRequired: 0 },
            withheld: { units: 0, notes: 0 },
            notesToday: 0,
            schedule: null,
            recentDays: [],
            timezone: 'Europe/Zurich',
            inconsistent: false,
          },
        ),
      ),
    },
    shell: {
      open: vi.fn(() => ok({ opened: true })),
      reveal: vi.fn(() => ok({ opened: true })),
      copy: vi.fn(() => ok({ copied: true as const })),
      copyPath: vi.fn(() => ok({ opened: true })),
      openExternal: vi.fn(() => ok({ opened: true as const })),
    },
  };

  return {
    api,
    setProjects(next: Project[]) {
      projects = next;
    },
    emitChanged: (change: ProjectsChange) => changed.forEach((listener) => listener(change)),
    emitRun: (event: RunEvent) => runListeners.forEach((listener) => listener(event)),
  };
}
