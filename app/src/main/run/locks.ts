import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RejectReason } from '../../shared/messages';
import type { CommandClass } from '../cli/commands';

export interface ForeignLock {
  pid: number;
  command: string;
  runId: string;
  startedAt: string;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface ReadLockOptions {
  hostname?: string;
  alive?: (pid: number) => boolean;
}

/**
 * Reads `<workspace>/lock` (CLI spec §8.5). Counts only if the process lives on this machine; a dead lock
 * does not block (spec §3.7). Returns `null` when there is no lock or it cannot be read.
 */
export async function readLockFile(workspacePath: string, options: ReadLockOptions = {}): Promise<ForeignLock | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path.join(workspacePath, 'lock'), 'utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const v = parsed as Record<string, unknown>;
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
  const hostname = options.hostname ?? os.hostname();
  if (v['hostname'].toLowerCase() !== hostname.toLowerCase()) return null;
  if (!(options.alive ?? isProcessAlive)(v['pid'])) return null;
  return { pid: v['pid'], command: v['command'], runId: v['runId'], startedAt: v['startedAt'] };
}

export interface ActiveRun {
  id: string;
  repositoryId: string;
  kind: CommandClass['kind'];
  ai: boolean;
  /** Name for the `doctor` self-lock. */
  label: string;
}

export type Acquire = { ok: true; release: () => void } | { ok: false; reason: RejectReason };

/**
 * Locks per project (spec §3.7): at most one write run and one journal run, `doctor` locks only itself,
 * short commands are always allowed, different projects run in parallel.
 */
export function createRunRegistry(): {
  tryAcquire(run: Omit<ActiveRun, 'id'>, foreignLock: ForeignLock | null): Acquire;
  active(repositoryId?: string): ActiveRun[];
} {
  let counter = 0;
  const runs = new Map<string, ActiveRun>();

  const activeIn = (repositoryId: string): ActiveRun[] => [...runs.values()].filter((run) => run.repositoryId === repositoryId);

  return {
    tryAcquire(run, foreignLock) {
      const others = activeIn(run.repositoryId);
      const writeActive = others.some((other) => other.kind === 'write');
      const journalActive = others.some((other) => other.kind === 'journal');

      // Buttons that can call Claude are locked while any write or journal run is active (spec §3.7).
      if (run.ai) {
        if (writeActive) return { ok: false, reason: 'write_run_active' };
        if (journalActive) return { ok: false, reason: 'journal_run_active' };
        if (foreignLock !== null) return { ok: false, reason: 'foreign_lock' };
      }
      if (run.kind === 'write') {
        if (writeActive) return { ok: false, reason: 'write_run_active' };
        if (foreignLock !== null) return { ok: false, reason: 'foreign_lock' };
      } else if (run.kind === 'journal') {
        if (journalActive) return { ok: false, reason: 'journal_run_active' };
      } else if (run.kind === 'doctor') {
        if (others.some((other) => other.kind === 'doctor')) return { ok: false, reason: 'doctor_active' };
      }

      const id = `run-${++counter}`;
      runs.set(id, { ...run, id });
      return { ok: true, release: () => void runs.delete(id) };
    },
    active(repositoryId) {
      return repositoryId === undefined ? [...runs.values()] : activeIn(repositoryId);
    },
  };
}
