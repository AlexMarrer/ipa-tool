/**
 * Command line of `claude` (spec.md §13.1) and the option probe without a model call (§13.2).
 */
import type { Config } from '../core/config.js';
import { isPlainObject } from './envelope.js';
import type { ClaudePurpose, ProbedFlag } from './types.js';

/** `-p` text per purpose; the journal text is adapted in spirit (spec.md §13.1). */
export const PRINT_PROMPTS: Record<ClaudePurpose, string> = {
  analysis: 'Analysiere ausschliesslich das JSON-Eingabepaket auf stdin gemäss den Systemanweisungen.',
  journal: 'Erstelle den Journal-Entwurf ausschliesslich aus dem JSON-Eingabepaket auf stdin gemäss den Systemanweisungen.',
  doctor: 'Analysiere ausschliesslich das JSON-Eingabepaket auf stdin gemäss den Systemanweisungen.',
};

export interface ClaudeArgsInput {
  printPrompt: string;
  outputFormat: 'json' | 'stream-json';
  /** Compact output schema from `prepareOutputSchema`. */
  schemaJson: string;
  maxTurns: number;
  /** Absolute path of `prompt.md` in the Claude working directory. */
  promptFile: string;
  /** Only if `doctor.json` confirms A-08. */
  settingSources: boolean;
  model: string | null;
  /** Only if `doctor.json` reports the option as supported. */
  safeMode: boolean;
}

/** Exactly the order of spec.md §13.1; `stream-json` (doctor only) also needs `--verbose`. */
export function buildClaudeArgs(input: ClaudeArgsInput): string[] {
  const args = ['-p', input.printPrompt, '--output-format', input.outputFormat];
  if (input.outputFormat === 'stream-json') args.push('--verbose');
  args.push(
    '--json-schema',
    input.schemaJson,
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
    String(input.maxTurns),
    '--append-system-prompt-file',
    input.promptFile,
  );
  if (input.settingSources) args.push('--setting-sources', 'project,local');
  if (input.model !== null) args.push('--model', input.model);
  if (input.safeMode) args.push('--safe-mode');
  return args;
}

export const UNKNOWN_PROBE_OPTION = '--zz-ipa-probe';

/** Stands for the path of `prompt.md` in the probe folder. */
const PROMPT_FILE = '<prompt.md>';

interface FlagSpec {
  flag: ProbedFlag;
  values: readonly string[];
}

/** All options of spec.md §13.1 including `--safe-mode`, plus `--verbose` for `stream-json`. */
export const FLAG_SPECS: readonly FlagSpec[] = [
  { flag: '-p', values: [] },
  { flag: '--output-format', values: ['json'] },
  { flag: '--json-schema', values: ['{"type":"object"}'] },
  { flag: '--tools', values: [''] },
  { flag: '--disallowedTools', values: ['mcp__*'] },
  { flag: '--strict-mcp-config', values: [] },
  { flag: '--permission-mode', values: ['dontAsk'] },
  { flag: '--disable-slash-commands', values: [] },
  { flag: '--no-session-persistence', values: [] },
  { flag: '--max-turns', values: ['1'] },
  { flag: '--append-system-prompt-file', values: [PROMPT_FILE] },
  { flag: '--setting-sources', values: ['project,local'] },
  { flag: '--model', values: ['sonnet'] },
  { flag: '--safe-mode', values: [] },
  { flag: '--verbose', values: [] },
];

export const MANDATORY_FLAGS: readonly ProbedFlag[] = [
  '-p',
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
];

/** Mandatory options for this configuration: `--model` only if a model is configured. */
export function requiredFlags(config: Pick<Config, 'claude'>): ProbedFlag[] {
  return config.claude.model === null ? [...MANDATORY_FLAGS] : [...MANDATORY_FLAGS, '--model'];
}

/**
 * `-p <option> [value] --zz-ipa-probe` without a positional argument and with empty stdin: even if an
 * option were accepted unexpectedly, no prompt and hence no model call arises (spec.md §13.2, §18).
 */
export function buildFlagProbeArgs(flag: ProbedFlag, promptFile: string): string[] {
  const spec = FLAG_SPECS.find((candidate) => candidate.flag === flag);
  if (spec === undefined) throw new Error(`Unbekannte Prüfoption ${flag}`);
  if (flag === '-p') return ['-p', UNKNOWN_PROBE_OPTION];
  const values = spec.values.map((value) => (value === PROMPT_FILE ? promptFile : value));
  return ['-p', flag, ...values, UNKNOWN_PROBE_OPTION];
}

export type FlagProbeResult = 'supported' | 'unsupported' | 'unknown';

/**
 * Supported if stderr calls the probe option unknown; not supported if it names the probed option.
 * Any other output is unknown and counts as not supported.
 */
export function classifyFlagProbe(flag: ProbedFlag, stderr: string): FlagProbeResult {
  if (stderr.includes(`unknown option '${UNKNOWN_PROBE_OPTION}'`)) return 'supported';
  if (stderr.includes(`unknown option '${flag}'`)) return 'unsupported';
  return 'unknown';
}

/** First version number in the output of `--version`, for example `2.1.114` from `2.1.114 (Claude Code)`. */
export function parseVersion(stdout: string): string | null {
  const match = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(stdout);
  return match?.[1] ?? null;
}

/** `git version 2.51.0.windows.1` → `2.51.0.windows.1`. */
export function parseGitVersion(stdout: string): string | null {
  const match = /git version ([0-9][0-9A-Za-z.+-]{0,63})/.exec(stdout);
  return match?.[1] ?? null;
}

const AUTH_METHOD = /^[A-Za-z0-9._-]{1,40}$/;
/** `apiKeySource` values of Claude Code 2.1.114; anything else could be a key and becomes `unbekannt`. */
const API_KEY_SOURCES: ReadonlySet<string> = new Set(['ANTHROPIC_API_KEY', 'apiKeyHelper', '/login managed key']);

export interface AuthStatus {
  loggedIn: boolean | null;
  authMethod: string | null;
  /** Where Claude Code would take an API key from; `null` without one (spec.md §13.1). */
  apiKeySource: string | null;
}

/**
 * Keeps only `loggedIn`, `authMethod` and `apiKeySource` of `claude auth status`; email, organisation,
 * token and everything else are dropped. A value that looks unusual becomes `unbekannt`.
 */
export function filterAuthStatus(stdout: string, exitCode: number | null): AuthStatus {
  let value: unknown = null;
  try {
    value = JSON.parse(stdout);
  } catch {
    // no JSON
  }
  const record = isPlainObject(value) ? value : {};
  const rawLoggedIn = record['loggedIn'];
  // Without JSON, exit code 1 means "not logged in" (package 05 §6).
  const loggedIn = typeof rawLoggedIn === 'boolean' ? rawLoggedIn : exitCode === 1 ? false : null;
  const rawMethod = record['authMethod'];
  const authMethod = typeof rawMethod === 'string' ? (AUTH_METHOD.test(rawMethod) ? rawMethod : 'unbekannt') : null;
  const rawSource = record['apiKeySource'];
  const apiKeySource = typeof rawSource === 'string' ? (API_KEY_SOURCES.has(rawSource) ? rawSource : 'unbekannt') : null;
  return { loggedIn, authMethod, apiKeySource };
}
