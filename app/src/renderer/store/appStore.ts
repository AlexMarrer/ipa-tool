import { shiftDay, todayIn } from '../../shared/dates';
import type { IpaApi } from '../../shared/ipc';
import type { LockState, RunInput, RunSummary } from '../../shared/run';
import type { AppState, IpaError, LiveLine, Page, Project, ProjectList, RunEvent, Section } from '../../shared/types';
import type { SnapshotView } from '../../shared/views';
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
  /** When the end arrived in the app, for "Dauer". */
  endedAt: string | null;
}

export type DayTab = 'timeline' | 'workLogs' | 'notes' | 'journal';

/** Where a reference chip or a link wants the day page to look (spec §11.4). */
export interface Focus {
  noteId: string | null;
  snapshotId: string | null;
  evidence: string | null;
}

/** The dialog above the page, if one is open (spec §8.8, §8.9). */
export type DialogRequest =
  | { kind: 'note'; day: string | null }
  | { kind: 'baseline'; force: boolean }
  | { kind: 'skip'; snapshot: SnapshotView; timezone: string }
  | { kind: 'retry'; snapshot: SnapshotView }
  /** `summary` is `null` while the check runs. */
  | { kind: 'doctor'; outcome: StartResult | null };

/** Result of an action: the command did not start (locked, unknown), or it ended with a summary. */
export type StartResult = { started: false; reason: string; message: string } | { started: true; summary: RunSummary };

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
  /** Per project: runs of the app and a foreign run, for the locks of the buttons (spec §3.7). */
  locks: Record<string, LockState | undefined>;
  /** Counts Ctrl+N presses. */
  newNoteRequests: number;
  dialog: DialogRequest | null;
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
  requestNewNote(day?: string): void;
  openDialog(dialog: DialogRequest): void;
  closeDialog(): void;
  dismissRun(repositoryId: string): void;
  /**
   * Starts an action on the user's request and resolves when it ended. Locked starts resolve at once with the
   * reason. The result of a long run (capture, journal) also shows in the run panel.
   */
  startRun(repositoryId: string, input: RunInput): Promise<StartResult>;
  /** `Prüfen`: runs `doctor` and shows the result in a dialog. */
  check(repositoryId: string): Promise<void>;
  refreshLocks(repositoryId: string): Promise<void>;
  dispose(): void;
}

export interface AppStoreOptions {
  /** Whether a day has data in a project; keeps the day when switching projects (spec §8.1). */
  dayHasData?: (repositoryId: string, day: string) => boolean;
  now?: () => Date;
}

const SECTION_PAGES: readonly Page[] = ['overview', 'day', 'schedule', 'config'];
const BUFFER_LIMIT = 20;

type Finished = Extract<RunEvent, { type: 'finished' }>;

/** Summary of a run whose event came without one (should not happen; the app still shows something true). */
export function fallbackSummary(event: Finished): RunSummary {
  return { command: '', exitCode: event.exitCode, outcome: null, runId: null, errors: [], warnings: [], output: '', failure: event.failure, cancelled: event.cancelled, result: null, lock: null };
}

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
    locks: {},
    newNoteRequests: 0,
    dialog: null,
    loadError: null,
  });
  const unsubscribers: (() => void)[] = [];
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  /** The finished event can arrive before the start call returns; both orders end the same way. */
  const finishedBuffer = new Map<string, Finished>();
  const waiters = new Map<string, (event: Finished) => void>();

  const current = (): Project | null => {
    const { selection, projects } = store.getSnapshot();
    return projects.find((project) => project.repositoryId === selection.repositoryId) ?? null;
  };

  const persist = (): void => {
    const { selection } = store.getSnapshot();
    const patch: Partial<Pick<AppState, 'selection'>> = { selection: { repositoryId: selection.repositoryId, section: selection.section, day: selection.day } };
    void api.app.setState(patch);
  };

  async function refreshLocks(repositoryId: string): Promise<void> {
    const result = await api.run.state(repositoryId);
    if (!result.ok) return;
    store.setState((state) => ({ ...state, locks: { ...state.locks, [repositoryId]: result.value } }));
  }

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
    // A foreign run starts or ends through the lock file, which also lands here as a change of the workspace.
    const selected = store.getSnapshot().selection.repositoryId;
    if (selected !== null) await refreshLocks(selected);
  }

  function scheduleReload(): void {
    if (reloadTimer !== null) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => void reload(), 150);
  }

  function onRunEvent(event: RunEvent): void {
    store.setState((state) => {
      const runs = { ...state.runs };
      if (event.type === 'started') {
        // Short commands (note, skip, baseline, doctor) report to their dialog, not to the panel.
        if (event.panel) {
          runs[event.repositoryId] = {
            runKey: event.runKey,
            repositoryId: event.repositoryId,
            label: event.label,
            ai: event.ai,
            cancellable: event.cancellable,
            startedAt: event.startedAt,
            lines: [],
            finished: null,
            endedAt: null,
          };
        }
      } else {
        const entry = Object.values(runs).find((run) => run?.runKey === event.runKey);
        if (entry === undefined) return state;
        runs[entry.repositoryId] = event.type === 'live' ? { ...entry, lines: [...entry.lines, event.line] } : { ...entry, finished: event, endedAt: now().toISOString() };
      }
      return { ...state, runs };
    });
    if (event.type === 'started') void refreshLocks(event.repositoryId);
    if (event.type === 'finished') {
      finishedBuffer.set(event.runKey, event);
      while (finishedBuffer.size > BUFFER_LIMIT) finishedBuffer.delete(finishedBuffer.keys().next().value as string);
      waiters.get(event.runKey)?.(event);
      void refreshLocks(event.repositoryId);
      scheduleReload();
    }
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
      void refreshLocks(repositoryId);
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
    requestNewNote(day) {
      if (current() === null) return;
      store.setState((state) => (state.dialog !== null ? state : { ...state, newNoteRequests: state.newNoteRequests + 1, dialog: { kind: 'note', day: day ?? null } }));
    },
    openDialog(dialog) {
      store.setState((state) => (state.dialog !== null ? state : { ...state, dialog }));
    },
    closeDialog() {
      store.setState((state) => (state.dialog === null ? state : { ...state, dialog: null }));
    },
    dismissRun(repositoryId) {
      store.setState((state) => ({ ...state, runs: { ...state.runs, [repositoryId]: undefined } }));
    },
    async startRun(repositoryId, input) {
      const result = await api.run.start(repositoryId, input);
      if (!result.ok) return { started: false, reason: result.error.code, message: result.error.message };
      if (!result.value.ok) {
        // Exit code 3 and locks of the app arrive as a notice, not as an error (spec §3.7).
        void refreshLocks(repositoryId);
        return { started: false, reason: result.value.reason, message: result.value.message };
      }
      const key = result.value.runKey;
      const finished = finishedBuffer.get(key) ?? (await new Promise<Finished>((resolve) => waiters.set(key, resolve)));
      finishedBuffer.delete(key);
      waiters.delete(key);
      return { started: true, summary: finished.summary ?? fallbackSummary(finished) };
    },
    async check(repositoryId) {
      store.setState((state) => ({ ...state, dialog: { kind: 'doctor', outcome: null } }));
      const outcome = await actions.startRun(repositoryId, { name: 'doctor' });
      store.setState((state) => (state.dialog?.kind === 'doctor' ? { ...state, dialog: { kind: 'doctor', outcome } } : state));
    },
    refreshLocks,
    dispose() {
      if (reloadTimer !== null) clearTimeout(reloadTimer);
      for (const stop of unsubscribers.splice(0)) stop();
      for (const [key, resolve] of waiters) resolve({ type: 'finished', runKey: key, repositoryId: '', exitCode: null, cancelled: true, notice: null, failure: null as IpaError | null, summary: null });
      waiters.clear();
    },
  };
  return { store, actions };
}

export type AppStore = ReturnType<typeof createAppStore>;
