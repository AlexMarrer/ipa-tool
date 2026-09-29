/**
 * Ein- und Ausgabe des CLI. Ergebnisse gehen auf stdout, Warnungen und Fehler auf stderr (spec.md §6.5).
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

/** Globale Optionen aus spec.md §6.1. */
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
