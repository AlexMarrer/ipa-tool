import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIVE_INPUT_MARKER } from '../../src/claude/doctor.js';
import type { DoctorRecord } from '../../src/claude/types.js';
import type { AiUsageRecord } from '../../src/claude/usage.js';
import { readJsonl } from '../../src/core/jsonl.js';
import { isSameOrInside } from '../../src/core/paths.js';
import { validate } from '../../src/core/schemas.js';
import { fakeClaudeEnv, SESSION_ENV, useFakeClaude } from '../helpers/claude.js';
import { createTempRepo, type TempRepo } from '../helpers/git-repo.js';
import { expectRepoUnchanged, fingerprintRepo } from '../helpers/repo-fingerprint.js';
import { filesContaining } from '../helpers/secrets.js';
import { initRepo } from '../helpers/snapshots.js';
import { createTempDataRoot, createTempDir, portable, readJsonFile, runCli } from '../helpers/workspace.js';

const PERSONAL = ['person@example.com', 'Geheime Firma', 'sk-ant', '5f3c0000'];

interface Prepared {
  repo: TempRepo;
  dataDir: string;
  workspace: string;
}

async function prepare(workspaceArgs: string[] = []): Promise<Prepared> {
  const repo = await createTempRepo();
  const dataDir = await createTempDataRoot();
  const workspace = await initRepo(repo, dataDir, workspaceArgs);
  await useFakeClaude(workspace);
  return { repo, dataDir, workspace };
}

async function doctor(p: Prepared, args: string[] = [], mode = 'ok', extra: Record<string, string | undefined> = {}) {
  const fake = await fakeClaudeEnv(mode, extra);
  const result = await runCli(['doctor', ...args], { dataDir: p.dataDir, repo: p.repo.root, env: fake.env });
  const record = await readJsonFile<DoctorRecord>(`${p.workspace}/doctor.json`);
  expect(validate('doctor', record)).toEqual({ ok: true });
  return { ...result, record, calls: await fake.calls() };
}

async function aiUsage(workspace: string): Promise<AiUsageRecord[]> {
  const { records, invalid } = await readJsonl<AiUsageRecord>(`${workspace}/ai-usage.jsonl`, 'ai-usage');
  expect(invalid).toEqual([]);
  return records;
}

describe('ipa doctor ohne Modellaufruf (AK-05-05, AK-05-06)', () => {
  it('meldet Version, Anmeldung und Optionen und schreibt doctor.json', async () => {
    const p = await prepare();
    const before = await fingerprintRepo(p.repo.root);
    const result = await doctor(p);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('Version 9.9.9');
    expect(result.stdout).toContain('angemeldet, Anmeldeart claude.ai');
    expect(result.stdout).toContain('alle 11 erkannt');
    expect(result.stdout).toMatch(/Ergebnis:\s+bereit/);
    expect(result.stdout).toContain('organisatorisch zu bestätigen');
    expect(result.record).toMatchObject({
      git: { found: true },
      claude: { found: true, version: '9.9.9', loggedIn: true, authMethod: 'claude.ai', settingSourcesAuthOk: null },
      live: null,
      ok: true,
    });
    expect(Object.values(result.record.claude.flags)).toHaveLength(15);
    expect(Object.values(result.record.claude.flags).every((supported) => supported)).toBe(true);

    expect(result.calls.some((call) => call.kind === 'model-call')).toBe(false);
    const probes = result.calls.filter((call) => call.kind === 'unknown-option');
    expect(probes).toHaveLength(15);
    for (const probe of probes) {
      expect(probe.option).toBe('--zz-ipa-probe');
      expect(probe.args?.[0]).toBe('-p');
      expect(probe.args?.at(-1)).toBe('--zz-ipa-probe');
    }
    expectRepoUnchanged(before, await fingerprintRepo(p.repo.root));
  });

  it('endet mit Exit-Code 7, wenn eine Pflichtoption fehlt; --safe-mode ist optional', async () => {
    const p = await prepare();
    const missing = await doctor(p, [], 'ok', { FAKE_CLAUDE_UNSUPPORTED: '--tools' });
    expect(missing.exitCode).toBe(7);
    expect(missing.record.claude.flags['--tools']).toBe(false);
    expect(missing.record.ok).toBe(false);
    expect(missing.stdout).toContain('nicht erkannt: --tools');
    expect(missing.stderr).toContain('Pflichtoptionen nicht erkannt: --tools');

    const safeMode = await doctor(p, [], 'ok', { FAKE_CLAUDE_UNSUPPORTED: '--safe-mode' });
    expect(safeMode.exitCode).toBe(0);
    expect(safeMode.record.claude.flags['--safe-mode']).toBe(false);
    expect(safeMode.stdout).toMatch(/--safe-mode:\s+wird nicht verwendet/);
  });

  it('verlangt --model nur bei konfiguriertem Modell', async () => {
    const p = await prepare();
    expect((await doctor(p, [], 'ok', { FAKE_CLAUDE_UNSUPPORTED: '--model' })).exitCode).toBe(0);
    await useFakeClaude(p.workspace, { model: 'sonnet' });
    const result = await doctor(p, [], 'ok', { FAKE_CLAUDE_UNSUPPORTED: '--model' });
    expect(result.exitCode).toBe(7);
    expect(result.stdout).toContain('nicht erkannt: --model');
  });

  it('meldet nicht angemeldet und nicht gefunden mit Exit-Code 7', async () => {
    const p = await prepare();
    const loggedOut = await doctor(p, [], 'logged-out');
    expect(loggedOut.exitCode).toBe(7);
    expect(loggedOut.record.claude).toMatchObject({ found: true, loggedIn: false });
    expect(loggedOut.stdout).toMatch(/Anmeldung:\s+nicht angemeldet/);

    const textOnly = await doctor(p, [], 'auth-no-json');
    expect(textOnly.record.claude.loggedIn).toBe(false);

    await useFakeClaude(p.workspace, { command: [`${await createTempDir('leer')}/claude-gibt-es-nicht`] });
    const notFound = await doctor(p);
    expect(notFound.exitCode).toBe(7);
    expect(notFound.record.claude).toEqual({ found: false, version: null, loggedIn: null, authMethod: null, flags: {}, settingSourcesAuthOk: null });
    expect(notFound.stdout).toMatch(/Claude Code:\s+nicht gefunden/);
    expect(notFound.stderr).toContain('nicht gefunden');
  });

  it('übernimmt weder E-Mail noch Organisation noch Token (AK-05-06)', async () => {
    const p = await prepare();
    const result = await doctor(p, ['--live']);
    expect(result.exitCode).toBe(0);
    for (const value of PERSONAL) {
      expect(result.stdout, value).not.toContain(value);
      expect(result.stderr, value).not.toContain(value);
      expect(await filesContaining(p.dataDir, value), value).toEqual([]);
    }
    expect(Object.keys(result.record.claude).sort()).toEqual(['authMethod', 'flags', 'found', 'loggedIn', 'settingSourcesAuthOk', 'version']);
  });

  it('nimmt keinen Lock, schreibt nichts in runs.jsonl und braucht ein initialisiertes Repository', async () => {
    const p = await prepare();
    const runsBefore = await readJsonl(`${p.workspace}/runs.jsonl`, 'run-record');
    // A lock held by a running process (this test) does not stop doctor.
    await writeFile(
      `${p.workspace}/lock`,
      JSON.stringify({ pid: process.pid, hostname: os.hostname(), command: 'capture', runId: 'R20261014T080312Z-a3f9', startedAt: '2026-10-14T10:03:12+02:00' }),
    );
    expect((await doctor(p)).exitCode).toBe(0);
    expect((await readJsonl(`${p.workspace}/runs.jsonl`, 'run-record')).records).toEqual(runsBefore.records);

    const other = await createTempRepo();
    const notInitialized = await runCli(['doctor'], { dataDir: p.dataDir, repo: other.root });
    expect(notInitialized.exitCode).toBe(2);
    expect(notInitialized.stderr).toContain('nicht initialisiert');
  });

  it('startet nichts, wenn das Temp-Verzeichnis in das Repository zeigt (Exit-Code 2)', async () => {
    const p = await prepare();
    const before = await fingerprintRepo(p.repo.root);
    const inRepo = `${p.repo.root}/temp`;
    const fake = await fakeClaudeEnv('ok', { TMPDIR: inRepo, TMP: inRepo, TEMP: inRepo });
    const result = await runCli(['doctor'], { dataDir: p.dataDir, repo: p.repo.root, env: fake.env });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('ausserhalb von Repository und Arbeitsbereich');
    expect(await fake.calls()).toEqual([]);
    expectRepoUnchanged(before, await fingerprintRepo(p.repo.root));
  });

  it('meldet eine umgebende Claude-Code-Sitzung und gibt deren Variablen nicht weiter', async () => {
    const p = await prepare();
    const fake = await fakeClaudeEnv('ok', { ...SESSION_ENV });
    const result = await runCli(['doctor', '--live'], { dataDir: p.dataDir, repo: p.repo.root, env: fake.env });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('innerhalb einer Claude-Code-Sitzung');
    expect(result.stderr).not.toContain('sitzung-123');
    const calls = (await fake.calls()).filter((entry) => entry.kind === 'model-call');
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call.env?.filter((name) => name.startsWith('CLAUDE'))).toEqual(['CLAUDE_CONFIG_DIR']);
  });
});

describe('ipa doctor --live mit Fake-CLI (spec.md §13.4)', () => {
  it('prüft Werkzeuge, MCP-Server, structured_output und --setting-sources mit zwei Aufrufen', async () => {
    const p = await prepare();
    const before = await fingerprintRepo(p.repo.root);
    const result = await doctor(p, ['--live']);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toContain('verbraucht Claude-Kontingent');
    expect(result.record).toMatchObject({
      live: { ok: true, toolsReported: ['StructuredOutput'], mcpServersReported: [] },
      claude: { settingSourcesAuthOk: true },
      ok: true,
    });
    expect(result.stdout).toMatch(/Live-Prüfung:\s+bestanden/);
    expect(result.stdout).toContain('keine Sandbox');

    const calls = result.calls.filter((call) => call.kind === 'model-call');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args?.slice(2, 5)).toEqual(['--output-format', 'stream-json', '--verbose']);
    expect(calls[0]?.args).not.toContain('--setting-sources');
    expect(calls[1]?.args?.slice(2, 4)).toEqual(['--output-format', 'json']);
    expect(calls[1]?.args).toContain('--setting-sources');
    for (const call of calls) {
      expect(call.cwdFiles).toEqual(['prompt.md']);
      expect(isSameOrInside(portable(call.cwd ?? ''), p.repo.root)).toBe(false);
      expect(isSameOrInside(portable(call.cwd ?? ''), p.workspace)).toBe(false);
      expect(call.stdin).toContain(LIVE_INPUT_MARKER);
      expect(call.args).toContain('--safe-mode');
    }
    const usage = await aiUsage(p.workspace);
    expect(usage).toHaveLength(2);
    for (const line of usage) {
      expect(line).toMatchObject({ purpose: 'doctor', subjectId: null, cliVersion: '9.9.9', outcome: 'success', promptVersion: 'doctor-live@1' });
    }
    expectRepoUnchanged(before, await fingerprintRepo(p.repo.root));
  });

  it('meldet gemeldete Werkzeuge oder MCP-Server als nicht bestanden (Exit-Code 7)', async () => {
    const p = await prepare();
    const tools = await doctor(p, ['--live'], 'tools');
    expect(tools.exitCode).toBe(7);
    expect(tools.record.live).toMatchObject({ ok: false, toolsReported: ['Bash', 'Read', 'StructuredOutput'] });
    expect(tools.stderr).toContain('Claude meldet Werkzeuge: Bash, Read (A-01 widerlegt)');

    const mcp = await doctor(p, ['--live'], 'mcp');
    expect(mcp.exitCode).toBe(7);
    expect(mcp.record.live).toMatchObject({ ok: false, mcpServersReported: ['firma-server'] });

    const wrongOutput = await doctor(p, ['--live'], 'ok', { FAKE_CLAUDE_OUTPUT: '{"ok":"ja"}' });
    expect(wrongOutput.exitCode).toBe(7);
    expect(wrongOutput.record.live?.ok).toBe(false);

    const noOutput = await doctor(p, ['--live'], 'no-structured');
    expect(noOutput.exitCode).toBe(7);
    expect(noOutput.stderr).toContain('structured_output');

    const files = await doctor(p, ['--live'], 'writes-file');
    expect(files.stderr).toContain('doctor-injektion.txt');
  });

  it('verwendet --setting-sources nicht, wenn die Anmeldung damit scheitert (A-08)', async () => {
    const p = await prepare();
    const result = await doctor(p, ['--live'], 'settings-auth-fail');
    expect(result.exitCode).toBe(0);
    expect(result.record).toMatchObject({ live: { ok: true }, claude: { settingSourcesAuthOk: false } });
    expect(result.stdout).toContain('die Live-Prüfung damit schlug fehl');
    expect(result.stderr).toContain('claude auth login');
    const usage = await aiUsage(p.workspace);
    expect(usage.map((line) => line.outcome)).toEqual(['success', 'claude_error']);
  });

  it('bricht nach wiederholt abgelehnter Anmeldung ab, statt auf das Timeout zu warten', async () => {
    const p = await prepare();
    const started = Date.now();
    const result = await doctor(p, ['--live'], 'auth-retry');
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toContain('authentication_failed');
    expect(result.record.live).toMatchObject({ ok: false, toolsReported: ['StructuredOutput'] });
    expect(result.record.claude.settingSourcesAuthOk).toBeNull();
    expect(result.calls.filter((call) => call.kind === 'model-call')).toHaveLength(1);
    expect((await aiUsage(p.workspace)).map((line) => line.errorCode)).toEqual(['error_result']);
  });

  it('überspringt die Live-Aufrufe ohne Anmeldung', async () => {
    const p = await prepare();
    const result = await doctor(p, ['--live'], 'logged-out');
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toContain('Live-Prüfung übersprungen');
    expect(result.calls.some((call) => call.kind === 'model-call')).toBe(false);
    expect(result.record.live).toBeNull();
  });

  it('behält das Live-Ergebnis bei gleicher Version und verwirft es nach einem Update', async () => {
    const p = await prepare();
    const live = await doctor(p, ['--live']);
    const plain = await doctor(p);
    expect(plain.exitCode).toBe(0);
    expect(plain.record.live).toEqual(live.record.live);
    expect(plain.record.claude.settingSourcesAuthOk).toBe(true);
    expect(plain.stdout).toContain('frühere Prüfung derselben Version');
    expect(plain.record.checkedAt >= live.record.checkedAt).toBe(true);

    const updated = await doctor(p, [], 'ok', { FAKE_CLAUDE_VERSION: '9.10.0' });
    expect(updated.record).toMatchObject({ live: null, claude: { version: '9.10.0', settingSourcesAuthOk: null } });
  });

  it('ersetzt eine unlesbare doctor.json', async () => {
    const p = await prepare();
    await writeFile(path.join(p.workspace, 'doctor.json'), '{ kaputt');
    const status = await runCli(['status'], { dataDir: p.dataDir, repo: p.repo.root });
    expect(status.exitCode).toBe(2);
    expect((await doctor(p)).exitCode).toBe(0);
    expect((await runCli(['status'], { dataDir: p.dataDir, repo: p.repo.root })).exitCode).toBe(0);
  });
});
