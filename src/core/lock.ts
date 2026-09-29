/**
 * Lock-Dateien gemäss spec.md §8.5.
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

/** Wartezeit, bevor eine unlesbare Lock-Datei ein zweites Mal gelesen wird. */
const UNREADABLE_LOCK_RETRY_MS = 100;

export interface AcquiredLock {
  /** Ein veralteter Lock eines beendeten Prozesses wurde entfernt. */
  readonly lockBroken: boolean;
  release(): Promise<void>;
}

export interface AcquireLockOptions {
  /** So lange wird auf einen gehaltenen Lock gewartet. Standard: 0, also sofortiger Abbruch. */
  waitMs?: number;
  pollMs?: number;
}

export function lockPathOf(workspaceDir: string): string {
  return path.join(workspaceDir, LOCK_FILE);
}

/** `process.kill(pid, 0)`: ESRCH heisst beendet, EPERM heisst vorhanden, aber fremd. */
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
 * Legt die Lock-Datei exklusiv an. Ein Lock eines beendeten Prozesses auf demselben Rechner wird entfernt.
 * Hält ein laufender Prozess oder ein anderer Rechner den Lock, folgt `LockHeldError`.
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
    if (raw === null) continue; // Der Halter hat den Lock gerade freigegeben.
    let holder = parseLockInfo(raw);
    if (holder === null) {
      // Der Halter schreibt den Inhalt möglicherweise noch.
      await delay(UNREADABLE_LOCK_RETRY_MS);
      raw = await readRaw(lockPath);
      if (raw === null) continue;
      holder = parseLockInfo(raw);
    }

    if (holder !== null && sameHost(holder.hostname) && !isProcessAlive(holder.pid)) {
      // Veralteter Lock: nur entfernen, wenn er seit dem Lesen unverändert ist.
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
  // Nur den eigenen Lock entfernen.
  if ((await readRaw(lockPath)) === content) {
    await rm(lockPath, { force: true });
  }
}

/**
 * Hält den Lock des Arbeitsbereichs, während `fn` läuft (spec.md §10).
 * `fn` erfährt, ob dabei ein veralteter Lock entfernt wurde, damit der Lauf `lockBroken` protokollieren kann.
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
