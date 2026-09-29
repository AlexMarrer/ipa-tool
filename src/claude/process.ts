/**
 * Starts a `claude` process without a shell (spec.md §13.1, §16.1) and always resolves, also on
 * start failures, timeouts and hanging pipes.
 */
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { errnoCode } from '../core/errors.js';

/** stderr is kept up to 64 KiB (spec.md §13.1). */
export const MAX_STDERR_BYTES = 64 * 1024;
/** After SIGTERM the process gets this long before SIGKILL. */
export const KILL_GRACE_MS = 2000;
/** After the exit the pipes get this long to close; a grandchild may have inherited them. */
export const STREAM_CLOSE_GRACE_MS = 1000;

export interface ProcessRequest {
  /** Program and fixed arguments from `claude.command`. */
  command: readonly string[];
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  input: string;
  timeoutMs: number;
  /** Receives every complete stdout line; `'abort'` ends the process early (reported as `aborted`). */
  onStdoutLine?: (line: string) => 'continue' | 'abort';
}

export interface ProcessResult {
  /** errno code if the program could not be started, for example `ENOENT` or `EINVAL`. */
  spawnError: string | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  stderrTruncated: boolean;
  timedOut: boolean;
  aborted: boolean;
  durationMs: number;
}

export function runProcess(req: ProcessRequest): Promise<ProcessResult> {
  const [program, ...preArgs] = req.command;
  const started = performance.now();

  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timers: NodeJS.Timeout[] = [];
    let stderrBytes = 0;
    let stderrTruncated = false;
    let timedOut = false;
    let aborted = false;
    let stopping = false;
    let spawned = false;
    let settled = false;
    let exitCode: number | null = null;
    let signal: NodeJS.Signals | null = null;

    const finish = (spawnError: string | null): void => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      resolve({
        spawnError,
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        stderrTruncated,
        timedOut,
        aborted,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
      });
    };

    if (program === undefined) {
      finish('ENOENT');
      return;
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(program, [...preArgs, ...req.args], {
        cwd: req.cwd,
        env: req.env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      // Since the fix for CVE-2024-27980, Node throws EINVAL synchronously for .cmd and .bat files without a shell (A-05).
      finish(errnoCode(error) ?? 'SPAWN_FAILED');
      return;
    }

    const destroyStreams = (): void => {
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    };

    const stop = (reason: 'timeout' | 'abort'): void => {
      if (stopping) return;
      stopping = true;
      if (reason === 'timeout') timedOut = true;
      else aborted = true;
      child.kill('SIGTERM');
      timers.push(setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS));
      // Resolves even if the process or a grandchild never releases the pipes.
      timers.push(
        setTimeout(() => {
          destroyStreams();
          finish(null);
        }, KILL_GRACE_MS + STREAM_CLOSE_GRACE_MS),
      );
    };

    timers.push(setTimeout(() => stop('timeout'), req.timeoutMs));

    const decoder = req.onStdoutLine === undefined ? null : new StringDecoder('utf8');
    let partialLine = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      if (decoder === null || req.onStdoutLine === undefined || stopping) return;
      partialLine += decoder.write(chunk);
      for (let end = partialLine.indexOf('\n'); end >= 0 && !stopping; end = partialLine.indexOf('\n')) {
        const line = partialLine.slice(0, end).replace(/\r$/, '');
        partialLine = partialLine.slice(end + 1);
        if (req.onStdoutLine(line) === 'abort') stop('abort');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const room = MAX_STDERR_BYTES - stderrBytes;
      if (chunk.length > room) stderrTruncated = true;
      if (room <= 0) return;
      const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
      stderrChunks.push(part);
      stderrBytes += part.length;
    });

    child.once('spawn', () => {
      spawned = true;
    });
    child.on('error', (error) => {
      // Only a failed start matters; a later error, for example of kill(), does not change the result.
      if (!spawned) finish(errnoCode(error) ?? 'SPAWN_FAILED');
    });
    child.on('exit', (code, exitSignal) => {
      if (!spawned) return;
      exitCode = code;
      signal = exitSignal;
      timers.push(
        setTimeout(() => {
          destroyStreams();
          finish(null);
        }, STREAM_CLOSE_GRACE_MS),
      );
    });
    child.on('close', () => {
      if (spawned) finish(null);
    });

    // EPIPE if the process ends without reading stdin; the result then comes from exit and stdout.
    child.stdin.on('error', () => undefined);
    child.stdin.end(req.input);
  });
}
