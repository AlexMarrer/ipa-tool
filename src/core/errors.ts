// Exit codes of spec.md §6.4.
export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const EXIT = {
  ok: 0,
  internal: 1,
  usage: 2,
  lockHeld: 3,
  halted: 4,
  unstable: 5,
  analysisIncomplete: 6,
  doctorFailed: 7,
} as const satisfies Record<string, ExitCode>;

/**
 * Expected failure with a domain code and its exit code. The message is German and never contains
 * file content or secret values (I-12).
 */
export class IpaError extends Error {
  readonly code: string;
  readonly exitCode: ExitCode;

  constructor(code: string, exitCode: ExitCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'IpaError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

/** Content of a lock file (spec.md §8.5). */
export interface LockInfo {
  pid: number;
  hostname: string;
  command: string;
  runId: string;
  startedAt: string;
}

export class LockHeldError extends IpaError {
  readonly lockPath: string;
  readonly holder: LockInfo | null;

  constructor(lockPath: string, holder: LockInfo | null, message: string) {
    super('lock_held', EXIT.lockHeld, message);
    this.name = 'LockHeldError';
    this.lockPath = lockPath;
    this.holder = holder;
  }
}

/** Raised by `createFileExclusive` and `renameDirectory` for an existing target. */
export class FileExistsError extends IpaError {
  readonly path: string;

  constructor(path: string, options?: ErrorOptions) {
    super('file_exists', EXIT.internal, `Die Datei existiert bereits: ${path}`, options);
    this.name = 'FileExistsError';
    this.path = path;
  }
}

export function exitCodeOf(error: unknown): ExitCode {
  return error instanceof IpaError ? error.exitCode : EXIT.internal;
}

/**
 * The highest code wins, except that 1 always takes precedence (spec.md §6.4).
 */
export function mergeExitCodes(...codes: ExitCode[]): ExitCode {
  if (codes.includes(EXIT.internal)) return EXIT.internal;
  let result: ExitCode = EXIT.ok;
  for (const code of codes) {
    if (code > result) result = code;
  }
  return result;
}

/** errno name of a Node error, for example `ENOENT`. */
export function errnoCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}
