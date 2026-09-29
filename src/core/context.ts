import { type Clock, systemClock } from './clock.js';
import { type Config, loadConfig } from './config.js';
import { assertDataRootSeparate, type DataRoot, resolveDataRoot } from './data-root.js';
import { EXIT, IpaError } from './errors.js';
import { createRunId } from './ids.js';
import { samePath } from './paths.js';
import { findRegistryEntry, type Registry, type RegistryEntry, readRegistry } from './registry.js';
import { type RepositoryInfo, resolveRepository } from './repository.js';
import { workspaceMissingError, workspacePresent } from './workspace.js';

export interface WorkspaceContext {
  dataRoot: string;
  repoRoot: string;
  repositoryId: string;
  workspaceDir: string;
  config: Config;
  clock: Clock;
  runId: string;
}

export interface LocateOptions {
  /** `--repo`; defaults to the current directory. */
  repo?: string | undefined;
  dataDir?: string | undefined;
}

export interface ResolveContextOptions extends LocateOptions {
  requireInit: boolean;
  /** Defaults to the system clock. */
  clock?: Clock;
}

export interface RepositoryLocation {
  repo: RepositoryInfo;
  dataRoot: DataRoot;
  registry: Registry | null;
  entry: RegistryEntry | null;
}

/**
 * Resolves repository, data root and registry entry without writing anything.
 * Data root and repository must not contain each other.
 */
export async function locateRepository(opts: LocateOptions): Promise<RepositoryLocation> {
  const repo = await resolveRepository(opts.repo ?? process.cwd());
  const dataRoot = await resolveDataRoot({ dataDir: opts.dataDir });
  assertDataRootSeparate(dataRoot.path, repo.root);
  const registry = await readRegistry(dataRoot.path);
  return { repo, dataRoot, registry, entry: findRegistryEntry(registry, repo.root) };
}

export function notInitializedError(location: RepositoryLocation): IpaError {
  return new IpaError(
    'not_initialized',
    EXIT.usage,
    `Das Repository ${location.repo.root} ist nicht initialisiert (Datenwurzel ${location.dataRoot.path}). ` +
      'Zuerst ipa init ausführen.',
  );
}

/** Context of an existing registry entry: checks the workspace, loads and validates `config.json`. */
export async function openWorkspace(location: RepositoryLocation, entry: RegistryEntry, clock: Clock): Promise<WorkspaceContext> {
  if (!(await workspacePresent(entry))) {
    throw workspaceMissingError(entry, location.dataRoot.path);
  }
  const config = await loadConfig(entry.workspacePath);
  if (config.repositoryId !== entry.repositoryId) {
    throw new IpaError(
      'config_mismatch',
      EXIT.usage,
      `config.json in ${entry.workspacePath} gehört zu ${config.repositoryId}, die Registry erwartet ${entry.repositoryId}.`,
    );
  }
  if (!samePath(config.repository.path, location.repo.root)) {
    throw new IpaError(
      'config_mismatch',
      EXIT.usage,
      `config.json in ${entry.workspacePath} gehört zum Repository ${config.repository.path}, nicht zu ${location.repo.root}.`,
    );
  }
  return {
    dataRoot: location.dataRoot.path,
    repoRoot: location.repo.root,
    repositoryId: entry.repositoryId,
    workspaceDir: entry.workspacePath,
    config,
    clock,
    runId: createRunId(clock),
  };
}

/**
 * spec.md §10: the workspace path comes from the registry, `config.json` and its time zone are
 * validated, nothing is written. An unregistered repository gives exit code 2 with
 * `requireInit: true` and `null` with `requireInit: false`; a registered but missing workspace
 * always gives exit code 2.
 */
export function resolveContext(opts: ResolveContextOptions & { requireInit: true }): Promise<WorkspaceContext>;
export function resolveContext(opts: ResolveContextOptions): Promise<WorkspaceContext | null>;
export async function resolveContext(opts: ResolveContextOptions): Promise<WorkspaceContext | null> {
  const location = await locateRepository(opts);
  if (location.entry === null) {
    if (opts.requireInit) throw notInitializedError(location);
    return null;
  }
  return openWorkspace(location, location.entry, opts.clock ?? systemClock);
}
