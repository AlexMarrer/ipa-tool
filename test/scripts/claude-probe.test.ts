import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildFlagProbeArgs,
  buildLiveArgs,
  classifyFlagProbe,
  evaluateAssumptions,
  excerptOf,
  filterAuthStatus,
  FLAG_SPECS,
  inheritedSessionVariables,
  INPUT_MARKER,
  isolatedEnv,
  isNestedClaudeSession,
  parseJsonEnvelope,
  parseProbeArgs,
  parseStreamJson,
  parseVersion,
  PROMPT_TEXT,
  redact,
  TRIVIAL_SCHEMA,
  UNKNOWN_PROBE_OPTION,
} from '../../scripts/claude-probe.mjs';
import { createTempRepo } from '../helpers/git-repo.js';
import { expectRepoUnchanged, fingerprintRepo } from '../helpers/repo-fingerprint.js';
import { createTempDir, TOOL_ROOT } from '../helpers/workspace.js';

const PROBE = path.join(TOOL_ROOT, 'scripts', 'claude-probe.mjs');
const FAKE = path.join(TOOL_ROOT, 'test', 'helpers', 'fake-claude-probe.mjs');
const FAKE_COMMAND = JSON.stringify([process.execPath, FAKE]);

interface ProbeRun {
  exitCode: number;
  stdout: string;
  stderr: string;
  // `any`: the script's free-form JSON, only read by the test.
  report: Record<string, any>;
  log: Record<string, unknown>[];
}

async function runProbe(
  args: string[],
  options: { cwd: string; mode?: string; command?: string; env?: Record<string, string> },
): Promise<ProbeRun> {
  const logFile = path.join(await createTempDir('fake-log'), 'aufrufe.jsonl');
  // When the suite itself runs inside a Claude Code session, that session's variables must not affect the result.
  const env = { ...isolatedEnv(process.env), FAKE_CLAUDE_MODE: options.mode ?? 'ok', FAKE_CLAUDE_LOG: logFile, ...options.env };
  const child = spawn(process.execPath, [PROBE, '--command', options.command ?? FAKE_COMMAND, ...args], {
    cwd: options.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => (stdout += chunk));
  child.stderr.on('data', (chunk: string) => (stderr += chunk));
  const exitCode = await new Promise<number>((resolve) => child.on('close', (code) => resolve(code ?? -1)));
  const logText = await readFile(logFile, 'utf8').catch(() => '');
  const log = logText
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { exitCode, stdout, stderr, report: JSON.parse(stdout) as Record<string, unknown>, log };
}

describe('Claude-Vorabprüfung: Argumente und Auswertung (AK-01-17)', () => {
  it('bildet die Flag-Prüfung ohne Positionsargument', () => {
    const spec = (flag: string) => FLAG_SPECS.find((s) => s.flag === flag)!;
    expect(buildFlagProbeArgs(spec('-p'), 'p.md')).toEqual(['-p', UNKNOWN_PROBE_OPTION]);
    expect(buildFlagProbeArgs(spec('--tools'), 'p.md')).toEqual(['-p', '--tools', '', UNKNOWN_PROBE_OPTION]);
    expect(buildFlagProbeArgs(spec('--append-system-prompt-file'), 'C:/t/p.md')).toEqual([
      '-p',
      '--append-system-prompt-file',
      'C:/t/p.md',
      UNKNOWN_PROBE_OPTION,
    ]);
    const flags = FLAG_SPECS.map((s) => s.flag);
    for (const required of [
      '--output-format',
      '--json-schema',
      '--tools',
      '--disallowedTools',
      '--strict-mcp-config',
      '--permission-mode',
      '--disable-slash-commands',
      '--no-session-persistence',
      '--max-turns',
      '--append-system-prompt-file',
      '--setting-sources',
      '--model',
      '--safe-mode',
    ]) {
      expect(flags).toContain(required);
    }
  });

  it('bildet die Live-Argumente in der Reihenfolge aus spec.md §13.1', () => {
    expect(buildLiveArgs({ outputFormat: 'json', promptFile: 'C:/tmp/x/prompt.md', settingSources: true })).toEqual([
      '-p',
      PROMPT_TEXT,
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(TRIVIAL_SCHEMA),
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
      'C:/tmp/x/prompt.md',
      '--setting-sources',
      'project,local',
    ]);
    const stream = buildLiveArgs({ outputFormat: 'stream-json', promptFile: 'p.md', settingSources: false });
    expect(stream.slice(2, 5)).toEqual(['--output-format', 'stream-json', '--verbose']);
    expect(stream).not.toContain('--setting-sources');
    expect(JSON.stringify(TRIVIAL_SCHEMA)).not.toMatch(/"(\$schema|\$id|format)"/);
  });

  it('wertet die Flag-Prüfung über die erste unbekannte Option aus', () => {
    expect(classifyFlagProbe('--tools', { stderr: `error: unknown option '${UNKNOWN_PROBE_OPTION}'\n` })).toBe('supported');
    expect(classifyFlagProbe('--safe-mode', { stderr: "error: unknown option '--safe-mode'\n" })).toBe('unsupported');
    expect(classifyFlagProbe('--tools', { stderr: 'Error: Input must be provided' })).toBe('unknown');
  });

  it('übernimmt aus claude auth status nur loggedIn und authMethod', () => {
    const raw = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'a@b.ch', orgName: 'Firma', orgId: 'x', token: 'sk-ant-123' });
    expect(filterAuthStatus(raw)).toEqual({ loggedIn: true, authMethod: 'claude.ai' });
    expect(filterAuthStatus(JSON.stringify({ loggedIn: false, authMethod: 'person@example.com' }))).toEqual({
      loggedIn: false,
      authMethod: 'unbekannt',
    });
    expect(filterAuthStatus('kein json')).toEqual({ loggedIn: null, authMethod: null });
    expect(parseVersion('2.1.114 (Claude Code)\n')).toBe('2.1.114');
    expect(parseVersion('unbekannt')).toBeNull();
  });

  it('wertet stream-json mit Init-Ereignis, Werkzeugaufrufen und Wiederholungen aus', () => {
    const stdout = [
      { type: 'system', subtype: 'init', tools: ['StructuredOutput'], mcp_servers: [{ name: 'x', status: 'failed' }], model: 'm' },
      { type: 'system', subtype: 'api_retry', error: 'authentication_failed' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'StructuredOutput' }] } },
      { type: 'result', subtype: 'success', is_error: false, structured_output: { ok: true }, permission_denials: [{ tool_name: 'Bash' }], modelUsage: { m: {} } },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n');
    const parsed = parseStreamJson(`${stdout}\nkein json\n`);
    expect(parsed.init).toEqual({ tools: ['StructuredOutput'], mcpServers: ['x'], model: 'm' });
    expect(parsed.events).toEqual({
      byType: { 'system/init': 1, 'system/api_retry': 1, assistant: 1, 'result/success': 1 },
      toolUses: ['StructuredOutput'],
      apiRetryErrors: ['authentication_failed'],
      lastEvent: 'result/success',
    });
    expect(parsed.result).toMatchObject({ structuredOutputValid: true, permissionDenials: 1, deniedTools: ['Bash'], models: ['m'] });
    expect(parsed.invalidLines).toBe(1);
  });

  it('erkennt zusätzlichen Text vor dem JSON und gibt ihn gekürzt ohne Eingabe aus', () => {
    const single = parseJsonEnvelope('{"type":"result","subtype":"success","is_error":false,"structured_output":{"ok":true}}\n');
    expect(single).toMatchObject({ singleObject: true, empty: false, excerpt: null, result: { structuredOutputValid: true } });
    const extra = parseJsonEnvelope(`Update verfügbar\nEcho ${INPUT_MARKER}\n{"type":"result","subtype":"success","is_error":false}`);
    expect(extra.singleObject).toBe(false);
    expect(extra.result).toMatchObject({ subtype: 'success' });
    expect(extra.excerpt).toContain('Update verfügbar');
    expect(extra.excerpt).not.toContain(INPUT_MARKER);
    expect(parseJsonEnvelope('   ')).toMatchObject({ empty: true, singleObject: false, excerpt: null });
    expect(excerptOf('x'.repeat(500)).length).toBeLessThan(320);
    expect(redact('Mail: person@example.com, Token sk-ant-abcdefghijklmnop')).toBe('Mail: [E-Mail entfernt], Token [Token entfernt]');
  });

  it('bewertet die Annahmen aus festen Beispielberichten', () => {
    const base = { command: ['claude'], claude: { found: true }, flags: { '--tools': 'supported' } };
    const ok = (label: string, extra: Record<string, unknown> = {}) => ({
      label,
      timedOut: false,
      durationMs: 1000,
      stdoutEmpty: false,
      singleObject: true,
      result: { subtype: 'success', isError: false, structuredOutputValid: true, hasStructuredOutput: true, authError: false },
      ...extra,
    });
    const live = {
      calls: [ok('stream-json', { init: { tools: ['StructuredOutput'], mcpServers: [] } }), ok('json'), ok('setting-sources')],
    };
    const all = evaluateAssumptions({ ...base, live });
    expect(Object.fromEntries(Object.entries(all).map(([id, a]) => [id, a.status]))).toEqual({
      'A-01': 'bestätigt',
      'A-02': 'bestätigt',
      'A-03': 'bestätigt',
      'A-04': 'bestätigt',
      'A-05': 'bestätigt',
      'A-08': 'bestätigt',
    });

    const withTools = evaluateAssumptions({ ...base, live: { calls: [ok('stream-json', { init: { tools: ['Bash'], mcpServers: [] } })] } });
    expect(withTools['A-01']?.status).toBe('widerlegt');

    const timedOut = evaluateAssumptions({
      ...base,
      live: {
        calls: [
          { label: 'stream-json', timedOut: true, durationMs: 180000, init: { tools: ['StructuredOutput'], mcpServers: [] }, result: null, events: { apiRetryErrors: ['authentication_failed'] } },
          { label: 'json', skipped: 'übersprungen' },
          { label: 'setting-sources', skipped: 'übersprungen' },
        ],
      },
    });
    expect(timedOut['A-01']?.status).toBe('bestätigt');
    expect(timedOut['A-02']).toEqual({ status: 'unklar', evidence: 'übersprungen' });
    expect(timedOut['A-03']?.status).toBe('unklar');
    expect(timedOut['A-08']?.status).toBe('unklar');

    const noLive = evaluateAssumptions({ ...base, live: null });
    expect(noLive['A-02']).toEqual({ status: 'unklar', evidence: 'ohne --live nicht geprüft' });
    expect(evaluateAssumptions({ ...base, command: ['C:/x/claude.exe'], live: null })['A-05']?.status).toBe('unklar');
    expect(evaluateAssumptions({ ...base, claude: { found: false, cmdShimFound: true }, live: null })['A-05']?.status).toBe('widerlegt');
  });

  it('erkennt eine umgebende Claude-Code-Sitzung und entfernt nur deren Variablen', () => {
    const env = { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', CLAUDE_CODE_OAUTH_TOKEN: 't', CLAUDE_CONFIG_DIR: 'c', PATH: 'p' };
    expect(isNestedClaudeSession(env)).toBe(true);
    expect(isNestedClaudeSession({ PATH: 'p' })).toBe(false);
    expect(inheritedSessionVariables(env)).toEqual(['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']);
    expect(isolatedEnv(env)).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 't', CLAUDE_CONFIG_DIR: 'c', PATH: 'p' });
  });

  it('prüft die eigenen Argumente', () => {
    expect(parseProbeArgs([])).toEqual({ live: false, help: false, isolateEnv: false, command: ['claude'] });
    expect(parseProbeArgs(['--live', '--isolate-env', '--command', '["a","b"]'])).toEqual({
      live: true,
      help: false,
      isolateEnv: true,
      command: ['a', 'b'],
    });
    expect(() => parseProbeArgs(['--command', 'claude'])).toThrow('JSON-Array');
    expect(() => parseProbeArgs(['--gibt-es-nicht'])).toThrow('Unbekanntes Argument');
  });
});

describe('Claude-Vorabprüfung mit Fake-CLI (AK-01-17)', () => {
  it('meldet ohne --live Version, Anmeldung und Optionen ohne Modellaufruf und ohne persönliche Daten', async () => {
    const repo = await createTempRepo();
    const before = await fingerprintRepo(repo.root);
    const run = await runProbe([], { cwd: repo.root });

    expect(run.exitCode).toBe(0);
    expect(run.report['claude']).toMatchObject({ found: true, version: '9.9.9' });
    expect(run.report['auth']).toEqual({ loggedIn: true, authMethod: 'claude.ai' });
    expect(run.report['flags']).toMatchObject({ '--tools': 'supported', '--json-schema': 'supported', '--safe-mode': 'unsupported' });
    expect(run.report['live']).toBeNull();
    expect(run.log.some((entry) => entry['kind'] === 'model-call')).toBe(false);
    for (const secret of ['example.com', 'Geheime Firma', 'sk-ant', '5f3c0000']) {
      expect(run.stdout).not.toContain(secret);
      expect(run.stderr).not.toContain(secret);
    }
    expectRepoUnchanged(before, await fingerprintRepo(repo.root));
  });

  it('führt mit --live drei Aufrufe in leeren Temp-Ordnern aus und bestätigt die Annahmen', async () => {
    const repo = await createTempRepo();
    const before = await fingerprintRepo(repo.root);
    const run = await runProbe(['--live'], { cwd: repo.root });
    expect(run.stderr).toContain('verbraucht Claude-Kontingent');
    const calls = run.log.filter((entry) => entry['kind'] === 'model-call');
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call['cwdFiles']).toEqual(['prompt.md']);
      expect(String(call['cwd']).toLowerCase()).not.toContain(repo.root.toLowerCase());
      expect(call['stdin']).toContain(INPUT_MARKER);
      expect((call['args'] as string[]).slice(0, 2)).toEqual(['-p', PROMPT_TEXT]);
    }
    expect(Object.fromEntries(Object.entries(run.report['assumptions'] as Record<string, { status: string }>).map(([id, a]) => [id, a.status]))).toEqual({
      'A-01': 'bestätigt',
      'A-02': 'bestätigt',
      'A-03': 'bestätigt',
      'A-04': 'bestätigt',
      'A-05': 'unklar',
      'A-08': 'bestätigt',
    });
    expect(run.exitCode).toBe(0);
    expectRepoUnchanged(before, await fingerprintRepo(repo.root));
  });

  it('meldet Werkzeuge, zusätzlichen Text, angelegte Dateien und Anmeldefehler als Befunde', async () => {
    const cwd = await createTempDir('probe');
    const tools = await runProbe(['--live'], { cwd, mode: 'tools' });
    expect(tools.exitCode).toBe(3);
    expect(tools.report['assumptions']['A-01'].status).toBe('widerlegt');

    const extra = await runProbe(['--live'], { cwd, mode: 'extra-text' });
    expect(extra.report['assumptions']['A-03'].status).toBe('widerlegt');

    const files = await runProbe(['--live'], { cwd, mode: 'writes-file' });
    expect(files.report['findings'].join(' ')).toContain('probe-injektion.txt');

    const settings = await runProbe(['--live'], { cwd, mode: 'settings-auth-fail' });
    expect(settings.report['assumptions']['A-08'].status).toBe('widerlegt');

    const retry = await runProbe(['--live'], { cwd, mode: 'auth-retry' });
    expect(retry.report['findings'].join(' ')).toContain('authentication_failed');
    expect(retry.report['assumptions']['A-02'].status).toBe('unklar');
  });

  it('meldet eine umgebende Claude-Code-Sitzung und gibt ihre Variablen mit --isolate-env nicht weiter', async () => {
    const cwd = await createTempDir('probe');
    const session = { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' };
    const nested = await runProbe(['--live'], { cwd, env: session });
    expect(nested.exitCode).toBe(3);
    expect(nested.report['environment']).toMatchObject({ nestedClaudeSession: true, isolated: false });
    expect(nested.report['environment']['inheritedSessionVariables']).toEqual(['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']);
    expect(nested.report['findings'].join(' ')).toContain('innerhalb einer Claude-Code-Sitzung');
    expect(nested.log.find((entry) => entry['kind'] === 'model-call')?.['env']).toEqual(['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']);

    const isolated = await runProbe(['--live', '--isolate-env'], { cwd, env: session });
    expect(isolated.exitCode).toBe(0);
    expect(isolated.report['environment']).toMatchObject({ nestedClaudeSession: true, isolated: true });
    expect(isolated.log.find((entry) => entry['kind'] === 'model-call')?.['env']).toEqual([]);
  });

  it('überspringt die Live-Aufrufe, wenn Claude nicht angemeldet ist', async () => {
    const run = await runProbe(['--live'], { cwd: await createTempDir('probe'), mode: 'logged-out' });
    expect(run.exitCode).toBe(3);
    expect(run.report['live']).toEqual({ skipped: 'nicht angemeldet, Live-Aufrufe übersprungen' });
    expect(run.log.some((entry) => entry['kind'] === 'model-call')).toBe(false);
    expect(run.report['assumptions']['A-02'].status).toBe('unklar');
  });

  it('meldet einen nicht startbaren Befehl mit Exit-Code ungleich 0', async () => {
    const missing = JSON.stringify([path.join(await createTempDir('leer'), 'claude-gibt-es-nicht.exe')]);
    const run = await runProbe([], { cwd: await createTempDir('probe'), command: missing });
    expect(run.exitCode).toBe(1);
    expect(run.report['claude']).toMatchObject({ found: false });
    expect(run.report['findings'][0]).toContain('nicht startbar');
  });
});
