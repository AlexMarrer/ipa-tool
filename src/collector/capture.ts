import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { WorkspaceContext } from '../core/context.js';
import { EXIT, FileExistsError, IpaError } from '../core/errors.js';
import { createFileExclusive, renameDirectory } from '../core/fs-write.js';
import { formatSnapshotId, randomHex } from '../core/ids.js';
import { formatIssues, validate } from '../core/schemas.js';
import { readState, writeState } from '../core/state.js';
import { createPathFilter } from '../filter/path-filter.js';
import { createSecretScanner } from '../filter/secret-scanner.js';
import { createGitRunner, limitConcurrency, workspaceExcludeFor } from '../git/runner.js';
import { type BuiltSnapshot, buildSnapshot } from './build.js';
import { isConsistent, type Observation, observe, type ObserveEnv, UnstableObservation } from './observe.js';
import { MANIFEST_FILE, readManifest, snapshotDir, snapshotsDir, TEMP_PREFIX } from './snapshots.js';
import type { CaptureOptions, CaptureOutcome, Manifest } from './types.js';

// Starting a Git process is expensive on Windows; more parallel processes only add contention.
const GIT_CONCURRENCY = 4;

async function observeStable(
  ctx: WorkspaceContext,
  env: ObserveEnv,
  options: CaptureOptions,
  previousHead: string | null,
): Promise<{ observation: Observation; attempts: number }> {
  const maxAttempts = 1 + ctx.config.limits.stabilityRetries;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) await delay(ctx.config.limits.stabilityDelayMs);
    let observation: Observation;
    try {
      observation = await observe(env, options.kind, previousHead);
    } catch (error) {
      if (error instanceof UnstableObservation) continue;
      throw error;
    }
    await options.hooks?.afterFirstPass?.({ attempt });
    if (await isConsistent(env, observation)) return { observation, attempts: attempt };
  }
  throw new IpaError(
    'unstable',
    EXIT.unstable,
    `Der Arbeitsstand hat sich während der Aufnahme verändert, auch nach ${maxAttempts} Versuchen. ` +
      'Es wurde kein Snapshot gespeichert. Bitte später erneut versuchen.',
  );
}

/** spec.md §8.5: content first, manifest last, then one rename into the final folder. */
async function storeSnapshot(ctx: WorkspaceContext, built: BuiltSnapshot): Promise<void> {
  const { snapshotId } = built.manifest;
  const result = validate('manifest', built.manifest);
  if (!result.ok) {
    throw new IpaError('record_invalid', EXIT.internal, `Interner Fehler: Das Manifest ${snapshotId} ist ungültig: ${formatIssues(result.issues)}`);
  }
  const temp = path.join(snapshotsDir(ctx.workspaceDir), `${TEMP_PREFIX}${snapshotId}-${randomHex(8)}`);
  try {
    await mkdir(path.join(temp, 'content', 'state'), { recursive: true });
    for (const [file, data] of built.files) await createFileExclusive(path.join(temp, file), data);
    await createFileExclusive(path.join(temp, MANIFEST_FILE), `${JSON.stringify(built.manifest, null, 2)}\n`);
    await renameDirectory(temp, snapshotDir(ctx.workspaceDir, snapshotId));
  } catch (error) {
    await rm(temp, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
    if (error instanceof FileExistsError) {
      throw new IpaError(
        'snapshot_exists',
        EXIT.usage,
        `Der Snapshot-Ordner ${snapshotDir(ctx.workspaceDir, snapshotId)} existiert bereits, state.json verweist aber nicht darauf. ` +
          'Bitte den Ordner prüfen; er wird nicht überschrieben.',
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * Takes a snapshot (spec.md §11.1 steps 1, 3, 4, 6, 7): read, check consistency, store atomically,
 * then advance state.json. Throws `IpaError` with exit code 5 when the worktree does not settle.
 */
export async function captureSnapshot(ctx: WorkspaceContext, options: CaptureOptions): Promise<CaptureOutcome> {
  const state = await readState(ctx.workspaceDir);
  const previous: Manifest | null = state.lastSnapshotId === null ? null : await readManifest(ctx, state.lastSnapshotId);
  const snapshotId = formatSnapshotId(state.nextSnapshotSeq);

  const workspace = workspaceExcludeFor(ctx.repoRoot, ctx.workspaceDir);
  const env: ObserveEnv = {
    git: limitConcurrency(createGitRunner(ctx.repoRoot, { workspaceDir: ctx.workspaceDir }), GIT_CONCURRENCY),
    filter: createPathFilter({ include: ctx.config.paths.include, exclude: ctx.config.paths.exclude, workspace }),
    repoRoot: ctx.repoRoot,
    maxFileBytes: ctx.config.limits.maxFileBytes,
    now: () => ctx.clock.now(),
  };
  const { observation, attempts } = await observeStable(ctx, env, options, previous?.git.head ?? null);
  if (observation.commits.length > 0 && observation.configuredEmail === null) {
    options.onWarning?.('Warnung: user.email ist in Git nicht gesetzt. authoredByConfiguredUser ist daher für alle Commits false.');
  }

  const built = buildSnapshot({
    snapshotId,
    repositoryId: ctx.repositoryId,
    kind: options.kind,
    previous: previous === null ? null : { snapshotId: previous.snapshotId, capturedAt: previous.capturedAt },
    observation,
    attempts,
    timezone: ctx.config.timezone,
    limits: ctx.config.limits,
    scanner: createSecretScanner(ctx.config.secrets),
  });
  await storeSnapshot(ctx, built);
  await options.hooks?.beforeStateUpdate?.({ snapshotId });

  await writeState(ctx.workspaceDir, {
    ...state,
    lastSnapshotId: snapshotId,
    nextSnapshotSeq: state.nextSnapshotSeq + 1,
    branch: observation.branch,
    baselineSnapshotId: state.baselineSnapshotId ?? (options.kind === 'baseline' ? snapshotId : null),
  });
  return { type: 'created', snapshotId, analysisRequired: built.manifest.analysisRequired };
}
