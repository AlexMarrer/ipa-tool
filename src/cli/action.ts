/**
 * Frame of the commands with `--json` (package 09 §4.1): one JSON object on stdout instead of the
 * human-readable lines. stderr and exit codes stay as without `--json`.
 */
import { type ExitCode, exitCodeOf } from '../core/errors.js';
import { toPortablePath } from '../core/paths.js';
import { outcomeForExitCode, type RunError, type RunOutcome, runErrorOf } from '../core/run-log.js';
import type { CliIo, CliState } from './io.js';

/** The channels of one command run. `stdout` is silent with `--json`. */
export interface Emitter {
  stdout(text: string): void;
  stderr(text: string): void;
  /** A warning or hint line without line break: written to stderr and, with `--json`, listed in `warnings`. */
  warn(line: string): void;
  /** Set as soon as the context exists; `null` for an error before that. */
  runId: string | null;
}

export interface ActionReport {
  exitCode: ExitCode;
  /** Defaults to the outcome of the exit code (spec.md §9.11). */
  outcome?: RunOutcome;
  /** Defaults to none. */
  errors?: RunError[];
  /** The `result` of the JSON object; `null` if the command has none. */
  result: object | null;
  /** Writes the human-readable output through the emitter. */
  print(): void;
}

export interface ActionEnv {
  command: string;
  json: boolean;
  io: CliIo;
  state: CliState;
}

export interface JsonEnvelope {
  schemaVersion: 1;
  command: string;
  runId: string | null;
  ok: boolean;
  exitCode: ExitCode;
  outcome: RunOutcome;
  errors: RunError[];
  warnings: string[];
  result: object | null;
}

/** Absolute path with `/` and an upper-case drive letter, as in every output of the tool. */
export function jsonPath(file: string): string {
  return toPortablePath(file);
}

export function jsonPathOrNull(file: string | null): string | null {
  return file === null ? null : jsonPath(file);
}

function envelope(env: ActionEnv, runId: string | null, warnings: string[], report: Omit<ActionReport, 'print'>): JsonEnvelope {
  return {
    schemaVersion: 1,
    command: env.command,
    runId,
    ok: report.exitCode === 0,
    exitCode: report.exitCode,
    outcome: report.outcome ?? outcomeForExitCode(report.exitCode),
    errors: report.errors ?? [],
    warnings,
    result: report.result,
  };
}

function write(env: ActionEnv, value: JsonEnvelope): void {
  env.io.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Runs the body and reports it. An error thrown by the body goes on to `reportError` (stderr and exit
 * code, unchanged); with `--json` the object with `result: null` is written first.
 */
export async function runAction(env: ActionEnv, body: (out: Emitter) => Promise<ActionReport>): Promise<void> {
  const warnings: string[] = [];
  const out: Emitter = {
    runId: null,
    stdout: (text) => {
      if (!env.json) env.io.stdout(text);
    },
    stderr: (text) => env.io.stderr(text),
    warn: (line) => {
      warnings.push(line);
      env.io.stderr(`${line}\n`);
    },
  };
  let report: ActionReport;
  try {
    report = await body(out);
  } catch (error) {
    if (env.json) write(env, envelope(env, out.runId, warnings, { exitCode: exitCodeOf(error), errors: [runErrorOf(error)], result: null }));
    throw error;
  }
  report.print();
  if (env.json) write(env, envelope(env, out.runId, warnings, report));
  env.state.exitCode = report.exitCode;
}
