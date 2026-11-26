import { shiftDay, todayIn } from '../../shared/dates';
import type { IpaApi } from '../../shared/ipc';
import type { AppState, LiveLine, Page, Project, ProjectList, RunEvent, Section } from '../../shared/types';
import { createStore, type Store } from './createStore';

export interface RunView {
  runKey: string;
  repositoryId: string;
  label: string;
  ai: boolean;
  cancellable: boolean;
  startedAt: string;
  lines: LiveLine[];
  /** Set when the run ended; the panel keeps showing it until the user closes it. */
  finished: Extract<RunEvent, { type: 'finished' }> | null;
}

export type DayTab = 'timeline' | 'workLogs' | 'notes' | 'journal';

/** Where a reference chip or a link wants the day page to look (spec §11.4). */
export interface Focus {
  noteId: string | null;
  snapshotId: string | null;
  evidence: string | null;
}

export interface AppSnapshot {
  loading: boolean;
  registry: ProjectList['registry'] | null;
  projects: Project[];
  selection: { repositoryId: string | null; page: Page; section: Section; day: string | null };
  dayTab: DayTab;
  focus: Focus | null;
  /** Increases whenever the observed files or the project list changed; pages load again (spec AK-10-34). */
  dataVersion: number;
  /** Per project: the latest run shown in the panel. */
  runs: Record<string, RunView | undefined>;
  /** Counts Ctrl+N presses; the note dialog (a later package) reacts to it. */
  newNoteRequests: number;
  loadError: string | null;
}

export interface AppActions {
  init(): Promise<void>;
  reload(): Promise<void>;
  selectProject(repositoryId: string): void;
  selectPage(page: Page): void;
  setDay(day: string): void;
  setDayTab(tab: DayTab): void;
  /** Opens the day page on a given day and tab, as from the overview or a reference chip. */
  openDay(day: string, tab?: DayTab, focus?: Partial<Focus>): void;
  clearFocus(): void;
  /** `←` and `→` in the day view. */
  shiftDay(delta: number): void;
  requestNewNote(): void;
  dismissRun(repositoryId: string): void;
  dispose(): void;
}

export interface AppStoreOptions {
  /** Whether a day has data in a project; keeps the day when switching projects (spec §8.1). */
  dayHasData?: (repositoryId: string, day: string) => boolean;
  now?: () => Date;
}

const SECTION_PAGES: readonly Page[] = ['overview', 'day', 'schedule', 'config'];

export function createAppStore(api: IpaApi, options: AppStoreOptions = {}): { store: Store<AppSnapshot>; actions: AppActions } {
  const now = options.now ?? (() => new Date());
  const dayHasData = options.dayHasData ?? (() => true);
  const store = createStore<AppSnapshot>({
    loading: true,
    registry: null,
    projects: [],
    selection: { repositoryId: null, page: 'overview', section: 'overview', day: null },
    dayTab: 'timeline',
    focus: null,
    dataVersion: 0,
    runs: {},
    newNoteRequests: 0,
    loadError: null,
  });
  const unsubscribers: (() => void)[] = [];
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;

  const current = (): Project | null => {
    const { selection, projects } = store.getSnapshot();
    return projects.find((project) => project.repositoryId === selection.repositoryId) ?? null;
  };

  const persist = (): void => {
    const { selection } = store.getSnapshot();
    const patch: Partial<Pick<AppState, 'selection'>> = { selection: { repositoryId: selection.repositoryId, section: selection.section, day: selection.day } };
    void api.app.setState(patch);
  };

  async function reload(): Promise<void> {
    const result = await api.projects.list();
    if (!result.ok) {
      store.setState((state) => ({ ...state, loading: false, loadError: result.error.message }));
      return;
    }
    const { registry, projects } = result.value;
    store.setState((state) => {
      const known = projects.some((project) => project.repositoryId === state.selection.repositoryId);
      const repositoryId = known ? state.selection.repositoryId : (projects[0]?.repositoryId ?? null);
      return { ...state, loading: false, loadError: null, registry, projects, selection: { ...state.selection, repositoryId }, dataVersion: state.dataVersion + 1 };
    });
  }

  function scheduleReload(): void {
    if (reloadTimer !== null) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => void reload(), 150);
  }

  function onRunEvent(event: RunEvent): void {
    store.setState((state) => {
      const runs = { ...state.runs };
      if (event.type === 'started') {
        runs[event.repositoryId] = {
          runKey: event.runKey,
          repositoryId: event.repositoryId,
          label: event.label,
          ai: event.ai,
          cancellable: event.cancellable,
          startedAt: event.startedAt,
          lines: [],
          finished: null,
        };
      } else {
        const entry = Object.values(runs).find((run) => run?.runKey === event.runKey);
        if (entry === undefined) return state;
        runs[entry.repositoryId] = event.type === 'live' ? { ...entry, lines: [...entry.lines, event.line] } : { ...entry, finished: event };
      }
      return { ...state, runs };
    });
    if (event.type === 'finished') scheduleReload();
  }

  const actions: AppActions = {
    async init() {
      const saved = await api.app.getState();
      if (saved.ok) {
        const { selection } = saved.value;
        store.setState((state) => ({
          ...state,
          selection: { repositoryId: selection.repositoryId, page: selection.section, section: selection.section, day: selection.day },
        }));
      }
      unsubscribers.push(api.projects.onChanged(() => scheduleReload()));
      unsubscribers.push(api.run.onEvent(onRunEvent));
      await reload();
    },
    reload,
    selectProject(repositoryId) {
      store.setState((state) => {
        const day = state.selection.day !== null && dayHasData(repositoryId, state.selection.day) ? state.selection.day : null;
        const page = SECTION_PAGES.includes(state.selection.page) ? state.selection.page : state.selection.section;
        return { ...state, selection: { ...state.selection, repositoryId, day, page } };
      });
      persist();
    },
    selectPage(page) {
      store.setState((state) => ({
        ...state,
        selection: { ...state.selection, page, section: SECTION_PAGES.includes(page) ? (page as Section) : state.selection.section },
      }));
      persist();
    },
    setDay(day) {
      store.setState((state) => ({ ...state, selection: { ...state.selection, day }, focus: null }));
      persist();
    },
    setDayTab(tab) {
      store.setState((state) => ({ ...state, dayTab: tab, focus: null }));
    },
    openDay(day, tab = 'timeline', focus = {}) {
      store.setState((state) => ({
        ...state,
        selection: { ...state.selection, page: 'day', section: 'day', day },
        dayTab: tab,
        focus: { noteId: focus.noteId ?? null, snapshotId: focus.snapshotId ?? null, evidence: focus.evidence ?? null },
      }));
      persist();
    },
    clearFocus() {
      store.setState((state) => (state.focus === null ? state : { ...state, focus: null }));
    },
    shiftDay(delta) {
      const project = current();
      const base = store.getSnapshot().selection.day ?? todayIn(project?.timezone ?? null, now());
      actions.setDay(shiftDay(base, delta));
    },
    requestNewNote() {
      if (current() === null) return;
      store.setState((state) => ({ ...state, newNoteRequests: state.newNoteRequests + 1 }));
    },
    dismissRun(repositoryId) {
      store.setState((state) => ({ ...state, runs: { ...state.runs, [repositoryId]: undefined } }));
    },
    dispose() {
      if (reloadTimer !== null) clearTimeout(reloadTimer);
      for (const stop of unsubscribers.splice(0)) stop();
    },
  };
  return { store, actions };
}

export type AppStore = ReturnType<typeof createAppStore>;
