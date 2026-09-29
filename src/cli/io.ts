/**
 * Results go to stdout, warnings and errors to stderr (spec.md §6.5).
 */
import type { ExitCode } from '../core/errors.js';

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  env: NodeJS.ProcessEnv;
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
  };
}
