/**
 * `registry.json` in the data root (spec.md §5.3, §9.2).
 */
import os from 'node:os';
import path from 'node:path';
import { errnoCode, EXIT, IpaError, type LockInfo } from './errors.js';
import { readJsonValidated, writeJsonAtomic } from './json.js';
import { acquireLock } from './lock.js';
import { comparisonKey, samePath } from './paths.js';

export const REGISTRY_FILE = 'registry.json';
// Serialises concurrent `init` runs so that no entry gets lost.
export const REGISTRY_LOCK_FILE = 'registry.lock';
export const REGISTRY_LOCK_WAIT_MS = 5000;

export type WorkspaceMode = 'default' | 'explicit';

export interface RegistryEntry {
  repositoryId: string;
  repoPath: string;
  workspacePath: string;
  workspaceMode: WorkspaceMode;
  createdAt: string;
}

export interface Registry {
  schemaVersion: 1;
  repositories: RegistryEntry[];
}

export function registryPath(dataRoot: string): string {
  return path.join(dataRoot, REGISTRY_FILE);
}

function assertUnique(registry: Registry, file: string): void {
  const paths = new Set<string>();
  const ids = new Set<string>();
  for (const entry of registry.repositories) {
    const key = comparisonKey(entry.repoPath);
    if (paths.has(key) || ids.has(entry.repositoryId)) {
      throw new IpaError(
        'registry_invalid',
        EXIT.usage,
        `Ungültige Datei ${file}: doppelter Eintrag für ${entry.repoPath} oder ${entry.repositoryId}. Die Datei wird nicht verändert.`,
      );
    }
    paths.add(key);
    ids.add(entry.repositoryId);
  }
}

/**
 * `null` if the registry or the data root does not exist. A damaged registry or a higher
 * `schemaVersion` gives exit code 2 (D-18).
 */
export async function readRegistry(dataRoot: string): Promise<Registry | null> {
  const file = registryPath(dataRoot);
  let registry: Registry;
  try {
    registry = await readJsonValidated<Registry>(file, 'registry');
  } catch (error) {
    if (error instanceof IpaError && error.code === 'file_not_found') return null;
    if (error instanceof IpaError && errnoCode(error.cause) === 'ENOTDIR') {
      throw new IpaError('data_root_invalid', EXIT.usage, `Die Datenwurzel ist kein Ordner: ${dataRoot}`, { cause: error });
    }
    throw error;
  }
  assertUnique(registry, file);
  return registry;
}

export function findRegistryEntry(registry: Registry | null, repoPath: string): RegistryEntry | null {
  if (registry === null) return null;
  return registry.repositories.find((entry) => samePath(entry.repoPath, repoPath)) ?? null;
}

/**
 * Adds an entry under `registry.lock`. If another run registered the repository meanwhile, the
 * result is exit code 2.
 */
export async function addRegistryEntry(
  dataRoot: string,
  entry: RegistryEntry,
  lockInfo: Omit<LockInfo, 'pid' | 'hostname'>,
): Promise<void> {
  const lock = await acquireLock(
    path.join(dataRoot, REGISTRY_LOCK_FILE),
    { pid: process.pid, hostname: os.hostname(), ...lockInfo },
    { waitMs: REGISTRY_LOCK_WAIT_MS },
  );
  try {
    const current = (await readRegistry(dataRoot)) ?? { schemaVersion: 1, repositories: [] };
    const existing = findRegistryEntry(current, entry.repoPath);
    if (existing !== null) {
      throw new IpaError(
        'already_initialized',
        EXIT.usage,
        `Das Repository ${entry.repoPath} wurde inzwischen von einem anderen Lauf initialisiert (Arbeitsbereich ${existing.workspacePath}).`,
      );
    }
    if (current.repositories.some((other) => other.repositoryId === entry.repositoryId)) {
      throw new IpaError('repository_id_conflict', EXIT.internal, `Die repositoryId ${entry.repositoryId} ist bereits vergeben.`);
    }
    const next: Registry = { schemaVersion: 1, repositories: [...current.repositories, entry] };
    await writeJsonAtomic(registryPath(dataRoot), next, 'registry');
  } finally {
    await lock.release();
  }
}
