/**
 * Results go to stdout, warnings and errors to stderr (spec.md §6.5).
 */
import type { ExitCode } from '../core/errors.js';

/** Streams for interactive questions; tests inject their own. */
export interface TerminalIo {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  /** stdin and stdout are both a TTY; without it the tool asks no questions (spec.md §6.5). */
  isTTY: boolean;
}

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  env: NodeJS.ProcessEnv;
  /** Only commands that ask questions open the terminal; without it there is none. */
  terminal?: () => TerminalIo;
}

export interface CliState {
  exitCode: ExitCode;
}

export interface GlobalOptions {
  repo?: string;
  dataDir?: string;
}

export function processIo(): CliIo {
  return {
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
    env: process.env,
    terminal: () => ({
      input: process.stdin,
      output: process.stdout,
      isTTY: process.stdin.isTTY === true && process.stdout.isTTY === true,
    }),
  };
}
