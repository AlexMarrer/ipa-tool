/**
 * Write functions of spec.md §8.5.
 */
import { lstat, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { errnoCode, FileExistsError } from './errors.js';
import { randomHex } from './ids.js';

// Windows may lock a file briefly, for example while a virus scanner reads it.
export const RENAME_RETRIES = 5;
export const RENAME_RETRY_DELAY_MS = 50;

/**
 * Writes a temporary file in the same folder and renames it. If a step fails, the old content stays
 * and the temporary file is removed.
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

/**
 * Moves a finished directory to its final name (snapshot storage, spec.md §8.5). The target must
 * not exist yet; callers hold the workspace lock, so the existence check is not racy.
 */
export async function renameDirectory(from: string, to: string): Promise<void> {
  if (await pathExists(to)) throw new FileExistsError(to);
  await renameWithRetry(from, to);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return false;
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
 * Flag `wx`: an existing file raises `FileExistsError`. A partly written file is removed again.
 */
export async function createFileExclusive(filePath: string, data: string | Uint8Array): Promise<void> {
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
