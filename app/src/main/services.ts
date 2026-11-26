import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectList, ProjectsChange, Project, VersionInfo } from '../shared/types';
import { createAppStateStore, type AppStateStore } from './app-state';
import { AppError, toIpaError } from './cli/errors';
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
}

export interface Services {
  appState: AppStateStore;
  log: AppLog;
  queue: RunQueue;
  runtime: Runtime | null;
  runtimeProblem: string | null;
  dataRoot: string | null;
  loadProjects(): Promise<ProjectList>;
  loadProject(repositoryId: string): Promise<Project | null>;
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
  } catch (error) {
    const failure = toIpaError(error);
    runtimeProblem = failure.details === undefined ? failure.message : `${failure.message} (${failure.details})`;
    log.write({ event: 'runtime_problem', code: failure.code });
    if (!(error instanceof AppError)) throw error;
    if (error.code === 'cli_version_mismatch') runner = null;
  }

  let entries: RegistryEntry[] = [];
  const registry = createRunRegistry();
  const queue = createRunQueue({
    runner: runner ?? failingRunner(),
    registry,
    project: (repositoryId) => {
      const entry = entries.find((candidate) => candidate.repositoryId === repositoryId);
      return entry === undefined ? null : { repositoryId, repoPath: entry.repoPath, workspacePath: entry.workspacePath };
    },
    onLog: (entry) => log.write({ ...entry, event: `cli_${entry.event}` }),
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
    return { registry: { state: read.state, path: read.path, detail: read.detail }, projects };
  }

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
