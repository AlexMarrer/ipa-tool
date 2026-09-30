/**
 * The fake Claude CLI in tests (spec.md §16.2): configuration, environment and its call log.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CLAUDE_CHECK_WARNING } from '../../src/cli/commands/doctor.js';
import type { Config } from '../../src/core/config.js';
import { createTempDir, readJsonFile, TOOL_ROOT } from './workspace.js';

export const FAKE_CLAUDE = path.join(TOOL_ROOT, 'test', 'helpers', 'fake-claude.mjs');

/** Variables that a surrounding Claude Code session would pass on. */
export const SESSION_ENV = {
  CLAUDECODE: '1',
  CLAUDE_CODE_ENTRYPOINT: 'claude-desktop',
  CLAUDE_CODE_SESSION_ID: 'sitzung-123',
  CLAUDE_CONFIG_DIR: 'C:/Benutzer/konfig',
} as const;

export interface FakeCall {
  kind: 'version' | 'auth' | 'unknown-option' | 'model-call';
  pid: number;
  option?: string;
  args?: string[];
  stdin?: string | null;
  stdinBytes?: number | null;
  stdinSha256?: string | null;
  cwd?: string;
  cwdFiles?: string[];
  promptFileSha256?: string | null;
  env?: string[];
}

/** Points `claude.command` of a workspace to the fake CLI. */
export async function useFakeClaude(workspace: string, claude: Partial<Config['claude']> = {}): Promise<void> {
  const file = `${workspace}/config.json`;
  const config = await readJsonFile<Config>(file);
  await writeFile(file, JSON.stringify({ ...config, claude: { ...config.claude, command: [process.execPath, FAKE_CLAUDE], ...claude } }, null, 2));
}

export interface FakeSetup {
  env: Record<string, string | undefined>;
  logFile: string;
  /** Empty `CLAUDE_CONFIG_DIR` of this run; `writeClaudeSettings` fills its `settings.json`. */
  configDir: string;
  calls(): Promise<FakeCall[]>;
}

/** Artificial values that must never appear in an output or a file. */
export const FAKE_API_KEY = 'sk-ant-api03-IPA-TEST-GEHEIM-0000000000';
export const FAKE_AUTH_TOKEN = 'ipa-test-bearer-GEHEIM-1111111111';
export const FAKE_KEY_HELPER = 'echo IPA-TEST-HELFER-GEHEIM-2222222222';

/**
 * Environment for one fake run. Variables of a Claude Code session in which the tests themselves may
 * run are removed, as are API keys of the machine, so that every test sees the same environment. The
 * own `CLAUDE_CONFIG_DIR` keeps the Claude settings of the machine out of the billing guard.
 */
export async function fakeClaudeEnv(mode = 'ok', extra: Record<string, string | undefined> = {}): Promise<FakeSetup> {
  const logFile = path.join(await createTempDir('fake-claude'), 'aufrufe.jsonl');
  const configDir = await createTempDir('claude-konfig');
  const env: Record<string, string | undefined> = { FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_LOG: logFile };
  for (const name of Object.keys(process.env)) {
    if (/^(CLAUDECODE|CLAUDE_.+|MCP_CONNECTION_NONBLOCKING|MCP_SERVER_CONNECTION_BATCH_SIZE|ANTHROPIC_(API_KEY|AUTH_TOKEN|PROFILE|FEDERATION_RULE_ID))$/i.test(name)) {
      env[name] = undefined;
    }
  }
  env['CLAUDE_CONFIG_DIR'] = configDir;
  Object.assign(env, extra);
  return { env, logFile, configDir, calls: () => readFakeCalls(logFile) };
}

/** Claude Code user settings (`settings.json`) in the configuration directory of a fake run. */
export async function writeClaudeSettings(configDir: string, settings: Record<string, unknown>): Promise<void> {
  await writeFile(path.join(configDir, 'settings.json'), JSON.stringify(settings, null, 2));
}

/** `process.env` combined with the variables of `fakeClaudeEnv`; `undefined` removes a variable. */
export function mergedEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  return env;
}

export async function readFakeCalls(logFile: string): Promise<FakeCall[]> {
  const text = await readFile(logFile, 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as FakeCall);
}

/** stderr without the warning of the Claude check after `init`, which appears because tests hide `claude`. */
export function withoutClaudeWarning(stderr: string): string {
  return stderr
    .split('\n')
    .filter((line) => !line.startsWith(CLAUDE_CHECK_WARNING))
    .join('\n');
}
