import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OutputSchemaError } from '../../src/claude/output-schema.js';
import { createClaudeRunner } from '../../src/claude/runner.js';
import type { ClaudeRequest } from '../../src/claude/types.js';
import { type AiUsageRecord, aiUsagePath } from '../../src/claude/usage.js';
import type { Config } from '../../src/core/config.js';
import { resolveContext } from '../../src/core/context.js';
import { IpaError } from '../../src/core/errors.js';
import { readJsonl } from '../../src/core/jsonl.js';
import { isProcessAlive } from '../../src/core/lock.js';
import { isSameOrInside } from '../../src/core/paths.js';
import { FAKE_API_KEY, FAKE_AUTH_TOKEN, type FakeCall, fakeClaudeEnv, mergedEnv, SESSION_ENV, useFakeClaude } from '../helpers/claude.js';
import { createTempRepo, type TempRepo } from '../helpers/git-repo.js';
import { expectRepoUnchanged, fingerprintRepo } from '../helpers/repo-fingerprint.js';
import { initRepo } from '../helpers/snapshots.js';
import { createTempDataRoot, createTempDir, portable, runCli } from '../helpers/workspace.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const PROMPT_TEXT = '# Analyse-Prompt für den Test\nAntworte nur gemäss Schema.\n';
const INPUT_MARKER = 'IPA-RUNNER-EINGABE-MARKER';
const ANSWER_MARKER = 'IPA-RUNNER-ANTWORT-MARKER';
const SCHEMA = { type: 'object', additionalProperties: false, required: ['summary'], properties: { summary: { type: 'string' } } };
// Spaces, quotes and shell characters must arrive unchanged, which only holds without a shell.
const INPUT = JSON.stringify({ marker: INPUT_MARKER, text: 'Leerzeichen, "Anführungszeichen", & | $PATH %PATH% * ?' });

interface Prepared {
  repo: TempRepo;
  dataDir: string;
  workspace: string;
  promptFile: string;
}

async function prepare(options: { workspace?: string; claude?: Partial<Config['claude']> } = {}): Promise<Prepared> {
  const repo = await createTempRepo();
  const dataDir = await createTempDataRoot();
  const workspace = await initRepo(repo, dataDir, options.workspace === undefined ? [] : ['--workspace', options.workspace]);
  await useFakeClaude(workspace, options.claude);
  const promptFile = path.join(await createTempDir('prompt'), 'analyze-work.md');
  await writeFile(promptFile, PROMPT_TEXT);
  return { repo, dataDir, workspace, promptFile };
}

function request(promptFile: string, overrides: Partial<ClaudeRequest> = {}): ClaudeRequest {
  return {
    purpose: 'analysis',
    subjectId: 'S000002',
    promptFile,
    outputSchema: SCHEMA,
    stdin: INPUT,
    promptVersion: 'analyze-work@1',
    outputSchemaVersion: 'analysis-output@1',
    inputIds: ['E001', 'E002'],
    ...overrides,
  };
}

async function runOnce(p: Prepared, mode = 'ok', extra: Record<string, string | undefined> = {}, overrides: Partial<ClaudeRequest> = {}) {
  const fake = await fakeClaudeEnv(mode, { FAKE_CLAUDE_OUTPUT: JSON.stringify({ summary: ANSWER_MARKER }), ...extra });
  const ctx = await resolveContext({ repo: p.repo.root, dataDir: p.dataDir, requireInit: true });
  const result = await createClaudeRunner({ env: mergedEnv(fake.env) }).run(ctx, request(p.promptFile, overrides));
  const calls = await fake.calls();
  return { result, calls, modelCall: calls.find((call) => call.kind === 'model-call'), ctx };
}

async function aiUsage(workspace: string): Promise<AiUsageRecord[]> {
  const { records, invalid } = await readJsonl<AiUsageRecord>(aiUsagePath(workspace), 'ai-usage');
  expect(invalid).toEqual([]);
  return records;
}

function expectedArgs(promptFile: string): string[] {
  return [
    '-p',
    'Analysiere ausschliesslich das JSON-Eingabepaket auf stdin gemäss den Systemanweisungen.',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(SCHEMA),
    '--tools',
    '',
    '--disallowedTools',
    'mcp__*',
    '--strict-mcp-config',
    '--permission-mode',
    'dontAsk',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--max-turns',
    '5',
    '--append-system-prompt-file',
    promptFile,
  ];
}

beforeEach(() => {
  vi.mocked(spawn).mockClear();
});

describe('ClaudeRunner mit Fake-CLI: Aufruf (AK-05-01)', () => {
  it('übergibt exakt die Argumente aus §13.1 ohne Shell und die Eingabe nur über stdin', async () => {
    const p = await prepare();
    const before = await fingerprintRepo(p.repo.root);
    const { result, modelCall } = await runOnce(p);
    expect(result.ok).toBe(true);
    expect(modelCall).toBeDefined();
    const call = modelCall as FakeCall;

    const promptPath = call.args?.at(-1) ?? '';
    expect(path.basename(promptPath)).toBe('prompt.md');
    expect(portable(path.dirname(promptPath))).toBe(portable(call.cwd ?? ''));
    expect(call.args).toEqual(expectedArgs(promptPath));
    expect(call.stdin).toBe(INPUT);
    expect(call.promptFileSha256).toBe(createHash('sha256').update(PROMPT_TEXT).digest('hex'));

    const claudeSpawn = vi.mocked(spawn).mock.calls.find((args) => (args[1] as string[] | undefined)?.includes('--json-schema'));
    expect(claudeSpawn?.[0]).toBe(process.execPath);
    expect(claudeSpawn?.[2]).toMatchObject({ shell: false, windowsHide: true });

    expectRepoUnchanged(before, await fingerprintRepo(p.repo.root));
  });

  it('startet in einem leeren Ordner ausserhalb von Repository und Arbeitsbereich und löscht ihn danach', async () => {
    const p = await prepare();
    const { modelCall, ctx } = await runOnce(p);
    const cwd = portable(modelCall?.cwd ?? '');
    expect(modelCall?.cwdFiles).toEqual(['prompt.md']);
    expect(isSameOrInside(cwd, ctx.repoRoot)).toBe(false);
    expect(isSameOrInside(cwd, ctx.workspaceDir)).toBe(false);
    expect(isSameOrInside(cwd, portable(path.join(os.tmpdir(), 'ipa-assistant', 'claude', ctx.repositoryId)))).toBe(true);
    expect(path.basename(cwd)).toMatch(new RegExp(`^${ctx.runId}-\\d+$`));
    expect(existsSync(cwd)).toBe(false);
  });

  it('bleibt auch mit dem Arbeitsbereich .ipa im Repository ausserhalb von beiden', async () => {
    const p = await prepare({ workspace: '.ipa' });
    const before = await fingerprintRepo(p.repo.root, { workspace: '.ipa' });
    const { result, modelCall, ctx } = await runOnce(p);
    expect(result.ok).toBe(true);
    expect(ctx.workspaceDir).toBe(`${p.repo.root}/.ipa`);
    const cwd = portable(modelCall?.cwd ?? '');
    expect(modelCall?.cwdFiles).toEqual(['prompt.md']);
    expect(isSameOrInside(cwd, p.repo.root)).toBe(false);
    expect(existsSync(cwd)).toBe(false);
    const after = await fingerprintRepo(p.repo.root, { workspace: '.ipa' });
    expectRepoUnchanged(before, after);
    expect(Object.keys(after.workspace ?? {})).toContain('ai-usage.jsonl');
  });

  it('lehnt den Aufruf vor dem Start ab, wenn TMP in das Repository oder den Arbeitsbereich zeigt', async () => {
    const p = await prepare();
    const before = await fingerprintRepo(p.repo.root);
    for (const target of [`${p.repo.root}/temp-im-repo`, `${p.workspace}/tmp`]) {
      const saved = { TMPDIR: process.env['TMPDIR'], TMP: process.env['TMP'], TEMP: process.env['TEMP'] };
      Object.assign(process.env, { TMPDIR: target, TMP: target, TEMP: target });
      try {
        const fake = await fakeClaudeEnv('ok');
        const ctx = await resolveContext({ repo: p.repo.root, dataDir: p.dataDir, requireInit: true });
        const error = await createClaudeRunner({ env: mergedEnv(fake.env) })
          .run(ctx, request(p.promptFile))
          .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(IpaError);
        expect(error).toMatchObject({ exitCode: 2, code: 'claude_workdir_invalid' });
        expect(await fake.calls()).toEqual([]);
      } finally {
        Object.assign(process.env, saved);
      }
    }
    expect(existsSync(`${p.repo.root}/temp-im-repo`)).toBe(false);
    expect(await aiUsage(p.workspace)).toEqual([]);
    expectRepoUnchanged(before, await fingerprintRepo(p.repo.root));
  });

  it('entfernt verwaiste Claude-Ordner älter als 24 Stunden, aber keine jüngeren und keine fremden', async () => {
    const p = await prepare();
    const ctx = await resolveContext({ repo: p.repo.root, dataDir: p.dataDir, requireInit: true });
    const base = path.join(os.tmpdir(), 'ipa-assistant', 'claude', ctx.repositoryId);
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    for (const name of ['R20200101T000000Z-abcd-1', 'R20200101T000000Z-abcd-2', 'fremder-ordner']) {
      await mkdir(path.join(base, name), { recursive: true });
      await writeFile(path.join(base, name, 'prompt.md'), 'alt');
    }
    await utimes(path.join(base, 'R20200101T000000Z-abcd-1'), old, old);
    await utimes(path.join(base, 'fremder-ordner'), old, old);
    await runOnce(p);
    expect((await readdir(base)).sort()).toEqual(['R20200101T000000Z-abcd-2', 'fremder-ordner']);
  });

  it('gibt Variablen einer umgebenden Claude-Code-Sitzung nicht weiter, Anmeldevariablen schon', async () => {
    const p = await prepare();
    const { modelCall } = await runOnce(p, 'ok', { ...SESSION_ENV });
    expect(modelCall?.env).toContain('CLAUDE_CONFIG_DIR');
    for (const name of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID']) expect(modelCall?.env).not.toContain(name);
  });

  it('überträgt eine Eingabe knapp unter dem Paketlimit vollständig', async () => {
    const p = await prepare();
    const stdin = JSON.stringify({ marker: INPUT_MARKER, daten: 'ä€x'.repeat(86_000) });
    const { result, modelCall } = await runOnce(p, 'ok', {}, { stdin });
    expect(result.ok).toBe(true);
    expect(modelCall?.stdinBytes).toBe(Buffer.byteLength(stdin));
    expect(modelCall?.stdinSha256).toBe(createHash('sha256').update(stdin).digest('hex'));
  });

  it('lehnt ein ungültiges Ausgabeschema und eine unpassende subjectId vor dem Start ab', async () => {
    const p = await prepare();
    const fake = await fakeClaudeEnv('ok');
    const ctx = await resolveContext({ repo: p.repo.root, dataDir: p.dataDir, requireInit: true });
    const runner = createClaudeRunner({ env: mergedEnv(fake.env) });
    const withFormat = { ...SCHEMA, properties: { summary: { type: 'string', format: 'date' } } };
    await expect(runner.run(ctx, request(p.promptFile, { outputSchema: withFormat }))).rejects.toBeInstanceOf(OutputSchemaError);
    await expect(runner.run(ctx, request(p.promptFile, { subjectId: null }))).rejects.toThrow('subjectId');
    await expect(runner.run(ctx, request(p.promptFile, { purpose: 'journal', subjectId: 'S000002' }))).rejects.toThrow('subjectId');
    expect(await fake.calls()).toEqual([]);
    expect(await aiUsage(p.workspace)).toEqual([]);
  });
});

describe('ClaudeRunner mit Fake-CLI: Ergebnisse (AK-05-02, AK-05-03, AK-05-04)', () => {
  it('liefert bei Erfolg structuredOutput und meta mit Modellen und Kosten (AK-05-02)', async () => {
    const p = await prepare();
    const { result } = await runOnce(p);
    expect(result).toMatchObject({
      ok: true,
      structuredOutput: { summary: ANSWER_MARKER },
      meta: { cliVersion: null, models: ['claude-fake-model'], costUsd: 0.0123, durationMs: 1234, exitCode: 0, rawStderr: '', stderrTruncated: false },
    });
    expect(JSON.parse(result.meta.rawStdout)).toMatchObject({ type: 'result', subtype: 'success' });
    expect(result.meta.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);

    expect((await runCli(['doctor'], { dataDir: p.dataDir, repo: p.repo.root, env: (await fakeClaudeEnv('ok')).env })).exitCode).toBe(0);
    const again = await runOnce(p);
    expect(again.result.meta.cliVersion).toBe('9.9.9');
  });

  it('meldet jede Fehlerklasse ohne unbehandelte Ausnahme (AK-05-03)', async () => {
    const p = await prepare();
    const cases: [string, string][] = [
      ['invalid-json', 'invalid_envelope'],
      ['extra-text', 'invalid_envelope'],
      ['error-result', 'error_result'],
      ['exit-nonzero', 'nonzero_exit'],
      ['no-structured', 'missing_structured_output'],
    ];
    for (const [mode, errorCode] of cases) {
      const { result } = await runOnce(p, mode);
      expect(result, mode).toMatchObject({ ok: false, errorCode });
      if (!result.ok) expect(result.message.length, mode).toBeGreaterThan(10);
    }
    const nonzero = await runOnce(p, 'exit-nonzero');
    expect(nonzero.result.meta).toMatchObject({ exitCode: 3 });
    expect(nonzero.result.meta.rawStderr).toContain('künstlicher Absturz');
    const extra = await runOnce(p, 'extra-text');
    expect(extra.result.meta.rawStdout).toContain('Eine neue Version');
  });

  it('meldet not_found und not_executable für nicht startbare Befehle (AK-05-03, A-05)', async () => {
    const p = await prepare();
    const dir = await createTempDir('befehle');
    const configs: [string[], string][] = [[[`${dir}/claude-gibt-es-nicht`], 'not_found']];
    if (process.platform === 'win32') {
      await writeFile(`${dir}/claude.cmd`, '@echo off\r\necho 1\r\n');
      configs.push([[`${dir}/claude.cmd`], 'not_executable']);
    } else {
      await writeFile(`${dir}/claude-ohne-rechte`, '#!/bin/sh\necho 1\n');
      await chmod(`${dir}/claude-ohne-rechte`, 0o644);
      configs.push([[`${dir}/claude-ohne-rechte`], 'not_executable']);
    }
    for (const [command, errorCode] of configs) {
      await useFakeClaude(p.workspace, { command });
      const { result } = await runOnce(p);
      expect(result, errorCode).toMatchObject({ ok: false, errorCode, meta: { exitCode: null } });
    }
  });

  it('beendet einen hängenden Prozess spätestens 5 s nach dem Timeout, ohne Zombie (AK-05-03)', async () => {
    const p = await prepare({ claude: { timeoutSeconds: 1 } });
    const modes = process.platform === 'win32' ? ['hang', 'hang-no-stdin'] : ['hang', 'hang-no-stdin', 'hang-ignore-term'];
    for (const mode of modes) {
      const started = Date.now();
      const { result, modelCall } = await runOnce(p, mode, {}, { stdin: `${INPUT}${' '.repeat(300_000)}` });
      expect(Date.now() - started, mode).toBeLessThan(1000 + 5000);
      expect(result, mode).toMatchObject({ ok: false, errorCode: 'timeout' });
      expect(isProcessAlive(modelCall?.pid ?? 0), mode).toBe(false);
    }
  });

  it('begrenzt stderr auf 64 KiB', async () => {
    const p = await prepare();
    const { result } = await runOnce(p, 'stderr-flood');
    expect(result.ok).toBe(true);
    expect(result.meta.rawStderr).toHaveLength(64 * 1024);
    expect(result.meta.stderrTruncated).toBe(true);
  });

  it('schreibt pro Aufruf genau eine schemagültige Zeile in ai-usage.jsonl, ohne Eingabe und Antwort (AK-05-04)', async () => {
    const p = await prepare();
    const ok = await runOnce(p);
    const failed = await runOnce(p, 'error-result');
    const journal = await runOnce(p, 'ok', {}, { purpose: 'journal', subjectId: '2026-10-14', promptVersion: 'journal@1', outputSchemaVersion: 'journal-output@1', inputIds: [] });
    const records = await aiUsage(p.workspace);
    expect(records).toHaveLength(3);
    expect(records[0]).toEqual({
      schemaVersion: 1,
      runId: ok.ctx.runId,
      purpose: 'analysis',
      subjectId: 'S000002',
      startedAt: ok.result.meta.startedAt,
      endedAt: ok.result.meta.endedAt,
      cliVersion: null,
      models: ['claude-fake-model'],
      promptVersion: 'analyze-work@1',
      outputSchemaVersion: 'analysis-output@1',
      inputSha256: createHash('sha256').update(INPUT).digest('hex'),
      inputIds: ['E001', 'E002'],
      outcome: 'success',
      errorCode: null,
      costUsd: 0.0123,
      durationMs: 1234,
    });
    expect(records[1]).toMatchObject({ runId: failed.ctx.runId, outcome: 'claude_error', errorCode: 'error_result', costUsd: 0.002, durationMs: 2000 });
    expect(records[2]).toMatchObject({ runId: journal.ctx.runId, purpose: 'journal', subjectId: '2026-10-14', promptVersion: 'journal@1' });
    const text = await readFile(aiUsagePath(p.workspace), 'utf8');
    for (const marker of [INPUT_MARKER, ANSWER_MARKER, 'Anführungszeichen', 'Antworte nur']) expect(text).not.toContain(marker);
  });
});

describe('ClaudeRunner: Kostenschutz (spec.md §13.1)', () => {
  const PAID: Record<string, string> = {
    ANTHROPIC_API_KEY: FAKE_API_KEY,
    ANTHROPIC_AUTH_TOKEN: FAKE_AUTH_TOKEN,
    CLAUDE_CODE_USE_BEDROCK: '1',
    CLAUDE_CODE_USE_VERTEX: '1',
    CLAUDE_CODE_USE_FOUNDRY: '1',
  };

  it('startet ohne Freigabe keinen Prozess, wenn ein API-Schlüssel oder ein externer Anbieter gesetzt ist', async () => {
    const p = await prepare();
    for (const [name, value] of Object.entries(PAID)) {
      const fake = await fakeClaudeEnv('ok', { [name]: value });
      const ctx = await resolveContext({ repo: p.repo.root, dataDir: p.dataDir, requireInit: true });
      const error = await createClaudeRunner({ env: mergedEnv(fake.env) })
        .run(ctx, request(p.promptFile))
        .catch((caught: unknown) => caught);
      expect(error, name).toBeInstanceOf(IpaError);
      expect(error, name).toMatchObject({ code: 'paid_usage_blocked', exitCode: 6 });
      expect((error as Error).message, name).toContain(name);
      expect((error as Error).message, name).not.toContain(FAKE_API_KEY);
      expect((error as Error).message, name).not.toContain(FAKE_AUTH_TOKEN);
      expect(await fake.calls(), name).toEqual([]);
    }
    expect(await aiUsage(p.workspace)).toEqual([]);
  });

  it('ruft Claude mit der Abo-Anmeldung auf, auch mit CLAUDE_CODE_OAUTH_TOKEN', async () => {
    const p = await prepare();
    const { result, modelCall } = await runOnce(p, 'ok', { CLAUDE_CODE_OAUTH_TOKEN: 'abo-token' });
    expect(result.ok).toBe(true);
    expect(modelCall?.env).toContain('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('ruft Claude mit allowPaidUsage: true auch mit API-Schlüssel und Anbieter auf', async () => {
    const p = await prepare({ claude: { allowPaidUsage: true } });
    const { result, modelCall } = await runOnce(p, 'ok', { ANTHROPIC_API_KEY: FAKE_API_KEY, CLAUDE_CODE_USE_BEDROCK: '1' });
    expect(result.ok).toBe(true);
    expect(modelCall?.env).toContain('CLAUDE_CODE_USE_BEDROCK');
    expect(await aiUsage(p.workspace)).toHaveLength(1);
  });
});

describe('ClaudeRunner: Optionen nach doctor.json (AK-05-05, AK-05-11)', () => {
  async function doctor(p: Prepared, args: string[], mode: string, extra: Record<string, string> = {}): Promise<number> {
    return (await runCli(['doctor', ...args], { dataDir: p.dataDir, repo: p.repo.root, env: (await fakeClaudeEnv(mode, extra)).env })).exitCode;
  }

  it('übergibt --setting-sources nur, wenn doctor.json settingSourcesAuthOk: true meldet', async () => {
    const p = await prepare();
    const withoutDoctor = await runOnce(p);
    expect(withoutDoctor.modelCall?.args).not.toContain('--setting-sources');

    expect(await doctor(p, ['--live'], 'ok')).toBe(0);
    const confirmed = await runOnce(p);
    const args = confirmed.modelCall?.args ?? [];
    // Order of spec.md §13.1: after the prompt file, then --safe-mode, which the fake supports.
    expect(args.slice(-5)).toEqual(['--append-system-prompt-file', args.at(-4), '--setting-sources', 'project,local', '--safe-mode']);

    expect(await doctor(p, ['--live'], 'settings-auth-fail')).toBe(0);
    const refuted = await runOnce(p);
    expect(refuted.modelCall?.args).not.toContain('--setting-sources');

    expect(await doctor(p, ['--live'], 'ok')).toBe(0);
    expect(await doctor(p, [], 'ok', { FAKE_CLAUDE_VERSION: '9.9.10' })).toBe(0);
    const afterUpdate = await runOnce(p);
    expect(afterUpdate.modelCall?.args).not.toContain('--setting-sources');
  });

  it('übergibt --safe-mode nur, wenn doctor.json die Option als unterstützt meldet', async () => {
    const p = await prepare();
    expect(await doctor(p, [], 'ok', { FAKE_CLAUDE_UNSUPPORTED: '--safe-mode' })).toBe(0);
    expect((await runOnce(p)).modelCall?.args).not.toContain('--safe-mode');
    expect(await doctor(p, [], 'ok')).toBe(0);
    expect((await runOnce(p)).modelCall?.args?.at(-1)).toBe('--safe-mode');
  });

  it('übergibt ein konfiguriertes Modell mit --model', async () => {
    const p = await prepare({ claude: { model: 'sonnet' } });
    const { modelCall } = await runOnce(p);
    expect(modelCall?.args?.slice(-2)).toEqual(['--model', 'sonnet']);
  });
});
