import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLAUDE_CHECK_WARNING, checkClaudeAfterInit } from '../../src/cli/commands/doctor.js';
import type { CliIo } from '../../src/cli/io.js';
import { ensureClaudeReady, findCmdShim } from '../../src/claude/doctor.js';
import { readDoctorRecord } from '../../src/claude/doctor-record.js';
import { resolveContext } from '../../src/core/context.js';
import { IpaError } from '../../src/core/errors.js';
import { fakeClaudeEnv, mergedEnv, useFakeClaude } from '../helpers/claude.js';
import { createTempRepo } from '../helpers/git-repo.js';
import { initRepo } from '../helpers/snapshots.js';
import { createTempDataRoot, createTempDir, runCli } from '../helpers/workspace.js';

async function prepare() {
  const repo = await createTempRepo();
  const dataDir = await createTempDataRoot();
  const workspace = await initRepo(repo, dataDir);
  await useFakeClaude(workspace);
  const context = () => resolveContext({ repo: repo.root, dataDir, requireInit: true });
  return { repo, dataDir, workspace, context };
}

function memoryIo(env: NodeJS.ProcessEnv): { io: CliIo; out: { stdout: string; stderr: string } } {
  const out = { stdout: '', stderr: '' };
  return {
    io: { stdout: (text) => (out.stdout += text), stderr: (text) => (out.stderr += text), env },
    out,
  };
}

describe('ensureClaudeReady für die Pakete 06 und 07', () => {
  it('führt die Prüfung ohne doctor.json einmal ohne Modellaufruf aus', async () => {
    const p = await prepare();
    await rm(`${p.workspace}/doctor.json`);
    const fake = await fakeClaudeEnv('ok');
    await ensureClaudeReady(await p.context(), { env: mergedEnv(fake.env) });
    const calls = await fake.calls();
    expect(calls.map((call) => call.kind)).toContain('version');
    expect(calls.some((call) => call.kind === 'model-call')).toBe(false);
    expect(await readDoctorRecord(p.workspace)).toMatchObject({ ok: true, live: null });
  });

  it('startet nichts, wenn doctor.json alle Pflichtoptionen meldet', async () => {
    const p = await prepare();
    expect((await runCli(['doctor'], { dataDir: p.dataDir, repo: p.repo.root, env: (await fakeClaudeEnv('ok')).env })).exitCode).toBe(0);
    const fake = await fakeClaudeEnv('ok');
    await ensureClaudeReady(await p.context(), { env: mergedEnv(fake.env) });
    expect(await fake.calls()).toEqual([]);
  });

  it('endet mit Exit-Code 6, wenn Pflichtoptionen fehlen oder Claude nicht gefunden wird', async () => {
    const p = await prepare();
    const missing = await fakeClaudeEnv('ok', { FAKE_CLAUDE_UNSUPPORTED: '--disable-slash-commands' });
    const error = await ensureClaudeReady(await p.context(), { env: mergedEnv(missing.env) }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IpaError);
    expect(error).toMatchObject({ exitCode: 6, code: 'claude_not_ready' });
    expect((error as Error).message).toContain('--disable-slash-commands');

    await useFakeClaude(p.workspace, { command: [`${await createTempDir('leer')}/claude-gibt-es-nicht`] });
    await expect(ensureClaudeReady(await p.context(), { env: mergedEnv((await fakeClaudeEnv('ok')).env) })).rejects.toMatchObject({
      exitCode: 6,
      message: expect.stringContaining('nicht gefunden'),
    });
  });

  it('prüft erneut, wenn ein neu konfiguriertes Modell --model verlangt', async () => {
    const p = await prepare();
    const env = (await fakeClaudeEnv('ok', { FAKE_CLAUDE_UNSUPPORTED: '--model' })).env;
    expect((await runCli(['doctor'], { dataDir: p.dataDir, repo: p.repo.root, env })).exitCode).toBe(0);
    await useFakeClaude(p.workspace, { model: 'sonnet' });
    const fake = await fakeClaudeEnv('ok', { FAKE_CLAUDE_UNSUPPORTED: '--model' });
    await expect(ensureClaudeReady(await p.context(), { env: mergedEnv(fake.env) })).rejects.toMatchObject({ exitCode: 6 });
    expect((await fake.calls()).map((call) => call.kind)).toContain('version');
  });
});

describe('Claude-Prüfung nach ipa init (AK-05-07)', () => {
  it('meldet eine bestandene Prüfung auf stdout, ohne Warnung', async () => {
    const p = await prepare();
    const fake = await fakeClaudeEnv('ok');
    const { io, out } = memoryIo(mergedEnv(fake.env));
    await checkClaudeAfterInit(await p.context(), io);
    expect(out.stdout).toContain('Claude-Prüfung: bereit (Claude Code 9.9.9, ohne Modellaufruf)');
    expect(out.stderr).toBe('');
    expect((await fake.calls()).some((call) => call.kind === 'model-call')).toBe(false);
  });

  it('macht aus einer gescheiterten Prüfung und aus einem Fehler nur eine Warnung', async () => {
    const p = await prepare();
    const failed = memoryIo(mergedEnv((await fakeClaudeEnv('logged-out')).env));
    await checkClaudeAfterInit(await p.context(), failed.io);
    expect(failed.out.stderr).toMatch(new RegExp(`^${CLAUDE_CHECK_WARNING} Claude Code ist nicht angemeldet\\.`));

    const inRepo = `${p.repo.root}/temp`;
    const thrown = memoryIo(mergedEnv({ ...(await fakeClaudeEnv('ok')).env }));
    const saved = { TMPDIR: process.env['TMPDIR'], TMP: process.env['TMP'], TEMP: process.env['TEMP'] };
    Object.assign(process.env, { TMPDIR: inRepo, TMP: inRepo, TEMP: inRepo });
    try {
      await checkClaudeAfterInit(await p.context(), thrown.io);
    } finally {
      Object.assign(process.env, saved);
    }
    expect(thrown.out.stderr).toContain(CLAUDE_CHECK_WARNING);
    expect(thrown.out.stderr).toContain('Der Arbeitsbereich ist vollständig angelegt');
  });
});

describe('Hinweis auf eine npm-Installation unter Windows (A-05)', () => {
  it('findet claude.cmd im PATH nur unter Windows', async () => {
    const dir = await createTempDir('npm-bin');
    const shim = path.join(dir, 'claude.cmd');
    await writeFile(shim, '@echo off\r\n');
    const empty = await createTempDir('leer');
    expect(await findCmdShim({ PATH: `${empty};${dir}` }, 'win32')).toBe(shim);
    expect(await findCmdShim({ Path: dir }, 'win32')).toBe(shim);
    expect(await findCmdShim({ PATH: empty }, 'win32')).toBeNull();
    expect(await findCmdShim({ PATH: dir }, 'linux')).toBeNull();
  });
});

