import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { WorkspaceContext } from '../core/context.js';
import { EXIT, FileExistsError, IpaError } from '../core/errors.js';
import { createFileExclusive, renameDirectory } from '../core/fs-write.js';
import { formatSnapshotId, randomHex } from '../core/ids.js';
import { formatIssues, validate } from '../core/schemas.js';
import { type Halt, readState, type RepositoryPosition, writeState } from '../core/state.js';
import { formatZoned } from '../core/time.js';
import { createPathFilter } from '../filter/path-filter.js';
import { createSecretScanner } from '../filter/secret-scanner.js';
import { createGitRunner, limitConcurrency, workspaceExcludeFor } from '../git/runner.js';
import { planAttribution } from './attribution.js';
import { type BuildInput, type BuiltSnapshot, buildSnapshot } from './build.js';
import { type DeltaEnv, materializeDeltas, resolveTransitions } from './delta.js';
import { detectHalt } from './halt.js';
import { loadLineage } from './lineage.js';
import { isConsistent, type Observation, observe, type ObserveEnv, readBranch, readHead, UnstableObservation } from './observe.js';
import { TMP_FOLDER } from './recovery.js';
import { MANIFEST_FILE, readManifest, snapshotDir, snapshotsDir, TEMP_PREFIX } from './snapshots.js';
import { changedReports, type ObservedReport, readTestReports, sameReports } from './test-reports.js';
import type { CaptureOptions, CaptureOutcome, Gap, Manifest } from './types.js';

// Starting a Git process is expensive on Windows; more parallel processes only add contention.
const GIT_CONCURRENCY = 4;

interface StableObservation {
  observation: Observation;
  reports: ObservedReport[];
  attempts: number;
}

type HaltCheck = { expected: RepositoryPosition; detectedAt: () => string } | null;

/**
 * Repeats the read pass until it is consistent (spec.md §11.2). For work snapshots every attempt
 * first checks for a halt (§11.5) on the position it is about to read.
 */
async function observeStable(
  ctx: WorkspaceContext,
  env: ObserveEnv,
  options: CaptureOptions,
  previousHead: string | null,
  haltCheck: HaltCheck,
): Promise<StableObservation | { halt: Halt }> {
  const maxAttempts = 1 + ctx.config.limits.stabilityRetries;
  const readReports = () => readTestReports(ctx.repoRoot, ctx.config.testReports, ctx.config.limits.maxFileBytes);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) await delay(ctx.config.limits.stabilityDelayMs);
    let position: RepositoryPosition | null = null;
    if (haltCheck !== null) {
      const [head, branch] = await Promise.all([readHead(env.git), readBranch(env.git)]);
      position = { branch, head };
      const halt = await detectHalt(env.git, haltCheck.expected, position, haltCheck.detectedAt());
      if (halt !== null) return { halt };
    }
    let observation: Observation;
    let reports: ObservedReport[];
    try {
      [observation, reports] = await Promise.all([observe(env, options.kind, previousHead), readReports()]);
    } catch (error) {
      if (error instanceof UnstableObservation) continue;
      throw error;
    }
    // The halt check must have seen the position that was read.
    if (position !== null && (observation.head !== position.head || observation.branch !== position.branch)) continue;
    await options.hooks?.afterFirstPass?.({ attempt });
    const [consistent, reread] = await Promise.all([isConsistent(env, observation), readReports()]);
    if (consistent && sameReports(reports, reread)) return { observation, reports, attempts: attempt };
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
 * Takes a snapshot (spec.md §11.1): halt check, read, consistency check, attribution and relevance,
 * atomic storage, then state.json. Returns `unchanged` without writing anything for a work snapshot
 * that is not relevant (§11.3), and `halted` on a branch change or rewritten history (§11.5).
 * Throws `IpaError` with exit code 5 when the worktree does not settle.
 */
export async function captureSnapshot(ctx: WorkspaceContext, options: CaptureOptions): Promise<CaptureOutcome> {
  const state = await readState(ctx.workspaceDir);
  const work = options.kind === 'work';
  if (work && state.halt !== null) return { type: 'halted', halt: state.halt };
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
  const haltCheck: HaltCheck =
    work && previous !== null
      ? { expected: { branch: state.branch, head: previous.git.head }, detectedAt: () => formatZoned(ctx.clock.now(), ctx.config.timezone) }
      : null;
  const stable = await observeStable(ctx, env, options, previous?.git.head ?? null, haltCheck);
  if ('halt' in stable) {
    await writeState(ctx.workspaceDir, { ...state, halt: stable.halt });
    return { type: 'halted', halt: stable.halt };
  }
  const { observation, reports, attempts } = stable;
  if (observation.commits.length > 0 && observation.configuredEmail === null) {
    options.onWarning?.('Warnung: user.email ist in Git nicht gesetzt. authoredByConfiguredUser ist daher für alle Commits false.');
  }

  const gaps: Gap[] = [];
  if (options.reason !== undefined) gaps.push({ type: 'rebaseline', detail: options.reason });
  if (options.kind === 'baseline' && state.halt !== null) {
    gaps.push({ type: 'halt_detected', detail: `${state.halt.reason}, erkannt am ${state.halt.detectedAt}` });
  }

  let attribution: BuildInput['attribution'];
  let newReports: ObservedReport[] = [];
  if (work && previous !== null) {
    const deltaEnv: DeltaEnv = {
      git: env.git,
      filter: env.filter,
      maxFileBytes: ctx.config.limits.maxFileBytes,
      previousDir: snapshotDir(ctx.workspaceDir, previous.snapshotId),
      tmpDir: path.join(ctx.workspaceDir, TMP_FOLDER),
    };
    const [transitions, lineage] = await Promise.all([
      resolveTransitions(deltaEnv, previous, observation),
      loadLineage(previous, (id) => readManifest(ctx, id)),
    ]);
    const plan = planAttribution(
      transitions,
      observation.commits.map((commit) => commit.units.map((unit) => ({ path: unit.path, blob: unit.dstBlob }))),
      lineage,
    );
    newReports = changedReports(reports, previous.testReports);
    // spec.md §11.3: pure index changes and removed reports are not relevant (D-07).
    const relevant = observation.head !== previous.git.head || plan.deltas.length > 0 || newReports.length > 0;
    if (!relevant) return { type: 'unchanged' };
    const deltas = await materializeDeltas(deltaEnv, previous, observation, plan.deltas);
    for (const delta of deltas) if (delta.gap !== null) gaps.push({ type: 'previous_state_unavailable', detail: delta.gap });
    attribution = { deltas, statusChanges: plan.statusChanges, commitFiles: plan.commitFiles };
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
    attribution,
    reports,
    newReports,
    gaps,
  });
  await storeSnapshot(ctx, built);
  await options.hooks?.beforeStateUpdate?.({ snapshotId });

  await writeState(ctx.workspaceDir, {
    ...state,
    lastSnapshotId: snapshotId,
    nextSnapshotSeq: state.nextSnapshotSeq + 1,
    branch: observation.branch,
    baselineSnapshotId: state.baselineSnapshotId ?? (options.kind === 'baseline' ? snapshotId : null),
    // A baseline starts a new attribution sequence and ends any halt (spec.md §11.5).
    halt: options.kind === 'baseline' ? null : state.halt,
  });
  return { type: 'created', snapshotId, analysisRequired: built.manifest.analysisRequired };
}
