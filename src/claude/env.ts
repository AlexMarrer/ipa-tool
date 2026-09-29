/**
 * Environment of the `claude` processes (spec.md §13.1).
 *
 * If `ipa` itself runs inside a Claude Code session, that session passes its variables on
 * (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, messaging socket, session IDs …). They make the child
 * behave like part of the surrounding session, so they are dropped (spec.md §18). Login, provider and
 * configuration variables of the user stay; outside a session the environment is passed on unchanged.
 */

const SESSION_VARIABLE = /^(CLAUDECODE|CLAUDE_.+|MCP_CONNECTION_NONBLOCKING|MCP_SERVER_CONNECTION_BATCH_SIZE)$/i;

/** Documented user-level settings that also work outside a session. */
const USER_LEVEL_VARIABLES = new Set([
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'CLAUDE_CODE_SKIP_FOUNDRY_AUTH',
  'CLAUDE_CODE_CLIENT_CERT',
  'CLAUDE_CODE_CLIENT_KEY',
  'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE',
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'CLAUDE_CODE_GIT_BASH_PATH',
]);

export function isNestedClaudeSession(env: NodeJS.ProcessEnv): boolean {
  return env['CLAUDECODE'] === '1' || env['CLAUDE_CODE_ENTRYPOINT'] !== undefined;
}

/** Names of the session variables that are not passed on; never their values. */
export function droppedSessionVariables(env: NodeJS.ProcessEnv): string[] {
  if (!isNestedClaudeSession(env)) return [];
  return Object.keys(env)
    .filter((name) => SESSION_VARIABLE.test(name) && !USER_LEVEL_VARIABLES.has(name.toUpperCase()))
    .sort();
}

/** Environment for `claude`: everything except the variables of a surrounding session. No secrets are added. */
export function claudeProcessEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const drop = new Set(droppedSessionVariables(env));
  const result: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && !drop.has(name)) result[name] = value;
  }
  return result;
}
