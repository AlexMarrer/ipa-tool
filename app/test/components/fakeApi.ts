import { vi } from 'vitest';
import type { IpaApi } from '../../src/shared/ipc';
import type { AppState, IpaResult, Project, ProjectList, ProjectsChange, RunEvent } from '../../src/shared/types';

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

export interface FakeApiOptions {
  projects?: Project[];
  registry?: ProjectList['registry'];
  state?: Partial<AppState['selection']>;
  listResult?: IpaResult<ProjectList>;
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
