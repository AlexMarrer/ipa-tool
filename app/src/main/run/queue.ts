import type { RejectReason } from '../../shared/messages';
import { REJECT_MESSAGES } from '../../shared/messages';
import type { RunSummary } from '../../shared/run';
import type { RunEvent } from '../../shared/types';
import { classify, describeCommand, isAutoAllowed, type CommandClass, type CommandRequest } from '../cli/commands';
import type { CliRun, CliRunResult, Runner } from '../cli/runner';
import { readLockFile, type createRunRegistry, type ForeignLock } from './locks';

export type Trigger = 'user' | 'auto';

export interface QueueProject {
  repositoryId: string;
  repoPath: string;
  workspacePath: string;
}

/**
 * One line of the invocation log (spec §12.1, §12.5). It names the command and the trigger, never argument
 * values, output or file contents.
 */
export interface InvocationEntry {
  at: string;
  event: 'started' | 'rejected' | 'finished';
  repositoryId: string;
  command: string;
  trigger: Trigger;
  ai: boolean;
  reason?: RejectReason | 'project_unknown';
  exitCode?: number | null;
  runId?: string | null;
  errorCode?: string;
  cancelled?: boolean;
}

export type StartResult =
  | { ok: true; runKey: string; done: Promise<CliRunResult> }
  | { ok: false; reason: RejectReason | 'project_unknown'; message: string };

export interface RunQueueOptions {
  runner: Runner;
  registry: ReturnType<typeof createRunRegistry>;
  project: (repositoryId: string) => QueueProject | null;
  readLock?: (workspacePath: string) => Promise<ForeignLock | null>;
  clock?: () => Date;
  onLog?: (entry: InvocationEntry) => void;
  /** Builds the summary that goes to the renderer with the `finished` event. */
  summarize?: (label: string, request: CommandRequest, result: CliRunResult, lock: ForeignLock | null) => RunSummary;
}

export interface RunQueue {
  /** The only place in the app that starts the CLI (spec §12.1). */
  start(repositoryId: string, request: CommandRequest, trigger: Trigger): Promise<StartResult>;
  cancel(runKey: string): Promise<{ cancelled: boolean; reason?: 'not_cancellable' | 'run_unknown' }>;
  cancelAll(): Promise<void>;
  activeRuns(repositoryId?: string): { runKey: string; repositoryId: string; label: string; ai: boolean; cancellable: boolean; kind: CommandClass['kind'] }[];
  onEvent(listener: (event: RunEvent) => void): () => void;
  /** Sends an event to all listeners; used for the live lines of a run (spec §3.5). */
  emit(event: RunEvent): void;
  /** Foreign lock of a project, ignoring runs the app started itself. */
  foreignLock(repositoryId: string): Promise<ForeignLock | null>;
  /** Entries since the app started (for tests and the log file). */
  log(): readonly InvocationEntry[];
}

export function createRunQueue(options: RunQueueOptions): RunQueue {
  const clock = options.clock ?? (() => new Date());
  const readLock = options.readLock ?? ((workspace: string) => readLockFile(workspace));
  const entries: InvocationEntry[] = [];
  const listeners = new Set<(event: RunEvent) => void>();
  const running = new Map<
    string,
    { run: CliRun; repositoryId: string; label: string; ai: boolean; cancellable: boolean; kind: CommandClass['kind']; releaseKey: () => void }
  >();
  let counter = 0;

  const record = (entry: Omit<InvocationEntry, 'at'>): void => {
    const full: InvocationEntry = { at: clock().toISOString(), ...entry };
    entries.push(full);
    options.onLog?.(full);
  };
  const emit = (event: RunEvent): void => {
    for (const listener of listeners) listener(event);
  };

  async function foreignLock(repositoryId: string): Promise<ForeignLock | null> {
    const project = options.project(repositoryId);
    if (project === null) return null;
    const lock = await readLock(project.workspacePath);
    if (lock === null) return null;
    // The CLI child of a run the app started holds the lock itself; that is not foreign.
    for (const entry of running.values()) {
      if (entry.repositoryId === repositoryId && entry.run.pid === lock.pid) return null;
    }
    return lock;
  }

  async function start(repositoryId: string, request: CommandRequest, trigger: Trigger): Promise<StartResult> {
    const label = describeCommand(request);
    const kind = classify(request);
    const project = options.project(repositoryId);
    if (project === null) {
      record({ event: 'rejected', repositoryId, command: label, trigger, ai: kind.ai, reason: 'project_unknown' });
      return { ok: false, reason: 'project_unknown', message: 'Dieses Projekt ist nicht in der Projektliste.' };
    }
    if (trigger === 'auto' && !isAutoAllowed(request)) {
      record({ event: 'rejected', repositoryId, command: label, trigger, ai: kind.ai, reason: 'auto_not_allowed' });
      return { ok: false, reason: 'auto_not_allowed', message: REJECT_MESSAGES.auto_not_allowed };
    }

    // Only commands that take a lock or can call Claude need the lock file; reading it costs a file access.
    const needsLockCheck = kind.kind === 'write' || kind.ai;
    const lock = needsLockCheck ? await foreignLock(repositoryId) : null;
    const acquired = options.registry.tryAcquire({ repositoryId, kind: kind.kind, ai: kind.ai, label }, lock);
    if (!acquired.ok) {
      record({ event: 'rejected', repositoryId, command: label, trigger, ai: kind.ai, reason: acquired.reason });
      return { ok: false, reason: acquired.reason, message: REJECT_MESSAGES[acquired.reason] };
    }

    const runKey = `k${++counter}`;
    const startedAt = clock().toISOString();
    const run = options.runner.start(project.repoPath, request);
    running.set(runKey, { run, repositoryId, label, ai: kind.ai, cancellable: kind.cancellable, kind: kind.kind, releaseKey: acquired.release });
    record({ event: 'started', repositoryId, command: label, trigger, ai: kind.ai });
    // Long runs show in the run panel; note, skip, baseline and doctor report to their dialog (spec §8.7).
    const panel = kind.ai || request.name === 'capture' || request.name === 'journal';
    if (trigger === 'user') {
      emit({ type: 'started', runKey, repositoryId, label, cancellable: kind.cancellable, ai: kind.ai, panel, startedAt });
    }

    const done = run.result.then(async (result) => {
      running.delete(runKey);
      acquired.release();
      // For exit code 3 the lock file names the run that holds it (spec §8.7: "Aktiv seit ...").
      const holder = result.exitCode === 3 ? await foreignLock(repositoryId) : null;
      record({
        event: 'finished',
        repositoryId,
        command: label,
        trigger,
        ai: kind.ai,
        exitCode: result.exitCode,
        runId: result.envelope?.runId ?? null,
        ...(result.failure !== null ? { errorCode: result.failure.code } : {}),
        ...(result.cancelled ? { cancelled: true } : {}),
      });
      if (trigger === 'user') {
        emit({
          type: 'finished',
          runKey,
          repositoryId,
          exitCode: result.exitCode,
          cancelled: result.cancelled,
          notice: result.exitCode === 3 ? 'lock_held' : null,
          failure: result.failure,
          summary: options.summarize?.(label, request, result, holder) ?? null,
        });
      }
      return result;
    });
    return { ok: true, runKey, done };
  }

  return {
    start,
    async cancel(runKey) {
      const entry = running.get(runKey);
      if (entry === undefined) return { cancelled: false, reason: 'run_unknown' };
      if (!entry.cancellable) return { cancelled: false, reason: 'not_cancellable' };
      await entry.run.cancel();
      return { cancelled: true };
    },
    async cancelAll() {
      await Promise.all([...running.values()].filter((entry) => entry.cancellable).map((entry) => entry.run.cancel()));
    },
    activeRuns(repositoryId) {
      return [...running.entries()]
        .filter(([, entry]) => repositoryId === undefined || entry.repositoryId === repositoryId)
        .map(([runKey, entry]) => ({
          runKey,
          repositoryId: entry.repositoryId,
          label: entry.label,
          ai: entry.ai,
          cancellable: entry.cancellable,
          kind: entry.kind,
        }));
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    emit,
    foreignLock,
    log: () => entries,
  };
}
