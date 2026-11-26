import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { StatusReport } from '../shared/cli-types';
import type { ProjectList, ProjectsChange, Project, VersionInfo } from '../shared/types';
import type { InitInput, InitOutcome, ProjectCheck, SystemStatus, UsageRange, UsageRow } from '../shared/project';
import type { ConfigChange as ConfigPatch, ConfigPreview, ConfigView, PathDecisionView, RunHistoryEntry, ScheduleView } from '../shared/config';
import type { LockState, StartOutcome } from '../shared/run';
import type { DayIndex, DayView, EvidenceGroup, FileRef, FinalFileView, JournalDraftView, OverviewView, ReferenceIndex, RemoveResult, WorkLogView } from '../shared/views';
import type { CommandRequest } from './cli/commands';
import { startLiveSession, type LiveSession } from './run/session';
import { summarizeRun } from './run/summary';
import { createAppStateStore, type AppStateStore } from './app-state';
import { loadCliLib, type CliLib } from './cli-lib';
import { AppError, toIpaError } from './cli/errors';
import { noShell, type ShellPort } from './shell';
import { checkProjectFolder, systemCheck } from './project-check';
import { runGit } from './git';
import { readUsage } from './reader/usage';
import { configPreviewOf, emptySchedule, readConfigView, readRunHistory, scheduleViewOf, workspaceInsideRepository } from './reader/config-view';
import { createJournalFiles } from './reader/journal-files';
import { createWorkspaceReader, type WorkspaceReader } from './reader/workspace';
import { assertCliVersion, createRunner, readExpectedCliVersion, type Runner } from './cli/runner';
import { resolveRuntime, type Runtime } from './cli/runtime';
import { createSchemaValidator, type SchemaValidator } from './cli/validator';
import { createAppLog, type AppLog } from './log';
import { buildProject } from './reader/status';
import { readRegistry, resolveDataRoot, REGISTRY_FILE, type RegistryEntry } from './reader/registry';
import { createRunRegistry } from './run/locks';
import { createRunQueue, type RunQueue } from './run/queue';
import { createWatcher, type Watcher } from './watch/watcher';

export interface ServicesOptions {
  appRoot: string;
  packaged: boolean;
  resourcesPath?: string;
  /** Folder for `app-state.json` and `logs/`; also the working directory of every CLI call. */
  userDataDir: string;
  env: NodeJS.ProcessEnv;
  appVersion: string;
  electronVersion: string;
  /** Test mode: Node executable and CLI root. */
  nodeExe?: string;
  cliRoot?: string;
  watchDebounceMs?: number;
  watchPollMs?: number;
  /** Operating system access (open files, clipboard, links); tests pass a recorder. */
  shell?: ShellPort;
}

export type ReaderResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

export interface Services {
  appState: AppStateStore;
  log: AppLog;
  queue: RunQueue;
  runtime: Runtime | null;
  runtimeProblem: string | null;
  dataRoot: string | null;
  loadProjects(): Promise<ProjectList>;
  loadProject(repositoryId: string): Promise<Project | null>;
  /** Reading views (package 11). Each returns an error result for an unknown project or a missing runtime. */
  loadDay(repositoryId: string, day: string): Promise<ReaderResult<DayView>>;
  loadDayIndex(repositoryId: string): Promise<ReaderResult<DayIndex>>;
  loadWorkLog(repositoryId: string, snapshotId: string): Promise<ReaderResult<WorkLogView | null>>;
  loadJournal(repositoryId: string, file: string): Promise<ReaderResult<JournalDraftView | null>>;
  loadFinals(repositoryId: string, day: string): Promise<ReaderResult<FinalFileView[]>>;
  /** Opens the folder dialog; the chosen folder stays here and is the only one that `checkChosenFolder` and `initChosenFolder` use. */
  chooseFolder(): Promise<{ path: string | null }>;
  checkChosenFolder(): Promise<ReaderResult<ProjectCheck | null>>;
  /** `init` for the chosen folder (spec §8.12); the CLI decides, the app only sets the time zone and the workspace. */
  initChosenFolder(input: InitInput): Promise<ReaderResult<InitOutcome>>;
  systemStatus(): Promise<ReaderResult<SystemStatus>>;
  loadUsage(range: UsageRange): Promise<ReaderResult<UsageRow[]>>;
  openDataRoot(): Promise<{ opened: boolean }>;
  copyDataRoot(): Promise<{ copied: boolean }>;
  loadConfig(repositoryId: string): Promise<ReaderResult<ConfigView>>;
  /** `config set --dry-run`: an automatic call that writes nothing and never calls Claude (spec §12.1, AD-09). */
  previewConfig(repositoryId: string, changes: { path: string; value: string }[]): Promise<ReaderResult<ConfigPreview>>;
  testPath(repositoryId: string, include: string[], exclude: string[], path: string): Promise<ReaderResult<PathDecisionView>>;
  chooseFile(repositoryId: string): Promise<ReaderResult<{ path: string | null }>>;
  loadSchedule(repositoryId: string): Promise<ReaderResult<ScheduleView>>;
  loadRunHistory(repositoryId: string): Promise<ReaderResult<RunHistoryEntry[]>>;
  /** On the user's request: copies a draft to `journal/final/` (spec §4.3). */
  finalizeDraft(repositoryId: string, draft: string): Promise<ReaderResult<{ file: string }>>;
  /** On the user's request: draft or final file to the recycle bin. */
  removeJournalFile(repositoryId: string, kind: 'draft' | 'final', file: string): Promise<ReaderResult<RemoveResult>>;
  loadReferences(repositoryId: string): Promise<ReaderResult<ReferenceIndex>>;
  loadOverview(repositoryId: string): Promise<ReaderResult<OverviewView>>;
  loadEvidenceList(repositoryId: string): Promise<ReaderResult<EvidenceGroup[]>>;
  scanText(repositoryId: string, text: string): Promise<ReaderResult<{ detectors: string[] }>>;
  /** Starts an action on the user's request; the only way the renderer starts a command (spec §12.1). */
  startRun(repositoryId: string, request: CommandRequest): Promise<StartOutcome>;
  runState(repositoryId: string): Promise<LockState>;
  openFile(repositoryId: string, ref: FileRef): Promise<ReaderResult<{ opened: boolean }>>;
  revealFile(repositoryId: string, ref: FileRef): Promise<ReaderResult<{ opened: boolean }>>;
  /** Puts the path of a file on the clipboard without handing it to the renderer. */
  copyFilePath(repositoryId: string, ref: FileRef): Promise<ReaderResult<{ opened: boolean }>>;
  copyText(text: string): void;
  openExternal(url: string): Promise<void>;
  versions(): Promise<VersionInfo>;
  /** Observes the workspace of the selected project; `null` stops it. */
  watchProject(repositoryId: string | null): void;
  onProjectsChanged(listener: (change: ProjectsChange) => void): () => void;
  shutdown(): Promise<void>;
}

const STATUS_CONCURRENCY = 4;

async function mapPool<T, R>(items: readonly T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Composition of everything the main process needs, free of Electron imports (testable, spec §7). */
export async function createServices(options: ServicesOptions): Promise<Services> {
  const log = createAppLog(options.userDataDir);
  const appState = createAppStateStore(options.userDataDir);
  await appState.load();
  const dataRoot = resolveDataRoot(options.env);

  let runtime: Runtime | null = null;
  let runtimeProblem: string | null = null;
  let validator: SchemaValidator | null = null;
  let runner: Runner | null = null;
  let cliVersion: string | null = null;
  let cliLib: CliLib | null = null;
  const shell = options.shell ?? noShell;

  try {
    runtime = await resolveRuntime({
      packaged: options.packaged,
      ...(options.resourcesPath !== undefined ? { resourcesPath: options.resourcesPath } : {}),
      appRoot: options.appRoot,
      env: options.env,
      ...(options.nodeExe !== undefined ? { nodeExe: options.nodeExe } : {}),
      ...(options.cliRoot !== undefined ? { cliRoot: options.cliRoot } : {}),
    });
    validator = createSchemaValidator(runtime.schemasDir);
    runner = createRunner({ runtime, cwd: options.userDataDir, env: options.env, validator });
    cliVersion = await assertCliVersion(runner, readExpectedCliVersion(options.appRoot, runtime.cliRoot));
    cliLib = await loadCliLib(runtime.cliRoot);
  } catch (error) {
    const failure = toIpaError(error);
    runtimeProblem = failure.details === undefined ? failure.message : `${failure.message} (${failure.details})`;
    log.write({ event: 'runtime_problem', code: failure.code });
    if (!(error instanceof AppError)) throw error;
    if (error.code === 'cli_version_mismatch') runner = null;
  }

  let entries: RegistryEntry[] = [];
  /** The folder the user chose in the wizard; the renderer never names a path (spec §8.12). */
  let chosenFolder: string | null = null;
  const registry = createRunRegistry();
  const queue = createRunQueue({
    runner: runner ?? failingRunner(),
    registry,
    project: (repositoryId) => {
      const entry = entries.find((candidate) => candidate.repositoryId === repositoryId);
      return entry === undefined ? null : { repositoryId, repoPath: entry.repoPath, workspacePath: entry.workspacePath };
    },
    onLog: (entry) => log.write({ ...entry, event: `cli_${entry.event}` }),
    summarize: summarizeRun,
  });

  const listeners = new Set<(change: ProjectsChange) => void>();
  const emit = (change: ProjectsChange): void => {
    for (const listener of listeners) listener(change);
  };

  let registryWatcher: Watcher | null = null;
  let workspaceWatcher: Watcher | null = null;
  if (dataRoot !== null) {
    registryWatcher = createWatcher({
      root: dataRoot,
      recursive: false,
      pollFiles: [REGISTRY_FILE],
      ...(options.watchDebounceMs !== undefined ? { debounceMs: options.watchDebounceMs } : {}),
      ...(options.watchPollMs !== undefined ? { pollMs: options.watchPollMs } : {}),
      onPaths: (paths) => {
        if (paths.some((file) => file === REGISTRY_FILE)) emit({ repositoryId: null, reason: 'registry' });
      },
    });
  }

  async function loadProjects(): Promise<ProjectList> {
    const file = dataRoot === null ? '' : path.join(dataRoot, REGISTRY_FILE);
    if (dataRoot === null) {
      return { registry: { state: 'unreadable', path: file, detail: 'Die Datenwurzel konnte nicht bestimmt werden (LOCALAPPDATA fehlt).' }, projects: [] };
    }
    if (validator === null || runner === null || runtimeProblem !== null) {
      return { registry: { state: 'unreadable', path: file, detail: runtimeProblem }, projects: [] };
    }
    const read = await readRegistry(dataRoot, validator);
    entries = read.repositories;
    const projects = await mapPool(read.repositories, STATUS_CONCURRENCY, (entry) =>
      buildProject(entry, async (e) => {
        const started = await queue.start(e.repositoryId, { name: 'status' }, 'auto');
        if (!started.ok) return { report: null, failed: true };
        const result = await started.done;
        return { report: result.status, failed: result.status === null };
      }),
    );
    for (const project of projects) timezones.set(project.repositoryId, project.timezone);
    return { registry: { state: read.state, path: read.path, detail: read.detail }, projects };
  }

  const readers = new Map<string, WorkspaceReader>();
  const timezones = new Map<string, string | null>();

  /** The reader of a project; the registry is read once when nothing was loaded yet. */
  async function readerOf(repositoryId: string): Promise<{ reader: WorkspaceReader; entry: RegistryEntry } | null> {
    if (entries.length === 0 && validator !== null && dataRoot !== null) entries = (await readRegistry(dataRoot, validator)).repositories;
    const entry = entries.find((candidate) => candidate.repositoryId === repositoryId);
    if (entry === undefined || validator === null || cliLib === null || runtimeProblem !== null) return null;
    const key = `${repositoryId}|${entry.workspacePath}`;
    let reader = readers.get(key);
    if (reader === undefined) {
      const lib = cliLib;
      reader = createWorkspaceReader({
        workspacePath: entry.workspacePath,
        validator,
        createScanner: (secrets) => lib.createSecretScanner(secrets),
        // Used only when config.json cannot be read; the time zone of the last status call.
        fallbackTimezone: timezones.get(repositoryId) ?? null,
      });
      readers.set(key, reader);
    }
    return { reader, entry };
  }

  const unknownProject = { ok: false as const, error: { code: 'project_unknown', message: 'Dieses Projekt ist nicht in der Projektliste oder die CLI-Laufzeit steht nicht bereit.' } };
  async function withReader<T>(repositoryId: string, work: (reader: WorkspaceReader, entry: RegistryEntry) => Promise<T>): Promise<ReaderResult<T>> {
    const found = await readerOf(repositoryId);
    if (found === null) return unknownProject;
    return { ok: true, value: await work(found.reader, found.entry) };
  }

  /** Status and schedule status for the overview; both are automatic calls that never start Claude. */
  async function overviewInputs(repositoryId: string): Promise<{ status: StatusReport | null; schedule: OverviewView['schedule'] }> {
    const statusRun = await queue.start(repositoryId, { name: 'status' }, 'auto');
    const status = statusRun.ok ? (await statusRun.done).status : null;
    let schedule: OverviewView['schedule'] = null;
    const scheduleRun = await queue.start(repositoryId, { name: 'scheduleStatus' }, 'auto');
    if (scheduleRun.ok) {
      const result = (await scheduleRun.done).envelope?.result;
      if (result !== null && result !== undefined && typeof result['state'] === 'string') {
        schedule = { state: result['state'], nextRun: typeof result['nextRun'] === 'string' ? result['nextRun'] : null };
      }
    }
    return { status, schedule };
  }

  async function openRef(repositoryId: string, ref: FileRef, reveal: boolean): Promise<ReaderResult<{ opened: boolean }>> {
    return withReader(repositoryId, async (reader) => {
      const file = await reader.resolveFile(ref);
      if (file === null) return { opened: false };
      if (reveal) shell.showItemInFolder(file);
      else if ((await shell.openPath(file)) !== '') return { opened: false };
      return { opened: true };
    });
  }

  // Live lines of long runs, derived from file events in the workspace while the run is active (spec §3.5).
  const sessions = new Map<string, LiveSession>();
  queue.onEvent((event) => {
    if (event.type === 'started' && event.panel) {
      void (async () => {
        const found = await readerOf(event.repositoryId);
        if (found === null) return;
        const settings = await found.reader.settings();
        sessions.set(
          event.runKey,
          startLiveSession({
            workspacePath: found.entry.workspacePath,
            maxAnalysesPerRun: settings.maxAnalysesPerRun,
            emit: (live) => queue.emit(live),
            runKey: event.runKey,
            sinceMs: Date.parse(event.startedAt),
            ...(options.watchDebounceMs !== undefined ? { debounceMs: options.watchDebounceMs } : {}),
          }),
        );
      })();
    } else if (event.type === 'finished') {
      const session = sessions.get(event.runKey);
      sessions.delete(event.runKey);
      if (session !== undefined) void session.finish(event.exitCode, event.cancelled);
    }
  });

  return {
    appState,
    log,
    queue,
    runtime,
    runtimeProblem,
    dataRoot,
    loadProjects,
    async loadProject(repositoryId) {
      const list = await loadProjects();
      return list.projects.find((project) => project.repositoryId === repositoryId) ?? null;
    },
    loadDay: (repositoryId, day) => withReader(repositoryId, (reader) => reader.day(day)),
    loadDayIndex: (repositoryId) => withReader(repositoryId, (reader) => reader.dayIndex()),
    loadWorkLog: (repositoryId, snapshotId) => withReader(repositoryId, (reader) => reader.workLog(snapshotId)),
    loadJournal: (repositoryId, file) => withReader(repositoryId, (reader) => reader.journal(file)),
    async chooseFolder() {
      const picked = await shell.chooseFolder();
      if (picked !== null) chosenFolder = picked;
      return { path: picked };
    },
    async checkChosenFolder() {
      if (chosenFolder === null) return { ok: true, value: null };
      if (validator === null || runtimeProblem !== null) return unknownProject;
      if (dataRoot !== null) entries = (await readRegistry(dataRoot, validator)).repositories;
      return { ok: true, value: await checkProjectFolder({ repoPath: chosenFolder, dataRoot, entries, validator, git: runGit }) };
    },
    async initChosenFolder(settings) {
      if (chosenFolder === null || validator === null || runtimeProblem !== null) return unknownProject;
      // The checklist is made again: the folder must still be a main folder that is not set up yet.
      if (dataRoot !== null) entries = (await readRegistry(dataRoot, validator)).repositories;
      const check = await checkProjectFolder({ repoPath: chosenFolder, dataRoot, entries, validator, git: runGit });
      if (!check.repository.isMainFolder) return { ok: false, error: { code: 'init_refused', message: 'Dieser Ordner ist kein Git-Repository.' } };
      if (check.existing !== null) return { ok: false, error: { code: 'init_refused', message: 'Dieses Repository ist bereits eingerichtet.' } };
      const started = queue.startInit(chosenFolder, { name: 'init', timezone: settings.timezone, ...(settings.workspace === 'repository' ? { workspace: '.ipa' } : {}) });
      if (!started.ok) return { ok: false, error: { code: 'init_busy', message: started.message } };
      const done = await started.done;
      const result = done.envelope?.result ?? null;
      const claude = result !== null && typeof result['claude'] === 'object' && result['claude'] !== null ? (result['claude'] as Record<string, unknown>) : null;
      return {
        ok: true,
        value: {
          exitCode: done.exitCode,
          errors: done.envelope?.errors ?? [],
          warnings: done.envelope?.warnings ?? [],
          failure: done.failure,
          result:
            result === null || typeof result['repositoryId'] !== 'string'
              ? null
              : {
                  created: result['created'] === true,
                  repositoryId: result['repositoryId'],
                  workspacePath: String(result['workspacePath'] ?? ''),
                  workspaceMode: result['workspaceMode'] === 'explicit' ? 'explicit' : 'default',
                  timezone: String(result['timezone'] ?? settings.timezone),
                  baselineSnapshotId: typeof result['baselineSnapshotId'] === 'string' ? result['baselineSnapshotId'] : null,
                  claude: {
                    checked: claude?.['checked'] === true,
                    ok: typeof claude?.['ok'] === 'boolean' ? claude['ok'] : null,
                    cliVersion: typeof claude?.['cliVersion'] === 'string' ? claude['cliVersion'] : null,
                    problems: typeof claude?.['problems'] === 'string' ? claude['problems'] : null,
                  },
                },
        },
      };
    },
    async systemStatus() {
      if (validator === null || runtimeProblem !== null) return unknownProject;
      if (dataRoot !== null) entries = (await readRegistry(dataRoot, validator)).repositories;
      return { ok: true, value: await systemCheck(entries, validator, dataRoot) };
    },
    async loadUsage(range) {
      if (validator === null || runtimeProblem !== null) return unknownProject;
      if (dataRoot !== null) entries = (await readRegistry(dataRoot, validator)).repositories;
      return { ok: true, value: await readUsage(entries, validator, range) };
    },
    async openDataRoot() {
      return { opened: dataRoot !== null && (await shell.openPath(dataRoot)) === '' };
    },
    async copyDataRoot() {
      if (dataRoot === null) return { copied: false };
      shell.writeClipboard(dataRoot);
      return { copied: true };
    },
    async loadConfig(repositoryId) {
      const found = await readerOf(repositoryId);
      if (found === null || validator === null) return unknownProject;
      const view = await readConfigView({ workspacePath: found.entry.workspacePath, repoPath: found.entry.repoPath, validator });
      if (view.state !== 'invalid') return { ok: true, value: view };
      // An invalid file comes with the findings of the CLI, which knows the rules (spec §9.6).
      const check = await queue.start(repositoryId, { name: 'configCheck' }, 'auto');
      const result = check.ok ? (await check.done).envelope?.result : null;
      return { ok: true, value: { ...view, findings: configPreviewOf(result ?? null, null).findings } };
    },
    async previewConfig(repositoryId, changes) {
      if ((await readerOf(repositoryId)) === null) return unknownProject;
      const started = await queue.start(repositoryId, { name: 'configSet', changes, dryRun: true }, 'auto');
      if (!started.ok) return { ok: true, value: { valid: null, findings: [], schedulePlan: null, failure: started.message } };
      const done = await started.done;
      return { ok: true, value: configPreviewOf(done.envelope?.result ?? null, done.failure?.message ?? (done.envelope === null ? 'Das CLI hat keine Antwort geliefert.' : null)) };
    },
    async testPath(repositoryId, include, exclude, target) {
      const found = await readerOf(repositoryId);
      if (found === null || cliLib === null) return unknownProject;
      const workspace = workspaceInsideRepository(found.entry.repoPath, found.entry.workspacePath);
      const filter = cliLib.createPathFilter({ include, exclude, workspace });
      const decision = filter.decide(target.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, ''));
      return { ok: true, value: { allowed: decision.allowed, rule: decision.allowed ? null : decision.rule } };
    },
    async chooseFile(repositoryId) {
      const found = await readerOf(repositoryId);
      if (found === null) return unknownProject;
      const chosen = await shell.chooseFile(found.entry.repoPath);
      if (chosen === null) return { ok: true, value: { path: null } };
      const relative = path.relative(found.entry.repoPath, chosen);
      const inside = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
      return { ok: true, value: { path: (inside ? relative : chosen).split(path.sep).join('/') } };
    },
    async loadSchedule(repositoryId) {
      if ((await readerOf(repositoryId)) === null) return unknownProject;
      const started = await queue.start(repositoryId, { name: 'scheduleStatus' }, 'auto');
      if (!started.ok) return { ok: true, value: emptySchedule({ kind: 'failed', message: started.message }) };
      const done = await started.done;
      const result = done.envelope?.result ?? null;
      if (result === null) {
        const unsupported = done.envelope?.errors.some((error) => error.code === 'schedule_platform_unsupported') === true;
        const message = done.envelope?.errors[0]?.message ?? done.failure?.message ?? 'Der Zeitplan konnte nicht gelesen werden.';
        return { ok: true, value: emptySchedule({ kind: unsupported ? 'unsupported' : 'failed', message }) };
      }
      return { ok: true, value: scheduleViewOf(result) };
    },
    async loadRunHistory(repositoryId) {
      const found = await readerOf(repositoryId);
      if (found === null || validator === null) return unknownProject;
      const view = await readConfigView({ workspacePath: found.entry.workspacePath, repoPath: found.entry.repoPath, validator });
      const timezone = view.config?.timezone ?? timezones.get(repositoryId) ?? 'UTC';
      return { ok: true, value: await readRunHistory({ workspacePath: found.entry.workspacePath, repoPath: found.entry.repoPath, validator }, timezone) };
    },
    loadFinals: (repositoryId, day) => withReader(repositoryId, async (_reader, entry) => createJournalFiles(entry.workspacePath, shell).finals(day)),
    async finalizeDraft(repositoryId, draft) {
      const found = await readerOf(repositoryId);
      if (found === null) return unknownProject;
      const done = await createJournalFiles(found.entry.workspacePath, shell).finalize(draft);
      return done.ok ? { ok: true, value: { file: done.file } } : { ok: false, error: { code: 'journal_file', message: done.problem } };
    },
    removeJournalFile: (repositoryId, kind, file) => withReader(repositoryId, async (_reader, entry) => createJournalFiles(entry.workspacePath, shell).remove(kind, file)),
    loadReferences: (repositoryId) => withReader(repositoryId, (reader) => reader.references()),
    async loadOverview(repositoryId) {
      const inputs = await overviewInputs(repositoryId);
      return withReader(repositoryId, (reader) => reader.overview(inputs.status, inputs.schedule));
    },
    loadEvidenceList: (repositoryId) => withReader(repositoryId, (reader) => reader.evidenceList()),
    scanText: (repositoryId, text) => withReader(repositoryId, async (reader) => ({ detectors: await reader.scanText(text) })),
    async startRun(repositoryId, request) {
      // Make sure the registry is known (the renderer lists projects first, tests may not).
      if (entries.length === 0) await readerOf(repositoryId);
      const started = await queue.start(repositoryId, request, 'user');
      return started.ok ? { ok: true, runKey: started.runKey } : { ok: false, reason: started.reason, message: started.message };
    },
    async runState(repositoryId) {
      return {
        own: queue.activeRuns(repositoryId).map((run) => ({ runKey: run.runKey, label: run.label, ai: run.ai, cancellable: run.cancellable, kind: run.kind })),
        foreign: await queue.foreignLock(repositoryId).then((lock) => (lock === null ? null : { command: lock.command, startedAt: lock.startedAt })),
      };
    },
    openFile: (repositoryId, ref) => openRef(repositoryId, ref, false),
    revealFile: (repositoryId, ref) => openRef(repositoryId, ref, true),
    copyFilePath: (repositoryId, ref) =>
      withReader(repositoryId, async (reader) => {
        const file = await reader.resolveFile(ref);
        if (file === null) return { opened: false };
        shell.writeClipboard(file);
        return { opened: true };
      }),
    copyText: (text) => shell.writeClipboard(text),
    openExternal: (url) => shell.openExternal(url),
    async versions() {
      return {
        app: options.appVersion,
        electron: options.electronVersion,
        node: runtime?.nodeVersion ?? null,
        cli: cliVersion,
        runtime: runtime?.mode ?? null,
        runtimeProblem,
      };
    },
    watchProject(repositoryId) {
      workspaceWatcher?.close();
      workspaceWatcher = null;
      if (repositoryId === null) return;
      const entry = entries.find((candidate) => candidate.repositoryId === repositoryId);
      if (entry === undefined) return;
      workspaceWatcher = createWatcher({
        root: entry.workspacePath,
        ...(options.watchDebounceMs !== undefined ? { debounceMs: options.watchDebounceMs } : {}),
        ...(options.watchPollMs !== undefined ? { pollMs: options.watchPollMs } : {}),
        onPaths: () => emit({ repositoryId, reason: 'workspace' }),
      });
    },
    onProjectsChanged(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async shutdown() {
      registryWatcher?.close();
      workspaceWatcher?.close();
      await queue.cancelAll();
    },
  };
}

/** Used when the CLI cannot be started; every start then fails like a missing runtime. */
function failingRunner(): Runner {
  return {
    start() {
      return {
        pid: undefined,
        result: Promise.resolve({
          exitCode: null,
          stdout: '',
          stderr: '',
          envelope: null,
          status: null,
          cancelled: false,
          failure: new AppError('runtime_missing').toIpaError(),
        }),
        cancel: () => Promise.resolve(),
      };
    },
    version: () => Promise.reject(new AppError('runtime_missing')),
  };
}

export async function readPackageVersion(appRoot: string): Promise<string> {
  try {
    const parsed = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8')) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
