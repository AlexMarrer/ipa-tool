/**
 * Run log `runs.jsonl` (spec.md §9.11).
 */
import path from 'node:path';
import type { WorkspaceContext } from './context.js';
import { EXIT, type ExitCode, IpaError } from './errors.js';
import { appendJsonl, type JsonlReadResult, readJsonl } from './jsonl.js';
import { formatZoned } from './time.js';

export const RUNS_FILE = 'runs.jsonl';

export type RunOutcome =
  | 'ok'
  | 'unchanged'
  | 'halted'
  | 'unstable'
  | 'lock_held'
  | 'analysis_failed'
  | 'outside_window'
  | 'usage_error'
  | 'error';

export interface RunError {
  code: string;
  /** Never contains repository content (I-12). */
  message: string;
}

export interface RunRecord {
  schemaVersion: 1;
  runId: string;
  command: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  exitCode: ExitCode;
  outcome: RunOutcome;
  snapshotCreated: string | null;
  analysesCompleted: string[];
  analysesFailed: string[];
  lockBroken: boolean;
  errors: RunError[];
  /** Snapshots taken over from an aborted run (spec.md §11.6); only present when not empty. */
  recovered?: string[];
}

export function runsLogPath(workspaceDir: string): string {
  return path.join(workspaceDir, RUNS_FILE);
}

/** Commands set `unchanged` and `outside_window` themselves. */
export function outcomeForExitCode(exitCode: ExitCode): RunOutcome {
  switch (exitCode) {
    case 0:
      return 'ok';
    case 2:
      return 'usage_error';
    case 3:
      return 'lock_held';
    case 4:
      return 'halted';
    case 5:
      return 'unstable';
    case 6:
      return 'analysis_failed';
    case 1:
    case 7:
      return 'error';
  }
}

export interface RunRecordInput {
  runId: string;
  command: string;
  startedAt: Date;
  endedAt: Date;
  timezone: string;
  exitCode: ExitCode;
  outcome?: RunOutcome;
  lockBroken: boolean;
  snapshotCreated?: string | null;
  analysesCompleted?: string[];
  analysesFailed?: string[];
  errors?: RunError[];
  recovered?: string[];
}

export function createRunRecord(input: RunRecordInput): RunRecord {
  const record: RunRecord = {
    schemaVersion: 1,
    runId: input.runId,
    command: input.command,
    startedAt: formatZoned(input.startedAt, input.timezone),
    endedAt: formatZoned(input.endedAt, input.timezone),
    durationMs: Math.max(0, input.endedAt.getTime() - input.startedAt.getTime()),
    exitCode: input.exitCode,
    outcome: input.outcome ?? outcomeForExitCode(input.exitCode),
    snapshotCreated: input.snapshotCreated ?? null,
    analysesCompleted: input.analysesCompleted ?? [],
    analysesFailed: input.analysesFailed ?? [],
    lockBroken: input.lockBroken,
    errors: input.errors ?? [],
  };
  if (input.recovered !== undefined && input.recovered.length > 0) record.recovered = input.recovered;
  return record;
}

const MAX_ERROR_MESSAGE = 300;

/** Run log entry with the message shortened to its first line (I-12). */
export function shortRunError(code: string, text: string): RunError {
  const line = text.split(/\r?\n/)[0] ?? '';
  return { code, message: line.length > MAX_ERROR_MESSAGE ? `${line.slice(0, MAX_ERROR_MESSAGE)} …` : line };
}

/** Run log entry for a failure. */
export function runErrorOf(error: unknown): RunError {
  return shortRunError(error instanceof IpaError ? error.code : 'internal', error instanceof Error ? error.message : String(error));
}

export async function appendRunRecord(workspaceDir: string, record: RunRecord): Promise<void> {
  await appendJsonl(runsLogPath(workspaceDir), record, 'run-record');
}

/**
 * Log entry for a run that did not get the lock (exit code 3). It is appended without the lock;
 * a single append of one line does not interleave with the lock holder's own entry.
 */
export async function appendLockHeldRecord(ctx: WorkspaceContext, command: string, startedAt: Date, error: unknown): Promise<void> {
  await appendRunRecord(
    ctx.workspaceDir,
    createRunRecord({
      runId: ctx.runId,
      command,
      startedAt,
      endedAt: ctx.clock.now(),
      timezone: ctx.config.timezone,
      exitCode: EXIT.lockHeld,
      lockBroken: false,
      errors: [runErrorOf(error)],
    }),
  );
}

export async function readRunRecords(workspaceDir: string): Promise<JsonlReadResult<RunRecord>> {
  return readJsonl<RunRecord>(runsLogPath(workspaceDir), 'run-record');
}
