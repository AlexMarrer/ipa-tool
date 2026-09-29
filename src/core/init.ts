/**
 * Anlegen eines Arbeitsbereichs mit `ipa init` (Paket 01, spec.md §6.3).
 */
import { mkdir, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { createGitRunner } from '../git/runner.js';
import { type Clock, systemClock } from './clock.js';
import { createDefaultConfig, DEFAULT_TIMEZONE, writeConfig } from './config.js';
import { locateRepository, type WorkspaceContext } from './context.js';
import { dataRootNotWritableMessage, describeFsError, ensureDataRootWritable } from './data-root.js';
import { errnoCode, EXIT, IpaError } from './errors.js';
import { createRepositoryId, createRunId } from './ids.js';
import { LOCK_FILE, withLock } from './lock.js';
import { isSameOrInside } from './paths.js';
import { addRegistryEntry, type RegistryEntry } from './registry.js';
import { appendRunRecord, createRunRecord } from './run-log.js';
import { createInitialState, writeState } from './state.js';
import { canonicalTimeZone, formatZoned } from './time.js';
import {
  assertEmptyWorkspaceDir,
  clearWorkspaceContents,
  createWorkspaceStructure,
  defaultWorkspaceDir,
  resolveExplicitWorkspace,
  type WorkspaceLocation,
  workspaceMissingError,
  workspacePresent,
  WORKSPACES_FOLDER,
} from './workspace.js';

export interface InitOptions {
  repo?: string | undefined;
  dataDir?: string | undefined;
  /** IANA-Zeitzone, Standard `Europe/Zurich`. */
  timezone?: string | undefined;
  /** Ausdrücklich gewählter Arbeitsbereich (`--workspace`). */
  workspace?: string | undefined;
  clock?: Clock;
}

export interface InitResult {
  ctx: WorkspaceContext;
  entry: RegistryEntry;
  location: WorkspaceLocation;
  /** Hinweise für stderr, zum Beispiel ein nicht ignorierter Arbeitsbereich im Repository. */
  notices: string[];
}

/** Wie oft bei einer Kollision der zufälligen `repositoryId` eine neue gezogen wird. */
const MAX_ID_ATTEMPTS = 5;

function notWritable(dir: string, error: unknown): IpaError {
  return new IpaError(
    'workspace_not_writable',
    EXIT.usage,
    `Der Arbeitsbereich ist nicht beschreibbar: ${dir} (${describeFsError(error)}). ` +
      'Bitte mit --workspace einen beschreibbaren Ordner wählen oder die Rechte prüfen. Es wird kein anderer Ort verwendet.',
    { cause: error },
  );
}

/** Übersetzt fehlende Schreibrechte in eine Meldung zum betroffenen Ort; andere Fehler bleiben unverändert. */
function explainWriteFailure(error: unknown, workspaceDir: string, dataRoot: string): unknown {
  const code = errnoCode(error);
  if (code !== 'EACCES' && code !== 'EPERM' && code !== 'EROFS') return error;
  const failedPath = (error as NodeJS.ErrnoException).path;
  if (failedPath !== undefined && isSameOrInside(failedPath, workspaceDir)) return notWritable(workspaceDir, error);
  if (failedPath !== undefined && isSameOrInside(failedPath, dataRoot)) {
    return new IpaError('data_root_not_writable', EXIT.usage, dataRootNotWritableMessage(dataRoot, describeFsError(error)), {
      cause: error,
    });
  }
  return error;
}

async function createDefaultLocation(dataRoot: string, repoRoot: string): Promise<{ location: WorkspaceLocation; repositoryId: string }> {
  try {
    await mkdir(path.join(dataRoot, WORKSPACES_FOLDER), { recursive: true });
  } catch (error) {
    throw notWritable(path.join(dataRoot, WORKSPACES_FOLDER), error);
  }
  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
    const repositoryId = createRepositoryId(repoRoot);
    const dir = defaultWorkspaceDir(dataRoot, repositoryId);
    try {
      await mkdir(dir);
      return { location: { path: dir, mode: 'default', relativeToRepo: null, existed: false }, repositoryId };
    } catch (error) {
      if (errnoCode(error) === 'EEXIST') continue;
      throw notWritable(dir, error);
    }
  }
  throw new IpaError('repository_id_conflict', EXIT.internal, 'Es liess sich keine freie repositoryId bestimmen.');
}

async function ignoredByGit(repoRoot: string, relative: string): Promise<boolean | null> {
  try {
    const result = await createGitRunner(repoRoot).run(['check-ignore', '-q', '--', relative], { okExitCodes: [0, 1] });
    return result.exitCode === 0;
  } catch {
    return null;
  }
}

/**
 * Legt Arbeitsbereich, `config.json`, `state.json`, Registry-Eintrag und den ersten Eintrag in
 * `runs.jsonl` an. Der Lock wird dabei gehalten. Scheitert ein Schritt vor dem Registry-Eintrag,
 * werden die in diesem Lauf angelegten Dateien wieder entfernt.
 */
export async function initializeWorkspace(opts: InitOptions): Promise<InitResult> {
  const clock = opts.clock ?? systemClock;
  const requestedZone = opts.timezone ?? DEFAULT_TIMEZONE;
  const timezone = canonicalTimeZone(requestedZone);
  if (timezone === null) {
    throw new IpaError(
      'timezone_invalid',
      EXIT.usage,
      `Unbekannte Zeitzone "${requestedZone}". Erwartet wird ein IANA-Name wie Europe/Zurich.`,
    );
  }

  const located = await locateRepository(opts);
  const { repo, dataRoot } = located;
  if (located.entry !== null) {
    if (await workspacePresent(located.entry)) {
      throw new IpaError(
        'already_initialized',
        EXIT.usage,
        `Das Repository ${repo.root} ist bereits initialisiert. Arbeitsbereich: ${located.entry.workspacePath}`,
      );
    }
    throw workspaceMissingError(located.entry, dataRoot.path);
  }

  // Regeln für den gewählten Ordner prüfen, bevor irgendetwas angelegt wird.
  const explicit = opts.workspace !== undefined ? await resolveExplicitWorkspace(opts.workspace, repo, dataRoot.path) : null;

  await ensureDataRootWritable(dataRoot.path);

  let location: WorkspaceLocation;
  let repositoryId: string;
  if (explicit === null) {
    ({ location, repositoryId } = await createDefaultLocation(dataRoot.path, repo.root));
  } else {
    location = explicit;
    repositoryId = createRepositoryId(repo.root);
    try {
      await mkdir(location.path, { recursive: true });
    } catch (error) {
      throw notWritable(location.path, error);
    }
  }
  const createdDir = !location.existed;

  const config = createDefaultConfig({ repositoryId, repoPath: repo.root, timezone });
  const ctx: WorkspaceContext = {
    dataRoot: dataRoot.path,
    repoRoot: repo.root,
    repositoryId,
    workspaceDir: location.path,
    config,
    clock,
    runId: createRunId(clock),
  };
  const startedAt = clock.now();
  const entry: RegistryEntry = {
    repositoryId,
    repoPath: repo.root,
    workspacePath: location.path,
    workspaceMode: location.mode,
    createdAt: formatZoned(startedAt, timezone),
  };

  let committed = false;
  try {
    await withLock(ctx, 'init', async ({ lockBroken }) => {
      // Ein gleichzeitiger init könnte den Ordner inzwischen gefüllt haben; dessen Dateien bleiben unberührt.
      await assertEmptyWorkspaceDir(location.path, [LOCK_FILE]);
      try {
        await createWorkspaceStructure(location.path);
        await writeConfig(location.path, config);
        await writeState(location.path, createInitialState(repositoryId));
        await addRegistryEntry(dataRoot.path, entry, {
          command: 'init',
          runId: ctx.runId,
          startedAt: formatZoned(clock.now(), timezone),
        });
        committed = true;
      } catch (error) {
        await clearWorkspaceContents(location.path, [LOCK_FILE]).catch(() => undefined);
        throw error;
      }
      await appendRunRecord(
        location.path,
        createRunRecord({
          runId: ctx.runId,
          command: 'init',
          startedAt,
          endedAt: clock.now(),
          timezone,
          exitCode: EXIT.ok,
          lockBroken,
        }),
      );
    });
  } catch (error) {
    if (!committed && createdDir) {
      // Entfernt nur einen leeren Ordner, den dieser Lauf angelegt hat.
      await rmdir(location.path).catch(() => undefined);
    }
    throw committed ? error : explainWriteFailure(error, location.path, dataRoot.path);
  }

  const notices: string[] = [];
  if (location.relativeToRepo !== null) {
    const ignored = await ignoredByGit(repo.root, location.relativeToRepo);
    if (ignored === false) {
      notices.push(
        `Hinweis: Der Arbeitsbereich ${location.relativeToRepo}/ liegt im Repository und ist von Git nicht ignoriert. ` +
          `Empfohlen ist ein Eintrag /${location.relativeToRepo}/ in .gitignore oder .git/info/exclude. ` +
          'Das Tool ändert diese Dateien nicht.',
      );
    } else if (ignored === null) {
      notices.push(
        `Hinweis: Ob der Arbeitsbereich ${location.relativeToRepo}/ von Git ignoriert wird, liess sich nicht prüfen. ` +
          'Empfohlen ist ein Eintrag in .gitignore oder .git/info/exclude.',
      );
    }
  }
  return { ctx, entry, location, notices };
}
