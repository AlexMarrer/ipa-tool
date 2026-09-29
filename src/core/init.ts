/**
 * `ipa init` (spec.md §6.3): creates the workspace and runs the injected baseline step, or catches
 * up on the baseline of an init that stopped before it.
 */
import { mkdir, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { createGitRunner } from '../git/runner.js';
import { type Clock, systemClock } from './clock.js';
import { createDefaultConfig, DEFAULT_TIMEZONE, writeConfig } from './config.js';
import { locateRepository, openWorkspace, type RepositoryLocation, type WorkspaceContext } from './context.js';
import { dataRootNotWritableMessage, describeFsError, ensureDataRootWritable } from './data-root.js';
import { errnoCode, EXIT, exitCodeOf, IpaError, LockHeldError } from './errors.js';
import { createRepositoryId, createRunId } from './ids.js';
import { LOCK_FILE, withLock } from './lock.js';
import { canonicalizePath, isSameOrInside, samePath } from './paths.js';
import { addRegistryEntry, type RegistryEntry } from './registry.js';
import { appendLockHeldRecord, appendRunRecord, createRunRecord, runErrorOf } from './run-log.js';
import { createInitialState, readState, writeState } from './state.js';
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

export interface BaselineOutcome {
  snapshotId: string;
  /** Snapshots of an aborted run taken over during recovery (spec.md §11.6). */
  recovered: string[];
  /** The baseline already existed and was only taken over. */
  adopted: boolean;
}

/** Injected by the CLI because `core` must not import the collector (spec.md §4.3). */
export type BaselineStep = (ctx: WorkspaceContext) => Promise<BaselineOutcome>;

export interface InitOptions {
  repo?: string | undefined;
  dataDir?: string | undefined;
  timezone?: string | undefined;
  workspace?: string | undefined;
  clock?: Clock;
  baseline?: BaselineStep;
}

export interface InitResult {
  ctx: WorkspaceContext;
  entry: RegistryEntry;
  location: WorkspaceLocation;
  /** False when only a missing baseline was caught up. */
  created: boolean;
  baseline: BaselineOutcome | null;
  /** Notices for stderr, for example a workspace inside the repository that Git does not ignore. */
  notices: string[];
}

// Retries when the random part of a new repositoryId collides.
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

/** Missing write permissions become a message about the affected location; other errors stay as they are. */
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

async function ignoreNotices(repoRoot: string, location: WorkspaceLocation): Promise<string[]> {
  const relative = location.relativeToRepo;
  if (relative === null) return [];
  const ignored = await ignoredByGit(repoRoot, relative);
  if (ignored === false) {
    return [
      `Hinweis: Der Arbeitsbereich ${relative}/ liegt im Repository und ist von Git nicht ignoriert. ` +
        `Empfohlen ist ein Eintrag /${relative}/ in .gitignore oder .git/info/exclude. ` +
        'Das Tool ändert diese Dateien nicht.',
    ];
  }
  if (ignored === null) {
    return [
      `Hinweis: Ob der Arbeitsbereich ${relative}/ von Git ignoriert wird, liess sich nicht prüfen. ` +
        'Empfohlen ist ein Eintrag in .gitignore oder .git/info/exclude.',
    ];
  }
  return [];
}

/**
 * Runs the baseline step inside the lock and writes the run log entry, also when the step fails
 * (for example exit code 5 on an unstable worktree).
 */
async function runBaselineStep(
  ctx: WorkspaceContext,
  step: BaselineStep | undefined,
  lockBroken: boolean,
  startedAt: Date,
): Promise<BaselineOutcome | null> {
  let outcome: BaselineOutcome | null = null;
  let failure: unknown = null;
  if (step !== undefined) {
    try {
      outcome = await step(ctx);
    } catch (error) {
      failure = error;
    }
  }
  await appendRunRecord(
    ctx.workspaceDir,
    createRunRecord({
      runId: ctx.runId,
      command: 'init',
      startedAt,
      endedAt: ctx.clock.now(),
      timezone: ctx.config.timezone,
      exitCode: failure === null ? EXIT.ok : exitCodeOf(failure),
      lockBroken,
      snapshotCreated: outcome !== null && !outcome.adopted ? outcome.snapshotId : null,
      recovered: outcome?.recovered ?? [],
      errors: failure === null ? [] : [runErrorOf(failure)],
    }),
  );
  if (failure instanceof IpaError) {
    throw new IpaError(
      failure.code,
      failure.exitCode,
      `${failure.message} Der Arbeitsbereich ${ctx.workspaceDir} ist angelegt; ein erneutes ipa init holt den Ausgangs-Snapshot nach.`,
      { cause: failure },
    );
  }
  if (failure !== null) throw failure;
  return outcome;
}

/** Repeated `init` on a registered workspace whose baseline is missing (spec.md §6.3). */
async function catchUpBaseline(opts: InitOptions, located: RepositoryLocation, entry: RegistryEntry, clock: Clock): Promise<InitResult> {
  const ctx = await openWorkspace(located, entry, clock);
  const state = await readState(ctx.workspaceDir);
  if (state.baselineSnapshotId !== null || opts.baseline === undefined) {
    throw new IpaError(
      'already_initialized',
      EXIT.usage,
      `Das Repository ${located.repo.root} ist bereits initialisiert. Arbeitsbereich: ${entry.workspacePath}`,
    );
  }
  if (opts.timezone !== undefined && canonicalTimeZone(opts.timezone) !== ctx.config.timezone) {
    throw new IpaError(
      'init_options_conflict',
      EXIT.usage,
      `Das Repository ist bereits mit der Zeitzone ${ctx.config.timezone} initialisiert. ` +
        'Beim Nachholen des Ausgangs-Snapshots wird --timezone nicht geändert; bitte config.json anpassen.',
    );
  }
  if (opts.workspace !== undefined && !samePath(await canonicalizePath(path.resolve(located.repo.root, opts.workspace)), entry.workspacePath)) {
    throw new IpaError(
      'init_options_conflict',
      EXIT.usage,
      `Das Repository ist bereits mit dem Arbeitsbereich ${entry.workspacePath} registriert. --workspace kann ihn nicht verschieben.`,
    );
  }
  const startedAt = clock.now();
  let baseline: BaselineOutcome | null;
  try {
    baseline = await withLock(ctx, 'init', ({ lockBroken }) => runBaselineStep(ctx, opts.baseline, lockBroken, startedAt));
  } catch (error) {
    if (error instanceof LockHeldError) await appendLockHeldRecord(ctx, 'init', startedAt, error);
    throw error;
  }
  const location: WorkspaceLocation = {
    path: entry.workspacePath,
    mode: entry.workspaceMode,
    relativeToRepo: null,
    existed: true,
  };
  return { ctx, entry, location, created: false, baseline, notices: [] };
}

/**
 * Creates the workspace, `config.json`, `state.json`, the registry entry and the first `runs.jsonl`
 * line under the lock, then runs the baseline step. If a step before the registry entry fails, the
 * files created by this run are removed again.
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
    if (!(await workspacePresent(located.entry))) throw workspaceMissingError(located.entry, dataRoot.path);
    return catchUpBaseline(opts, located, located.entry, clock);
  }

  // Validate the chosen folder before anything is created.
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
  let baseline: BaselineOutcome | null = null;
  try {
    baseline = await withLock(ctx, 'init', async ({ lockBroken }) => {
      // A concurrent init may have filled the folder meanwhile; its files stay untouched.
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
      return runBaselineStep(ctx, opts.baseline, lockBroken, startedAt);
    });
  } catch (error) {
    if (!committed && createdDir) {
      // Removes only an empty folder that this run created.
      await rmdir(location.path).catch(() => undefined);
    }
    throw committed ? error : explainWriteFailure(error, location.path, dataRoot.path);
  }

  return { ctx, entry, location, created: true, baseline, notices: await ignoreNotices(repo.root, location) };
}
