import { vi } from 'vitest';
import type { IpaApi } from '../../src/shared/ipc';
import type { AppState, IpaResult, Project, ProjectList, ProjectsChange, RunEvent } from '../../src/shared/types';
import type { ConfigChange, ConfigFile, ConfigPreview, ConfigView, RunHistoryEntry, ScheduleView } from '../../src/shared/config';
import { CLAUDE_DEFAULTS, LIMIT_DEFAULTS, SCHEDULE_DEFAULTS } from '../../src/shared/config';
import type { InitOutcome, ProjectCheck, SystemStatus, UsageRow } from '../../src/shared/project';
import type { LockState, StartOutcome } from '../../src/shared/run';
import type { DayIndex, DayView, EvidenceGroup, FinalFileView, JournalDraftView, OverviewView, ReferenceIndex, RemoveResult, WorkLogView } from '../../src/shared/views';

export const project = (overrides: Partial<Project> = {}): Project => ({
  repositoryId: 'alpha-111111',
  repoPath: 'C:/repos/alpha',
  workspacePath: 'C:/daten/workspaces/alpha-111111',
  workspaceMode: 'default',
  timezone: 'Europe/Zurich',
  status: 'ok',
  hint: '',
  claudeReady: null,
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
  lock?: LockState;
  theme?: AppState['theme'];
  /** `config.json` as the page reads it; defaults of the CLI otherwise. */
  config?: Partial<ConfigView>;
  schedule?: Partial<ScheduleView>;
  scheduleRuns?: RunHistoryEntry[];
  /** Answer of the check of a draft (`config set --dry-run`). */
  preview?: (changes: ConfigChange[]) => ConfigPreview;
  /** Answer of "Pfad testen". */
  testPath?: (input: { include: string[]; exclude: string[]; path: string }) => { allowed: boolean; rule: string | null };
  chosenFile?: string | null;
  /** Answer of the checklist of the wizard (`null`: no folder chosen). */
  projectCheck?: ProjectCheck | null;
  folder?: string | null;
  initOutcome?: InitOutcome;
  systemStatus?: Partial<SystemStatus>;
  usage?: UsageRow[];
  finals?: Record<string, FinalFileView[]>;
  evidence?: EvidenceGroup[];
  /** Detector names a text hits; default none. */
  detectors?: (text: string) => string[];
}

export const defaultConfig = (overrides: Partial<ConfigFile> = {}): ConfigFile => ({
  schemaVersion: 1,
  repositoryId: 'alpha-111111',
  repository: { path: 'C:/repos/alpha' },
  timezone: 'Europe/Zurich',
  paths: { include: ['**'], exclude: ['**/node_modules/**', '*.log'] },
  secrets: { extraPatterns: [], disabledDetectors: [] },
  limits: { ...LIMIT_DEFAULTS },
  context: { files: [] },
  testReports: [],
  claude: { command: ['claude'], model: null, ...CLAUDE_DEFAULTS },
  schedule: { ...SCHEDULE_DEFAULTS },
  ...overrides,
});

export const defaultPlan = { workdays: ['mon', 'tue', 'wed', 'thu', 'fri'] as const, runTimes: ['08:00', '10:00', '12:00', '14:00', '16:00', '17:45', '18:00'], skippedRunTimes: [], runsPerDay: 7, includesWindowEndRun: true, maxAnalysesPerRun: 5, maxClaudeCallsPerDay: 35 };

export function createFakeApi(options: FakeApiOptions = {}) {
  const changed = new Set<(change: ProjectsChange) => void>();
  const runListeners = new Set<(event: RunEvent) => void>();
  let projects = options.projects ?? [];
  let state: AppState = {
    schemaVersion: 1,
    window: { x: null, y: null, width: 1280, height: 800, maximized: false },
    selection: { repositoryId: null, section: 'overview', day: null, ...options.state },
    theme: options.theme ?? 'system',
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
      start: vi.fn(() => ok<StartOutcome>({ ok: true, runKey: 'k1' })),
      state: vi.fn(() => ok<LockState>(options.lock ?? { own: [], foreign: null })),
      cancel: vi.fn(() => ok({ cancelled: true })),
      onEvent: vi.fn((listener) => {
        runListeners.add(listener);
        return () => void runListeners.delete(listener);
      }),
    },
    system: {
      versions: vi.fn(() => ok({ app: '0.1.0', electron: '45.5.0', node: 'v24.22.3', cli: '0.1.0', runtime: 'test' as const, runtimeProblem: null })),
      dataRoot: vi.fn(() => ok({ path: 'C:/daten' })),
      status: vi.fn(() => ok<SystemStatus>({ check: { checkedAt: '2026-11-26T07:52:00Z', ok: true, claude: { found: true, version: '2.1.4', loggedIn: true, authMethod: 'claude.ai' }, git: { found: true, version: '2.47.1' }, liveCheck: null }, dataRoot: 'C:/daten', workspacesInRepository: [], ...options.systemStatus })),
      usage: vi.fn((range: string) => ok(range === 'all' ? (options.usage ?? []) : (options.usage ?? []).filter((row) => Date.now() - Date.parse(row.startedAt) < Number(range) * 86_400_000))),
      openDataRoot: vi.fn(() => ok({ opened: true })),
      copyDataRoot: vi.fn(() => ok({ copied: true })),
    },
    app: {
      getState: vi.fn(() => ok(state)),
      setState: vi.fn((patch) => {
        state = { ...state, window: { ...state.window, ...patch.window }, selection: { ...state.selection, ...patch.selection }, theme: patch.theme ?? state.theme };
        return ok(state);
      }),
    },
    day: {
      load: vi.fn((_id: string, day: string) => ok(days[day] ?? emptyDay(day))),
      index: vi.fn(() => ok(index)),
    },
    config: {
      scanText: vi.fn((_id: string, text: string) => ok({ detectors: options.detectors?.(text) ?? [] })),
      read: vi.fn(() =>
        ok<ConfigView>({
          state: 'ok',
          config: defaultConfig(),
          findings: [],
          signature: '1:1',
          workspaceInRepository: null,
          repoPath: 'C:/repos/alpha',
          workspacePath: 'C:/daten/workspaces/alpha-111111',
          claude: { checkedAt: '2026-11-26T07:52:00Z', ok: true, found: true, version: '2.1.4', loggedIn: true, authMethod: 'claude.ai' },
          ...options.config,
        }),
      ),
      preview: vi.fn((_id: string, changes: ConfigChange[]) => ok<ConfigPreview>(options.preview?.(changes) ?? { valid: true, findings: [], schedulePlan: { ...defaultPlan, workdays: [...defaultPlan.workdays] }, failure: null })),
      testPath: vi.fn((_id: string, input: { include: string[]; exclude: string[]; path: string }) => ok(options.testPath?.(input) ?? { allowed: true, rule: null })),
      chooseFile: vi.fn(() => ok({ path: options.chosenFile ?? null })),
    },
    project: {
      chooseFolder: vi.fn(() => ok({ path: options.folder ?? null })),
      check: vi.fn(() => ok<ProjectCheck | null>(options.projectCheck ?? null)),
      init: vi.fn(() => ok<InitOutcome>(options.initOutcome ?? { exitCode: 0, errors: [], warnings: [], failure: null, result: { created: true, repositoryId: 'neu-123456', workspacePath: 'C:/daten/workspaces/neu-123456', workspaceMode: 'default', timezone: 'Europe/Zurich', baselineSnapshotId: 'S000001', claude: { checked: true, ok: true, cliVersion: '2.1.4', problems: null } } })),
    },
    schedule: {
      status: vi.fn(() =>
        ok<ScheduleView>({
          state: 'not_installed',
          taskName: 'ipa-assistant-alpha-111111',
          enabled: null,
          differences: [],
          detail: null,
          nextRun: null,
          lastRun: null,
          lastResult: null,
          running: false,
          insideWindow: true,
          plan: { ...defaultPlan, workdays: [...defaultPlan.workdays] },
          problem: null,
          ...options.schedule,
        }),
      ),
      runs: vi.fn(() => ok(options.scheduleRuns ?? [])),
    },
    snapshot: {
      workLog: vi.fn((_id: string, snapshotId: string) => ok(options.workLogs?.[snapshotId] ?? null)),
      evidenceList: vi.fn(() => ok(options.evidence ?? [])),
    },
    journal: {
      read: vi.fn((_id: string, file: string) => ok(options.journals?.[file] ?? null)),
      finals: vi.fn((_id: string, day: string) => ok(options.finals?.[day] ?? [])),
      finalize: vi.fn((_id: string, draft: string) => ok({ file: `${draft.slice(0, 10)}.md` })),
      remove: vi.fn(() => ok<RemoveResult>({ removed: true, problem: null })),
    },
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
