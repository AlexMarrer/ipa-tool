/**
 * `ipa capture [--no-analysis] [--retry <snapshotId>] [--scheduled]` (spec.md §4.4, §6.3): capture, then
 * the analysis queue (package 06), also after a halt or an unstable worktree. `--scheduled` checks the
 * working-time window first (package 08).
 */
import path from 'node:path';
import type { Command } from 'commander';
import { logPath } from '../../analysis/files.js';
import { processQueue } from '../../analysis/queue.js';
import { requestRetry } from '../../analysis/skip.js';
import { summarizeAnalyses } from '../../analysis/summary.js';
import type { QueueHooks, QueueResult } from '../../analysis/types.js';
import { createClaudeRunner } from '../../claude/runner.js';
import type { ClaudeRunner } from '../../claude/types.js';
import { captureSnapshot } from '../../collector/capture.js';
import { BASELINE_HINT, describeHalt } from '../../collector/halt.js';
import { recoverWorkspace } from '../../collector/recovery.js';
import { MANIFEST_FILE, readManifest, snapshotDir } from '../../collector/snapshots.js';
import type { CaptureHooks, CaptureOutcome, Manifest } from '../../collector/types.js';
import { resolveContext, type WorkspaceContext } from '../../core/context.js';
import { EXIT, type ExitCode, exitCodeOf, IpaError, LockHeldError, mergeExitCodes } from '../../core/errors.js';
import { withLock } from '../../core/lock.js';
import {
  appendLockHeldRecord,
  appendRunRecord,
  createRunRecord,
  type RunError,
  type RunOutcome,
  runErrorOf,
  shortRunError,
} from '../../core/run-log.js';
import { readState, writeState } from '../../core/state.js';
import { formatZoned } from '../../core/time.js';
import { checkScheduleWindow, describeOutsideWindow, type WindowCheck } from '../../schedule/window.js';
import { type ActionReport, type Emitter, jsonPath, runAction } from '../action.js';
import { formatFields } from '../format.js';
import type { CliIo, CliState, GlobalOptions } from '../io.js';

export interface CaptureAnalysisOptions {
  runner: ClaudeRunner;
  hooks?: QueueHooks;
  /** Environment for the readiness check of Claude. */
  env?: NodeJS.ProcessEnv;
}

export interface CaptureRunOptions {
  hooks?: CaptureHooks;
  onWarning?: (message: string) => void;
  /** Without it the queue is not processed (`--no-analysis`). */
  analysis?: CaptureAnalysisOptions;
  /** `--retry <snapshotId>`: releases further attempts before the capture (spec.md §12.1). */
  retry?: string;
  /** `--scheduled`: outside the working-time window the run ends before the lock (spec.md §11.1). */
  scheduled?: boolean;
}

export interface CaptureRunResult {
  exitCode: ExitCode;
  snapshotId: string | null;
  /** `null` if the capture step ended with an unstable worktree. */
  outcome: CaptureOutcome | null;
  /** Exit code 5 of the capture step; the queue still ran. */
  captureError: IpaError | null;
  recovered: string[];
  queue: QueueResult | null;
  retry: { snapshotId: string; afterAttempt: number } | null;
  /** Set if `--scheduled` found the run outside the window; nothing else happened then. */
  outsideWindow: WindowCheck | null;
}

/**
 * spec.md §6.4 with the exception of package 06 §4: a halt (4) takes precedence over an incomplete
 * analysis (6), because only `ipa baseline` lets the capture continue (spec.md §18).
 */
export function captureExitCode(captureCode: ExitCode, queueCode: ExitCode): ExitCode {
  if (captureCode === EXIT.halted && queueCode === EXIT.analysisIncomplete) return EXIT.halted;
  return mergeExitCodes(captureCode, queueCode);
}

function queueErrors(queue: QueueResult | null): RunError[] {
  return (queue?.failed ?? []).map((problem) => shortRunError(problem.code, `${problem.snapshotId}: ${problem.message}`));
}

/**
 * `--scheduled` outside the window: exit code 0 and one `outside_window` entry, appended without the lock
 * like a `lock_held` entry. No snapshot, no queue, and `state.json` stays unchanged, so
 * `lastSuccessfulRun` still names the last real capture (spec.md §18).
 */
async function skipOutsideWindow(ctx: WorkspaceContext, startedAt: Date, window: WindowCheck): Promise<CaptureRunResult> {
  await appendRunRecord(
    ctx.workspaceDir,
    createRunRecord({
      runId: ctx.runId,
      command: 'capture',
      startedAt,
      endedAt: ctx.clock.now(),
      timezone: ctx.config.timezone,
      exitCode: EXIT.ok,
      outcome: 'outside_window',
      lockBroken: false,
    }),
  );
  return { exitCode: EXIT.ok, snapshotId: null, outcome: null, captureError: null, recovered: [], queue: null, retry: null, outsideWindow: window };
}

/**
 * Lock, recovery (spec.md §11.6), capture, analysis queue and run log for one `capture` run. Errors
 * that end the run are logged in `runs.jsonl` and then rethrown.
 */
export async function runCapture(ctx: WorkspaceContext, options: CaptureRunOptions = {}): Promise<CaptureRunResult> {
  const startedAt = ctx.clock.now();
  if (options.scheduled === true) {
    // Before any other step, including the lock (package 08 §4).
    const window = checkScheduleWindow(startedAt, ctx.config.timezone, ctx.config.schedule);
    if (!window.inside) return skipOutsideWindow(ctx, startedAt, window);
  }
  // No new Claude call starts after `limits.maxRunSeconds` from the start of the run (spec.md §12.2).
  const deadline = new Date(startedAt.getTime() + ctx.config.limits.maxRunSeconds * 1000);
  try {
    return await withLock(ctx, 'capture', async ({ lockBroken }) => {
      let recovered: string[] = [];
      let snapshotId: string | null = null;
      let outcome: CaptureOutcome | null = null;
      let captureError: IpaError | null = null;
      let queue: QueueResult | null = null;
      let retry: CaptureRunResult['retry'] = null;
      let failure: unknown = null;
      try {
        ({ recovered } = await recoverWorkspace(ctx));
        const state = await readState(ctx.workspaceDir);
        if (state.baselineSnapshotId === null) {
          throw new IpaError(
            'baseline_missing',
            EXIT.usage,
            'Es gibt noch keinen Ausgangs-Snapshot. Bitte zuerst ipa init ausführen; bei einem bereits angelegten Arbeitsbereich holt es den Ausgangs-Snapshot nach.',
          );
        }
        if (options.retry !== undefined) {
          const { afterAttempt } = await requestRetry(ctx, options.retry);
          retry = { snapshotId: options.retry, afterAttempt };
        }
        try {
          outcome = await captureSnapshot(ctx, { kind: 'work', hooks: options.hooks, onWarning: options.onWarning });
        } catch (error) {
          // Stored snapshots can still be analysed while the worktree keeps changing (spec.md §4.4).
          if (!(error instanceof IpaError) || error.exitCode !== EXIT.unstable) throw error;
          captureError = error;
        }
        if (outcome?.type === 'created') snapshotId = outcome.snapshotId;
        if (options.analysis !== undefined) {
          queue = await processQueue(ctx, options.analysis.runner, {
            deadline,
            ...(options.analysis.hooks === undefined ? {} : { hooks: options.analysis.hooks }),
            ...(options.analysis.env === undefined ? {} : { env: options.analysis.env }),
          });
        }
      } catch (error) {
        failure = error;
      }
      const endedAt = ctx.clock.now();
      const captureCode: ExitCode = captureError !== null ? EXIT.unstable : outcome?.type === 'halted' ? EXIT.halted : EXIT.ok;
      const exitCode = failure !== null ? exitCodeOf(failure) : captureExitCode(captureCode, queue?.exitCode ?? EXIT.ok);
      if (exitCode === EXIT.ok) {
        const state = await readState(ctx.workspaceDir);
        await writeState(ctx.workspaceDir, { ...state, lastSuccessfulRun: formatZoned(endedAt, ctx.config.timezone) });
      }
      const errors: RunError[] =
        failure !== null ? [runErrorOf(failure)] : [...(captureError === null ? [] : [runErrorOf(captureError)]), ...queueErrors(queue)];
      await appendRunRecord(
        ctx.workspaceDir,
        createRunRecord({
          runId: ctx.runId,
          command: 'capture',
          startedAt,
          endedAt,
          timezone: ctx.config.timezone,
          exitCode,
          outcome: exitCode === EXIT.ok && outcome?.type === 'unchanged' ? 'unchanged' : undefined,
          lockBroken,
          snapshotCreated: snapshotId,
          analysesCompleted: queue?.completed.map((entry) => entry.snapshotId) ?? [],
          analysesFailed: [...new Set(queue?.failed.map((problem) => problem.snapshotId) ?? [])],
          recovered,
          errors,
        }),
      );
      if (failure !== null) throw failure;
      return { exitCode, snapshotId, outcome, captureError, recovered, queue, retry, outsideWindow: null };
    });
  } catch (error) {
    if (error instanceof LockHeldError) await appendLockHeldRecord(ctx, 'capture', startedAt, error);
    throw error;
  }
}

function summarize(manifest: Manifest): string {
  const count = (decision: string) => manifest.filterDecisions.filter((entry) => entry.decision === decision).length;
  const kinds = (kind: string) => manifest.evidence.filter((entry) => entry.kind === kind).length;
  return (
    `Snapshot ${manifest.snapshotId} gespeichert (Arbeits-Snapshot).\n` +
    formatFields([
      ['Commits', String(manifest.commits.length)],
      ['Dateizustände', String(manifest.fileStates.length)],
      ['Belege', String(manifest.evidence.length)],
      ['Zustandsdeltas', String(kinds('state_delta'))],
      ['Statusänderungen', String(manifest.statusChanges.length)],
      ['Testberichte', String(kinds('test_report'))],
      ['Lücken', String(manifest.gaps.length)],
      ['Analyse nötig', manifest.analysisRequired ? 'ja' : 'nein'],
      ['Ausgeschlossen', String(count('excluded'))],
      ['Zurückgehalten', String(count('withheld'))],
      ['Ausgelassen', String(count('omitted'))],
    ])
  );
}

export function withheldNotice(manifest: Manifest): string | null {
  const withheld = manifest.filterDecisions.filter((entry) => entry.decision === 'withheld').length;
  if (withheld === 0) return null;
  return (
    `Hinweis: ${withheld} Einheit(en) wegen Secret-Verdacht zurückgehalten. Offene Prüfung: filterDecisions ` +
    `im Manifest von ${manifest.snapshotId} nennt Pfad, Detektor und Zeile, nie den Wert.`
  );
}

const STATUS_HINTS: Record<string, (snapshotId: string) => string> = {
  failed: (id) => `Analyse ${id} bleibt offen (failed); der nächste Lauf versucht es erneut.`,
  blocked: (id) =>
    `Analyse ${id} ist blockiert (blocked): Eingabepaket zu gross. limits.maxAnalysisInputBytes in config.json erhöhen ` +
    `oder mit ipa skip ${id} --reason "<Grund>" auslassen.`,
  exhausted: (id) =>
    `Analyse ${id} ist erschöpft (exhausted): mit ipa capture --retry ${id} erneut versuchen ` +
    `oder mit ipa skip ${id} --reason "<Grund>" auslassen.`,
};

/** Where `reportQueue` writes; `warn` also lists the line in the JSON result. */
export interface QueueSink {
  stdout(text: string): void;
  stderr(text: string): void;
  warn?(line: string): void;
}

/** Results to stdout, problems and hints to stderr (spec.md §6.5); never repository content. */
export function reportQueue(io: QueueSink, queue: QueueResult): void {
  const warn = io.warn ?? ((line: string) => io.stderr(`${line}\n`));
  for (const warning of queue.warnings) warn(warning);
  if (queue.caughtUp.length > 0) {
    warn(`Hinweis: Analyse-Cursor ohne neuen Aufruf nachgeführt über ${queue.caughtUp.join(', ')} (abgebrochener Lauf).`);
  }
  for (const { snapshotId, mode } of queue.completed) {
    io.stdout(`Analyse ${snapshotId} abgeschlossen (${mode === 'ai' ? 'Claude' : 'ohne KI'}), Work-Log: logs/${snapshotId}.md\n`);
  }
  for (const problem of queue.failed) {
    io.stderr(`Analyse ${problem.snapshotId} nicht abgeschlossen (${problem.code}): ${problem.message}\n`);
  }
  const first = queue.open[0];
  if (first !== undefined) {
    const hint = STATUS_HINTS[first.status];
    if (hint !== undefined) io.stderr(`${hint(first.snapshotId)}\n`);
    else if (queue.stoppedBy?.reason === 'run_limit') {
      io.stderr(`Hinweis: Grenze claude.maxAnalysesPerRun erreicht; ${first.snapshotId} folgt im nächsten Lauf.\n`);
    } else if (queue.stoppedBy?.reason === 'deadline') {
      io.stderr(`Hinweis: Laufzeitgrenze limits.maxRunSeconds erreicht, kein weiterer Claude-Aufruf; ${first.snapshotId} folgt im nächsten Lauf.\n`);
    }
  }
  const openIds = queue.open.map((entry) => entry.snapshotId);
  io.stdout(`Analyse-Cursor: ${queue.cursor ?? 'keiner'}; offene Analysen: ${openIds.length === 0 ? 'keine' : openIds.join(', ')}\n`);
}

interface CaptureCommandOptions extends GlobalOptions {
  analysis?: boolean;
  retry?: string;
  scheduled?: boolean;
  json?: boolean;
}

/** The run outcome as `runs.jsonl` records it for returned results (spec.md §9.11). */
function captureOutcome(result: CaptureRunResult): RunOutcome | undefined {
  if (result.outsideWindow !== null) return 'outside_window';
  return result.exitCode === EXIT.ok && result.outcome?.type === 'unchanged' ? 'unchanged' : undefined;
}

function captureStep(result: CaptureRunResult): string {
  if (result.outsideWindow !== null) return 'skipped';
  return result.outcome === null ? 'unstable' : result.outcome.type;
}

function snapshotSummary(ctx: WorkspaceContext, manifest: Manifest): object {
  const count = (decision: string) => manifest.filterDecisions.filter((entry) => entry.decision === decision).length;
  const kinds = (kind: string) => manifest.evidence.filter((entry) => entry.kind === kind).length;
  return {
    id: manifest.snapshotId,
    kind: manifest.kind,
    manifestPath: jsonPath(path.join(snapshotDir(ctx.workspaceDir, manifest.snapshotId), MANIFEST_FILE)),
    commits: manifest.commits.length,
    fileStates: manifest.fileStates.length,
    evidence: manifest.evidence.length,
    stateDeltas: kinds('state_delta'),
    statusChanges: manifest.statusChanges.length,
    testReports: kinds('test_report'),
    gaps: manifest.gaps.length,
    excluded: count('excluded'),
    withheld: count('withheld'),
    omitted: count('omitted'),
    analysisRequired: manifest.analysisRequired,
  };
}

function queueSummary(ctx: WorkspaceContext, queue: QueueResult): object {
  return {
    claudeCalls: queue.claudeCalls,
    completed: queue.completed.map((entry) => ({
      snapshotId: entry.snapshotId,
      mode: entry.mode,
      workLogPath: jsonPath(logPath(ctx.workspaceDir, entry.snapshotId)),
    })),
    failed: queue.failed.map((problem) => ({ snapshotId: problem.snapshotId, code: problem.code, message: problem.message })),
    caughtUp: queue.caughtUp,
    stoppedBy: queue.stoppedBy,
    cursor: queue.cursor,
    open: queue.open,
  };
}

/** Describes a finished run for the output and for `--json`; the human-readable lines are those of package 02 to 08. */
async function captureReport(ctx: WorkspaceContext, out: Emitter, result: CaptureRunResult, scheduled: boolean): Promise<ActionReport> {
  const manifest = result.snapshotId === null ? null : await readManifest(ctx, result.snapshotId);
  const lastSnapshotId = result.snapshotId === null && result.outcome?.type === 'unchanged' ? (await readState(ctx.workspaceDir)).lastSnapshotId : null;
  const window = result.outsideWindow;
  const errors: RunError[] = [...(result.captureError === null ? [] : [runErrorOf(result.captureError)]), ...queueErrors(result.queue)];
  const outcome = captureOutcome(result);
  return {
    exitCode: result.exitCode,
    ...(outcome === undefined ? {} : { outcome }),
    errors,
    result: {
      scheduled,
      outsideWindow: window === null ? null : { weekday: window.weekday, time: window.time, reason: window.reason },
      capture: captureStep(result),
      snapshot: manifest === null ? null : snapshotSummary(ctx, manifest),
      halt: result.outcome?.type === 'halted' ? result.outcome.halt : null,
      recovered: result.recovered,
      retry: result.retry,
      analysis: result.queue === null ? null : queueSummary(ctx, result.queue),
      analyses: window === null ? await summarizeAnalyses(ctx) : null,
    },
    print: () => {
      if (window !== null) {
        // Nothing on stdout (package 08 §4); the hint helps when the command is started by hand.
        out.stderr(`${describeOutsideWindow(window, ctx.config.timezone, ctx.config.schedule)}\n`);
        return;
      }
      for (const id of result.recovered) out.warn(`Hinweis: Snapshot ${id} aus einem abgebrochenen Lauf übernommen.`);
      if (result.retry !== null) {
        out.stdout(`Weitere Versuche für ${result.retry.snapshotId} freigegeben (retry-${result.retry.afterAttempt}.json).\n`);
      }
      if (manifest !== null) {
        out.stdout(summarize(manifest));
        const notice = withheldNotice(manifest);
        if (notice !== null) out.warn(notice);
      } else if (result.outcome?.type === 'unchanged') {
        out.stdout(`Keine neue Arbeit seit Snapshot ${lastSnapshotId ?? '–'}. Es wurde kein Snapshot gespeichert.\n`);
      } else if (result.outcome?.type === 'halted') {
        out.stderr(`Angehalten: ${describeHalt(result.outcome.halt)}\n${BASELINE_HINT}\n`);
      }
      if (result.captureError !== null) out.stderr(`Fehler: ${result.captureError.message}\n`);
      if (result.queue === null) out.stdout('Analyse übersprungen (--no-analysis).\n');
      else reportQueue(out, result.queue);
    },
  };
}

export function registerCaptureCommand(program: Command, io: CliIo, state: CliState): void {
  program
    .command('capture')
    .usage('[optionen]')
    .description('Snapshot des Arbeitsstands aufnehmen und offene Analysen verarbeiten')
    .option('--no-analysis', 'nur aufnehmen, offene Analysen nicht verarbeiten')
    .option('--retry <snapshotId>', 'weitere Versuche für einen Snapshot im Status exhausted freigeben')
    .option('--scheduled', 'geplanter Lauf: ausserhalb des Zeitfensters aus config.json ohne Aufnahme beenden (Exit-Code 0)')
    .option('--json', 'Ergebnis als JSON-Objekt auf stdout')
    .action(async (_options: unknown, command: Command) => {
      const options = command.optsWithGlobals<CaptureCommandOptions>();
      await runAction({ command: 'capture', json: options.json === true, io, state }, async (out) => {
        const ctx = await resolveContext({ repo: options.repo, dataDir: options.dataDir, requireInit: true });
        out.runId = ctx.runId;
        const result = await runCapture(ctx, {
          onWarning: (message) => out.warn(message),
          ...(options.retry === undefined ? {} : { retry: options.retry }),
          ...(options.scheduled === true ? { scheduled: true } : {}),
          ...(options.analysis === false ? {} : { analysis: { runner: createClaudeRunner({ env: io.env }), env: io.env } }),
        });
        return captureReport(ctx, out, result, options.scheduled === true);
      });
    });
}
