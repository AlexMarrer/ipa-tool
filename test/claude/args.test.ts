import { describe, expect, it } from 'vitest';
import {
  buildClaudeArgs,
  buildFlagProbeArgs,
  classifyFlagProbe,
  FLAG_SPECS,
  filterAuthStatus,
  MANDATORY_FLAGS,
  parseGitVersion,
  parseVersion,
  PRINT_PROMPTS,
  requiredFlags,
  UNKNOWN_PROBE_OPTION,
} from '../../src/claude/args.js';

const base = {
  printPrompt: PRINT_PROMPTS.analysis,
  outputFormat: 'json' as const,
  schemaJson: '{"type":"object"}',
  maxTurns: 5,
  promptFile: 'C:/Temp/ipa-assistant/claude/p-3fa9c1/R20261014T080312Z-a3f9-1/prompt.md',
  settingSources: false,
  model: null,
  safeMode: false,
};

describe('Argumente für Claude (spec.md §13.1, AK-05-01, AK-05-11)', () => {
  it('bildet die Pflichtoptionen in der vorgeschriebenen Reihenfolge, mit leerem Argument nach --tools', () => {
    expect(buildClaudeArgs(base)).toEqual([
      '-p',
      'Analysiere ausschliesslich das JSON-Eingabepaket auf stdin gemäss den Systemanweisungen.',
      '--output-format',
      'json',
      '--json-schema',
      '{"type":"object"}',
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
      base.promptFile,
    ]);
  });

  it('hängt --setting-sources, --model und --safe-mode nur auf Wunsch und in dieser Reihenfolge an', () => {
    const all = buildClaudeArgs({ ...base, settingSources: true, model: 'sonnet', safeMode: true });
    expect(all.slice(-5)).toEqual(['--setting-sources', 'project,local', '--model', 'sonnet', '--safe-mode']);
    expect(buildClaudeArgs({ ...base, safeMode: true }).slice(-3)).toEqual(['--append-system-prompt-file', base.promptFile, '--safe-mode']);
    expect(buildClaudeArgs(base)).not.toContain('--setting-sources');
    expect(buildClaudeArgs(base)).not.toContain('--safe-mode');
    expect(buildClaudeArgs(base)).not.toContain('--model');
  });

  it('ergänzt für stream-json --verbose direkt nach dem Format', () => {
    const args = buildClaudeArgs({ ...base, outputFormat: 'stream-json', printPrompt: PRINT_PROMPTS.doctor });
    expect(args.slice(0, 6)).toEqual(['-p', PRINT_PROMPTS.doctor, '--output-format', 'stream-json', '--verbose', '--json-schema']);
    expect(PRINT_PROMPTS.journal).toContain('stdin');
  });
});

describe('Flag-Prüfung ohne Modellaufruf (spec.md §13.2, AK-05-05)', () => {
  it('prüft alle Optionen aus §13.1 einschliesslich --safe-mode, ohne Positionsargument', () => {
    const flags = FLAG_SPECS.map((spec) => spec.flag);
    for (const flag of [...MANDATORY_FLAGS, '--setting-sources', '--model', '--safe-mode', '--verbose'] as const) expect(flags).toContain(flag);
    expect(buildFlagProbeArgs('-p', 'p.md')).toEqual(['-p', UNKNOWN_PROBE_OPTION]);
    expect(buildFlagProbeArgs('--tools', 'p.md')).toEqual(['-p', '--tools', '', UNKNOWN_PROBE_OPTION]);
    expect(buildFlagProbeArgs('--append-system-prompt-file', 'C:/t/prompt.md')).toEqual([
      '-p',
      '--append-system-prompt-file',
      'C:/t/prompt.md',
      UNKNOWN_PROBE_OPTION,
    ]);
    for (const spec of FLAG_SPECS) {
      const args = buildFlagProbeArgs(spec.flag, 'p.md');
      expect(args[0]).toBe('-p');
      expect(args.at(-1)).toBe(UNKNOWN_PROBE_OPTION);
    }
  });

  it('wertet die erste unbekannte Option aus; jede andere Antwort gilt als nicht unterstützt', () => {
    expect(classifyFlagProbe('--tools', `error: unknown option '${UNKNOWN_PROBE_OPTION}'\n`)).toBe('supported');
    expect(classifyFlagProbe('--safe-mode', "error: unknown option '--safe-mode'\n")).toBe('unsupported');
    expect(classifyFlagProbe('--tools', 'Error: Input must be provided')).toBe('unknown');
  });

  it('verlangt --model nur, wenn ein Modell konfiguriert ist', () => {
    expect(requiredFlags({ claude: { model: null } } as never)).toEqual([...MANDATORY_FLAGS]);
    expect(requiredFlags({ claude: { model: 'opus' } } as never)).toEqual([...MANDATORY_FLAGS, '--model']);
    expect(MANDATORY_FLAGS).toHaveLength(11);
  });

  it('liest die Versionen von Claude Code und Git', () => {
    expect(parseVersion('2.1.114 (Claude Code)\n')).toBe('2.1.114');
    expect(parseVersion('unbekannt')).toBeNull();
    expect(parseGitVersion('git version 2.51.0.windows.1\n')).toBe('2.51.0.windows.1');
    expect(parseGitVersion('git version 2.43.0\n')).toBe('2.43.0');
    expect(parseGitVersion('kein git')).toBeNull();
  });
});

describe('Filter für claude auth status (AK-05-06)', () => {
  it('übernimmt nur loggedIn, authMethod und apiKeySource', () => {
    const raw = JSON.stringify({
      loggedIn: true,
      authMethod: 'claude.ai',
      email: 'person@example.com',
      orgName: 'Geheime Firma AG',
      orgId: '5f3c0000-1111',
      accessToken: 'sk-ant-oat01-FAKE',
    });
    expect(filterAuthStatus(raw, 0)).toEqual({ loggedIn: true, authMethod: 'claude.ai', apiKeySource: null });
    const withKey = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiKeySource: '/login managed key', subscriptionType: null });
    expect(filterAuthStatus(withKey, 0)).toEqual({ loggedIn: true, authMethod: 'claude.ai', apiKeySource: '/login managed key' });
  });

  it('ersetzt eine auffällige Anmeldeart und wertet Exit-Code 1 ohne JSON als nicht angemeldet', () => {
    expect(filterAuthStatus(JSON.stringify({ loggedIn: false, authMethod: 'person@example.com', apiKeySource: 'sk-ant-api03-GEHEIM' }), 1)).toEqual({
      loggedIn: false,
      authMethod: 'unbekannt',
      apiKeySource: 'unbekannt',
    });
    expect(filterAuthStatus('Not logged in', 1)).toEqual({ loggedIn: false, authMethod: null, apiKeySource: null });
    expect(filterAuthStatus('kein json', 0)).toEqual({ loggedIn: null, authMethod: null, apiKeySource: null });
    expect(filterAuthStatus('[1,2]', 0)).toEqual({ loggedIn: null, authMethod: null, apiKeySource: null });
  });
});
