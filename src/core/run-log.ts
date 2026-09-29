/**
 * Laufprotokoll `runs.jsonl` (spec.md §9.11).
 */
import path from 'node:path';
import type { ExitCode } from './errors.js';
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
  /** Enthält keine Inhalte aus dem Repository (I-12). */
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
}

export function runsLogPath(workspaceDir: string): string {
  return path.join(workspaceDir, RUNS_FILE);
}

/** Standard-Ergebnis zu einem Exit-Code. Befehle setzen `unchanged` oder `outside_window` selbst. */
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
}

export function createRunRecord(input: RunRecordInput): RunRecord {
  return {
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
}

export async function appendRunRecord(workspaceDir: string, record: RunRecord): Promise<void> {
  await appendJsonl(runsLogPath(workspaceDir), record, 'run-record');
}

export async function readRunRecords(workspaceDir: string): Promise<JsonlReadResult<RunRecord>> {
  return readJsonl<RunRecord>(runsLogPath(workspaceDir), 'run-record');
}
