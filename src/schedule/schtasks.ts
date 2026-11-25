/**
 * Access to the Windows Task Scheduler through `schtasks` (package 09 §4.3). The runner is replaceable:
 * tests never talk to the real Task Scheduler.
 */
import { execFile } from 'node:child_process';

export interface SchtasksResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SchtasksRunner {
  run(args: readonly string[]): Promise<SchtasksResult>;
}

export interface SchtasksRunnerOptions {
  /** Program to start; tests pass a stand-in. */
  command?: string;
  /** Arguments placed before the ones of the call; tests pass the script of the stand-in. */
  prefixArgs?: readonly string[];
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * `schtasks` writes in the OEM code page of the console. The text is read as latin1 and everything outside
 * printable ASCII becomes `?`: names and numbers stay exact, umlauts do not matter for the exit-code based checks.
 */
export function foldToAscii(text: string): string {
  let result = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    result += code === 0x0a || code === 0x0d || code === 0x09 || (code >= 0x20 && code < 0x7f) ? char : '?';
  }
  return result;
}

/** Starts `schtasks` without a shell, with an argument array, a time limit and a hidden window. */
export function createSchtasksRunner(options: SchtasksRunnerOptions = {}): SchtasksRunner {
  return {
    run(args) {
      return new Promise((resolve, reject) => {
        execFile(
          options.command ?? 'schtasks',
          [...(options.prefixArgs ?? []), ...args],
          { encoding: 'buffer', windowsHide: true, timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
          (error, stdout, stderr) => {
            const failure = error as (Error & { code?: unknown; killed?: boolean }) | null;
            if (failure !== null && (typeof failure.code === 'string' || failure.killed === true)) {
              // Not an exit code: the program is missing, not allowed or exceeded the time limit.
              reject(failure);
              return;
            }
            resolve({
              exitCode: failure === null ? 0 : typeof failure.code === 'number' ? failure.code : 1,
              stdout: foldToAscii(stdout.toString('latin1')),
              stderr: foldToAscii(stderr.toString('latin1')),
            });
          },
        );
      });
    },
  };
}

/** Rows of `/FO CSV` output; values in double quotes, a quote inside a value is doubled. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const row: string[] = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index]!;
      if (quoted) {
        if (char === '"' && line[index + 1] === '"') {
          value += '"';
          index += 1;
        } else if (char === '"') quoted = false;
        else value += char;
      } else if (char === '"') quoted = true;
      else if (char === ',') {
        row.push(value);
        value = '';
      } else value += char;
    }
    row.push(value);
    rows.push(row);
  }
  return rows;
}
