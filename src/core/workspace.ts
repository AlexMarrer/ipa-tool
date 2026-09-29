/**
 * Workspace location, rules and layout (spec.md §5.3, §8.1, D-21).
 */
import { lstat, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG_FILE } from './config.js';
import { describeFsError } from './data-root.js';
import { errnoCode, EXIT, IpaError } from './errors.js';
import { LOCK_FILE } from './lock.js';
import { canonicalizePath, isSameOrInside, isStrictlyInside, relativeInside, samePath, toPortablePath } from './paths.js';
import { REGISTRY_FILE, type RegistryEntry, type WorkspaceMode } from './registry.js';
import type { RepositoryInfo } from './repository.js';
import { STATE_FILE } from './state.js';

export const WORKSPACES_FOLDER = 'workspaces';

/** Folders of spec.md §8.1; files such as `lock` or `runs.jsonl` appear when needed. */
export const WORKSPACE_SUBDIRS = [
  'snapshots',
  'analyses',
  'logs',
  'notes',
  'journal',
  'journal/runs',
  'journal/drafts',
  'journal/final',
  'context',
  'tmp',
] as const;

export interface WorkspaceLocation {
  /** Canonical absolute path with `/`. */
  path: string;
  mode: WorkspaceMode;
  /** Path relative to the repository root if the workspace lies inside it, otherwise `null`. */
  relativeToRepo: string | null;
  /** The (empty) folder existed before `init`. */
  existed: boolean;
}

export function defaultWorkspaceDir(dataRoot: string, repositoryId: string): string {
  return toPortablePath(path.join(dataRoot, WORKSPACES_FOLDER, repositoryId));
}

function workspaceError(code: string, message: string): IpaError {
  return new IpaError(code, EXIT.usage, message);
}

/**
 * Rules of spec.md §5.3 for `--workspace`: relative to the repository root, empty or not yet existing.
 */
export async function resolveExplicitWorkspace(input: string, repo: RepositoryInfo, dataRoot: string): Promise<WorkspaceLocation> {
  if (input.trim() === '') {
    throw workspaceError('workspace_invalid', 'Die Option --workspace braucht einen Pfad.');
  }
  const target = await canonicalizePath(path.resolve(repo.root, input));

  if (samePath(target, repo.root)) {
    throw workspaceError('workspace_is_repository_root', `Der Arbeitsbereich darf nicht die Repository-Wurzel selbst sein: ${target}`);
  }
  for (const gitPath of [`${repo.root}/.git`, repo.gitDir, repo.commonDir]) {
    if (isSameOrInside(target, gitPath)) {
      throw workspaceError('workspace_in_git_dir', `Der Arbeitsbereich darf nicht in .git liegen: ${target}`);
    }
  }
  if (isStrictlyInside(repo.root, target)) {
    throw workspaceError('workspace_contains_repository', `Der Arbeitsbereich darf das Repository nicht enthalten: ${target}`);
  }
  if (isSameOrInside(dataRoot, target)) {
    throw workspaceError(
      'workspace_contains_data_root',
      `Der Arbeitsbereich darf nicht die Datenwurzel sein oder sie enthalten: ${target} (Datenwurzel ${dataRoot})`,
    );
  }

  let existed = false;
  try {
    const info = await lstat(target);
    if (!info.isDirectory()) {
      throw workspaceError('workspace_not_directory', `Der gewählte Arbeitsbereich ist kein Ordner: ${target}`);
    }
    existed = true;
    await assertEmptyWorkspaceDir(target, []);
  } catch (error) {
    if (error instanceof IpaError) throw error;
    if (errnoCode(error) !== 'ENOENT') {
      throw workspaceError('workspace_not_writable', `Der gewählte Arbeitsbereich ist nicht zugänglich: ${target} (${describeFsError(error)})`);
    }
  }
  return { path: target, mode: 'explicit', relativeToRepo: relativeInside(target, repo.root), existed };
}

/** Leftovers of an aborted `init` are named in the message. */
export async function assertEmptyWorkspaceDir(dir: string, allowed: readonly string[]): Promise<void> {
  const entries = (await readdir(dir)).filter((name) => !allowed.includes(name));
  if (entries.length === 0) return;
  const leftover = entries.includes(CONFIG_FILE) && entries.includes(STATE_FILE);
  throw workspaceError(
    'workspace_not_empty',
    `Der gewählte Arbeitsbereich ist nicht leer: ${dir}.` +
      (leftover
        ? ' Er enthält Reste eines abgebrochenen oder fremden ipa init. Ist er nicht registriert, kann er gelöscht werden.'
        : ' Bitte einen leeren oder noch nicht vorhandenen Ordner wählen.'),
  );
}

export async function createWorkspaceStructure(workspaceDir: string): Promise<void> {
  for (const sub of WORKSPACE_SUBDIRS) {
    await mkdir(path.join(workspaceDir, sub), { recursive: true });
  }
}

/** Only for cleaning up after this run's own failed `init`. */
export async function clearWorkspaceContents(workspaceDir: string, keep: readonly string[] = [LOCK_FILE]): Promise<void> {
  for (const name of await readdir(workspaceDir)) {
    if (!keep.includes(name)) {
      await rm(path.join(workspaceDir, name), { recursive: true, force: true });
    }
  }
}

export async function workspacePresent(entry: RegistryEntry): Promise<boolean> {
  try {
    const dir = await stat(entry.workspacePath);
    if (!dir.isDirectory()) return false;
    const config = await stat(path.join(entry.workspacePath, CONFIG_FILE));
    return config.isFile();
  } catch {
    return false;
  }
}

/** The workspace is never recreated automatically (spec.md §5.4). */
export function workspaceMissingError(entry: RegistryEntry, dataRoot: string): IpaError {
  return new IpaError(
    'workspace_missing',
    EXIT.usage,
    `Der registrierte Arbeitsbereich fehlt oder ist unvollständig: ${entry.workspacePath}. ` +
      'Er wird nicht automatisch neu angelegt. Bitte den Ordner wiederherstellen, zum Beispiel aus der Sicherung, ' +
      `oder den Eintrag für ${entry.repoPath} aus ${toPortablePath(path.join(dataRoot, REGISTRY_FILE))} entfernen und ipa init erneut ausführen.`,
  );
}
