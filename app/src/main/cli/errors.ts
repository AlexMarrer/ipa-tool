import { APP_ERROR_MESSAGES, type AppErrorCode } from '../../shared/messages';
import type { IpaError } from '../../shared/types';

/** Failure of the app around the CLI (spec §3.4), as opposed to an exit code of the CLI. */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details: string | undefined;

  constructor(code: AppErrorCode, details?: string, message: string = APP_ERROR_MESSAGES[code]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }

  toIpaError(): IpaError {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

export function toIpaError(error: unknown): IpaError {
  if (error instanceof AppError) return error.toIpaError();
  return { code: 'internal', message: APP_ERROR_MESSAGES.internal };
}
