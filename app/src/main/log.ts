import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

export const LOG_LIMIT_BYTES = 1024 * 1024;

export interface AppLog {
  /** Writes one JSON line. Callers pass event kinds, command names, run ids and codes only (spec §12.5, I-12). */
  write(entry: Record<string, unknown>): void;
  file: string;
}

/** `logs/app.log` in the user data folder, at most 1 MiB, rotated once to `app.log.1`. */
export function createAppLog(userDataDir: string, limit: number = LOG_LIMIT_BYTES): AppLog {
  const dir = path.join(userDataDir, 'logs');
  const file = path.join(dir, 'app.log');
  return {
    file,
    write(entry) {
      try {
        mkdirSync(dir, { recursive: true });
        try {
          if (statSync(file).size >= limit) renameSync(file, `${file}.1`);
        } catch {
          // no log file yet
        }
        appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8');
      } catch {
        // logging must never break the app
      }
    },
  };
}
