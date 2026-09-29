/**
 * Schreibfunktionen gemäss spec.md §8.5.
 */
import { open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { errnoCode, FileExistsError } from './errors.js';
import { randomHex } from './ids.js';

/** Wiederholungen beim Umbenennen, wenn Windows die Datei kurz sperrt. */
export const RENAME_RETRIES = 5;
export const RENAME_RETRY_DELAY_MS = 50;

/**
 * Schreibt zuerst eine temporäre Datei im selben Ordner und benennt sie dann um.
 * Scheitert ein Schritt, bleibt der alte Inhalt unverändert, und die temporäre Datei wird entfernt.
 */
export async function writeFileAtomic(filePath: string, data: string | Uint8Array): Promise<void> {
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${process.pid}-${randomHex(8)}`);
  try {
    const handle = await open(tempPath, 'wx');
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithRetry(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = errnoCode(error);
      if ((code === 'EPERM' || code === 'EBUSY') && attempt < RENAME_RETRIES) {
        await delay(RENAME_RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }
  }
}

/**
 * Legt eine neue Datei mit dem Flag `wx` an. Existiert sie bereits, wird `FileExistsError` geworfen.
 * Scheitert das Schreiben, wird die angefangene Datei wieder entfernt.
 */
export async function createFileExclusive(filePath: string, data: string): Promise<void> {
  let handle;
  try {
    handle = await open(filePath, 'wx');
  } catch (error) {
    if (errnoCode(error) === 'EEXIST') throw new FileExistsError(filePath, { cause: error });
    throw error;
  }
  let closed = false;
  try {
    await handle.writeFile(data);
    await handle.sync();
    closed = true;
    await handle.close();
  } catch (error) {
    if (!closed) await handle.close().catch(() => undefined);
    await rm(filePath, { force: true }).catch(() => undefined);
    throw error;
  }
}
