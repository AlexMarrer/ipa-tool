import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WorkspaceContext } from '../../src/core/context.js';
import { createDefaultConfig } from '../../src/core/config.js';
import { LockHeldError } from '../../src/core/errors.js';
import { isProcessAlive, lockPathOf, withLock } from '../../src/core/lock.js';
import { appendRunRecord, createRunRecord, readRunRecords } from '../../src/core/run-log.js';
import { createTempDir, TOOL_ROOT } from '../helpers/workspace.js';

async function context(): Promise<WorkspaceContext> {
  const workspaceDir = await createTempDir('lock');
  return {
    dataRoot: await createTempDir('data'),
    repoRoot: 'C:/nicht/benutzt',
    repositoryId: 'projekt-3fa9c1',
    workspaceDir,
    config: createDefaultConfig({ repositoryId: 'projekt-3fa9c1', repoPath: 'C:/nicht/benutzt', timezone: 'Europe/Zurich' }),
    clock: { now: () => new Date('2026-10-14T08:03:12Z') },
    runId: 'R20261014T080312Z-a3f9',
  };
}

/** PID eines Prozesses, der sicher beendet ist. */
async function finishedPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise((resolve) => child.on('exit', resolve));
  if (child.pid === undefined) throw new Error('keine PID');
  return child.pid;
}

function startHolder(workspaceDir: string): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(process.execPath, [path.join(TOOL_ROOT, 'test', 'helpers', 'lock-holder.mjs'), workspaceDir], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (output.includes('LOCKED')) resolve(child);
    });
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`Lock-Halter beendet (${String(code)})`)));
  });
}

async function stopHolder(child: ChildProcessWithoutNullStreams): Promise<void> {
  const exited = new Promise((resolve) => child.on('exit', resolve));
  child.stdin.end();
  await exited;
}

describe('Lock (spec.md §8.5, AK-01-08)', () => {
  it('ein zweiter gleichzeitiger withLock-Aufruf löst LockHeldError mit Exit-Code 3 aus', async () => {
    const ctx = await context();
    await withLock(ctx, 'erster', async () => {
      const error = await withLock(ctx, 'zweiter', async () => 'nie').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LockHeldError);
      expect(error).toMatchObject({ code: 'lock_held', exitCode: 3 });
    });
    // Nach dem Ende ist der Lock wieder frei.
    await expect(withLock(ctx, 'dritter', async () => 'ok')).resolves.toBe('ok');
  });

  it('erkennt einen Lock, den ein echter zweiter Prozess hält', async () => {
    const ctx = await context();
    const holder = await startHolder(ctx.workspaceDir);
    try {
      const error = await withLock(ctx, 'capture', async () => 'nie').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LockHeldError);
      expect((error as LockHeldError).holder).toMatchObject({ pid: holder.pid, command: 'lock-holder', hostname: os.hostname() });
      expect((error as LockHeldError).message).toContain(String(holder.pid));
    } finally {
      await stopHolder(holder);
    }
    await expect(withLock(ctx, 'capture', async () => 'frei')).resolves.toBe('frei');
  });

  it('entfernt den veralteten Lock eines beendeten Prozesses und protokolliert lockBroken', async () => {
    const ctx = await context();
    const pid = await finishedPid();
    expect(isProcessAlive(pid)).toBe(false);
    const stale = { pid, hostname: os.hostname(), command: 'capture', runId: 'R20261013T080000Z-dead', startedAt: '2026-10-13T10:00:00+02:00' };
    await writeFile(lockPathOf(ctx.workspaceDir), JSON.stringify(stale));

    const broken = await withLock(ctx, 'capture', async ({ lockBroken }) => {
      await appendRunRecord(
        ctx.workspaceDir,
        createRunRecord({
          runId: ctx.runId,
          command: 'capture',
          startedAt: ctx.clock.now(),
          endedAt: ctx.clock.now(),
          timezone: ctx.config.timezone,
          exitCode: 0,
          lockBroken,
        }),
      );
      return lockBroken;
    });
    expect(broken).toBe(true);
    const runs = await readRunRecords(ctx.workspaceDir);
    expect(runs.records.at(-1)?.lockBroken).toBe(true);
    await expect(readFile(lockPathOf(ctx.workspaceDir))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('entfernt den Lock eines anderen Rechners nie automatisch', async () => {
    const ctx = await context();
    const foreign = JSON.stringify({
      pid: await finishedPid(),
      hostname: `anderer-rechner-${os.hostname()}`,
      command: 'capture',
      runId: 'R20261013T080000Z-0001',
      startedAt: '2026-10-13T10:00:00+02:00',
    });
    await writeFile(lockPathOf(ctx.workspaceDir), foreign);
    const error = await withLock(ctx, 'capture', async () => 'nie').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LockHeldError);
    expect((error as LockHeldError).message).toContain('anderen Rechners');
    expect(await readFile(lockPathOf(ctx.workspaceDir), 'utf8')).toBe(foreign);
  });

  it('behandelt eine unlesbare Lock-Datei als gehalten und lässt sie stehen', async () => {
    const ctx = await context();
    await writeFile(lockPathOf(ctx.workspaceDir), '');
    const error = await withLock(ctx, 'capture', async () => 'nie').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LockHeldError);
    expect((error as LockHeldError).holder).toBeNull();
    expect(await readFile(lockPathOf(ctx.workspaceDir), 'utf8')).toBe('');
  });

  it('gibt den Lock auch frei, wenn die Arbeit scheitert', async () => {
    const ctx = await context();
    await expect(
      withLock(ctx, 'capture', async () => {
        throw new Error('Absturz');
      }),
    ).rejects.toThrow('Absturz');
    await expect(readFile(lockPathOf(ctx.workspaceDir))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('schreibt pid, hostname, command, runId und startedAt in die Lock-Datei', async () => {
    const ctx = await context();
    await withLock(ctx, 'init', async () => {
      const content: unknown = JSON.parse(await readFile(lockPathOf(ctx.workspaceDir), 'utf8'));
      expect(content).toEqual({
        pid: process.pid,
        hostname: os.hostname(),
        command: 'init',
        runId: ctx.runId,
        startedAt: '2026-10-14T10:03:12+02:00',
      });
    });
  });
});
