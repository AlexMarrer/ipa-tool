import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CliEnvelope, StatusReport } from '../../shared/cli-types';
import type { IpaError } from '../../shared/types';
import { killProcessTree, type KillTree } from '../run/cancel';
import { buildCommand, type CommandRequest } from './commands';
import { AppError } from './errors';
import type { Runtime } from './runtime';
import type { SchemaValidator } from './validator';

const execFileAsync = promisify(execFile);
const DETAILS_LIMIT = 4000;

export interface CliRunResult {
  /** `null` when the process ended by a signal or never started. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  envelope: CliEnvelope | null;
  status: StatusReport | null;
  cancelled: boolean;
  /** A failure of the app around the CLI (spec §3.4); `null` for every exit code the CLI itself reports. */
  failure: IpaError | null;
}

export interface CliRun {
  pid: number | undefined;
  result: Promise<CliRunResult>;
  /** Ends the whole process tree; the result then reports `cancelled`. */
  cancel(): Promise<void>;
}

export interface Runner {
  start(repoPath: string, request: CommandRequest, extraEnv?: NodeJS.ProcessEnv): CliRun;
  /** Output of `ipa --version`. */
  version(): Promise<string>;
}

export interface RunnerOptions {
  runtime: Runtime;
  /** Working directory of every call: a folder outside any repository (spec §3.4). */
  cwd: string;
  env?: NodeJS.ProcessEnv;
  validator: SchemaValidator;
  killTree?: KillTree;
}

function tail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= DETAILS_LIMIT ? trimmed : `…${trimmed.slice(-DETAILS_LIMIT)}`;
}

function failureOf(error: AppError): IpaError {
  return error.toIpaError();
}

export function isStatusReport(value: unknown): value is StatusReport {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const text = (key: string): boolean => typeof v[key] === 'string';
  const object = (key: string): boolean => typeof v[key] === 'object' && v[key] !== null;
  return (
    text('repositoryId') &&
    text('repoPath') &&
    text('workspacePath') &&
    text('timezone') &&
    (v['workspaceMode'] === 'default' || v['workspaceMode'] === 'explicit') &&
    object('snapshots') &&
    object('analyses') &&
    object('withheld') &&
    typeof v['notesToday'] === 'number' &&
    'halt' in v &&
    'lastRun' in v &&
    'claude' in v
  );
}

export function createRunner(options: RunnerOptions): Runner {
  const { runtime, cwd, validator } = options;
  const killTree = options.killTree ?? killProcessTree;

  function start(repoPath: string, request: CommandRequest, extraEnv?: NodeJS.ProcessEnv): CliRun {
    const built = buildCommand(request);
    // The only global option is --repo: both the app and the console use the default data root (spec §3.4).
    const argv = [runtime.cliJs, '--repo', repoPath, ...built.args];
    const env = { ...(options.env ?? process.env), ...(extraEnv ?? {}) };

    let child: ChildProcess;
    let cancelRequested = false;
    let stdout = '';
    let stderr = '';

    const result = new Promise<CliRunResult>((resolve) => {
      let settled = false;
      const finish = (value: CliRunResult): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const base = (): Omit<CliRunResult, 'failure'> => ({
        exitCode: null,
        stdout,
        stderr,
        envelope: null,
        status: null,
        cancelled: cancelRequested,
      });

      try {
        child = spawn(runtime.nodeExe, argv, { shell: false, windowsHide: true, cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        finish({ ...base(), failure: failureOf(new AppError('spawn_failed', error instanceof Error ? error.message : String(error))) });
        return;
      }
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => (stdout += chunk));
      child.stderr?.on('data', (chunk: string) => (stderr += chunk));
      child.on('error', (error) => {
        finish({ ...base(), failure: failureOf(new AppError('spawn_failed', error.message)) });
      });
      child.on('close', (code) => {
        const common = { ...base(), exitCode: code };
        if (cancelRequested) {
          finish({ ...common, failure: null });
          return;
        }
        finish({ ...common, ...interpret(built, code, stdout, stderr) });
      });
    });

    return {
      get pid() {
        return child?.pid;
      },
      result,
      async cancel() {
        cancelRequested = true;
        const pid = child?.pid;
        if (pid !== undefined) await killTree(pid);
      },
    };
  }

  function interpret(
    built: ReturnType<typeof buildCommand>,
    exitCode: number | null,
    out: string,
    err: string,
  ): Pick<CliRunResult, 'envelope' | 'status' | 'failure'> {
    const invalid = (details: string): Pick<CliRunResult, 'envelope' | 'status' | 'failure'> => ({
      envelope: null,
      status: null,
      failure: failureOf(new AppError('cli_output_invalid', tail(`${details}\n${err}`))),
    });

    if (built.output === 'status') {
      if (exitCode !== 0) return { envelope: null, status: null, failure: null };
      try {
        const parsed: unknown = JSON.parse(out);
        return isStatusReport(parsed) ? { envelope: null, status: parsed, failure: null } : invalid('status --json hat nicht die erwarteten Felder.');
      } catch {
        return invalid('status --json lieferte kein JSON.');
      }
    }

    if (out.trim() === '') {
      if (exitCode === 2) {
        return { envelope: null, status: null, failure: failureOf(new AppError('commander_error', tail(err))) };
      }
      return invalid('Keine Ausgabe auf stdout.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(out);
    } catch {
      return invalid('stdout ist kein einzelnes JSON-Objekt.');
    }
    const outcome = validator.validate(built.schema ?? '', parsed);
    if (!outcome.ok) return invalid(`Schema ${built.schema}: ${outcome.issues.join('; ')}`);
    const envelope = parsed as CliEnvelope;
    if (envelope.exitCode !== exitCode) {
      return invalid(`Exit-Code des Prozesses (${String(exitCode)}) weicht von der Hülle (${envelope.exitCode}) ab.`);
    }
    return { envelope, status: null, failure: null };
  }

  async function version(): Promise<string> {
    try {
      const { stdout } = await execFileAsync(runtime.nodeExe, [runtime.cliJs, '--version'], {
        windowsHide: true,
        encoding: 'utf8',
        cwd,
        env: options.env ?? process.env,
        timeout: 30_000,
      });
      return stdout.trim();
    } catch (error) {
      throw new AppError('spawn_failed', error instanceof Error ? error.message : String(error));
    }
  }

  return { start, version };
}

/** Version the app expects: written at build time, in development the `package.json` of the CLI (spec §6.5). */
export function readExpectedCliVersion(appRoot: string, cliRoot: string): string | null {
  for (const file of [path.join(appRoot, 'out', 'cli-version.json'), path.join(cliRoot, 'package.json')]) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown };
      if (typeof parsed.version === 'string') return parsed.version;
    } catch {
      // try the next source
    }
  }
  return null;
}

export async function assertCliVersion(runner: Runner, expected: string | null): Promise<string> {
  const actual = await runner.version();
  if (expected !== null && actual !== expected) {
    throw new AppError('cli_version_mismatch', `App erwartet CLI ${expected}, gefunden ${actual}.`);
  }
  return actual;
}
