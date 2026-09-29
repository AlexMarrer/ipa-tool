/**
 * Lock files of spec.md §8.5.
 */
import { readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { WorkspaceContext } from './context.js';
import { errnoCode, type LockInfo, LockHeldError } from './errors.js';
import { formatZoned } from './time.js';

export type { LockInfo } from './errors.js';

export const LOCK_FILE = 'lock';

// The holder may still be writing an unreadable lock file; it is read a second time after this delay.
const UNREADABLE_LOCK_RETRY_MS = 100;

export interface AcquiredLock {
  /** A stale lock of a finished process was removed. */
  readonly lockBroken: boolean;
  release(): Promise<void>;
}

export interface AcquireLockOptions {
  /** Default 0: fail at once when the lock is held. */
  waitMs?: number;
  pollMs?: number;
}

export function lockPathOf(workspaceDir: string): string {
  return path.join(workspaceDir, LOCK_FILE);
}

/** `process.kill(pid, 0)`: ESRCH means finished, EPERM means running under another user. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errnoCode(error) === 'EPERM';
  }
}

function sameHost(hostname: string): boolean {
  return hostname.toLowerCase() === os.hostname().toLowerCase();
}

function parseLockInfo(text: string): LockInfo | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v['pid'] !== 'number' ||
    !Number.isInteger(v['pid']) ||
    v['pid'] <= 0 ||
    typeof v['hostname'] !== 'string' ||
    typeof v['command'] !== 'string' ||
    typeof v['runId'] !== 'string' ||
    typeof v['startedAt'] !== 'string'
  ) {
    return null;
  }
  return {
    pid: v['pid'],
    hostname: v['hostname'],
    command: v['command'],
    runId: v['runId'],
    startedAt: v['startedAt'],
  };
}

async function readRaw(lockPath: string): Promise<string | null> {
  try {
    return await readFile(lockPath, 'utf8');
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return null;
    throw error;
  }
}

function heldMessage(lockPath: string, holder: LockInfo | null): string {
  if (holder === null) {
    return (
      `Ein anderer Lauf hält den Lock, die Lock-Datei ist aber nicht lesbar: ${lockPath}. ` +
      'Läuft sicher kein anderer Lauf, kann die Datei von Hand entfernt werden.'
    );
  }
  const foreign = sameHost(holder.hostname) ? '' : ' Ein Lock eines anderen Rechners wird nie automatisch entfernt.';
  return (
    `Ein anderer Lauf hält den Lock: ${holder.command} (Prozess ${holder.pid} auf ${holder.hostname}, ` +
    `seit ${holder.startedAt}, Lauf ${holder.runId}). Lock-Datei: ${lockPath}.${foreign}`
  );
}

/**
 * A lock of a finished process on this host is removed; a lock of a running process or of another
 * host raises `LockHeldError`.
 */
export async function acquireLock(lockPath: string, info: LockInfo, options: AcquireLockOptions = {}): Promise<AcquiredLock> {
  const waitMs = options.waitMs ?? 0;
  const pollMs = options.pollMs ?? 50;
  const content = `${JSON.stringify(info)}\n`;
  const deadline = Date.now() + waitMs;
  let lockBroken = false;

  for (;;) {
    try {
      await writeFile(lockPath, content, { flag: 'wx' });
      return { lockBroken, release: () => releaseLock(lockPath, content) };
    } catch (error) {
      if (errnoCode(error) !== 'EEXIST') throw error;
    }

    let raw = await readRaw(lockPath);
    if (raw === null) continue; // Released in the meantime.
    let holder = parseLockInfo(raw);
    if (holder === null) {
      await delay(UNREADABLE_LOCK_RETRY_MS);
      raw = await readRaw(lockPath);
      if (raw === null) continue;
      holder = parseLockInfo(raw);
    }

    if (holder !== null && sameHost(holder.hostname) && !isProcessAlive(holder.pid)) {
      // Stale lock: remove it only if nobody replaced it since it was read.
      if ((await readRaw(lockPath)) === raw) {
        await rm(lockPath, { force: true });
        lockBroken = true;
      }
      continue;
    }

    if (Date.now() >= deadline) {
      throw new LockHeldError(lockPath, holder, heldMessage(lockPath, holder));
    }
    await delay(pollMs);
  }
}

async function releaseLock(lockPath: string, content: string): Promise<void> {
  // Never remove a lock that another run took over.
  if ((await readRaw(lockPath)) === content) {
    await rm(lockPath, { force: true });
  }
}

/**
 * spec.md §10. `fn` learns whether a stale lock was removed, so that the run can log `lockBroken`.
 */
export async function withLock<T>(
  ctx: WorkspaceContext,
  command: string,
  fn: (lock: { lockBroken: boolean }) => Promise<T>,
): Promise<T> {
  const info: LockInfo = {
    pid: process.pid,
    hostname: os.hostname(),
    command,
    runId: ctx.runId,
    startedAt: formatZoned(ctx.clock.now(), ctx.config.timezone),
  };
  const lock = await acquireLock(lockPathOf(ctx.workspaceDir), info);
  try {
    return await fn({ lockBroken: lock.lockBroken });
  } finally {
    await lock.release();
  }
}
