/**
 * Fake-CLI für die Tests der Claude-Vorabprüfung (Paket 01). Ruft nie ein Modell auf.
 * Wird zusammen mit `scripts/claude-probe.mjs` in Paket 05 entfernt.
 *
 * Verhalten über Umgebungsvariablen (nur für diesen Test-Helfer):
 *   FAKE_CLAUDE_MODE  ok | logged-out | tools | extra-text | no-structured | settings-auth-fail | writes-file | auth-retry
 *   FAKE_CLAUDE_LOG   Datei, in die jeder Aufruf als JSON-Zeile protokolliert wird
 */
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const mode = process.env['FAKE_CLAUDE_MODE'] ?? 'ok';
const logFile = process.env['FAKE_CLAUDE_LOG'];
const args = process.argv.slice(2);

const VALUE_OPTIONS = new Set([
  '--output-format',
  '--json-schema',
  '--tools',
  '--disallowedTools',
  '--permission-mode',
  '--max-turns',
  '--append-system-prompt-file',
  '--setting-sources',
  '--model',
]);
const FLAG_OPTIONS = new Set(['-p', '--print', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence', '--verbose']);

/** @param {Record<string, unknown>} entry */
function record(entry) {
  if (logFile) appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
}

/** @param {unknown} value */
function print(value) {
  process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
}

if (args[0] === '--version') {
  record({ kind: 'version' });
  print('9.9.9 (Claude Code)');
  process.exit(0);
}

if (args[0] === 'auth' && args[1] === 'status') {
  record({ kind: 'auth' });
  const loggedIn = mode !== 'logged-out';
  print({
    loggedIn,
    authMethod: loggedIn ? 'claude.ai' : 'none',
    apiProvider: 'firstParty',
    email: 'person@example.com',
    orgId: '5f3c0000-1111-2222-3333-444455556666',
    orgName: 'Geheime Firma AG',
    subscriptionType: 'max',
    accessToken: 'sk-ant-oat01-FAKEFAKEFAKEFAKEFAKEFAKE',
  });
  process.exit(loggedIn ? 0 : 1);
}

/** @type {Record<string, string | boolean>} */
const options = {};
/** @type {string | null} */
let prompt = null;
for (let index = 0; index < args.length; index += 1) {
  const arg = /** @type {string} */ (args[index]);
  if (VALUE_OPTIONS.has(arg)) {
    options[arg] = args[index + 1] ?? '';
    index += 1;
  } else if (FLAG_OPTIONS.has(arg)) {
    options[arg] = true;
  } else if (arg.startsWith('-')) {
    // Wie Commander: die erste unbekannte Option wird gemeldet.
    record({ kind: 'unknown-option', option: arg });
    process.stderr.write(`error: unknown option '${arg}'\n`);
    process.exit(1);
  } else if (prompt === null) {
    prompt = arg;
  }
}

// Ab hier würde die echte CLI ein Modell aufrufen.
const stdin = readFileSync(0, 'utf8');
record({
  kind: 'model-call',
  args,
  stdin,
  cwd: process.cwd(),
  cwdFiles: readdirSync(process.cwd()).sort(),
  env: Object.keys(process.env).filter((name) => /^CLAUDE/i.test(name)),
});

const settingSources = typeof options['--setting-sources'] === 'string';
const tools = mode === 'tools' ? ['Bash', 'Read', 'StructuredOutput'] : ['StructuredOutput'];
const structured = mode === 'no-structured' ? undefined : { ok: true };
const authFails = mode === 'settings-auth-fail' && settingSources;

if (mode === 'writes-file') {
  writeFileSync(path.join(process.cwd(), 'probe-injektion.txt'), 'nicht erlaubt');
}

const result = authFails
  ? { type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login', permission_denials: [] }
  : {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: '',
      ...(structured === undefined ? {} : { structured_output: structured }),
      permission_denials: [],
      num_turns: 2,
      total_cost_usd: 0.0012,
      modelUsage: { 'fake-model': {} },
    };

if (options['--output-format'] === 'stream-json') {
  print({ type: 'system', subtype: 'init', tools, mcp_servers: [], model: 'fake-model', cwd: process.cwd() });
  if (mode === 'auth-retry') {
    print({ type: 'system', subtype: 'api_retry', attempt: 1, error: 'authentication_failed' });
    print({ type: 'system', subtype: 'api_retry', attempt: 2, error: 'authentication_failed' });
    process.exit(1);
  }
  print({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'StructuredOutput', input: { ok: true } }] } });
  print(result);
} else {
  if (mode === 'auth-retry') process.exit(1);
  if (mode === 'extra-text') print('Eine neue Version ist verfügbar.');
  print(result);
}
process.exit(0);
