import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { KILL_GRACE_MS, MAX_STDERR_BYTES, runProcess, STREAM_CLOSE_GRACE_MS } from '../../src/claude/process.js';
import { createTempDir } from '../helpers/workspace.js';

const NODE = [process.execPath];

async function run(script: string, options: { input?: string; timeoutMs?: number; onStdoutLine?: (line: string) => 'continue' | 'abort' } = {}) {
  return runProcess({
    command: NODE,
    args: ['-e', script],
    cwd: await createTempDir('prozess'),
    env: process.env,
    input: options.input ?? '',
    timeoutMs: options.timeoutMs ?? 30_000,
    ...(options.onStdoutLine === undefined ? {} : { onStdoutLine: options.onStdoutLine }),
  });
}

describe('Prozessstart ohne Shell (spec.md §13.1, package 05 §6)', () => {
  it('überträgt eine grosse Eingabe knapp unter dem Paketlimit vollständig über stdin', async () => {
    const input = `{"daten":"${'ä€x'.repeat(86_000)}"}`;
    expect(Buffer.byteLength(input)).toBeGreaterThan(500_000);
    expect(Buffer.byteLength(input)).toBeLessThan(524_288);
    const result = await run(
      "const h=require('crypto').createHash('sha256');process.stdin.on('data',c=>h.update(c));process.stdin.on('end',()=>process.stdout.write(h.digest('hex')))",
      { input },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(createHash('sha256').update(input, 'utf8').digest('hex'));
  });

  it('begrenzt stderr auf 64 KiB und liest stdout vollständig', async () => {
    const result = await run("process.stderr.write('e'.repeat(200*1024));process.stdout.write('o'.repeat(300*1024))");
    expect(result.stderr).toHaveLength(MAX_STDERR_BYTES);
    expect(result.stderrTruncated).toBe(true);
    expect(result.stdout).toHaveLength(300 * 1024);
  });

  it('beendet einen hängenden Prozess nach dem Timeout, auch wenn er stdin nicht liest', async () => {
    const started = Date.now();
    const result = await run('setInterval(() => {}, 1000)', { input: 'x'.repeat(2_000_000), timeoutMs: 500 });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(500 + 5000);
  });

  it.skipIf(process.platform === 'win32')('beendet einen Prozess, der SIGTERM ignoriert, mit SIGKILL', async () => {
    const started = Date.now();
    const result = await run("process.on('SIGTERM',()=>{});setInterval(()=>{},1000);process.stdout.write('bereit\\n')", { timeoutMs: 500 });
    expect(result).toMatchObject({ timedOut: true, signal: 'SIGKILL' });
    expect(Date.now() - started).toBeLessThan(500 + KILL_GRACE_MS + STREAM_CLOSE_GRACE_MS + 1000);
  });

  it('bricht auf Wunsch nach einer stdout-Zeile ab', async () => {
    const lines: string[] = [];
    const result = await run("let n=0;setInterval(()=>console.log('zeile '+(++n)),20)", {
      onStdoutLine: (line) => {
        lines.push(line);
        return lines.length >= 2 ? 'abort' : 'continue';
      },
    });
    expect(result).toMatchObject({ aborted: true, timedOut: false });
    expect(lines.slice(0, 2)).toEqual(['zeile 1', 'zeile 2']);
  });

  it('meldet ein fehlendes Programm als Startfehler ohne Ausnahme', async () => {
    const result = await runProcess({
      command: [`${await createTempDir('leer')}/claude-gibt-es-nicht`],
      args: ['--version'],
      cwd: await createTempDir('prozess'),
      env: process.env,
      input: '',
      timeoutMs: 5000,
    });
    expect(result).toMatchObject({ spawnError: 'ENOENT', exitCode: null, timedOut: false });
  });
});
