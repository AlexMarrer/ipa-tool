import { describe, expect, it } from 'vitest';
import { claudeProcessEnv, droppedSessionVariables, isNestedClaudeSession } from '../../src/claude/env.js';

describe('Umgebung für claude (spec.md §13.1, §18)', () => {
  const user = {
    PATH: '/usr/bin',
    ANTHROPIC_BASE_URL: 'https://proxy.example.invalid',
    CLAUDE_CONFIG_DIR: 'C:/Benutzer/konfig',
    CLAUDE_CODE_OAUTH_TOKEN: 'token-wert',
    CLAUDE_CODE_USE_BEDROCK: '1',
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8000',
    MCP_TIMEOUT: '5000',
  };
  const session = {
    CLAUDECODE: '1',
    CLAUDE_CODE_ENTRYPOINT: 'claude-desktop',
    CLAUDE_CODE_SESSION_ID: 'sitzung-123',
    CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/socket',
    CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: '1',
    CLAUDE_PID: '4711',
    MCP_CONNECTION_NONBLOCKING: 'true',
  };

  it('gibt die Umgebung ausserhalb einer Claude-Code-Sitzung unverändert weiter', () => {
    expect(isNestedClaudeSession(user)).toBe(false);
    expect(droppedSessionVariables(user)).toEqual([]);
    expect(claudeProcessEnv({ ...user, CLAUDE_CODE_EIGENE_EINSTELLUNG: 'x' })).toEqual({ ...user, CLAUDE_CODE_EIGENE_EINSTELLUNG: 'x' });
  });

  it('entfernt in einer Sitzung deren Variablen und behält Anmelde- und Anbietervariablen', () => {
    const env = { ...user, ...session };
    expect(isNestedClaudeSession(env)).toBe(true);
    expect(isNestedClaudeSession({ CLAUDE_CODE_ENTRYPOINT: 'cli' })).toBe(true);
    expect(droppedSessionVariables(env)).toEqual(Object.keys(session).sort());
    expect(claudeProcessEnv(env)).toEqual(user);
  });
});
