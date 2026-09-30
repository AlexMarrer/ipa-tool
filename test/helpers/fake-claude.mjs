/**
 * Fake Claude Code CLI for the automatic tests (spec.md §16.2). It never calls a model.
 *
 * Used via `claude.command = [process.execPath, <this file>]` and controlled only by environment
 * variables of the test (the tool itself sets none of them):
 *   FAKE_CLAUDE_MODE         ok (default) | invalid-json | extra-text | error-result | no-structured | exit-nonzero
 *                            | hang | hang-no-stdin | hang-ignore-term | stderr-flood | writes-file | tools | mcp
 *                            | settings-auth-fail | auth-retry | logged-out | auth-no-json
 *                            | analysis (a valid analysis answer derived from the input package on stdin)
 *                            | journal (a valid journal answer derived from the journal input on stdin)
 *   FAKE_CLAUDE_UNSUPPORTED  comma-separated options reported as unknown, for example "--safe-mode" like 2.1.114
 *   FAKE_CLAUDE_VERSION      output of --version, default 9.9.9
 *   FAKE_CLAUDE_OUTPUT       JSON text for structured_output, default {"ok":true}
 *   FAKE_CLAUDE_AUTH_METHOD  authMethod of auth status, for example third_party for a provider in managed settings
 *   FAKE_CLAUDE_API_KEY_SOURCE  apiKeySource of auth status, for example "/login managed key" after a Console login
 *   FAKE_CLAUDE_LOG          file that receives one JSON line per call
 *
 * Like Claude Code 2.1.114, auth status applies `env` and `apiKeyHelper` of $CLAUDE_CONFIG_DIR/settings.json and
 * reports third_party with a provider variable, oauth_token with ANTHROPIC_AUTH_TOKEN or CLAUDE_CODE_OAUTH_TOKEN,
 * api_key_helper with apiKeyHelper and still claude.ai with ANTHROPIC_API_KEY, plus apiKeySource.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const mode = process.env['FAKE_CLAUDE_MODE'] ?? 'ok';
const logFile = process.env['FAKE_CLAUDE_LOG'];
const unsupported = new Set((process.env['FAKE_CLAUDE_UNSUPPORTED'] ?? '').split(',').filter((flag) => flag !== ''));
const version = process.env['FAKE_CLAUDE_VERSION'] ?? '9.9.9';
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
const FLAG_OPTIONS = new Set([
  '-p',
  '--print',
  '--strict-mcp-config',
  '--disable-slash-commands',
  '--no-session-persistence',
  '--verbose',
  '--safe-mode',
]);

/** @param {Record<string, unknown>} entry */
function record(entry) {
  if (logFile) appendFileSync(logFile, `${JSON.stringify({ ...entry, pid: process.pid })}\n`);
}

/** @param {unknown} value */
function print(value) {
  process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
}

function hang() {
  setInterval(() => undefined, 60_000);
}

/** @returns {Promise<Buffer>} */
async function readStdin() {
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(/** @type {Buffer} */ (chunk));
  return Buffer.concat(chunks);
}

if (args[0] === '--version' || args[0] === '-v') {
  record({ kind: 'version' });
  print(`${version} (Claude Code)`);
  process.exit(0);
}

if (args[0] === 'auth' && args[1] === 'status') {
  record({ kind: 'auth' });
  if (mode === 'auth-no-json') {
    print('Not logged in');
    process.exit(1);
  }
  const loggedIn = mode !== 'logged-out';
  /** @type {{ env?: Record<string, string>, apiKeyHelper?: string }} */
  let settings = {};
  try {
    settings = JSON.parse(readFileSync(path.join(process.env['CLAUDE_CONFIG_DIR'] ?? '', 'settings.json'), 'utf8'));
  } catch {
    // no user settings
  }
  const effective = { ...process.env, ...(settings.env ?? {}) };
  const helper = typeof settings.apiKeyHelper === 'string' && settings.apiKeyHelper !== '';
  const provider = ['BEDROCK', 'VERTEX', 'FOUNDRY', 'ANTHROPIC_AWS', 'MANTLE'].find((name) => effective[`CLAUDE_CODE_USE_${name}`]);
  const token = effective['ANTHROPIC_AUTH_TOKEN'] || effective['CLAUDE_CODE_OAUTH_TOKEN'] ? 'oauth_token' : helper ? 'api_key_helper' : 'claude.ai';
  const authMethod = process.env['FAKE_CLAUDE_AUTH_METHOD'] ?? (provider ? 'third_party' : token);
  const apiKeySource =
    process.env['FAKE_CLAUDE_API_KEY_SOURCE'] ?? (effective['ANTHROPIC_API_KEY'] ? 'ANTHROPIC_API_KEY' : helper ? 'apiKeyHelper' : undefined);
  // Personal fields that the tool must drop (AK-05-06).
  print({
    loggedIn,
    authMethod: loggedIn ? authMethod : 'none',
    apiProvider: provider ? provider.toLowerCase() : 'firstParty',
    ...(loggedIn && apiKeySource !== undefined ? { apiKeySource } : {}),
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
  if (arg.startsWith('-') && unsupported.has(arg)) {
    record({ kind: 'unknown-option', option: arg, args });
    process.stderr.write(`error: unknown option '${arg}'\n`);
    process.exit(1);
  }
  if (VALUE_OPTIONS.has(arg)) {
    options[arg] = args[index + 1] ?? '';
    index += 1;
  } else if (FLAG_OPTIONS.has(arg)) {
    options[arg] = true;
  } else if (arg.startsWith('-')) {
    // Like Commander: the first unknown option ends the program before anything else happens.
    record({ kind: 'unknown-option', option: arg, args });
    process.stderr.write(`error: unknown option '${arg}'\n`);
    process.exit(1);
  } else if (prompt === null) {
    prompt = arg;
  }
}

if (options['-p'] !== true && options['--print'] !== true) {
  process.stderr.write('fake-claude: interaktiver Modus wird nicht nachgebildet\n');
  process.exit(2);
}

const promptFile = typeof options['--append-system-prompt-file'] === 'string' ? options['--append-system-prompt-file'] : null;
/** @param {Buffer | null} stdin */
function modelCall(stdin) {
  let promptFileSha256 = null;
  try {
    if (promptFile !== null) promptFileSha256 = createHash('sha256').update(readFileSync(promptFile)).digest('hex');
  } catch {
    promptFileSha256 = 'nicht lesbar';
  }
  record({
    kind: 'model-call',
    args,
    stdin: stdin !== null && stdin.length <= 65536 ? stdin.toString('utf8') : null,
    stdinBytes: stdin === null ? null : stdin.length,
    stdinSha256: stdin === null ? null : createHash('sha256').update(stdin).digest('hex'),
    cwd: process.cwd(),
    cwdFiles: readdirSync(process.cwd()).sort(),
    promptFileSha256,
    env: Object.keys(process.env)
      .filter((name) => /^(CLAUDE|MCP_)/i.test(name))
      .sort(),
  });
}

if (mode === 'hang-no-stdin') {
  modelCall(null);
  hang();
} else {
  const stdin = await readStdin();
  modelCall(stdin);
  respond(stdin);
}

/**
 * Answer that passes the rules of spec.md §15 for an analysis input package (package 06).
 * @param {Buffer} stdin
 */
function analysisAnswer(stdin) {
  /** @type {{ snapshotId: string, allowedEvidenceIds: string[], evidence: { id: string, kind: string, path: string | null, label?: string, fresh?: boolean, omitted: unknown, binary: boolean, content: string | null }[] }} */
  const input = JSON.parse(stdin.toString('utf8'));
  const usable = input.evidence.filter((entry) => entry.omitted === null && !entry.binary && entry.content !== null);
  const deltas = usable.filter((entry) => entry.kind === 'state_delta');
  const reports = usable.filter((entry) => entry.kind === 'test_report' && entry.fresh === true);
  return {
    summary: { text: `Künstliche Analyse von ${input.snapshotId}.`, evidence: input.allowedEvidenceIds.slice(0, 1) },
    implemented: deltas.map((entry) => ({ title: `Änderung an ${entry.path}`, description: 'Von der Fake-CLI erzeugt.', evidence: [entry.id] })),
    decisions: [],
    problems: [],
    tests: reports.map((entry) => ({ description: `Testbericht ${entry.label}`, result: 'passed', evidence: [entry.id] })),
    contradictions: [],
    unknowns: ['Die Begründung der Änderungen ist nicht belegt.'],
  };
}

/**
 * Answer that passes the rules of spec.md §15 for a journal input (package 07): notes by type, changed
 * files of the day as done work, fresh reports as passed and changed test files as unknown.
 * @param {Buffer} stdin
 */
function journalAnswer(stdin) {
  /** @type {{ allowedEvidenceIds: string[], notes: { id: string, type: string, text: string, reason: string | null, alternatives: string[], cause: string | null, solution: string | null }[], evidence: { ref: string, kind: string, path: string | null, omitted: boolean, binary: boolean, fresh: boolean | null }[] }} */
  const input = JSON.parse(stdin.toString('utf8'));
  const allowed = new Set(input.allowedEvidenceIds);
  /** @param {string[]} types */
  const notesOf = (...types) => input.notes.filter((note) => types.includes(note.type));
  const usable = input.evidence.filter((entry) => allowed.has(entry.ref) && !entry.omitted && !entry.binary);
  const deltas = usable.filter((entry) => entry.kind === 'state_delta');
  const reports = usable.filter((entry) => entry.kind === 'test_report' && entry.fresh === true);
  return {
    planned: notesOf('plan').map((note) => ({ text: note.text, evidence: [note.id] })),
    done: [
      ...notesOf('activity', 'general').map((note) => ({ text: note.text, evidence: [note.id] })),
      ...deltas.map((entry) => ({ text: `Änderung an ${entry.path}`, evidence: [entry.ref] })),
    ],
    problems: notesOf('problem').map((note) => ({ problem: note.text, cause: note.cause, solution: note.solution, evidence: [note.id] })),
    decisions: notesOf('decision').map((note) => ({ decision: note.text, rationale: note.reason, alternatives: note.alternatives, evidence: [note.id] })),
    tests: [
      ...reports.map((entry) => ({ description: `Testbericht ${entry.path}`, result: 'passed', evidence: [entry.ref] })),
      ...deltas
        .filter((entry) => /test/i.test(entry.path ?? ''))
        .map((entry) => ({ description: `Geänderte Testdatei ${entry.path}`, result: 'unknown', evidence: [entry.ref] })),
    ],
    deviations: [],
    insights: notesOf('insight').map((note) => ({ text: note.text, evidence: [note.id] })),
    nextSteps: [],
    unknowns: ['Künstlicher Journal-Entwurf der Fake-CLI.'],
  };
}

/** @param {Buffer} stdin */
function respond(stdin) {
  const streaming = options['--output-format'] === 'stream-json';
  const settingSources = typeof options['--setting-sources'] === 'string';
  if (mode === 'hang' || (mode === 'auth-retry' && !streaming)) return hang();
  if (mode === 'hang-ignore-term') {
    process.on('SIGTERM', () => undefined);
    return hang();
  }
  if (mode === 'exit-nonzero') {
    process.stderr.write('Fehler: künstlicher Absturz der Fake-CLI\n');
    process.exitCode = 3;
    return;
  }
  if (mode === 'invalid-json') {
    print('{"type":"result", kaputt');
    return;
  }
  if (mode === 'stderr-flood') process.stderr.write('x'.repeat(100 * 1024));
  if (mode === 'writes-file') writeFileSync(path.join(process.cwd(), 'doctor-injektion.txt'), 'nicht erlaubt');

  const structured =
    mode === 'analysis' ? analysisAnswer(stdin) : mode === 'journal' ? journalAnswer(stdin) : JSON.parse(process.env['FAKE_CLAUDE_OUTPUT'] ?? '{"ok":true}');
  const success = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 1234,
    num_turns: 2,
    result: '',
    ...(mode === 'no-structured' ? {} : { structured_output: structured }),
    total_cost_usd: 0.0123,
    modelUsage: { 'claude-fake-model': { inputTokens: 10, outputTokens: 5 } },
    permission_denials: [],
  };
  const failed =
    mode === 'error-result'
      ? { type: 'result', subtype: 'error_max_turns', is_error: true, duration_ms: 2000, total_cost_usd: 0.002, modelUsage: {} }
      : mode === 'settings-auth-fail' && settingSources
        ? { type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login', modelUsage: {} }
        : null;

  if (streaming) {
    const tools = mode === 'tools' ? ['Bash', 'Read', 'StructuredOutput'] : ['StructuredOutput'];
    const servers = mode === 'mcp' ? [{ name: 'firma-server', status: 'connected' }] : [];
    print({ type: 'system', subtype: 'init', tools, mcp_servers: servers, model: 'claude-fake-model', cwd: process.cwd() });
    if (mode === 'auth-retry') {
      // Like the real CLI after a rejected login: retries until the timeout.
      let attempt = 0;
      const retry = () => {
        attempt += 1;
        print({ type: 'system', subtype: 'api_retry', attempt, error: 'authentication_failed' });
      };
      retry();
      setInterval(retry, 200);
      return;
    }
    print({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'StructuredOutput', input: structured }] } });
    print(failed ?? success);
    process.exitCode = failed === null ? 0 : 1;
    return;
  }
  if (mode === 'extra-text') print('Eine neue Version von Claude Code ist verfügbar.');
  print(failed ?? success);
  // No process.exit(): large outputs such as the stderr flood must reach the pipe completely.
  process.exitCode = failed === null ? 0 : 1;
}
